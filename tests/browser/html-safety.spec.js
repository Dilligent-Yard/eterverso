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
const PASSWORD = 'Synthetic-html-safety-browser-password-42';
const TURN_PRESENTATION_PAYLOAD = `');window.__htmlSafetyRuns.push("turn-presentation");//`;
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
      sessionSecret: `html-safety-browser-${randomUUID()}`, secureCookies: false,
      production: false, publicOrigin: origin, staticRoot: ROOT,
    },
  }));
  const privateDirectory = path.join(ROOT, '.local/test');
  fs.mkdirSync(privateDirectory, { recursive: true, mode: 0o700 });
  fs.chmodSync(privateDirectory, 0o700);
  serverRecord = path.join(privateDirectory, `html-safety-browser-${process.pid}-${randomUUID()}.json`);
  fs.writeFileSync(serverRecord, JSON.stringify({ pid: process.pid, origin, schema: REQUIRED_MIGRATION }), { mode: 0o600, flag: 'wx' });
});

test.beforeEach(async () => { fixture = await makeFixture(); });
test.afterEach(async () => { if (fixture) await cleanFixture(fixture); fixture = null; });
test.afterAll(async () => {
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (sql) await sql.end({ timeout: 5 });
  if (serverRecord) fs.rmSync(serverRecord, { force: true });
});

