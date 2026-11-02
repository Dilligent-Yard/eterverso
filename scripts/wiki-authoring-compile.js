'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { readPrivateStagedSources } = require('./wiki-source-import');
const { validateArchivePath } = require('./wiki-source-stage');
const { extractInternalLinks, sanitizeHtmlWithReport } = require('../server/content');
const { normalizeSlug, validateWikiSnapshot } = require('../server/wiki');
const { FORMAT, canonicalJson, digestJson, validateBundle } = require('../server/wiki-transfers');

const AUTHORING_FORMAT = 'AetherverseWikiAuthoringV1';
const MAX_INPUT_BYTES = 4 * 1024 * 1024;
const MAX_BUNDLE_BYTES = 4 * 1024 * 1024;
const MAX_PAGES = 100;
const MAX_SOURCES = 500;
const MAX_CITATIONS = 10_000;
const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_SOURCE_BYTES = 100 * 1024 * 1024;
const HASH_RE = /^[a-f0-9]{64}$/u;
const KEY_RE = /^[a-z][a-z0-9-]{0,79}$/u;
const CANONICAL_CREATED_AT = '1970-01-01T00:00:00.000Z';

function safeError(message) {
  const error = new Error(message);
  error.safeToPrint = true;
  return error;
}

function assertNoDuplicateJsonKeys(text) {
  let index = 0;
  const invalid = () => { throw safeError('The authoring file is not valid JSON.'); };
  const whitespace = () => {
    while (index < text.length && /[\u0009\u000a\u000d\u0020]/u.test(text[index])) index += 1;
  };
  const parseString = () => {
    const start = index;
    index += 1;
    while (index < text.length) {
      const character = text[index];
      if (character === '"') {
        index += 1;
        try { return JSON.parse(text.slice(start, index)); } catch (_error) { return invalid(); }
      }
      if (character === '\\') {
        index += 2;
      } else {
        index += 1;
      }
    }
    return invalid();
  };
  const parseValue = (depth) => {
    whitespace();
    if (depth > 100) return invalid();
    const character = text[index];
    if (character === '"') {
      parseString();
      return;
    }
    if (character === '{') {
      index += 1;
      whitespace();
      if (text[index] === '}') { index += 1; return; }
      const keys = new Set();
      while (index < text.length) {
        whitespace();
        if (text[index] !== '"') return invalid();
        const key = parseString();
        if (keys.has(key)) throw safeError('The authoring JSON contains duplicate object fields.');
        keys.add(key);
        whitespace();
        if (text[index] !== ':') return invalid();
        index += 1;
        parseValue(depth + 1);
        whitespace();
        if (text[index] === '}') { index += 1; return; }
        if (text[index] !== ',') return invalid();
        index += 1;
      }
      return invalid();
    }
    if (character === '[') {
      index += 1;
      whitespace();
      if (text[index] === ']') { index += 1; return; }
      while (index < text.length) {
        parseValue(depth + 1);
        whitespace();
        if (text[index] === ']') { index += 1; return; }
        if (text[index] !== ',') return invalid();
        index += 1;
      }
      return invalid();
    }
    const rest = text.slice(index);
    const literal = /^(?:true|false|null)/u.exec(rest);
    if (literal) { index += literal[0].length; return; }
    const number = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u.exec(rest);
    if (number) { index += number[0].length; return; }
    return invalid();
  };

  parseValue(0);
  whitespace();
  if (index !== text.length) invalid();
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertObject(value, label) {
  if (!isObject(value)) throw safeError(`${label} must be an object.`);
}

function assertExactKeys(value, keys, label) {
  assertObject(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw safeError(`${label} has missing or unsupported fields.`);
  }
}

function assertKey(value, label) {
  if (typeof value !== 'string' || !KEY_RE.test(value)) {
    throw safeError(`${label} is not a stable ASCII key.`);
  }
  return value;
}

function assertText(value, label, maximum, { allowEmpty = false } = {}) {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)
      || Array.from(value).length > maximum
      || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
    throw safeError(`${label} is invalid.`);
  }
  return value;
}

