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
const { normalizeSceneTurns } = require('../../server/scene-turn-normalizer');

const ROOT = path.resolve(__dirname, '../..');
const testDatabaseUrl = process.env.ETERVERSO_TEST_DATABASE_URL;

let sql;
let apiServer;
let sessionServer;
let apiBaseUrl;
let sessionBaseUrl;
let sceneAuth;

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

  const config = { sessionSecret: `scene-tests-${randomUUID()}`, secureCookies: false };
  sceneAuth = createAuth({ sql, config });
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
      const csrfToken = sceneAuth.issueSession(req, rows[0]);
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

test('SCN-01 rejects forged initial turns and serializes append, edit, and hide with ownership and versions', async (t) => {
  const fixture = await makeFixture(t, ['member', 'member', 'member', 'moderador']);
  const ownerSession = await sessionFor(fixture.users.member1.id);
  const otherSession = await sessionFor(fixture.users.member2.id);
  const appendSession = await sessionFor(fixture.users.member3.id);
  const staffSession = await sessionFor(fixture.users.moderador.id);

  const forgedInitial = await request(staffSession, '/api/wiki-posts', {
    method: 'POST',
    body: {
      titulo: 'Forged initial-turn fixture',
      descricao: '<p>Synthetic scene description.</p>',
      turns: [{ id: 'forged-turn', authorId: fixture.users.member2.id, authorRole: 'admin', content: '<p>Forged actor.</p>' }],
    },
  });
  assert.equal(forgedInitial.status, 400);
  assert.equal(forgedInitial.body.code, 'INITIAL_TURNS_NOT_ALLOWED');

  const scene = await createScene(fixture, staffSession, 'SCN-01 concurrent fixture');
  const forgedAppend = await request(ownerSession, `/api/wiki-posts/${scene.id}/turns`, {
    method: 'POST', body: { content: '<p>Forged author.</p>', authorId: fixture.users.member2.id },
  });
  assert.equal(forgedAppend.status, 400);
  assert.equal(forgedAppend.body.code, 'INVALID_SHAPE');

  const first = await appendTurn(scene.id, ownerSession, '<p>First synthetic turn.</p>');
  const second = await appendTurn(scene.id, otherSession, '<p>Second synthetic turn.</p>');
  assert.equal(first.body.turno.authorId, fixture.users.member1.id);
  assert.equal(first.body.turno.authorName, fixture.users.member1.username);
  assert.equal(first.body.turno.version, 1);
  fixture.turnIds.push(first.body.turno.id, second.body.turno.id);

  const forbidden = await request(otherSession, `/api/wiki-posts/${scene.id}/turns/${first.body.turno.id}`, {
    method: 'PUT', body: { content: '<p>Other member edit.</p>', expectedVersion: 1 },
  });
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.body.code, 'FORBIDDEN');

  const releaseScene = await holdSceneRowLock(scene.id);
  const concurrent = [
    request(ownerSession, `/api/wiki-posts/${scene.id}/turns/${first.body.turno.id}`, {
      method: 'PUT', body: { content: '<p>Concurrent owner edit.</p>', expectedVersion: 1 },
    }),
    request(otherSession, `/api/wiki-posts/${scene.id}/turns/${second.body.turno.id}/hide`, {
      method: 'POST', body: { expectedVersion: 1 },
    }),
    request(appendSession, `/api/wiki-posts/${scene.id}/turns`, {
      method: 'POST', body: { content: '<p>Concurrent appended turn.</p>' },
    }),
  ];
  try {
    await waitForBlockedSceneStatements(3);
  } finally {
    await releaseScene();
  }
  const [edited, hidden, appended] = await Promise.all(concurrent);
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.equal(edited.body.turno.version, 2);
  assert.equal(hidden.status, 200, JSON.stringify(hidden.body));
  assert.equal(hidden.body.wikiPost.turns.some((turn) => turn.id === second.body.turno.id), false);
  assert.equal(appended.status, 201, JSON.stringify(appended.body));
  fixture.turnIds.push(appended.body.turno.id);

  const stale = await request(ownerSession, `/api/wiki-posts/${scene.id}/turns/${first.body.turno.id}`, {
    method: 'PUT', body: { content: '<p>Stale owner edit.</p>', expectedVersion: 1 },
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'STALE_VERSION');
  const missingVersion = await request(ownerSession, `/api/wiki-posts/${scene.id}/turns/${first.body.turno.id}`, {
    method: 'PUT', body: { content: '<p>Missing version.</p>' },
  });
  assert.equal(missingVersion.status, 428);
  assert.equal(missingVersion.body.code, 'PRECONDITION_REQUIRED');

  const publicRead = await request(null, `/api/wiki-posts/${scene.id}`);
  assert.equal(publicRead.status, 200);
  assert.deepEqual(publicRead.body.wikiPost.turns.map((turn) => turn.id), [
    first.body.turno.id,
    appended.body.turno.id,
  ]);
  assert.match(publicRead.body.wikiPost.turns[0].content, /Concurrent owner edit/);
  assert.doesNotMatch(publicRead.body.wikiPost.turns[0].content, /script|onclick/i);

  const stored = await sql`
    SELECT id, ordinal, version, deleted_at, content FROM scene_turns
    WHERE scene_id = ${scene.id} ORDER BY ordinal`;
  assert.deepEqual(stored.map((row) => Number(row.ordinal)), [0, 1, 2]);
  assert.deepEqual(stored.map((row) => Number(row.version)), [2, 2, 1]);
  assert.equal(stored[1].deleted_at === null, false);
  assert.equal(stored[1].content, '<p>Second synthetic turn.</p>');

  const memberRestore = await request(otherSession, `/api/wiki-posts/${scene.id}/turns/${second.body.turno.id}/restore`, {
    method: 'POST', body: { expectedVersion: 2 },
  });
  assert.equal(memberRestore.status, 403);
  const staffRestore = await request(staffSession, `/api/wiki-posts/${scene.id}/turns/${second.body.turno.id}/restore`, {
    method: 'POST', body: { expectedVersion: 2 },
  });
  assert.equal(staffRestore.status, 200, JSON.stringify(staffRestore.body));
  assert.equal(staffRestore.body.wikiPost.turns.find((turn) => turn.id === second.body.turno.id).version, 3);

  const parent = await sql`SELECT version FROM wiki_posts WHERE id = ${scene.id}`;
  assert.equal(Number(parent[0].version), 7);
});

