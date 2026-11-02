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
const { createWikiArticleFilesRouter } = require('../../server/wiki-article-files');
const { createWikiRouter } = require('../../server/wiki');

const ROOT = path.resolve(__dirname, '../..');
const testDatabaseUrl = process.env.ETERVERSO_TEST_DATABASE_URL;
const SOURCE_TEXT = 'Synthetic private source for article-file tests.\n';

let sql;
let server;
let baseUrl;
let auth;
let sessionSecret;

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

  sessionSecret = `wiki-article-files-${randomUUID()}`;
  auth = createAuth({ sql, config: { sessionSecret, secureCookies: false } });
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(cookieSession(createCookieSessionOptions({ sessionSecret, secureCookies: false })));
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
  app.use('/api', createWikiArticleFilesRouter({ sql, auth, sessionSecret }));
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

test('WAF1 guide, export, preview, and commit are staff-only; moderator and admin can use them', async (t) => {
  const fixture = await makeFixture(t);
  const source = await makeSource(fixture, SOURCE_TEXT, 'synthetic/waf1-source.txt');
  const page = await seedPage(fixture, snapshot({
    title: 'Synthetic permission article', slug: `waf1-permission-${token()}`,
  }), [{ sectionId: null, sourceId: source.id, locator: 'test section 1' }]);
  const sessions = {
    admin: await sessionFor(fixture.users.admin.id),
    moderator: await sessionFor(fixture.users.moderador.id),
    member: await sessionFor(fixture.users.member.id),
  };

  assert.equal((await request(null, '/staff/wiki/article-files/guide')).status, 401);
  assert.equal((await request(sessions.member, '/staff/wiki/article-files/guide')).status, 403);
  assert.equal((await request(sessions.admin, '/staff/wiki/article-files/guide')).status, 200);
  assert.equal((await request(sessions.moderator, '/staff/wiki/article-files/guide')).status, 200);
  assert.equal((await request(null, `/staff/wiki/pages/${page.id}/article-file`)).status, 401);
  assert.equal((await request(sessions.member, `/staff/wiki/pages/${page.id}/article-file`)).status, 403);
  const exportByModerator = await request(sessions.moderator, `/staff/wiki/pages/${page.id}/article-file`);
  const exportByAdmin = await request(sessions.admin, `/staff/wiki/pages/${page.id}/article-file`);
  assert.equal(exportByModerator.status, 200, JSON.stringify(exportByModerator.body));
  assert.equal(exportByAdmin.status, 200, JSON.stringify(exportByAdmin.body));
  assert.equal(exportByModerator.body.data.file.format, 'AetherverseWikiAuthoringV1');

  const fileText = JSON.stringify(authoring(source, `waf1-permission-new-${token()}`));
  assert.equal((await request(null, '/staff/wiki/article-files/preview', {
    method: 'POST', body: { fileText },
  })).status, 403);
  assert.equal((await request(sessions.member, '/staff/wiki/article-files/preview', {
    method: 'POST', body: { fileText },
  })).status, 403);
  const preview = await request(sessions.moderator, '/staff/wiki/article-files/preview', {
    method: 'POST', body: { fileText },
  });
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.ok(preview.body.data.previewToken);
  assert.equal((await request(sessions.member, '/staff/wiki/article-files/commit', {
    method: 'POST', body: { previewToken: preview.body.data.previewToken },
  })).status, 403);
  const committed = await request(sessions.moderator, '/staff/wiki/article-files/commit', {
    method: 'POST', body: { previewToken: preview.body.data.previewToken },
  });
  assert.equal(committed.status, 201, JSON.stringify(committed.body));
  fixture.pageIds.push(committed.body.data.page.id);
});

