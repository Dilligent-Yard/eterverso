'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const sourcePath = path.join(__dirname, '..', '..', 'client', 'api.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const bundleSource = fs.readFileSync(path.join(__dirname, '..', '..', 'generated', 'client', 'vault.js'), 'utf8');
const TOKEN_A = 'a'.repeat(43);
const TOKEN_B = 'b'.repeat(43);
const TOKEN_C = 'c'.repeat(43);
const TOKEN_D = 'd'.repeat(43);

function response(status, data) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  };
}

function invalidJsonResponse(status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => { throw new SyntaxError('private parse details'); },
  };
}

function loadApi(fetch) {
  const window = {
    Aetherverse: { existingExport: true },
    fetch,
    location: { href: 'http://localhost:3000/forum' },
  };
  const context = { window, URL, Promise, Error, setTimeout };
  vm.runInNewContext(bundleSource, context, { filename: 'vault.js' });
  const globalsBefore = Object.keys(context).sort();
  vm.runInNewContext(source, context, { filename: 'client/api.js' });
  assert.deepEqual(Object.keys(context).sort(), globalsBefore, 'script should not add global exports');
  return window.Aetherverse;
}

function makeFetch(handler) {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    return handler(url, options, calls.length);
  };
  return { fetch, calls };
}

function callbackRecorder() {
  const calls = [];
  return {
    calls,
    callback: (error, data) => calls.push([error, data]),
  };
}

function plain(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

test('unsafe requests acquire one in-memory CSRF token and send it with optional idempotency headers', async () => {
  const { fetch, calls } = makeFetch((url) => {
    if (url === '/api/auth/csrf') return response(200, { csrfToken: TOKEN_A });
    return response(201, { data: { id: 'created' } });
  });
  const api = loadApi(fetch);
  const callback = callbackRecorder();
  const data = await api.apiRequest('POST', '/api/forum/topics', { title: 'Teste' }, callback.callback, {
    headers: { 'Idempotency-Key': '11111111-1111-4111-8111-111111111111' },
  });
  await api.apiRequest('PUT', '/api/forum/topics/created', { title: 'Atualizado' }, () => {});

  assert.deepEqual(data, { data: { id: 'created' } });
  assert.deepEqual(callback.calls, [[null, data]]);
  assert.equal(calls.length, 3, 'the cached token should avoid a second CSRF fetch');
  assert.equal(calls[0].url, '/api/auth/csrf');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.credentials, 'same-origin');
  assert.equal(calls[1].options.credentials, 'same-origin');
  assert.equal(calls[1].options.headers['X-CSRF-Token'], TOKEN_A);
  assert.equal(calls[1].options.headers['Idempotency-Key'], '11111111-1111-4111-8111-111111111111');
  assert.equal(calls[2].options.headers['X-CSRF-Token'], TOKEN_A);
});

test('password change invalidates the cached CSRF token before the next write', async () => {
  let tokenRequests = 0;
  const { fetch, calls } = makeFetch((url) => {
    if (url === '/api/auth/csrf') {
      tokenRequests += 1;
      return response(200, { csrfToken: [TOKEN_A, TOKEN_B, TOKEN_C][tokenRequests - 1] });
    }
    if (url === '/api/auth/profile') return response(200, { csrfToken: TOKEN_B, user: { id: 'u-1', username: 'Ana', role: 'member' } });
    return response(200, { ok: true });
  });
  const api = loadApi(fetch);

  await api.apiRequest('POST', '/api/auth/login', { username: 'ana', password: 'private' });
  await api.apiRequest('PUT', '/api/auth/profile', { currentPassword: 'private', newPassword: 'rotated' });
  await api.apiRequest('POST', '/api/forum/threads', { content: 'depois da troca' });

  assert.equal(tokenRequests, 3);
  assert.deepEqual(calls.filter((call) => call.options.method !== 'GET').map((call) => call.options.headers['X-CSRF-Token']), [TOKEN_A, TOKEN_B, TOKEN_C]);
});

