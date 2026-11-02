'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const express = require('express');
const cookieSession = require('cookie-session');
const postgres = require('postgres');
const { createAuth, createCookieSessionOptions } = require('../../server/auth');
const { errorMiddleware } = require('../../server/errors');
const { createLegacyImportRouter } = require('../../server/legacy-import');
const { createForumRouter } = require('../../server/forum');

const ROOT = path.resolve(__dirname, '../..');
const databaseUrl = process.env.ETERVERSO_TEST_DATABASE_URL;
let sql;
let server;
let baseUrl;
let auth;

test.before(async () => {
  assert.ok(databaseUrl, 'Run npm run test:env:up, then npm run test:integration.');
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

  sql = postgres(databaseUrl, { prepare: false, max: 10, connect_timeout: 5, idle_timeout: 2, connection: { timezone: 'UTC' } });
  const identity = await sql`SELECT current_database() AS database, current_user AS username`;
  assert.equal(identity[0].database, 'eterverso_test');
  assert.equal(identity[0].username, 'eterverso_test');

  const config = { sessionSecret: `legacy-import-${randomUUID()}`, secureCookies: false };
  auth = createAuth({ sql, config });
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use(cookieSession(createCookieSessionOptions(config)));
  app.use(auth.csrfProtection);
  app.get('/__fixture/session/:id', async (req, res, next) => {
    try {
      const rows = await sql`SELECT id, auth_version FROM users WHERE id = ${req.params.id} AND disabled_at IS NULL`;
      if (!rows.length) return res.status(404).json({});
      return res.json({ csrfToken: auth.issueSession(req, rows[0]) });
    } catch (error) { return next(error); }
  });
  // The production mount contract is app.use('/api/admin', createLegacyImportRouter({ sql, auth })).
  app.use('/api/admin', createLegacyImportRouter({ sql, auth }));
  app.use('/api/forum', createForumRouter({ sql, auth }));
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

test('IMP-01 admin-only staging rejects security fields, validates IDs and keeps source content off public routes', async (t) => {
  const fixture = await makeFixture(t, ['admin', 'member']);
  const admin = await sessionFor(fixture.users[0].id);
  const member = await sessionFor(fixture.users[1].id);

  const denied = await request(member, '/legacy-imports', {
    method: 'POST', body: manifest({ sourceId: randomUUID(), exportId: randomUUID() }),
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.code, 'FORBIDDEN');

  const invalidUuid = await request(admin, '/legacy-imports', {
    method: 'POST', body: manifest({ sourceId: 'not-a-uuid', exportId: randomUUID() }),
  });
  assert.equal(invalidUuid.status, 400);
  assert.equal(invalidUuid.body.code, 'INVALID_UUID');

  const created = await startJob(admin, fixture);
  const rejected = await request(admin, `/legacy-imports/${created.id}/batches/1`, {
    method: 'PUT', body: { payload: { threads: [{ id: 'thread-1', catId: 'category-1', title: 'Synthetic', role: 'admin' }] } },
  });
  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.code, 'IMPORT_SECURITY_FIELD');

  const badNumber = await request(admin, `/legacy-imports/${created.id}/batches/01`, {
    method: 'PUT', body: { payload: { categories: [] } },
  });
  assert.equal(badNumber.status, 400);
  assert.equal(badNumber.body.code, 'INVALID_BATCH_NUMBER');

  const privateRead = await fetch(`${baseUrl}/api/admin/legacy-imports/${created.id}`);
  assert.equal(privateRead.status, 401);
  const publicRead = await fetch(`${baseUrl}/api/legacy-imports/${created.id}`);
  assert.equal(publicRead.status, 404);
});

test('IMP-01 staged content requires explicit author decisions and a frozen versioned plan', async (t) => {
  const fixture = await makeFixture(t, ['admin', 'admin', 'member']);
  const admin = await sessionFor(fixture.users[0].id);
  const otherAdmin = await sessionFor(fixture.users[1].id);
  const memberId = fixture.users[2].id;
  const content = sampleContent(fixture.suffix);
  const start = await startJob(admin, fixture, { batchCount: 1 });
  const batch = await request(admin, `/legacy-imports/${start.id}/batches/1`, {
    method: 'PUT', body: { payload: content },
  });
  assert.equal(batch.status, 201, JSON.stringify(batch.body));
  assert.equal(batch.body.data.state, 'staged');

  const selections = allSelections(content);
  const missingDecision = await request(admin, `/legacy-imports/${start.id}/preview`, {
    method: 'POST', body: { expectedVersion: batch.body.data.version, selections, authorMappings: {} },
  });
  assert.equal(missingDecision.status, 400);
  assert.equal(missingDecision.body.code, 'AUTHOR_DECISION_REQUIRED');

  const authorMappings = { 'legacy-author-7': memberId, 'legacy-character-author': null };
  const previewed = await preview(admin, start.id, batch.body.data.version, selections, authorMappings);
  assert.equal(previewed.status, 200, JSON.stringify(previewed.body));
  assert.match(previewed.body.data.contentDigest, /^[0-9a-f]{64}$/);
  assert.match(previewed.body.data.planHash, /^[0-9a-f]{64}$/);
  assert.equal(previewed.body.data.job.state, 'previewed');
  assert.equal(previewed.body.data.plan.resources.posts[0].authorId, memberId);
  assert.equal(previewed.body.data.plan.resources.posts[0].authorLabel, 'Synthetic legacy author');
  assert.equal(previewed.body.data.plan.resources.characters.length, 0);
  assert.ok(previewed.body.data.report.excluded.some((item) => item.resourceType === 'character' && item.legacyId === 'character-1'));
  assert.doesNotMatch(previewed.body.data.plan.resources.posts[0].fields.content, /onclick|script/i);

  const frozenBatch = await request(admin, `/legacy-imports/${start.id}/batches/1`, {
    method: 'PUT', body: { payload: content },
  });
  assert.equal(frozenBatch.status, 409);
  assert.equal(frozenBatch.body.code, 'IMPORT_BATCHES_FROZEN');

  const wrongHash = await request(admin, `/legacy-imports/${start.id}/commit`, {
    method: 'POST', body: { expectedVersion: previewed.body.data.job.version, planHash: 'f'.repeat(64) },
  });
  assert.equal(wrongHash.status, 409);
  assert.equal(wrongHash.body.code, 'IMPORT_PLAN_CONFLICT');

  const staleVersion = await request(admin, `/legacy-imports/${start.id}/commit`, {
    method: 'POST', body: { expectedVersion: batch.body.data.version, planHash: previewed.body.data.planHash },
  });
  assert.equal(staleVersion.status, 409);
  assert.equal(staleVersion.body.code, 'STALE_VERSION');

  const committed = await request(admin, `/legacy-imports/${start.id}/commit`, {
    method: 'POST', body: { expectedVersion: previewed.body.data.job.version, planHash: previewed.body.data.planHash },
  });
  assert.equal(committed.status, 200, JSON.stringify(committed.body));
  assert.equal(committed.body.data.job.state, 'committed');
  assert.equal(committed.body.data.report.imported.categories, 1);
  assert.equal(committed.body.data.report.imported.threads, 1);
  assert.equal(committed.body.data.report.imported.posts, 1);
  assert.equal(committed.body.data.report.imported.characters, 0);

  const targetId = committed.body.data.job.importId;
  fixture.importIds.push(targetId);
  const live = await sql`
    SELECT t.id AS thread_id, t.author_id AS thread_author, p.id AS post_id, p.author_id AS post_author,
      p.author_label, p.content, p.post_no, c.name AS category_name
    FROM threads t JOIN posts p ON p.thread_id = t.id JOIN categories c ON c.id = t.category_id
    WHERE t.id = ${previewed.body.data.plan.resources.threads[0].targetId}`;
  assert.equal(live.length, 1);
  assert.equal(live[0].thread_author, memberId);
  assert.equal(live[0].post_author, memberId);
  assert.equal(live[0].author_label, 'Synthetic legacy author');
  assert.equal(live[0].post_no, 1);
  assert.match(live[0].category_name, /Synthetic category/);
  assert.doesNotMatch(live[0].content, /onclick|script/i);

  const replayMetadata = {
    sourceId: randomUUID(),
    exportId: randomUUID(),
    rawSnapshotSha256: 'b'.repeat(64),
    legacyOrigin: 'synthetic replay metadata changed',
  };
  const secondJob = await startJob(otherAdmin, fixture, { batchCount: 2, ...replayMetadata });
  const splitBatches = [
    { categories: content.categories, attributionLabels: content.attributionLabels },
    { threads: content.threads, posts: content.posts, characters: content.characters, scenes: [] },
  ];
  let version = secondJob.version;
  for (let index = 0; index < splitBatches.length; index += 1) {
    const uploaded = await request(otherAdmin, `/legacy-imports/${secondJob.id}/batches/${index + 1}`, {
      method: 'PUT', body: { payload: splitBatches[index] },
    });
    assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
    version = uploaded.body.data.version;
  }
  const replayPreview = await preview(otherAdmin, secondJob.id, version, selections, authorMappings);
  assert.equal(replayPreview.status, 200, JSON.stringify(replayPreview.body));
  assert.equal(replayPreview.body.data.contentDigest, previewed.body.data.contentDigest);
  assert.equal(replayPreview.body.data.job.state, 'replay');
  assert.equal(replayPreview.body.data.plan.existingImportId, targetId);
  const replay = await request(otherAdmin, `/legacy-imports/${secondJob.id}/commit`, {
    method: 'POST', body: { expectedVersion: replayPreview.body.data.job.version, planHash: replayPreview.body.data.planHash },
  });
  assert.equal(replay.status, 200, JSON.stringify(replay.body));
  assert.equal(replay.body.data.replayed, true);
  assert.equal(replay.body.data.report.imported.categories, 0);
  assert.equal(replay.body.data.report.alreadyImported.posts, 1);
  fixture.importIds.push(replay.body.data.job.importId);

  const counts = await sql`
    SELECT (SELECT count(*)::integer FROM categories WHERE id = ${previewed.body.data.plan.resources.categories[0].targetId}) AS categories,
      (SELECT count(*)::integer FROM threads WHERE id = ${previewed.body.data.plan.resources.threads[0].targetId}) AS threads,
      (SELECT count(*)::integer FROM posts WHERE id = ${previewed.body.data.plan.resources.posts[0].targetId}) AS posts,
      (SELECT count(*)::integer FROM legacy_import_provenance WHERE import_id = ${targetId}) AS provenance`;
  assert.deepEqual(counts[0], { categories: 1, threads: 1, posts: 1, provenance: 2 });
  const replayProvenance = await sql`
    SELECT source_id, export_id, raw_snapshot_sha256, origin_label
    FROM legacy_import_provenance WHERE import_id = ${targetId}`;
  assert.ok(replayProvenance.some((row) => row.source_id === replayMetadata.sourceId
    && row.export_id === replayMetadata.exportId
    && row.raw_snapshot_sha256 === replayMetadata.rawSnapshotSha256
    && row.origin_label === replayMetadata.legacyOrigin));
});

test('IMP-03 numeric legacy author decisions retain the label and null account attribution after import', async (t) => {
  const fixture = await makeFixture(t, ['admin']);
  const adminId = fixture.users[0].id;
  const admin = await sessionFor(adminId);
  const legacyAuthorId = 73142;
  const legacyAuthorLabel = 'Synthetic sample legacy author';
  const content = {
    categories: [{
      id: 'numeric-author-category',
      name: `Synthetic numeric-author category ${fixture.suffix}`,
      description: 'Synthetic category description',
    }],
    attributionLabels: [{ id: legacyAuthorId, username: legacyAuthorLabel }],
    threads: [{
      id: 'numeric-author-thread',
      catId: 'numeric-author-category',
      title: `Synthetic numeric-author topic ${fixture.suffix}`,
      authorId: legacyAuthorId,
      pinned: false,
      locked: false,
      archived: false,
    }],
    posts: [{
      id: 'numeric-author-post',
      threadId: 'numeric-author-thread',
      authorId: legacyAuthorId,
      content: '<p>Synthetic post with unresolved legacy attribution.</p>',
      edited: false,
    }],
    characters: [],
    scenes: [],
  };
  const job = await startJob(admin, fixture);
  const uploaded = await request(admin, `/legacy-imports/${job.id}/batches/1`, {
    method: 'PUT', body: { payload: content },
  });
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));

  const authorMappings = { [String(legacyAuthorId)]: null };
  const planned = await preview(admin, job.id, uploaded.body.data.version, allSelections(content), authorMappings);
  assert.equal(planned.status, 200, JSON.stringify(planned.body));
  assert.equal(planned.body.data.plan.authorMappings[String(legacyAuthorId)], null);
  assert.equal(planned.body.data.plan.resources.threads[0].authorId, null);
  assert.equal(planned.body.data.plan.resources.threads[0].authorLabel, legacyAuthorLabel);
  assert.equal(planned.body.data.plan.resources.posts[0].authorId, null);
  assert.equal(planned.body.data.plan.resources.posts[0].authorLabel, legacyAuthorLabel);
  assert.deepEqual(planned.body.data.report.unresolved, [
    { resourceType: 'thread', legacyId: 'numeric-author-thread', authorLegacyId: String(legacyAuthorId), reason: 'legacy_label_retained' },
    { resourceType: 'post', legacyId: 'numeric-author-post', authorLegacyId: String(legacyAuthorId), reason: 'legacy_label_retained' },
  ]);

  const committed = await request(admin, `/legacy-imports/${job.id}/commit`, {
    method: 'POST', body: { expectedVersion: planned.body.data.job.version, planHash: planned.body.data.planHash },
  });
  assert.equal(committed.status, 200, JSON.stringify(committed.body));
  assert.equal(committed.body.data.job.state, 'committed');
  assert.deepEqual(committed.body.data.report.unresolved, planned.body.data.report.unresolved);

  const stored = await sql`
    SELECT j.created_by, t.author_id AS thread_author_id, t.author_label AS thread_author_label,
      p.author_id AS post_author_id, p.author_label AS post_author_label
    FROM legacy_import_jobs j
    JOIN threads t ON t.id = ${planned.body.data.plan.resources.threads[0].targetId}
    JOIN posts p ON p.id = ${planned.body.data.plan.resources.posts[0].targetId}
    WHERE j.id = ${job.id}`;
  assert.equal(stored.length, 1);
  assert.equal(stored[0].created_by, adminId);
  assert.equal(stored[0].thread_author_id, null);
  assert.equal(stored[0].post_author_id, null);
  assert.equal(stored[0].thread_author_label, legacyAuthorLabel);
  assert.equal(stored[0].post_author_label, legacyAuthorLabel);
});

