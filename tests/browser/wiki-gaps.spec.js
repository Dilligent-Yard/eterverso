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
const REQUIRED_MIGRATION = '0017_timeline_events';
const PASSWORD = 'Synthetic-wiki-gaps-browser-password-42';
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

  server = http.createServer();
  server.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  origin = `http://127.0.0.1:${server.address().port}`;
  server.on('request', createApp({
    sql,
    config: {
      sessionSecret: `wiki-gaps-browser-${randomUUID()}`, secureCookies: false,
      production: false, publicOrigin: origin, staticRoot: ROOT,
    },
  }));
  const privateDirectory = path.join(ROOT, '.local/test');
  fs.mkdirSync(privateDirectory, { recursive: true, mode: 0o700 });
  fs.chmodSync(privateDirectory, 0o700);
  serverRecord = path.join(privateDirectory, `wiki-gaps-browser-server-${process.pid}.json`);
  fs.writeFileSync(serverRecord, JSON.stringify({ pid: process.pid, origin, schema: REQUIRED_MIGRATION }), { mode: 0o600, flag: 'wx' });
});

test.beforeEach(async () => { fixture = await makeFixture(); });
test.afterEach(async () => { if (fixture) await cleanFixture(fixture); fixture = null; });
test.afterAll(async () => {
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (sql) await sql.end({ timeout: 5 });
  if (serverRecord) fs.rmSync(serverRecord, { force: true });
});

