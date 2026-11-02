'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const path = require('node:path');
const express = require('express');
const cookieSession = require('cookie-session');
const postgres = require('postgres');
const { createAuth, createCookieSessionOptions } = require('../../server/auth');
const { errorMiddleware } = require('../../server/errors');
const { createWikiRouter } = require('../../server/wiki');
const { createWikiTransfersRouter } = require('../../server/wiki-transfers');

const ROOT = path.resolve(__dirname, '../..');
const testDatabaseUrl = process.env.ETERVERSO_TEST_DATABASE_URL;
const SOURCE_TEXT = 'Synthetic cited source for transfer tests.\n';

let sql;
let server;
let baseUrl;
let auth;

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
  const identity = await sql`SELECT current_database() AS database, current_user AS username`;
  assert.equal(identity[0].database, 'eterverso_test');
  assert.equal(identity[0].username, 'eterverso_test');
  const config = { sessionSecret: `wiki-transfers-${randomUUID()}`, secureCookies: false };
  auth = createAuth({ sql, config });
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use(cookieSession(createCookieSessionOptions(config)));
  app.use(auth.csrfProtection);
  app.get('/__fixture/session/:id', async (req, res, next) => {
    try {
      const users = await sql`
        SELECT id, auth_version FROM users
        WHERE id = ${req.params.id} AND disabled_at IS NULL LIMIT 1`;
      if (!users.length) return res.status(404).json({ error: 'Fixture account not found.' });
      return res.json({ csrfToken: auth.issueSession(req, users[0]) });
    } catch (error) { return next(error); }
  });
  app.use('/api/admin/wiki-transfers', createWikiTransfersRouter({ sql, auth }));
  app.use('/api', createWikiRouter({ sql, auth }));
  app.use(errorMiddleware);
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (sql) await sql.end({ timeout: 5 });
});

test('WIKI-TRANSFER export is admin-only and includes only selected pages, cited locators, and referenced sources', async (t) => {
  const fixture = await makeFixture(t);
  const source = await seedSourceAndPage(fixture);
  await seedUnreferencedSource(fixture);
  const admin = await sessionFor(fixture.users.admin.id);
  const moderator = await sessionFor(fixture.users.moderador.id);
  const member = await sessionFor(fixture.users.member.id);

  assert.equal((await request(null, `/admin/wiki-transfers/imports/${randomUUID()}`)).status, 401);
  assert.equal((await request(member, '/admin/wiki-transfers/export', {
    method: 'POST', body: { pageIds: [source.pageId] },
  })).status, 403);
  assert.equal((await request(moderator, '/admin/wiki-transfers/export', {
    method: 'POST', body: { pageIds: [source.pageId] },
  })).status, 403);

  const exportResponse = await requestRaw(admin, '/admin/wiki-transfers/export', {
    method: 'POST', body: { pageIds: [source.pageId] },
  });
  assert.equal(exportResponse.status, 200, exportResponse.text);
  assert.match(exportResponse.headers.get('content-disposition'), /aetherverse-wiki-bundle-v1\.json/);
  const bundle = JSON.parse(exportResponse.text);
  assert.equal(bundle.format, 'AetherverseWikiBundleV1');
  assert.equal(bundle.pages.length, 1);
  assert.equal(bundle.pages[0].sourcePageId, source.pageId);
  assert.equal(bundle.pages[0].sourceRevisionId, source.revisionId);
  assert.deepEqual(bundle.pages[0].citations, [{
    sectionId: source.sectionId,
    sourceId: source.sourceId,
    locator: 'section 1, paragraph 2',
  }]);
  assert.deepEqual(bundle.sources.map((item) => item.sourceId), [source.sourceId]);
  assert.equal(bundle.sources[0].content, SOURCE_TEXT);
  assert.equal(bundle.sources[0].fileSha256, sha256(Buffer.from(SOURCE_TEXT, 'utf8')));
  assert.equal(bundle.sources[0].relativePath, 'synthetic/source.txt');
  assertNoAccountFields(bundle);
  assert.doesNotMatch(JSON.stringify(bundle), new RegExp(escapeRegExp(fixture.users.member.id), 'i'));
});