test('IMP-01 selected characters commit to the canonical table and replay without duplication', async (t) => {
  const fixture = await makeFixture(t, ['admin']);
  const adminId = fixture.users[0].id;
  const admin = await sessionFor(adminId);
  const characterName = `Synthetic imported character ${fixture.suffix}`;
  const content = {
    categories: [],
    attributionLabels: [{ id: 'legacy-character-author', username: 'Synthetic character author' }],
    threads: [],
    posts: [],
    characters: [{
      id: 'single-character',
      nome: characterName,
      categoria: 'Synthetic category',
      titulo: 'Synthetic title',
      authorId: 'legacy-character-author',
      descricao: '<p>Synthetic imported character description.</p>',
    }],
    scenes: [],
  };
  const start = await startJob(admin, fixture);
  const upload = await request(admin, `/legacy-imports/${start.id}/batches/1`, {
    method: 'PUT', body: { payload: content },
  });
  assert.equal(upload.status, 201, JSON.stringify(upload.body));
  const authorMappings = { 'legacy-character-author': adminId };
  const planned = await preview(admin, start.id, upload.body.data.version, allSelections(content), authorMappings);
  assert.equal(planned.status, 200, JSON.stringify(planned.body));
  assert.equal(planned.body.data.plan.resources.characters.length, 1);
  assert.equal(planned.body.data.plan.resources.characters[0].authorId, adminId);

  const committed = await request(admin, `/legacy-imports/${start.id}/commit`, {
    method: 'POST', body: { expectedVersion: planned.body.data.job.version, planHash: planned.body.data.planHash },
  });
  assert.equal(committed.status, 200, JSON.stringify(committed.body));
  assert.equal(committed.body.data.report.imported.characters, 1);
  fixture.importIds.push(committed.body.data.job.importId);

  const targetId = planned.body.data.plan.resources.characters[0].targetId;
  const stored = await sql`
    SELECT id, author_id, nome, descricao FROM personagens WHERE id = ${targetId}`;
  assert.equal(stored.length, 1);
  assert.equal(stored[0].author_id, adminId);
  assert.equal(stored[0].nome, characterName);
  assert.match(stored[0].descricao, /Synthetic imported character description/);

  const replayJob = await startJob(admin, fixture, { sourceId: randomUUID(), exportId: randomUUID() });
  const replayUpload = await request(admin, `/legacy-imports/${replayJob.id}/batches/1`, {
    method: 'PUT', body: { payload: content },
  });
  assert.equal(replayUpload.status, 201, JSON.stringify(replayUpload.body));
  const replayPlan = await preview(admin, replayJob.id, replayUpload.body.data.version,
    allSelections(content), authorMappings);
  assert.equal(replayPlan.status, 200, JSON.stringify(replayPlan.body));
  const replay = await request(admin, `/legacy-imports/${replayJob.id}/commit`, {
    method: 'POST', body: { expectedVersion: replayPlan.body.data.job.version, planHash: replayPlan.body.data.planHash },
  });
  assert.equal(replay.status, 200, JSON.stringify(replay.body));
  assert.equal(replay.body.data.replayed, true);
  assert.equal(replay.body.data.report.alreadyImported.characters, 1);
  assert.equal(replay.body.data.report.imported.characters, 0);
  const count = await sql`SELECT count(*)::integer AS count FROM personagens WHERE lower(nome) = lower(${characterName})`;
  assert.equal(count[0].count, 1);
});

