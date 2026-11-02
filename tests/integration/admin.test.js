'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { setImmediate: nextTurn } = require('node:timers/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const express = require('express');
const cookieSession = require('cookie-session');
const postgres = require('postgres');
const { createAuth, createCookieSessionOptions } = require('../../server/auth');
const { errorMiddleware } = require('../../server/errors');
const { ADMIN_SET_LOCK, bootstrapAdmin, createAdminRouter } = require('../../server/admin');
const { parseArguments } = require('../../scripts/bootstrap-admin');

const ROOT = path.resolve(__dirname, '../..');
const databaseUrl = process.env.ETERVERSO_TEST_DATABASE_URL;
let sql;
let server;
let baseUrl;
let failAudit = false;
let wrappedSql;

test.before(async () => {
  assert.ok(databaseUrl, 'Run the guarded isolated integration test runner.');
  assert.equal(process.env.DATABASE_URL, undefined);
  assert.equal(process.env.DEV_DATABASE_URL, undefined);
  const verified = JSON.parse(execFileSync(process.execPath, [path.join(ROOT, 'scripts/test-env.js'), 'assert'], {
    cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  }));
  const target = new URL(databaseUrl);
  assert.equal(target.hostname, '127.0.0.1');
  assert.equal(decodeURIComponent(target.pathname.slice(1)), 'eterverso_test');
  assert.equal(decodeURIComponent(target.username), 'eterverso_test');
  assert.equal(Number(target.port), verified.port);
  sql = postgres(databaseUrl, { prepare: false, max: 12, connect_timeout: 5, idle_timeout: 2 });
  const identity = await sql`SELECT current_database() AS database, current_user AS username`;
  assert.equal(identity[0].database, 'eterverso_test');
  assert.equal(identity[0].username, 'eterverso_test');
  wrappedSql = decorate(sql);
  const secret = `admin-http-${randomUUID()}`;
  const auth = createAuth({ sql: wrappedSql, config: { sessionSecret: secret } });
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use(cookieSession(createCookieSessionOptions({ sessionSecret: secret })));
  app.use(auth.csrfProtection);
  app.get('/__fixture/session/:id', async (req, res, next) => {
    try {
      const rows = await sql`SELECT id, auth_version FROM users WHERE id = ${req.params.id} AND disabled_at IS NULL`;
      if (!rows.length) return res.status(404).json({});
      res.json({ csrfToken: auth.issueSession(req, rows[0]) });
    } catch (error) { next(error); }
  });
  app.get('/__fixture/protected', auth.requireIdentity, (req, res) => res.json({ id: req.authUser.id }));
  app.use('/api/admin', createAdminRouter({ sql: wrappedSql, auth }));
  app.use(errorMiddleware);
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (sql) await sql.end({ timeout: 5 });
});

// Fault injection decorates the injected transaction client, not production
// configuration or database schema. An audit failure must roll back real SQL.
function decorate(client) {
  const wrapped = (strings, ...values) => {
    if (failAudit && /INSERT\s+INTO\s+audit_events/i.test(strings.join('?'))) throw new Error('Synthetic audit failure');
    return client(strings, ...values);
  };
  wrapped.json = client.json.bind(client);
  wrapped.begin = (callback) => client.begin((tx) => callback(decorate(tx)));
  return wrapped;
}

