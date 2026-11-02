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
const { AUTHORING_FORMAT, compileAuthoring } = require('../../scripts/wiki-authoring-compile');
const { BINDINGS_FORMAT, compileRevisionPlan } = require('../../scripts/wiki-authoring-revision-plan');

const ROOT = path.resolve(__dirname, '../..');
const testDatabaseUrl = process.env.ETERVERSO_TEST_DATABASE_URL;

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

  const config = { sessionSecret: `wiki-citations-${randomUUID()}`, secureCookies: false };
  auth = createAuth({ sql, config });
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use(cookieSession(createCookieSessionOptions(config)));
  app.use(auth.csrfProtection);
  app.get('/__fixture/session/:id', async (req, res, next) => {
    try {
      const rows = await sql`
        SELECT id, auth_version FROM users
        WHERE id = ${req.params.id} AND disabled_at IS NULL LIMIT 1`;
      if (!rows.length) return res.status(404).json({ error: 'Fixture account not found.' });
      return res.json({ csrfToken: auth.issueSession(req, rows[0]) });
    } catch (error) {
      return next(error);
    }
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

test('staff page creation writes private citations and binds only explicit citations into idempotency', async (t) => {
  const fixture = await makeFixture(t);
  const staff = await sessionFor(fixture.users.moderador.id);
  const source = await makeSource(fixture, 'WCR1 source content must remain private.');
  const pageSnapshot = snapshot();
  const citations = [citation(pageSnapshot.body.sections[0].id, source.id, 'chapter 1, paragraph 2')];
  const key = randomUUID();
  const body = { snapshot: pageSnapshot, summary: 'Create cited page', citations };

  const created = await request(staff, '/staff/wiki/pages', { method: 'POST', key, body });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const page = created.body.data;
  fixture.pageIds.push(page.id);
  assert.deepEqual(page.head.citations, citations);
  assert.equal(page.publishedRevisionId, null);
  assert.equal((await citationRows(page.headRevisionId)).length, 1);

  const replay = await request(staff, '/staff/wiki/pages', { method: 'POST', key, body });
  assert.equal(replay.status, 201);
  assert.equal(replay.body.data.id, page.id);
  assert.deepEqual(replay.body.data.head.citations, citations);
  assert.equal((await sql`SELECT count(*)::integer AS count FROM wiki_pages WHERE id = ${page.id}`)[0].count, 1);

  const changed = await request(staff, '/staff/wiki/pages', {
    method: 'POST', key,
    body: { ...body, citations: [{ ...citations[0], locator: 'chapter 1, paragraph 3' }] },
  });
  assert.equal(changed.status, 409);
  assert.equal(changed.body.code, 'IDEMPOTENCY_CONFLICT');

  // A request key written with the old citation-free payload hash must still
  // replay successfully after citation-aware creation is added.
  const legacyPage = await createDraft(fixture, staff, snapshot(), []);
  const legacyKey = randomUUID();
  const legacySnapshot = legacyPage.head.snapshot;
  const legacySummary = 'Legacy request hash';
  const legacyHash = sha256(Buffer.from(JSON.stringify({ snapshot: legacySnapshot, summary: legacySummary }), 'utf8'));
  await sql`
    INSERT INTO request_keys (actor_id, operation, idempotency_key, request_hash, resource_ids)
    VALUES (${fixture.users.moderador.id}, 'wiki.page.create', ${legacyKey}, ${legacyHash}, ${sql.json([legacyPage.id])})`;
  const legacyReplay = await request(staff, '/staff/wiki/pages', {
    method: 'POST', key: legacyKey,
    body: { snapshot: legacySnapshot, summary: legacySummary },
  });
  assert.equal(legacyReplay.status, 201, JSON.stringify(legacyReplay.body));
  assert.equal(legacyReplay.body.data.id, legacyPage.id);
  const omittedVsExplicit = await request(staff, '/staff/wiki/pages', {
    method: 'POST', key: legacyKey,
    body: { snapshot: legacySnapshot, summary: legacySummary, citations: [] },
  });
  assert.equal(omittedVsExplicit.status, 409);
  assert.equal(omittedVsExplicit.body.code, 'IDEMPOTENCY_CONFLICT');
});

test('revisions replace explicit citations, inherit omitted citations by retained section, and clear with an empty array', async (t) => {
  const fixture = await makeFixture(t);
  const staff = await sessionFor(fixture.users.moderador.id);
  const sources = await Promise.all([
    makeSource(fixture, 'WCR2 source A.'),
    makeSource(fixture, 'WCR2 source B.'),
    makeSource(fixture, 'WCR2 source C.'),
  ]);
  const pageSnapshot = snapshot({ sectionCount: 2 });
  const firstSection = pageSnapshot.body.sections[0].id;
  const removedSection = pageSnapshot.body.sections[1].id;
  const initialCitations = [
    citation(firstSection, sources[0].id, 'section A, paragraph 1'),
    citation(removedSection, sources[1].id, 'section B, paragraph 4'),
  ];
  const created = await createDraft(fixture, staff, pageSnapshot, initialCitations);
  const firstRevisionId = created.headRevisionId;
  assert.deepEqual(created.head.citations, sortedCitations(initialCitations));

  const replacedSnapshot = snapshot({ body: pageSnapshot.body, title: 'WCR2 revised title' });
  const replacement = [
    citation(firstSection, sources[2].id, 'revised section, paragraph 2'),
    citation(removedSection, sources[0].id, 'revised second section, paragraph 5'),
  ];
  const replaced = await saveRevision(staff, created, replacedSnapshot, { citations: replacement });
  assert.deepEqual(replaced.head.citations, sortedCitations(replacement));
  assert.deepEqual(await citationRows(firstRevisionId), sortedCitations(initialCitations).map(citationRow));
  assert.deepEqual(await citationRows(replaced.headRevisionId), sortedCitations(replacement).map(citationRow));

  const sectionRemovedSnapshot = snapshot({
    body: { ...pageSnapshot.body, sections: [pageSnapshot.body.sections[0]] },
    title: 'WCR2 one section remains',
  });
  const inherited = await saveRevision(staff, replaced, sectionRemovedSnapshot);
  const retainedReplacement = replacement.filter((item) => item.sectionId === firstSection);
  assert.deepEqual(inherited.head.citations, retainedReplacement);
  assert.deepEqual(await citationRows(inherited.headRevisionId), retainedReplacement.map(citationRow));

  const cleared = await saveRevision(staff, inherited, snapshot({ body: sectionRemovedSnapshot.body, title: 'WCR2 cleared' }), { citations: [] });
  assert.deepEqual(cleared.head.citations, []);
  assert.deepEqual(await citationRows(cleared.headRevisionId), []);
  assert.deepEqual(await citationRows(replaced.headRevisionId), sortedCitations(replacement).map(citationRow));
  assert.equal(cleared.publishedRevisionId, null);
});

test('restore copies citations from the restored revision, and public pages never expose citation metadata', async (t) => {
  const fixture = await makeFixture(t);
  const staff = await sessionFor(fixture.users.moderador.id);
  const sourceA = await makeSource(fixture, 'WCR3 private source A.');
  const sourceB = await makeSource(fixture, 'WCR3 private source B.');
  const pageSnapshot = snapshot();
  const sectionId = pageSnapshot.body.sections[0].id;
  const citationA = citation(sectionId, sourceA.id, 'source A locator');
  const citationB = citation(sectionId, sourceB.id, 'source B locator');
  const created = await createDraft(fixture, staff, pageSnapshot, [citationA]);
  const published = await publish(staff, created);
  const publicRevisionId = published.publishedRevisionId;

  const changed = await saveRevision(staff, published, snapshot({ body: pageSnapshot.body, title: 'WCR3 changed' }), { citations: [citationB] });
  assert.deepEqual(changed.head.citations, [citationB]);
  assert.equal(changed.publishedRevisionId, publicRevisionId);
  const staffDetail = await request(staff, `/staff/wiki/pages/${created.id}`);
  assert.deepEqual(staffDetail.body.data.head.citations, [citationB]);
  const publicPage = await request(null, `/wiki/pages/${created.id}`);
  assert.equal(publicPage.status, 200);
  assert.equal(publicPage.body.data.publishedRevisionId, publicRevisionId);
  assert.doesNotMatch(JSON.stringify(publicPage.body), /citations|sourceId|locator|private source/iu);
  const publicList = await request(null, '/wiki/pages');
  assert.doesNotMatch(JSON.stringify(publicList.body), /citations|sourceId|locator|private source/iu);

  const restored = await request(staff, `/staff/wiki/pages/${created.id}/restore-revision`, {
    method: 'POST',
    body: { oldRevisionId: publicRevisionId, expectedVersion: changed.workVersion, summary: 'Restore cited revision' },
  });
  assert.equal(restored.status, 200, JSON.stringify(restored.body));
  assert.deepEqual(restored.body.data.head.citations, [citationA]);
  assert.equal(restored.body.data.head.restoresId, publicRevisionId);
  assert.equal(restored.body.data.publishedRevisionId, publicRevisionId);
  assert.deepEqual(await citationRows(restored.body.data.headRevisionId), [citationA].map(citationRow));
  assert.deepEqual(await citationRows(publicRevisionId), [citationA].map(citationRow));
  assert.deepEqual(await citationRows(changed.headRevisionId), [citationB].map(citationRow));

  const revisions = await request(staff, `/staff/wiki/pages/${created.id}/revisions`);
  assert.equal(revisions.status, 200);
  assert.ok(revisions.body.data.every((revision) => !Object.hasOwn(revision, 'citations')));
});

test('invalid citations and stale revisions leave the head, version, snapshots, and citations untouched', async (t) => {
  const fixture = await makeFixture(t);
  const staff = await sessionFor(fixture.users.moderador.id);
  const member = await sessionFor(fixture.users.member.id);
  const source = await makeSource(fixture, 'WCR4 private source text must not appear in errors.');
  const pageSnapshot = snapshot();
  const existing = citation(pageSnapshot.body.sections[0].id, source.id, 'existing citation');
  const page = await createDraft(fixture, staff, pageSnapshot, [existing]);
  const baselineCitations = await citationRows(page.headRevisionId);
  const baseline = { id: page.headRevisionId, version: page.workVersion, count: await revisionCount(page.id) };

  const invalidRequests = [
    { citations: [citation(pageSnapshot.body.sections[0].id, randomUUID(), 'unknown source')] },
    { citations: [citation(randomUUID(), source.id, 'unknown section')] },
    { citations: [{ ...existing, sectionId: 'not-a-uuid' }] },
    { citations: [existing, { ...existing, sectionId: existing.sectionId.toUpperCase() }] },
    { citations: [{ ...existing, locator: ' \t ' }] },
    { citations: [{ ...existing, locator: 'x'.repeat(501) }] },
    { citations: [{ ...existing, locator: 'contains\0null' }] },
    { citations: [{ ...existing, extra: 'not allowed' }] },
    { citations: 'not-an-array' },
    { citations: Array.from({ length: 10_001 }, () => existing) },
  ];
  for (const overrides of invalidRequests) {
    const result = await request(staff, `/staff/wiki/pages/${page.id}/revisions`, {
      method: 'POST', body: { snapshot: snapshot({ body: pageSnapshot.body, title: `WCR4 invalid ${token()}` }), summary: 'Invalid citation test', expectedVersion: baseline.version, ...overrides },
    });
    assert.equal(result.status, 400, JSON.stringify(result.body));
    assert.doesNotMatch(JSON.stringify(result.body), /private source text|existing citation|unknown source/iu);
    const state = await request(staff, `/staff/wiki/pages/${page.id}`);
    assert.equal(state.body.data.headRevisionId, baseline.id);
    assert.equal(state.body.data.workVersion, baseline.version);
    assert.deepEqual(await citationRows(baseline.id), baselineCitations);
  }

  const missingVersion = await request(staff, `/staff/wiki/pages/${page.id}/revisions`, {
    method: 'POST',
    body: {
      snapshot: snapshot({ body: pageSnapshot.body, title: 'WCR4 missing expected version' }),
      summary: 'Citation write requires a version',
      citations: [existing],
    },
  });
  assert.equal(missingVersion.status, 428);
  assert.equal(missingVersion.body.code, 'PRECONDITION_REQUIRED');

  const stale = await request(staff, `/staff/wiki/pages/${page.id}/revisions`, {
    method: 'POST',
    body: {
      snapshot: snapshot({ body: pageSnapshot.body, title: 'WCR4 stale attempt' }),
      summary: 'Stale citation test',
      expectedVersion: baseline.version + 1,
      citations: [citation(pageSnapshot.body.sections[0].id, source.id, 'stale replacement')],
    },
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'STALE_VERSION');
  assert.equal(await revisionCount(page.id), baseline.count);
  const unchanged = await request(staff, `/staff/wiki/pages/${page.id}`);
  assert.equal(unchanged.body.data.headRevisionId, baseline.id);
  assert.equal(unchanged.body.data.workVersion, baseline.version);

  assert.equal((await request(null, `/staff/wiki/pages/${page.id}`)).status, 401);
  assert.equal((await request(member, `/staff/wiki/pages/${page.id}`)).status, 403);
  assert.equal((await request(null, `/staff/wiki/pages/${page.id}/revisions`)).status, 401);
  assert.equal((await request(member, `/staff/wiki/pages/${page.id}/revisions`)).status, 403);
  const staffList = await request(staff, '/staff/wiki/pages');
  const listed = staffList.body.data.find((item) => item.id === page.id);
  assert.ok(listed);
  assert.equal(Object.hasOwn(listed.head, 'citations'), false);
  const deniedWrite = await request(member, '/staff/wiki/pages', {
    method: 'POST', key: randomUUID(),
    body: { snapshot: snapshot(), summary: 'Member citation write attempt', citations: [] },
  });
  assert.equal(deniedWrite.status, 403);
});

test('compiled authoring bundle imports to an unpublished draft and a compiled revision receipt replaces citations safely', async (t) => {
  const fixture = await makeFixture(t);
  const admin = await sessionFor(fixture.users.admin.id);
  const suffix = token();
  const stagedSources = makeVerifiedShapedSourceSet(suffix);
  const sourceSets = new Map([['pilot', stagedSources]]);
  const authoring = makeAuthoringDocument(suffix, stagedSources.files[0].relativePath);
  const compiled = compileAuthoring(authoring, sourceSets);
  const initialBundle = compiled.bundle;
  assert.deepEqual(compiled.counts, { pages: 1, sources: 1, citations: 1 });

  const staged = await request(admin, '/admin/wiki-transfers/imports', {
    method: 'POST', body: { bundle: initialBundle },
  });
  assert.equal(staged.status, 201, JSON.stringify(staged.body));
  fixture.jobIds.push(staged.body.data.id);
  fixture.transferOriginIds.push(initialBundle.origin.instanceId);
  assert.equal(staged.body.data.preview.status, 'ready');

  const committed = await request(admin, `/admin/wiki-transfers/imports/${staged.body.data.id}/commit`, {
    method: 'POST',
    body: {
      expectedVersion: staged.body.data.version,
      planHash: staged.body.data.planHash,
      pageIds: initialBundle.pages.map((page) => page.sourcePageId),
      sourceIds: initialBundle.sources.map((source) => source.sourceId),
    },
  });
  assert.equal(committed.status, 200, JSON.stringify(committed.body));
  const targetPageId = committed.body.data.pages[0].targetPageId;
  const targetSourceId = committed.body.data.sources[0].targetSourceId;
  fixture.pageIds.push(targetPageId);
  fixture.sourceIds.push(targetSourceId);

  const imported = await request(admin, `/staff/wiki/pages/${targetPageId}`);
  assert.equal(imported.status, 200, JSON.stringify(imported.body));
  assert.equal(imported.body.data.publishedRevisionId, null);
  assert.equal(imported.body.data.accessLevel, 'staff');
  assert.deepEqual(imported.body.data.head.snapshot, { ...initialBundle.pages[0].snapshot, accessLevel: 'staff' });
  const initialCitation = {
    ...initialBundle.pages[0].citations[0],
    sourceId: targetSourceId,
  };
  assert.deepEqual(imported.body.data.head.citations, [initialCitation]);
  const publicRead = await request(null, `/wiki/pages/${targetPageId}`);
  assert.equal(publicRead.status, 404);
  const importedRevisionId = imported.body.data.headRevisionId;
  const oldCitationRows = await citationRows(importedRevisionId);
  assert.deepEqual(oldCitationRows, [citationRow(initialCitation)]);

  const revisedAuthoring = structuredClone(authoring);
  revisedAuthoring.pages[0].summary = `Updated synthetic summary ${suffix}.`;
  revisedAuthoring.pages[0].sections[0].key = 'new-authoring-key-for-legacy-section';
  revisedAuthoring.pages[0].sections[0].html = '<p>Updated synthetic section text.</p>';
  revisedAuthoring.pages[0].sections[0].citations[0].locator = 'edition 1, chapter 2, paragraph 3';
  const revisedCompilation = compileAuthoring(revisedAuthoring, sourceSets);
  const revisedBundle = revisedCompilation.bundle;
  assert.equal(revisedBundle.origin.instanceId, initialBundle.origin.instanceId);
  assert.equal(revisedBundle.pages[0].sourcePageId, initialBundle.pages[0].sourcePageId);
  assert.notEqual(revisedBundle.pages[0].sourceRevisionId, initialBundle.pages[0].sourceRevisionId);

  const sourceRows = await sql`
    SELECT id, archive_sha256, relative_path, file_sha256, family, language,
           declared_version, declared_date
    FROM wiki_sources WHERE id = ${targetSourceId}`;
  assert.equal(sourceRows.length, 1);
  const localSourceDto = {
    id: String(sourceRows[0].id).toLowerCase(),
    archiveSha256: sourceRows[0].archive_sha256,
    relativePath: sourceRows[0].relative_path,
    fileSha256: sourceRows[0].file_sha256,
    family: sourceRows[0].family,
    language: sourceRows[0].language,
    declaredVersion: sourceRows[0].declared_version,
    declaredDate: sourceRows[0].declared_date,
  };
  const revisionPreparation = compileRevisionPlan(revisedBundle, {
    format: BINDINGS_FORMAT,
    targets: [{
      sourcePageId: revisedBundle.pages[0].sourcePageId,
      targetPageId,
      expectedVersion: imported.body.data.workVersion,
      sectionBindings: [{ sourceSectionId: revisedBundle.pages[0].snapshot.body.sections[0].id, targetSectionId: initialCitation.sectionId }],
    }],
    sources: [localSourceDto],
  });
  assert.deepEqual(revisionPreparation.counts, { operations: 1, citations: 1 });
  const operation = revisionPreparation.plan.operations[0];
  assert.equal(operation.method, 'POST');
  assert.deepEqual(operation.body.citations, [{
    ...revisedBundle.pages[0].citations[0],
    sectionId: initialCitation.sectionId,
    sourceId: targetSourceId,
  }]);
  const saved = await request(admin, operation.path.replace(/^\/api/u, ''), {
    method: operation.method,
    body: operation.body,
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));

  const fresh = await request(admin, `/staff/wiki/pages/${targetPageId}`);
  assert.equal(fresh.status, 200);
  assert.equal(fresh.body.data.publishedRevisionId, null);
  assert.equal(fresh.body.data.accessLevel, 'staff');
  assert.deepEqual(fresh.body.data.head.snapshot, operation.body.snapshot);
  assert.equal(fresh.body.data.head.snapshot.body.sections[0].id, initialCitation.sectionId);
  assert.notEqual(revisedBundle.pages[0].snapshot.body.sections[0].id, initialCitation.sectionId);
  assert.deepEqual(fresh.body.data.head.citations, operation.body.citations);
  assert.deepEqual(await citationRows(importedRevisionId), oldCitationRows);
  assert.deepEqual(await citationRows(fresh.body.data.headRevisionId), [citationRow(operation.body.citations[0])]);

  const revisionCountBeforeStaleRetry = await revisionCount(targetPageId);
  const staleRetry = await request(admin, operation.path.replace(/^\/api/u, ''), {
    method: operation.method,
    body: operation.body,
  });
  assert.equal(staleRetry.status, 409);
  assert.equal(staleRetry.body.code, 'STALE_VERSION');
  assert.equal(await revisionCount(targetPageId), revisionCountBeforeStaleRetry);
  const afterStaleRetry = await request(admin, `/staff/wiki/pages/${targetPageId}`);
  assert.equal(afterStaleRetry.body.data.headRevisionId, fresh.body.data.headRevisionId);
  assert.deepEqual(afterStaleRetry.body.data.head.citations, operation.body.citations);
  assert.deepEqual(await citationRows(importedRevisionId), oldCitationRows);
});

async function makeFixture(t) {
  const fixture = { users: {}, pageIds: [], sourceIds: [], jobIds: [], transferOriginIds: [] };
  t.after(async () => cleanFixture(fixture));
  const suffix = token();
  for (const role of ['admin', 'moderador', 'member']) {
    const username = `wikicit-${role}-${suffix}`;
    const rows = await sql`
      INSERT INTO users (username, email, password_hash, role)
      VALUES (${username}, ${`${username}@example.test`}, 'test-only-hash', ${role})
      RETURNING id`;
    fixture.users[role] = { id: String(rows[0].id).toLowerCase(), role, username };
  }
  return fixture;
}

async function makeSource(fixture, content) {
  const bytes = Buffer.from(content, 'utf8');
  const rows = await sql`
    INSERT INTO wiki_sources
      (archive_sha256, relative_path, file_sha256, family, language, content, imported_by)
    VALUES (${sha256(Buffer.from(`archive-${randomUUID()}`, 'utf8'))}, ${`synthetic/${randomUUID()}.txt`},
      ${sha256(bytes)}, 'Synthetic citation fixture', 'en', ${content}, ${fixture.users.member.id})
    RETURNING id`;
  const id = String(rows[0].id).toLowerCase();
  fixture.sourceIds.push(id);
  return { id };
}

async function createDraft(fixture, session, value, citations) {
  const body = { snapshot: value, summary: 'Synthetic citation fixture page' };
  if (citations !== undefined) body.citations = citations;
  const response = await request(session, '/staff/wiki/pages', { method: 'POST', body, key: randomUUID() });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  fixture.pageIds.push(response.body.data.id);
  return response.body.data;
}

async function saveRevision(session, page, value, options = {}) {
  const body = { snapshot: value, summary: 'Synthetic citation fixture revision', expectedVersion: page.workVersion };
  if (Object.hasOwn(options, 'citations')) body.citations = options.citations;
  const response = await request(session, `/staff/wiki/pages/${page.id}/revisions`, { method: 'POST', body });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body.data;
}

async function publish(session, page) {
  const response = await request(session, `/staff/wiki/pages/${page.id}/publish`, {
    method: 'POST',
    body: {
      revisionId: page.headRevisionId,
      expectedVersion: page.workVersion,
      expectedPublishedRevisionId: null,
      summary: 'Publish citation fixture',
    },
  });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body.data;
}

function snapshot({ body: existingBody, title = `Synthetic citation page ${token()}`, sectionCount = 1 } = {}) {
  const sections = existingBody?.sections || Array.from({ length: sectionCount }, (_, index) => ({
    id: randomUUID().toLowerCase(),
    heading: `Synthetic section ${index + 1}`,
    html: `<p>Synthetic citation section ${index + 1}.</p>`,
    blocks: [],
    authority: [],
    knowledgeLayer: 'unspecified',
  }));
  return {
    schemaVersion: 1,
    title,
    slug: `citation-${token()}`,
    aliases: [],
    type: 'concept',
    summary: 'Synthetic citation summary.',
    categories: [],
    accessLevel: 'public',
    audience: 'reader',
    body: { format: 'richtext-v1', infobox: [], sections },
  };
}

function makeVerifiedShapedSourceSet(suffix) {
  const content = `Synthetic staged lore source ${suffix}.\n`;
  const bytes = Buffer.from(content, 'utf8');
  const archiveSha256 = sha256(Buffer.from(`synthetic-staged-archive-${suffix}`, 'utf8'));
  const file = {
    archiveSha256,
    relativePath: 'pilot/lore/source.txt',
    fileSha256: sha256(bytes),
    family: 'Synthetic pilot sources',
    language: 'en',
    declaredVersion: 'pilot-edition-1',
    declaredDate: '2026-10-24',
    role: 'source',
    content,
  };
  return {
    archiveSha256,
    archiveSizeBytes: bytes.length,
    totalUncompressedBytes: bytes.length,
    fileCount: 1,
    files: [file],
  };
}

function makeAuthoringDocument(suffix, sourcePath) {
  return {
    format: AUTHORING_FORMAT,
    workspace: `citation-roundtrip-${suffix}`,
    sources: [{ key: 'pilot-source', set: 'pilot', path: sourcePath }],
    pages: [{
      key: 'pilot-article',
      title: `Synthetic citation roundtrip ${suffix}`,
      slug: `citation-roundtrip-${suffix}`,
      aliases: [],
      type: 'concept',
      summary: `Initial synthetic summary ${suffix}.`,
      categories: [],
      audience: 'reader',
      infobox: [],
      sections: [{
        key: 'main',
        heading: 'Synthetic section',
        html: '<p>Initial synthetic section text.</p>',
        authority: [],
        knowledgeLayer: 'mundane',
        citations: [{ source: 'pilot-source', locator: 'edition 1, chapter 1' }],
      }],
    }],
  };
}

function citation(sectionId, sourceId, locator) {
  return { sectionId: sectionId.toLowerCase(), sourceId: sourceId.toLowerCase(), locator };
}

function citationRow(value) {
  return { section_id: value.sectionId, source_id: value.sourceId, locator: value.locator };
}

function sortedCitations(values) {
  return [...values].sort((left, right) => left.sectionId.localeCompare(right.sectionId)
    || left.sourceId.localeCompare(right.sourceId)
    || left.locator.localeCompare(right.locator));
}

async function citationRows(revisionId) {
  const rows = await sql`
    SELECT section_id, source_id, locator FROM wiki_revision_citations
    WHERE revision_id = ${revisionId}
    ORDER BY section_id ASC, source_id ASC, locator ASC`;
  return rows.map((row) => ({
    section_id: String(row.section_id).toLowerCase(),
    source_id: String(row.source_id).toLowerCase(),
    locator: row.locator,
  }));
}

async function revisionCount(pageId) {
  return (await sql`SELECT count(*)::integer AS count FROM wiki_revisions WHERE page_id = ${pageId}`)[0].count;
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

async function request(session, route, { method = 'GET', body, key } = {}) {
  const headers = {};
  if (session) {
    headers.cookie = session.cookie;
    headers['x-csrf-token'] = session.csrfToken;
  }
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (key) headers['idempotency-key'] = key;
  const response = await fetch(`${baseUrl}/api${route}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: response.status === 304 ? null : await response.json() };
}

function token() {
  return randomUUID().replaceAll('-', '').slice(0, 12).toLowerCase();
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function cleanFixture(fixture) {
  await sql.begin(async (tx) => {
    await tx`ALTER TABLE wiki_revisions DISABLE TRIGGER wiki_revisions_immutable`;
    if (fixture.jobIds.length) {
      await tx`DELETE FROM wiki_transfer_jobs WHERE id = ANY(${tx.array(fixture.jobIds, 2950)})`;
      await tx`DELETE FROM audit_events WHERE target_type = 'wiki_transfer_job' AND target_id = ANY(${tx.array(fixture.jobIds, 2950)})`;
    }
    if (fixture.transferOriginIds.length) {
      const pageMappings = await tx`
        SELECT target_page_id FROM wiki_transfer_page_mappings
        WHERE origin_id = ANY(${tx.array(fixture.transferOriginIds, 2950)})`;
      const sourceMappings = await tx`
        SELECT target_source_id FROM wiki_transfer_source_mappings
        WHERE origin_id = ANY(${tx.array(fixture.transferOriginIds, 2950)})`;
      fixture.pageIds.push(...pageMappings.map((row) => String(row.target_page_id).toLowerCase()));
      fixture.sourceIds.push(...sourceMappings.map((row) => String(row.target_source_id).toLowerCase()));
      await tx`DELETE FROM wiki_transfer_page_mappings WHERE origin_id = ANY(${tx.array(fixture.transferOriginIds, 2950)})`;
      await tx`DELETE FROM wiki_transfer_source_mappings WHERE origin_id = ANY(${tx.array(fixture.transferOriginIds, 2950)})`;
    }
    if (fixture.pageIds.length) {
      await tx`DELETE FROM wiki_transfer_page_mappings WHERE target_page_id = ANY(${tx.array(fixture.pageIds, 2950)})`;
    }
    if (fixture.sourceIds.length) {
      await tx`DELETE FROM wiki_transfer_source_mappings WHERE target_source_id = ANY(${tx.array(fixture.sourceIds, 2950)})`;
    }
    for (const user of Object.values(fixture.users)) {
      await tx`DELETE FROM request_keys WHERE actor_id = ${user.id}`;
      await tx`DELETE FROM audit_events WHERE actor_id = ${user.id}`;
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
    for (const user of Object.values(fixture.users)) await tx`DELETE FROM users WHERE id = ${user.id}`;
  });
}