test('IMP-01 interleaved source posts keep per-topic order and next reply numbers', async (t) => {
  const fixture = await makeFixture(t, ['admin']);
  const admin = await sessionFor(fixture.users[0].id);
  const suffix = fixture.suffix;
  const content = {
    categories: [{ id: 'interleaved-category', name: `Synthetic interleaved ${suffix}`, description: '' }],
    attributionLabels: [{ id: 'interleaved-author', username: 'Synthetic interleaved author' }],
    threads: [
      { id: 'topic-a', catId: 'interleaved-category', title: `Synthetic topic A ${suffix}`, authorId: 'interleaved-author' },
      { id: 'topic-b', catId: 'interleaved-category', title: `Synthetic topic B ${suffix}`, authorId: 'interleaved-author' },
    ],
    posts: [
      { id: 'topic-a-opening', threadId: 'topic-a', authorId: 'interleaved-author', content: '<p>A opening.</p>' },
      { id: 'topic-b-opening', threadId: 'topic-b', authorId: 'interleaved-author', content: '<p>B opening.</p>' },
      { id: 'topic-a-reply-1', threadId: 'topic-a', authorId: 'interleaved-author', content: '<p>A reply one.</p>' },
      { id: 'topic-b-reply-1', threadId: 'topic-b', authorId: 'interleaved-author', content: '<p>B reply one.</p>' },
      { id: 'topic-a-reply-2', threadId: 'topic-a', authorId: 'interleaved-author', content: '<p>A reply two.</p>' },
    ],
    characters: [],
    scenes: [],
  };
  const start = await startJob(admin, fixture);
  const upload = await request(admin, `/legacy-imports/${start.id}/batches/1`, {
    method: 'PUT', body: { payload: content },
  });
  assert.equal(upload.status, 201, JSON.stringify(upload.body));
  const planned = await preview(admin, start.id, upload.body.data.version, allSelections(content), { 'interleaved-author': null });
  assert.equal(planned.status, 200, JSON.stringify(planned.body));
  const ordinals = Object.fromEntries(planned.body.data.plan.resources.posts.map((post) => [post.legacyId, post.sourceOrdinal]));
  assert.deepEqual(ordinals, {
    'topic-a-opening': 0,
    'topic-b-opening': 0,
    'topic-a-reply-1': 1,
    'topic-b-reply-1': 1,
    'topic-a-reply-2': 2,
  });

  const committed = await request(admin, `/legacy-imports/${start.id}/commit`, {
    method: 'POST', body: { expectedVersion: planned.body.data.job.version, planHash: planned.body.data.planHash },
  });
  assert.equal(committed.status, 200, JSON.stringify(committed.body));
  fixture.importIds.push(committed.body.data.job.importId);
  const topicIds = Object.fromEntries(planned.body.data.plan.resources.threads.map((thread) => [thread.legacyId, thread.targetId]));
  const stored = await sql`
    SELECT id, next_post_no FROM threads WHERE id = ANY(${sql.array(Object.values(topicIds), 2950)})`;
  assert.deepEqual(Object.fromEntries(stored.map((row) => [
    Object.entries(topicIds).find(([, id]) => id === row.id)[0], Number(row.next_post_no),
  ])), { 'topic-a': 4, 'topic-b': 3 });

  for (const [topic, expectedNext] of [['topic-a', 4], ['topic-b', 3]]) {
    const reply = await forumRequest(admin, `/threads/${topicIds[topic]}/posts`, {
      method: 'POST', key: randomUUID(), body: { content: `<p>Synthetic ${topic} next reply.</p>` },
    });
    assert.equal(reply.status, 201, JSON.stringify(reply.body));
    assert.equal(reply.body.data.postNo, expectedNext);
  }
});

