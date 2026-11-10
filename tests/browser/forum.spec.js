'use strict';

const { test, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const postgres = require('postgres');
const { createApp } = require('../../server/app');

const ROOT = path.resolve(__dirname, '../..');
const LEGACY_KEY = 'forum-antigo-db-v22';
const REQUIRED_MIGRATION = '0017_timeline_events';
const PASSWORD = 'Synthetic-browser-password-42';
let sql;
let server;
let origin;
let serverRecord;
let fixture;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  assert.equal(process.env.DATABASE_URL, undefined, 'Use npm run test:browser; do not pass a development connection.');
  assert.equal(process.env.DEV_DATABASE_URL, undefined, 'Use the isolated browser-test runner.');
  const dsn = process.env.ETERVERSO_TEST_DATABASE_URL;
  assert.ok(dsn, 'The guarded runner must supply ETERVERSO_TEST_DATABASE_URL.');
  // Ownership/port validation reads local test metadata and Docker labels; it
  // does not connect to, reset or otherwise mutate the development database.
  const targetRecord = JSON.parse(execFileSync(process.execPath, [path.join(ROOT, 'scripts/test-env.js'), 'assert'], {
    cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  }));
  const target = new URL(dsn);
  assert.equal(target.hostname, '127.0.0.1');
  assert.equal(target.pathname, '/eterverso_test');
  assert.equal(decodeURIComponent(target.username), 'eterverso_test');
  assert.equal(Number(target.port), targetRecord.port);
  sql = postgres(dsn, { prepare: false, max: 5, connect_timeout: 5, idle_timeout: 2 });
  const current = await sql`SELECT current_database() AS database, current_user AS username`;
  assert.equal(current[0].database, 'eterverso_test');
  assert.equal(current[0].username, 'eterverso_test');
  await assertRequiredSchema();

  // The principal reserves this database for the browser run. workers: 1
  // serializes this suite; it cannot serialize unrelated external processes.
  server = http.createServer();
  server.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  origin = `http://127.0.0.1:${server.address().port}`;
  server.on('request', createApp({
    sql,
    config: {
      sessionSecret: `forum-browser-${randomUUID()}`, secureCookies: false,
      production: false, publicOrigin: origin, staticRoot: ROOT,
    },
  }));
  const privateDirectory = path.join(ROOT, '.local/test');
  fs.mkdirSync(privateDirectory, { recursive: true, mode: 0o700 });
  fs.chmodSync(privateDirectory, 0o700);
  serverRecord = path.join(privateDirectory, `forum-browser-server-${process.pid}.json`);
  fs.writeFileSync(serverRecord, JSON.stringify({ pid: process.pid, origin, schema: REQUIRED_MIGRATION }), { mode: 0o600, flag: 'wx' });
});

test.beforeEach(async () => { fixture = await makeFixture(); });
test.afterEach(async () => { if (fixture) await cleanFixture(fixture); fixture = null; });
test.afterAll(async () => {
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (sql) await sql.end({ timeout: 5 });
  if (serverRecord) fs.rmSync(serverRecord, { force: true });
});