test('WIKI-M5/M6 public category, backlinks, revision comparison, and discussion linking work in the browser', async ({ browser }) => {
  const readerContext = await isolatedContext(browser);
  const staffContext = await isolatedContext(browser);
  try {
    const reader = await readerContext.newPage();
    const staff = await staffContext.newPage();
    const errors = observePageErrors(reader, staff);

    await reader.goto(`${origin}/wiki`);
    await expect(reader.locator('#wiki-category-select')).toHaveCount(0);
    const sections = reader.getByRole('navigation', { name: 'Seções da Wiki' });
    await sections.locator('a[href="/wiki?categoria=' + fixture.categoryKey + '"]').click();
    await expect(reader.locator('#main .char-card')).toHaveCount(1);
    await expect(reader.locator('#main .char-card')).toContainText(fixture.targetTitle);
    await expect(reader.locator('#main .char-card')).not.toContainText(fixture.sourceTitle);
    await reader.locator('#main .char-card h3 a').click();
    await expect(reader).toHaveURL(`${origin}/wiki/${fixture.targetSlug}`);
    const backlinks = reader.locator('#main .builder-panel').filter({
      has: reader.getByRole('heading', { name: 'Artigos que fazem referência' }),
    });
    await expect(backlinks).toContainText(fixture.sourceTitle);

    const directReaderContext = await isolatedContext(browser);
    try {
      const directReader = await directReaderContext.newPage();
      const directApiEvents = observeApiResponses(directReader);
      const directArticleResponsePromise = directReader.waitForResponse((response) => {
        const url = new URL(response.url());
        return response.request().method() === 'GET'
          && url.pathname === `/api/wiki/pages/${fixture.targetPageId}`;
      }, { timeout: 5000 });
      await directReader.goto(`${origin}/wiki/${fixture.targetSlug}`);
      const directArticleResponse = await directArticleResponsePromise;
      expect(directArticleResponse.status()).toBe(200);
      expect((await directArticleResponse.json()).data.id).toBe(fixture.targetPageId);
      await expect(directReader.locator('.wiki-content-area')).toContainText(fixture.initialText);
      await expect(directReader.getByRole('link', { name: 'Abrir discussão', exact: true })).toHaveCount(0);
      await expect(directApiEvents).toContainEqual(expect.stringMatching(/GET \/api\/wiki\/pages\/.* 200/));
    } finally {
      await directReaderContext.close();
    }

    await login(staff, fixture.users.staff);
    await staff.goto(`${origin}/wiki/editor/${fixture.targetPageId}`);
    await expect(staff.locator('#wiki-editor-title')).toHaveValue(fixture.targetTitle);
    const diff = staff.locator('#main .builder-panel').filter({
      has: staff.getByRole('heading', { name: 'Comparar revisões' }),
    });
    await expect(diff.locator('#wiki-diff-before')).toHaveCount(1);
    await diff.locator('#wiki-diff-before').selectOption(fixture.revisionIds[0]);
    await diff.locator('#wiki-diff-after').selectOption(fixture.revisionIds[1]);
    await diff.getByRole('button', { name: 'Comparar selecionadas', exact: true }).click();
    const resultHeading = staff.getByRole('heading', { name: 'Resultado da comparação' });
    await expect(resultHeading).toBeVisible();
    const result = resultHeading.locator('xpath=..');
    await expect(result).toContainText('Seções alteradas');
    await expect(result).toContainText(fixture.initialText);
    await expect(result).toContainText(fixture.draftText);

    const discussionPanel = staff.locator('#main .builder-panel').filter({
      has: staff.getByRole('heading', { name: 'Discussão pública do artigo' }),
    });
    await expect(discussionPanel).toContainText('Nenhuma discussão está vinculada a este artigo.');
    await expect(staff.locator('#wiki-discussion-category')).toHaveCount(1);
    await staff.locator('#wiki-discussion-category').selectOption(fixture.forumCategoryId);
    const threadOption = staff.locator(`#wiki-discussion-thread option[value="${fixture.threadId}"]`);
    await expect(threadOption).toHaveCount(1);
    await staff.locator('#wiki-discussion-thread').selectOption(fixture.threadId);
    const linkResponsePromise = staff.waitForResponse((response) => response.request().method() === 'PATCH'
      && new URL(response.url()).pathname === `/api/staff/wiki/pages/${fixture.targetPageId}/discussion`);
    await staff.getByRole('button', { name: 'Vincular discussão selecionada', exact: true }).click();
    const linkResponse = await linkResponsePromise;
    expect(linkResponse.status()).toBe(200);
    await expect(discussionPanel).toContainText(fixture.threadTitle);
    await expect(discussionPanel.getByRole('button', { name: 'Remover vínculo', exact: true })).toBeVisible();
    const linkedPage = await sql`SELECT discussion_thread_id FROM wiki_pages WHERE id = ${fixture.targetPageId}`;
    expect(linkedPage[0].discussion_thread_id).toBe(fixture.threadId);
    const publicPageResponse = await readerContext.request.get(`${origin}/api/wiki/pages/${fixture.targetPageId}`);
    expect(publicPageResponse.status()).toBe(200);
    expect((await publicPageResponse.json()).data.discussionThreadId).toBe(fixture.threadId);

    const linkedReaderContext = await isolatedContext(browser);
    try {
      const linkedReader = await linkedReaderContext.newPage();
      const linkedApiEvents = observeApiResponses(linkedReader);
      const linkedArticleResponsePromise = linkedReader.waitForResponse((response) => {
        const url = new URL(response.url());
        return response.request().method() === 'GET'
          && url.pathname === `/api/wiki/pages/${fixture.targetPageId}`;
      });
      await linkedReader.goto(`${origin}/wiki/${fixture.targetSlug}`);
      const linkedArticleResponse = await linkedArticleResponsePromise;
      expect(linkedArticleResponse.status()).toBe(200);
      expect((await linkedArticleResponse.json()).data.discussionThreadId).toBe(fixture.threadId);
      await expect(linkedReader.locator('.wiki-content-area')).toContainText(fixture.initialText);
      await expect(linkedReader.getByRole('link', { name: 'Abrir discussão', exact: true })).toBeVisible();
      expect(linkedApiEvents).toContainEqual(expect.stringMatching(/GET \/api\/wiki\/pages\/.* 200/));
    } finally {
      await linkedReaderContext.close();
    }

    const unlinkResponsePromise = staff.waitForResponse((response) => response.request().method() === 'PATCH'
      && new URL(response.url()).pathname === `/api/staff/wiki/pages/${fixture.targetPageId}/discussion`);
    await discussionPanel.getByRole('button', { name: 'Remover vínculo', exact: true }).click();
    const unlinkResponse = await unlinkResponsePromise;
    expect(unlinkResponse.status()).toBe(200);
    await expect(discussionPanel).toContainText('Nenhuma discussão está vinculada a este artigo.');
    const unlinkedPage = await sql`SELECT discussion_thread_id FROM wiki_pages WHERE id = ${fixture.targetPageId}`;
    expect(unlinkedPage[0].discussion_thread_id).toBeNull();

    const unlinkedReaderContext = await isolatedContext(browser);
    try {
      const unlinkedReader = await unlinkedReaderContext.newPage();
      await unlinkedReader.goto(`${origin}/wiki/${fixture.targetSlug}`);
      await expect(unlinkedReader.locator('.wiki-content-area')).toContainText(fixture.initialText);
      await expect(unlinkedReader.getByRole('link', { name: 'Abrir discussão', exact: true })).toHaveCount(0);
    } finally {
      await unlinkedReaderContext.close();
    }

    // Anonymous startup calls /api/auth/me and currently leaves its expected
    // 401 rejection unhandled; keep failing on any unrelated page error.
    expect(errors.filter((error) => error !== 'Error: Sua sessão expirou. Faça login novamente.')).toEqual([]);
  } finally {
    await Promise.all([readerContext.close(), staffContext.close()]);
  }
});

