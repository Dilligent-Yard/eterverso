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
const PASSWORD = 'Synthetic-wiki-browser-password-42';
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
      sessionSecret: `wiki-browser-${randomUUID()}`, secureCookies: false,
      production: false, publicOrigin: origin, staticRoot: ROOT,
    },
  }));
  const privateDirectory = path.join(ROOT, '.local/test');
  fs.mkdirSync(privateDirectory, { recursive: true, mode: 0o700 });
  fs.chmodSync(privateDirectory, 0o700);
  serverRecord = path.join(privateDirectory, `wiki-browser-server-${process.pid}.json`);
  fs.writeFileSync(serverRecord, JSON.stringify({ pid: process.pid, origin, schema: REQUIRED_MIGRATION }), { mode: 0o600, flag: 'wx' });
});

test.beforeEach(async () => { fixture = await makeFixture(); });
test.afterEach(async () => { if (fixture) await cleanFixture(fixture); fixture = null; });
test.afterAll(async () => {
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (sql) await sql.end({ timeout: 5 });
  if (serverRecord) fs.rmSync(serverRecord, { force: true });
});

test('WIKI-UI member proposals stay private while staff drafts publish as a new public snapshot', async ({ browser }) => {
  const memberContext = await isolatedContext(browser);
  const otherMemberContext = await isolatedContext(browser);
  const staffContext = await isolatedContext(browser);
  try {
    const member = await memberContext.newPage();
    const otherMember = await otherMemberContext.newPage();
    const staff = await staffContext.newPage();
    const errors = observePageErrors(member, otherMember, staff);

    await Promise.all([
      login(member, fixture.users.member),
      login(otherMember, fixture.users.otherMember),
      login(staff, fixture.users.staff),
    ]);

    const publicUrl = `${origin}/wiki/${fixture.slug}`;
    await member.goto(publicUrl);
    await expect(member.locator('.wiki-content-area')).toContainText(fixture.initialText);
    await expect(member.locator('.wiki-content-area')).not.toContainText(fixture.proposalText);

    await member.locator('#wiki-proposal-summary').fill('Synthetic member proposal summary.');
    await member.locator('#wiki-proposal-heading').fill('Synthetic proposed section');
    await member.locator('#wiki-proposal-body').fill(fixture.proposalText);
    const proposalResponsePromise = member.waitForResponse((response) => response.request().method() === 'POST'
      && new URL(response.url()).pathname === `/api/wiki/pages/${fixture.pageId}/proposals`);
    await member.getByRole('button', { name: 'Enviar proposta para revisão', exact: true }).click();
    const proposalResponse = await proposalResponsePromise;
    expect(proposalResponse.status()).toBe(201);
    const proposal = (await proposalResponse.json()).data;
    fixture.proposalIds.push(proposal.id);
    await expect(member).toHaveURL(`${origin}/wiki/propostas/${proposal.id}`);
    await expect(member.locator('.builder-panel').filter({ hasText: 'Resumo: Synthetic member proposal summary.' }).first())
      .toContainText('Synthetic member proposal summary.');

    const privateRead = await otherMemberContext.request.get(`${origin}/api/wiki/proposals/${proposal.id}`);
    expect(privateRead.status()).toBe(404);
    await otherMember.goto(`${origin}/wiki/propostas`);
    await expect(otherMember.locator('#main')).toContainText('Você ainda não enviou propostas.');
    await member.goto(publicUrl);
    await expect(member.locator('.wiki-content-area')).toContainText(fixture.initialText);
    await expect(member.locator('.wiki-content-area')).not.toContainText(fixture.proposalText);

    await staff.goto(`${origin}/wiki/editor/${fixture.pageId}`);
    await expect(staff.locator('#wiki-editor-title')).toHaveValue(fixture.title);
    await staff.locator('#wiki-editor-edit-summary').fill('Synthetic unpublished staff revision.');
    await staff.locator('#wiki-section-heading-0').fill('Synthetic staff section');
    await staff.locator('#wiki-section-0').fill(fixture.staffDraftText);
    const saveResponsePromise = staff.waitForResponse((response) => response.request().method() === 'POST'
      && new URL(response.url()).pathname === `/api/staff/wiki/pages/${fixture.pageId}/revisions`);
    await staff.getByRole('button', { name: 'Salvar rascunho', exact: true }).click();
    expect((await saveResponsePromise).status()).toBe(200);
    await expect(staff.locator('#wiki-section-0')).toContainText(fixture.staffDraftText);
    await expect(staff.locator('.builder-panel').filter({ hasText: 'Histórico de revisões' }))
      .toContainText('Synthetic unpublished staff revision.');

    await member.reload();
    await expect(member.locator('.wiki-content-area')).toContainText(fixture.initialText);
    await expect(member.locator('.wiki-content-area')).not.toContainText(fixture.staffDraftText);
    await expect(member.locator('.wiki-content-area')).not.toContainText(fixture.proposalText);

    const publishResponsePromise = staff.waitForResponse((response) => response.request().method() === 'POST'
      && new URL(response.url()).pathname === `/api/staff/wiki/pages/${fixture.pageId}/publish`);
    staff.once('dialog', dialog => dialog.accept());
    await staff.getByRole('button', { name: 'Publicar para todos', exact: true }).click();
    expect((await publishResponsePromise).status()).toBe(200);
    await member.reload();
    await expect(member.locator('.wiki-content-area')).toContainText(fixture.staffDraftText);
    await expect(member.locator('.wiki-content-area')).not.toContainText(fixture.proposalText);
    expect(errors).toEqual([]);
  } finally {
    await Promise.all([memberContext.close(), otherMemberContext.close(), staffContext.close()]);
  }
});

