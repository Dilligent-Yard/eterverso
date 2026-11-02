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
const { createForumRouter } = require('../../server/forum');

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

  sql = postgres(testDatabaseUrl, { prepare: false, max: 8, connect_timeout: 5, idle_timeout: 2, connection: { timezone: 'UTC' } });
  const identity = await sql`SELECT current_database() AS database, current_user AS username`;
  assert.equal(identity[0].database, 'eterverso_test');
  assert.equal(identity[0].username, 'eterverso_test');

  auth = createAuth({ sql, config: { sessionSecret: `forum-tests-${randomUUID()}` } });
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use(cookieSession(createCookieSessionOptions({ sessionSecret: `forum-cookies-${randomUUID()}` })));
  app.use(auth.csrfProtection);
  app.get('/__fixture/session/:id', async (req, res, next) => {
    try {
      const rows = await sql`
        SELECT id, auth_version FROM users WHERE id = ${req.params.id} AND disabled_at IS NULL LIMIT 1`;
      if (!rows.length) return res.status(404).json({ error: 'Fixture account not found.' });
      const csrfToken = auth.issueSession(req, rows[0]);
      return res.json({ csrfToken });
    } catch (error) {
      return next(error);
    }
  });
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

test('FOR-01 creates a topic and opening post atomically and replays only the same request', async (t) => {
  const fixture = await makeFixture(t, ['member']);
  const member = fixture.users.member1;
  const session = await sessionFor(member.id);
  const key = randomUUID();
  const requestBody = {
    categoryId: fixture.categoryId,
    title: 'Synthetic transaction check',
    tag: 'test',
    content: '<p onclick="bad()">Synthetic <strong>opening</strong>.</p><script>bad()</script>',
  };

  const created = await request(session, '/threads', { method: 'POST', body: requestBody, key });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const threadId = created.body.data.thread.id;
  const openingPostId = created.body.data.openingPost.id;
  fixture.threadIds.push(threadId);
  fixture.postIds.push(openingPostId);
  assert.equal(created.body.data.openingPost.postNo, 1);
  assert.doesNotMatch(created.body.data.openingPost.content, /script|onclick/i);

  const retry = await request(session, '/threads', { method: 'POST', body: requestBody, key });
  assert.equal(retry.status, 201, JSON.stringify(retry.body));
  assert.equal(retry.body.data.thread.id, threadId);
  assert.equal(retry.body.data.openingPost.id, openingPostId);

  const changed = await request(session, '/threads', {
    method: 'POST', body: { ...requestBody, title: 'Different synthetic title' }, key,
  });
  assert.equal(changed.status, 409);
  assert.equal(changed.body.code, 'IDEMPOTENCY_CONFLICT');

  const counts = await sql`
    SELECT (SELECT count(*)::int FROM threads WHERE id = ${threadId}) AS threads,
           (SELECT count(*)::int FROM posts WHERE thread_id = ${threadId}) AS posts`;
  assert.deepEqual(counts[0], { threads: 1, posts: 1 });
});

test('FOR-01 rolls back the topic when opening-post insertion fails', async (t) => {
  const fixture = await makeFixture(t, ['member']);
  const member = fixture.users.member1;
  const session = await sessionFor(member.id);
  const title = `Synthetic rollback check ${randomUUID()}`;
  const key = randomUUID();
  const removeFailureTrigger = await installOpeningPostFailureTrigger();
  t.after(removeFailureTrigger);

  const failed = await request(session, '/threads', {
    method: 'POST',
    key,
    body: {
      categoryId: fixture.categoryId,
      title,
      tag: 'test',
      content: '<p>FORUM_TEST_FAIL_OPENING_POST</p>',
    },
  });

  assert.equal(failed.status, 500);
  assert.equal(failed.body.code, 'INTERNAL_ERROR');
  const persisted = await sql`
    SELECT (SELECT count(*)::int FROM threads
            WHERE category_id = ${fixture.categoryId} AND author_id = ${member.id} AND title = ${title}) AS threads,
           (SELECT count(*)::int FROM posts p JOIN threads th ON th.id = p.thread_id
            WHERE th.category_id = ${fixture.categoryId} AND th.author_id = ${member.id} AND th.title = ${title}) AS posts,
           (SELECT count(*)::int FROM request_keys
            WHERE actor_id = ${member.id} AND operation = 'forum.topic.create' AND idempotency_key = ${key}) AS request_keys`;
  assert.deepEqual(persisted[0], { threads: 0, posts: 0, request_keys: 0 });
});