async function assertRequiredSchema() {
  const journal = JSON.parse(fs.readFileSync(path.join(ROOT, 'drizzle/meta/_journal.json'), 'utf8')).entries;
  const required = journal.findIndex((entry) => entry.tag === REQUIRED_MIGRATION);
  assert.ok(required >= 0, 'The reviewed portable wiki transfer migration must be registered.');
  const ledger = await sql`SELECT id, hash FROM drizzle.__drizzle_migrations ORDER BY id`;
  assert.equal(ledger.length, required + 1, 'Run this suite only against the reviewed isolated test schema. Do not migrate inside tests.');
  for (let index = 0; index <= required; index += 1) {
    const entry = journal[index];
    const hash = createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'drizzle', `${entry.tag}.sql`))).digest('hex');
    assert.equal(Number(ledger[index].id), entry.idx + 1);
    assert.equal(ledger[index].hash, hash, 'Isolated migration history differs from reviewed SQL.');
  }
  const tables = await sql`SELECT to_regclass('public.wiki_pages') IS NOT NULL AS wiki_pages,
    to_regclass('public.wiki_revision_categories') IS NOT NULL AS wiki_revision_categories,
    to_regclass('public.wiki_revision_links') IS NOT NULL AS wiki_revision_links,
    to_regclass('public.threads') IS NOT NULL AS threads,
    to_regclass('public.request_keys') IS NOT NULL AS request_keys`;
  assert.equal(tables[0].wiki_pages && tables[0].wiki_revision_categories && tables[0].wiki_revision_links
    && tables[0].threads && tables[0].request_keys, true);
}

async function makeFixture() {
  const suffix = randomUUID().slice(0, 8);
  const f = {
    users: {}, pageIds: [], revisionIds: [],
    targetTitle: `Artigo alvo sintético ${suffix}`,
    targetSlug: `artigo-alvo-${suffix}`,
    sourceTitle: `Artigo de referência sintético ${suffix}`,
    sourceSlug: `artigo-referencia-${suffix}`,
    categoryName: `Éter ${suffix}`,
    categoryKey: `eter-${suffix}`,
    initialText: `Conteúdo publicado inicial ${suffix}`,
    draftText: `Conteúdo privado da revisão ${suffix}`,
    targetSectionId: randomUUID(),
    sourceSectionId: randomUUID(),
    threadTitle: `Discussão pública sintética ${suffix}`,
  };
  try {
    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    const username = `wiki-staff-${suffix}`;
    const users = await sql`
      INSERT INTO users (username, email, password_hash, role)
      VALUES (${username}, ${`${username}@example.test`}, ${passwordHash}, 'moderador') RETURNING id`;
    f.users.staff = { id: users[0].id, username };

    const categories = await sql`INSERT INTO categories (name, description)
      VALUES (${`Fórum sintético ${suffix}`}, 'Categoria para teste de vínculo da wiki') RETURNING id`;
    f.forumCategoryId = categories[0].id;
    const threads = await sql`
      INSERT INTO threads (category_id, author_id, title, tag)
      VALUES (${f.forumCategoryId}, ${f.users.staff.id}, ${f.threadTitle}, 'wiki') RETURNING id`;
    f.threadId = threads[0].id;
    await sql`INSERT INTO posts (thread_id, author_id, content, post_no)
      VALUES (${f.threadId}, ${f.users.staff.id}, ${`<p>Abertura sintética ${suffix}</p>`}, 1)`;

    const target = await createPublishedPage(sql, f, {
      slug: f.targetSlug, title: f.targetTitle, summary: `Resumo alvo ${suffix}`,
      category: f.categoryName, initialText: f.initialText, draftText: f.draftText, isTarget: true,
    });
    f.targetPageId = target.pageId;
    f.revisionIds = target.revisionIds;
    await sql`INSERT INTO wiki_names (name_key, page_id, kind)
      VALUES (${f.targetSlug}, ${target.pageId}, 'canonical')`;

    const source = await createPublishedPage(sql, f, {
      slug: f.sourceSlug, title: f.sourceTitle, summary: `Resumo referência ${suffix}`,
      category: null, initialText: `Este artigo cita ${f.targetTitle}.`, draftText: null, isTarget: false,
      targetSlug: f.targetSlug, targetTitle: f.targetTitle,
    });
    f.sourcePageId = source.pageId;
    await sql`INSERT INTO wiki_names (name_key, page_id, kind)
      VALUES (${f.sourceSlug}, ${source.pageId}, 'canonical')`;
    return f;
  } catch (error) {
    await cleanFixture(f);
    throw error;
  }
}

