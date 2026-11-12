'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const express = require('express');
const cookieSession = require('cookie-session');
const postgres = require('postgres');
const { createApp } = require('../../server/app');
const { createAuth, createCookieSessionOptions } = require('../../server/auth');
const { errorMiddleware } = require('../../server/errors');

const ROOT = path.resolve(__dirname, '../..');
const testDatabaseUrl = process.env.ETERVERSO_TEST_DATABASE_URL;

let sql;
let apiServer;
let sessionServer;
let apiBaseUrl;
let sessionBaseUrl;
let mwAuth;

test.before(async () => {
  assert.ok(testDatabaseUrl, 'Run npm run test:env:up, then npm run test:integration.');
  assert.equal(process.env.DATABASE_URL, undefined, 'The integration test process must not inherit the development DSN.');
  assert.equal(process.env.DEV_DATABASE_URL, undefined, 'The integration test process must not inherit the development DSN.');
  const verified = JSON.parse(execFileSync(process.execPath, [path.join(ROOT, 'scripts/test-env.js'), 'assert'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }));
  const target = new URL(testDatabaseUrl);
  assert.equal(target.hostname, '127.0.0.1');
  assert.equal(decodeURIComponent(target.pathname.slice(1)), 'eterverso_test');
  assert.equal(decodeURIComponent(target.username), 'eterverso_test');
  assert.equal(Number(target.port), verified.port);

  sql = postgres(testDatabaseUrl, { prepare: false, max: 10, connect_timeout: 5, idle_timeout: 2, connection: { timezone: 'UTC' } });
  const config = { sessionSecret: `char-mw-tests-${randomUUID()}`, secureCookies: false };
  mwAuth = createAuth({ sql, config });
  const app = createApp({ sql, config });
  apiServer = app.listen(0, '127.0.0.1');
  await waitForListening(apiServer);
  apiBaseUrl = `http://127.0.0.1:${apiServer.address().port}`;

  const sessionApp = express();
  sessionApp.use(cookieSession(createCookieSessionOptions(config)));
  sessionApp.get('/__fixture/session/:id', async (req, res, next) => {
    try {
      const rows = await sql`
        SELECT id, auth_version FROM users
        WHERE id = ${req.params.id} AND disabled_at IS NULL LIMIT 1`;
      if (!rows.length) return res.status(404).json({ error: 'Fixture account not found.' });
      const csrfToken = mwAuth.issueSession(req, rows[0]);
      return res.json({ csrfToken });
    } catch (error) {
      return next(error);
    }
  });
  sessionApp.use(errorMiddleware);
  sessionServer = sessionApp.listen(0, '127.0.0.1');
  await waitForListening(sessionServer);
  sessionBaseUrl = `http://127.0.0.1:${sessionServer.address().port}`;
});

test.after(async () => {
  if (sessionServer) await closeServer(sessionServer);
  if (apiServer) await closeServer(apiServer);
  if (sql) await sql.end({ timeout: 5 });
});

