'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  extractWikiLinks,
  normalizeSlug,
  publicPageDto,
  revisionDiff,
  validateWikiSnapshot,
} = require('../../server/wiki');

const SECTION_ID = '123e4567-e89b-42d3-a456-426614174000';
const SECTION_ID_2 = '223e4567-e89b-42d3-a456-426614174000';

function snapshot(overrides = {}) {
  return {
    schemaVersion: 1,
    title: 'Página sintética',
    slug: 'pagina-sintetica',
    aliases: ['nome-anterior'],
    type: 'concept',
    summary: 'Resumo sintético.',
    categories: ['Cosmologia'],
    accessLevel: 'staff',
    audience: 'unspecified',
    body: {
      format: 'richtext-v1',
      infobox: [{ label: 'Classe', value: 'Exemplo' }],
      sections: [{
        id: SECTION_ID,
        heading: 'Visão geral',
        html: '<p>Conteúdo <strong>synthetic</strong>.</p>',
        blocks: [],
        authority: ['C', 'S'],
        knowledgeLayer: 'mixed',
      }],
    },
    ...overrides,
  };
}

test('normalizes accents and separators without transliterating other scripts', () => {
  assert.equal(normalizeSlug(' A Máscara / Ritos '), 'a-mascara-ritos');
  assert.equal(normalizeSlug('Percepção—Paranormal'), 'percepcao-paranormal');
  assert.throws(() => normalizeSlug('界'), (error) => error.publicCode === 'INVALID_SLUG');
  assert.throws(() => normalizeSlug('---'), (error) => error.publicCode === 'INVALID_SLUG');
  assert.throws(() => normalizeSlug('a'.repeat(101)), (error) => error.publicCode === 'INVALID_SLUG');
});

test('validates richtext-v1 and sanitizes hostile HTML while preserving supported markup and mixed authority', () => {
  const value = snapshot({
    accessLevel: 'public',
    body: {
      format: 'richtext-v1',
      infobox: [],
      sections: [{
        id: SECTION_ID,
        heading: 'Visão geral',
        html: '<p onclick="run()">Seguro <strong>formatado</strong><script>secret()</script></p><a href="javascript:run()">link</a>',
        blocks: [],
        authority: ['C', 'S'],
        knowledgeLayer: 'mixed',
      }],
    },
  });
  const normalized = validateWikiSnapshot(value);
  assert.equal(normalized.slug, 'pagina-sintetica');
  assert.equal(normalized.body.sections[0].authority.join(''), 'CS');
  assert.equal(normalized.body.sections[0].knowledgeLayer, 'mixed');
  assert.match(normalized.body.sections[0].html, /<strong>formatado<\/strong>/);
  assert.doesNotMatch(normalized.body.sections[0].html, /onclick|script|javascript|secret\(\)/i);
});

test('rejects unknown snapshot fields and normalized alias/category collisions', () => {
  const invalidSnapshot = (error) => error.publicCode === 'INVALID_WIKI_SNAPSHOT';
  assert.throws(() => validateWikiSnapshot({ ...snapshot(), sourceText: 'private sentinel' }), invalidSnapshot);
  assert.throws(() => validateWikiSnapshot(snapshot({ aliases: ['Nome Antigo', 'nome-antigo'] })), invalidSnapshot);
  assert.throws(() => validateWikiSnapshot(snapshot({ slug: 'novo' })), invalidSnapshot);
  assert.throws(() => validateWikiSnapshot(snapshot({ aliases: ['editor'] })), invalidSnapshot);
  assert.throws(() => validateWikiSnapshot(snapshot({ categories: ['Cosmologia', 'cosmología'] })), invalidSnapshot);
  const invalid = snapshot();
  invalid.body.sections[0].authority = ['C', 'X'];
  assert.throws(() => validateWikiSnapshot(invalid), invalidSnapshot);
});

test('extracts only normalized wiki links with stable UUID anchors', () => {
  const value = snapshot({
    body: {
      format: 'richtext-v1',
      infobox: [],
      sections: [{
        id: SECTION_ID,
        heading: 'Links',
        html: `<p><a href="/wiki/percepcao-paranormal#${SECTION_ID_2}">article</a> <a href="/wiki/private-name#not-a-stable-anchor">bad</a> <a href="https://example.test/wiki/outside">external</a></p>`,
        blocks: [{ type: 'section', content: '<a href="/wiki/outro-nome">block link</a>' }],
        authority: [],
        knowledgeLayer: 'unspecified',
      }],
    },
  });
  const normalized = validateWikiSnapshot(value);
  assert.deepEqual(extractWikiLinks(normalized), [
    { targetNameKey: 'percepcao-paranormal', targetAnchor: SECTION_ID_2 },
    { targetNameKey: 'outro-nome', targetAnchor: '' },
  ]);
});

test('public DTO excludes search helper and internal-only fields', () => {
  const dto = publicPageDto({
    id: SECTION_ID,
    publishedRevisionId: SECTION_ID_2,
    title: 'Public example',
    slug: 'public-example',
    aliases: [],
    type: 'concept',
    summary: 'Safe summary',
    categories: [],
    accessLevel: 'public',
    discussionThreadId: SECTION_ID,
    audience: 'reader',
    body: { format: 'richtext-v1', infobox: [], sections: [] },
    publicVersion: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    publishedAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    searchText: 'search helper only',
    sourceText: 'private source sentinel',
  });
  assert.equal(dto.title, 'Public example');
  assert.equal(dto.publishedRevisionId, SECTION_ID_2);
  assert.equal(dto.discussionThreadId, SECTION_ID);
  assert.equal('searchText' in dto, false);
  assert.equal('sourceText' in dto, false);
});

test('revision diff compares stable section identities and snapshot fields', () => {
  const before = snapshot();
  const after = snapshot({
    title: 'Página atualizada',
    body: {
      ...before.body,
      sections: [
        { ...before.body.sections[0], html: '<p>Updated</p>' },
        { id: SECTION_ID_2, heading: 'Novo trecho', html: '', blocks: [], authority: [], knowledgeLayer: 'unspecified' },
      ],
    },
  });
  assert.deepEqual(revisionDiff(after, before), {
    changedFields: ['title', 'body'],
    addedSections: [SECTION_ID_2],
    removedSections: [],
    changedSections: [SECTION_ID],
  });
});