test('successful login, signup, and logout rotate CSRF state; logout clears the in-memory user', async () => {
  const tokens = [TOKEN_A, TOKEN_B, TOKEN_C, TOKEN_D];
  let csrfRequests = 0;
  const { fetch, calls } = makeFetch((url) => {
    if (url === '/api/auth/csrf') {
      const token = tokens[csrfRequests++];
      return response(200, { csrfToken: token });
    }
    if (url === '/api/auth/login') return response(200, { user: { id: 'u-1', username: 'Ana', role: 'member' } });
    if (url === '/api/auth/signup') return response(201, { user: { id: 'u-2', username: 'Bia', role: 'moderador' } });
    return response(200, { ok: true });
  });
  const api = loadApi(fetch);

  await api.apiRequest('POST', '/api/auth/login', { username: 'ana', password: 'never-persist-this' });
  assert.deepEqual(plain(api.getSessionUser()), { id: 'u-1', username: 'Ana', role: 'member' });
  await api.apiRequest('POST', '/api/auth/signup', { username: 'bia', password: 'never-persist-this' });
  assert.deepEqual(plain(api.getSessionUser()), { id: 'u-2', username: 'Bia', role: 'moderador' });
  await api.apiRequest('POST', '/api/auth/logout', {});
  assert.equal(api.getSessionUser(), null);
  await api.apiRequest('POST', '/api/forum/topics', { title: 'Depois do logout' });

  assert.equal(csrfRequests, 4, 'each successful auth endpoint must invalidate the cached CSRF token');
  const unsafeCalls = calls.filter((call) => call.options.method !== 'GET');
  assert.deepEqual(unsafeCalls.map((call) => call.options.headers['X-CSRF-Token']), [TOKEN_A, TOKEN_B, TOKEN_C, TOKEN_D]);
  assert.equal(calls[calls.length - 1].options.headers['X-CSRF-Token'], TOKEN_D);
});

test('non-2xx responses pass through a bounded public Portuguese error and call back once', async () => {
  const { fetch } = makeFetch((url) => url === '/api/auth/csrf'
    ? response(200, { csrfToken: TOKEN_A })
    : response(409, { error: 'Esse nome já está em uso.', details: { password: 'secret' } }));
  const api = loadApi(fetch);
  const callback = callbackRecorder();

  await assert.rejects(
    api.apiRequest('POST', '/api/forum/topics', { title: 'Duplicado' }, callback.callback),
    { message: 'Esse nome já está em uso.' },
  );
  assert.deepEqual(callback.calls, [['Esse nome já está em uso.', undefined]]);
});

test('invalid JSON and network failures return safe Portuguese callback errors exactly once', async (t) => {
  await t.test('invalid JSON response', async () => {
    const api = loadApi(async () => invalidJsonResponse());
    const callback = callbackRecorder();
    await assert.rejects(
      api.apiRequest('GET', '/api/auth/me', undefined, callback.callback),
      { message: 'Resposta inválida do servidor.' },
    );
    assert.deepEqual(callback.calls, [['Resposta inválida do servidor.', undefined]]);
  });

  await t.test('network failure', async () => {
    const api = loadApi(async () => { throw new Error('private SQL and DSN details'); });
    const callback = callbackRecorder();
    await assert.rejects(
      api.apiRequest('GET', '/api/auth/me', undefined, callback.callback),
      { message: 'Não foi possível conectar ao servidor. Tente novamente.' },
    );
    assert.deepEqual(callback.calls, [['Não foi possível conectar ao servidor. Tente novamente.', undefined]]);
  });
});

test('CSRF acquisition failure stops the write and reports only a safe Portuguese message', async () => {
  const { fetch, calls } = makeFetch(() => response(503, { error: 'Não foi possível validar a sessão.' }));
  const api = loadApi(fetch);
  const callback = callbackRecorder();

  await assert.rejects(
    api.apiRequest('DELETE', '/api/forum/topics/1', undefined, callback.callback),
    { message: 'Não foi possível validar a sessão.' },
  );
  assert.equal(calls.length, 1, 'the unsafe request must not run without a CSRF token');
  assert.deepEqual(callback.calls, [['Não foi possível validar a sessão.', undefined]]);
});