test('FOR-02 public category and post reads expose shared server counts and stable pagination', async (t) => {
  const fixture = await makeFixture(t, ['member']);
  const session = await sessionFor(fixture.users.member1.id);
  const thread = await createTopic(fixture, session);
  const reply = await request(session, `/threads/${thread.id}/posts`, {
    method: 'POST', body: { content: '<p>Synthetic shared reply.</p>' }, key: randomUUID(),
  });
  assert.equal(reply.status, 201);
  fixture.postIds.push(reply.body.data.id);

  const categories = await request(null, '/categories?limit=100');
  assert.equal(categories.status, 200);
  const category = categories.body.data.find((item) => item.id === fixture.categoryId);
  assert.equal(category.topicsCount, 1);
  assert.equal(category.postsCount, 2);

  const firstPage = await request(null, `/threads/${thread.id}/posts?limit=1&offset=0`);
  const secondPage = await request(null, `/threads/${thread.id}/posts?limit=1&offset=1`);
  assert.equal(firstPage.status, 200);
  assert.equal(secondPage.status, 200);
  assert.equal(firstPage.body.page.hasMore, true);
  assert.equal(secondPage.body.page.offset, 1);
  assert.equal(firstPage.body.data[0].postNo, 1);
  assert.equal(secondPage.body.data[0].postNo, 2);
  assert.notEqual(firstPage.body.data[0].id, secondPage.body.data[0].id);
});

test('FOR-03 category locks serialize reply versus moderation, and concurrent replies keep unique order', async (t) => {
  const fixture = await makeFixture(t, ['member', 'moderador']);
  const memberSession = await sessionFor(fixture.users.member1.id);
  const staffSession = await sessionFor(fixture.users.moderador.id);
  const thread = await createTopic(fixture, memberSession);

  const releaseCategory = await holdRowLock('categories', fixture.categoryId);
  const replyDuringLock = request(memberSession, `/threads/${thread.id}/posts`, {
    method: 'POST', body: { content: '<p>Racing synthetic reply.</p>' }, key: randomUUID(),
  });
  const staffLock = request(staffSession, `/threads/${thread.id}/moderate`, {
    method: 'POST',
    body: { action: 'lock', reason: 'Synthetic concurrency check', expectedVersion: 1 },
  });
  try {
    await waitForBlockedStatements('categories', 2);
  } finally {
    await releaseCategory();
  }
  const [replyResult, lockResult] = await Promise.all([replyDuringLock, staffLock]);
  assert.equal(lockResult.status, 200);
  assert.ok(replyResult.status === 201 || (replyResult.status === 409 && replyResult.body.code === 'THREAD_LOCKED'));
  fixture.postIds.push(...(replyResult.body.data?.id ? [replyResult.body.data.id] : []));
  assert.equal(lockResult.body.data.locked, true);

  const unlocked = await request(staffSession, `/threads/${thread.id}/moderate`, {
    method: 'POST',
    body: { action: 'unlock', reason: 'Continue synthetic check', expectedVersion: 2 },
  });
  assert.equal(unlocked.status, 200);

  const releaseActor = await holdRowLock('users', fixture.users.member1.id);
  const first = request(memberSession, `/threads/${thread.id}/posts`, {
    method: 'POST', body: { content: '<p>Concurrent synthetic reply A.</p>' }, key: randomUUID(),
  });
  const second = request(memberSession, `/threads/${thread.id}/posts`, {
    method: 'POST', body: { content: '<p>Concurrent synthetic reply B.</p>' }, key: randomUUID(),
  });
  try {
    await waitForBlockedStatements('users', 2);
  } finally {
    await releaseActor();
  }
  const results = await Promise.all([first, second]);
  assert.deepEqual(results.map((result) => result.status), [201, 201], JSON.stringify(results.map((result) => result.body)));
  fixture.postIds.push(results[0].body.data.id, results[1].body.data.id);
  const ordered = await sql`
    SELECT post_no FROM posts WHERE thread_id = ${thread.id} ORDER BY post_no ASC`;
  const expectedPostCount = replyResult.status === 201 ? 4 : 3;
  assert.deepEqual(ordered.map((row) => Number(row.post_no)), Array.from({ length: expectedPostCount }, (_value, index) => index + 1));
});

