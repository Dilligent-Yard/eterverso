'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const {
  assertNoDuplicateJsonKeys,
  compileAuthoring,
  compileAuthoringContent,
  MAX_BUNDLE_BYTES,
} = require('../../scripts/wiki-authoring-compile');
const {
  ARTICLE_FILE_MAX_BYTES,
  deterministicIdempotencyKey,
  parseArticleFileText,
  signPreviewToken,
  verifyPreviewToken,
} = require('../../server/wiki-article-files');

test('article-file strict parser accepts ordinary JSON and rejects duplicate keys at any depth', () => {
  assert.deepEqual(parseArticleFileText('{"format":"demo","rows":[{"value":1}]}'), {
    format: 'demo', rows: [{ value: 1 }],
  });
  assert.throws(() => assertNoDuplicateJsonKeys('{"title":"first","title":"second"}'), /duplicate/u);
  assert.throws(() => parseArticleFileText('{"page":{"slug":"one","slug":"two"}}'),
    (error) => error.publicCode === 'INVALID_WIKI_ARTICLE_FILE_JSON');
  assert.throws(() => parseArticleFileText('{"bad": }'), /JSON/u);
});

test('article-file parser enforces its UTF-8 byte limit', () => {
  const tooLarge = `${'x'.repeat(ARTICLE_FILE_MAX_BYTES - 1)}é`;
  assert.ok(Buffer.byteLength(tooLarge, 'utf8') > ARTICLE_FILE_MAX_BYTES);
  assert.throws(() => parseArticleFileText(tooLarge), (error) => error.status === 413
    && error.publicCode === 'WIKI_ARTICLE_FILE_TOO_LARGE');
});

test('article-file preview tokens are HMAC protected, expiring, and bound to an actor payload', () => {
  const secret = 'synthetic article-file test secret';
  const plan = {
    version: 1,
    actorId: '11111111-1111-4111-8111-111111111111',
    expiresAt: Date.now() + 60_000,
    snapshot: { accessLevel: 'staff' },
    citations: [],
    sourceIdentities: [],
    target: { pageId: null },
  };
  const token = signPreviewToken(secret, plan);
  assert.deepEqual(verifyPreviewToken(secret, token), plan);
  assert.throws(() => verifyPreviewToken('different secret', token), (error) => error.publicCode === 'INVALID_WIKI_ARTICLE_PREVIEW_TOKEN');
  assert.throws(() => verifyPreviewToken(secret, `${token}x`), (error) => error.publicCode === 'INVALID_WIKI_ARTICLE_PREVIEW_TOKEN');
  assert.throws(() => verifyPreviewToken(secret, signPreviewToken(secret, { ...plan, expiresAt: Date.now() - 1 })),
    (error) => error.publicCode === 'WIKI_ARTICLE_PREVIEW_EXPIRED');
});

test('article-file replay keys are deterministic UUIDs derived from token bytes', () => {
  const first = deterministicIdempotencyKey('synthetic signed preview');
  assert.equal(first, deterministicIdempotencyKey('synthetic signed preview'));
  assert.notEqual(first, deterministicIdempotencyKey('different signed preview'));
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
});

test('authoring content validation accepts registered sources beyond the portable-bundle size limit', () => {
  const content = 'L'.repeat(MAX_BUNDLE_BYTES + 64);
  const archiveSha256 = hash('synthetic large source archive');
  const fileSha256 = hash(content);
  const set = `archive-${archiveSha256}`;
  const authoring = {
    format: 'AetherverseWikiAuthoringV1',
    workspace: 'large-source-regression',
    sources: [{ key: 'source-large', set, path: 'synthetic/large-source.txt' }],
    pages: [{
      key: 'page-large-source',
      title: 'Synthetic large source article',
      slug: 'synthetic-large-source-article',
      aliases: [],
      type: 'concept',
      summary: 'A small article that cites a registered large source.',
      categories: [],
      audience: 'reader',
      infobox: [],
      sections: [{
        key: 'section-overview',
        heading: 'Overview',
        html: '<p>Small article content.</p>',
        authority: [],
        knowledgeLayer: 'unspecified',
        citations: [{ source: 'source-large', locator: 'Synthetic page 1' }],
      }],
    }],
  };
  const sourceSets = new Map([[set, {
    archiveSha256,
    files: [{
      archiveSha256,
      relativePath: 'synthetic/large-source.txt',
      fileSha256,
      family: 'Synthetic source set',
      language: 'en',
      declaredVersion: 'v1',
      declaredDate: '2026-11-02',
      role: 'source',
      content,
    }],
  }]]);

  const compiled = compileAuthoringContent(authoring, sourceSets);
  assert.equal(compiled.counts.sources, 1);
  assert.equal(compiled.sources[0].content, content);
  assert.equal(compiled.pages[0].snapshot.title, authoring.pages[0].title);
  assert.throws(() => compileAuthoring(authoring, sourceSets), /transfer bundle|4 MiB|bundle/iu);
});

function hash(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