test('session profiles stay in memory, are copied on read, and exclude credentials and unknown fields', () => {
  const api = loadApi(async () => response(200, {}));
  const returned = api.setSessionUser({
    id: 'u-1',
    username: 'Ana',
    email: 'ana@example.test',
    role: 'admin',
    posts: 5,
    password: 'secret',
    csrfToken: TOKEN_A,
    authVersion: 2,
    customField: 'discard me',
  });

  assert.deepEqual(plain(returned), {
    id: 'u-1', username: 'Ana', email: 'ana@example.test', role: 'admin', posts: 5,
  });
  returned.username = 'Changed outside';
  assert.equal(api.getSessionUser().username, 'Ana');
  api.clearSessionUser();
  assert.equal(api.getSessionUser(), null);
  assert.doesNotMatch(source, /localStorage|sessionStorage/);
});

test('only the Aetherverse namespace receives the public API exports', () => {
  const api = loadApi(async () => response(200, {}));
  assert.equal(api.existingExport, true);
  assert.deepEqual(
    Object.keys(api).filter((key) => key !== 'existingExport').sort(),
    ['apiRequest', 'clearSessionUser', 'getSessionUser', 'setSessionUser'],
  );
});

test('API errors preserve bounded public status/code for conflict handling without changing callback messages', async () => {
  const api = loadApi(async () => response(409, { error: 'A prévia mudou.', code: 'WIKI_ARTICLE_FILE_PREVIEW_STALE', privateDetail: 'must stay private' }));
  await assert.rejects(api.apiRequest('GET', '/api/staff/wiki/pages'), error => error.status === 409 && error.code === 'WIKI_ARTICLE_FILE_PREVIEW_STALE' && !JSON.stringify(error).includes('must stay private'));
  const callback = callbackRecorder();
  await assert.rejects(api.apiRequest('GET', '/api/staff/wiki/pages', undefined, callback.callback), error => error.code === 'WIKI_ARTICLE_FILE_PREVIEW_STALE');
  assert.deepEqual(callback.calls, [['A prévia mudou.', undefined]]);
  const unsafe = loadApi(async () => response(400, { error: 'Erro público.', code: 'invalid\nprivate' }));
  await assert.rejects(unsafe.apiRequest('GET', '/api/wiki/pages'), error => error.status === 400 && error.code === undefined);
});

test('a stale 401 cannot clear a session established after the request started', async () => {
  let resolveResponse;
  const api = loadApi((url) => new Promise((resolve) => {
    resolveResponse = () => resolve(response(401, { error: 'Sessão antiga.' }));
  }));
  api.setSessionUser({ id: 'user-a', username: 'Ana', role: 'member' });
  const pending = api.apiRequest('GET', '/api/private').catch((error) => error);
  await Promise.resolve();
  await Promise.resolve();
  api.setSessionUser({ id: 'user-b', username: 'Bia', role: 'member' });
  resolveResponse();
  const error = await pending;

  assert.equal(error.status, 401);
  assert.equal(api.getSessionUser().id, 'user-b', 'the new session must survive an old request failure');
});

test('a current 401 still expires the active session', async () => {
  const api = loadApi(async () => response(401, { error: 'Sessão atual.' }));
  api.setSessionUser({ id: 'user-b', username: 'Bia', role: 'member' });

  await assert.rejects(api.apiRequest('GET', '/api/private'), (error) => error.status === 401);
  assert.equal(api.getSessionUser(), null);
});

test('a stale login success cannot replace a session established later', async () => {
  let resolveLogin;
  const api = loadApi((url) => {
    if (String(url).endsWith('/api/auth/csrf')) return Promise.resolve(response(200, { csrfToken: TOKEN_A }));
    return new Promise((resolve) => {
      resolveLogin = () => resolve(response(200, { user: { id: 'user-a', username: 'Ana', role: 'member' } }));
    });
  });
  api.setSessionUser({ id: 'user-b', username: 'Bia', role: 'member' });
  const pending = api.apiRequest('POST', '/api/auth/login', { username: 'Ana', password: 'synthetic-password' });
  await new Promise((resolve) => setImmediate(resolve));
  api.setSessionUser({ id: 'user-b', username: 'Bia', role: 'member' });
  resolveLogin();
  await pending;
  assert.equal(api.getSessionUser().id, 'user-b', 'the newer login must survive a stale login response');
});