test('ADM-01 administrative permissions, category recovery, versions, DTOs and revoked sessions', async (t) => {
  const f = await fixture(t, ['admin', 'admin', 'moderador', 'member']);
  const admin = await sessionFor(f.users[0].id);
  const otherAdmin = await sessionFor(f.users[1].id);
  const moderator = await sessionFor(f.users[2].id);
  const member = await sessionFor(f.users[3].id);
  for (const session of [null, moderator, member]) {
    for (const route of ['/users', '/categories', '/audit-events']) {
      const denied = await request(session, route);
      assert.equal(denied.status, session ? 403 : 401);
    }
  }
  const moderatorPromotion = await request(moderator, `/users/${f.users[2].id}`, {
    method: 'PATCH', body: { role: 'admin', reason: 'Forbidden grant', expectedVersion: 1 },
  });
  assert.equal(moderatorPromotion.status, 403);
  const forbiddenCategory = await request(moderator, '/categories', {
    method: 'POST', body: { name: 'Forbidden category', reason: 'Forbidden grant' },
  });
  assert.equal(forbiddenCategory.status, 403);

  const invalidPagination = await request(admin, '/users?limit=101');
  assert.equal(invalidPagination.status, 400);
  const directory = await request(admin, '/users?limit=1');
  assert.equal(directory.status, 200);
  assert.equal(directory.body.data.length, 1);
  assert.equal(directory.body.page.hasMore, true);
  for (const row of directory.body.data) {
    assert.equal(Object.hasOwn(row, 'password_hash'), false);
    assert.equal(Object.hasOwn(row, 'auth_version'), false);
    assert.equal(Object.hasOwn(row, 'csrfToken'), false);
  }

  const category = await request(admin, '/categories', {
    method: 'POST', body: { name: `Admin category ${f.suffix}`, description: 'Synthetic description', reason: 'Synthetic setup' },
  });
  assert.equal(category.status, 201, JSON.stringify(category.body));
  const categoryId = category.body.data.id;
  f.categoryIds.push(categoryId);
  const missingVersion = await request(admin, `/categories/${categoryId}`, {
    method: 'PATCH', body: { name: 'Missing version', reason: 'Synthetic edit' },
  });
  assert.equal(missingVersion.status, 428);
  const edited = await request(admin, `/categories/${categoryId}`, {
    method: 'PATCH', body: { description: 'Revised synthetic description', reason: 'Synthetic edit', expectedVersion: 1 },
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.data.version, 2);
  const archived = await request(admin, `/categories/${categoryId}/archive`, {
    method: 'POST', body: { expectedVersion: 2, reason: 'Synthetic archive' },
  });
  assert.equal(archived.status, 200);
  assert.ok(archived.body.data.archivedAt);
  const reservedName = await request(admin, '/categories', {
    method: 'POST', body: { name: category.body.data.name, reason: 'Must remain reserved' },
  });
  assert.equal(reservedName.status, 409);
  const restored = await request(admin, `/categories/${categoryId}/restore`, {
    method: 'POST', body: { expectedVersion: 3, reason: 'Synthetic restore' },
  });
  assert.equal(restored.status, 200);
  assert.equal(restored.body.data.archivedAt, null);
  assert.equal(restored.body.data.version, 4);
  const readByOther = await request(otherAdmin, '/categories');
  assert.equal(readByOther.body.data.find((row) => row.id === categoryId).version, 4);

  const twoActions = await request(admin, `/users/${f.users[3].id}`, {
    method: 'PATCH', body: { role: 'moderador', disabled: true, expectedVersion: 1, reason: 'Must pick one action' },
  });
  assert.equal(twoActions.status, 400);
  const promoted = await request(admin, `/users/${f.users[3].id}`, {
    method: 'PATCH', body: { role: 'moderador', expectedVersion: 1, reason: 'Synthetic role review' },
  });
  assert.equal(promoted.status, 200, JSON.stringify(promoted.body));
  assert.equal(promoted.body.data.version, 2);
  assert.equal(promoted.body.data.role, 'moderador');
  assert.equal((await protectedRead(member)).status, 401);
  const oldModeratorSession = await sessionFor(f.users[3].id);
  const disabled = await request(otherAdmin, `/users/${f.users[3].id}`, {
    method: 'PATCH', body: { disabled: true, expectedVersion: 2, reason: 'Synthetic access review' },
  });
  assert.equal(disabled.status, 200);
  assert.ok(disabled.body.data.disabledAt);
  assert.equal((await protectedRead(oldModeratorSession)).status, 401);
  const stale = await request(admin, `/users/${f.users[3].id}`, {
    method: 'PATCH', body: { disabled: false, expectedVersion: 2, reason: 'Stale version refused' },
  });
  assert.equal(stale.status, 409);
  const enabled = await request(admin, `/users/${f.users[3].id}`, {
    method: 'PATCH', body: { disabled: false, expectedVersion: 3, reason: 'Synthetic restored access' },
  });
  assert.equal(enabled.status, 200);
  assert.equal(enabled.body.data.disabledAt, null);
  const events = await request(admin, '/audit-events?limit=100');
  assert.equal(events.status, 200);
  const actions = events.body.data.filter((row) => row.targetId === categoryId).map((row) => row.action).sort();
  assert.deepEqual(actions, ['admin.category.archive', 'admin.category.create', 'admin.category.edit', 'admin.category.restore']);
  assert.equal(JSON.stringify(events.body).includes('test-only-hash'), false);

  const selfDemotion = await request(admin, `/users/${f.users[0].id}`, {
    method: 'PATCH', body: { role: 'member', expectedVersion: 1, reason: 'Synthetic self demotion' },
  });
  assert.equal(selfDemotion.status, 200);
  assert.ok(selfDemotion.cookies.some((cookie) => cookie.startsWith('eterverso_session=;')));
  assert.equal((await request(admin, '/users')).status, 401);
  const confirmed = await request(otherAdmin, '/users?limit=100');
  assert.equal(confirmed.body.data.find((row) => row.id === f.users[0].id).role, 'member');
});

test('ADM-02 concurrent final-admin demotion and disable preserve an active administrator', async (t) => {
  for (const action of ['demote', 'disable']) {
    await t.test(action, async (subtest) => {
      const f = await fixture(subtest, ['admin', 'admin']);
      const sessions = await Promise.all(f.users.map((user) => sessionFor(user.id)));
      const results = await behindAdminLock(() => sessions.map((session, index) => request(session, `/users/${f.users[index].id}`, {
        method: 'PATCH', body: {
          ...(action === 'demote' ? { role: 'member' } : { disabled: true }),
          expectedVersion: 1, reason: 'Synthetic simultaneous self change',
        },
      })));
      assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
      assert.equal(results.find((result) => result.status === 409).body.code, 'LAST_ACTIVE_ADMIN');
      const counts = await sql`SELECT count(*)::integer AS count FROM users WHERE role = 'admin' AND disabled_at IS NULL`;
      assert.equal(counts[0].count, 1);
      const audit = await sql`SELECT count(*)::integer AS count FROM audit_events WHERE actor_id IN (${f.users[0].id}, ${f.users[1].id})`;
      assert.equal(audit[0].count, 1);
    });
  }
});

test('ADM-02 audit failure rolls back account/category mutations and auth-version changes', async (t) => {
  const f = await fixture(t, ['admin', 'member']);
  const admin = await sessionFor(f.users[0].id);
  failAudit = true;
  try {
    const role = await request(admin, `/users/${f.users[1].id}`, {
      method: 'PATCH', body: { role: 'moderador', expectedVersion: 1, reason: 'Synthetic rollback' },
    });
    assert.equal(role.status, 500);
    const category = await request(admin, '/categories', {
      method: 'POST', body: { name: `Audit rollback ${f.suffix}`, reason: 'Synthetic rollback' },
    });
    assert.equal(category.status, 500);
  } finally { failAudit = false; }
  const rows = await sql`SELECT role, version, auth_version FROM users WHERE id = ${f.users[1].id}`;
  assert.deepEqual(rows[0], { role: 'member', version: 1, auth_version: 1 });
  const categories = await sql`SELECT id FROM categories WHERE name = ${`Audit rollback ${f.suffix}`}`;
  assert.equal(categories.length, 0);
});

test('ADM-03 bootstrap is explicit, serialized, operator-audited and cannot replace an active admin', async (t) => {
  const f = await fixture(t, ['member', 'member']);
  assert.throws(() => parseArguments([]), /Uso:/);
  const results = await behindAdminLock(() => f.users.map((user) => bootstrapAdmin({
    sql: wrappedSql, userId: user.id, operator: 'Synthetic operator', reason: 'Synthetic first-administrator setup',
  }).then((value) => ({ status: 200, value }), (error) => ({ status: error.status, code: error.publicCode }))));
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  assert.equal(results.find((result) => result.status === 409).code, 'ADMIN_EXISTS');
  const events = await sql`SELECT actor_id, actor_label, action, before_state, after_state FROM audit_events WHERE target_id IN (${f.users[0].id}, ${f.users[1].id})`;
  assert.equal(events.length, 1);
  assert.equal(events[0].actor_id, null);
  assert.equal(events[0].actor_label, 'Synthetic operator');
  assert.equal(events[0].action, 'admin.bootstrap');
  assert.equal(events[0].after_state.role, 'admin');
  assert.equal(Object.hasOwn(events[0].after_state, 'password_hash'), false);
});

test('ADM-03 bootstrap CLI targets only the explicitly selected test database; audit failure grants nothing', async (t) => {
  const f = await fixture(t, ['member']);
  failAudit = true;
  try {
    await assert.rejects(bootstrapAdmin({ sql: wrappedSql, userId: f.users[0].id, operator: 'Synthetic operator', reason: 'Synthetic rollback' }));
  } finally { failAudit = false; }
  const before = await sql`SELECT role, auth_version, version FROM users WHERE id = ${f.users[0].id}`;
  assert.deepEqual(before[0], { role: 'member', auth_version: 1, version: 1 });
  const args = [path.join(ROOT, 'scripts/bootstrap-admin.js'), '--user-id', f.users[0].id,
    '--operator', 'Synthetic CLI operator', '--reason', 'Synthetic CLI bootstrap', '--database-name', 'eterverso_test'];
  const output = execFileSync(process.execPath, args, {
    cwd: ROOT, env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.match(output, /Administrador inicial configurado/);
  assert.equal(output.includes(databaseUrl), false);
  const after = await sql`SELECT role, auth_version, version FROM users WHERE id = ${f.users[0].id}`;
  assert.deepEqual(after[0], { role: 'admin', auth_version: 2, version: 2 });
  await assert.rejects(bootstrapAdmin({ sql, userId: f.users[0].id, operator: 'Synthetic operator', reason: 'No second bootstrap' }),
    (error) => error.publicCode === 'ADMIN_EXISTS');
});

async function fixture(t, roles) {
  const active = await sql`SELECT count(*)::integer AS count FROM users WHERE role = 'admin' AND disabled_at IS NULL`;
  assert.equal(active[0].count, 0, 'Admin invariants require serialized isolated fixtures, not concurrent suites.');
  const f = { users: [], categoryIds: [], suffix: randomUUID().slice(0, 8) };
  t.after(async () => {
    failAudit = false;
    for (const user of f.users) {
      await sql`DELETE FROM audit_events WHERE actor_id = ${user.id} OR target_id = ${user.id}`;
    }
    for (const id of f.categoryIds) {
      await sql`DELETE FROM audit_events WHERE target_id = ${id}`;
      await sql`DELETE FROM categories WHERE id = ${id}`;
    }
    for (const user of f.users) await sql`DELETE FROM users WHERE id = ${user.id}`;
  });
  for (let index = 0; index < roles.length; index += 1) {
    const username = `admin-fixture-${f.suffix}-${index}`;
    const users = await sql`INSERT INTO users (username, email, password_hash, role)
      VALUES (${username}, ${`${username}@example.test`}, 'test-only-hash', ${roles[index]}) RETURNING id`;
    f.users.push({ id: users[0].id, role: roles[index] });
  }
  return f;
}

async function sessionFor(id) {
  const response = await fetch(`${baseUrl}/__fixture/session/${id}`);
  assert.equal(response.status, 200);
  return { cookie: response.headers.getSetCookie().map((value) => value.split(';', 1)[0]).join('; '),
    csrfToken: (await response.json()).csrfToken };
}
async function request(session, route, { method = 'GET', body } = {}) {
  const response = await fetch(`${baseUrl}/api/admin${route}`, {
    method, headers: {
      ...(session ? { cookie: session.cookie, 'x-csrf-token': session.csrfToken } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json(), cookies: response.headers.getSetCookie() };
}
async function protectedRead(session) {
  const response = await fetch(`${baseUrl}/__fixture/protected`, { headers: { cookie: session.cookie } });
  return { status: response.status };
}
async function behindAdminLock(actions) {
  let release;
  let held;
  const unlocked = new Promise((resolve) => { release = resolve; });
  const acquired = new Promise((resolve) => { held = resolve; });
  const holder = sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${ADMIN_SET_LOCK[0]}, ${ADMIN_SET_LOCK[1]})`;
    held();
    await unlocked;
  });
  await acquired;
  let pending = [];
  try {
    pending = actions();
    const deadline = Date.now() + 15_000;
    for (;;) {
      const waiting = await sql`SELECT count(*)::integer AS count FROM pg_locks
        WHERE locktype = 'advisory' AND classid = ${ADMIN_SET_LOCK[0]}::oid AND objid = ${ADMIN_SET_LOCK[1]}::oid
          AND objsubid = 2 AND NOT granted`;
      if (waiting[0].count >= 2) break;
      assert.ok(Date.now() < deadline, 'Both operations must reach the shared advisory lock barrier.');
      await nextTurn();
    }
    release();
    await holder;
    return await Promise.all(pending);
  } finally {
    release();
    await holder;
    await Promise.allSettled(pending);
  }
}
