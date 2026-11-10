'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const Module = require('node:module');
const path = require('node:path');
const postgres = require('postgres');
const { verifySchemaReadiness } = require('../../server');

const APP_MODULE = path.resolve(__dirname, '../../server/app.js');

test('app factory import has no environment, database, or listening side effects', () => {
  delete require.cache[APP_MODULE];
  const originalLoad = Module._load;
  const originalReadFileSync = fs.readFileSync;
  const originalListen = http.Server.prototype.listen;
  let listenCalls = 0;

  Module._load = function (request, parent, isMain) {
    assert.notEqual(request, 'dotenv', 'the app factory must not load dotenv');
    assert.notEqual(request, 'postgres', 'the app factory must not import a database connector');
    return originalLoad.call(this, request, parent, isMain);
  };
  fs.readFileSync = function (filename, ...args) {
    const name = typeof filename === 'string' ? path.basename(filename) : '';
    assert.notEqual(name, '.env', 'the app factory must not read .env');
    return originalReadFileSync.call(this, filename, ...args);
  };
  http.Server.prototype.listen = function (...args) {
    listenCalls += 1;
    return originalListen.apply(this, args);
  };

  try {
    const { createApp } = require(APP_MODULE);
    assert.equal(typeof createApp, 'function');
    assert.equal(listenCalls, 0);
  } finally {
    Module._load = originalLoad;
    fs.readFileSync = originalReadFileSync;
    http.Server.prototype.listen = originalListen;
    delete require.cache[APP_MODULE];
  }
});

test('injected app serves allowlisted recovery assets and preserves existing API wrappers', async (context) => {
  const queries = [];
  const sql = function (strings) {
    const query = strings.join('?');
    queries.push(query);
    if (query.includes('SELECT username, email FROM users')) return Promise.resolve([]);
    if (query.includes('INSERT INTO users')) {
      return Promise.resolve([{
        id: '00000000-0000-4000-8000-000000000001',
        username: 'Factory Tester',
        email: 'factory@example.test',
        role: 'member',
        avatar: '',
        title: 'Membro',
        bio: '',
        posts_count: 0,
        join_date: new Date('2026-01-01T00:00:00Z'),
        disabled_at: null,
        auth_version: 1,
        version: 1,
      }]);
    }
    throw new Error('Unexpected SQL statement in app-factory test.');
  };
  sql.json = (value) => JSON.stringify(value);
  sql.begin = (callback) => callback(sql);
  const { createApp } = require(APP_MODULE);
  const app = createApp({
    sql,
    config: { sessionSecret: 'test-only-session-secret', secureCookies: false },
  });
  assert.equal(app.locals.sql, sql);
  assert.deepEqual(app.locals.config, { secureCookies: false, production: false, publicOrigin: null });

  const server = app.listen(0, '127.0.0.1');
  context.after(async () => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const page = await fetch(`${baseUrl}/legacy-recovery.html`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /legacy-recovery\.js/);
  const script = await fetch(`${baseUrl}/legacy-recovery.js`);
  assert.equal(script.status, 200);
  const apiScript = await fetch(`${baseUrl}/client/api.js`);
  assert.equal(apiScript.status, 200);

  const missingApi = await fetch(`${baseUrl}/api/not-a-route`);
  assert.equal(missingApi.status, 404);
  assert.deepEqual(await missingApi.json(), { error: 'Rota não encontrada.', code: 'NOT_FOUND' });

  const csrfResponse = await fetch(`${baseUrl}/api/auth/csrf`);
  assert.equal(csrfResponse.status, 200);
  const csrfData = await csrfResponse.json();
  assert.match(csrfData.csrfToken, /^[A-Za-z0-9_-]{43}$/);
  const cookies = typeof csrfResponse.headers.getSetCookie === 'function'
    ? csrfResponse.headers.getSetCookie()
    : [csrfResponse.headers.get('set-cookie') || ''];
  const cookie = cookies.map((value) => value.split(';', 1)[0]).filter(Boolean).join('; ');

  const signup = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, 'x-csrf-token': csrfData.csrfToken },
    body: JSON.stringify({ username: 'Factory Tester', email: 'factory@example.test', password: 'test-password' }),
  });
  assert.equal(signup.status, 201);
  const signupData = await signup.json();
  assert.equal(signupData.user.id, '00000000-0000-4000-8000-000000000001');
  assert.equal(signupData.user.version, 1);
  assert.equal(signupData.user.email, 'factory@example.test');
  assert.match(signupData.csrfToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(queries.length, 2);
});

test('startup schema readiness accepts the exact isolated 0017 schema using read-only checks', async (context) => {
  const databaseUrl = process.env.ETERVERSO_TEST_DATABASE_URL;
  assert.ok(databaseUrl, 'the guarded runner must provide the isolated test database');
  const sql = postgres(databaseUrl, { prepare: false, max: 1, connect_timeout: 5, idle_timeout: 1, connection: { timezone: 'UTC' } });
  context.after(async () => sql.end({ timeout: 5 }));

  const readiness = await verifySchemaReadiness(sql);
  assert.deepEqual(readiness, { migration: '0017_timeline_events', verifiedColumns: 36 });
});

test('signup maps the postgres constraint_name from a concurrent uniqueness violation', async (context) => {
  const sql = async (parts) => {
    const query = parts.join('?');
    if (query.includes('SELECT username, email FROM users')) return [];
    if (query.includes('INSERT INTO users')) throw Object.assign(new Error('synthetic uniqueness race'), { code: '23505', constraint_name: 'users_username_lower_key' });
    throw new Error('Unexpected synthetic SQL.');
  };
  sql.json = JSON.stringify;
  sql.begin = callback => callback(sql);
  const { createApp } = require(APP_MODULE);
  const app = createApp({ sql, config: { sessionSecret: 'synthetic-factory-secret', secureCookies: false } });
  const server = app.listen(0, '127.0.0.1');
  context.after(() => new Promise(resolve => server.close(resolve)));
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(origin + '/api/auth/csrf');
  const csrf = await response.json();
  const cookie = response.headers.getSetCookie().map(value => value.split(';', 1)[0]).join('; ');
  const signup = await fetch(origin + '/api/auth/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': csrf.csrfToken },
    body: JSON.stringify({ username: 'SyntheticRace', email: 'race@example.test', password: 'synthetic-password' }),
  });
  assert.equal(signup.status, 409);
  assert.equal((await signup.json()).code, 'ACCOUNT_CONFLICT');
});