test('WIKI-TRANSFER export captures page heads, citations, and sources in one repeatable-read snapshot', async (t) => {
  const fixture = await makeFixture(t);
  const source = await seedSourceAndPage(fixture);
  const admin = await sessionFor(fixture.users.admin.id);
  const original = auth.withActorTransaction;
  let observedIsolation;
  auth.withActorTransaction = (req, callback, options = {}) => original(req, callback, {
    ...options,
    beforeActorLock: async (tx) => {
      if (options.beforeActorLock) await options.beforeActorLock(tx);
      const rows = await tx`SHOW transaction_isolation`;
      observedIsolation = rows[0].transaction_isolation;
    },
  });
  try {
    const bundle = await exportBundle(admin, source.pageId);
    assert.equal(bundle.pages[0].sourceRevisionId, source.revisionId);
    assert.equal(bundle.pages[0].citations[0].sourceId, source.sourceId);
    assert.equal(observedIsolation, 'repeatable read');
  } finally {
    auth.withActorTransaction = original;
  }
});

test('WIKI-TRANSFER imports staff drafts, preserves citation closure, and replays exactly without copying actors or roles', async (t) => {
  const fixture = await makeFixture(t);
  const source = await seedSourceAndPage(fixture);
  const admin = await sessionFor(fixture.users.admin.id);
  const exported = await exportBundle(admin, source.pageId);
  const bundle = asForeignBundle(exported, {
    slug: `transfer-target-${token()}`,
    title: 'Synthetic imported transfer page',
  });

  const staged = await request(admin, '/admin/wiki-transfers/imports', { method: 'POST', body: { bundle } });
  assert.equal(staged.status, 201, JSON.stringify(staged.body));
  assert.equal(staged.body.data.preview.status, 'ready');
  assert.equal(staged.body.data.preview.pages[0].action, 'create');
  assert.equal(staged.body.data.preview.sources[0].action, 'create');
  assert.equal(JSON.stringify(staged.body).includes(SOURCE_TEXT), false, 'preview must not expose source contents');
  fixture.jobIds.push(staged.body.data.id);
  const exactStageReplay = await request(admin, '/admin/wiki-transfers/imports', { method: 'POST', body: { bundle } });
  assert.equal(exactStageReplay.status, 201, JSON.stringify(exactStageReplay.body));
  assert.equal(exactStageReplay.body.data.id, staged.body.data.id);
  assert.equal(exactStageReplay.body.data.planHash, staged.body.data.planHash);

  const commitBody = {
    expectedVersion: staged.body.data.version,
    planHash: staged.body.data.planHash,
    pageIds: [bundle.pages[0].sourcePageId],
    sourceIds: [bundle.sources[0].sourceId],
  };
  const committed = await request(admin, `/admin/wiki-transfers/imports/${staged.body.data.id}/commit`, {
    method: 'POST', body: commitBody,
  });
  assert.equal(committed.status, 200, JSON.stringify(committed.body));
  assert.equal(committed.body.data.replay, false);
  const targetPageId = committed.body.data.pages[0].targetPageId;
  const targetSourceId = committed.body.data.sources[0].targetSourceId;
  fixture.pageIds.push(targetPageId);
  fixture.sourceIds.push(targetSourceId);

  const target = await sql`
    SELECT p.id, p.created_by, p.access_level, p.head_revision_id, p.published_revision_id,
           r.actor_id, r.snapshot, r.edit_summary
    FROM wiki_pages p JOIN wiki_revisions r ON r.id = p.head_revision_id AND r.page_id = p.id
    WHERE p.id = ${targetPageId}`;
  assert.equal(target.length, 1);
  assert.equal(target[0].created_by, fixture.users.admin.id);
  assert.equal(target[0].actor_id, fixture.users.admin.id);
  assert.notEqual(target[0].actor_id, fixture.users.member.id);
  assert.equal(target[0].access_level, 'staff');
  assert.equal(target[0].published_revision_id, null);
  assert.equal(target[0].snapshot.accessLevel, 'staff', 'an imported public snapshot becomes a staff draft');
  assert.match(target[0].edit_summary, /Importação de pacote portátil/);

  const targetSource = await sql`SELECT imported_by, content FROM wiki_sources WHERE id = ${targetSourceId}`;
  assert.equal(targetSource.length, 1);
  assert.equal(targetSource[0].imported_by, fixture.users.admin.id);
  assert.equal(targetSource[0].content, SOURCE_TEXT);
  const citationRows = await sql`
    SELECT revision_id, section_id, source_id, locator
    FROM wiki_revision_citations WHERE revision_id = ${target[0].head_revision_id}`;
  assert.deepEqual(citationRows.map((row) => ({
    section_id: row.section_id,
    source_id: row.source_id,
    locator: row.locator,
  })), [{ section_id: bundle.pages[0].citations[0].sectionId, source_id: targetSourceId, locator: 'section 1, paragraph 2' }]);

  const publicPage = await request(null, `/wiki/pages/${targetPageId}`);
  const publicSearch = await request(null, `/wiki/pages?search=${encodeURIComponent(bundle.pages[0].snapshot.title)}`);
  assert.equal(publicPage.status, 404);
  assert.equal(publicSearch.status, 200);
  assert.equal(publicSearch.body.data.some((page) => page.id === targetPageId), false);

  const replay = await request(admin, `/admin/wiki-transfers/imports/${staged.body.data.id}/commit`, {
    method: 'POST', body: commitBody,
  });
  assert.equal(replay.status, 200, JSON.stringify(replay.body));
  assert.equal(replay.body.data.replay, true);
  assert.equal(replay.body.data.pages[0].targetPageId, targetPageId);
  const targetCounts = await sql`
    SELECT (SELECT count(*)::integer FROM wiki_transfer_page_mappings WHERE target_page_id = ${targetPageId}) AS page_maps,
           (SELECT count(*)::integer FROM wiki_transfer_source_mappings WHERE target_source_id = ${targetSourceId}) AS source_maps,
           (SELECT count(*)::integer FROM wiki_sources WHERE id = ${targetSourceId}) AS sources,
           (SELECT count(*)::integer FROM wiki_revisions WHERE page_id = ${targetPageId}) AS revisions`;
  assert.deepEqual(targetCounts[0], { page_maps: 1, source_maps: 1, sources: 1, revisions: 1 });
  const audit = await sql`
    SELECT actor_id, action, target_type, target_id, reason, after_state
    FROM audit_events WHERE target_type = 'wiki_transfer_job' AND target_id = ${staged.body.data.id}`;
  assert.equal(audit.length, 1);
  assert.equal(audit[0].actor_id, fixture.users.admin.id);
  assert.equal(audit[0].after_state.bundleSha256, bundle.manifest.bundleSha256);
  assert.equal(audit[0].after_state.pageCount, 1);
  assert.equal(audit[0].after_state.sourceCount, 1);

  // Publishing remains a separate, explicit wiki operation.
  const staffRead = await request(admin, `/staff/wiki/pages/${targetPageId}`);
  assert.equal(staffRead.status, 200);
  const publicSnapshot = { ...staffRead.body.data.head.snapshot, accessLevel: 'public' };
  const saved = await request(admin, `/staff/wiki/pages/${targetPageId}/revisions`, {
    method: 'POST', body: { snapshot: publicSnapshot, summary: 'Synthetic explicit publication preparation', expectedVersion: 1 },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const published = await request(admin, `/staff/wiki/pages/${targetPageId}/publish`, {
    method: 'POST', body: {
      revisionId: saved.body.data.headRevisionId,
      expectedVersion: saved.body.data.workVersion,
      expectedPublishedRevisionId: null,
      summary: 'Synthetic explicit publication test',
    },
  });
  assert.equal(published.status, 200, JSON.stringify(published.body));
  assert.equal((await request(null, `/wiki/pages/${targetPageId}`)).status, 200);
});

test('WIKI-TRANSFER replay identity binds source revision and citations and detects changed target citations', async (t) => {
  const fixture = await makeFixture(t);
  const source = await seedSourceAndPage(fixture);
  const admin = await sessionFor(fixture.users.admin.id);
  const exported = await exportBundle(admin, source.pageId);
  const bundle = asForeignBundle(exported, { slug: `transfer-identity-${token()}`, title: 'Synthetic replay identity' });
  const staged = await request(admin, '/admin/wiki-transfers/imports', { method: 'POST', body: { bundle } });
  assert.equal(staged.status, 201, JSON.stringify(staged.body));
  fixture.jobIds.push(staged.body.data.id);
  const committed = await request(admin, `/admin/wiki-transfers/imports/${staged.body.data.id}/commit`, {
    method: 'POST', body: {
      expectedVersion: staged.body.data.version,
      planHash: staged.body.data.planHash,
      pageIds: [bundle.pages[0].sourcePageId],
      sourceIds: [bundle.sources[0].sourceId],
    },
  });
  assert.equal(committed.status, 200, JSON.stringify(committed.body));
  const targetPageId = committed.body.data.pages[0].targetPageId;
  const targetSourceId = committed.body.data.sources[0].targetSourceId;
  fixture.pageIds.push(targetPageId);
  fixture.sourceIds.push(targetSourceId);

  const changedRevision = structuredClone(bundle);
  changedRevision.pages[0].sourceRevisionId = randomUUID();
  refreshBundleHash(changedRevision);
  const changedRevisionStage = await request(admin, '/admin/wiki-transfers/imports', {
    method: 'POST', body: { bundle: changedRevision },
  });
  assert.equal(changedRevisionStage.status, 201, JSON.stringify(changedRevisionStage.body));
  fixture.jobIds.push(changedRevisionStage.body.data.id);
  assert.equal(changedRevisionStage.body.data.preview.pages[0].action, 'conflict');
  assert.equal(changedRevisionStage.body.data.preview.pages[0].reason, 'source_revision_changed');

  const changedCitation = structuredClone(bundle);
  changedCitation.pages[0].citations[0].locator = 'section 1, different paragraph';
  refreshBundleHash(changedCitation);
  const changedCitationStage = await request(admin, '/admin/wiki-transfers/imports', {
    method: 'POST', body: { bundle: changedCitation },
  });
  assert.equal(changedCitationStage.status, 201, JSON.stringify(changedCitationStage.body));
  fixture.jobIds.push(changedCitationStage.body.data.id);
  assert.equal(changedCitationStage.body.data.preview.pages[0].action, 'conflict');
  assert.equal(changedCitationStage.body.data.preview.pages[0].reason, 'source_page_changed');

  const target = await sql`SELECT head_revision_id FROM wiki_pages WHERE id = ${targetPageId}`;
  await sql`DELETE FROM wiki_revision_citations WHERE revision_id = ${target[0].head_revision_id}`;
  const changedManifest = structuredClone(bundle);
  changedManifest.manifest.createdAt = new Date(Date.parse(bundle.manifest.createdAt) + 1_000).toISOString();
  refreshBundleHash(changedManifest);
  const changedTargetStage = await request(admin, '/admin/wiki-transfers/imports', {
    method: 'POST', body: { bundle: changedManifest },
  });
  assert.equal(changedTargetStage.status, 201, JSON.stringify(changedTargetStage.body));
  fixture.jobIds.push(changedTargetStage.body.data.id);
  assert.equal(changedTargetStage.body.data.preview.pages[0].action, 'conflict');
  assert.equal(changedTargetStage.body.data.preview.pages[0].reason, 'target_changed');
});

test('WIKI-TRANSFER reports page-ID and slug collisions in preview and rejects selected conflicts', async (t) => {
  const fixture = await makeFixture(t);
  const source = await seedSourceAndPage(fixture);
  const admin = await sessionFor(fixture.users.admin.id);
  const exported = await exportBundle(admin, source.pageId);
  const bundle = asForeignBundle(exported, { slug: `transfer-unused-${token()}`, title: 'Synthetic collision bundle' });
  bundle.pages[0].citations = [];
  bundle.sources = [];
  bundle.manifest.sourceCount = 0;
  bundle.pages[0].snapshot.slug = source.slug;
  const secondPage = structuredClone(bundle.pages[0]);
  secondPage.sourcePageId = source.pageId;
  secondPage.sourceRevisionId = randomUUID();
  secondPage.snapshot.slug = `transfer-page-id-collision-${token()}`;
  secondPage.snapshot.title = 'Synthetic page-ID collision';
  bundle.pages.push(secondPage);
  bundle.manifest.pageCount = 2;
  refreshBundleHash(bundle);

  const existingPageBeforeCommit = await sql`
    SELECT id, created_by, access_level, head_revision_id, published_revision_id
    FROM wiki_pages WHERE id = ${source.pageId}`;
  assert.equal(existingPageBeforeCommit.length, 1);
  const pageState = (rows) => rows.map((row) => ({
    id: String(row.id).toLowerCase(),
    createdBy: String(row.created_by).toLowerCase(),
    accessLevel: row.access_level,
    headRevisionId: String(row.head_revision_id).toLowerCase(),
    publishedRevisionId: row.published_revision_id ? String(row.published_revision_id).toLowerCase() : null,
  }));

  const staged = await request(admin, '/admin/wiki-transfers/imports', { method: 'POST', body: { bundle } });
  assert.equal(staged.status, 201, JSON.stringify(staged.body));
  fixture.jobIds.push(staged.body.data.id);
  const conflicts = staged.body.data.preview.conflicts;
  assert.ok(conflicts.some((item) => item.reason === 'slug_collision'));
  assert.ok(conflicts.some((item) => item.reason === 'page_id_collision'));
  const commit = await request(admin, `/admin/wiki-transfers/imports/${staged.body.data.id}/commit`, {
    method: 'POST', body: {
      expectedVersion: staged.body.data.version,
      planHash: staged.body.data.planHash,
      pageIds: bundle.pages.map((page) => page.sourcePageId),
      sourceIds: [],
    },
  });
  assert.equal(commit.status, 409);
  assert.equal(commit.body.code, 'WIKI_TRANSFER_CONFLICT');
  const matchingPages = await sql`
    SELECT id, created_by, access_level, head_revision_id, published_revision_id
    FROM wiki_pages WHERE id = ANY(${sql.array(bundle.pages.map((page) => page.sourcePageId), 2950)})`;
  assert.deepEqual(pageState(matchingPages), pageState(existingPageBeforeCommit),
    'the existing page-ID collision remains unchanged and no non-colliding bundle page is created');
  const mappings = await sql`
    SELECT source_page_id, target_page_id FROM wiki_transfer_page_mappings
    WHERE origin_id = ${bundle.origin.instanceId}`;
  assert.equal(mappings.length, 0, 'a rejected collision must not create an import mapping');
});

test('WIKI-TRANSFER refresh persists changed conflicts while GET remains read-only', async (t) => {
  const fixture = await makeFixture(t);
  const source = await seedSourceAndPage(fixture);
  const admin = await sessionFor(fixture.users.admin.id);
  const exported = await exportBundle(admin, source.pageId);
  const bundle = asForeignBundle(exported, { slug: `transfer-refresh-${token()}`, title: 'Synthetic refresh preview' });
  const staged = await request(admin, '/admin/wiki-transfers/imports', { method: 'POST', body: { bundle } });
  assert.equal(staged.status, 201, JSON.stringify(staged.body));
  fixture.jobIds.push(staged.body.data.id);
  assert.equal(staged.body.data.preview.status, 'ready');

  await sql`
    INSERT INTO wiki_names (name_key, page_id, kind)
    VALUES (${bundle.pages[0].snapshot.slug}, ${source.pageId}, 'canonical')`;
  const beforeRefresh = await request(admin, `/admin/wiki-transfers/imports/${staged.body.data.id}`);
  assert.equal(beforeRefresh.status, 200);
  assert.equal(beforeRefresh.body.data.version, staged.body.data.version);
  assert.equal(beforeRefresh.body.data.planHash, staged.body.data.planHash);
  assert.equal(beforeRefresh.body.data.preview.status, 'ready');

  const refreshed = await request(admin, `/admin/wiki-transfers/imports/${staged.body.data.id}/refresh`, {
    method: 'POST', body: {},
  });
  assert.equal(refreshed.status, 200, JSON.stringify(refreshed.body));
  assert.equal(refreshed.body.data.version, staged.body.data.version + 1);
  assert.notEqual(refreshed.body.data.planHash, staged.body.data.planHash);
  assert.equal(refreshed.body.data.preview.pages[0].action, 'conflict');
  assert.equal(refreshed.body.data.preview.pages[0].reason, 'slug_collision');

  const afterRefresh = await request(admin, `/admin/wiki-transfers/imports/${staged.body.data.id}`);
  assert.equal(afterRefresh.status, 200);
  assert.equal(afterRefresh.body.data.version, refreshed.body.data.version);
  assert.equal(afterRefresh.body.data.planHash, refreshed.body.data.planHash);
  assert.equal(afterRefresh.body.data.preview.status, 'conflict');
});

test('WIKI-TRANSFER rolls back source, draft, mapping, job, and audit changes if the transactional audit write fails', async (t) => {
  const fixture = await makeFixture(t);
  const source = await seedSourceAndPage(fixture);
  const admin = await sessionFor(fixture.users.admin.id);
  const exported = await exportBundle(admin, source.pageId);
  const bundle = asForeignBundle(exported, { slug: `transfer-rollback-${token()}`, title: 'Synthetic rollback page' });
  const staged = await request(admin, '/admin/wiki-transfers/imports', { method: 'POST', body: { bundle } });
  assert.equal(staged.status, 201, JSON.stringify(staged.body));
  fixture.jobIds.push(staged.body.data.id);

  const constraintName = `transfer_audit_fail_${token()}`;
  fixture.auditConstraint = constraintName;
  await sql.unsafe(`ALTER TABLE audit_events ADD CONSTRAINT ${constraintName} CHECK (action <> 'admin.wiki_transfer.commit')`);
  const commit = await request(admin, `/admin/wiki-transfers/imports/${staged.body.data.id}/commit`, {
    method: 'POST', body: {
      expectedVersion: staged.body.data.version,
      planHash: staged.body.data.planHash,
      pageIds: [bundle.pages[0].sourcePageId],
      sourceIds: [bundle.sources[0].sourceId],
    },
  });
  await sql.unsafe(`ALTER TABLE audit_events DROP CONSTRAINT ${constraintName}`);
  fixture.auditConstraint = null;
  assert.equal(commit.status, 400);
  assert.equal(commit.body.code, 'INVALID_VALUE');
  assert.equal(JSON.stringify(commit.body).includes(SOURCE_TEXT), false);

  const writes = await sql`
    SELECT (SELECT count(*)::integer FROM wiki_transfer_page_mappings WHERE origin_id = ${bundle.origin.instanceId}) AS page_maps,
           (SELECT count(*)::integer FROM wiki_transfer_source_mappings WHERE origin_id = ${bundle.origin.instanceId}) AS source_maps,
           (SELECT count(*)::integer FROM wiki_sources WHERE archive_sha256 = ${bundle.sources[0].archiveSha256}
             AND relative_path = ${bundle.sources[0].relativePath}) AS sources,
           (SELECT count(*)::integer FROM wiki_pages WHERE id IN
             (SELECT target_page_id FROM wiki_transfer_page_mappings WHERE origin_id = ${bundle.origin.instanceId})) AS pages,
           (SELECT state FROM wiki_transfer_jobs WHERE id = ${staged.body.data.id}) AS job_state,
           (SELECT count(*)::integer FROM audit_events WHERE target_id = ${staged.body.data.id}
             AND target_type = 'wiki_transfer_job') AS audits`;
  assert.deepEqual(writes[0], { page_maps: 0, source_maps: 0, sources: 0, pages: 0, job_state: 'staged', audits: 0 });
});

async function makeFixture(t) {
  const fixture = { users: {}, pageIds: [], sourceIds: [], jobIds: [], auditConstraint: null };
  t.after(async () => cleanFixture(fixture));
  const suffix = token();
  for (const role of ['admin', 'moderador', 'member']) {
    const username = `wiki-transfer-${role}-${suffix}`;
    const rows = await sql`
      INSERT INTO users (username, email, password_hash, role)
      VALUES (${username}, ${`${username}@example.test`}, 'test-only-hash', ${role})
      RETURNING id`;
    fixture.users[role] = { id: String(rows[0].id).toLowerCase(), role, username };
  }
  return fixture;
}

async function seedSourceAndPage(fixture) {
  const archiveSha256 = sha256(Buffer.from(`synthetic-archive-${randomUUID()}`, 'utf8'));
  const relativePath = 'synthetic/source.txt';
  const fileSha256 = sha256(Buffer.from(SOURCE_TEXT, 'utf8'));
  const sourceRows = await sql`
    INSERT INTO wiki_sources
      (archive_sha256, relative_path, file_sha256, family, language,
       declared_version, declared_date, content, imported_by)
    VALUES (${archiveSha256}, ${relativePath}, ${fileSha256}, 'Synthetic family', 'en',
      'test-v1', '2026-10-21', ${SOURCE_TEXT}, ${fixture.users.member.id})
    RETURNING id`;
  const sourceId = String(sourceRows[0].id).toLowerCase();
  fixture.sourceIds.push(sourceId);
  const pageId = randomUUID();
  const revisionId = randomUUID();
  const sectionId = randomUUID();
  const snapshot = makeSnapshot({
    title: `Synthetic transfer source ${token()}`,
    slug: `transfer-source-${token()}`,
  }, sectionId);
  await sql`INSERT INTO wiki_pages (id, created_by, access_level) VALUES (${pageId}, ${fixture.users.member.id}, 'staff')`;
  await sql`
    INSERT INTO wiki_revisions (id, page_id, sequence, actor_id, edit_summary, snapshot)
    VALUES (${revisionId}, ${pageId}, 1, ${fixture.users.member.id}, 'Synthetic transfer export source', ${sql.json(snapshot)})`;
  await sql`UPDATE wiki_pages SET head_revision_id = ${revisionId} WHERE id = ${pageId}`;
  await sql`
    INSERT INTO wiki_revision_citations (revision_id, section_id, source_id, locator)
    VALUES (${revisionId}, ${sectionId}, ${sourceId}, 'section 1, paragraph 2')`;
  fixture.pageIds.push(pageId);
  return { pageId, revisionId, sectionId, sourceId, slug: snapshot.slug };
}

async function seedUnreferencedSource(fixture) {
  const archiveSha256 = sha256(Buffer.from(`unreferenced-${randomUUID()}`, 'utf8'));
  const content = 'Synthetic unreferenced source must stay out of the bundle.';
  const rows = await sql`
    INSERT INTO wiki_sources
      (archive_sha256, relative_path, file_sha256, family, language, content, imported_by)
    VALUES (${archiveSha256}, 'synthetic/unreferenced.txt', ${sha256(Buffer.from(content, 'utf8'))},
      'Synthetic family', 'en', ${content}, ${fixture.users.member.id})
    RETURNING id`;
  fixture.sourceIds.push(String(rows[0].id).toLowerCase());
}

function makeSnapshot({ title, slug }, sectionId = randomUUID()) {
  return {
    schemaVersion: 1,
    title,
    slug,
    aliases: [],
    type: 'concept',
    summary: 'Synthetic transfer summary.',
    categories: [],
    accessLevel: 'public',
    audience: 'reader',
    body: {
      format: 'richtext-v1',
      infobox: [],
      sections: [{
        id: sectionId,
        heading: 'Synthetic section',
        html: '<p>Synthetic transfer body.</p>',
        blocks: [],
        authority: [],
        knowledgeLayer: 'unspecified',
      }],
    },
  };
}

async function exportBundle(session, pageId) {
  const response = await requestRaw(session, '/admin/wiki-transfers/export', {
    method: 'POST', body: { pageIds: [pageId] },
  });
  assert.equal(response.status, 200, response.text);
  return JSON.parse(response.text);
}

function asForeignBundle(bundle, { slug, title }) {
  const output = structuredClone(bundle);
  output.origin.instanceId = randomUUID();
  output.pages[0].sourcePageId = randomUUID();
  output.pages[0].sourceRevisionId = randomUUID();
  output.pages[0].snapshot.slug = slug;
  output.pages[0].snapshot.title = title;
  output.sources[0].sourceId = randomUUID();
  output.sources[0].archiveSha256 = sha256(Buffer.from(`foreign-${randomUUID()}`, 'utf8'));
  output.pages[0].citations[0].sourceId = output.sources[0].sourceId;
  refreshBundleHash(output);
  return output;
}

function refreshBundleHash(bundle) {
  bundle.manifest.bundleSha256 = digest({
    format: bundle.format,
    manifest: {
      version: bundle.manifest.version,
      createdAt: bundle.manifest.createdAt,
      pageCount: bundle.manifest.pageCount,
      sourceCount: bundle.manifest.sourceCount,
    },
    origin: bundle.origin,
    pages: bundle.pages,
    sources: bundle.sources,
  });
}

function digest(value) {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function assertNoAccountFields(value) {
  const forbidden = new Set(['email', 'password', 'passwordHash', 'password_hash', 'session', 'role', 'userId', 'actorId', 'createdBy', 'importedBy']);
  const visit = (item) => {
    if (Array.isArray(item)) return item.forEach(visit);
    if (!item || typeof item !== 'object') return;
    for (const [key, child] of Object.entries(item)) {
      assert.equal(forbidden.has(key), false, `portable payload must not contain ${key}`);
      visit(child);
    }
  };
  visit(value);
}

function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function token() { return randomUUID().replaceAll('-', '').slice(0, 12).toLowerCase(); }
function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

async function sessionFor(userId) {
  const response = await fetch(`${baseUrl}/__fixture/session/${userId}`);
  assert.equal(response.status, 200);
  const cookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie') || ''];
  return {
    cookie: cookies.map((value) => value.split(';', 1)[0]).filter(Boolean).join('; '),
    csrfToken: (await response.json()).csrfToken,
  };
}

async function request(session, route, options = {}) {
  const response = await requestRaw(session, `/api${route}`, options);
  let body;
  try { body = response.text ? JSON.parse(response.text) : null; } catch { body = response.text; }
  return { status: response.status, body };
}

async function requestRaw(session, route, { method = 'GET', body } = {}) {
  const headers = {};
  if (session) {
    headers.cookie = session.cookie;
    headers['x-csrf-token'] = session.csrfToken;
  }
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${baseUrl}${route.startsWith('/api') || route.startsWith('/__fixture') ? '' : '/api'}${route}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, text: await response.text(), headers: response.headers };
}

async function cleanFixture(fixture) {
  if (fixture.auditConstraint) {
    await sql.unsafe(`ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS ${fixture.auditConstraint}`);
  }
  await sql.begin(async (tx) => {
    await tx`ALTER TABLE wiki_revisions DISABLE TRIGGER wiki_revisions_immutable`;
    if (fixture.jobIds.length) {
      await tx`DELETE FROM wiki_transfer_jobs WHERE id = ANY(${tx.array(fixture.jobIds, 2950)})`;
      await tx`DELETE FROM audit_events WHERE target_id = ANY(${tx.array(fixture.jobIds, 2950)}) AND target_type = 'wiki_transfer_job'`;
    }
    if (fixture.pageIds.length) {
      await tx`DELETE FROM wiki_transfer_page_mappings WHERE target_page_id = ANY(${tx.array(fixture.pageIds, 2950)})`;
    }
    if (fixture.sourceIds.length) {
      await tx`DELETE FROM wiki_transfer_source_mappings WHERE target_source_id = ANY(${tx.array(fixture.sourceIds, 2950)})`;
    }
    for (const pageId of fixture.pageIds) {
      await tx`DELETE FROM audit_events WHERE target_id = ${pageId}`;
      await tx`DELETE FROM wiki_revision_categories WHERE revision_id IN (SELECT id FROM wiki_revisions WHERE page_id = ${pageId})`;
      await tx`DELETE FROM wiki_revision_links WHERE revision_id IN (SELECT id FROM wiki_revisions WHERE page_id = ${pageId})`;
      await tx`DELETE FROM wiki_revision_citations WHERE revision_id IN (SELECT id FROM wiki_revisions WHERE page_id = ${pageId})`;
      await tx`UPDATE wiki_pages SET head_revision_id = NULL, published_revision_id = NULL WHERE id = ${pageId}`;
      const revisions = await tx`SELECT id FROM wiki_revisions WHERE page_id = ${pageId} ORDER BY sequence DESC`;
      for (const revision of revisions) await tx`DELETE FROM wiki_revisions WHERE id = ${revision.id}`;
      await tx`DELETE FROM wiki_names WHERE page_id = ${pageId}`;
      await tx`DELETE FROM wiki_pages WHERE id = ${pageId}`;
    }
    if (fixture.sourceIds.length) await tx`DELETE FROM wiki_sources WHERE id = ANY(${tx.array(fixture.sourceIds, 2950)})`;
    await tx`ALTER TABLE wiki_revisions ENABLE TRIGGER wiki_revisions_immutable`;
    for (const user of Object.values(fixture.users)) {
      await tx`DELETE FROM audit_events WHERE actor_id = ${user.id}`;
      await tx`DELETE FROM users WHERE id = ${user.id}`;
    }
  });
}