test('UI-03 wiki reader, proposer, staff editor, and admin controls fit a mobile viewport', async ({ browser }) => {
  const mobile = { viewport: { width: 375, height: 812 } };
  const readerContext = await isolatedContext(browser, mobile);
  const memberContext = await isolatedContext(browser, mobile);
  const staffContext = await isolatedContext(browser, mobile);
  const adminContext = await isolatedContext(browser, mobile);
  try {
    const reader = await readerContext.newPage();
    const member = await memberContext.newPage();
    const staff = await staffContext.newPage();
    const admin = await adminContext.newPage();
    const articleUrl = `${origin}/wiki/${fixture.slug}`;
    const articleLink = reader.locator('#main .char-card h3 a').filter({ hasText: fixture.title });

    await reader.goto(`${origin}/wiki`);
    await expect(articleLink).toHaveCount(1);
    await expect(reader.locator('#wiki-page-search')).toBeVisible();
    await expect(reader.getByRole('navigation', { name: 'Seções da Wiki' })).toBeVisible();
    await expect(reader.getByRole('link', { name: '+ Novo artigo', exact: true })).toHaveCount(0);
    await expect(reader.getByRole('link', { name: 'Propostas', exact: true })).toHaveCount(0);
    await assertMobilePage(reader, 'leitor anônimo na lista da wiki');
    await assertMobileControl(reader, reader.locator('#wiki-page-search'), 'busca da wiki');
    await assertMobileControl(reader, reader.getByRole('navigation', { name: 'Seções da Wiki' }).getByRole('link', { name: 'Percepção', exact: true }), 'seção da Wiki');
    await assertMobileControl(reader, articleLink, 'link do artigo');

    await reader.goto(articleUrl);
    await expect(reader.locator('.wiki-content-area')).toContainText(fixture.initialText);
    await expect(reader.locator('#wiki-proposal-summary')).toHaveCount(0);
    await expect(reader.getByRole('link', { name: 'Editar artigo', exact: true })).toHaveCount(0);
    const anonymousLogin = reader.locator('#main .builder-panel').filter({ hasText: 'Entre na sua conta para propor uma edição deste artigo.' })
      .getByRole('button', { name: 'Entrar', exact: true });
    await assertMobilePage(reader, 'leitor anônimo no artigo');
    await assertMobileControl(reader, reader.locator('#main .cat-header a.btn').filter({ hasText: 'Todos os artigos' }), 'voltar à lista');
    await assertMobileControl(reader, anonymousLogin, 'entrar para propor uma edição');

    await login(member, fixture.users.member);
    await member.goto(articleUrl);
    await expect(member.locator('#wiki-proposal-summary')).toBeVisible();
    await expect(member.locator('#wiki-proposal-heading')).toBeVisible();
    await expect(member.locator('#wiki-proposal-body')).toBeVisible();
    await expect(member.getByRole('button', { name: 'Enviar proposta para revisão', exact: true })).toBeVisible();
    await expect(member.getByRole('link', { name: 'Editar artigo', exact: true })).toHaveCount(0);
    await assertMobilePage(member, 'propositor');
    await assertMobileControl(member, member.locator('#wiki-proposal-summary'), 'resumo da proposta');
    await assertMobileControl(member, member.locator('#wiki-proposal-body'), 'conteúdo da proposta');
    await assertMobileControl(member, member.getByRole('button', { name: 'Enviar proposta para revisão', exact: true }), 'enviar proposta');

    await login(staff, fixture.users.staff);
    await staff.goto(`${origin}/wiki`);
    await expect(staff.getByRole('link', { name: '+ Novo artigo', exact: true })).toBeVisible();
    await expect(staff.locator('#nav-admin-btn a')).toHaveCount(0);
    await assertMobilePage(staff, 'moderador na lista da wiki');
    await assertMobileControl(staff, staff.getByRole('link', { name: '+ Novo artigo', exact: true }), 'criar artigo');
    await staff.goto(`${origin}/wiki/editor/${fixture.pageId}`);
    await expect(staff.locator('#wiki-editor-title')).toHaveValue(fixture.title);
    const saveDraft = staff.getByRole('button', { name: 'Salvar rascunho', exact: true });
    const publish = staff.getByRole('button', { name: 'Publicar para todos', exact: true });
    await expect(saveDraft).toBeVisible();
    await expect(publish).toBeVisible();
    await assertMobilePage(staff, 'editor da equipe');
    await assertMobileControl(staff, staff.locator('#wiki-editor-title'), 'título do artigo');
    await assertMobileControl(staff, saveDraft, 'salvar rascunho');
    await assertMobileControl(staff, publish, 'publicar revisão');

    await login(admin, fixture.users.admin);
    const adminNav = admin.locator('#nav-admin-btn').getByRole('link', { name: 'Admin', exact: true });
    await expect(adminNav).toBeVisible();
    await assertMobileControl(admin, adminNav, 'navegação administrativa');
    await adminNav.click();
    await expect(admin.locator('#admin-category-name')).toBeVisible();
    await expect(admin.getByRole('button', { name: 'Criar categoria', exact: true })).toBeVisible();
    const adminRole = admin.locator(`#admin-role-${fixture.users.admin.id}`);
    await expect(adminRole).toHaveValue('admin');
    const saveRole = adminRole.locator('xpath=..').getByRole('button', { name: 'Salvar cargo', exact: true });
    await expect(saveRole).toBeVisible();
    await assertMobilePage(admin, 'painel administrativo');
    await assertMobileControl(admin, admin.locator('#admin-category-name'), 'nome da nova categoria');
    await assertMobileControl(admin, admin.getByRole('button', { name: 'Criar categoria', exact: true }), 'criar categoria');
    await assertMobileControl(admin, adminRole, 'seleção de cargo');
    await assertMobileControl(admin, saveRole, 'salvar cargo');
  } finally {
    await Promise.all([readerContext.close(), memberContext.close(), staffContext.close(), adminContext.close()]);
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
    to_regclass('public.wiki_proposals') IS NOT NULL AS wiki_proposals,
    to_regclass('public.request_keys') IS NOT NULL AS request_keys`;
  assert.equal(tables[0].wiki_pages && tables[0].wiki_proposals && tables[0].request_keys, true);
}

async function makeFixture() {
  const suffix = randomUUID().slice(0, 8);
  const f = {
    users: {}, pageId: null, revisionIds: [], proposalIds: [], extraPageIds: [], sourceIds: [],
    title: `Synthetic wiki article ${suffix}`,
    slug: `synthetic-wiki-article-${suffix}`,
    initialText: `Synthetic published snapshot ${suffix}`,
    proposalText: `Synthetic private proposal ${suffix}`,
    staffDraftText: `Synthetic staff revision ${suffix}`,
  };
  try {
    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    for (const [key, role] of [['member', 'member'], ['otherMember', 'member'], ['staff', 'moderador'], ['admin', 'admin']]) {
      const username = `wiki-${key}-${suffix}`;
      const rows = await sql`
        INSERT INTO users (username, email, password_hash, role)
        VALUES (${username}, ${`${username}@example.test`}, ${passwordHash}, ${role}) RETURNING id`;
      f.users[key] = { id: rows[0].id, username };
    }
    const initial = snapshot(f.title, f.slug, f.initialText);
    const pages = await sql`
      INSERT INTO wiki_pages (created_by, access_level, work_version, public_version, published_at)
      VALUES (${f.users.staff.id}, 'public', 1, 1, now()) RETURNING id`;
    f.pageId = pages[0].id;
    const revisions = await sql`
      INSERT INTO wiki_revisions (
        page_id, sequence, parent_revision_id, base_published_revision_id,
        actor_id, edit_summary, snapshot
      ) VALUES (${f.pageId}, 1, null, null, ${f.users.staff.id}, 'Synthetic initial publication', ${sql.json(initial)})
      RETURNING id`;
    f.revisionIds.push(revisions[0].id);
    await sql`UPDATE wiki_pages SET head_revision_id = ${revisions[0].id}, published_revision_id = ${revisions[0].id} WHERE id = ${f.pageId}`;
    await sql`INSERT INTO wiki_names (name_key, page_id, kind) VALUES (${f.slug}, ${f.pageId}, 'canonical')`;
    return f;
  } catch (error) {
    await cleanFixture(f);
    throw error;
  }
}

function snapshot(title, slug, content) {
  return {
    schemaVersion: 1,
    title,
    slug,
    aliases: [],
    type: 'concept',
    summary: 'Synthetic article summary.',
    categories: [],
    accessLevel: 'public',
    audience: 'reader',
    body: {
      format: 'richtext-v1', infobox: [], sections: [{
        id: randomUUID(), heading: 'Synthetic overview', html: `<p>${content}</p>`,
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
    for (const proposalId of f.proposalIds || []) {
      await tx`DELETE FROM audit_events WHERE target_id = ${proposalId}`;
      await tx`DELETE FROM wiki_proposals WHERE id = ${proposalId}`;
    }
    for (const pageId of [f.pageId, ...(f.extraPageIds || [])].filter(Boolean)) {
      await tx`DELETE FROM audit_events WHERE target_id = ${pageId}`;
      await tx`DELETE FROM wiki_revision_citations WHERE revision_id IN (SELECT id FROM wiki_revisions WHERE page_id = ${pageId})`;
      await tx`DELETE FROM wiki_revision_categories WHERE revision_id IN (SELECT id FROM wiki_revisions WHERE page_id = ${pageId})`;
      await tx`DELETE FROM wiki_revision_links WHERE revision_id IN (SELECT id FROM wiki_revisions WHERE page_id = ${pageId})`;
      await tx`UPDATE wiki_revisions SET accepted_proposal_id = NULL WHERE page_id = ${pageId}`;
      await tx`UPDATE wiki_pages SET head_revision_id = NULL, published_revision_id = NULL WHERE id = ${pageId}`;
      const revisions = await tx`SELECT id FROM wiki_revisions WHERE page_id = ${pageId} ORDER BY sequence DESC`;
      for (const revision of revisions) await tx`DELETE FROM wiki_revisions WHERE id = ${revision.id}`;
      await tx`DELETE FROM wiki_names WHERE page_id = ${pageId}`;
      await tx`DELETE FROM wiki_pages WHERE id = ${pageId}`;
    }
    await tx`ALTER TABLE wiki_revisions ENABLE TRIGGER wiki_revisions_immutable`;
    for (const sourceId of f.sourceIds || []) await tx`DELETE FROM wiki_sources WHERE id = ${sourceId}`;
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

async function isolatedContext(browser, options = {}) {
  const context = await browser.newContext(options);
  await context.route(/^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//, (route) => route.abort());
  return context;
}

async function assertMobilePage(page, label) {
  const metrics = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    clientWidth: document.documentElement.clientWidth,
    documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
  }));
  expect(metrics.viewportWidth, `${label}: viewport should be 375 CSS pixels`).toBe(375);
  expect(metrics.documentWidth, `${label}: document should not overflow horizontally`).toBeLessThanOrEqual(metrics.clientWidth);
}

async function assertMobileControl(page, locator, label) {
  await expect(locator, `${label} should be visible`).toBeVisible();
  await locator.scrollIntoViewIfNeeded();
  const bounds = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
      viewportWidth: document.documentElement.clientWidth,
      viewportHeight: window.innerHeight,
    };
  });
  expect(bounds.width, `${label} should have a usable width`).toBeGreaterThan(0);
  expect(bounds.height, `${label} should have a usable height`).toBeGreaterThan(0);
  expect(bounds.left, `${label} should fit within the viewport's left edge`).toBeGreaterThanOrEqual(0);
  expect(bounds.right, `${label} should fit within the viewport's right edge`).toBeLessThanOrEqual(bounds.viewportWidth);
  expect(bounds.top, `${label} should be reachable within the viewport`).toBeGreaterThanOrEqual(0);
  expect(bounds.bottom, `${label} should be reachable within the viewport`).toBeLessThanOrEqual(bounds.viewportHeight + 2);
}

function observePageErrors(...pages) {
  const errors = [];
  for (const page of pages) {
    page.on('pageerror', (error) => errors.push(error.name));
    page.on('response', (response) => {
      const type = response.request().resourceType();
      if (response.url().startsWith(origin) && ['script', 'stylesheet'].includes(type) && response.status() >= 400) {
        errors.push(`asset ${new URL(response.url()).pathname}: ${response.status()}`);
      }
    });
  }
  return errors;
}

test('staff discovers shared drafts, reads indexed content and explicitly publishes for everyone', async ({ browser }) => {
  const staffContext = await isolatedContext(browser);
  const guestContext = await isolatedContext(browser);
  const memberContext = await isolatedContext(browser);
  const staff = await staffContext.newPage();
  const guest = await guestContext.newPage();
  const member = await memberContext.newPage();
  try {
    await login(staff, fixture.users.staff);
    const [old] = await sql`SELECT snapshot FROM wiki_revisions WHERE id = ${fixture.revisionIds[0]}`;
    const candidate = structuredClone(old.snapshot);
    candidate.title = `Private work ${fixture.title}`;
    candidate.accessLevel = 'staff';
    candidate.body.sections[0].html = '<p>Private indexed synthetic content</p><h3>Detalhes</h3><p>Nested synthetic text</p><h3>Detalhes</h3><p>Second heading</p>';
    const result = await staff.evaluate(async ({ id, snapshot }) => {
      return window.Aetherverse.apiRequest('POST', `/api/staff/wiki/pages/${id}/revisions`, {
        snapshot, summary: 'Synthetic shared private draft', expectedVersion: 1,
      });
    }, { id: fixture.pageId, snapshot: candidate });
    expect(result.data.head.snapshot.accessLevel).toBe('staff');
    await staff.goto(`${origin}/wiki`);
    await staff.getByRole('link', { name: 'Rascunhos da equipe', exact: true }).click();
    await staff.getByRole('link', { name: candidate.title, exact: true }).click();
    await expect(staff.locator('#main')).toContainText('Private indexed synthetic content');
    const toc = staff.getByRole('navigation', { name: 'Índice do artigo' });
    await expect(toc.getByRole('link', { name: 'Detalhes', exact: true })).toHaveCount(2);
    await staff.screenshot({ path: path.join(ROOT, '.local/test/wiki-editorial-desktop.png') });
    await toc.getByRole('link', { name: 'Detalhes', exact: true }).nth(1).click();
    const hash = new URL(staff.url()).hash;
    expect(hash).toContain('-heading-1');
    await staff.reload();
    await expect(staff.locator(hash)).toBeVisible();
    await staff.setViewportSize({ width: 390, height: 844 });
    expect(await staff.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await staff.screenshot({ path: path.join(ROOT, '.local/test/wiki-editorial-mobile.png') });
    await guest.goto(`${origin}/wiki/${fixture.slug}`);
    await expect(guest.locator('#main')).not.toContainText('Private indexed synthetic content');
    expect((await guestContext.request.get(`${origin}/api/staff/wiki/pages/${fixture.pageId}`)).status()).toBe(401);
    await login(member, fixture.users.member);
    await member.goto(`${origin}/wiki/rascunhos/${fixture.pageId}`);
    await expect(member.locator('#main')).toContainText('restrita à staff');
    await expect(member.locator('#main')).not.toContainText('Private indexed synthetic content');
    expect((await memberContext.request.get(`${origin}/api/staff/wiki/pages/${fixture.pageId}`)).status()).toBe(403);
    await staff.getByRole('link', { name: 'Editar artigo', exact: true }).click();
    await expect(staff.locator('#wiki-editor-title')).toHaveValue(candidate.title);
    await staff.locator('#wiki-editor-summary').fill('Latest synthetic saved head');
    const savedResponse = staff.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === `/api/staff/wiki/pages/${fixture.pageId}/revisions`);
    await staff.getByRole('button', { name: 'Salvar rascunho', exact: true }).click();
    const savedHead = await savedResponse;
    expect(savedHead.status()).toBe(200);
    expect((await savedHead.json()).data.head.snapshot.summary).toBe('Latest synthetic saved head');
    await expect(staff.locator('#wiki-editor-summary')).toHaveValue('Latest synthetic saved head');
    await expect(staff.getByRole('button', { name: 'Publicar para todos', exact: true })).toBeEnabled();
    await staff.goBack();
    await expect(staff.locator('#main')).toContainText('Latest synthetic saved head');
    await staff.getByRole('link', { name: 'Editar artigo', exact: true }).click();
    staff.once('dialog', dialog => dialog.dismiss());
    await staff.getByRole('button', { name: 'Publicar para todos', exact: true }).click();
    const [beforePublic] = await sql`SELECT r.snapshot FROM wiki_pages p JOIN wiki_revisions r ON r.id=p.published_revision_id WHERE p.id=${fixture.pageId}`;
    expect(beforePublic.snapshot.title).toBe(fixture.title);
    staff.once('dialog', dialog => dialog.accept());
    const published = staff.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === `/api/staff/wiki/pages/${fixture.pageId}/publish`);
    await staff.getByRole('button', { name: 'Publicar para todos', exact: true }).click();
    expect((await published).status()).toBe(200);
    await guest.reload();
    await expect(guest.locator('#main')).toContainText('Private indexed synthetic content');
    await staff.goto(`${origin}/wiki/rascunhos/${fixture.pageId}`);
    await expect(staff.locator('#main')).toContainText('Private indexed synthetic content');
    await staff.locator('#top-btn-area').getByText('Sair', { exact: true }).click();
    await expect(staff.locator('#main')).not.toContainText('Private indexed synthetic content');
  } finally { await Promise.all([staffContext.close(), guestContext.close(), memberContext.close()]); }
});


test('wiki sections remain visible without articles and navigate as forum-style rows', async ({ browser }) => {
  const context = await isolatedContext(browser);
  const page = await context.newPage();
  try {
    await page.goto(`${origin}/wiki`);
    const sections = page.getByRole('navigation', { name: 'Seções da Wiki' });
    await expect(sections.locator('.wiki-section-group')).toHaveCount(4);
    await expect(sections.locator('.wiki-section-row')).toHaveCount(12);
    await expect(page.locator('#wiki-category-select')).toHaveCount(0);
    await expect(sections.getByText('Ainda não há artigos nesta seção.', { exact: true })).toHaveCount(12);
    await page.screenshot({ path: path.join(ROOT, '.local/test/wiki-sections-desktop.png'), fullPage: true });
    await sections.getByRole('link', { name: 'Percepção', exact: true }).click();
    await expect(page).toHaveURL(`${origin}/wiki?categoria=percepcao`);
    await expect(page.locator('#main')).toContainText('Ainda não há artigos nesta seção com os filtros atuais.');
    await page.reload();
    await expect(sections.getByRole('link', { name: 'Percepção', exact: true })).toHaveAttribute('aria-current', 'page');
    await page.getByRole('link', { name: 'Todas as seções', exact: true }).click();
    await expect(page).toHaveURL(`${origin}/wiki`);
    await page.goBack();
    await expect(sections.getByRole('link', { name: 'Percepção', exact: true })).toHaveAttribute('aria-current', 'page');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => scrollTo(0, 0));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: path.join(ROOT, '.local/test/wiki-sections-mobile.png'), fullPage: true });
    await page.locator('#nav-wiki').click();
    await expect(page).toHaveURL(`${origin}/wiki`);
    await expect(sections.locator('.wiki-section-group')).toHaveCount(4);
    const forbidden = await context.request.get(`${origin}/api/staff/wiki/pages`);
    expect(forbidden.status()).toBe(401);
  } finally { await context.close(); }
});