test('IMP-01 expanded canonical import advances an existing topic before normal replies', async (t) => {
  const fixture = await makeFixture(t, ['admin']);
  const admin = await sessionFor(fixture.users[0].id);
  const sourceId = randomUUID();
  const content = {
    categories: [{ id: 'expanded-category', name: `Synthetic expanded ${fixture.suffix}`, description: '' }],
    attributionLabels: [{ id: 'expanded-author', username: 'Synthetic expanded author' }],
    threads: [{
      id: 'expanded-topic', catId: 'expanded-category', title: `Synthetic expanded topic ${fixture.suffix}`,
      authorId: 'expanded-author', locked: false, archived: false,
    }],
    posts: [
      { id: 'expanded-opening', threadId: 'expanded-topic', authorId: 'expanded-author', content: '<p>Opening post.</p>' },
      { id: 'expanded-reply', threadId: 'expanded-topic', authorId: 'expanded-author', content: '<p>Historical reply.</p>' },
    ],
    characters: [],
    scenes: [],
  };
  const authorMappings = { 'expanded-author': null };
  const firstJob = await startJob(admin, fixture, { sourceId });
  const firstUpload = await request(admin, `/legacy-imports/${firstJob.id}/batches/1`, {
    method: 'PUT', body: { payload: content },
  });
  assert.equal(firstUpload.status, 201, JSON.stringify(firstUpload.body));
  const partialSelections = {
    categories: ['expanded-category'],
    threads: ['expanded-topic'],
    posts: ['expanded-opening'],
    characters: [],
    scenes: [],
  };
  const firstPreview = await preview(admin, firstJob.id, firstUpload.body.data.version, partialSelections, authorMappings);
  assert.equal(firstPreview.status, 200, JSON.stringify(firstPreview.body));
  const firstCommit = await request(admin, `/legacy-imports/${firstJob.id}/commit`, {
    method: 'POST', body: {
      expectedVersion: firstPreview.body.data.job.version,
      planHash: firstPreview.body.data.planHash,
    },
  });
  assert.equal(firstCommit.status, 200, JSON.stringify(firstCommit.body));
  const threadId = firstPreview.body.data.plan.resources.threads[0].targetId;
  fixture.importIds.push(firstCommit.body.data.job.importId);
  const firstState = await sql`SELECT next_post_no FROM threads WHERE id = ${threadId}`;
  assert.equal(Number(firstState[0].next_post_no), 2);

  const expandedJob = await startJob(admin, fixture, {
    sourceId,
    exportId: randomUUID(),
    rawSnapshotSha256: 'c'.repeat(64),
  });
  const expandedUpload = await request(admin, `/legacy-imports/${expandedJob.id}/batches/1`, {
    method: 'PUT', body: { payload: content },
  });
  assert.equal(expandedUpload.status, 201, JSON.stringify(expandedUpload.body));
  const expandedPreview = await preview(admin, expandedJob.id, expandedUpload.body.data.version,
    allSelections(content), authorMappings);
  assert.equal(expandedPreview.status, 200, JSON.stringify(expandedPreview.body));
  assert.equal(expandedPreview.body.data.contentDigest, firstPreview.body.data.contentDigest);
  assert.equal(expandedPreview.body.data.plan.existingImportId, firstCommit.body.data.job.importId);
  const expandedCommit = await request(admin, `/legacy-imports/${expandedJob.id}/commit`, {
    method: 'POST', body: {
      expectedVersion: expandedPreview.body.data.job.version,
      planHash: expandedPreview.body.data.planHash,
    },
  });
  assert.equal(expandedCommit.status, 200, JSON.stringify(expandedCommit.body));
  assert.equal(expandedCommit.body.data.replayed, true);
  assert.equal(expandedCommit.body.data.report.imported.posts, 1);
  assert.equal(expandedCommit.body.data.report.alreadyImported.posts, 1);

  const importedPosts = await sql`SELECT post_no FROM posts WHERE thread_id = ${threadId} ORDER BY post_no`;
  assert.deepEqual(importedPosts.map((row) => Number(row.post_no)), [1, 2]);
  const nextSequence = await sql`SELECT next_post_no FROM threads WHERE id = ${threadId}`;
  assert.equal(Number(nextSequence[0].next_post_no), 3);
  const reply = await forumRequest(admin, `/threads/${threadId}/posts`, {
    method: 'POST', key: randomUUID(), body: { content: '<p>Normal reply after expanded import.</p>' },
  });
  assert.equal(reply.status, 201, JSON.stringify(reply.body));
  assert.equal(reply.body.data.postNo, 3);
});