test('FOR-04 edits require ownership, exact fields and the current version', async (t) => {
  const fixture = await makeFixture(t, ['member', 'member']);
  const ownerSession = await sessionFor(fixture.users.member1.id);
  const otherSession = await sessionFor(fixture.users.member2.id);
  const thread = await createTopic(fixture, ownerSession);

  const edit = await request(ownerSession, `/threads/${thread.id}`, {
    method: 'PATCH', body: { title: 'Updated synthetic title', tag: 'review', expectedVersion: 1 },
  });
  assert.equal(edit.status, 200);
  assert.equal(edit.body.data.version, 2);
  assert.equal(edit.body.data.title, 'Updated synthetic title');

  const stale = await request(ownerSession, `/threads/${thread.id}`, {
    method: 'PATCH', body: { title: 'Stale synthetic title', tag: 'review', expectedVersion: 1 },
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'STALE_VERSION');

  const missingVersion = await request(ownerSession, `/threads/${thread.id}`, {
    method: 'PATCH', body: { title: 'Missing version', tag: '' },
  });
  assert.equal(missingVersion.status, 428);

  const forbidden = await request(otherSession, `/threads/${thread.id}`, {
    method: 'PATCH', body: { title: 'Other member', tag: '', expectedVersion: 2 },
  });
  assert.equal(forbidden.status, 403);

  const otherMemberPostEdit = await request(otherSession, `/posts/${thread.openingPostId}`, {
    method: 'PATCH', body: { content: '<p>Other member edit.</p>', summary: 'Unauthorized fixture edit', expectedVersion: 1 },
  });
  assert.equal(otherMemberPostEdit.status, 403);

  const forged = await request(ownerSession, `/threads/${thread.id}`, {
    method: 'PATCH', body: { title: 'Forged member', tag: '', expectedVersion: 2, authorId: fixture.users.member2.id },
  });
  assert.equal(forged.status, 400);
  assert.equal(forged.body.code, 'INVALID_SHAPE');

  for (const forgedField of [
    { role: 'admin' },
    { authorRole: 'admin' },
    { is_staff: true },
    { locked: true },
    { pinned: true },
    { moderationAction: 'archive' },
  ]) {
    const rejected = await request(ownerSession, `/threads/${thread.id}`, {
      method: 'PATCH',
      body: { title: 'Updated synthetic title', tag: 'review', expectedVersion: 2, ...forgedField },
    });
    assert.equal(rejected.status, 400, JSON.stringify(forgedField));
    assert.equal(rejected.body.code, 'INVALID_SHAPE', JSON.stringify(forgedField));
  }

  const postEdit = await request(ownerSession, `/posts/${thread.openingPostId}`, {
    method: 'PATCH', body: { content: '<p>Edited synthetic opening.</p>', summary: 'Fixture correction', expectedVersion: 1 },
  });
  assert.equal(postEdit.status, 200);
  assert.equal(postEdit.body.data.version, 2);

  for (const forgedField of [
    { role: 'admin' },
    { authorRole: 'admin' },
    { is_staff: true },
    { deletedAt: new Date().toISOString() },
    { moderationAction: 'hide' },
  ]) {
    const rejected = await request(ownerSession, `/posts/${thread.openingPostId}`, {
      method: 'PATCH',
      body: {
        content: '<p>Edited synthetic opening.</p>',
        summary: 'Fixture correction',
        expectedVersion: 2,
        ...forgedField,
      },
    });
    assert.equal(rejected.status, 400, JSON.stringify(forgedField));
    assert.equal(rejected.body.code, 'INVALID_SHAPE', JSON.stringify(forgedField));
  }

  const revisions = await sql`SELECT version, content, summary FROM post_revisions WHERE post_id = ${thread.openingPostId}`;
  assert.equal(revisions.length, 1);
  assert.equal(revisions[0].version, 1);
  assert.equal(revisions[0].content, '<p>Synthetic opening.</p>');
});

test('FOR-05 locked and archived threads remain readable but reject ordinary writes; staff moderation is audited', async (t) => {
  const fixture = await makeFixture(t, ['member', 'moderador']);
  const targetCategoryId = await addCategory(fixture, 'Synthetic move destination');
  const ownerSession = await sessionFor(fixture.users.member1.id);
  const staffSession = await sessionFor(fixture.users.moderador.id);
  const thread = await createTopic(fixture, ownerSession);
  const reply = await request(ownerSession, `/threads/${thread.id}/posts`, {
    method: 'POST', body: { content: '<p>Synthetic removable reply.</p>' }, key: randomUUID(),
  });
  assert.equal(reply.status, 201);
  fixture.postIds.push(reply.body.data.id);

  const protectedOpening = await request(ownerSession, `/posts/${thread.openingPostId}/hide`, {
    method: 'POST', body: { reason: 'Synthetic opening check', expectedVersion: 1 },
  });
  assert.equal(protectedOpening.status, 403);
  assert.equal(protectedOpening.body.code, 'OPENING_POST_PROTECTED');

  const pinned = await request(staffSession, `/threads/${thread.id}/moderate`, {
    method: 'POST', body: { action: 'pin', reason: 'Synthetic prominence review', expectedVersion: 1 },
  });
  assert.equal(pinned.status, 200);
  assert.equal(pinned.body.data.pinned, true);
  const unpinned = await request(staffSession, `/threads/${thread.id}/moderate`, {
    method: 'POST', body: { action: 'unpin', reason: 'Synthetic prominence review complete', expectedVersion: 2 },
  });
  assert.equal(unpinned.status, 200);

  const locked = await request(staffSession, `/threads/${thread.id}/moderate`, {
    method: 'POST', body: { action: 'lock', reason: 'Synthetic safety review', expectedVersion: 3 },
  });
  assert.equal(locked.status, 200);
  const blockedReply = await request(ownerSession, `/threads/${thread.id}/posts`, {
    method: 'POST', body: { content: '<p>Must not be appended.</p>' }, key: randomUUID(),
  });
  assert.equal(blockedReply.status, 409);
  assert.equal(blockedReply.body.code, 'THREAD_LOCKED');

  for (const [label, session, route, body] of [
    ['owner title', ownerSession, `/threads/${thread.id}`, { title: 'Owner cannot edit locked title', tag: '', expectedVersion: 4 }],
    ['staff title', staffSession, `/threads/${thread.id}`, { title: 'Staff cannot bypass lock', tag: '', expectedVersion: 4 }],
    ['owner body', ownerSession, `/posts/${reply.body.data.id}`, { content: '<p>Owner cannot edit locked body.</p>', summary: 'Locked fixture edit', expectedVersion: 1 }],
    ['staff body', staffSession, `/posts/${reply.body.data.id}`, { content: '<p>Staff cannot edit locked body.</p>', summary: 'Locked fixture edit', expectedVersion: 1 }],
  ]) {
    const blockedEdit = await request(session, route, { method: 'PATCH', body });
    assert.equal(blockedEdit.status, 409, label);
    assert.equal(blockedEdit.body.code, 'THREAD_LOCKED', label);
  }

  const hidden = await request(staffSession, `/posts/${reply.body.data.id}/hide`, {
    method: 'POST', body: { reason: 'Synthetic moderation reason', expectedVersion: 1 },
  });
  assert.equal(hidden.status, 200);
  assert.equal(hidden.body.data.deleted, true);
  assert.equal(Object.hasOwn(hidden.body.data, 'content'), false);

  const hiddenRead = await request(null, `/threads/${thread.id}/posts`);
  const tombstone = hiddenRead.body.data.find((post) => post.id === reply.body.data.id);
  assert.equal(tombstone.deleted, true);
  assert.equal(Object.hasOwn(tombstone, 'content'), false);

  const restored = await request(staffSession, `/posts/${reply.body.data.id}/restore`, {
    method: 'POST', body: { reason: 'Synthetic restore review', expectedVersion: 2 },
  });
  assert.equal(restored.status, 200);
  assert.equal(restored.body.data.deleted, false);
  assert.match(restored.body.data.content, /Synthetic removable reply/);

  const unarchivedLock = await request(staffSession, `/threads/${thread.id}/moderate`, {
    method: 'POST', body: { action: 'unlock', reason: 'Synthetic lock release', expectedVersion: 4 },
  });
  assert.equal(unarchivedLock.status, 200);
  const archived = await request(staffSession, `/threads/${thread.id}/moderate`, {
    method: 'POST', body: { action: 'archive', reason: 'Synthetic historical record', expectedVersion: 5 },
  });
  assert.equal(archived.status, 200);
  assert.ok(archived.body.data.archivedAt);

  const archivedReply = await request(ownerSession, `/threads/${thread.id}/posts`, {
    method: 'POST', body: { content: '<p>Archived reply must fail.</p>' }, key: randomUUID(),
  });
  assert.equal(archivedReply.status, 409);
  assert.equal(archivedReply.body.code, 'THREAD_ARCHIVED');
  for (const [label, session, route, body] of [
    ['owner title', ownerSession, `/threads/${thread.id}`, { title: 'Owner cannot edit archived title', tag: '', expectedVersion: 6 }],
    ['staff title', staffSession, `/threads/${thread.id}`, { title: 'Staff cannot edit archived title', tag: '', expectedVersion: 6 }],
    ['owner body', ownerSession, `/posts/${reply.body.data.id}`, { content: '<p>Owner cannot edit archived body.</p>', summary: 'Archived fixture edit', expectedVersion: 3 }],
    ['staff body', staffSession, `/posts/${reply.body.data.id}`, { content: '<p>Staff cannot edit archived body.</p>', summary: 'Archived fixture edit', expectedVersion: 3 }],
  ]) {
    const archivedEdit = await request(session, route, { method: 'PATCH', body });
    assert.equal(archivedEdit.status, 409, label);
    assert.equal(archivedEdit.body.code, 'THREAD_ARCHIVED', label);
  }

  const moved = await request(staffSession, `/threads/${thread.id}/moderate`, {
    method: 'POST',
    body: {
      action: 'move', targetCategoryId, reason: 'Synthetic category organization', expectedVersion: 6,
    },
  });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.data.categoryId, targetCategoryId);

  const historical = await request(null, `/threads/${thread.id}`);
  assert.equal(historical.status, 200);
  assert.ok(historical.body.data.archivedAt);
  const audit = await sql`
    SELECT action FROM audit_events WHERE target_id = ${thread.id} OR target_id = ${reply.body.data.id}
    ORDER BY created_at ASC`;
  assert.deepEqual(audit.map((row) => row.action).sort(), [
    'forum.thread.pin', 'forum.thread.unpin', 'forum.thread.lock',
    'forum.post.hide', 'forum.post.restore', 'forum.thread.unlock',
    'forum.thread.archive', 'forum.thread.move',
  ].sort());
});

