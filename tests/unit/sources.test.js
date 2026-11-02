'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { errorMiddleware } = require('../../server/errors');
const { createSourceRouter } = require('../../server/sources');

const SOURCE_ID = '123e4567-e89b-42d3-a456-426614174000';
const REVISION_ID = '223e4567-e89b-42d3-a456-426614174000';
const SECTION_ID = '323e4567-e89b-42d3-a456-426614174000';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function sourceRow(overrides = {}) {
  const content = overrides.content || 'Synthetic source text only.';
  return {
    id: SOURCE_ID,
    archive_sha256: HASH_A,
    relative_path: 'lore/synthetic-source.md',
    file_sha256: sha256(content),
    family: 'Synthetic lore',
    language: 'pt-BR',
    declared_version: 'v1',
    declared_date: null,
    content,
    imported_by: '423e4567-e89b-42d3-a456-426614174000',
    created_at: '2026-10-20T00:00:00.000Z',
    ...overrides,
  };
}

function mockSql(handler) {
  return (strings, ...values) => Promise.resolve(handler(strings.join('?'), values));
}

function createHarness(sql) {
  const auth = {
    requireIdentity(req, res, next) {
      const role = req.headers['x-test-role'];
      if (!role) return res.status(401).json({ error: 'Sign-in required.', code: 'UNAUTHENTICATED' });
      req.authUser = { role };
      return next();
    },
    requireRole(...roles) {
      return (req, res, next) => roles.includes(req.authUser?.role)
        ? next()
        : res.status(403).json({ error: 'Forbidden.', code: 'FORBIDDEN' });
    },
  };
  const router = createSourceRouter({ sql, auth });
  const mount = router.stack.find((layer) => layer.handle && Array.isArray(layer.handle.stack));
  assert.ok(mount, 'source routes should be mounted under a nested staff router');
  const staff = mount.handle;
  const routeLayers = staff.stack.filter((layer) => layer.route);
  return { router, staff, routeLayers };
}

function response() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

async function invoke(harness, method, path, reqOverrides = {}) {
  const req = {
    method,
    path,
    params: {},
    query: {},
    headers: {},
    ...reqOverrides,
  };
  const res = response();
  for (const layer of harness.staff.stack.filter((item) => !item.route)) {
    let calledNext = false;
    let middlewareError;
    layer.handle(req, res, (error) => { calledNext = true; middlewareError = error; });
    if (middlewareError) throw middlewareError;
    if (!calledNext) return { req, res };
  }

  const layer = harness.routeLayers.find((item) => (
    item.route.path === path && item.route.methods[String(method).toLowerCase()]
  ));
  if (!layer) return { req, res: res.status(404).json({ error: 'Not found.', code: 'NOT_FOUND' }) };
  let routeError;
  await layer.route.stack[0].handle(req, res, (error) => { routeError = error; });
  if (routeError) errorMiddleware(routeError, req, res, () => {});
  return { req, res };
}

test('source routes are mounted only below the staff namespace and reject public or non-staff callers', async () => {
  let queryCount = 0;
  const harness = createHarness(mockSql(() => { queryCount += 1; return []; }));
  assert.equal(harness.router.stack.length, 1);
  assert.equal(harness.routeLayers.length, 3);
  assert.deepEqual(harness.routeLayers.map((layer) => layer.route.path).sort(), ['/', '/:id', '/:id/locators']);
  assert.equal(harness.router.stack.some((layer) => layer.route), false);

  const anonymous = await invoke(harness, 'GET', '/:id', { params: { id: SOURCE_ID } });
  assert.equal(anonymous.res.statusCode, 401);
  const member = await invoke(harness, 'GET', '/', { headers: { 'x-test-role': 'member' } });
  assert.equal(member.res.statusCode, 403);
  assert.equal(harness.router.stack.some((layer) => layer.match('/wiki/sources')), false,
    'public wiki source paths do not match the staff-only mount');
  assert.equal(queryCount, 0, 'unauthorized and public requests never query source content');
});

