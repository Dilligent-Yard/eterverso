'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  adminUser,
  createAuth,
  createCookieSessionOptions,
  publicAuthor,
  selfUser,
} = require('../../server/auth');
const sharedDto = require('../../server/dto');

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_USER_ID = '22222222-2222-4222-8222-222222222222';
const USER = {
  id: USER_ID,
  username: 'Aria',
  email: 'aria@example.test',
  avatar: '/avatar.png',
  title: 'Membro',
  bio: 'Perfil de teste',
  role: 'admin',
  posts_count: 4,
  join_date: '2026-10-19',
  disabled_at: null,
  auth_version: 3,
  version: 2,
};

function mockSql(handler) {
  const sql = function (strings, ...values) {
    return handler(strings.join('?'), values);
  };
  sql.json = (value) => JSON.stringify(value);
  sql.begin = async (callback) => callback(sql);
  return sql;
}

function request(method = 'GET', session = {}, headers = {}) {
  const normalized = Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
  return {
    method,
    session,
    headers: normalized,
    get(name) { return normalized[name.toLowerCase()]; },
  };
}

function response() {
  return {
    statusCode: undefined,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function sessionFor(user = USER) {
  return { userId: user.id, authVersion: user.auth_version, csrfToken: 'A'.repeat(43) };
}

test('cookie options and authenticated session contain no role or unrelated fields', () => {
  const cookieOptions = createCookieSessionOptions({ sessionSecret: 'test-secret', secureCookies: true });
  assert.deepEqual(cookieOptions, {
    name: 'eterverso_session',
    keys: ['test-secret'],
    maxAge: 30 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
  });

  const auth = createAuth({ sql: mockSql(() => []), config: { publicOrigin: 'https://eterverso.test' } });
  const req = request('POST', { role: 'admin', arbitrary: 'discarded' });
  const token = auth.issueSession(req, USER);
  assert.deepEqual(Object.keys(req.session).sort(), ['authVersion', 'csrfToken', 'userId']);
  assert.equal(req.session.userId, USER_ID);
  assert.equal(req.session.authVersion, USER.auth_version);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(req.session.role, 'admin');
});

test('CSRF token is session-bound and unsafe requests check Origin and Fetch Metadata', () => {
  const auth = createAuth({ sql: mockSql(() => []), config: { publicOrigin: 'https://eterverso.test' } });
  const req = request('GET');
  const token = auth.csrfTokenForSession(req);
  assert.equal(req.session.csrfToken, token);
  assert.deepEqual(Object.keys(req.session), ['csrfToken']);

  let nextCalls = 0;
  const res = response();
  const valid = request('POST', { csrfToken: token }, {
    Origin: 'https://eterverso.test',
    'Sec-Fetch-Site': 'same-origin',
    'X-CSRF-Token': token,
  });
  auth.csrfProtection(valid, res, () => { nextCalls += 1; });
  assert.equal(nextCalls, 1);

  const wrongOrigin = request('POST', { csrfToken: token }, {
    Origin: 'https://attacker.test',
    'X-CSRF-Token': token,
  });
  const originRes = response();
  auth.csrfProtection(wrongOrigin, originRes, () => { nextCalls += 1; });
  assert.equal(originRes.statusCode, 403);
  assert.equal(originRes.body.code, 'ORIGIN_FORBIDDEN');

  const crossSite = request('POST', { csrfToken: token }, {
    'Sec-Fetch-Site': 'cross-site',
    'X-CSRF-Token': token,
  });
  const fetchRes = response();
  auth.csrfProtection(crossSite, fetchRes, () => { nextCalls += 1; });
  assert.equal(fetchRes.statusCode, 403);

  const missingToken = request('POST', { csrfToken: token }, { 'X-CSRF-Token': 'B'.repeat(43) });
  const csrfRes = response();
  auth.csrfProtection(missingToken, csrfRes, () => { nextCalls += 1; });
  assert.equal(csrfRes.statusCode, 403);
  assert.equal(csrfRes.body.code, 'CSRF_INVALID');
  assert.equal(nextCalls, 1);

  const malformedOrigin = request('POST', { csrfToken: token }, {
    Origin: 'https://eterverso.test/unexpected-path',
    'X-CSRF-Token': token,
  });
  const malformedOriginRes = response();
  auth.csrfProtection(malformedOrigin, malformedOriginRes, () => { nextCalls += 1; });
  assert.equal(malformedOriginRes.statusCode, 403);
  assert.equal(nextCalls, 1);
});

test('production auth configuration requires an explicit public origin', () => {
  assert.throws(() => createAuth({
    sql: mockSql(() => []),
    config: { production: true },
  }), /explicit publicOrigin/);
});

test('identity is re-read from SQL and cookie role claims are discarded', async () => {
  const queries = [];
  const auth = createAuth({
    sql: mockSql((query) => { queries.push(query); return [USER]; }),
    config: { publicOrigin: 'https://eterverso.test' },
  });
  const req = request('GET', { ...sessionFor(), role: 'member', isAdmin: true });
  const res = response();
  let nextCalls = 0;
  await auth.requireIdentity(req, res, () => { nextCalls += 1; });

  assert.equal(nextCalls, 1);
  assert.equal(req.authUser.role, 'admin');
  assert.equal(req.authUser.email, USER.email);
  assert.equal(req.session.role, undefined);
  assert.equal(req.session.isAdmin, undefined);
  assert.match(queries[0], /disabled_at, auth_version, version/);
  assert.match(queries[0], /FROM users WHERE id = \?/);
});

test('legacy, disabled, and auth-version-mismatched sessions require login', async (context) => {
  const cases = [
    { name: 'legacy cookie without auth version', session: { userId: USER_ID, csrfToken: 'A'.repeat(43) }, row: USER },
    { name: 'disabled account', session: sessionFor(), row: { ...USER, disabled_at: new Date() } },
    { name: 'revoked auth version', session: sessionFor(), row: { ...USER, auth_version: 4 } },
    { name: 'missing account', session: sessionFor(), row: undefined },
  ];
  for (const item of cases) {
    await context.test(item.name, async () => {
      const auth = createAuth({ sql: mockSql(() => item.row ? [item.row] : []), config: {} });
      const req = request('GET', { ...item.session });
      const res = response();
      let nextCalls = 0;
      await auth.requireIdentity(req, res, () => { nextCalls += 1; });
      assert.equal(nextCalls, 0);
      assert.equal(res.statusCode, 401);
      assert.equal(res.body.code, 'UNAUTHENTICATED');
      if (item.name === 'legacy cookie without auth version') {
        assert.equal(req.session.userId, undefined);
        assert.equal(req.session.authVersion, undefined);
        assert.equal(typeof req.session.csrfToken, 'string');
      } else {
        assert.equal(req.session, null);
      }
    });
  }
});

test('privileged transaction locks and revalidates the actor before callback', async () => {
  const statements = [];
  const order = [];
  const tx = mockSql((query) => {
    order.push('actor-row');
    statements.push(query);
    return [{ id: USER_ID, username: 'Aria', role: 'admin', disabled_at: null, auth_version: 3, version: 2 }];
  });
  const sql = mockSql(() => []);
  sql.begin = async (callback) => callback(tx);
  const auth = createAuth({ sql, config: {} });
  const req = request('POST', sessionFor());
  let callbackActor;
  const result = await auth.withActorTransaction(req, async (transaction, actor) => {
    assert.equal(transaction, tx);
    order.push('mutation-callback');
    callbackActor = actor;
    return 'saved';
  }, { beforeActorLock: async (transaction) => {
    assert.equal(transaction, tx);
    order.push('admin-set-lock');
  } });

  assert.equal(result, 'saved');
  assert.equal(callbackActor.role, 'admin');
  assert.match(statements[0], /FOR UPDATE/);
  assert.deepEqual(order, ['admin-set-lock', 'actor-row', 'mutation-callback']);

  const revokedSql = mockSql((query) => {
    statements.push(query);
    return [{ id: USER_ID, username: 'Aria', role: 'admin', disabled_at: null, auth_version: 4, version: 3 }];
  });
  revokedSql.begin = async (callback) => callback(revokedSql);
  const revokedAuth = createAuth({ sql: revokedSql, config: {} });
  const revokedReq = request('POST', sessionFor());
  let called = false;
  await assert.rejects(
    revokedAuth.withActorTransaction(revokedReq, async () => { called = true; }),
    { status: 401, publicCode: 'UNAUTHENTICATED' },
  );
  assert.equal(called, false);
  assert.equal(revokedReq.session, null);
});

test('user DTOs expose only their intended audience fields', () => {
  assert.deepEqual(publicAuthor(USER), {
    id: USER_ID,
    username: 'Aria',
    avatar: '/avatar.png',
    title: 'Membro',
    role: 'admin',
  });
  assert.equal(selfUser(USER).email, USER.email);
  assert.equal('email' in publicAuthor(USER), false);
  assert.deepEqual(adminUser({ ...USER, password_hash: 'never-return' }), {
    id: USER_ID,
    username: 'Aria',
    email: 'aria@example.test',
    role: 'admin',
    disabledAt: null,
    version: 2,
    joinDate: '2026-10-19',
  });
  assert.equal('password_hash' in adminUser({ ...USER, password_hash: 'never-return' }), false);
});

test('auth re-exports the shared DTO implementations', () => {
  assert.equal(selfUser, sharedDto.selfUser);
  assert.equal(publicAuthor, sharedDto.publicAuthor);
  assert.equal(adminUser, sharedDto.adminUser);
});