function normalizeLocator(value) {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw safeError('Citation locator is invalid.');
  }
  const locator = value.trim();
  if (!locator || Array.from(locator).length > 500) {
    throw safeError('Citation locator must be nonblank and no longer than 500 characters.');
  }
  return locator;
}

function compareOrdinal(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalUuid(domain, value) {
  const digest = crypto.createHash('sha256')
    .update('eterverso-wiki-authoring-v1\0', 'utf8')
    .update(domain, 'utf8')
    .update('\0', 'utf8')
    .update(canonicalJson(value), 'utf8')
    .digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  // UUID version 8 identifies a domain-separated custom SHA-256 name UUID.
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function markdownLike(value) {
  return /(?:^|\n)\s{0,3}(?:#{1,6}\s+\S|>\s+\S|```|(?:[-+*]|\d+[.)])\s+\S)|!?\[[^\]]+\]\([^)]+\)|(?<![\w\\])(?:\*\*|__)(?=\S)[\s\S]*?\S(?:\*\*|__)(?![\w])|(?<![\w\\])(?<marker>\*|_)(?=\S)[^*_\n]*?\S\k<marker>(?![\w])|(?<!`)`[^`\n]+`(?!`)/u.test(value);
}

function validateSourcePath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1000) {
    throw safeError('A source path is invalid.');
  }
  try {
    return validateArchivePath(value);
  } catch (_error) {
    throw safeError('A source path is invalid.');
  }
}

function validateAuthoring(value) {
  assertExactKeys(value, ['format', 'workspace', 'sources', 'pages'], 'Authoring document');
  if (value.format !== AUTHORING_FORMAT) throw safeError('The authoring format is unsupported.');
  const workspace = assertKey(value.workspace, 'Workspace');
  if (!Array.isArray(value.sources) || value.sources.length > MAX_SOURCES) {
    throw safeError('The source reference list is invalid or exceeds its limit.');
  }
  if (!Array.isArray(value.pages) || value.pages.length < 1 || value.pages.length > MAX_PAGES) {
    throw safeError('The page list is invalid or exceeds its limit.');
  }

  const sourceKeys = new Set();
  const sources = value.sources.map((source) => {
    assertExactKeys(source, ['key', 'set', 'path'], 'Source reference');
    const key = assertKey(source.key, 'Source key');
    const set = assertKey(source.set, 'Source-set key');
    const relativePath = validateSourcePath(source.path);
    if (sourceKeys.has(key)) throw safeError('Source keys must be unique within the batch.');
    sourceKeys.add(key);
    return { key, set, path: relativePath };
  });

  const pageKeys = new Set();
  let citationCount = 0;
  const pages = value.pages.map((page) => {
    assertExactKeys(page, [
      'key', 'title', 'slug', 'aliases', 'type', 'summary', 'categories', 'audience', 'infobox', 'sections',
    ], 'Page');
    const key = assertKey(page.key, 'Page key');
    if (pageKeys.has(key)) throw safeError('Page keys must be unique across the workspace.');
    pageKeys.add(key);
    if (!Array.isArray(page.sections) || page.sections.length < 1) {
      throw safeError('Each page must contain at least one section.');
    }
    const sectionKeys = new Set();
    const sections = page.sections.map((section) => {
      assertExactKeys(section, [
        'key', 'heading', 'html', 'authority', 'knowledgeLayer', 'citations',
      ], 'Section');
      const sectionKey = assertKey(section.key, 'Section key');
      if (sectionKeys.has(sectionKey)) throw safeError('Section keys must be unique within a page.');
      sectionKeys.add(sectionKey);
      assertText(section.html, 'Section HTML', 500_000, { allowEmpty: true });
      if (!Array.isArray(section.citations) || section.citations.length < 1) {
        throw safeError('Each section must contain at least one citation.');
      }
      citationCount += section.citations.length;
      if (citationCount > MAX_CITATIONS) throw safeError('The batch exceeds its citation limit.');
      const citations = section.citations.map((citation) => {
        assertExactKeys(citation, ['source', 'locator'], 'Citation');
        return {
          source: assertKey(citation.source, 'Citation source key'),
          locator: normalizeLocator(citation.locator),
        };
      });
      return { ...section, key: sectionKey, citations };
    });
    return { ...page, key, sections };
  });

  if (citationCount < 1) throw safeError('The batch must contain citations.');
  const rawBytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
  if (rawBytes > MAX_INPUT_BYTES) throw safeError('The authoring document exceeds the 4 MiB size limit.');
  return { workspace, sources, pages, citationCount };
}

function sourceSetMap(sourceSets) {
  if (!(sourceSets instanceof Map)) throw new TypeError('sourceSets must be a Map of verified source manifests.');
  for (const [label, staged] of sourceSets) {
    assertKey(label, 'Bound source-set label');
    if (!staged || !Array.isArray(staged.files)) throw safeError('A verified source set is unavailable.');
  }
  return sourceSets;
}

function resolveSourceDeclarations(declarations, sourceSets) {
  const usedSets = new Set(declarations.map((source) => source.set));
  for (const label of sourceSets.keys()) {
    if (!usedSets.has(label)) throw safeError('A bound source set is not used by this batch.');
  }

  const sourceIds = new Set();
  const sourceIdentityKeys = new Set();
  const byKey = new Map();
  const sources = [];
  for (const declaration of declarations) {
    const staged = sourceSets.get(declaration.set);
    if (!staged) throw safeError('A declared source set has no verified local manifest.');
    const matches = staged.files.filter((file) => file.relativePath === declaration.path);
    if (matches.length !== 1 || matches[0].role !== 'source') {
      throw safeError('A declared source path is missing or is context rather than lore.');
    }
    const source = matches[0];
    const identity = {
      archiveSha256: source.archiveSha256,
      relativePath: source.relativePath,
      fileSha256: source.fileSha256,
    };
    const identityKey = canonicalJson(identity);
    if (sourceIdentityKeys.has(identityKey)) {
      throw safeError('Source references must not duplicate the same staged document.');
    }
    sourceIdentityKeys.add(identityKey);
    const sourceId = canonicalUuid('source-reference', identity);
    if (sourceIds.has(sourceId)) throw safeError('Source identities collide within the batch.');
    sourceIds.add(sourceId);
    const clean = {
      sourceId,
      archiveSha256: source.archiveSha256,
      relativePath: source.relativePath,
      fileSha256: source.fileSha256,
      family: source.family,
      language: source.language,
      declaredVersion: source.declaredVersion,
      declaredDate: source.declaredDate,
      content: source.content,
    };
    byKey.set(declaration.key, clean);
    sources.push(clean);
  }
  return { byKey, sources: sources.sort((left, right) => compareOrdinal(left.sourceId, right.sourceId)) };
}

function cleanSectionHtml(html) {
  if (markdownLike(html)) throw safeError('A section must use HTML markup rather than Markdown syntax.');
  let result;
  try {
    result = sanitizeHtmlWithReport(html, { maxBytes: 500_000 });
  } catch (_error) {
    throw safeError('A section contains invalid or oversized HTML.');
  }
  if (result.formattingLoss.discarded) {
    throw safeError('A section contains unsupported HTML or attributes that would be discarded.');
  }
  return result.html;
}

function cleanPage(page, workspace, sourceByKey) {
  const slug = assertText(page.slug, 'Page slug', 100);
  if (normalizeSlug(slug) !== slug) throw safeError('Page slugs must already be normalized.');
  if (!Array.isArray(page.aliases)) throw safeError('Page aliases must be an array.');
  for (const alias of page.aliases) {
    assertText(alias, 'Page alias', 100);
    if (normalizeSlug(alias) !== alias) throw safeError('Page aliases must already be normalized.');
  }

  const sections = page.sections.map((section) => {
    const id = canonicalUuid('section', { workspace, pageKey: page.key, sectionKey: section.key });
    const html = cleanSectionHtml(section.html);
    const sectionCitations = [];
    const seen = new Set();
    for (const citation of section.citations) {
      const source = sourceByKey.get(citation.source);
      if (!source) throw safeError('A citation references an unknown source key.');
      const duplicateKey = `${source.sourceId}\0${citation.locator}`;
      if (seen.has(duplicateKey)) throw safeError('Duplicate citations within a section are not allowed.');
      seen.add(duplicateKey);
      sectionCitations.push({ sectionId: id, sourceId: source.sourceId, locator: citation.locator });
    }
    return {
      id,
      heading: pageSectionHeading(section.heading),
      html,
      blocks: [],
      authority: section.authority,
      knowledgeLayer: section.knowledgeLayer,
      citations: sectionCitations,
    };
  });

  const snapshotInput = {
    schemaVersion: 1,
    title: page.title,
    slug,
    aliases: page.aliases,
    type: page.type,
    summary: page.summary,
    categories: page.categories,
    accessLevel: 'staff',
    audience: page.audience,
    body: {
      format: 'richtext-v1',
      infobox: page.infobox,
      sections: sections.map(({ citations: _citations, ...section }) => section),
    },
  };
  let snapshot;
  try {
    snapshot = validateWikiSnapshot(snapshotInput);
  } catch (_error) {
    throw safeError('A page does not satisfy the wiki snapshot schema or field limits.');
  }
  const sectionIds = new Set(snapshot.body.sections.map((section) => section.id));
  const citations = sections.flatMap((section) => section.citations).sort(compareCitations);
  if (citations.some((citation) => !sectionIds.has(citation.sectionId))) {
    throw safeError('A citation references an unknown section identity.');
  }
  if (snapshot.body.sections.some((section) => extractInternalLinks(section.html)
    .some((href) => href.startsWith('/wiki/') && href.includes('#')))) {
    throw safeError('Article links must not use section fragments.');
  }

  const sourcePageId = canonicalUuid('article', { workspace, pageKey: page.key });
  const sourceRevisionId = canonicalUuid('revision', {
    workspace,
    pageKey: page.key,
    snapshot,
    citations,
  });
  return { sourcePageId, sourceRevisionId, snapshot, citations };
}

function pageSectionHeading(value) {
  return assertText(value, 'Section heading', 200);
}

function compareCitations(left, right) {
  return compareOrdinal(left.sectionId, right.sectionId)
    || compareOrdinal(left.sourceId, right.sourceId)
    || compareOrdinal(left.locator, right.locator);
}

function bundleHashPayload(bundle) {
  return {
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
  };
}

function compileAuthoringContent(authoring, sourceSets) {
  const validated = validateAuthoring(authoring);
  const boundSets = sourceSetMap(sourceSets);
  const { byKey: sourceByKey, sources } = resolveSourceDeclarations(validated.sources, boundSets);
  let totalSourceBytes = 0;
  for (const source of sources) {
    if (!HASH_RE.test(source.archiveSha256) || !HASH_RE.test(source.fileSha256)
        || typeof source.relativePath !== 'string' || !source.relativePath
        || typeof source.family !== 'string' || Array.from(source.family).length > 80
        || typeof source.language !== 'string' || Array.from(source.language).length > 20
        || (source.declaredVersion !== null && (typeof source.declaredVersion !== 'string'
          || Array.from(source.declaredVersion).length > 120))
        || (source.declaredDate !== null && (typeof source.declaredDate !== 'string'
          || Array.from(source.declaredDate).length > 40))
        || typeof source.content !== 'string') {
      throw safeError('A declared source has invalid stored metadata.');
    }
    const sourceBytes = Buffer.from(source.content, 'utf8');
    if (sourceBytes.length > MAX_SOURCE_BYTES
        || crypto.createHash('sha256').update(sourceBytes).digest('hex') !== source.fileSha256) {
      throw safeError('A declared source exceeds its limit or its content hash does not match.');
    }
    totalSourceBytes += sourceBytes.length;
    if (!Number.isSafeInteger(totalSourceBytes) || totalSourceBytes > MAX_TOTAL_SOURCE_BYTES) {
      throw safeError('The cited sources exceed the 100 MiB validation limit.');
    }
  }
  const pages = validated.pages.map((page) => cleanPage(page, validated.workspace, sourceByKey))
    .sort((left, right) => compareOrdinal(left.sourcePageId, right.sourcePageId));
  if (new Set(pages.map((page) => page.sourcePageId)).size !== pages.length
      || new Set(pages.map((page) => page.sourceRevisionId)).size !== pages.length) {
    throw safeError('Page identities collide within the batch.');
  }

  const names = new Set();
  for (const page of pages) {
    for (const name of [page.snapshot.slug, ...page.snapshot.aliases]) {
      const normalized = normalizeSlug(name);
      if (names.has(normalized)) throw safeError('Page slugs and aliases must be unique across the batch.');
      names.add(normalized);
    }
  }

  const citedSourceIds = new Set(pages.flatMap((page) => page.citations.map((citation) => citation.sourceId)));
  if (citedSourceIds.size !== sources.length || sources.some((source) => !citedSourceIds.has(source.sourceId))) {
    throw safeError('Every declared source must be cited by at least one section.');
  }
  const totalCitations = pages.reduce((total, page) => total + page.citations.length, 0);
  if (totalCitations > MAX_CITATIONS) throw safeError('The batch exceeds its citation limit.');

  const workspaceId = canonicalUuid('workspace', validated.workspace);
  const identityOwners = new Map();
  const identities = [
    ['workspace', workspaceId],
    ...sources.map((source) => ['source', source.sourceId]),
    ...pages.flatMap((page) => [
      ['article', page.sourcePageId],
      ['revision', page.sourceRevisionId],
      ...page.snapshot.body.sections.map((section) => ['section', section.id]),
    ]),
  ];
  for (const [kind, id] of identities) {
    if (identityOwners.has(id)) throw safeError('Generated UUID identities collide within the batch.');
    identityOwners.set(id, kind);
  }

  return {
    pages,
    sources,
    workspaceId,
    counts: { pages: pages.length, sources: sources.length, citations: totalCitations },
  };
}

function compileAuthoring(authoring, sourceSets) {
  const content = compileAuthoringContent(authoring, sourceSets);
  const bundle = {
    format: FORMAT,
    manifest: {
      version: 1,
      createdAt: CANONICAL_CREATED_AT,
      pageCount: content.pages.length,
      sourceCount: content.sources.length,
      bundleSha256: '',
    },
    origin: {
      instanceId: content.workspaceId,
      siteName: 'aetherverse vault',
    },
    pages: content.pages,
    sources: content.sources,
  };
  bundle.manifest.bundleSha256 = digestJson(bundleHashPayload(bundle));

  let cleanBundle;
  try {
    cleanBundle = validateBundle(bundle).bundle;
  } catch (_error) {
    throw safeError('The compiled transfer bundle failed its complete validation.');
  }
  const outputBytes = Buffer.from(`${JSON.stringify(cleanBundle, null, 2)}\n`, 'utf8');
  if (outputBytes.length > MAX_BUNDLE_BYTES) throw safeError('The transfer bundle exceeds the 4 MiB size limit.');
  return {
    bundle: cleanBundle,
    outputBytes,
    counts: content.counts,
  };
}

function assertNoSymlinkAncestors(absolutePath, fsImpl, allowMissing) {
  const parsed = path.parse(absolutePath);
  const segments = absolutePath.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let current = parsed.root;
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    let stat;
    try {
      stat = fsImpl.lstatSync(current);
    } catch (error) {
      if (allowMissing && error && error.code === 'ENOENT') return;
      throw error;
    }
    if (stat.isSymbolicLink()) throw safeError('Input and output paths must not traverse symbolic links.');
    if (index < segments.length - 1 && !stat.isDirectory()) {
      throw safeError('An input or output parent path is not a directory.');
    }
  }
}