test('FOR-02/UI-01 two independent accounts share a UI-created topic and reply after reload', async ({ browser }) => {
  const a = await isolatedContext(browser);
  const b = await isolatedContext(browser);
  try {
    const pageA = await a.newPage();
    const pageB = await b.newPage();
    const errors = observePageErrors(pageA, pageB);
    await Promise.all([login(pageA, fixture.users[0]), login(pageB, fixture.users[1])]);
    const identities = await Promise.all([a.request.get(`${origin}/api/auth/me`), b.request.get(`${origin}/api/auth/me`)]);
    const [identityA, identityB] = await Promise.all(identities.map((response) => response.json()));
    expect(identityA.user.id).toBe(fixture.users[0].id);
    expect(identityB.user.id).toBe(fixture.users[1].id);
    expect(identityA.user.id).not.toBe(identityB.user.id);
    expect(await pageA.evaluate((key) => localStorage.getItem(key), LEGACY_KEY)).toBeNull();
    expect(await pageB.evaluate((key) => localStorage.getItem(key), LEGACY_KEY)).toBeNull();

    await pageA.goto(`${origin}/forum/categorias/${fixture.categoryId}`);
    await expect(pageA.locator('.cat-header')).toContainText(fixture.categoryName);
    await pageA.getByRole('link', { name: '+ Novo Tópico', exact: true }).click();
    await pageA.locator('#thread-title').fill(fixture.title);
    await pageA.locator('#thread-cat').selectOption(fixture.categoryId);
    await pageA.locator('#thread-tag').selectOption('ooc');
    await pageA.locator('#thread-editor').fill(fixture.opening);
    const createdResponse = pageA.waitForResponse((response) => response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/forum/threads');
    await pageA.getByRole('button', { name: 'Publicar Tópico', exact: true }).click();
    const creation = await createdResponse;
    expect(creation.status()).toBe(201);
    const created = await creation.json();
    const threadId = created.data.thread.id;
    const threadUrl = `${origin}/forum/topicos/${threadId}`;
    await expect(pageA).toHaveURL(threadUrl);
    await expect(pageA.locator('.post-content')).toHaveText([fixture.opening]);

    // B has never visited the new topic. A fresh category read discovers the
    // server record; no shared storage/cached JavaScript state is involved.
    await pageB.goto(`${origin}/forum/categorias/${fixture.categoryId}`);
    await expect(pageB.locator('.forum-table').getByText(fixture.title, { exact: true })).toBeVisible();
    await pageB.locator('.forum-table').getByText(fixture.title, { exact: true }).click();
    await expect(pageB).toHaveURL(threadUrl);
    await expect(pageB.locator('.post-content')).toHaveText([fixture.opening]);
    await pageB.locator('#reply-editor').fill(fixture.reply);
    const replyResponse = pageB.waitForResponse((response) => response.request().method() === 'POST'
      && new URL(response.url()).pathname === `/api/forum/threads/${threadId}/posts`);
    await pageB.getByRole('button', { name: 'Enviar Resposta', exact: true }).click();
    expect((await replyResponse).status()).toBe(201);
    await expect(pageB.locator('.post-content')).toHaveText([fixture.opening, fixture.reply]);
    await pageA.reload();
    await expect(pageA).toHaveURL(threadUrl);
    await expect(pageA.locator('.post-content')).toHaveText([fixture.opening, fixture.reply]);
    await expect(pageA.locator('.post-number')).toHaveText(['#1', '#2']);
    await expect(pageA.locator('.post-header')).toContainText([fixture.users[0].username, fixture.users[1].username]);
    await pageB.reload();
    await expect(pageB.locator('.post-content')).toHaveText([fixture.opening, fixture.reply]);

    const stored = await sql`SELECT p.post_no, p.author_id, p.content FROM posts p
      WHERE p.thread_id = ${threadId} ORDER BY p.post_no`;
    expect(stored.map((row) => row.post_no)).toEqual([1, 2]);
    expect(stored.map((row) => row.author_id)).toEqual(fixture.users.map((user) => user.id));
    expect(stored[0].content).toContain(fixture.opening);
    expect(stored[1].content).toContain(fixture.reply);
    const category = await a.request.get(`${origin}/api/forum/categories?limit=100`);
    const categories = await category.json();
    const summary = categories.data.find((item) => item.id === fixture.categoryId);
    expect(summary.topicsCount).toBe(1);
    expect(summary.postsCount).toBe(2);
    expect(await pageA.evaluate((key) => localStorage.getItem(key), LEGACY_KEY)).toBeNull();
    expect(await pageB.evaluate((key) => localStorage.getItem(key), LEGACY_KEY)).toBeNull();
    expect(errors).toEqual([]);
  } finally { await Promise.all([a.close(), b.close()]); }
});

test('forum search keeps the input usable while typing and clears cached filters', async ({ browser }) => {
  const context = await isolatedContext(browser);
  try {
    const page = await context.newPage();
    const threadId = randomUUID();
    await sql`INSERT INTO threads (id, category_id, author_id, title, tag)
      VALUES (${threadId}, ${fixture.categoryId}, ${fixture.users[0].id}, ${fixture.title}, 'ooc')`;
    await sql`INSERT INTO posts (id, thread_id, author_id, content, post_no)
      VALUES (${randomUUID()}, ${threadId}, ${fixture.users[0].id}, ${'<p>' + fixture.opening + '</p>'}, 1)`;
    await page.goto(`${origin}/forum`);
    const input = page.locator('#forum-search-input');
    await input.click();
    await input.pressSequentially(fixture.title.slice(0, 12), { delay: 40 });
    await expect(input).toHaveValue(fixture.title.slice(0, 12));
    await expect(page.locator('#forum-search-input')).toBeFocused();
    await expect(page.locator('#main')).toContainText(fixture.title);
    await page.getByRole('button', { name: 'Limpar Filtro', exact: true }).click();
    await expect(page.locator('#forum-search-input')).toHaveValue('');
    await expect(page.locator('#main')).toContainText(fixture.title);
  } finally {
    await context.close();
  }
});

test('legacy forum tags render as text without injecting attributes', async ({ browser }) => {
  const context = await isolatedContext(browser);
  try {
    const page = await context.newPage();
    const threadId = randomUUID();
    const hostileTag = ' onclick=alert() x=';
    await sql`INSERT INTO threads (id, category_id, author_id, title, tag)
      VALUES (${threadId}, ${fixture.categoryId}, ${fixture.users[0].id}, ${fixture.title}, ${hostileTag})`;
    await sql`INSERT INTO posts (id, thread_id, author_id, content, post_no)
      VALUES (${randomUUID()}, ${threadId}, ${fixture.users[0].id}, ${'<p>' + fixture.opening + '</p>'}, 1)`;
    await page.goto(`${origin}/forum/categorias/${fixture.categoryId}`);
    const tag = page.locator('.tag').filter({ hasText: hostileTag.trim().toUpperCase() }).first();
    await expect(tag).toBeVisible();
    const outer = await tag.evaluate((element) => element.outerHTML);
    expect(outer).not.toContain('onclick=alert');
    expect(await tag.getAttribute('onclick')).toBeNull();
  } finally {
    await context.close();
  }
});

test('UI-01 a fresh anonymous reader opens stable category/topic URLs, reloads and navigates history', async ({ browser }) => {
  const author = await isolatedContext(browser);
  const reader = await isolatedContext(browser);
  try {
    const authorPage = await author.newPage();
    await login(authorPage, fixture.users[0]);
    const csrfResponse = await author.request.get(`${origin}/api/auth/csrf`);
    const csrf = await csrfResponse.json();
    const createdResponse = await author.request.post(`${origin}/api/forum/threads`, {
      headers: { 'X-CSRF-Token': csrf.csrfToken, 'Idempotency-Key': randomUUID() },
      data: { categoryId: fixture.categoryId, title: fixture.title, tag: 'ooc', content: `<p>${fixture.opening}</p>` },
    });
    expect(createdResponse.status()).toBe(201);
    const created = await createdResponse.json();
    const threadUrl = `${origin}/forum/topicos/${created.data.thread.id}`;
    const categoryUrl = `${origin}/forum/categorias/${fixture.categoryId}`;
    const page = await reader.newPage();
    const errors = observePageErrors(page);
    const initial = await page.goto(threadUrl);
    expect(initial.status()).toBe(200);
    expect(initial.headers()['content-type']).toContain('text/html');
    await expect(page.locator('.thread-tools h2')).toContainText(fixture.title);
    await expect(page.locator('.post-content')).toHaveText([fixture.opening]);
    await expect(page.locator('#top-user-info')).toContainText('Visitante');
    await expect(page.locator('#reply-editor')).toHaveCount(0);
    await page.reload();
    await expect(page).toHaveURL(threadUrl);
    await expect(page.locator('.post-content')).toHaveText([fixture.opening]);

    await page.locator('.breadcrumb').getByText(fixture.categoryName, { exact: true }).click();
    await expect(page).toHaveURL(categoryUrl);
    await expect(page.locator('.forum-table').getByText(fixture.title, { exact: true })).toBeVisible();
    await page.reload();
    await expect(page).toHaveURL(categoryUrl);
    await expect(page.locator('.forum-table').getByText(fixture.title, { exact: true })).toBeVisible();
    await page.locator('.forum-table').getByText(fixture.title, { exact: true }).click();
    await expect(page).toHaveURL(threadUrl);
    await expect(page.locator('.post-content')).toHaveText([fixture.opening]);
    await page.goBack();
    await expect(page).toHaveURL(categoryUrl);
    await expect(page.locator('.forum-table').getByText(fixture.title, { exact: true })).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(threadUrl);
    await expect(page.locator('.post-content')).toHaveText([fixture.opening]);
    const publicResponse = await reader.request.get(`${origin}/api/forum/threads/${created.data.thread.id}`);
    expect(publicResponse.status()).toBe(200);
    const publicRecord = await publicResponse.json();
    expect(publicRecord.data.id).toBe(created.data.thread.id);
    expect(publicRecord.data.postsCount).toBe(1);
    expect(JSON.stringify(publicRecord).includes(fixture.users[0].email)).toBe(false);
    expect(await page.evaluate((key) => localStorage.getItem(key), LEGACY_KEY)).toBeNull();
    expect(errors).toEqual([]);
  } finally { await Promise.all([author.close(), reader.close()]); }
});

test('pending reply actions use one record lookup and paging keeps every post exactly once', async ({ browser }) => {
  const context = await isolatedContext(browser);
  try {
    const page = await context.newPage();
    const errors = observePageErrors(page);
    await login(page, fixture.users[0]);
    const threadId = await createLongDiscussion(fixture, 40);
    const replyText = `Pending reply 41 ${fixture.suffix}`;
    const editedText = `${replyText} edited`;
    const postOffsets = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (request.method() === 'GET' && url.pathname === `/api/forum/threads/${threadId}/posts`) {
        postOffsets.push(Number(url.searchParams.get('offset')));
      }
    });
    await page.goto(`${origin}/forum/topicos/${threadId}`);
    await expect(page.locator('.post-number')).toHaveText(postNumbers(1, 20));

    await page.locator('#reply-editor').fill(replyText);
    const publishedResponse = page.waitForResponse((response) => response.request().method() === 'POST'
      && new URL(response.url()).pathname === `/api/forum/threads/${threadId}/posts`);
    await page.getByRole('button', { name: 'Enviar Resposta', exact: true }).click();
    const published = await publishedResponse;
    expect(published.status()).toBe(201);
    const replyPostId = (await published.json()).data.id;
    await expect(page.locator('.post-number')).toHaveText(postNumbers(1, 20).concat('#41'));

    const pendingCard = page.locator('.post-box').filter({ hasText: '#41' });
    await expect(pendingCard.locator('.post-content')).toContainText(replyText);

    // Quote the displayed pending reply before any intermediate page is fetched.
    await pendingCard.getByText('Citar', { exact: true }).click();
    await expect(page.locator('#reply-editor')).toContainText('escreveu:');
    await expect(page.locator('#reply-editor')).toContainText(replyText);

    // Edit/save the displayed pending reply using its server version.
    await pendingCard.getByText('Editar', { exact: true }).click();
    const modal = page.locator('#modal-container');
    await expect(modal.locator('#edit-post-editor')).toContainText(replyText);
    await modal.locator('#edit-post-editor').fill(editedText);
    await modal.locator('#edit-post-summary').fill('Synthetic pending reply edit');
    const patchedResponse = page.waitForResponse((response) => response.request().method() === 'PATCH'
      && new URL(response.url()).pathname === `/api/forum/posts/${replyPostId}`);
    await modal.getByRole('button', { name: 'Salvar', exact: true }).click();
    expect((await patchedResponse).status()).toBe(200);
    await expect(page.locator('#modal-container #edit-post-editor')).toHaveCount(0);
    await expect(pendingCard.locator('.post-content')).toContainText(editedText);

    // Fetch every intermediate page. The sparse reply 41 must not shift offsets.
    const firstPageResponse = page.waitForResponse((response) => response.request().method() === 'GET'
      && new URL(response.url()).pathname === `/api/forum/threads/${threadId}/posts`
      && new URL(response.url()).searchParams.get('offset') === '20');
    await page.getByRole('button', { name: 'Carregar publicações anteriores', exact: true }).click();
    const firstPage = await firstPageResponse;
    expect(firstPage.status()).toBe(200);
    expect((await firstPage.json()).data.map((post) => post.postNo))
      .toEqual(Array.from({ length: 20 }, (_, index) => 21 + index));
    await expect(page.locator('.post-number')).toHaveText(postNumbers(1, 40).concat('#41'));

    const secondPageResponse = page.waitForResponse((response) => response.request().method() === 'GET'
      && new URL(response.url()).pathname === `/api/forum/threads/${threadId}/posts`
      && new URL(response.url()).searchParams.get('offset') === '40');
    await page.getByRole('button', { name: 'Carregar publicações anteriores', exact: true }).click();
    const secondPage = await secondPageResponse;
    expect(secondPage.status()).toBe(200);
    expect((await secondPage.json()).data.map((post) => post.postNo)).toEqual([41]);
    await expect(page.locator('.post-number')).toHaveText(postNumbers(1, 41));
    expect(postOffsets).toEqual([0, 0, 20, 40]);
    const renderedNumbers = await page.locator('.post-number').allTextContents();
    expect(renderedNumbers).toHaveLength(41);
    expect(new Set(renderedNumbers).size).toBe(41);
    await expect(page.locator('.post-content').last()).toContainText(editedText);

    const stored = await sql`SELECT post_no, content, version, deleted_at FROM posts
      WHERE thread_id = ${threadId} ORDER BY post_no`;
    expect(stored.map((post) => post.post_no)).toEqual(Array.from({ length: 41 }, (_, index) => index + 1));
    expect(stored[40].content).toContain(editedText);
    expect(stored[40].version).toBe(2);
    expect(stored[40].deleted_at).toBeNull();
    expect(stored[20].post_no).toBe(21);
    expect(stored[20].content).toContain(`Long post 21 ${fixture.suffix}`);
    const freshPage = await context.request.get(`${origin}/api/forum/threads/${threadId}/posts?limit=20&offset=40`);
    expect(freshPage.status()).toBe(200);
    expect((await freshPage.json()).data.map((post) => post.postNo)).toEqual([41]);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('hiding a displayed pending reply updates it before earlier pages are fetched', async ({ browser }) => {
  const context = await isolatedContext(browser);
  try {
    const page = await context.newPage();
    const errors = observePageErrors(page);
    await login(page, fixture.users[0]);
    const threadId = await createLongDiscussion(fixture, 40);
    const replyText = `Pending hidden reply 41 ${fixture.suffix}`;
    await page.goto(`${origin}/forum/topicos/${threadId}`);
    await expect(page.locator('.post-number')).toHaveText(postNumbers(1, 20));

    await page.locator('#reply-editor').fill(replyText);
    const publishedResponse = page.waitForResponse((response) => response.request().method() === 'POST'
      && new URL(response.url()).pathname === `/api/forum/threads/${threadId}/posts`);
    await page.getByRole('button', { name: 'Enviar Resposta', exact: true }).click();
    const published = await publishedResponse;
    expect(published.status()).toBe(201);
    const replyPostId = (await published.json()).data.id;
    const pendingCard = page.locator('.post-box').filter({ hasText: '#41' });
    await expect(pendingCard.locator('.post-content')).toContainText(replyText);

    page.on('dialog', (dialog) => dialog.accept('Synthetic hide reason'));
    const hiddenResponse = page.waitForResponse((response) => response.request().method() === 'POST'
      && new URL(response.url()).pathname === `/api/forum/posts/${replyPostId}/hide`);
    await pendingCard.getByText('Ocultar', { exact: true }).click();
    expect((await hiddenResponse).status()).toBe(200);
    await expect(pendingCard.locator('.post-content')).toContainText('Esta publicação foi ocultada.');
    await expect(pendingCard.getByText('Citar', { exact: true })).toHaveCount(0);
    await expect(pendingCard.getByText('Editar', { exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: 'Carregar publicações anteriores', exact: true }).click();
    await expect(page.locator('.post-number')).toHaveText(postNumbers(1, 40).concat('#41'));
    await page.getByRole('button', { name: 'Carregar publicações anteriores', exact: true }).click();
    await expect(page.locator('.post-number')).toHaveText(postNumbers(1, 41));
    const stored = await sql`SELECT post_no, version, deleted_at FROM posts
      WHERE thread_id = ${threadId} ORDER BY post_no`;
    expect(stored.map((post) => post.post_no)).toEqual(Array.from({ length: 41 }, (_, index) => index + 1));
    expect(stored[40].version).toBe(2);
    expect(stored[40].deleted_at).not.toBeNull();
    const renderedNumbers = await page.locator('.post-number').allTextContents();
    expect(new Set(renderedNumbers).size).toBe(41);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('a stale offset-40 page cannot revert an edited pending reply', async ({ browser }) => {
  const context = await isolatedContext(browser);
  try {
    const page = await context.newPage();
    const errors = observePageErrors(page);
    await login(page, fixture.users[0]);
    const threadId = await createLongDiscussion(fixture, 40);
    const replyText = `Pending stale edit 41 ${fixture.suffix}`;
    const editedText = `Edited stale reply ${fixture.suffix}`;
    await page.goto(`${origin}/forum/topicos/${threadId}`);
    await expect(page.locator('.post-number')).toHaveText(postNumbers(1, 20));

    await page.locator('#reply-editor').fill(replyText);
    const publishedResponse = page.waitForResponse((response) => response.request().method() === 'POST'
      && new URL(response.url()).pathname === `/api/forum/threads/${threadId}/posts`);
    await page.getByRole('button', { name: 'Enviar Resposta', exact: true }).click();
    const published = await publishedResponse;
    expect(published.status()).toBe(201);
    const replyPostId = (await published.json()).data.id;
    const pendingCard = page.locator('.post-box').filter({ hasText: '#41' });
    await expect(pendingCard.locator('.post-content')).toContainText(replyText);

    // Fetch page 20 normally, then hold page 40 after its body was produced.
    await page.getByRole('button', { name: 'Carregar publicações anteriores', exact: true }).click();
    await expect(page.locator('.post-number')).toHaveText(postNumbers(1, 40).concat('#41'));
    const heldPage = await holdPostsPage(page, threadId, 40);
    await page.getByRole('button', { name: 'Carregar publicações anteriores', exact: true }).click();
    await heldPage.captured;
    expect(heldPage.body.data.map((post) => post.postNo)).toEqual([41]);
    expect(heldPage.body.data[0].version).toBe(1);
    expect(heldPage.body.data[0].content).toContain(replyText);

    // Edit the pending reply while the old page is still in flight.
    await pendingCard.getByText('Editar', { exact: true }).click();
    const modal = page.locator('#modal-container');
    await expect(modal.locator('#edit-post-editor')).toContainText(replyText);
    await modal.locator('#edit-post-editor').fill(editedText);
    await modal.locator('#edit-post-summary').fill('Synthetic stale-page edit');
    const patchedResponse = page.waitForResponse((response) => response.request().method() === 'PATCH'
      && new URL(response.url()).pathname === `/api/forum/posts/${replyPostId}`);
    await modal.getByRole('button', { name: 'Salvar', exact: true }).click();
    expect((await patchedResponse).status()).toBe(200);
    await expect(pendingCard.locator('.post-content')).toContainText(editedText);

    // Release the version-1 body. It must not replace or duplicate version 2.
    await heldPage.release();
    await expect(page.getByRole('button', { name: 'Carregar publicações anteriores', exact: true })).toHaveCount(0);
    await expect(pendingCard.locator('.post-content')).toContainText(editedText);
    await expect(page.locator('.post-content').filter({ hasText: replyText })).toHaveCount(0);
    await expect(page.locator('.post-number')).toHaveText(postNumbers(1, 41));
    const renderedNumbers = await page.locator('.post-number').allTextContents();
    expect(new Set(renderedNumbers).size).toBe(41);
    await expect(pendingCard.getByText('Citar', { exact: true })).toBeVisible();

    const stored = await sql`SELECT version, content, deleted_at FROM posts WHERE id = ${replyPostId}`;
    expect(stored[0].version).toBe(2);
    expect(stored[0].content).toContain(editedText);
    expect(stored[0].deleted_at).toBeNull();
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('a stale offset-40 page cannot make a hidden pending reply visible again', async ({ browser }) => {
  const context = await isolatedContext(browser);
  try {
    const page = await context.newPage();
    const errors = observePageErrors(page);
    await login(page, fixture.users[0]);
    const threadId = await createLongDiscussion(fixture, 40);
    const replyText = `Pending stale hide 41 ${fixture.suffix}`;
    await page.goto(`${origin}/forum/topicos/${threadId}`);
    await expect(page.locator('.post-number')).toHaveText(postNumbers(1, 20));

    await page.locator('#reply-editor').fill(replyText);
    const publishedResponse = page.waitForResponse((response) => response.request().method() === 'POST'
      && new URL(response.url()).pathname === `/api/forum/threads/${threadId}/posts`);
    await page.getByRole('button', { name: 'Enviar Resposta', exact: true }).click();
    const published = await publishedResponse;
    expect(published.status()).toBe(201);
    const replyPostId = (await published.json()).data.id;
    const pendingCard = page.locator('.post-box').filter({ hasText: '#41' });
    await expect(pendingCard.locator('.post-content')).toContainText(replyText);

    await page.getByRole('button', { name: 'Carregar publicações anteriores', exact: true }).click();
    await expect(page.locator('.post-number')).toHaveText(postNumbers(1, 40).concat('#41'));
    const heldPage = await holdPostsPage(page, threadId, 40);
    await page.getByRole('button', { name: 'Carregar publicações anteriores', exact: true }).click();
    await heldPage.captured;
    expect(heldPage.body.data.map((post) => post.postNo)).toEqual([41]);
    expect(heldPage.body.data[0].version).toBe(1);
    expect(heldPage.body.data[0].deleted).toBe(false);

    page.on('dialog', (dialog) => dialog.accept('Synthetic stale-page hide reason'));
    const hiddenResponse = page.waitForResponse((response) => response.request().method() === 'POST'
      && new URL(response.url()).pathname === `/api/forum/posts/${replyPostId}/hide`);
    await pendingCard.getByText('Ocultar', { exact: true }).click();
    expect((await hiddenResponse).status()).toBe(200);
    await expect(pendingCard.locator('.post-content')).toContainText('Esta publicação foi ocultada.');

    await heldPage.release();
    await expect(page.getByRole('button', { name: 'Carregar publicações anteriores', exact: true })).toHaveCount(0);
    await expect(pendingCard.locator('.post-content')).toContainText('Esta publicação foi ocultada.');
    await expect(page.locator('.post-content').filter({ hasText: replyText })).toHaveCount(0);
    await expect(pendingCard.getByText('Citar', { exact: true })).toHaveCount(0);
    await expect(pendingCard.getByText('Editar', { exact: true })).toHaveCount(0);
    await expect(page.locator('.post-number')).toHaveText(postNumbers(1, 41));
    const renderedNumbers = await page.locator('.post-number').allTextContents();
    expect(new Set(renderedNumbers).size).toBe(41);

    const stored = await sql`SELECT version, deleted_at FROM posts WHERE id = ${replyPostId}`;
    expect(stored[0].version).toBe(2);
    expect(stored[0].deleted_at).not.toBeNull();
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

async function holdPostsPage(page, threadId, offset) {
  let release = null;
  let body = null;
  const captured = new Promise((resolve) => {
    page.route((url) => url.pathname === `/api/forum/threads/${threadId}/posts`
      && url.searchParams.get('offset') === String(offset), async (route) => {
      const response = await route.fetch();
      body = await response.json();
      release = () => route.fulfill({ response, json: body });
      resolve();
    });
  });
  return {
    captured,
    get body() { return body; },
    release: async () => { await release(); },
  };
}

async function createLongDiscussion(f, count) {
  const threadId = randomUUID();
  await sql.begin(async (tx) => {
    await tx`INSERT INTO threads (id, category_id, author_id, title, tag)
      VALUES (${threadId}, ${f.categoryId}, ${f.users[0].id}, ${f.title}, 'ooc')`;
    for (let postNo = 1; postNo <= count; postNo += 1) {
      await tx`INSERT INTO posts (id, thread_id, author_id, content, post_no)
        VALUES (${randomUUID()}, ${threadId}, ${f.users[0].id},
          ${`<p>Long post ${postNo} ${f.suffix}</p>`}, ${postNo})`;
    }
    await tx`UPDATE threads SET next_post_no = ${count + 1} WHERE id = ${threadId}`;
  });
  return threadId;
}

function postNumbers(first, last) {
  return Array.from({ length: last - first + 1 }, (_, index) => `#${first + index}`);
}

async function assertRequiredSchema() {
  const journal = JSON.parse(fs.readFileSync(path.join(ROOT, 'drizzle/meta/_journal.json'), 'utf8')).entries;
  const required = journal.findIndex((entry) => entry.tag === REQUIRED_MIGRATION);
  assert.ok(required >= 0, 'The reviewed portable wiki transfer migration must be registered.');
  const ledger = await sql`SELECT id, hash FROM drizzle.__drizzle_migrations ORDER BY id`;
  assert.equal(ledger.length, required + 1, 'Run this bounded suite only against the reviewed isolated test schema. Do not migrate inside tests.');
  for (let index = 0; index <= required; index += 1) {
    const entry = journal[index];
    const hash = createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'drizzle', `${entry.tag}.sql`))).digest('hex');
    assert.equal(Number(ledger[index].id), entry.idx + 1);
    assert.equal(ledger[index].hash, hash, 'Isolated migration history differs from reviewed SQL.');
  }
  const tables = await sql`SELECT to_regclass('public.scene_turns') IS NOT NULL AS scene_turns,
    to_regclass('public.posts') IS NOT NULL AS posts, to_regclass('public.request_keys') IS NOT NULL AS request_keys`;
  assert.equal(tables[0].scene_turns && tables[0].posts && tables[0].request_keys, true);
}

async function makeFixture() {
  const suffix = randomUUID().slice(0, 8);
  const f = {
    suffix, users: [], categoryId: null, categoryName: `Browser forum ${suffix}`,
    title: `Tópico sintético ${suffix}`, opening: `Abertura compartilhada ${suffix}`,
    reply: `Resposta independente ${suffix}`,
  };
  try {
    const hash = await bcrypt.hash(PASSWORD, 10);
    for (const number of [1, 2]) {
      const username = `browser-${suffix}-${number}`;
      const email = `${username}@example.test`;
      const users = await sql`INSERT INTO users (username, email, password_hash, role)
        VALUES (${username}, ${email}, ${hash}, 'member') RETURNING id`;
      f.users.push({ id: users[0].id, username, email });
    }
    const categories = await sql`INSERT INTO categories (name, description)
      VALUES (${f.categoryName}, 'Categoria sintética para teste de navegador') RETURNING id`;
    f.categoryId = categories[0].id;
    return f;
  } catch (error) { await cleanFixture(f); throw error; }
}

async function cleanFixture(f) {
  // Scope every cleanup statement to this fixture's UUIDs, never truncate/reset.
  for (const user of f.users) {
    await sql`DELETE FROM request_keys WHERE actor_id = ${user.id}`;
    await sql`DELETE FROM audit_events WHERE actor_id = ${user.id}`;
  }
  if (f.categoryId) {
    await sql`DELETE FROM post_revisions WHERE post_id IN
      (SELECT p.id FROM posts p JOIN threads t ON t.id = p.thread_id WHERE t.category_id = ${f.categoryId})`;
    await sql`DELETE FROM forum_migration_issues WHERE thread_id IN (SELECT id FROM threads WHERE category_id = ${f.categoryId})`;
    await sql`DELETE FROM posts WHERE thread_id IN (SELECT id FROM threads WHERE category_id = ${f.categoryId})`;
    await sql`DELETE FROM threads WHERE category_id = ${f.categoryId}`;
    await sql`DELETE FROM categories WHERE id = ${f.categoryId}`;
  }
  for (const user of f.users) await sql`DELETE FROM users WHERE id = ${user.id}`;
}

async function login(page, user) {
  await page.goto(`${origin}/forum`);
  await expect(page.locator('#top-user-info')).toContainText('Visitante');
  await page.locator('#top-btn-area').getByText('Entrar', { exact: true }).click();
  await page.locator('#login-username').fill(user.username);
  await page.locator('#login-password').fill(PASSWORD);
  const response = page.waitForResponse((item) => item.request().method() === 'POST' && new URL(item.url()).pathname === '/api/auth/login');
  await page.locator('#modal-container').getByRole('button', { name: 'Entrar', exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(page.locator('#top-user-info')).toContainText(user.username);
  await expect(page.locator('.forum-table').getByText(fixture.categoryName, { exact: true })).toBeVisible();
}
function observePageErrors(...pages) {
  const errors = [];
  for (const page of pages) {
    page.on('pageerror', (error) => errors.push(`${error.name}: ${error.message}`));
    page.on('response', (response) => {
      const type = response.request().resourceType();
      if (response.url().startsWith(origin) && ['script', 'stylesheet'].includes(type) && response.status() >= 400) {
        errors.push(`asset ${new URL(response.url()).pathname}: ${response.status()}`);
      }
    });
  }
  return errors;
}

async function isolatedContext(browser) {
  const context = await browser.newContext();
  // Fonts are cosmetic and external availability must not gate local behavior.
  // All application/API requests still reach the real isolated HTTP server.
  await context.route(/^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//, (route) => route.abort());
  return context;
}