async function makeFixture(t, roles) {
  const fixture = { categoryId: null, categoryIds: [], users: {}, threadIds: [], postIds: [] };
  t.after(async () => cleanFixture(fixture));
  const suffix = randomUUID().slice(0, 8);
  const categories = await sql`
    INSERT INTO categories (name, description)
    VALUES (${'Forum fixture ' + suffix}, 'Synthetic integration category')
    RETURNING id`;
  fixture.categoryId = categories[0].id;
  fixture.categoryIds.push(fixture.categoryId);
  for (let index = 0; index < roles.length; index += 1) {
    const key = roles[index] === 'member'
      ? `member${Object.keys(fixture.users).filter((name) => name.startsWith('member')).length + 1}`
      : roles[index];
    const username = `forum-${key}-${suffix}`;
    const users = await sql`
      INSERT INTO users (username, email, password_hash, role)
      VALUES (${username}, ${`${username}@example.test`}, 'test-only-hash', ${roles[index]})
      RETURNING id`;
    fixture.users[key] = { id: users[0].id, role: roles[index] };
  }
  return fixture;
}

async function addCategory(fixture, label) {
  const suffix = randomUUID().slice(0, 8);
  const rows = await sql`
    INSERT INTO categories (name, description)
    VALUES (${`${label} ${suffix}`}, 'Synthetic integration category')
    RETURNING id`;
  fixture.categoryIds.push(rows[0].id);
  return rows[0].id;
}