function readInputFile(filePath, fsImpl = fs, maxBytes = MAX_INPUT_BYTES) {
  if (typeof filePath !== 'string' || !filePath) throw safeError('An input JSON path is required.');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 100 * 1024 * 1024) {
    throw safeError('The input JSON size limit is invalid.');
  }
  const absolutePath = path.resolve(filePath);
  assertNoSymlinkAncestors(absolutePath, fsImpl, false);
  let priorStat;
  try { priorStat = fsImpl.lstatSync(absolutePath); } catch (_error) {
    throw safeError('The authoring JSON file could not be read.');
  }
  if (!priorStat.isFile() || priorStat.size > maxBytes) {
    throw safeError('The authoring JSON file is invalid or exceeds the 4 MiB size limit.');
  }
  const constants = fsImpl.constants || fs.constants;
  if (!Number.isInteger(constants.O_NOFOLLOW)) throw safeError('This runtime cannot safely read the authoring JSON file.');
  let descriptor;
  try { descriptor = fsImpl.openSync(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW); } catch (_error) {
    throw safeError('The authoring JSON file could not be opened safely.');
  }
  let bytes;
  try {
    const openedStat = fsImpl.fstatSync(descriptor);
    if (!openedStat.isFile() || openedStat.size !== priorStat.size || openedStat.size > maxBytes
        || (priorStat.dev !== undefined && openedStat.dev !== priorStat.dev)
        || (priorStat.ino !== undefined && openedStat.ino !== priorStat.ino)) {
      throw safeError('The authoring JSON file changed while it was being read.');
    }
    bytes = fsImpl.readFileSync(descriptor);
    if (bytes.length !== openedStat.size) throw safeError('The authoring JSON file changed while it was being read.');
  } catch (error) {
    if (error && error.safeToPrint) throw error;
    throw safeError('The authoring JSON file could not be read safely.');
  } finally {
    try { fsImpl.closeSync(descriptor); } catch (_error) { /* Keep the original result. */ }
  }
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch (_error) {
    throw safeError('The authoring JSON file is not valid UTF-8.');
  }
  try {
    assertNoDuplicateJsonKeys(text);
    return JSON.parse(text);
  } catch (error) {
    if (error && error.safeToPrint) throw error;
    throw safeError('The authoring file is not valid JSON.');
  }
}