test('WAF2 authoring import saves a private cited revision, preserves IDs on round-trip, and replays once', async (t) => {
  const fixture = await makeFixture(t);
  const source = await makeSource(fixture, SOURCE_TEXT, 'synthetic/waf2-source.txt');
  const moderator = await sessionFor(fixture.users.moderador.id);
  const initialFile = authoring(source, `waf2-roundtrip-${token()}`);
  const initialPreview = await preview(moderator, initialFile);
  assert.equal(initialPreview.status, 200, JSON.stringify(initialPreview.body));
  assert.equal(initialPreview.body.data.snapshot.accessLevel, 'staff');
  assert.equal(initialPreview.body.data.sourceMatches[0].sourceId, source.id);
  assert.equal(JSON.stringify(initialPreview.body).includes(SOURCE_TEXT), false);
  const committed = await request(moderator, '/staff/wiki/article-files/commit', {
    method: 'POST', body: { previewToken: initialPreview.body.data.previewToken },
  });
  assert.equal(committed.status, 201, JSON.stringify(committed.body));
  const created = committed.body.data.page;
  fixture.pageIds.push(created.id);
  assert.equal(created.accessLevel, 'staff');
  assert.equal(created.publishedRevisionId, null);
  assert.equal(created.workVersion, 1);
  assert.deepEqual(created.head.citations, initialPreview.body.data.citations);
  assert.deepEqual(created.head.snapshot.body.sections.map((section) => section.blocks), [[]]);
  assert.equal((await request(null, `/wiki/pages/${created.id}`)).status, 404);

  const exactReplay = await request(moderator, '/staff/wiki/article-files/commit', {
    method: 'POST', body: { previewToken: initialPreview.body.data.previewToken },
  });
  assert.equal(exactReplay.status, 200);
  assert.equal(exactReplay.body.data.replay, true);
  assert.equal(exactReplay.body.data.page.id, created.id);
  assert.equal(await revisionCount(created.id), 1);

  const exported = await request(moderator, `/staff/wiki/pages/${created.id}/article-file`);
  assert.equal(exported.status, 200, JSON.stringify(exported.body));
  assert.equal(exported.body.data.file.format, 'AetherverseWikiAuthoringV1');
  assert.equal(exported.body.data.file.pages[0].key, `page-${created.id}`);
  const exportedSection = exported.body.data.file.pages[0].sections[0];
  const storedSectionId = created.head.snapshot.body.sections[0].id;
  assert.equal(exportedSection.key, `section-${storedSectionId}`);
  assert.equal(exportedSection.citations[0].source, `source-${source.id}`);
  assert.equal(JSON.stringify(exported.body.data.file).includes(SOURCE_TEXT), false);

  const edited = structuredClone(exported.body.data.file);
  edited.pages[0].title = 'Synthetic edited article-file title';
  edited.pages[0].slug = `${created.head.snapshot.slug}-renamed`;
  edited.pages[0].summary = 'Synthetic revised summary.';
  edited.pages[0].sections[0].html = '<p>Edited through the authoring file.</p>';
  const unselected = await preview(moderator, edited);
  assert.equal(unselected.status, 200);
  assert.equal(unselected.body.data.candidates[0].id, created.id, 'page-UUID is an explicit target hint even after the slug changes');
  assert.equal(unselected.body.data.previewToken, null, 'an existing local target is never selected automatically');
  const editedPreview = await preview(moderator, edited, { targetPageId: created.id });
  assert.equal(editedPreview.status, 200, JSON.stringify(editedPreview.body));
  assert.equal(editedPreview.body.data.candidates[0].id, created.id);
  assert.equal(editedPreview.body.data.beforeSnapshot.title, initialFile.pages[0].title);
  assert.equal(editedPreview.body.data.sectionOptions[0].selectedTargetId, storedSectionId);
  assert.equal(editedPreview.body.data.snapshot.body.sections[0].id, storedSectionId);
  const sourceSectionId = editedPreview.body.data.sectionOptions[0].sourceSectionId;
  const clearedBinding = await preview(moderator, edited, {
    targetPageId: created.id,
    sectionBindings: [{ sourceSectionId, targetSectionId: null }],
  });
  assert.equal(clearedBinding.status, 200);
  assert.equal(clearedBinding.body.data.sectionOptions[0].selectedTargetId, null);
  assert.notEqual(clearedBinding.body.data.snapshot.body.sections[0].id, storedSectionId);
  const restoredBinding = await preview(moderator, edited, {
    targetPageId: created.id,
    sectionBindings: [{ sourceSectionId, targetSectionId: storedSectionId }],
  });
  assert.equal(restoredBinding.status, 200);
  assert.equal(restoredBinding.body.data.snapshot.body.sections[0].id, storedSectionId);
  const next = await request(moderator, '/staff/wiki/article-files/commit', {
    method: 'POST', body: { previewToken: restoredBinding.body.data.previewToken },
  });
  assert.equal(next.status, 200, JSON.stringify(next.body));
  assert.equal(next.body.data.page.workVersion, 2);
  assert.equal(next.body.data.page.head.snapshot.title, 'Synthetic edited article-file title');
  assert.deepEqual(next.body.data.page.head.citations, [{
    sectionId: storedSectionId,
    sourceId: source.id,
    locator: 'synthetic chapter 1, paragraph 2',
  }]);
  assert.equal((await citationRows(created.headRevisionId))[0].locator, 'synthetic chapter 1, paragraph 2');
  assert.equal(await revisionCount(created.id), 2);
  const audits = await sql`
    SELECT action FROM audit_events WHERE target_type = 'wiki_page' AND target_id = ${created.id}
      AND action = 'wiki.article_file.import'`;
  assert.equal(audits.length, 2);
});