test('SCN-02 normalizes only synthetic scenes, preserves source/order/mappings, and stays idempotent after child writes', async (t) => {
  const fixture = await makeFixture(t, ['member', 'moderador']);
  const mappedAuthor = fixture.users.member1;
  const unknownAuthorId = randomUUID();
  const sharedLegacyId = 'legacy-shared-turn';
  const firstSource = [
    {
      id: sharedLegacyId,
      authorId: mappedAuthor.id,
      authorName: mappedAuthor.username,
      content: '<p>First <script>unsafe()</script> synthetic turn.</p>',
      date: 'Imported date label; timezone not known',
    },
    {
      id: 'legacy-only-in-first-scene',
      authorId: unknownAuthorId,
      authorName: 'Unmapped synthetic author',
      authorRole: 'admin',
      content: '<p>Second synthetic turn.</p>',
      date: 'Original date text 2',
      turnTitle: 'Legacy title',
    },
  ];
  const secondSource = [
    {
      id: sharedLegacyId,
      authorId: mappedAuthor.id,
      authorName: mappedAuthor.username,
      content: '<p>Second scene original turn.</p>',
      date: 'Original date text B1',
    },
    {
      id: 'legacy-only-in-second-scene',
      authorId: mappedAuthor.id,
      authorName: mappedAuthor.username,
      content: '<p>Second scene hide candidate.</p>',
      date: 'Original date text B2',
    },
  ];
  const malformedSource = [
    { id: 'duplicate-legacy-id', authorName: 'First duplicate', content: '<p>Duplicate first.</p>' },
    { id: 'duplicate-legacy-id', authorName: 'Second duplicate', content: '<p>Duplicate second.</p>' },
    { id: 'safe-partial-turn', authorName: 'Safe partial turn', content: '<p>This safe turn remains recoverable.</p>' },
    { id: 'unsafe-content-turn', authorName: 'Unsafe content', content: '<script>removed entirely</script>' },
  ];
  const firstScene = await addLegacyScene(fixture, mappedAuthor.id, 'SCN-02 first legacy scene', firstSource);
  const secondScene = await addLegacyScene(fixture, mappedAuthor.id, 'SCN-02 second legacy scene', secondSource);
  const malformedScene = await addLegacyScene(fixture, mappedAuthor.id, 'SCN-02 malformed legacy scene', malformedSource);

  const normalizerSql = restrictNormalizerToScenes(
    [firstScene.id, secondScene.id, malformedScene.id],
    [mappedAuthor.id, unknownAuthorId],
  );
  const initial = await normalizeSceneTurns({ sql: normalizerSql });
  assert.equal(initial.scenesScanned, 3);
  assert.equal(initial.scenesNormalized, 2);
  assert.equal(initial.scenesIncomplete, 1);
  assert.equal(initial.scenesFailed, 0);

  const normalizedRows = [
    ...(await sql`
      SELECT scene_id, author_id, legacy_author_label, legacy_id, ordinal, content, presentation
      FROM scene_turns WHERE scene_id = ${firstScene.id} ORDER BY ordinal`),
    ...(await sql`
      SELECT scene_id, author_id, legacy_author_label, legacy_id, ordinal, content, presentation
      FROM scene_turns WHERE scene_id = ${secondScene.id} ORDER BY ordinal`),
  ];
  const firstRows = normalizedRows.filter((row) => row.scene_id === firstScene.id);
  assert.deepEqual(firstRows.map((row) => Number(row.ordinal)), [0, 1]);
  assert.deepEqual(firstRows.map((row) => row.legacy_id), [sharedLegacyId, 'legacy-only-in-first-scene']);
  assert.equal(firstRows[0].author_id, mappedAuthor.id);
  assert.equal(firstRows[0].presentation.date, firstSource[0].date);
  assert.doesNotMatch(firstRows[0].content, /script|unsafe\(\)/i);
  assert.equal(firstRows[1].author_id, null);
  assert.equal(firstRows[1].legacy_author_label, 'Unmapped synthetic author');
  assert.equal(firstRows[1].presentation.date, firstSource[1].date);
  const unknownAuthorIssues = await sql`
    SELECT ordinal, reason FROM scene_turn_migration_issues
    WHERE scene_id = ${firstScene.id} ORDER BY ordinal, reason`;
  assert.deepEqual(unknownAuthorIssues.map((row) => [Number(row.ordinal), row.reason]), [
    [0, 'content_formatting_sanitized'],
    [1, 'legacy_role_ignored'],
    [1, 'unknown_author_id'],
  ]);

  const backups = [
    ...(await sql`SELECT scene_id, turns, legacy_sha256 FROM scene_turn_legacy_backups WHERE scene_id = ${firstScene.id}`),
    ...(await sql`SELECT scene_id, turns, legacy_sha256 FROM scene_turn_legacy_backups WHERE scene_id = ${secondScene.id}`),
    ...(await sql`SELECT scene_id, turns, legacy_sha256 FROM scene_turn_legacy_backups WHERE scene_id = ${malformedScene.id}`),
  ];
  const firstBackup = backups.find((row) => row.scene_id === firstScene.id);
  const malformedBackup = backups.find((row) => row.scene_id === malformedScene.id);
  assert.deepEqual(firstBackup.turns, firstSource);
  assert.equal(firstBackup.legacy_sha256, hashCanonicalJson(firstSource));
  assert.deepEqual(malformedBackup.turns, malformedSource);
  assert.equal(malformedBackup.legacy_sha256, hashCanonicalJson(malformedSource));

  const migrationRows = [
    ...(await sql`SELECT scene_id, turn_count, legacy_sha256 FROM scene_turn_migrations WHERE scene_id = ${firstScene.id}`),
    ...(await sql`SELECT scene_id, turn_count, legacy_sha256 FROM scene_turn_migrations WHERE scene_id = ${secondScene.id}`),
    ...(await sql`SELECT scene_id, turn_count, legacy_sha256 FROM scene_turn_migrations WHERE scene_id = ${malformedScene.id}`),
  ];
  assert.equal(migrationRows.length, 2);
  assert.equal(Number(migrationRows.find((row) => row.scene_id === firstScene.id).turn_count), 2);
  assert.equal(migrationRows.find((row) => row.scene_id === firstScene.id).legacy_sha256, firstBackup.legacy_sha256);
  assert.equal(migrationRows.some((row) => row.scene_id === malformedScene.id), false);

  const issueRows = await sql`
    SELECT ordinal, reason FROM scene_turn_migration_issues
    WHERE scene_id = ${malformedScene.id} ORDER BY ordinal, reason`;
  assert.deepEqual(issueRows.map((row) => [Number(row.ordinal), row.reason]), [
    [0, 'duplicate_legacy_id'],
    [1, 'duplicate_legacy_id'],
    [3, 'content_formatting_sanitized'],
    [3, 'empty_content_after_sanitization'],
  ]);
  const partialRows = await sql`SELECT legacy_id, ordinal FROM scene_turns WHERE scene_id = ${malformedScene.id}`;
  assert.deepEqual(partialRows.map((row) => [row.legacy_id, Number(row.ordinal)]), [['safe-partial-turn', 2]]);

  const firstRerun = await normalizeSceneTurns({ sql: normalizerSql });
  assert.equal(firstRerun.scenesAlreadyNormalized, 2);
  assert.equal(firstRerun.scenesIncomplete, 1);
  const issuesAfterFirstRerun = await sql`SELECT count(*)::int AS count FROM scene_turn_migration_issues WHERE scene_id = ${malformedScene.id}`;
  assert.equal(issuesAfterFirstRerun[0].count, issueRows.length);

  const moderatorSession = await sessionFor(fixture.users.moderador.id);
  const memberSession = await sessionFor(mappedAuthor.id);
  const foreignScopedId = await request(moderatorSession, `/api/wiki-posts/${secondScene.id}/turns/legacy-only-in-first-scene`, {
    method: 'PUT', body: { content: '<p>Must not resolve across scenes.</p>', expectedVersion: 1 },
  });
  assert.equal(foreignScopedId.status, 404);
  assert.equal(foreignScopedId.body.code, 'NOT_FOUND');

  const appended = await appendTurn(secondScene.id, memberSession, '<p>Post-migration append.</p>');
  assert.equal(appended.status, 201);
  const scopedEdit = await request(moderatorSession, `/api/wiki-posts/${secondScene.id}/turns/${sharedLegacyId}`, {
    method: 'PUT', body: { content: '<p>Post-migration scoped edit.</p>', expectedVersion: 1 },
  });
  assert.equal(scopedEdit.status, 200, JSON.stringify(scopedEdit.body));
  assert.equal(scopedEdit.body.turno.id, sharedLegacyId);
  const scopedHide = await request(moderatorSession, `/api/wiki-posts/${secondScene.id}/turns/legacy-only-in-second-scene/hide`, {
    method: 'POST', body: { expectedVersion: 1 },
  });
  assert.equal(scopedHide.status, 200, JSON.stringify(scopedHide.body));

  const firstSceneRead = await request(null, `/api/wiki-posts/${firstScene.id}`);
  const secondSceneRead = await request(null, `/api/wiki-posts/${secondScene.id}`);
  assert.deepEqual(firstSceneRead.body.wikiPost.turns.map((turn) => turn.id), [sharedLegacyId, 'legacy-only-in-first-scene']);
  assert.match(firstSceneRead.body.wikiPost.turns[0].content, /First/);
  assert.deepEqual(secondSceneRead.body.wikiPost.turns.map((turn) => turn.id), [sharedLegacyId, appended.body.turno.id]);
  assert.match(secondSceneRead.body.wikiPost.turns[0].content, /Post-migration scoped edit/);

  const originalSourceStillPresent = await sql`SELECT turns FROM wiki_posts WHERE id = ${secondScene.id}`;
  assert.deepEqual(originalSourceStillPresent[0].turns, secondSource);
  const childStateBeforeRerun = await sql`
    SELECT ordinal, legacy_id, version, deleted_at, content FROM scene_turns
    WHERE scene_id = ${secondScene.id} ORDER BY ordinal`;
  assert.deepEqual(childStateBeforeRerun.map((row) => Number(row.ordinal)), [0, 1, 2]);
  assert.deepEqual(childStateBeforeRerun.map((row) => Number(row.version)), [2, 2, 1]);
  assert.notEqual(childStateBeforeRerun[1].deleted_at, null);

  const postWriteRerun = await normalizeSceneTurns({ sql: normalizerSql });
  assert.equal(postWriteRerun.scenesAlreadyNormalized, 2);
  assert.equal(postWriteRerun.scenesIncomplete, 1);
  assert.equal(postWriteRerun.issues.some((issue) => issue.sceneId === secondScene.id && issue.reason === 'normalized_state_mismatch'), false);
  const childStateAfterRerun = await sql`
    SELECT ordinal, legacy_id, version, deleted_at, content FROM scene_turns
    WHERE scene_id = ${secondScene.id} ORDER BY ordinal`;
  assert.deepEqual(childStateAfterRerun.map((row) => ({
    ordinal: Number(row.ordinal), legacyId: row.legacy_id, version: Number(row.version),
    hidden: row.deleted_at !== null, content: row.content,
  })), childStateBeforeRerun.map((row) => ({
    ordinal: Number(row.ordinal), legacyId: row.legacy_id, version: Number(row.version),
    hidden: row.deleted_at !== null, content: row.content,
  })));
});