async function createPublishedPage(executor, f, options) {
  const pageRows = await executor`
    INSERT INTO wiki_pages (created_by, access_level, work_version, public_version, published_at)
    VALUES (${f.users.staff.id}, 'public', ${options.isTarget ? 2 : 1}, 1, now()) RETURNING id`;
  const pageId = pageRows[0].id;
  f.pageIds.push(pageId);
  const first = makeSnapshot({
    slug: options.slug, title: options.title, summary: options.summary,
    category: options.category, text: options.initialText, targetSlug: options.targetSlug,
    targetTitle: options.targetTitle, sectionId: options.isTarget ? f.targetSectionId : f.sourceSectionId,
  });
  const firstRows = await executor`
    INSERT INTO wiki_revisions (page_id, sequence, parent_revision_id, base_published_revision_id, actor_id, edit_summary, snapshot)
    VALUES (${pageId}, 1, null, null, ${f.users.staff.id}, 'Publicação sintética inicial', ${executor.json(first)}) RETURNING id`;
  const revisionIds = [firstRows[0].id];
  if (options.isTarget) {
    const second = makeSnapshot({
      slug: options.slug, title: options.title, summary: options.summary,
      category: options.category, text: options.draftText, sectionId: f.targetSectionId,
    });
    const secondRows = await executor`
      INSERT INTO wiki_revisions (page_id, sequence, parent_revision_id, base_published_revision_id, actor_id, edit_summary, snapshot)
      VALUES (${pageId}, 2, ${revisionIds[0]}, ${revisionIds[0]}, ${f.users.staff.id}, 'Rascunho sintético para comparação', ${executor.json(second)}) RETURNING id`;
    revisionIds.push(secondRows[0].id);
  }
  await executor`UPDATE wiki_pages SET head_revision_id = ${revisionIds[revisionIds.length - 1]}, published_revision_id = ${revisionIds[0]} WHERE id = ${pageId}`;
  if (options.category) {
    const categoryKey = f.categoryKey;
    await executor`INSERT INTO wiki_revision_categories (revision_id, category, category_key)
      VALUES (${revisionIds[0]}, ${options.category}, ${categoryKey})`;
    if (options.isTarget) {
      await executor`INSERT INTO wiki_revision_categories (revision_id, category, category_key)
        VALUES (${revisionIds[1]}, ${options.category}, ${categoryKey})`;
    }
  }
  if (options.targetSlug) {
    await executor`INSERT INTO wiki_revision_links (revision_id, target_name_key)
      VALUES (${revisionIds[0]}, ${options.targetSlug})`;
  }
  return { pageId, revisionIds };
}