test('IMP-02 incomplete parents are reported and a commit-time conflict rolls back the full selected batch', async (t) => {
  const fixture = await makeFixture(t, ['admin']);
  const admin = await sessionFor(fixture.users[0].id);
  const content = sampleContent(fixture.suffix);
  const start = await startJob(admin, fixture);
  const upload = await request(admin, `/legacy-imports/${start.id}/batches/1`, {
    method: 'PUT', body: { payload: content },
  });
  assert.equal(upload.status, 201);

  const incomplete = await preview(admin, start.id, upload.body.data.version,
    { categories: [], threads: ['thread-1'], posts: ['post-1'], characters: [], scenes: [] },
    { 'legacy-author-7': null });
  assert.equal(incomplete.status, 200, JSON.stringify(incomplete.body));
  assert.ok(incomplete.body.data.report.missingParents.some((item) => item.resourceType === 'thread'));
  assert.ok(incomplete.body.data.report.excluded.some((item) => item.resourceType === 'post'));
  assert.equal(incomplete.body.data.report.imported.threads, 0);

  const freshContent = sampleContent(`${fixture.suffix}-rollback`);
  const rollbackJob = await startJob(admin, fixture, { sourceId: randomUUID(), exportId: randomUUID() });
  const rollbackUpload = await request(admin, `/legacy-imports/${rollbackJob.id}/batches/1`, {
    method: 'PUT', body: { payload: freshContent },
  });
  assert.equal(rollbackUpload.status, 201);
  const rollbackPreview = await preview(admin, rollbackJob.id, rollbackUpload.body.data.version,
    allSelections(freshContent), { 'legacy-author-7': null, 'legacy-character-author': null });
  assert.equal(rollbackPreview.status, 200, JSON.stringify(rollbackPreview.body));

  const conflictCategory = await sql`
    INSERT INTO categories (name, description)
    VALUES (${freshContent.categories[0].name}, 'Synthetic concurrent human edit') RETURNING id`;
  fixture.extraCategoryIds.push(conflictCategory[0].id);
  const commit = await request(admin, `/legacy-imports/${rollbackJob.id}/commit`, {
    method: 'POST', body: { expectedVersion: rollbackPreview.body.data.job.version, planHash: rollbackPreview.body.data.planHash },
  });
  assert.equal(commit.status, 409);
  assert.equal(commit.body.code, 'RESOURCE_CONFLICT');
  const state = await sql`SELECT state, committed_at, import_id FROM legacy_import_jobs WHERE id = ${rollbackJob.id}`;
  assert.equal(state[0].state, 'previewed');
  assert.equal(state[0].committed_at, null);
  assert.equal(state[0].import_id, null);
  const partial = await sql`
    SELECT (SELECT count(*)::integer FROM legacy_imports WHERE content_digest = ${rollbackPreview.body.data.contentDigest}) AS imports,
      (SELECT count(*)::integer FROM legacy_import_targets WHERE import_id IN
        (SELECT id FROM legacy_imports WHERE content_digest = ${rollbackPreview.body.data.contentDigest})) AS targets,
      (SELECT count(*)::integer FROM threads WHERE id = ${rollbackPreview.body.data.plan.resources.threads[0].targetId}) AS threads,
      (SELECT count(*)::integer FROM posts WHERE id = ${rollbackPreview.body.data.plan.resources.posts[0].targetId}) AS posts`;
  assert.deepEqual(partial[0], { imports: 0, targets: 0, threads: 0, posts: 0 });
});

