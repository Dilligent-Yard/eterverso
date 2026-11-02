'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const recovery = require('../../legacy-recovery.js');

const fixtureObject = {
  users: [
    { id: 2, username: 'Pessoa Sintética', email: 'private@example.invalid', password: 'synthetic-password', password_hash: 'synthetic-hash', role: 'admin', admTentativaUsada: true, posts: 81 },
    { id: 9, username: 'Autor sem função', role: 'member', email: 'another@example.invalid' }
  ],
  session: { userId: 2, token: 'synthetic-session-token' },
  adminPuzzle: { answer: 'never-export' },
  nextUserId: 10,
  categories: [{ id: 4, name: 'Categoria de exemplo', desc: 'Texto de teste', privateFlag: true }],
  threads: [{ id: 7, catId: 4, title: 'Tópico sintético', authorId: 2, date: '31/12/2025 23:45', views: 23, tag: 'teste', pinned: false }],
  posts: [
    { id: 11, threadId: 7, authorId: 2, date: '31/12/2025 23:46', content: '<p>Conteúdo de teste.</p>', edited: false, email: 'must-not-copy@example.invalid' },
    { id: 12, threadId: 999, authorId: 404, date: 'data sem correspondência', content: 'Post órfão sintético.' }
  ],
  personagens: [{ id: 12, nome: 'Personagem sintético', descricao: '<p>Descrição sintética.</p>', stats: { forca: 50 }, authorId: 9, updatedAt: 'data legada sem fuso' }],
  wikiPosts: [{ id: 101, titulo: 'Cena sintética 101', descricao: '<p>Cena de teste.</p>', authorId: 2, createdAt: '01/01/2026 10:00', turns: [{ id: 33, authorId: 9, date: '01/01/2026 10:05', content: '<p>Turno sintético.</p>', role: 'admin' }] }]
};
const rawFixture = JSON.stringify(fixtureObject);

test('raw recovery returns the exact stored string and never imports app.js', async () => {
  let reads = 0;
  let writes = 0;
  const storage = {
    getItem(key) {
      reads += 1;
      assert.equal(key, 'forum-antigo-db-v22');
      return rawFixture;
    },
    setItem() { writes += 1; }
  };
  const captured = recovery.captureRawValue(storage);
  const exported = await recovery.prepareRawExport(captured.raw, 'http://localhost:3000', 'fixture', { now: '2026-01-01T00:00:00.000Z' });
  const html = fs.readFileSync(path.join(__dirname, '../../legacy-recovery.html'), 'utf8');
  const script = fs.readFileSync(path.join(__dirname, '../../legacy-recovery.js'), 'utf8');

  assert.equal(captured.found, true);
  assert.equal(exported.raw, rawFixture);
  assert.equal(JSON.stringify(fixtureObject), rawFixture);
  assert.equal(exported.metadata.sha256, await recovery.sha256Hex(rawFixture));
  assert.equal(exported.metadata.origin, 'http://localhost:3000');
  assert.equal(exported.metadata.exportLabel, 'fixture');
  assert.equal(reads, 1);
  assert.equal(writes, 0);
  assert.equal(storage.getItem('forum-antigo-db-v22'), rawFixture);
  assert.equal(writes, 0);
  assert.match(html, /legacy-recovery\.js/);
  assert.doesNotMatch(html, /(?:src|href)=["'][^"']*app\.js/);
  assert.doesNotMatch(script, /loadDB\s*\(|app\.js|localStorage\.setItem\s*\(/);
});

test('content conversion keeps legacy IDs, author links, dates and content while excluding identity and authority data', async () => {
  const before = rawFixture;
  const result = await recovery.convertSnapshot(rawFixture, {
    origin: 'http://localhost:3000',
    now: '2026-01-01T00:00:00.000Z'
  });
  const encoded = JSON.stringify(result.content);

  assert.equal(rawFixture, before);
  assert.equal(result.content.scenes[0].id, 101);
  assert.equal(result.content.scenes[0].authorId, 2);
  assert.equal(result.content.scenes[0].turns[0].authorId, 9);
  assert.equal(result.content.posts[0].authorId, 2);
  assert.equal(result.content.posts[0].date, '31/12/2025 23:46');
  assert.equal(result.content.posts[0].content, '<p>Conteúdo de teste.</p>');
  assert.equal(result.content.characters[0].updatedAt, 'data legada sem fuso');
  assert.deepEqual(result.content.attributionLabels, [
    { id: 2, username: 'Pessoa Sintética' },
    { id: 9, username: 'Autor sem função' }
  ]);
  assert.deepEqual(result.report.unmappedAuthors, [{ legacyId: 404, referencedAt: 'posts[1]' }]);
  assert.deepEqual(result.report.missingParents, [{ resource: 'post', legacyId: 12, parentType: 'thread', parentId: 999 }]);
  assert.ok(result.report.exclusions.security > 0);
  assert.ok(result.report.exclusions.session > 0);
  assert.ok(result.report.exclusions.counter > 0);
  for (const forbidden of ['private@example.invalid', 'synthetic-password', 'synthetic-hash', 'admin', 'synthetic-session-token', 'never-export']) {
    assert.equal(encoded.includes(forbidden), false, `converted export must exclude ${forbidden}`);
  }
  assert.ok(result.report.excludedFields.some((item) => item.field === 'role'));
  assert.ok(result.report.excludedFields.some((item) => item.field === 'session'));
  assert.ok(result.report.legacyDates.some((item) => item.value === '31/12/2025 23:46'));
  assert.equal(result.report.counts.scenes, 1);
  assert.equal(result.report.counts.turns, 1);
  assert.equal(result.report.counts.posts, 2);
});

test('converter refuses malformed and oversized inputs rather than truncating', async () => {
  await assert.rejects(recovery.convertSnapshot('{'), /JSON válido/);
  const oversized = ' '.repeat(recovery.MAX_CONVERSION_BYTES + 1);
  await assert.rejects(recovery.convertSnapshot(oversized), /5 MB/);
});