function writePrivateOutput(outputPath, bytes, fsImpl = fs) {
  if (typeof outputPath !== 'string' || !outputPath) throw safeError('An output bundle path is required.');
  const absolutePath = path.resolve(outputPath);
  if (absolutePath === path.parse(absolutePath).root) throw safeError('The output bundle path is invalid.');
  const parent = path.dirname(absolutePath);
  assertNoSymlinkAncestors(parent, fsImpl, true);
  try { fsImpl.mkdirSync(parent, { recursive: true, mode: 0o700 }); } catch (_error) {
    throw safeError('The private output directory could not be created.');
  }
  assertNoSymlinkAncestors(parent, fsImpl, false);
  try {
    if (fsImpl.lstatSync(parent).isDirectory() !== true) throw safeError('The output parent is not a directory.');
  } catch (error) {
    if (error && error.safeToPrint) throw error;
    throw safeError('The private output directory is unavailable.');
  }
  try {
    fsImpl.lstatSync(absolutePath);
    throw safeError('The output bundle already exists; refusing to overwrite it.');
  } catch (error) {
    if (error && error.safeToPrint) throw error;
    if (!error || error.code !== 'ENOENT') throw safeError('The output bundle path is unavailable.');
  }

  const temporaryPath = path.join(parent, `.${path.basename(absolutePath)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`);
  let descriptor;
  let linked = false;
  try {
    descriptor = fsImpl.openSync(temporaryPath, 'wx', 0o600);
    fsImpl.fchmodSync(descriptor, 0o600);
    fsImpl.writeFileSync(descriptor, bytes);
    fsImpl.fsyncSync(descriptor);
    fsImpl.closeSync(descriptor);
    descriptor = undefined;
    fsImpl.linkSync(temporaryPath, absolutePath);
    linked = true;
  } catch (error) {
    if (error && error.code === 'EEXIST') throw safeError('The output bundle already exists; refusing to overwrite it.');
    if (error && error.safeToPrint) throw error;
    throw safeError('The private output bundle could not be written.');
  } finally {
    if (descriptor !== undefined) {
      try { fsImpl.closeSync(descriptor); } catch (_error) { /* Preserve the write result. */ }
    }
    try { fsImpl.unlinkSync(temporaryPath); } catch (_error) { /* A linked output remains complete and private. */ }
  }
  if (!linked) throw safeError('The private output bundle could not be finalized.');
  return absolutePath;
}

