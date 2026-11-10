'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const express = require('express');
const postgres = require('postgres');
const { errorMiddleware } = require('../../server/errors');
const { createWikiSectionsRouter } = require('../../server/wiki-sections');

const ROOT = path.resolve(__dirname, '../..');
const testDatabaseUrl = process.env.ETERVERSO_TEST_DATABASE_URL;
const EXPECTED_SECTIONS = [
  { key: 'paranormalidade', name: 'Paranormalidade', parentKey: null, order: 0 },
  { key: 'percepcao', name: 'Percepção', parentKey: 'paranormalidade', order: 0 },
  { key: 'classes', name: 'Classes', parentKey: 'paranormalidade', order: 1 },
  { key: 'feiticos-e-rituais', name: 'Feitiços e rituais', parentKey: 'paranormalidade', order: 2 },
  { key: 'fundamentos-e-transformacoes', name: 'Fundamentos e transformações', parentKey: 'paranormalidade', order: 3 },
  { key: 'cosmologia', name: 'Cosmologia', parentKey: null, order: 1 },
  { key: 'conceitos-e-fenomenos', name: 'Conceitos e fenômenos', parentKey: 'cosmologia', order: 0 },
  { key: 'planos-e-lugares', name: 'Planos e lugares', parentKey: 'cosmologia', order: 1 },
  { key: 'religiao', name: 'Religião', parentKey: 'cosmologia', order: 2 },
  { key: 'vinculos-arquetipicos', name: 'Vínculos arquetípicos', parentKey: 'cosmologia', order: 3 },
  { key: 'sociedade-e-instituicoes', name: 'Sociedade e Instituições', parentKey: null, order: 2 },
  { key: 'trabalho-paranormal', name: 'Trabalho Paranormal', parentKey: 'sociedade-e-instituicoes', order: 0 },
  { key: 'vida-social-e-instituicoes', name: 'Vida social e instituições', parentKey: 'sociedade-e-instituicoes', order: 1 },
  { key: 'seres-e-entidades-area', name: 'Seres e Entidades', parentKey: null, order: 3 },
  { key: 'personagens', name: 'Personagens', parentKey: 'seres-e-entidades-area', order: 0 },
  { key: 'seres-e-entidades', name: 'Seres e entidades', parentKey: 'seres-e-entidades-area', order: 1 },
];

let sql;
let server;
let baseUrl;