test('CMW-01 persists MediaWiki resources, compiles character sheets, and enforces staff permissions and versions', async (t) => {
  const suffix = randomUUID().slice(0, 8);
  const createdResourceIds = [];
  const createdCharacterIds = [];
  const createdUserIds = [];

  t.after(async () => {
    for (const charId of createdCharacterIds) {
      await sql`DELETE FROM personagens WHERE id = ${charId}`;
    }
    for (const resId of createdResourceIds) {
      await sql`DELETE FROM character_mw_resources WHERE id = ${resId}`;
    }
    for (const userId of createdUserIds) {
      await sql`DELETE FROM users WHERE id = ${userId}`;
    }
  });

  const [staffUser] = await sql`
    INSERT INTO users (username, email, password_hash, role)
    VALUES (${`mwstaff_${suffix}`}, ${`mwstaff_${suffix}@example.test`}, 'test-only-hash', 'moderador')
    RETURNING id`;
  const [memberUser] = await sql`
    INSERT INTO users (username, email, password_hash, role)
    VALUES (${`mwmember_${suffix}`}, ${`mwmember_${suffix}@example.test`}, 'test-only-hash', 'member')
    RETURNING id`;
  createdUserIds.push(staffUser.id, memberUser.id);

  const staffSession = await sessionFor(staffUser.id);
  const memberSession = await sessionFor(memberUser.id);

  const denied = await request(memberSession, '/api/personagens/mediawiki/resources', {
    method: 'POST',
    body: { kind: 'template', name: `Negado_${suffix}`, content: 'x' },
  });
  assert.equal(denied.status, 403);

  const cssRes = await request(staffSession, '/api/personagens/mediawiki/resources', {
    method: 'POST',
    body: { kind: 'css', name: `Estilo_${suffix}`, content: '.mw-card { color: #cceeff; }' },
  });
  assert.equal(cssRes.status, 201, JSON.stringify(cssRes.body));
  createdResourceIds.push(cssRes.body.data.id);

  const luaRes = await request(staffSession, '/api/personagens/mediawiki/resources', {
    method: 'POST',
    body: {
      kind: 'lua',
      name: `Mod_${suffix}`,
      content: 'local p = {} function p.badge(f) return "<span class=\\"mw-ficha-tag\\">" .. (f.args.tag or "") .. "</span>" end return p',
    },
  });
  assert.equal(luaRes.status, 201, JSON.stringify(luaRes.body));
  createdResourceIds.push(luaRes.body.data.id);

  const tplRes = await request(staffSession, '/api/personagens/mediawiki/resources', {
    method: 'POST',
    body: {
      kind: 'template',
      name: `Tpl_${suffix}`,
      content: `<templatestyles src="Estilo:Estilo_${suffix}" /><div class="mw-card"><strong>{{{nome|}}}</strong> {{#invoke:Mod_${suffix}|badge|tag={{{tag|}}}}}</div>`,
    },
  });
  assert.equal(tplRes.status, 201, JSON.stringify(tplRes.body));
  createdResourceIds.push(tplRes.body.data.id);

  const created = await request(staffSession, '/api/personagens', {
    method: 'POST',
    body: {
      nome: `Vaelen ${suffix}`,
      categoria: 'NPCs',
      contentMode: 'wikitext',
      wikitext: `== Registro ==\n{{Tpl_${suffix}|nome={{PAGENAME}}|tag=Arconte}}`,
      customCss: '.mw-card { padding: 12px; }',
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const charId = created.body.personagem.id;
  createdCharacterIds.push(charId);
  assert.equal(created.body.personagem.contentMode, 'wikitext');
  assert.match(created.body.personagem.descricao, new RegExp(`<strong>Vaelen ${suffix}</strong>`));
  assert.match(created.body.personagem.descricao, /<span class="mw-ficha-tag">Arconte<\/span>/);

  const stale = await request(staffSession, `/api/personagens/${charId}`, {
    method: 'PUT',
    body: {
      nome: `Vaelen ${suffix}`,
      contentMode: 'wikitext',
      wikitext: '== Atualizado ==',
      expectedVersion: 99,
    },
  });
  assert.equal(stale.status, 409);

  const updated = await request(staffSession, `/api/personagens/${charId}`, {
    method: 'PUT',
    body: {
      nome: `Vaelen ${suffix}`,
      contentMode: 'wikitext',
      wikitext: `== Atualizado ==\n{{Tpl_${suffix}|nome={{PAGENAME}}|tag=Mestre}}`,
      customCss: '.mw-card { margin: 8px; }',
      expectedVersion: created.body.personagem.version,
    },
  });
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  assert.match(updated.body.personagem.descricao, /Mestre/);
  assert.match(updated.body.personagem.compiledCss, new RegExp(`\\.char-mw-scope-${charId} \\.mw-card`));
});

async function sessionFor(userId) {
  const response = await fetch(`${sessionBaseUrl}/__fixture/session/${userId}`);
  assert.equal(response.status, 200);
  const cookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie') || ''];
  return {
    cookie: cookies.map((value) => value.split(';', 1)[0]).filter(Boolean).join('; '),
    csrfToken: (await response.json()).csrfToken,
  };
}

async function request(session, route, { method = 'GET', body } = {}) {
  const headers = {};
  if (session) {
    headers.cookie = session.cookie;
    headers['x-csrf-token'] = session.csrfToken;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      headers['x-idempotency-key'] = createHash('sha256').update(`${method}:${route}:${randomUUID()}`).digest('hex');
    }
  }
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${apiBaseUrl}${route}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

function waitForListening(server) {
  return new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}
