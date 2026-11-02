'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const postgres = require('postgres');
const { createApp } = require('../../server/app');

const databaseUrl = process.env.ETERVERSO_TEST_DATABASE_URL;
let sql;
let server;
let baseUrl;
const createdUserIds = [];
const createdCategoryIds = [];
const createdThreadIds = [];
const createdPostIds = [];

test.before(async () => {
  assert.ok(databaseUrl, 'Run npm run test:env:up, then npm run test:integration.');
  assert.equal(process.env.DATABASE_URL, undefined, 'The guarded runner must not pass the development DSN.');
  assert.equal(process.env.DEV_DATABASE_URL, undefined, 'The guarded runner must not pass the development DSN.');
  const target = new URL(databaseUrl);
  assert.equal(target.hostname, '127.0.0.1');
  assert.equal(decodeURIComponent(target.pathname.slice(1)), 'eterverso_test');
  sql = postgres(databaseUrl, { prepare: false, max: 5, connect_timeout: 5, idle_timeout: 2, connection: { timezone: 'UTC' } });
  const identity = await sql`SELECT current_database() AS database`;
  assert.equal(identity[0].database, 'eterverso_test');
  const app = createApp({
    sql,
    config: {
      sessionSecret: `auth-http-${randomUUID()}`,
      secureCookies: false,
      production: false,
      publicOrigin: 'http://localhost:3000',
    },
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  for (const id of createdPostIds) await sql`DELETE FROM posts WHERE id = ${id}`;
  for (const id of createdThreadIds) await sql`DELETE FROM threads WHERE id = ${id}`;
  for (const id of createdCategoryIds) await sql`DELETE FROM categories WHERE id = ${id}`;
  for (const id of createdUserIds) await sql`DELETE FROM users WHERE id = ${id}`;
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (sql) await sql.end({ timeout: 5 });
});

test('AUTH-01 signup, CSRF, profile versioning, password rotation, and disabled sessions use server identity', async () => {
  const suffix = randomUUID().slice(0, 8);
  const username = `auth-fixture-${suffix}`;
  const email = `${username}@example.test`;
  const anonymous = new CookieJar();

  const csrf = await request(anonymous, 'GET', '/api/auth/csrf');
  assert.equal(csrf.status, 200);
  assert.match(csrf.body.csrfToken, /^[A-Za-z0-9_-]{43}$/);

  const rejectedWithoutToken = await request(anonymous, 'POST', '/api/auth/signup', {
    body: { username, email, password: 'synthetic-password' },
  });
  assert.equal(rejectedWithoutToken.status, 403);
  assert.equal(rejectedWithoutToken.body.code, 'CSRF_INVALID');

  const rejectedCrossOrigin = await request(anonymous, 'POST', '/api/auth/signup', {
    token: csrf.body.csrfToken,
    origin: 'https://attacker.invalid',
    body: { username, email, password: 'synthetic-password' },
  });
  assert.equal(rejectedCrossOrigin.status, 403);
  assert.equal(rejectedCrossOrigin.body.code, 'ORIGIN_FORBIDDEN');

  const signup = await request(anonymous, 'POST', '/api/auth/signup', {
    token: csrf.body.csrfToken,
    body: { username, email, password: 'synthetic-password' },
  });
  assert.equal(signup.status, 201, JSON.stringify(signup.body));
  createdUserIds.push(signup.body.user.id);
  assert.equal(signup.body.user.email, email);
  assert.equal(signup.body.user.version, 1);
  assert.equal(Object.hasOwn(signup.body.user, 'password_hash'), false);
  assert.equal(Object.hasOwn(signup.body.user, 'admTentativaUsada'), false);
  assert.match(signup.body.csrfToken, /^[A-Za-z0-9_-]{43}$/);
  anonymous.token = signup.body.csrfToken;

  const currentSessionCookie = anonymous.copy();
  const me = await request(anonymous, 'GET', '/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.user.id, signup.body.user.id);

  const categoryRows = await sql`INSERT INTO categories (name, description) VALUES (${`Auth fixture ${suffix}`}, 'Synthetic') RETURNING id`;
  createdCategoryIds.push(categoryRows[0].id);
  const threadRows = await sql`INSERT INTO threads (category_id, author_id, title) VALUES (${categoryRows[0].id}, ${signup.body.user.id}, 'Auth fixture topic') RETURNING id`;
  createdThreadIds.push(threadRows[0].id);
  const postRows = await sql`INSERT INTO posts (thread_id, author_id, content, post_no) VALUES (${threadRows[0].id}, ${signup.body.user.id}, '<p>Synthetic opening.</p>', 1) RETURNING id`;
  createdPostIds.push(postRows[0].id);
  const countedMe = await request(anonymous, 'GET', '/api/auth/me');
  assert.equal(countedMe.body.user.posts, 1, 'profile count is derived from server forum posts');

  const publicProfile = await request(anonymous, 'GET', `/api/users/${signup.body.user.id}`);
  assert.equal(publicProfile.status, 200);
  assert.deepEqual(Object.keys(publicProfile.body.user).sort(), ['avatar', 'id', 'posts', 'role', 'title', 'username']);
  assert.equal(publicProfile.body.user.posts, 1);
  for (const privateField of ['email', 'bio', 'password_hash', 'authVersion', 'disabledAt', 'version']) {
    assert.equal(Object.hasOwn(publicProfile.body.user, privateField), false, `public profile omits ${privateField}`);
  }
  const missingPublicProfile = await request(anonymous, 'GET', `/api/users/${randomUUID()}`);
  assert.equal(missingPublicProfile.status, 404);

  const preview = await request(anonymous, 'POST', '/api/content/preview', {
    token: anonymous.token,
    body: { html: '<p>Safe formatting</p><img src="https://example.test/a.png" onerror="window.__xss=1"><script>window.__xss=2</script>' },
  });
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.match(preview.body.html, /<p>Safe formatting<\/p>/);
  assert.doesNotMatch(preview.body.html, /script|onerror|window\.__xss/i);
  assert.equal(preview.body.formattingLoss.discarded, true);

  const previewBlocks = await request(anonymous, 'POST', '/api/content/preview', {
    token: anonymous.token,
    body: { blocks: [{ type: 'section', title: 'Synthetic', content: '<p>Visible</p><img src=x onerror="alert(1)">' }] },
  });
  assert.equal(previewBlocks.status, 200, JSON.stringify(previewBlocks.body));
  assert.match(previewBlocks.body.blocks[0].content, /<p>Visible<\/p>/);
  assert.doesNotMatch(previewBlocks.body.blocks[0].content, /onerror|alert\(1\)/i);

  const unexpectedField = await request(anonymous, 'PUT', '/api/auth/profile', {
    token: anonymous.token,
    body: { title: 'Membro', expectedVersion: 1, role: 'admin' },
  });
  assert.equal(unexpectedField.status, 400);
  assert.equal(unexpectedField.body.code, 'INVALID_SHAPE');

  const profile = await request(anonymous, 'PUT', '/api/auth/profile', {
    token: anonymous.token,
    body: { title: 'Cronista sintético', avatar: 'https://example.test/avatar.png', bio: 'Fixture de teste.', expectedVersion: 1 },
  });
  assert.equal(profile.status, 200, JSON.stringify(profile.body));
  assert.equal(profile.body.user.version, 2);
  assert.equal(profile.body.user.title, 'Cronista sintético');

  const stale = await request(anonymous, 'PUT', '/api/auth/profile', {
    token: anonymous.token,
    body: { title: 'Versão obsoleta', avatar: '', bio: '', expectedVersion: 1 },
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'STALE_VERSION');

  const passwordChange = await request(anonymous, 'PUT', '/api/auth/profile', {
    token: anonymous.token,
    body: {
      title: 'Cronista sintético', avatar: 'https://example.test/avatar.png', bio: 'Fixture de teste.',
      currentPassword: 'synthetic-password', newPassword: 'synthetic-password-rotated', expectedVersion: 2,
    },
  });
  assert.equal(passwordChange.status, 200, JSON.stringify(passwordChange.body));
  assert.equal(passwordChange.body.user.version, 3);
  assert.match(passwordChange.body.csrfToken, /^[A-Za-z0-9_-]{43}$/);
  anonymous.token = passwordChange.body.csrfToken;

  const staleSession = new CookieJar(currentSessionCookie);
  const oldMe = await request(staleSession, 'GET', '/api/auth/me');
  assert.equal(oldMe.status, 401);
  const newMe = await request(anonymous, 'GET', '/api/auth/me');
  assert.equal(newMe.status, 200);

  const copiedLogoutSession = new CookieJar(anonymous.copy());
  const logoutCsrf = await request(anonymous, 'GET', '/api/auth/csrf');
  const logout = await request(anonymous, 'POST', '/api/auth/logout', { token: logoutCsrf.body.csrfToken, body: {} });
  assert.equal(logout.status, 200);
  const copiedCookieAfterLogout = await request(copiedLogoutSession, 'GET', '/api/auth/me');
  assert.equal(copiedCookieAfterLogout.status, 401, 'logout revokes a copied signed cookie on the server');

  const freshLogin = new CookieJar();
  const freshLoginCsrf = await request(freshLogin, 'GET', '/api/auth/csrf');
  const login = await request(freshLogin, 'POST', '/api/auth/login', {
    token: freshLoginCsrf.body.csrfToken,
    body: { username, password: 'synthetic-password-rotated' },
  });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.posts, 1);

  await sql`UPDATE users SET disabled_at = now() WHERE id = ${signup.body.user.id}`;
  const disabledMe = await request(freshLogin, 'GET', '/api/auth/me');
  assert.equal(disabledMe.status, 401);
  const disabledLoginJar = new CookieJar();
  const disabledLoginCsrf = await request(disabledLoginJar, 'GET', '/api/auth/csrf');
  const disabledLogin = await request(disabledLoginJar, 'POST', '/api/auth/login', {
    token: disabledLoginCsrf.body.csrfToken,
    body: { username, password: 'synthetic-password-rotated' },
  });
  assert.equal(disabledLogin.status, 401);
  assert.equal(disabledLogin.body.code, 'INVALID_CREDENTIALS');

  const signupA = new CookieJar();
  const signupB = new CookieJar();
  const [csrfA, csrfB] = await Promise.all([
    request(signupA, 'GET', '/api/auth/csrf'),
    request(signupB, 'GET', '/api/auth/csrf'),
  ]);
  const duplicateUsername = `Concurrent-${suffix}`;
  const [raceA, raceB] = await Promise.all([
    request(signupA, 'POST', '/api/auth/signup', { token: csrfA.body.csrfToken, body: { username: duplicateUsername, email: `race-a-${suffix}@example.test`, password: 'synthetic-password' } }),
    request(signupB, 'POST', '/api/auth/signup', { token: csrfB.body.csrfToken, body: { username: duplicateUsername.toLowerCase(), email: `race-b-${suffix}@example.test`, password: 'synthetic-password' } }),
  ]);
  assert.deepEqual([raceA.status, raceB.status].sort(), [201, 409]);
  const winner = raceA.status === 201 ? raceA : raceB;
  createdUserIds.push(winner.body.user.id);
  const conflict = raceA.status === 409 ? raceA : raceB;
  assert.equal(conflict.body.code, 'ACCOUNT_CONFLICT');
});

async function request(jar, method, path, options = {}) {
  const headers = {};
  if (jar.header()) headers.cookie = jar.header();
  if (options.token) headers['x-csrf-token'] = options.token;
  if (options.origin) headers.origin = options.origin;
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  jar.update(response);
  const body = await response.json();
  return { status: response.status, body };
}

class CookieJar {
  constructor(values) {
    this.values = new Map(values || []);
    this.token = null;
  }

  header() {
    return [...this.values.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  update(response) {
    const cookies = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie') || ''];
    for (const cookie of cookies) {
      const pair = cookie.split(';', 1)[0];
      const separator = pair.indexOf('=');
      if (separator < 1) continue;
      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      if (!value) this.values.delete(name);
      else this.values.set(name, value);
    }
  }

  copy() {
    return new Map(this.values);
  }
}