function parseArgs(args) {
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) return { help: true };
  const values = { sourceSets: new Map() };
  for (let index = 0; index < args.length;) {
    const flag = args[index];
    const value = args[index + 1];
    if (!['--input', '--output', '--source-set'].includes(flag) || !value || value.startsWith('--')) {
      throw safeError('Usage: npm run wiki:authoring:compile -- --input INPUT.json --source-set LABEL=MANIFEST.json [--source-set LABEL=MANIFEST.json] --output OUTPUT.bundle.json');
    }
    if (flag === '--source-set') {
      const separator = value.indexOf('=');
      if (separator <= 0 || separator === value.length - 1) {
        throw safeError('Each --source-set value must be LABEL=MANIFEST.json.');
      }
      const label = assertKey(value.slice(0, separator), 'Source-set label');
      const manifestPath = value.slice(separator + 1);
      if (values.sourceSets.has(label)) throw safeError('Each source-set label may be bound only once.');
      values.sourceSets.set(label, manifestPath);
    } else {
      const key = flag === '--input' ? 'inputPath' : 'outputPath';
      if (values[key]) throw safeError('The input and output flags may be supplied only once.');
      values[key] = value;
    }
    index += 2;
  }
  if (!values.inputPath || !values.outputPath || values.sourceSets.size < 1) {
    throw safeError('Usage: npm run wiki:authoring:compile -- --input INPUT.json --source-set LABEL=MANIFEST.json [--source-set LABEL=MANIFEST.json] --output OUTPUT.bundle.json');
  }
  return { ...values, help: false };
}