async function makeFixture(t, roles) {
  const fixture = { users: {}, sceneIds: [], turnIds: [] };
  t.after(async () => cleanFixture(fixture));
  const suffix = randomUUID().slice(0, 8);
  for (const role of roles) {
    const key = role === 'member'
      ? `member${Object.keys(fixture.users).filter((name) => name.startsWith('member')).length + 1}`
      : role;
    const username = `scene-${key}-${suffix}`;
    const rows = await sql`
      INSERT INTO users (username, email, password_hash, role)
      VALUES (${username}, ${`${username}@example.test`}, 'test-only-hash', ${role})
      RETURNING id`;
    fixture.users[key] = { id: rows[0].id, role, username };
  }
  return fixture;
}

async function createScene(fixture, session, label) {
  const response = await request(session, '/api/wiki-posts', {
    method: 'POST',
    body: {
      titulo: `${label} ${randomUUID().slice(0, 8)}`,
      subtitulo: '',
      categoria: 'Cena de RPG',
      status: 'Em Andamento',
      resumo: '',
      banner: '',
      descricao: '<p>Synthetic scene fixture.</p>',
      theme: {},
      infobox: {},
      blocks: [],
    },
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  const scene = response.body.wikiPost;
  fixture.sceneIds.push(scene.id);
  assert.equal(scene.turns.length, 0);
  return scene;
}

async function addLegacyScene(fixture, authorId, label, turns) {
  const rows = await sql`
    INSERT INTO wiki_posts (author_id, titulo, descricao, turns)
    VALUES (${authorId}, ${`${label} ${randomUUID().slice(0, 8)}`}, '<p>Synthetic legacy scene.</p>', ${sql.json(turns)})
    RETURNING id`;
  fixture.sceneIds.push(rows[0].id);
  return { id: rows[0].id, turns };
}

async function cleanFixture(fixture) {
  for (const sceneId of fixture.sceneIds) {
    await sql`DELETE FROM scene_turn_migration_issues WHERE scene_id = ${sceneId}`;
    await sql`DELETE FROM scene_turn_migrations WHERE scene_id = ${sceneId}`;
    await sql`DELETE FROM scene_turn_legacy_backups WHERE scene_id = ${sceneId}`;
    await sql`DELETE FROM scene_turns WHERE scene_id = ${sceneId}`;
    await sql`DELETE FROM wiki_posts WHERE id = ${sceneId}`;
  }
  for (const user of Object.values(fixture.users)) {
    await sql`DELETE FROM users WHERE id = ${user.id}`;
  }
}

async function appendTurn(sceneId, session, content) {
  const response = await request(session, `/api/wiki-posts/${sceneId}/turns`, {
    method: 'POST', body: { content },
  });
  return response;
}

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
  }
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${apiBaseUrl}${route}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

async function holdSceneRowLock(sceneId) {
  let release;
  let signalReady;
  const gate = new Promise((resolve) => { release = resolve; });
  const ready = new Promise((resolve) => { signalReady = resolve; });
  const held = sql.begin(async (tx) => {
    await tx`SELECT id FROM wiki_posts WHERE id = ${sceneId} FOR UPDATE`;
    signalReady();
    await gate;
  });
  await ready;
  return async () => {
    release();
    await held;
  };
}

async function waitForBlockedSceneStatements(expected) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const rows = await sql`
      SELECT count(*)::int AS count
      FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
        AND state = 'active' AND query ILIKE '%FROM wiki_posts%'
        AND query ILIKE '%FOR UPDATE%'`;
    if (rows[0].count >= expected) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${expected} requests to block on the scene row lock.`);
}

function restrictNormalizerToScenes(sceneIds, authorIds) {
  function wrap(executor, root = false) {
    const scoped = async function (strings, ...values) {
      const normalizedQuery = strings.join(' ').replace(/\s+/g, ' ').trim();
      if (root && normalizedQuery === 'SELECT id FROM wiki_posts ORDER BY id') {
        const groups = await Promise.all(sceneIds.map((sceneId) => executor`
          SELECT id FROM wiki_posts WHERE id = ${sceneId}`));
        return groups.flat().sort((left, right) => String(left.id).localeCompare(String(right.id)));
      }
      if (normalizedQuery.startsWith('SELECT id FROM users WHERE id = ANY(')) {
        const groups = await Promise.all(authorIds.map((authorId) => executor`
          SELECT id FROM users WHERE id = ${authorId}`));
        return groups.flat();
      }
      return executor(strings, ...values);
    };
    scoped.json = (value) => executor.json(value);
    scoped.array = (values, type) => executor.array(values, type);
    if (root) scoped.begin = (callback) => executor.begin((tx) => callback(wrap(tx)));
    return scoped;
  }
  return wrap(sql, true);
}

function hashCanonicalJson(value) {
  function canonical(item) {
    if (item === null || typeof item !== 'object') return JSON.stringify(item);
    if (Array.isArray(item)) return `[${item.map(canonical).join(',')}]`;
    return `{${Object.keys(item).sort().map((key) => `${JSON.stringify(key)}:${canonical(item[key])}`).join(',')}}`;
  }
  return createHash('sha256').update(canonical(value), 'utf8').digest('hex');
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