test('WAF3 bundle fallback preserves blocks, private sources, citations, and publication pointers', async (t) => {
  const fixture = await makeFixture(t);
  const source = await makeSource(fixture, SOURCE_TEXT, 'synthetic/waf3-source.txt');
  const moderator = await sessionFor(fixture.users.moderador.id);
  const snapshotValue = snapshot({
    title: 'Synthetic legacy block article',
    slug: `waf3-fallback-${token()}`,
    blocks: [{ type: 'section', content: '<p>Structured legacy block remains intact.</p>' }],
  });
  const citationList = [{ sectionId: snapshotValue.body.sections[0].id, sourceId: source.id, locator: 'legacy source paragraph 4' }];
  const page = await seedPage(fixture, snapshotValue, citationList);
  const original = await sql`
    UPDATE wiki_pages SET published_revision_id = head_revision_id, access_level = 'public', public_version = 1,
      published_at = now() WHERE id = ${page.id}
    RETURNING head_revision_id, published_revision_id, public_version`;
  const originalRevisionCount = await revisionCount(page.id);
  const originalCitationRows = await citationRows(original[0].head_revision_id);

  const exported = await request(moderator, `/staff/wiki/pages/${page.id}/article-file`);
  assert.equal(exported.status, 200, JSON.stringify(exported.body));
  assert.equal(exported.body.data.file.format, 'AetherverseWikiBundleV1');
  assert.equal(exported.body.data.file.sources[0].content, SOURCE_TEXT);
  assert.ok(exported.body.data.notes.some((note) => /fontes privadas/u.test(note)));

  const previewResponse = await request(moderator, '/staff/wiki/article-files/preview', {
    method: 'POST', body: {
      fileText: JSON.stringify(exported.body.data.file),
      targetPageId: page.id,
    },
  });
  assert.equal(previewResponse.status, 200, JSON.stringify(previewResponse.body));
  assert.deepEqual(previewResponse.body.data.snapshot.body.sections[0].blocks, snapshotValue.body.sections[0].blocks);
  assert.equal(previewResponse.body.data.citations[0].locator, 'legacy source paragraph 4');
  const committed = await request(moderator, '/staff/wiki/article-files/commit', {
    method: 'POST', body: { previewToken: previewResponse.body.data.previewToken },
  });
  assert.equal(committed.status, 200, JSON.stringify(committed.body));
  assert.equal(committed.body.data.page.publishedRevisionId, original[0].published_revision_id);
  assert.equal(committed.body.data.page.publicVersion, original[0].public_version);
  assert.equal(committed.body.data.page.head.snapshot.accessLevel, 'staff');
  assert.deepEqual(committed.body.data.page.head.snapshot.body.sections[0].blocks, snapshotValue.body.sections[0].blocks);
  assert.deepEqual(await citationRows(original[0].head_revision_id), originalCitationRows);
  assert.equal(await revisionCount(page.id), originalRevisionCount + 1);
  const publicRead = await request(null, `/wiki/pages/${page.id}`);
  assert.equal(publicRead.status, 200);
  assert.equal(publicRead.body.data.title, 'Synthetic legacy block article');
});