function helpText() {
  return 'Usage: npm run wiki:authoring:compile -- --input INPUT.json --source-set LABEL=MANIFEST.json [--source-set LABEL=MANIFEST.json] --output OUTPUT.bundle.json\n';
}

function main(args = process.argv.slice(2), dependencies = {}) {
  const fsImpl = dependencies.fsImpl || fs;
  const options = parseArgs(args);
  const stdout = dependencies.stdout || process.stdout;
  if (options.help) {
    stdout.write(helpText());
    return null;
  }
  if (Number(process.versions.node.split('.')[0]) !== 24) {
    throw safeError('Wiki authoring compilation requires Node.js 24.');
  }
  const authoring = readInputFile(options.inputPath, fsImpl);
  const validated = validateAuthoring(authoring);
  const sourceSets = new Map();
  for (const [label, manifestPath] of options.sourceSets) {
    if (!validated.sources.some((source) => source.set === label)) {
      throw safeError('A bound source set is not used by this batch.');
    }
    try {
      sourceSets.set(label, readPrivateStagedSources({ manifestPath, fsImpl }));
    } catch (error) {
      if (error && error.safeToPrint) throw error;
      throw safeError('A private staged source set could not be read safely.');
    }
  }
  const compiled = compileAuthoring(authoring, sourceSets);
  writePrivateOutput(options.outputPath, compiled.outputBytes, fsImpl);
  stdout.write(`Compiled ${compiled.counts.pages} page(s), ${compiled.counts.sources} source(s), ${compiled.counts.citations} citation(s).\n`);
  return compiled.counts;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error && error.safeToPrint
      ? error.message
      : 'Wiki authoring compilation failed; article text, source text, filesystem details and credentials are withheld.'}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  AUTHORING_FORMAT,
  MAX_BUNDLE_BYTES,
  MAX_INPUT_BYTES,
  assertNoDuplicateJsonKeys,
  canonicalUuid,
  compareOrdinal,
  compileAuthoring,
  compileAuthoringContent,
  main,
  normalizeLocator,
  parseArgs,
  readInputFile,
  validateAuthoring,
  writePrivateOutput,
};