async function cleanFixture(fixture) {
  for (const user of Object.values(fixture.users)) {
    await sql`DELETE FROM request_keys WHERE actor_id = ${user.id}`;
    await sql`DELETE FROM audit_events WHERE actor_id = ${user.id}`;
  }
  for (const postId of fixture.postIds) {
    await sql`DELETE FROM audit_events WHERE target_id = ${postId}`;
    await sql`DELETE FROM post_revisions WHERE post_id = ${postId}`;
  }
  for (const threadId of fixture.threadIds) {
    await sql`DELETE FROM audit_events WHERE target_id = ${threadId}`;
    await sql`DELETE FROM posts WHERE thread_id = ${threadId}`;
    await sql`DELETE FROM threads WHERE id = ${threadId}`;
  }
  for (const postId of fixture.postIds) await sql`DELETE FROM posts WHERE id = ${postId}`;
  for (const user of Object.values(fixture.users)) await sql`DELETE FROM users WHERE id = ${user.id}`;
  for (const categoryId of fixture.categoryIds) await sql`DELETE FROM categories WHERE id = ${categoryId}`;
}

async function installOpeningPostFailureTrigger() {
  const suffix = randomUUID().replaceAll('-', '');
  const functionName = `forum_test_fail_${suffix}`;
  const triggerName = `forum_test_fail_${suffix}`;
  const cleanup = async () => {
    await sql.unsafe(`DROP TRIGGER IF EXISTS ${triggerName} ON public.posts`);
    await sql.unsafe(`DROP FUNCTION IF EXISTS public.${functionName}()`);
  };
  try {
    await sql.unsafe(`
      CREATE FUNCTION public.${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.post_no = 1 AND NEW.content = '<p>FORUM_TEST_FAIL_OPENING_POST</p>' THEN
          RAISE EXCEPTION 'Synthetic failure after topic insertion';
        END IF;
        RETURN NEW;
      END;
      $$`);
    await sql.unsafe(`
      CREATE TRIGGER ${triggerName}
      BEFORE INSERT ON public.posts
      FOR EACH ROW EXECUTE FUNCTION public.${functionName}()`);
    return cleanup;
  } catch (error) {
    await cleanup();
    throw error;
  }
}