test.before(async () => {
  assert.ok(testDatabaseUrl, 'Run npm run test:env:up and migrate the isolated test database to 0017 first.');
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

  sql = postgres(testDatabaseUrl, {
    prepare: false,
    max: 5,
    connect_timeout: 5,
    idle_timeout: 2,
    connection: { timezone: 'UTC' },
  });
  const identity = await sql`SELECT current_database() AS database, current_user AS username`;
  assert.equal(identity[0].database, 'eterverso_test');
  assert.equal(identity[0].username, 'eterverso_test');

  const app = express();
  app.use('/api', createWikiSectionsRouter({ sql }));
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

test('WKS-01 the public index includes all seeded areas and subsections, including empty ones', async () => {
  const response = await getSections();
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.deepEqual(response.body.data, EXPECTED_SECTIONS.map((section) => ({
    ...section,
    description: '',
    pagesCount: 0,
  })));
});

test('WKS-02 counts exact current public categories by distinct page and hides drafts, staff publications and archives', async (t) => {
  const fixture = await makeFixture(t);
  const suffix = randomUUID().slice(0, 8);
  await createPage(fixture, {
    title: `WKS02-public-overlap-${suffix}`,
    pageAccess: 'public',
    snapshotAccess: 'public',
    published: true,
    categories: ['Paranormalidade', 'Percepção', 'Classes'],
  });
  await createPage(fixture, {
    title: `WKS02-public-child-${suffix}`,
    pageAccess: 'public',
    snapshotAccess: 'public',
    published: true,
    categories: ['Percepção'],
  });
  await createPage(fixture, {
    title: `WKS02-public-parent-${suffix}`,
    pageAccess: 'public',
    snapshotAccess: 'public',
    published: true,
    categories: ['Paranormalidade'],
  });
  await createPage(fixture, {
    title: `WKS02-unmapped-public-${suffix}`,
    pageAccess: 'public',
    snapshotAccess: 'public',
    published: true,
    categories: ['Categoria legada sem seção'],
  });
  await createPage(fixture, {
    title: `WKS02-unpublished-draft-${suffix}`,
    pageAccess: 'staff',
    snapshotAccess: 'staff',
    published: false,
    categories: ['Percepção'],
  });
  await createPage(fixture, {
    title: `WKS02-historical-staff-publication-${suffix}`,
    pageAccess: 'staff',
    snapshotAccess: 'staff',
    published: true,
    categories: ['Percepção'],
  });
  await createPage(fixture, {
    title: `WKS02-archived-publication-${suffix}`,
    pageAccess: 'public',
    snapshotAccess: 'public',
    published: true,
    archived: true,
    categories: ['Percepção'],
  });

  const response = await getSections();
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const byKey = Object.fromEntries(response.body.data.map((section) => [section.key, section]));
  assert.equal(byKey.paranormalidade.pagesCount, 3);
  assert.equal(byKey.percepcao.pagesCount, 2);
  assert.equal(byKey.classes.pagesCount, 1);
  assert.equal(byKey.cosmologia.pagesCount, 0);
  assert.equal(byKey['seres-e-entidades-area'].pagesCount, 0);
  assert.equal(byKey['seres-e-entidades'].pagesCount, 0);
  const serialized = JSON.stringify(response.body);
  assert.doesNotMatch(serialized, /WKS02-(?:unpublished|historical|archived)/);
  assert.doesNotMatch(serialized, /Categoria legada sem seção/);

  const freshRead = await getSections();
  assert.deepEqual(freshRead.body, response.body);
});

async function getSections() {
  const response = await fetch(`${baseUrl}/api/wiki/sections`);
  return { status: response.status, body: await response.json() };
}

async function makeFixture(t) {
  const fixture = { pageIds: [], revisionIds: [], userId: null };
  t.after(async () => cleanFixture(fixture));
  const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
  const username = `wikisections-${suffix}`;
  const rows = await sql`
    INSERT INTO users (username, email, password_hash, role)
    VALUES (${username}, ${`${username}@example.test`}, 'test-only-hash', 'member')
    RETURNING id`;
  fixture.userId = String(rows[0].id).toLowerCase();
  return fixture;
}

async function createPage(fixture, {
  title,
  pageAccess,
  snapshotAccess,
  published,
  archived = false,
  categories,
}) {
  await sql.begin(async (tx) => {
    const pageRows = await tx`
      INSERT INTO wiki_pages (created_by, access_level)
      VALUES (${fixture.userId}, ${pageAccess})
      RETURNING id`;
    const pageId = String(pageRows[0].id).toLowerCase();
    fixture.pageIds.push(pageId);
    const snapshot = {
      schemaVersion: 1,
      title,
      slug: `wks-${randomUUID().replaceAll('-', '').slice(0, 20)}`,
      aliases: [],
      type: 'concept',
      summary: '',
      categories,
      accessLevel: snapshotAccess,
      audience: 'reader',
      body: { format: 'richtext-v1', infobox: [], sections: [] },
    };
    const revisionRows = await tx`
      INSERT INTO wiki_revisions (page_id, sequence, actor_id, edit_summary, snapshot)
      VALUES (${pageId}, 1, ${fixture.userId}, 'Synthetic section-index fixture', ${tx.json(snapshot)})
      RETURNING id`;
    const revisionId = String(revisionRows[0].id).toLowerCase();
    fixture.revisionIds.push(revisionId);
    await tx`
      UPDATE wiki_pages SET head_revision_id = ${revisionId},
        published_revision_id = ${published ? revisionId : null},
        access_level = ${pageAccess}, archived_at = ${archived ? new Date().toISOString() : null},
        published_at = ${published ? new Date().toISOString() : null},
        public_version = ${published ? 1 : 0}
      WHERE id = ${pageId}`;
    if (categories.length) {
      await tx`
        INSERT INTO wiki_revision_categories (revision_id, category, category_key)
        VALUES ${tx(categories.map((category) => [revisionId, category, categoryKey(category)]))}`;
    }
  });
}

function categoryKey(value) {
  return value.normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[\s\p{P}]+/gu, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

async function cleanFixture(fixture) {
  if (!fixture.userId) return;
  await sql.begin(async (tx) => {
    await tx`ALTER TABLE wiki_revisions DISABLE TRIGGER wiki_revisions_immutable`;
    if (fixture.revisionIds.length) {
      await tx`DELETE FROM wiki_revision_categories WHERE revision_id = ANY(${tx.array(fixture.revisionIds, 2950)})`;
    }
    for (const pageId of fixture.pageIds) {
      await tx`UPDATE wiki_pages SET head_revision_id = NULL, published_revision_id = NULL WHERE id = ${pageId}`;
    }
    if (fixture.revisionIds.length) {
      await tx`DELETE FROM wiki_revisions WHERE id = ANY(${tx.array(fixture.revisionIds, 2950)})`;
    }
    if (fixture.pageIds.length) {
      await tx`DELETE FROM wiki_pages WHERE id = ANY(${tx.array(fixture.pageIds, 2950)})`;
    }
    await tx`ALTER TABLE wiki_revisions ENABLE TRIGGER wiki_revisions_immutable`;
    await tx`DELETE FROM users WHERE id = ${fixture.userId}`;
  });
}