test('staff manifest returns only bounded source metadata and stable pagination', async () => {
  let captured;
  const rows = [sourceRow(), sourceRow({ id: REVISION_ID, relative_path: 'lore/second.md' }), sourceRow({ id: SECTION_ID, relative_path: 'lore/third.md' })];
  const harness = createHarness(mockSql((query, values) => {
    captured = { query, values };
    return rows;
  }));
  const { res } = await invoke(harness, 'GET', '/', {
    headers: { 'x-test-role': 'admin' },
    query: { limit: '2', offset: '4' },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.page.limit, 2);
  assert.equal(res.body.page.offset, 4);
  assert.equal(res.body.page.hasMore, true);
  assert.equal(res.body.data.length, 2);
  assert.deepEqual(Object.keys(res.body.data[0]).sort(), [
    'archiveSha256', 'declaredDate', 'declaredVersion', 'family', 'fileSha256', 'id', 'language', 'relativePath',
  ]);
  assert.equal(res.body.data[0].relativePath, 'lore/synthetic-source.md');
  assert.equal('content' in res.body.data[0], false);
  assert.equal('importedBy' in res.body.data[0], false);
  assert.equal('createdAt' in res.body.data[0], false);
  assert.doesNotMatch(captured.query, /SELECT[^]*content/i);
  assert.deepEqual(captured.values, [3, 4]);
});

test('staff source text returns its manifest fields and content without server paths or importer identity', async () => {
  const harness = createHarness(mockSql(() => [sourceRow()]));
  const { res } = await invoke(harness, 'GET', '/:id', {
    headers: { 'x-test-role': 'moderador' },
    params: { id: SOURCE_ID },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(Object.keys(res.body.data).sort(), [
    'archiveSha256', 'content', 'declaredDate', 'declaredVersion', 'family', 'fileSha256', 'id', 'language', 'relativePath',
  ]);
  assert.equal(res.body.data.content, 'Synthetic source text only.');
  assert.equal(res.body.data.relativePath, 'lore/synthetic-source.md');
  assert.equal(Object.hasOwn(res.body.data, 'absolutePath'), false);
  assert.equal(Object.hasOwn(res.body.data, 'filesystemPath'), false);
  assert.equal(Object.hasOwn(res.body.data, 'importedBy'), false);
  assert.equal(Object.hasOwn(res.body.data, 'createdAt'), false);
});

test('staff source text refuses a manifest hash that does not match the stored UTF-8 bytes', async () => {
  const harness = createHarness(mockSql(() => [sourceRow({ file_sha256: HASH_B })]));
  const { res } = await invoke(harness, 'GET', '/:id', {
    headers: { 'x-test-role': 'admin' },
    params: { id: SOURCE_ID },
  });
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { error: 'Erro interno.', code: 'INTERNAL_ERROR' });
  assert.equal(JSON.stringify(res.body).includes('Synthetic source text only.'), false);
});

test('staff source locators expose only citation identifiers and bounded locator text', async () => {
  let calls = 0;
  const harness = createHarness(mockSql((query) => {
    calls += 1;
    if (query.includes('FROM wiki_sources')) return [{ id: SOURCE_ID }];
    return [
      { revision_id: REVISION_ID, section_id: SECTION_ID, locator: 'synthetic lines 2–4' },
      { revision_id: SOURCE_ID, section_id: REVISION_ID, locator: 'synthetic heading' },
    ];
  }));
  const { res } = await invoke(harness, 'GET', '/:id/locators', {
    headers: { 'x-test-role': 'admin' },
    params: { id: SOURCE_ID },
    query: { limit: '1' },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    data: [{ revisionId: REVISION_ID, sectionId: SECTION_ID, locator: 'synthetic lines 2–4' }],
    page: { limit: 1, offset: 0, hasMore: true },
  });
  assert.equal(calls, 2);
});

test('source IDs and pagination reject malformed values before querying', async () => {
  let queryCount = 0;
  const harness = createHarness(mockSql(() => { queryCount += 1; return []; }));
  const malformedRequests = [
    { path: '/:id', params: { id: 'not-a-uuid' } },
    { path: '/', query: { limit: '01' } },
    { path: '/', query: { limit: '101' } },
    { path: '/', query: { offset: '-1' } },
    { path: '/', query: { offset: '1.5' } },
    { path: '/', query: { limit: ['1', '2'] } },
    { path: '/', query: { limit: '2', content: 'true' } },
  ];
  for (const request of malformedRequests) {
    const { res } = await invoke(harness, 'GET', request.path, {
      headers: { 'x-test-role': 'admin' },
      ...request,
    });
    assert.equal(res.statusCode, 400, request.path);
  }
  assert.equal(queryCount, 0);
});