test('staff imports Work JSON through preview, exports and revises it without publishing', async ({ browser }) => {
  const staffContext = await isolatedContext(browser);
  const guestContext = await isolatedContext(browser);
  const memberContext = await isolatedContext(browser);
  const staff = await staffContext.newPage(), guest = await guestContext.newPage(), member = await memberContext.newPage();
  const suffix = randomUUID().slice(0, 8);
  const content = 'Synthetic article-file source.\nSecond source line.\n';
  const archive = createHash('sha256').update('browser-source-' + suffix).digest('hex');
  const [source] = await sql`INSERT INTO wiki_sources(archive_sha256,relative_path,file_sha256,family,language,declared_version,declared_date,content,imported_by)
    VALUES(${archive},'browser-source.md',${createHash('sha256').update(content).digest('hex')},'Synthetic','pt-BR',NULL,NULL,${content},${fixture.users.staff.id}) RETURNING id`;
  fixture.sourceIds.push(source.id);
  const file = {
    format: 'AetherverseWikiAuthoringV1', workspace: 'browser-file-workspace',
    sources: [{ key: 'source-one', set: 'browser-sources', path: 'browser-source.md' }],
    pages: [{ key: 'file-' + suffix, title: 'Imported file ' + suffix, slug: 'imported-file-' + suffix,
      aliases: [], type: 'concept', summary: 'Synthetic imported article', categories: ['Percepção'], audience: 'author', infobox: [],
      sections: [{ key: 'overview', heading: 'Visão geral', html: '<p>Imported synthetic prose.</p><h3>Detalhes</h3><p>Source-backed detail.</p>', authority: [], knowledgeLayer: 'mixed', citations: [{ source: 'source-one', locator: 'linhas 1–2' }] }],
    }],
  };
  const upload = data => ({ name: 'artigo.authoring.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  try {
    await login(staff, fixture.users.staff);
    await staff.goto(`${origin}/wiki/novo`);
    const panel = staff.locator('.wiki-article-file-panel');
    await panel.locator(':scope > summary').click();
    await panel.getByText('Como pedir a uma IA que formate o artigo', { exact: true }).click();
    await panel.getByRole('button', { name: 'Carregar brief e modelo', exact: true }).click();
    await expect(panel.locator('#wiki-article-ai-brief')).toContainText('AetherverseWikiAuthoringV1');
    const exampleDownload = staff.waitForEvent('download');
    await panel.getByRole('button', { name: 'Baixar exemplo JSON', exact: true }).click();
    const example = JSON.parse(fs.readFileSync(await (await exampleDownload).path(), 'utf8'));
    expect(example.format).toBe('AetherverseWikiAuthoringV1');
    const briefDownload = staff.waitForEvent('download');
    await panel.getByRole('button', { name: 'Baixar brief para IA', exact: true }).click();
    expect(fs.readFileSync(await (await briefDownload).path(), 'utf8')).toContain('browser-source.md');
    await panel.locator('#wiki-article-file').setInputFiles(upload(file));
    await expect(panel.locator('.wiki-file-preview')).toContainText(file.pages[0].title);
    await expect(panel.getByRole('button', { name: 'Salvar prévia como rascunho', exact: true })).toBeVisible();
    const [uncommitted] = await sql`SELECT count(*)::int AS count FROM wiki_revisions WHERE snapshot->>'slug'=${file.pages[0].slug}`;
    expect(uncommitted.count).toBe(0);
    await staff.screenshot({ path: path.join(ROOT, '.local/test/wiki-article-file-preview-desktop.png'), fullPage: true });
    const savedPromise = staff.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/staff/wiki/article-files/commit');
    await panel.getByRole('button', { name: 'Salvar prévia como rascunho', exact: true }).click();
    const savedResponse = await savedPromise;
    expect(savedResponse.status()).toBe(201);
    const created = (await savedResponse.json()).data.page;
    fixture.extraPageIds.push(created.id);
    expect(created.publishedRevisionId).toBeNull();
    await expect(staff).toHaveURL(`${origin}/wiki/rascunhos/${created.id}`);
    await expect(staff.locator('#main')).toContainText('Imported synthetic prose.');
    const exportedDownload = staff.waitForEvent('download');
    await staff.getByRole('button', { name: 'Exportar JSON da equipe', exact: true }).click();
    const exported = JSON.parse(fs.readFileSync(await (await exportedDownload).path(), 'utf8'));
    expect(exported.format).toBe('AetherverseWikiAuthoringV1');
    expect(JSON.stringify(exported)).not.toMatch(/password|session|actorId|importedBy/);
    exported.pages[0].summary = 'Edited externally with AI';
    exported.pages[0].sections[0].html = '<p>Revised external synthetic prose.</p>';
    await staff.getByRole('link', { name: 'Editar artigo', exact: true }).click();
    await staff.locator('.wiki-article-file-panel > summary').click();
    await staff.locator('#wiki-article-file').setInputFiles(upload(exported));
    await expect(staff.locator('.wiki-file-preview')).toContainText('Edited externally with AI');
    await expect(staff.locator('.wiki-file-preview')).toContainText('Nova revisão do artigo existente');
    const revisedPromise = staff.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/staff/wiki/article-files/commit');
    await staff.getByRole('button', { name: 'Salvar prévia como rascunho', exact: true }).click();
    expect((await revisedPromise).status()).toBe(200);
    await expect(staff.locator('#main')).toContainText('Revised external synthetic prose.');
    const [current] = await sql`SELECT p.published_revision_id,r.snapshot FROM wiki_pages p JOIN wiki_revisions r ON r.id=p.head_revision_id WHERE p.id=${created.id}`;
    expect(current.published_revision_id).toBeNull();
    expect(current.snapshot.body.sections[0].id).toBe(created.head.snapshot.body.sections[0].id);
    await staff.goto(`${origin}/wiki/novo`);
    await staff.locator('.wiki-article-file-panel > summary').click();
    await staff.locator('#wiki-article-file').setInputFiles(upload(exported));
    await expect(staff.locator('#wiki-article-file-target')).toBeVisible();
    await expect(staff.getByRole('button', { name: 'Salvar prévia como rascunho', exact: true })).toHaveCount(0);
    await staff.locator('#wiki-article-file-target').selectOption(created.id);
    await staff.getByRole('button', { name: 'Validar arquivo / atualizar prévia', exact: true }).click();
    await expect(staff.getByRole('button', { name: 'Salvar prévia como rascunho', exact: true })).toBeVisible();
    await expect(staff.locator('.wiki-file-before')).toContainText('Revised external synthetic prose.');

    await guest.goto(`${origin}/wiki/${fixture.slug}`);
    await expect(guest.getByRole('button', { name: 'Exportar JSON da equipe', exact: true })).toHaveCount(0);
    expect((await guestContext.request.get(`${origin}/api/staff/wiki/pages/${created.id}/article-file`)).status()).toBe(401);
    await login(member, fixture.users.member);
    await member.goto(`${origin}/wiki/${fixture.slug}`);
    await expect(member.getByRole('button', { name: 'Exportar JSON da equipe', exact: true })).toHaveCount(0);
    expect((await memberContext.request.get(`${origin}/api/staff/wiki/pages/${created.id}/article-file`)).status()).toBe(403);
    await member.goto(`${origin}/wiki/novo`);
    await expect(member.locator('#wiki-article-file')).toHaveCount(0);
    await staff.goto(`${origin}/wiki/${fixture.slug}`);
    const fallbackDownload = staff.waitForEvent('download');
    await staff.getByRole('button', { name: 'Exportar JSON da equipe', exact: true }).click();
    const fallback = JSON.parse(fs.readFileSync(await (await fallbackDownload).path(), 'utf8'));
    expect(fallback.format).toBe('AetherverseWikiBundleV1');
    expect(fallback.pages[0].snapshot.body.sections[0].html).toContain(fixture.initialText);
    expect(fallback.sources).toEqual([]);
    await staff.goto(`${origin}/wiki/novo`);
    await staff.locator('.wiki-article-file-panel > summary').click();
    await staff.locator('#wiki-article-file').setInputFiles(upload(fallback));
    await expect(staff.locator('.wiki-file-preview')).toContainText(fixture.initialText);
    await expect(staff.locator('#wiki-article-file-target')).toBeVisible();
    await staff.locator('#wiki-article-file').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{"format":1,"format":2}') });
    await expect(staff.locator('.wiki-article-file-panel [role="alert"]')).toBeVisible();
    await expect(staff.getByRole('button', { name: 'Salvar prévia como rascunho', exact: true })).toHaveCount(0);
    await staff.setViewportSize({ width: 390, height: 844 });
    expect(await staff.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await staff.screenshot({ path: path.join(ROOT, '.local/test/wiki-article-file-mobile.png'), fullPage: true });
  } finally {
    const pages = await sql`SELECT id FROM wiki_pages WHERE created_by=${fixture.users.staff.id} AND id<>${fixture.pageId}`;
    fixture.extraPageIds = pages.map(p => p.id);
    await Promise.all([staffContext.close(), guestContext.close(), memberContext.close()]);
  }
});