function makeSnapshot({ slug, title, summary, category, text, targetSlug, targetTitle, sectionId }) {
  const link = targetSlug ? `<p><a href="/wiki/${targetSlug}">${targetTitle}</a></p>` : '';
  return {
    schemaVersion: 1,
    title,
    slug,
    aliases: [],
    type: 'concept',
    summary,
    categories: category ? [category] : [],
    accessLevel: 'public',
    audience: 'reader',
    body: {
      format: 'richtext-v1', infobox: [], sections: [{
        id: sectionId, heading: 'Visão geral sintética', html: `${link}<p>${text}</p>`,
        blocks: [], authority: [], knowledgeLayer: 'unspecified',
      }],
    },
  };
}

async function cleanFixture(f) {
  if (!sql || !f) return;
  await sql.begin(async (tx) => {
    await tx`ALTER TABLE wiki_revisions DISABLE TRIGGER wiki_revisions_immutable`;
    for (const user of Object.values(f.users || {})) {
      await tx`DELETE FROM request_keys WHERE actor_id = ${user.id}`;
      await tx`DELETE FROM audit_events WHERE actor_id = ${user.id}`;
    }
    for (const pageId of f.pageIds || []) await tx`DELETE FROM audit_events WHERE target_id = ${pageId}`;
    if (f.threadId) {
      await tx`UPDATE wiki_pages SET discussion_thread_id = NULL WHERE discussion_thread_id = ${f.threadId}`;
    }
    for (const pageId of f.pageIds || []) {
      await tx`DELETE FROM wiki_revision_categories WHERE revision_id IN (SELECT id FROM wiki_revisions WHERE page_id = ${pageId})`;
      await tx`DELETE FROM wiki_revision_links WHERE revision_id IN (SELECT id FROM wiki_revisions WHERE page_id = ${pageId})`;
      await tx`DELETE FROM wiki_revision_citations WHERE revision_id IN (SELECT id FROM wiki_revisions WHERE page_id = ${pageId})`;
      await tx`UPDATE wiki_pages SET head_revision_id = NULL, published_revision_id = NULL WHERE id = ${pageId}`;
      const revisions = await tx`SELECT id FROM wiki_revisions WHERE page_id = ${pageId} ORDER BY sequence DESC`;
      for (const revision of revisions) await tx`DELETE FROM wiki_revisions WHERE id = ${revision.id}`;
      await tx`DELETE FROM wiki_names WHERE page_id = ${pageId}`;
      await tx`DELETE FROM wiki_pages WHERE id = ${pageId}`;
    }
    await tx`ALTER TABLE wiki_revisions ENABLE TRIGGER wiki_revisions_immutable`;
    if (f.forumCategoryId) {
      await tx`DELETE FROM post_revisions WHERE post_id IN (SELECT id FROM posts WHERE thread_id IN
        (SELECT id FROM threads WHERE category_id = ${f.forumCategoryId}))`;
      await tx`DELETE FROM forum_migration_issues WHERE thread_id IN (SELECT id FROM threads WHERE category_id = ${f.forumCategoryId})`;
      await tx`DELETE FROM posts WHERE thread_id IN (SELECT id FROM threads WHERE category_id = ${f.forumCategoryId})`;
      await tx`DELETE FROM threads WHERE category_id = ${f.forumCategoryId}`;
      await tx`DELETE FROM categories WHERE id = ${f.forumCategoryId}`;
    }
    for (const user of Object.values(f.users || {})) await tx`DELETE FROM users WHERE id = ${user.id}`;
  });
}

async function login(page, user) {
  await page.goto(`${origin}/wiki`);
  await expect(page.locator('#top-user-info')).toContainText('Visitante');
  await page.locator('#top-btn-area').getByText('Entrar', { exact: true }).click();
  await page.locator('#login-username').fill(user.username);
  await page.locator('#login-password').fill(PASSWORD);
  const responsePromise = page.waitForResponse((response) => response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/auth/login');
  await page.locator('#modal-container').getByRole('button', { name: 'Entrar', exact: true }).click();
  expect((await responsePromise).status()).toBe(200);
  await expect(page.locator('#top-user-info')).toContainText(user.username);
}

async function isolatedContext(browser) {
  const context = await browser.newContext();
  await context.route(/^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//, (route) => route.abort());
  return context;
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

function observeApiResponses(page) {
  const responses = [];
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.origin === origin && url.pathname.startsWith('/api/')) {
      responses.push(`${response.request().method()} ${url.pathname} ${response.status()}`);
    }
  });
  return responses;
}