async function makeFixture(t, roles) {
  const fixture = { users: [], jobIds: [], importIds: [], categoryIds: [], extraCategoryIds: [], suffix: randomUUID().slice(0, 8) };
  t.after(async () => cleanFixture(fixture));
  for (const [index, role] of roles.entries()) {
    const username = `legacy-import-${role}-${fixture.suffix}-${index}`;
    const rows = await sql`
      INSERT INTO users (username, email, password_hash, role)
      VALUES (${username}, ${`${username}@example.test`}, 'synthetic-test-hash', ${role})
      RETURNING id`;
    fixture.users.push({ id: rows[0].id, role });
  }
  return fixture;
}

async function cleanFixture(fixture) {
  for (const jobId of fixture.jobIds) {
    const rows = await sql`SELECT import_id FROM legacy_import_jobs WHERE id = ${jobId} AND import_id IS NOT NULL`;
    for (const row of rows) if (row.import_id) fixture.importIds.push(String(row.import_id));
  }
  for (const jobId of fixture.jobIds) {
    await sql`DELETE FROM legacy_import_batches WHERE job_id = ${jobId}`;
    await sql`DELETE FROM legacy_import_jobs WHERE id = ${jobId}`;
  }
  for (const importId of [...new Set(fixture.importIds)]) {
    const targets = await sql`SELECT resource_type, target_id FROM legacy_import_targets WHERE import_id = ${importId}`;
    await sql`DELETE FROM audit_events WHERE target_id = ${importId}`;
    await sql`DELETE FROM legacy_import_source_mappings WHERE import_id = ${importId}`;
    await sql`DELETE FROM legacy_import_targets WHERE import_id = ${importId}`;
    await sql`DELETE FROM legacy_import_provenance WHERE import_id = ${importId}`;
    const ids = (type) => targets.filter((row) => row.resource_type === type).map((row) => String(row.target_id));
    const sceneIds = ids('scene');
    if (sceneIds.length) {
      const sceneArray = sql.array(sceneIds, 2950);
      await sql`DELETE FROM scene_turn_migration_issues WHERE scene_id = ANY(${sceneArray})`;
      await sql`DELETE FROM scene_turns WHERE scene_id = ANY(${sceneArray})`;
      await sql`DELETE FROM scene_turn_migrations WHERE scene_id = ANY(${sceneArray})`;
      await sql`DELETE FROM scene_turn_legacy_backups WHERE scene_id = ANY(${sceneArray})`;
      await sql`DELETE FROM wiki_posts WHERE id = ANY(${sceneArray})`;
    }
    const postIds = ids('post');
    if (postIds.length) await sql`DELETE FROM posts WHERE id = ANY(${sql.array(postIds, 2950)})`;
    const threadIds = ids('thread');
    if (threadIds.length) {
      const threadArray = sql.array(threadIds, 2950);
      await sql`DELETE FROM posts WHERE thread_id = ANY(${threadArray})`;
      await sql`DELETE FROM threads WHERE id = ANY(${threadArray})`;
    }
    const categoryIds = ids('category');
    if (categoryIds.length) await sql`DELETE FROM categories WHERE id = ANY(${sql.array(categoryIds, 2950)})`;
    const characterIds = ids('character');
    if (characterIds.length) await sql`DELETE FROM personagens WHERE id = ANY(${sql.array(characterIds, 2950)})`;
    await sql`DELETE FROM legacy_imports WHERE id = ${importId}`;
  }
  for (const categoryId of fixture.extraCategoryIds) await sql`DELETE FROM categories WHERE id = ${categoryId}`;
  for (const user of fixture.users) {
    await sql`DELETE FROM audit_events WHERE actor_id = ${user.id}`;
    await sql`DELETE FROM request_keys WHERE actor_id = ${user.id}`;
    await sql`DELETE FROM users WHERE id = ${user.id}`;
  }
}