test('WAF3A fallback export keeps its page head, snapshot, citations, and source closure on one repeatable-read snapshot', async (t) => {
  const fixture = await makeFixture(t);
  const sourceA = await makeSource(fixture, 'Synthetic export revision one source.\n', 'synthetic/waf3a-source-a.txt');
  const sourceB = await makeSource(fixture, 'Synthetic export revision two source.\n', 'synthetic/waf3a-source-b.txt');
  const snapshotV1 = snapshot({
    title: 'Synthetic exporter barrier revision one',
    slug: `waf3a-export-barrier-${token()}`,
    blocks: [{ type: 'section', content: '<p>Revision one block.</p>' }],
  });
  const sectionId = snapshotV1.body.sections[0].id;
  const page = await seedPage(fixture, snapshotV1, [{
    sectionId,
    sourceId: sourceA.id,
    locator: 'revision one locator',
  }]);
  const revisionOneCitations = await citationRows(page.revisionId);
  const admin = await sessionFor(fixture.users.admin.id);
  const moderator = await sessionFor(fixture.users.moderador.id);

  let capturedReadResolve;
  let releaseExporterResolve;
  let exporterReadCaptured = false;
  let exportRequest;
  const capturedRead = new Promise((resolve) => { capturedReadResolve = resolve; });
  const releaseExporter = new Promise((resolve) => { releaseExporterResolve = resolve; });
  const originalWithActorTransaction = auth.withActorTransaction;
  auth.withActorTransaction = (req, callback, transactionOptions = {}) => originalWithActorTransaction.call(auth, req, async (tx, actor) => {
    const watchedTx = new Proxy(tx, {
      apply(target, _thisArgument, args) {
        const queryText = Array.isArray(args[0]) ? args[0].join(' ') : '';
        const pending = Reflect.apply(target, target, args);
        if (!exporterReadCaptured
            && queryText.includes('SELECT p.id AS source_page_id, head.id AS source_revision_id')) {
          exporterReadCaptured = true;
          return Promise.resolve(pending).then(async (rows) => {
            capturedReadResolve();
            await releaseExporter;
            return rows;
          });
        }
        return pending;
      },
      get(target, property) {
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    return callback(watchedTx, actor);
  }, transactionOptions);

  try {
    exportRequest = request(admin, `/staff/wiki/pages/${page.id}/article-file`);
    await Promise.race([
      capturedRead,
      exportRequest.then(() => { throw new Error('The exporter did not reach the revision-ID barrier.'); }),
    ]);
    assert.equal(exporterReadCaptured, true);

    const snapshotV2 = structuredClone(snapshotV1);
    snapshotV2.title = 'Synthetic exporter barrier revision two';
    snapshotV2.body.sections[0].html = '<p>Revision two block.</p>';
    const saved = await request(moderator, `/staff/wiki/pages/${page.id}/revisions`, {
      method: 'POST',
      body: {
        snapshot: snapshotV2,
        summary: 'Synthetic concurrent exporter regression revision',
        expectedVersion: 1,
        citations: [{ sectionId, sourceId: sourceB.id, locator: 'revision two locator' }],
      },
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.data.head.snapshot.title, snapshotV2.title);
    releaseExporterResolve();

    const exported = await exportRequest;
    assert.equal(exported.status, 200, JSON.stringify(exported.body));
    const bundle = exported.body.data.file;
    assert.equal(bundle.format, 'AetherverseWikiBundleV1');
    assert.equal(bundle.pages[0].sourceRevisionId, page.revisionId);
    assert.deepEqual(bundle.pages[0].snapshot, snapshotV1);
    assert.deepEqual(bundle.pages[0].citations, revisionOneCitations);
    assert.equal(bundle.sources.length, 1);
    assert.equal(bundle.sources[0].sourceId, sourceA.id);
    assert.equal(bundle.sources[0].content, sourceA.content);
  } finally {
    releaseExporterResolve();
    auth.withActorTransaction = originalWithActorTransaction;
    if (exportRequest) await exportRequest.catch(() => {});
  }
});

test('WAF3B small authoring files export and preview against an existing source larger than a portable bundle', async (t) => {
  const fixture = await makeFixture(t);
  const largeContent = 'L'.repeat(4 * 1024 * 1024 + 64);
  const source = await makeSource(fixture, largeContent, 'synthetic/waf3b-large-source.txt');
  const pageSnapshot = snapshot({
    title: 'Synthetic small article with large source',
    slug: `waf3b-large-source-${token()}`,
  });
  const page = await seedPage(fixture, pageSnapshot, [{
    sectionId: pageSnapshot.body.sections[0].id,
    sourceId: source.id,
    locator: 'large source paragraph 1',
  }]);
  const moderator = await sessionFor(fixture.users.moderador.id);

  const exported = await request(moderator, `/staff/wiki/pages/${page.id}/article-file`);
  assert.equal(exported.status, 200, JSON.stringify(exported.body));
  assert.equal(exported.body.data.file.format, 'AetherverseWikiAuthoringV1');
  assert.deepEqual(exported.body.data.file.sources, [{
    key: `source-${source.id}`,
    set: `archive-${source.archiveSha256}`,
    path: source.relativePath,
  }]);
  assert.equal(Buffer.byteLength(JSON.stringify(exported.body.data.file), 'utf8') < 4 * 1024 * 1024, true);
  assert.equal(JSON.stringify(exported.body.data.file).includes(largeContent), false);

  const previewResponse = await preview(moderator, exported.body.data.file, { targetPageId: page.id });
  assert.equal(previewResponse.status, 200, JSON.stringify(previewResponse.body));
  assert.equal(previewResponse.body.data.sourceMatches[0].sourceId, source.id);
  assert.equal(previewResponse.body.data.sourceMatches[0].fileSha256, source.fileSha256);
  assert.equal(JSON.stringify(previewResponse.body).includes(largeContent), false);
});

test('WAF4 preview catches ambiguous and missing sources, duplicate JSON, and unsafe authored HTML', async (t) => {
  const fixture = await makeFixture(t);
  const moderator = await sessionFor(fixture.users.moderador.id);
  const archiveA = await makeSource(fixture, 'Synthetic ambiguous source A.\n', 'synthetic/shared-path.txt');
  const archiveB = await makeSource(fixture, 'Synthetic ambiguous source B.\n', 'synthetic/shared-path.txt');
  const file = authoring(archiveA, `waf4-ambiguous-${token()}`, { set: 'ambiguous-set' });
  const ambiguous = await preview(moderator, file);
  assert.equal(ambiguous.status, 200, JSON.stringify(ambiguous.body));
  assert.equal(ambiguous.body.data.previewToken, null);
  assert.deepEqual(ambiguous.body.data.needsBindings, [{
    set: 'ambiguous-set',
    choices: [archiveA.archiveSha256, archiveB.archiveSha256].sort(),
  }]);
  const resolved = await preview(moderator, file, {
    sourceSets: [{ set: 'ambiguous-set', archiveSha256: archiveA.archiveSha256 }],
  });
  assert.equal(resolved.status, 200, JSON.stringify(resolved.body));
  assert.ok(resolved.body.data.previewToken);
  assert.equal(resolved.body.data.sourceMatches[0].sourceId, archiveA.id);

  const missingFile = structuredClone(file);
  missingFile.pages[0].slug += '-missing';
  missingFile.sources[0].path = 'synthetic/missing-path.txt';
  const missing = await preview(moderator, missingFile);
  assert.equal(missing.status, 409);
  assert.equal(missing.body.code, 'WIKI_ARTICLE_SOURCE_MISSING');

  const duplicateJson = '{"format":"AetherverseWikiAuthoringV1","format":"AetherverseWikiAuthoringV1"}';
  const duplicate = await request(moderator, '/staff/wiki/article-files/preview', {
    method: 'POST', body: { fileText: duplicateJson },
  });
  assert.equal(duplicate.status, 400);
  assert.equal(duplicate.body.code, 'INVALID_WIKI_ARTICLE_FILE_JSON');

  const unsafe = structuredClone(file);
  unsafe.pages[0].slug += '-unsafe';
  unsafe.pages[0].sections[0].html = '<script>alert("synthetic")</script><p>Body</p>';
  const rejected = await preview(moderator, unsafe, {
    sourceSets: [{ set: 'ambiguous-set', archiveSha256: archiveA.archiveSha256 }],
  });
  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.code, 'INVALID_WIKI_ARTICLE_FILE');
});

test('WAF5 stale previews and commit-time name collisions roll back without partial writes', async (t) => {
  const fixture = await makeFixture(t);
  const source = await makeSource(fixture, SOURCE_TEXT, 'synthetic/waf5-source.txt');
  const admin = await sessionFor(fixture.users.admin.id);
  const existingSnapshot = snapshot({ title: 'Synthetic stale target', slug: `waf5-stale-${token()}` });
  const existing = await seedPage(fixture, existingSnapshot, [{
    sectionId: existingSnapshot.body.sections[0].id, sourceId: source.id, locator: 'stale fixture locator',
  }]);
  const updateFile = authoring(source, existingSnapshot.slug, { sectionKey: `section-${existingSnapshot.body.sections[0].id}` });
  const stalePreview = await preview(admin, updateFile, { targetPageId: existing.id });
  assert.equal(stalePreview.status, 200);
  await sql`UPDATE wiki_pages SET work_version = work_version + 1 WHERE id = ${existing.id}`;
  const staleCommit = await request(admin, '/staff/wiki/article-files/commit', {
    method: 'POST', body: { previewToken: stalePreview.body.data.previewToken },
  });
  assert.equal(staleCommit.status, 409);
  assert.equal(staleCommit.body.code, 'WIKI_ARTICLE_FILE_PREVIEW_STALE');
  assert.equal(await revisionCount(existing.id), 1);

  const collisionSlug = `waf5-collision-${token()}`;
  const collisionFile = authoring(source, collisionSlug);
  const previewResponse = await preview(admin, collisionFile);
  assert.equal(previewResponse.status, 200);
  assert.equal(previewResponse.body.data.candidates.length, 0);
  const collidingSnapshot = snapshot({ title: 'Synthetic concurrent name owner', slug: collisionSlug });
  const collisionPage = await seedPage(fixture, collidingSnapshot, []);
  const beforePages = await sql`SELECT count(*)::integer AS count FROM wiki_pages`;
  const beforeAudits = await sql`
    SELECT count(*)::integer AS count FROM audit_events
    WHERE actor_id = ${fixture.users.admin.id} AND action = 'wiki.article_file.import'`;
  const collisionCommit = await request(admin, '/staff/wiki/article-files/commit', {
    method: 'POST', body: { previewToken: previewResponse.body.data.previewToken },
  });
  assert.equal(collisionCommit.status, 409);
  assert.equal(collisionCommit.body.code, 'WIKI_NAME_CONFLICT');
  const afterPages = await sql`SELECT count(*)::integer AS count FROM wiki_pages`;
  const afterAudits = await sql`
    SELECT count(*)::integer AS count FROM audit_events
    WHERE actor_id = ${fixture.users.admin.id} AND action = 'wiki.article_file.import'`;
  assert.equal(afterPages[0].count, beforePages[0].count);
  assert.equal(afterAudits[0].count, beforeAudits[0].count);
  assert.equal((await sql`
    SELECT count(*)::integer AS count FROM request_keys
    WHERE actor_id = ${fixture.users.admin.id} AND operation = 'wiki.article_file.import'`).at(0).count, 0);
  fixture.pageIds.push(collisionPage.id);
});

function authoring(source, slug, options = {}) {
  return {
    format: 'AetherverseWikiAuthoringV1',
    workspace: options.workspace || `waf-workspace-${token()}`,
    sources: [{ key: 'source-main', set: options.set || `archive-${source.archiveSha256}`, path: source.relativePath }],
    pages: [{
      key: options.pageKey || `article-${token()}`,
      title: `Synthetic article ${slug}`,
      slug,
      aliases: [],
      type: 'concept',
      summary: 'Synthetic article-file summary.',
      categories: ['Synthetic tests'],
      audience: 'reader',
      infobox: [{ label: 'State', value: 'Test fixture' }],
      sections: [{
        key: options.sectionKey || `section-${token()}`,
        heading: 'Synthetic overview',
        html: '<p>Synthetic article-file content.</p>',
        authority: [],
        knowledgeLayer: 'mundane',
        citations: [{ source: 'source-main', locator: 'synthetic chapter 1, paragraph 2' }],
      }],
    }],
  };
}

async function preview(session, file, extra = {}) {
  return request(session, '/staff/wiki/article-files/preview', {
    method: 'POST', body: { fileText: JSON.stringify(file), ...extra },
  });
}

async function makeFixture(t) {
  const fixture = { users: {}, pageIds: [], sourceIds: [] };
  t.after(async () => cleanFixture(fixture));
  const suffix = token();
  for (const role of ['admin', 'moderador', 'member']) {
    const username = `wiki-article-files-${role}-${suffix}`;
    const rows = await sql`
      INSERT INTO users (username, email, password_hash, role)
      VALUES (${username}, ${`${username}@example.test`}, 'test-only-hash', ${role})
      RETURNING id`;
    fixture.users[role] = { id: String(rows[0].id).toLowerCase(), role, username };
  }
  return fixture;
}

async function makeSource(fixture, content, relativePath) {
  const archiveSha256 = sha256(Buffer.from(`synthetic-wiki-article-archive-${randomUUID()}`, 'utf8'));
  const fileSha256 = sha256(Buffer.from(content, 'utf8'));
  const rows = await sql`
    INSERT INTO wiki_sources
      (archive_sha256, relative_path, file_sha256, family, language,
       declared_version, declared_date, content, imported_by)
    VALUES (${archiveSha256}, ${relativePath}, ${fileSha256}, 'Synthetic article-file sources', 'en',
      'test-edition-1', '2026-11-02', ${content}, ${fixture.users.member.id})
    RETURNING id`;
  const id = String(rows[0].id).toLowerCase();
  fixture.sourceIds.push(id);
  return { id, archiveSha256, fileSha256, relativePath, content };
}

async function seedPage(fixture, pageSnapshot, citations) {
  const pageId = randomUUID().toLowerCase();
  const revisionId = randomUUID().toLowerCase();
  const actorId = fixture.users.member.id;
  const cleanCitations = citations.map((citation) => ({
    sectionId: citation.sectionId || pageSnapshot.body.sections[0].id,
    sourceId: citation.sourceId,
    locator: citation.locator,
  }));
  await sql`INSERT INTO wiki_pages (id, created_by, access_level) VALUES (${pageId}, ${actorId}, 'staff')`;
  await sql`
    INSERT INTO wiki_revisions (id, page_id, sequence, actor_id, edit_summary, snapshot)
    VALUES (${revisionId}, ${pageId}, 1, ${actorId}, 'Synthetic article-file fixture', ${sql.json(pageSnapshot)})`;
  await sql`UPDATE wiki_pages SET head_revision_id = ${revisionId} WHERE id = ${pageId}`;
  if (cleanCitations.length) {
    await sql`
      INSERT INTO wiki_revision_citations (revision_id, section_id, source_id, locator)
      VALUES ${sql(cleanCitations.map((citation) => [revisionId, citation.sectionId, citation.sourceId, citation.locator]))}`;
  }
  fixture.pageIds.push(pageId);
  return { id: pageId, revisionId };
}

function snapshot({ title, slug, blocks = [] }) {
  return {
    schemaVersion: 1,
    title,
    slug,
    aliases: [],
    type: 'concept',
    summary: 'Synthetic article-file snapshot.',
    categories: ['Synthetic tests'],
    accessLevel: 'public',
    audience: 'reader',
    body: {
      format: 'richtext-v1',
      infobox: [],
      sections: [{
        id: randomUUID().toLowerCase(),
        heading: 'Synthetic overview',
        html: '<p>Synthetic snapshot content.</p>',
        blocks,
        authority: [],
        knowledgeLayer: 'mundane',
      }],
    },
  };
}

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

async function request(session, route, { method = 'GET', body } = {}) {
  const headers = {};
  if (session) {
    headers.cookie = session.cookie;
    headers['x-csrf-token'] = session.csrfToken;
  }
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${baseUrl}/api${route}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let parsed;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: response.status, body: parsed };
}

async function citationRows(revisionId) {
  const rows = await sql`
    SELECT section_id, source_id, locator FROM wiki_revision_citations
    WHERE revision_id = ${revisionId} ORDER BY section_id, source_id, locator`;
  return rows.map((row) => ({
    sectionId: String(row.section_id).toLowerCase(),
    sourceId: String(row.source_id).toLowerCase(),
    locator: row.locator,
  }));
}

async function revisionCount(pageId) {
  return (await sql`SELECT count(*)::integer AS count FROM wiki_revisions WHERE page_id = ${pageId}`)[0].count;
}

async function cleanFixture(fixture) {
  await sql.begin(async (tx) => {
    await tx`ALTER TABLE wiki_revisions DISABLE TRIGGER wiki_revisions_immutable`;
    const userIds = Object.values(fixture.users).map((user) => user.id);
    if (userIds.length) {
      await tx`DELETE FROM request_keys WHERE actor_id = ANY(${tx.array(userIds, 2950)}) AND operation = 'wiki.article_file.import'`;
      await tx`DELETE FROM audit_events WHERE actor_id = ANY(${tx.array(userIds, 2950)})`;
    }
    for (const pageId of [...new Set(fixture.pageIds)]) {
      await tx`DELETE FROM wiki_revision_citations WHERE revision_id IN (SELECT id FROM wiki_revisions WHERE page_id = ${pageId})`;
      await tx`DELETE FROM wiki_revision_categories WHERE revision_id IN (SELECT id FROM wiki_revisions WHERE page_id = ${pageId})`;
      await tx`DELETE FROM wiki_revision_links WHERE revision_id IN (SELECT id FROM wiki_revisions WHERE page_id = ${pageId})`;
      await tx`UPDATE wiki_pages SET head_revision_id = NULL, published_revision_id = NULL WHERE id = ${pageId}`;
      await tx`DELETE FROM wiki_revisions WHERE page_id = ${pageId}`;
      await tx`DELETE FROM wiki_names WHERE page_id = ${pageId}`;
      await tx`DELETE FROM wiki_pages WHERE id = ${pageId}`;
    }
    if (fixture.sourceIds.length) {
      await tx`DELETE FROM wiki_sources WHERE id = ANY(${tx.array([...new Set(fixture.sourceIds)], 2950)})`;
    }
    await tx`ALTER TABLE wiki_revisions ENABLE TRIGGER wiki_revisions_immutable`;
    for (const user of Object.values(fixture.users)) await tx`DELETE FROM users WHERE id = ${user.id}`;
  });
}

function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function token() { return randomUUID().replaceAll('-', '').slice(0, 12).toLowerCase(); }