async function createTopic(fixture, session) {
  const response = await request(session, '/threads', {
    method: 'POST',
    body: {
      categoryId: fixture.categoryId,
      title: 'Synthetic fixture topic',
      tag: '',
      content: '<p>Synthetic opening.</p>',
    },
    key: randomUUID(),
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  const thread = {
    id: response.body.data.thread.id,
    openingPostId: response.body.data.openingPost.id,
  };
  fixture.threadIds.push(thread.id);
  fixture.postIds.push(thread.openingPostId);
  return thread;
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

async function request(session, route, options = {}) {
  const headers = {};
  if (session) {
    headers.cookie = session.cookie;
    headers['x-csrf-token'] = session.csrfToken;
  }
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.key) headers['idempotency-key'] = options.key;
  const response = await fetch(`${baseUrl}/api/forum${route}`, {
    method: options.method || 'GET',
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  return { status: response.status, body: await response.json() };
}

async function holdRowLock(table, id) {
  let release;
  let signalReady;
  const gate = new Promise((resolve) => { release = resolve; });
  const ready = new Promise((resolve) => { signalReady = resolve; });
  const held = sql.begin(async (tx) => {
    if (table === 'categories') {
      await tx`SELECT id FROM categories WHERE id = ${id} FOR UPDATE`;
    } else if (table === 'users') {
      await tx`SELECT id FROM users WHERE id = ${id} FOR UPDATE`;
    } else {
      throw new Error('Unsupported test lock target.');
    }
    signalReady();
    await gate;
  });
  await ready;
  return async () => {
    release();
    await held;
  };
}

async function waitForBlockedStatements(table, expected) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const rows = await sql`
      SELECT count(*)::int AS count
      FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
        AND state = 'active' AND query ILIKE ${`%FROM ${table}%`}
        AND query ILIKE '%FOR UPDATE%'`;
    if (rows[0].count >= expected) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`Timed out waiting for ${expected} requests to block on ${table} row locks.`);
}
