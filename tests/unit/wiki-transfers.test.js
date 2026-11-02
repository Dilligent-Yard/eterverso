'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { validateBundle } = require('../../server/wiki-transfers');

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function makeBundle() {
  const sourceId = randomUUID();
  const sectionId = randomUUID();
  const pages = [{
    sourcePageId: randomUUID(),
    sourceRevisionId: randomUUID(),
    snapshot: {
      schemaVersion: 1,
      title: 'Synthetic transfer page',
      slug: 'synthetic-transfer-page',
      aliases: [],
      type: 'concept',
      summary: 'Synthetic summary.',
      categories: [],
      accessLevel: 'public',
      audience: 'reader',
      body: {
        format: 'richtext-v1',
        infobox: [],
        sections: [{
          id: sectionId,
          heading: 'Synthetic section',
          html: '<p>Synthetic body.</p>',
          blocks: [],
          authority: [],
          knowledgeLayer: 'unspecified',
        }],
      },
    },
    citations: [{ sectionId, sourceId, locator: 'section 1' }],
  }];
  const content = 'Synthetic cited source bytes.\n';
  const sources = [{
    sourceId,
    archiveSha256: 'a'.repeat(64),
    relativePath: 'synthetic/source.txt',
    fileSha256: createHash('sha256').update(content, 'utf8').digest('hex'),
    family: 'Synthetic family',
    language: 'en',
    declaredVersion: null,
    declaredDate: null,
    content,
  }];
  const bundle = {
    format: 'AetherverseWikiBundleV1',
    manifest: {
      version: 1,
      createdAt: '2026-10-21T12:00:00.000Z',
      pageCount: pages.length,
      sourceCount: sources.length,
      bundleSha256: '',
    },
    origin: { instanceId: randomUUID(), siteName: 'aetherverse vault' },
    pages,
    sources,
  };
  bundle.manifest.bundleSha256 = digest({
    format: bundle.format,
    manifest: {
      version: bundle.manifest.version,
      createdAt: bundle.manifest.createdAt,
      pageCount: bundle.manifest.pageCount,
      sourceCount: bundle.manifest.sourceCount,
    },
    origin: bundle.origin,
    pages: bundle.pages,
    sources: bundle.sources,
  });
  return bundle;
}

test('WIKI-TRANSFER rejects blank locators with a valid digest while retaining nonblank transfer text', () => {
  for (const locator of [' ', '\t\n', ' section 1 ']) {
    const bundle = makeBundle();
    bundle.pages[0].citations[0].locator = locator;
    bundle.manifest.bundleSha256 = digest({
      format: bundle.format,
      manifest: {
        version: bundle.manifest.version,
        createdAt: bundle.manifest.createdAt,
        pageCount: bundle.manifest.pageCount,
        sourceCount: bundle.manifest.sourceCount,
      },
      origin: bundle.origin,
      pages: bundle.pages,
      sources: bundle.sources,
    });
    if (locator.trim()) {
      assert.equal(validateBundle(bundle).bundle.pages[0].citations[0].locator, locator);
    } else {
      assert.throws(() => validateBundle(bundle), (error) => error.publicCode === 'INVALID_WIKI_BUNDLE');
    }
  }
});

test('WIKI-TRANSFER bundle validation checks its content hash and source-file hash', () => {
  const bundle = makeBundle();
  const validated = validateBundle(bundle);
  assert.equal(validated.bundle.format, 'AetherverseWikiBundleV1');
  assert.equal(validated.bundleSha256, bundle.manifest.bundleSha256);

  const changedSource = structuredClone(bundle);
  changedSource.sources[0].content += 'tampered';
  assert.throws(() => validateBundle(changedSource), (error) => error.publicCode === 'INVALID_WIKI_BUNDLE');

  const changedBundle = structuredClone(bundle);
  changedBundle.pages[0].snapshot.summary = 'Modified without updating the bundle digest.';
  assert.throws(() => validateBundle(changedBundle), (error) => error.publicCode === 'INVALID_WIKI_BUNDLE');
});

test('WIKI-TRANSFER bundle validation rejects unreferenced sources and actor or role fields', () => {
  const unreferenced = makeBundle();
  unreferenced.sources.push({
    ...unreferenced.sources[0],
    sourceId: randomUUID(),
    relativePath: 'synthetic/unreferenced.txt',
  });
  unreferenced.manifest.sourceCount = unreferenced.sources.length;
  unreferenced.manifest.bundleSha256 = digest({
    format: unreferenced.format,
    manifest: {
      version: unreferenced.manifest.version,
      createdAt: unreferenced.manifest.createdAt,
      pageCount: unreferenced.manifest.pageCount,
      sourceCount: unreferenced.manifest.sourceCount,
    },
    origin: unreferenced.origin,
    pages: unreferenced.pages,
    sources: unreferenced.sources,
  });
  assert.throws(() => validateBundle(unreferenced), (error) => error.publicCode === 'INVALID_WIKI_BUNDLE');

  const actorFields = makeBundle();
  actorFields.pages[0].actorId = randomUUID();
  actorFields.manifest.bundleSha256 = digest({
    format: actorFields.format,
    manifest: {
      version: actorFields.manifest.version,
      createdAt: actorFields.manifest.createdAt,
      pageCount: actorFields.manifest.pageCount,
      sourceCount: actorFields.manifest.sourceCount,
    },
    origin: actorFields.origin,
    pages: actorFields.pages,
    sources: actorFields.sources,
  });
  assert.throws(() => validateBundle(actorFields), (error) => error.publicCode === 'INVALID_WIKI_BUNDLE');
});