test('HTML-01/02 hostile legacy content stays inert across rendered pages, blocks, turns, and preview', async ({ browser }) => {
  const context = await isolatedContext(browser);
  try {
    const page = await context.newPage();
    await context.addInitScript(() => { window.__htmlSafetyRuns = []; });
    const errors = observePageErrors(page);
    await login(page, fixture.staff);

    await page.goto(`${origin}/forum/topicos/${fixture.threadId}`);
    const post = page.locator('.post-content');
    await assertSafeRenderedHtml(page, post, [fixture.markers.post]);
    await expect(post.locator('ul li')).toContainText(`safe-${fixture.markers.post}-list`);
    await expect(post.locator('blockquote')).toContainText(`safe-${fixture.markers.post}-quote`);
    await expect(post.locator('table th')).toContainText(`safe-${fixture.markers.post}-table`);
    await expect(post.locator(`img[alt="safe-${fixture.markers.post}-image"]`)).toHaveCount(1);
    await assertSafeColorAndFont(post, `safe-${fixture.markers.post}-styled`);

    await page.goto(`${origin}/personagens/${fixture.characterId}`);
    const characterHtml = page.locator('#main .char-sheet-body');
    await expect(characterHtml).toHaveCount(2);
    await assertSafeRenderedHtml(page, characterHtml, [fixture.markers.character, fixture.markers.characterBlock]);

    await page.goto(`${origin}/cenas/${fixture.sceneId}`);
    const sceneHtml = page.locator('#main .char-sheet-body');
    await expect(sceneHtml).toHaveCount(2);
    await assertSafeRenderedHtml(page, sceneHtml, [fixture.markers.scene, fixture.markers.sceneBlock]);
    const turnHtml = page.locator('#main .turn-content-body');
    await assertSafeRenderedHtml(page, turnHtml, [fixture.markers.turn]);

    for (const selector of [
      '#main .turn-card .turn-avatar',
      '#main .turn-card .turn-banner-media',
      '#main .turn-card .turn-gallery-card',
    ]) {
      await page.locator(selector).click();
      await expect(page.locator('#lightbox-container .lightbox-caption')).toContainText(TURN_PRESENTATION_PAYLOAD);
      await expect.poll(() => page.evaluate(() => window.__htmlSafetyRuns)).toEqual([]);
      await page.locator('#lightbox-container .lightbox-overlay').click();
    }

    // legacy_id is varchar(80); this short printable value exercises both
    // quote and backslash serialization through the rendered turn action.
    await page.locator('#main .turn-card .post-actions').getByText('Editar', { exact: true }).click();
    await expect(page.locator('#modal-container .modal-header')).toContainText('Editar Turno');
    await expect.poll(() => page.evaluate(() => window.__htmlSafetyRuns)).toEqual([]);
    await page.locator('#modal-container .modal-header button').click();

    await page.goto(`${origin}/wiki/${fixture.wikiSlug}`);
    const articleHtml = page.locator('#main .wiki-content-area');
    await assertSafeRenderedHtml(page, articleHtml, [fixture.markers.article]);
    const articleResponse = await context.request.get(`${origin}/api/wiki/resolve/${fixture.wikiSlug}`);
    expect(articleResponse.status()).toBe(200);
    const resolved = (await articleResponse.json()).data;
    const pageResponse = await context.request.get(`${origin}/api/wiki/pages/${resolved.id}`);
    expect(pageResponse.status()).toBe(200);
    const article = (await pageResponse.json()).data;
    expect(article.body.sections[0].blocks[0].content).toContain(`safe-${fixture.markers.wikiBlock}-bold`);
    expect(article.body.sections[0].blocks[0].content).not.toMatch(/onerror|onload|javascript:|<svg|<iframe|<script/i);
    await expect.poll(() => page.evaluate(() => window.__htmlSafetyRuns)).toEqual([]);

    await page.goto(`${origin}/cenas`);
    await page.getByRole('link', { name: '+ Nova Cena / Post Customizável', exact: true }).click();
    await page.locator('#c-titulo').fill(`Prévia sintética ${fixture.suffix}`);
    // Keep hostile source inert in the editor's HTML textarea until the
    // preview request sends it through the server sanitizer.
    await page.locator('#htmlbtn-c-editor').click();
    await page.locator('#src-c-editor').fill(fixture.previewHtml);
    await page.getByRole('button', { name: '+ Seção de Texto Extra', exact: true }).click();
    await page.locator('.bb-sec-content').fill(fixture.previewBlock);
    const previewResponsePromise = page.waitForResponse((response) => response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/content/preview');
    await page.getByRole('button', { name: 'Pré-visualizar', exact: true }).click();
    expect((await previewResponsePromise).status()).toBe(200);
    const previewHtml = page.locator('#modal-container .modal-body .char-sheet-body');
    await expect(previewHtml).toHaveCount(2);
    await assertSafeRenderedHtml(page, previewHtml, [fixture.markers.preview, fixture.markers.previewBlock]);
    await assertSafeColorAndFont(previewHtml, `safe-${fixture.markers.preview}-styled`);

    await page.locator('#modal-container .modal-header button').click();
    expect(errors).toEqual([]);
  } finally {
    await context.close();
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
  const tables = await sql`SELECT to_regclass('public.posts') IS NOT NULL AS posts,
    to_regclass('public.personagens') IS NOT NULL AS personagens,
    to_regclass('public.scene_turns') IS NOT NULL AS scene_turns,
    to_regclass('public.wiki_pages') IS NOT NULL AS wiki_pages,
    to_regclass('public.request_keys') IS NOT NULL AS request_keys`;
  assert.equal(tables[0].posts && tables[0].personagens && tables[0].scene_turns
    && tables[0].wiki_pages && tables[0].request_keys, true);
}

async function makeFixture() {
  const suffix = randomUUID().slice(0, 8);
  const f = {
    suffix,
    staff: null,
    categoryId: null,
    threadId: null,
    characterId: null,
    sceneId: randomUUID(),
    turnId: randomUUID(),
    legacyTurnId: `legacy-'\\${suffix}`,
    wikiPageId: randomUUID(),
    wikiRevisionId: randomUUID(),
    wikiSectionId: randomUUID(),
    wikiSlug: `html-safety-${suffix}`,
    markers: {
      post: `post-${suffix}`,
      character: `character-${suffix}`,
      characterBlock: `character-block-${suffix}`,
      scene: `scene-${suffix}`,
      sceneBlock: `scene-block-${suffix}`,
      turn: `turn-${suffix}`,
      article: `article-${suffix}`,
      wikiBlock: `wiki-block-${suffix}`,
      preview: `preview-${suffix}`,
      previewBlock: `preview-block-${suffix}`,
    },
  };
  const username = `html-safety-${suffix}`;
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  f.staff = { username };
  f.categoryName = `Categoria HTML sintética ${suffix}`;
  f.threadTitle = `Tópico HTML sintético ${suffix}`;
  f.characterName = `Personagem HTML sintético ${suffix}`;
  f.sceneTitle = `Cena HTML sintética ${suffix}`;
  f.wikiTitle = `Artigo HTML sintético ${suffix}`;

  const postHtml = richHtml(f.markers.post, `forum-${suffix}`);
  const characterHtml = richHtml(f.markers.character, `character-${suffix}`);
  const characterBlock = richHtml(f.markers.characterBlock, `character-block-${suffix}`);
  const sceneHtml = richHtml(f.markers.scene, `scene-${suffix}`);
  const sceneBlock = richHtml(f.markers.sceneBlock, `scene-block-${suffix}`);
  const turnHtml = richHtml(f.markers.turn, `turn-${suffix}`);
  const articleHtml = richHtml(f.markers.article, `article-${suffix}`);
  const wikiBlock = richHtml(f.markers.wikiBlock, `wiki-block-${suffix}`);
  f.previewHtml = richHtml(f.markers.preview, `preview-${suffix}`);
  f.previewBlock = richHtml(f.markers.previewBlock, `preview-block-${suffix}`);

  try {
    await sql.begin(async (tx) => {
      const users = await tx`INSERT INTO users (username, email, password_hash, role)
        VALUES (${username}, ${`${username}@example.test`}, ${passwordHash}, 'moderador') RETURNING id`;
      f.staff.id = users[0].id;

      const categories = await tx`INSERT INTO categories (name, description)
        VALUES (${f.categoryName}, 'Categoria sintética para HTML safety') RETURNING id`;
      f.categoryId = categories[0].id;
      const threads = await tx`INSERT INTO threads (category_id, author_id, title, tag)
        VALUES (${f.categoryId}, ${f.staff.id}, ${f.threadTitle}, 'html') RETURNING id`;
      f.threadId = threads[0].id;
      await tx`INSERT INTO posts (thread_id, author_id, content, post_no)
        VALUES (${f.threadId}, ${f.staff.id}, ${postHtml}, 1)`;

      const characters = await tx`INSERT INTO personagens
        (author_id, nome, categoria, descricao, blocks, theme)
        VALUES (${f.staff.id}, ${f.characterName}, 'Personagem Principal', ${characterHtml},
          ${tx.json([{ type: 'section', title: `Bloco ${suffix}`, content: characterBlock }])}, ${tx.json({})}) RETURNING id`;
      f.characterId = characters[0].id;

      const rawTurns = [{ content: turnHtml }];
      const legacyDigest = createHash('sha256').update(JSON.stringify(rawTurns)).digest('hex');
      await tx`INSERT INTO wiki_posts
        (id, author_id, titulo, categoria, status, descricao, theme, infobox, blocks, turns)
        VALUES (${f.sceneId}, ${f.staff.id}, ${f.sceneTitle}, 'Cena de RPG', 'Em Andamento', ${sceneHtml},
          ${tx.json({ bannerStyle: 'none', layout: 'full', fontFamily: 'serif' })}, ${tx.json({ show: false })},
          ${tx.json([{ type: 'section', title: `Bloco da cena ${suffix}`, content: sceneBlock }])}, ${tx.json([])})`;
      await tx`INSERT INTO scene_turn_legacy_backups (scene_id, turns, legacy_sha256)
        VALUES (${f.sceneId}, ${tx.json(rawTurns)}, ${legacyDigest})`;
      await tx`INSERT INTO scene_turn_migrations (scene_id, turn_count, legacy_sha256)
        VALUES (${f.sceneId}, 1, ${legacyDigest})`;
      await tx`INSERT INTO scene_turns (id, scene_id, author_id, legacy_id, ordinal, content, presentation)
        VALUES (${f.turnId}, ${f.sceneId}, ${f.staff.id}, ${f.legacyTurnId}, 0, ${turnHtml},
          ${tx.json({
            characterName: TURN_PRESENTATION_PAYLOAD,
            characterAvatar: `https://example.test/${suffix}-avatar.png`,
            turnTitle: TURN_PRESENTATION_PAYLOAD,
            banner: `https://example.test/${suffix}-banner.png`,
            bannerStyle: 'panoramic',
            images: [{ url: `https://example.test/${suffix}-gallery.png`, caption: TURN_PRESENTATION_PAYLOAD }],
          })})`;

      const snapshot = {
        schemaVersion: 1,
        title: f.wikiTitle,
        slug: f.wikiSlug,
        aliases: [],
        type: 'concept',
        summary: `Resumo sintético ${suffix}`,
        categories: [],
        accessLevel: 'public',
        audience: 'reader',
        body: {
          format: 'richtext-v1',
          infobox: [],
          sections: [{
            id: f.wikiSectionId,
            heading: `Seção sintética ${suffix}`,
            html: articleHtml,
            blocks: [{ type: 'section', title: `Bloco wiki ${suffix}`, content: wikiBlock }],
            authority: [],
            knowledgeLayer: 'unspecified',
          }],
        },
      };
      await tx`INSERT INTO wiki_pages (id, created_by, access_level, work_version, public_version, published_at)
        VALUES (${f.wikiPageId}, ${f.staff.id}, 'public', 1, 1, now())`;
      await tx`INSERT INTO wiki_revisions
        (id, page_id, sequence, actor_id, edit_summary, snapshot)
        VALUES (${f.wikiRevisionId}, ${f.wikiPageId}, 1, ${f.staff.id}, 'Conteúdo sintético para HTML safety', ${tx.json(snapshot)})`;
      await tx`UPDATE wiki_pages SET head_revision_id = ${f.wikiRevisionId}, published_revision_id = ${f.wikiRevisionId}
        WHERE id = ${f.wikiPageId}`;
      await tx`INSERT INTO wiki_names (name_key, page_id, kind) VALUES (${f.wikiSlug}, ${f.wikiPageId}, 'canonical')`;
    });
    return f;
  } catch (error) {
    await cleanFixture(f);
    throw error;
  }
}

function richHtml(marker, payloadLabel) {
  return `<p><strong>safe-${marker}-bold</strong> <em>safe-${marker}-italic</em> `
    + `<span style="color:#aabbcc;font-family:Georgia, serif">safe-${marker}-styled</span></p>`
    + `<ul><li>safe-${marker}-list</li></ul>`
    + `<blockquote><p>safe-${marker}-quote</p></blockquote>`
    + `<table><thead><tr><th>safe-${marker}-table</th></tr></thead><tbody><tr><td>synthetic cell</td></tr></tbody></table>`
    + `<p><a href="https://example.test/${payloadLabel}">safe-${marker}-link</a></p>`
    + `<img src="https://example.test/safe-${payloadLabel}.png" alt="safe-${marker}-image">`
    + hostileHtml(payloadLabel);
}

function hostileHtml(label) {
  return `<script>window.__htmlSafetyRuns.push('${label}:script')</script>`
    + `<img src="https://example.test/trigger-${label}.png" onerror="window.__htmlSafetyRuns.push('${label}:event')">`
    + `<svg onload="window.__htmlSafetyRuns.push('${label}:svg')"><circle></circle></svg>`
    + `<iframe srcdoc="&lt;script&gt;parent.window.__htmlSafetyRuns.push('${label}:frame')&lt;/script&gt;"></iframe>`
    + `<a href="javascript:window.__htmlSafetyRuns.push('${label}:javascript')">unsafe ${label} URL</a>`
    + `<a href="//evil.invalid/${label}">protocol-relative ${label} URL</a>`
    + `<img src="data:image/png;base64,AAAA" alt="data ${label}">`
    + `<span style="color:red;background-image:url(javascript:window.__htmlSafetyRuns.push('${label}:css'))">CSS ${label}</span>`;
}

async function cleanFixture(f) {
  if (!sql || !f) return;
  await sql.begin(async (tx) => {
    if (f.wikiPageId) {
      await tx`ALTER TABLE wiki_revisions DISABLE TRIGGER wiki_revisions_immutable`;
      await tx`DELETE FROM audit_events WHERE target_id = ${f.wikiPageId}`;
      await tx`DELETE FROM wiki_revision_categories WHERE revision_id IN (SELECT id FROM wiki_revisions WHERE page_id = ${f.wikiPageId})`;
      await tx`DELETE FROM wiki_revision_links WHERE revision_id IN (SELECT id FROM wiki_revisions WHERE page_id = ${f.wikiPageId})`;
      await tx`DELETE FROM wiki_revision_citations WHERE revision_id IN (SELECT id FROM wiki_revisions WHERE page_id = ${f.wikiPageId})`;
      await tx`UPDATE wiki_pages SET head_revision_id = NULL, published_revision_id = NULL WHERE id = ${f.wikiPageId}`;
      await tx`DELETE FROM wiki_names WHERE page_id = ${f.wikiPageId}`;
      await tx`DELETE FROM wiki_revisions WHERE page_id = ${f.wikiPageId}`;
      await tx`DELETE FROM wiki_pages WHERE id = ${f.wikiPageId}`;
      await tx`ALTER TABLE wiki_revisions ENABLE TRIGGER wiki_revisions_immutable`;
    }
    if (f.sceneId) {
      await tx`DELETE FROM scene_turn_migration_issues WHERE scene_id = ${f.sceneId}`;
      await tx`DELETE FROM scene_turns WHERE scene_id = ${f.sceneId}`;
      await tx`DELETE FROM scene_turn_migrations WHERE scene_id = ${f.sceneId}`;
      await tx`DELETE FROM scene_turn_legacy_backups WHERE scene_id = ${f.sceneId}`;
      await tx`DELETE FROM wiki_posts WHERE id = ${f.sceneId}`;
    }
    if (f.characterId) await tx`DELETE FROM personagens WHERE id = ${f.characterId}`;
    if (f.threadId) {
      await tx`DELETE FROM post_revisions WHERE post_id IN (SELECT id FROM posts WHERE thread_id = ${f.threadId})`;
      await tx`DELETE FROM forum_migration_issues WHERE thread_id = ${f.threadId}`;
      await tx`DELETE FROM posts WHERE thread_id = ${f.threadId}`;
      await tx`DELETE FROM threads WHERE id = ${f.threadId}`;
    }
    if (f.categoryId) await tx`DELETE FROM categories WHERE id = ${f.categoryId}`;
    if (f.staff && f.staff.id) {
      await tx`DELETE FROM request_keys WHERE actor_id = ${f.staff.id}`;
      await tx`DELETE FROM audit_events WHERE actor_id = ${f.staff.id}`;
      await tx`DELETE FROM users WHERE id = ${f.staff.id}`;
    }
  });
}

async function assertSafeRenderedHtml(page, roots, markers) {
  await expect(roots.first()).toBeVisible();
  for (const marker of markers) await expect(roots.filter({ hasText: `safe-${marker}-bold` })).toHaveCount(1);
  await page.waitForLoadState('networkidle');
  const violations = await roots.evaluateAll((containers) => {
    const unsafe = [];
    for (const container of containers) {
      const elements = [container, ...container.querySelectorAll('*')];
      for (const element of elements) {
        if (element.matches('script,style,svg,math,iframe,object,embed,form,template')) {
          unsafe.push(`element:${element.tagName.toLowerCase()}`);
        }
        for (const attribute of Array.from(element.attributes || [])) {
          const name = attribute.name.toLowerCase();
          const value = attribute.value.trim();
          if (/^on/i.test(name) || name === 'srcdoc') unsafe.push(`attribute:${name}`);
          if (['href', 'src', 'xlink:href'].includes(name)
              && /^(?:javascript|data|file):|^\/\//i.test(value)) unsafe.push(`${name}:${value}`);
          if (name === 'style' && /url\s*\(|expression\s*\(|@import/i.test(value)) unsafe.push(`style:${value}`);
        }
      }
    }
    return unsafe;
  });
  expect(violations).toEqual([]);
  expect(await page.evaluate(() => window.__htmlSafetyRuns)).toEqual([]);
}

async function assertSafeColorAndFont(roots, marker) {
  const style = await roots.evaluateAll((containers, target) => {
    for (const container of containers) {
      for (const span of container.querySelectorAll('span[style]')) {
        if ((span.textContent || '').includes(target)) return span.getAttribute('style');
      }
    }
    return null;
  }, marker);
  expect(style).toMatch(/color:\s*#aabbcc/i);
  expect(style).toMatch(/font-family:\s*Georgia,\s*serif/i);
}

async function login(page, user) {
  await page.goto(`${origin}/forum`);
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
  await context.route(/^https:\/\/(?:fonts\.(?:googleapis|gstatic)\.com|example\.test)\//, (route) => route.abort());
  return context;
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