async function sessionFor(userId) {
  const response = await fetch(`${baseUrl}/__fixture/session/${userId}`);
  assert.equal(response.status, 200);
  const cookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie() : [response.headers.get('set-cookie') || ''];
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
  const response = await fetch(`${baseUrl}/api/admin${route}`, {
    method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

async function forumRequest(session, route, { method = 'GET', body, key } = {}) {
  const headers = { cookie: session.cookie, 'x-csrf-token': session.csrfToken };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (key) headers['idempotency-key'] = key;
  const response = await fetch(`${baseUrl}/api/forum${route}`, {
    method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

function manifest(options = {}) {
  return {
    sourceId: options.sourceId || randomUUID(),
    exportId: options.exportId || randomUUID(),
    rawSnapshotSha256: options.rawSnapshotSha256 || 'a'.repeat(64),
    legacyOrigin: options.legacyOrigin || 'synthetic integration fixture',
    batchCount: options.batchCount || 1,
  };
}

async function startJob(session, fixture, options = {}) {
  const response = await request(session, '/legacy-imports', { method: 'POST', body: manifest(options) });
  assert.ok([200, 201].includes(response.status), JSON.stringify(response.body));
  if (!fixture.jobIds.includes(response.body.data.id)) fixture.jobIds.push(response.body.data.id);
  return response.body.data;
}

async function preview(session, jobId, expectedVersion, selections, authorMappings) {
  return request(session, `/legacy-imports/${jobId}/preview`, {
    method: 'POST', body: { expectedVersion, selections, authorMappings },
  });
}

function sampleContent(suffix) {
  return {
    categories: [{ id: 'category-1', name: `Synthetic category ${suffix}`, description: 'Synthetic category description' }],
    attributionLabels: [
      { id: 'legacy-author-7', username: 'Synthetic legacy author' },
      { id: 'legacy-character-author', username: 'Synthetic unmapped character author' },
    ],
    threads: [{
      id: 'thread-1', catId: 'category-1', title: `Synthetic topic ${suffix}`, tag: 'recovery',
      authorId: 'legacy-author-7', pinned: false, locked: false, archived: false,
    }],
    posts: [{
      id: 'post-1', threadId: 'thread-1', authorId: 'legacy-author-7', date: '31/12/2025 23:45',
      content: '<p onclick="alert(1)">Synthetic <strong>opening post</strong>.</p><script>alert(2)</script>', edited: false,
    }],
    characters: [{
      id: 'character-1', nome: `Synthetic character ${suffix}`, authorId: 'legacy-character-author',
      descricao: '<p>Synthetic character description.</p>',
    }],
    scenes: [],
  };
}

function allSelections(content) {
  return {
    categories: content.categories.map((item) => item.id),
    threads: content.threads.map((item) => item.id),
    posts: content.posts.map((item) => item.id),
    characters: content.characters.map((item) => item.id),
    scenes: content.scenes.map((item) => item.id),
  };
}
