'use strict';

const express = require('express');
const {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} = require('node:crypto');
const { ApiError } = require('./errors');
const {
  assertObjectShape,
  validateUuid,
} = require('./validation');
const { MAX_SOURCE_BYTES } = require('./sources');
const {
  FORMAT: BUNDLE_FORMAT,
  createWikiArticleBundle,
  validateBundle,
} = require('./wiki-transfers');
const {
  assertCitationSourcesExist,
  findReplay,
  insertRequestKey,
  insertRevision,
  insertRevisionCitations,
  loadReplayPage,
  loadStaffPageDto,
  lockPage,
  normalizeSlug,
  saveRevisionIndexes,
  validateWikiSnapshot,
  withStaffTransaction,
} = require('./wiki');

const STAFF_ROLES = ['moderador', 'admin'];
const ARTICLE_FILE_MAX_BYTES = 4 * 1024 * 1024;
const PREVIEW_TOKEN_MAX_BYTES = 9 * 1024 * 1024;
const PREVIEW_TOKEN_TTL_MS = 30 * 60 * 1000;
const MAX_TOTAL_ARTICLE_SOURCE_BYTES = 100 * 1024 * 1024;
const AUTHORING_FORMAT = 'AetherverseWikiAuthoringV1';
const AUTHORING_KEY = /^[a-z][a-z0-9-]{0,79}$/u;
const HASH_RE = /^[a-f0-9]{64}$/u;
const SECTION_KEY_UUID_RE = /^section-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/iu;
const OPERATION = 'wiki.article_file.import';
const MAX_INT = 2_147_483_647;
const EXPORT_NOTE = 'Este pacote contém o texto integral das fontes privadas citadas. Use-o como cópia de preservação; para edição com IA, prefira o formato de autoria AetherverseWikiAuthoringV1.';

const AUTHORING_BRIEF = `Guia de autoria de artigos da aetherverse vault

Produza um único documento JSON AetherverseWikiAuthoringV1 com a forma do exemplo. Preserve exatamente os nomes dos campos e não inclua comentários, blocos Markdown ou texto fora do JSON. Este arquivo descreve um artigo; ele não publica o artigo.

O objeto raiz tem format, workspace, sources e pages. Use format "AetherverseWikiAuthoringV1", uma chave estável workspace em ASCII minúsculo, uma lista sources e uma lista pages com exatamente um artigo. As chaves key, workspace, source e set devem usar letras ASCII minúsculas, números e hífens. O campo path deve copiar exatamente o caminho do catálogo, incluindo maiúsculas, acentos, espaços e a grafia literal de caracteres como %20; não decodifique nem normalize o caminho.

Cada page contém key, title, slug, aliases, type, summary, categories, audience, infobox e sections. Use slug e aliases normalizados em ASCII, sem acentos e com hífens. type aceita concept, organization, place, entity, technique, artifact, event ou character-reference. audience aceita unspecified, reader, player ou author. authority aceita uma lista com C, S, E e O; knowledgeLayer aceita unspecified, mundane, paranormal, authorial ou mixed. Não crie campos extras.

Cada seção contém key, heading, html, authority, knowledgeLayer e citations. Escreva html com marcação HTML simples e segura, sem Markdown. Toda seção precisa de pelo menos uma citação. Cada citação aponta para uma source key e contém um locator legível, como capítulo, seção ou parágrafo. Não invente fontes nem localizadores.

Cada item sources aponta para um set e um path listados no catálogo sourceSets fornecido com este guia. Use apenas fontes que aparecem nesse catálogo e copie o caminho exato, incluindo maiúsculas, UTF-8, espaços, diretórios e extensão. Se uma fonte necessária estiver ausente, peça à equipe para cadastrá-la. Nunca invente UUID, SHA-256, cânone ou fonte. Todo item sources deve ser citado. Não inclua o conteúdo integral da fonte no arquivo de autoria.

Em uma criação nova, use chaves curtas e legíveis, como page-ilha-demo e secao-visao-geral. Ao editar um artigo exportado, mantenha as chaves page-UUID e section-UUID quando continuar usando a mesma página ou seção. Use novas chaves de seção para conteúdo realmente novo. O servidor preserva IDs de seção existentes somente quando a chave aponta para uma seção que já existe no artigo selecionado ou quando a equipe confirma o vínculo na prévia.

authority indica o tipo de autoridade e aceita C, S, E e O; audience descreve o público e aceita unspecified, reader, player ou author. accessLevel é diferente de audience: o servidor salva a revisão importada como privada para a equipe, sem usar o arquivo para publicá-la. Preserve a atribuição das fontes e não converta autoridade, público ou camada de conhecimento por inferência. O exemplo deste guia é sintético e não representa uma fonte nem conteúdo canônico.`;

const AUTHORING_EXAMPLE = Object.freeze({
  format: AUTHORING_FORMAT,
  workspace: 'exemplo-artigo-equipe',
  sources: [{
    key: 'source-referencia-sintetica',
    set: `archive-${'a'.repeat(64)}`,
    path: 'exemplo/referencia-sintetica.txt',
  }],
  pages: [{
    key: 'page-ilha-demo',
    title: 'Ilha de Demonstração',
    slug: 'ilha-de-demonstracao',
    aliases: ['ilha-exemplo'],
    type: 'place',
    summary: 'Exemplo sintético para explicar o formato de autoria.',
    categories: ['Exemplo'],
    audience: 'reader',
    infobox: [{ label: 'Estado', value: 'Exemplo' }],
    sections: [{
      key: 'secao-visao-geral',
      heading: 'Visão geral',
      html: '<p>Texto de demonstração sem conteúdo de desenvolvimento.</p>',
      authority: [],
      knowledgeLayer: 'unspecified',
      citations: [{ source: 'source-referencia-sintetica', locator: 'seção sintética 1' }],
    }],
  }],
});

function route(handler) {
  return (req, res, next) => Promise.resolve().then(() => handler(req, res)).catch(next);
}

function apiError(status, code, message) {
  return new ApiError(status, code, message);
}

async function setRepeatableRead(tx) {
  await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`;
}

function invalidFile() {
  return apiError(400, 'INVALID_WIKI_ARTICLE_FILE', 'O arquivo do artigo é inválido ou não pode ser compilado.');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function authoringCompiler() {
  // The CLI module loads filesystem and database configuration helpers. Keep
  // it out of application startup and load it only after staff authorization.
  return require('../scripts/wiki-authoring-compile');
}

function sourceMetadataDto(row) {
  try {
    if (typeof row.family !== 'string' || Array.from(row.family).length > 80
        || typeof row.language !== 'string' || Array.from(row.language).length > 20
        || (row.declared_version !== null && typeof row.declared_version !== 'string')
        || (row.declared_date !== null && typeof row.declared_date !== 'string')) {
      throw new Error('source');
    }
    const identity = {
      sourceId: validateUuid(row.id, 'sourceId'),
      archiveSha256: row.archive_sha256,
      relativePath: row.relative_path,
      fileSha256: row.file_sha256,
      family: row.family,
      language: row.language,
      declaredVersion: row.declared_version,
      declaredDate: row.declared_date,
    };
    const contentBytes = row.content_bytes === undefined ? null : Number(row.content_bytes);
    if (!HASH_RE.test(identity.archiveSha256) || !HASH_RE.test(identity.fileSha256)
        || typeof identity.relativePath !== 'string' || !identity.relativePath
        || Array.from(identity.family).length > 80 || Array.from(identity.language).length > 20
        || (identity.declaredVersion !== null && Array.from(identity.declaredVersion).length > 120)
        || (identity.declaredDate !== null && Array.from(identity.declaredDate).length > 40)
        || (contentBytes !== null && (!Number.isSafeInteger(contentBytes) || contentBytes < 0
          || contentBytes > MAX_SOURCE_BYTES))) {
      throw new Error('source');
    }
    return contentBytes === null ? identity : { ...identity, contentBytes };
  } catch {
    throw apiError(409, 'WIKI_ARTICLE_SOURCE_CHANGED', 'Uma fonte citada não está disponível na versão registrada.');
  }
}

function sourceRowDto(row) {
  const identity = sourceMetadataDto(row);
  if (typeof row.content !== 'string' || Buffer.byteLength(row.content, 'utf8') > MAX_SOURCE_BYTES
      || (identity.contentBytes !== undefined && Buffer.byteLength(row.content, 'utf8') !== identity.contentBytes)
      || sha256(Buffer.from(row.content, 'utf8')) !== identity.fileSha256) {
    throw apiError(409, 'WIKI_ARTICLE_SOURCE_CHANGED', 'Uma fonte citada não está disponível na versão registrada.');
  }
  return { ...identity, content: row.content };
}

function sourceTokenIdentity(source) {
  return {
    sourceId: source.sourceId,
    archiveSha256: source.archiveSha256,
    relativePath: source.relativePath,
    fileSha256: source.fileSha256,
    family: source.family,
    language: source.language,
    declaredVersion: source.declaredVersion,
    declaredDate: source.declaredDate,
  };
}

function parseArticleFileText(fileText) {
  if (typeof fileText !== 'string') throw invalidFile();
  const bytes = Buffer.byteLength(fileText, 'utf8');
  if (bytes > ARTICLE_FILE_MAX_BYTES) {
    throw apiError(413, 'WIKI_ARTICLE_FILE_TOO_LARGE', 'O arquivo do artigo excede o limite de quatro MiB.');
  }
  try {
    authoringCompiler().assertNoDuplicateJsonKeys(fileText);
    return JSON.parse(fileText);
  } catch {
    throw apiError(400, 'INVALID_WIKI_ARTICLE_FILE_JSON', 'O arquivo do artigo precisa ser um JSON válido, sem campos duplicados.');
  }
}

function readSourceSetBindings(value, usedSetLabels) {
  if (value === undefined) return new Map();
  if (!Array.isArray(value) || value.length > 500) throw invalidFile();
  const bindings = new Map();
  for (const item of value) {
    try {
      assertObjectShape(item, { allowedKeys: ['set', 'archiveSha256'], requiredKeys: ['set', 'archiveSha256'] });
      if (typeof item.set !== 'string' || !AUTHORING_KEY.test(item.set)
          || typeof item.archiveSha256 !== 'string' || !HASH_RE.test(item.archiveSha256)
          || bindings.has(item.set)) throw new Error('binding');
      bindings.set(item.set, item.archiveSha256);
    } catch {
      throw invalidFile();
    }
  }
  if ([...bindings.keys()].some((label) => !usedSetLabels.has(label))) throw invalidFile();
  return bindings;
}

function directArchiveHash(label) {
  if (HASH_RE.test(label)) return label;
  const match = /^archive-([a-f0-9]{64})$/u.exec(label);
  return match ? match[1] : null;
}

async function querySourcesForPaths(tx, paths) {
  if (!paths.length) return [];
  return tx`
    SELECT id, archive_sha256, relative_path, file_sha256, family, language,
           declared_version, declared_date, octet_length(content)::bigint AS content_bytes
    FROM wiki_sources
    WHERE relative_path = ANY(${tx.array(paths, 25)})
    ORDER BY archive_sha256 ASC, relative_path ASC, id ASC`;
}

async function querySourcesByIds(tx, ids) {
  const uniqueIds = [...new Set(ids)].sort();
  if (!uniqueIds.length) return [];
  return tx`
    SELECT id, archive_sha256, relative_path, file_sha256, family, language,
           declared_version, declared_date, octet_length(content)::bigint AS content_bytes, content
    FROM wiki_sources WHERE id = ANY(${tx.array(uniqueIds, 2950)})
    ORDER BY id ASC`;
}

async function lockSourceRowsForRead(tx, ids) {
  const uniqueIds = [...new Set(ids)].sort();
  if (!uniqueIds.length) return;
  const rows = await tx`
    SELECT id FROM wiki_sources
    WHERE id = ANY(${tx.array(uniqueIds, 2950)})
    ORDER BY id FOR SHARE`;
  if (rows.length !== uniqueIds.length) {
    throw apiError(409, 'WIKI_ARTICLE_SOURCE_CHANGED', 'Uma fonte citada não está disponível na versão registrada.');
  }
}

async function assertSourceByteLimits(tx, ids) {
  const uniqueIds = [...new Set(ids)].sort();
  if (!uniqueIds.length) return;
  const rows = await tx`
    SELECT count(*)::integer AS source_count,
           COALESCE(sum(octet_length(content)), 0)::bigint AS total_bytes,
           COALESCE(max(octet_length(content)), 0)::bigint AS largest_bytes
    FROM wiki_sources WHERE id = ANY(${tx.array(uniqueIds, 2950)})`;
  const sourceCount = Number(rows[0].source_count);
  const totalBytes = Number(rows[0].total_bytes);
  const largestBytes = Number(rows[0].largest_bytes);
  if (sourceCount !== uniqueIds.length) {
    throw apiError(409, 'WIKI_ARTICLE_SOURCE_CHANGED', 'Uma fonte citada não está disponível na versão registrada.');
  }
  if (!Number.isSafeInteger(totalBytes) || !Number.isSafeInteger(largestBytes)
      || largestBytes > MAX_SOURCE_BYTES || totalBytes > MAX_TOTAL_ARTICLE_SOURCE_BYTES) {
    throw apiError(413, 'WIKI_ARTICLE_SOURCES_TOO_LARGE', 'As fontes citadas excedem os limites de tamanho para validação do artigo.');
  }
}

function assertSameSourceMetadata(expected, current) {
  if (!current || expected.sourceId !== current.sourceId
      || expected.archiveSha256 !== current.archiveSha256 || expected.relativePath !== current.relativePath
      || expected.fileSha256 !== current.fileSha256 || expected.family !== current.family
      || expected.language !== current.language || expected.declaredVersion !== current.declaredVersion
      || expected.declaredDate !== current.declaredDate
      || (expected.contentBytes !== undefined && expected.contentBytes !== current.contentBytes)) {
    throw apiError(409, 'WIKI_ARTICLE_SOURCE_CHANGED', 'Uma fonte citada mudou durante a validação. Gere uma nova prévia.');
  }
}

/** Resolve authoring references strictly against DB source rows, never local files. */
async function resolveAuthoringSources(tx, authoring, sourceSetBindingsValue) {
  const validated = authoringCompiler().validateAuthoring(authoring);
  const declarationsBySet = new Map();
  for (const declaration of validated.sources) {
    const list = declarationsBySet.get(declaration.set) || [];
    list.push(declaration);
    declarationsBySet.set(declaration.set, list);
  }
  const bindings = readSourceSetBindings(sourceSetBindingsValue, new Set(declarationsBySet.keys()));
  const paths = [...new Set(validated.sources.map((source) => source.path))];
  const dbRows = (await querySourcesForPaths(tx, paths)).map(sourceMetadataDto);
  const rowsByArchive = new Map();
  for (const row of dbRows) {
    const archive = rowsByArchive.get(row.archiveSha256) || new Map();
    archive.set(row.relativePath, row);
    rowsByArchive.set(row.archiveSha256, archive);
  }

  const sourceSets = new Map();
  const sourceByDeclaration = new Map();
  const sourceMetaByDeclaration = new Map();
  const needsBindings = [];
  const selectedSets = new Map();

  for (const [label, declarations] of declarationsBySet) {
    const setPaths = [...new Set(declarations.map((declaration) => declaration.path))];
    if (setPaths.length !== declarations.length) throw invalidFile();
    const candidateHashes = [...rowsByArchive.entries()]
      .filter(([, files]) => setPaths.every((relativePath) => files.has(relativePath)))
      .map(([archiveSha256]) => archiveSha256)
      .sort();
    const chosenHash = bindings.get(label) || directArchiveHash(label) || null;
    if (chosenHash) {
      const files = rowsByArchive.get(chosenHash);
      if (!files || !setPaths.every((relativePath) => files.has(relativePath))) {
        throw apiError(409, 'WIKI_ARTICLE_SOURCE_MISSING', 'Uma fonte declarada não está disponível no arquivo de origem selecionado.');
      }
    } else if (candidateHashes.length === 0) {
      throw apiError(409, 'WIKI_ARTICLE_SOURCE_MISSING', 'Uma fonte declarada não está disponível no acervo da equipe.');
    } else if (candidateHashes.length > 1) {
      needsBindings.push({ set: label, choices: candidateHashes });
      continue;
    }
    const archiveSha256 = chosenHash || candidateHashes[0];
    const files = rowsByArchive.get(archiveSha256);
    selectedSets.set(label, { archiveSha256, paths: setPaths });
    for (const declaration of declarations) {
      const source = files.get(declaration.path);
      sourceMetaByDeclaration.set(declaration.key, source);
    }
  }
  const selectedMetadata = [...new Map([...sourceMetaByDeclaration.values()].map((source) => [source.sourceId, source])).values()];
  const selectedIds = selectedMetadata.map((source) => source.sourceId);
  await lockSourceRowsForRead(tx, selectedIds);
  await assertSourceByteLimits(tx, selectedIds);
  const sourceRows = (await querySourcesByIds(tx, selectedIds))
    .map(sourceRowDto);
  const sourceById = new Map(sourceRows.map((source) => [source.sourceId, source]));
  for (const metadata of selectedMetadata) assertSameSourceMetadata(metadata, sourceById.get(metadata.sourceId));
  const sourceMatches = [];
  for (const [label, selected] of selectedSets) {
    sourceSets.set(label, {
      archiveSha256: selected.archiveSha256,
      files: selected.paths.map((relativePath) => ({
        ...sourceById.get(rowsByArchive.get(selected.archiveSha256).get(relativePath).sourceId),
        role: 'source',
      })),
    });
  }
  for (const declaration of validated.sources) {
    const metadata = sourceMetaByDeclaration.get(declaration.key);
    if (!metadata) continue;
    const source = sourceById.get(metadata.sourceId);
    if (!source) throw apiError(409, 'WIKI_ARTICLE_SOURCE_CHANGED', 'Uma fonte citada não está disponível na versão registrada.');
    sourceByDeclaration.set(declaration.key, source);
    sourceMatches.push({
      sourceId: source.sourceId,
      set: declaration.set,
      path: source.relativePath,
      archiveSha256: source.archiveSha256,
      fileSha256: source.fileSha256,
    });
  }
  return {
    validated,
    sourceSets,
    sourceByDeclaration,
    sourceMatches: sourceMatches.sort((left, right) => (
      left.set.localeCompare(right.set, 'en') || left.path.localeCompare(right.path, 'en')
    )),
    needsBindings,
  };
}

function mapCompiledSources(compiledContent, sourceByDeclaration, authoring) {
  const sourceIdsByIdentity = new Map();
  for (const source of sourceByDeclaration.values()) {
    sourceIdsByIdentity.set(`${source.archiveSha256}\0${source.relativePath}\0${source.fileSha256}`, source.sourceId);
  }
  const idMap = new Map();
  for (const source of compiledContent.sources) {
    const sourceId = sourceIdsByIdentity.get(`${source.archiveSha256}\0${source.relativePath}\0${source.fileSha256}`);
    if (!sourceId) throw invalidFile();
    idMap.set(source.sourceId, sourceId);
  }
  const page = compiledContent.pages[0];
  const citations = page.citations.map((citation) => ({
    sectionId: citation.sectionId,
    sourceId: idMap.get(citation.sourceId),
    locator: citation.locator,
  }));
  if (citations.some((citation) => !citation.sourceId)) throw invalidFile();
  const sectionKeys = new Map(page.snapshot.body.sections.map((section, index) => [
    section.id,
    authoring.pages[0].sections[index]?.key,
  ]));
  return { snapshot: page.snapshot, citations, sectionKeys };
}

async function resolveBundleSources(tx, bundlePage, bundleSources) {
  const identities = bundleSources.map((source) => `${source.archiveSha256}\0${source.relativePath}`);
  const rows = (await querySourcesForPaths(tx, [...new Set(bundleSources.map((source) => source.relativePath))])).map(sourceMetadataDto);
  const rowsByIdentity = new Map(rows.map((row) => [`${row.archiveSha256}\0${row.relativePath}`, row]));
  const matchedMetadata = [];
  for (const source of bundleSources) {
    const identity = `${source.archiveSha256}\0${source.relativePath}`;
    const stored = rowsByIdentity.get(identity);
    if (!stored || stored.fileSha256 !== source.fileSha256
        || stored.family !== source.family || stored.language !== source.language
        || stored.declaredVersion !== source.declaredVersion || stored.declaredDate !== source.declaredDate) {
      throw apiError(409, 'WIKI_ARTICLE_SOURCE_MISSING', 'Uma fonte do pacote não corresponde exatamente a uma fonte registrada da equipe.');
    }
    matchedMetadata.push(stored);
  }
  const matchedIds = matchedMetadata.map((source) => source.sourceId);
  await lockSourceRowsForRead(tx, matchedIds);
  await assertSourceByteLimits(tx, matchedIds);
  const storedRows = (await querySourcesByIds(tx, matchedIds)).map(sourceRowDto);
  const fullById = new Map(storedRows.map((source) => [source.sourceId, source]));
  for (const metadata of matchedMetadata) assertSameSourceMetadata(metadata, fullById.get(metadata.sourceId));
  const sourceIdMap = new Map();
  const sources = [];
  const sourceMatches = [];
  for (const source of bundleSources) {
    const identity = `${source.archiveSha256}\0${source.relativePath}`;
    const metadata = rowsByIdentity.get(identity);
    const stored = metadata && fullById.get(metadata.sourceId);
    if (!stored || stored.fileSha256 !== source.fileSha256
        || stored.family !== source.family || stored.language !== source.language
        || stored.declaredVersion !== source.declaredVersion || stored.declaredDate !== source.declaredDate
        || stored.content !== source.content) {
      throw apiError(409, 'WIKI_ARTICLE_SOURCE_MISSING', 'Uma fonte do pacote não corresponde exatamente a uma fonte registrada da equipe.');
    }
    sourceIdMap.set(source.sourceId, stored.sourceId);
    sources.push(stored);
    sourceMatches.push({
      sourceId: stored.sourceId,
      set: `archive-${stored.archiveSha256}`,
      path: stored.relativePath,
      archiveSha256: stored.archiveSha256,
      fileSha256: stored.fileSha256,
    });
  }
  const citations = bundlePage.citations.map((citation) => ({
    sectionId: citation.sectionId,
    sourceId: sourceIdMap.get(citation.sourceId),
    locator: citation.locator,
  }));
  if (citations.some((citation) => !citation.sourceId) || sources.length !== identities.length) throw invalidFile();
  return { sources, citations, sourceMatches };
}

function pageNames(snapshot) {
  return [...new Set([snapshot.slug, ...snapshot.aliases].map((name) => normalizeSlug(name)))].sort();
}

async function findNameCandidatesWithHint(tx, names, hintedPageId) {
  if (!names.length && !hintedPageId) return [];
  const byId = new Map();
  const nameMatchIds = new Set();
  const matchingHeads = names.length ? await tx`
    SELECT p.id, p.head_revision_id, p.work_version, head.snapshot
    FROM wiki_pages p
    JOIN wiki_revisions head ON head.id = p.head_revision_id AND head.page_id = p.id
    WHERE head.snapshot->>'slug' = ANY(${tx.array(names, 25)})
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements_text(head.snapshot->'aliases') AS alias(value)
         WHERE alias.value = ANY(${tx.array(names, 25)})
       )` : [];
  for (const row of matchingHeads) {
    const id = String(row.id).toLowerCase();
    byId.set(id, row);
    nameMatchIds.add(id);
  }
  const namedRows = names.length ? await tx`
    SELECT DISTINCT page_id FROM wiki_names
    WHERE name_key = ANY(${tx.array(names, 25)}) ORDER BY page_id` : [];
  const missingIds = namedRows.map((row) => String(row.page_id).toLowerCase()).filter((id) => !byId.has(id));
  for (const row of namedRows) nameMatchIds.add(String(row.page_id).toLowerCase());
  if (missingIds.length) {
    const historical = await tx`
      SELECT p.id, p.head_revision_id, p.work_version, head.snapshot
      FROM wiki_pages p LEFT JOIN wiki_revisions head ON head.id = p.head_revision_id AND head.page_id = p.id
      WHERE p.id = ANY(${tx.array(missingIds, 2950)})`;
    for (const row of historical) byId.set(String(row.id).toLowerCase(), row);
  }
  if (hintedPageId && !byId.has(hintedPageId)) {
    const hinted = await tx`
      SELECT p.id, p.head_revision_id, p.work_version, head.snapshot
      FROM wiki_pages p JOIN wiki_revisions head ON head.id = p.head_revision_id AND head.page_id = p.id
      WHERE p.id = ${hintedPageId} LIMIT 1`;
    if (hinted.length) byId.set(String(hinted[0].id).toLowerCase(), hinted[0]);
  }
  const items = [...byId.values()].map((row) => {
    let title = null;
    try { title = row.snapshot ? validateWikiSnapshot(row.snapshot).title : null; } catch { /* Name still belongs to this page. */ }
    const version = Number(row.work_version);
    return {
      id: String(row.id).toLowerCase(),
      title,
      workVersion: Number.isSafeInteger(version) && version > 0 ? version : null,
      headRevisionId: row.head_revision_id ? String(row.head_revision_id).toLowerCase() : null,
      snapshot: row.snapshot ? (() => { try { return validateWikiSnapshot(row.snapshot); } catch { return null; } })() : null,
    };
  }).sort((left, right) => left.id.localeCompare(right.id, 'en'));
  return { items, nameMatchIds };
}

function authoringPageHint(authoring) {
  if (!authoring || !Array.isArray(authoring.pages) || authoring.pages.length !== 1) return null;
  const match = /^page-([0-9a-f-]{36})$/u.exec(authoring.pages[0]?.key || '');
  if (!match) return null;
  try { return validateUuid(match[1], 'targetPageId'); } catch { return null; }
}

function validatePlanCitations(value, snapshot) {
  if (!Array.isArray(value) || value.length > 10_000) throw invalidFile();
  const sectionIds = new Set(snapshot.body.sections.map((section) => section.id));
  const seen = new Set();
  return value.map((citation) => {
    try {
      assertObjectShape(citation, { allowedKeys: ['sectionId', 'sourceId', 'locator'], requiredKeys: ['sectionId', 'sourceId', 'locator'] });
      const sectionId = validateUuid(citation.sectionId, 'sectionId');
      const sourceId = validateUuid(citation.sourceId, 'sourceId');
      const locator = citation.locator;
      if (typeof locator !== 'string' || !locator.trim() || Array.from(locator).length > 500 || locator.includes('\0')
          || !sectionIds.has(sectionId)) throw new Error('citation');
      const identity = `${sectionId}\0${sourceId}\0${locator}`;
      if (seen.has(identity)) throw new Error('duplicate');
      seen.add(identity);
      return { sectionId, sourceId, locator };
    } catch {
      throw invalidFile();
    }
  });
}

async function loadTargetPage(tx, id) {
  if (!id) return null;
  const rows = await tx`
    SELECT p.id, p.head_revision_id, p.published_revision_id, p.work_version, p.archived_at,
           head.snapshot
    FROM wiki_pages p LEFT JOIN wiki_revisions head ON head.id = p.head_revision_id AND head.page_id = p.id
    WHERE p.id = ${id} LIMIT 1`;
  if (!rows.length) throw apiError(404, 'NOT_FOUND', 'O artigo de destino não foi encontrado.');
  if (!rows[0].head_revision_id || !rows[0].snapshot) {
    throw apiError(409, 'WIKI_ARTICLE_TARGET_NEEDS_REPAIR', 'O artigo de destino precisa de revisão antes de receber a importação.');
  }
  return {
    id: String(rows[0].id).toLowerCase(),
    headRevisionId: String(rows[0].head_revision_id).toLowerCase(),
    publishedRevisionId: rows[0].published_revision_id ? String(rows[0].published_revision_id).toLowerCase() : null,
    workVersion: Number(rows[0].work_version),
    snapshot: validateWikiSnapshot(rows[0].snapshot),
  };
}

function sectionBindingMap(value, sourceSectionIds) {
  if (value === undefined) return new Map();
  if (!Array.isArray(value) || value.length > 500) throw invalidFile();
  const bindings = new Map();
  const targets = new Set();
  for (const item of value) {
    try {
      assertObjectShape(item, { allowedKeys: ['sourceSectionId', 'targetSectionId'], requiredKeys: ['sourceSectionId', 'targetSectionId'] });
      const sourceSectionId = validateUuid(item.sourceSectionId, 'sourceSectionId');
      const targetSectionId = item.targetSectionId === null ? null : validateUuid(item.targetSectionId, 'targetSectionId');
      if (!sourceSectionIds.has(sourceSectionId) || bindings.has(sourceSectionId)
          || (targetSectionId && targets.has(targetSectionId))) throw new Error('binding');
      bindings.set(sourceSectionId, targetSectionId);
      if (targetSectionId) targets.add(targetSectionId);
    } catch {
      throw apiError(400, 'INVALID_WIKI_ARTICLE_SECTION_BINDINGS', 'Os vínculos de seção enviados não são válidos.');
    }
  }
  return bindings;
}

function applySectionBindings(snapshotValue, citationsValue, sectionKeys, targetSnapshot, suppliedBindings) {
  let snapshot = validateWikiSnapshot({ ...snapshotValue, accessLevel: 'staff' });
  const sourceIds = new Set(snapshot.body.sections.map((section) => section.id));
  const targetSections = targetSnapshot ? targetSnapshot.body.sections : [];
  const targetIds = new Set(targetSections.map((section) => section.id));
  const bindings = sectionBindingMap(suppliedBindings, sourceIds);
  for (const targetId of bindings.values()) {
    if (targetId && !targetIds.has(targetId)) {
      throw apiError(400, 'INVALID_WIKI_ARTICLE_SECTION_BINDINGS', 'Um vínculo aponta para uma seção que não pertence ao artigo de destino.');
    }
  }

  const automatic = new Map();
  for (const section of snapshot.body.sections) {
    const stableKey = sectionKeys.get(section.id) || '';
    const suffix = SECTION_KEY_UUID_RE.exec(stableKey)?.[1]?.toLowerCase();
    if (suffix && targetIds.has(suffix)) automatic.set(section.id, suffix);
    else if (targetIds.has(section.id)) automatic.set(section.id, section.id);
  }
  for (const [sourceId, targetId] of bindings) {
    if (targetId === null) automatic.delete(sourceId);
    else automatic.set(sourceId, targetId);
  }

  const finalIds = snapshot.body.sections.map((section) => automatic.get(section.id) || section.id);
  if (new Set(finalIds).size !== finalIds.length) {
    throw apiError(400, 'INVALID_WIKI_ARTICLE_SECTION_BINDINGS', 'Dois blocos do arquivo não podem usar a mesma seção de destino.');
  }
  const idMap = new Map(snapshot.body.sections.map((section, index) => [section.id, finalIds[index]]));
  snapshot = validateWikiSnapshot({
    ...snapshot,
    body: {
      ...snapshot.body,
      sections: snapshot.body.sections.map((section) => ({ ...section, id: idMap.get(section.id) })),
    },
  });
  const citations = validatePlanCitations(citationsValue.map((citation) => ({
    ...citation,
    sectionId: idMap.get(citation.sectionId) || citation.sectionId,
  })), snapshot);
  const sourceSectionIds = [...idMap.keys()];
  const sectionOptions = snapshot.body.sections.map((section, index) => {
    const sourceSectionId = sourceSectionIds[index];
    return {
      sourceSectionId,
      heading: section.heading,
      selectedTargetId: automatic.get(sourceSectionId) || null,
      choices: targetSections.map((targetSection) => ({ id: targetSection.id, heading: targetSection.heading })),
    };
  });
  const retained = new Set(finalIds.filter((id) => targetIds.has(id)));
  const newCount = finalIds.filter((id) => !targetIds.has(id)).length;
  const removedCount = targetSections.filter((section) => !retained.has(section.id)).length;
  const warnings = [];
  if (newCount) warnings.push(`${newCount} seção(ões) receberão uma identidade nova do arquivo.`);
  if (removedCount) warnings.push(`${removedCount} seção(ões) existentes deixarão de integrar esta revisão.`);
  return { snapshot, citations, sectionOptions, warnings };
}

function signPreviewToken(secret, payload) {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = createHmac('sha256', secret).update(encoded, 'utf8').digest('base64url');
  return `${encoded}.${signature}`;
}

function verifyPreviewToken(secret, token) {
  if (typeof token !== 'string' || Buffer.byteLength(token, 'utf8') > PREVIEW_TOKEN_MAX_BYTES) {
    throw apiError(400, 'INVALID_WIKI_ARTICLE_PREVIEW_TOKEN', 'A prévia do artigo expirou ou não é válida. Gere uma nova prévia.');
  }
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw apiError(400, 'INVALID_WIKI_ARTICLE_PREVIEW_TOKEN', 'A prévia do artigo expirou ou não é válida. Gere uma nova prévia.');
  }
  const expected = createHmac('sha256', secret).update(parts[0], 'utf8').digest();
  let actual;
  try { actual = Buffer.from(parts[1], 'base64url'); } catch { actual = Buffer.alloc(0); }
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw apiError(400, 'INVALID_WIKI_ARTICLE_PREVIEW_TOKEN', 'A prévia do artigo expirou ou não é válida. Gere uma nova prévia.');
  }
  let payload;
  try { payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch {
    throw apiError(400, 'INVALID_WIKI_ARTICLE_PREVIEW_TOKEN', 'A prévia do artigo expirou ou não é válida. Gere uma nova prévia.');
  }
  if (!payload || payload.version !== 1 || !Number.isSafeInteger(payload.expiresAt)
      || typeof payload.actorId !== 'string' || !Array.isArray(payload.sourceIdentities)
      || !Array.isArray(payload.citations) || !payload.snapshot || !payload.target) {
    throw apiError(400, 'INVALID_WIKI_ARTICLE_PREVIEW_TOKEN', 'A prévia do artigo expirou ou não é válida. Gere uma nova prévia.');
  }
  if (payload.expiresAt <= Date.now()) {
    throw apiError(409, 'WIKI_ARTICLE_PREVIEW_EXPIRED', 'A prévia expirou. Gere outra antes de importar.');
  }
  return payload;
}

function deterministicIdempotencyKey(token) {
  const bytes = Buffer.from(sha256(Buffer.from(token, 'utf8')).slice(0, 32), 'hex');
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function nameKeys(snapshot) {
  return pageNames(snapshot);
}

async function lockNameKeys(tx, names) {
  for (const name of [...new Set(names)].sort()) {
    // Namespace is specific to authoring imports; sorted locks serialize two
    // concurrent imports without changing the publication/name-reservation flow.
    await tx`SELECT pg_advisory_xact_lock(hashtext('wiki.article_file.name.v1'), hashtext(${name}))`;
  }
}

async function assertArticleNamesAvailable(tx, pageId, snapshot) {
  const names = nameKeys(snapshot);
  await lockNameKeys(tx, names);
  if (!names.length) return;
  const reserved = await tx`
    SELECT name_key, page_id FROM wiki_names
    WHERE name_key = ANY(${tx.array(names, 25)})
    ORDER BY name_key FOR UPDATE`;
  if (reserved.some((row) => String(row.page_id).toLowerCase() !== pageId)) {
    throw apiError(409, 'WIKI_NAME_CONFLICT', 'Um dos nomes do artigo já está em uso por outro artigo.');
  }
  const headOwners = await tx`
    SELECT p.id
    FROM wiki_pages p
    JOIN wiki_revisions head ON head.id = p.head_revision_id AND head.page_id = p.id
    WHERE p.id <> ${pageId} AND (
      head.snapshot->>'slug' = ANY(${tx.array(names, 25)})
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(head.snapshot->'aliases') AS alias(value)
        WHERE alias.value = ANY(${tx.array(names, 25)})
      )
    )
    LIMIT 1`;
  if (headOwners.length) throw apiError(409, 'WIKI_NAME_CONFLICT', 'Um dos nomes do artigo já está em uso por outro artigo.');
}

async function lockAndCheckSources(tx, sourceIdentities) {
  const ids = [...new Set(sourceIdentities.map((source) => validateUuid(source.sourceId, 'sourceId')))].sort();
  if (ids.length !== sourceIdentities.length) {
    throw apiError(409, 'WIKI_ARTICLE_SOURCE_CHANGED', 'Uma fonte citada não está disponível na versão registrada. Gere uma nova prévia.');
  }
  await lockSourceRowsForRead(tx, ids);
  await assertSourceByteLimits(tx, ids);
  const rows = ids.length ? await tx`
    SELECT id, archive_sha256, relative_path, file_sha256, family, language,
           declared_version, declared_date, octet_length(content)::bigint AS content_bytes, content
    FROM wiki_sources WHERE id = ANY(${tx.array(ids, 2950)})
    ORDER BY id` : [];
  if (rows.length !== sourceIdentities.length) {
    throw apiError(409, 'WIKI_ARTICLE_SOURCE_CHANGED', 'Uma fonte citada não está disponível na versão registrada. Gere uma nova prévia.');
  }
  const current = new Map(rows.map((row) => {
    const source = sourceRowDto(row);
    return [source.sourceId, source];
  }));
  for (const expected of sourceIdentities) {
    const source = current.get(expected.sourceId);
    if (!source || source.archiveSha256 !== expected.archiveSha256
        || source.relativePath !== expected.relativePath || source.fileSha256 !== expected.fileSha256
        || source.family !== expected.family || source.language !== expected.language
        || source.declaredVersion !== expected.declaredVersion || source.declaredDate !== expected.declaredDate) {
      throw apiError(409, 'WIKI_ARTICLE_SOURCE_CHANGED', 'Uma fonte citada mudou desde a prévia. Gere uma nova prévia.');
    }
  }
}

function auditState(snapshot, citations) {
  return {
    title: snapshot.title,
    slug: snapshot.slug,
    accessLevel: snapshot.accessLevel,
    citationCount: citations.length,
    sectionCount: snapshot.body.sections.length,
  };
}

async function writeArticleImportAudit(tx, actorId, pageId, before, after) {
  await tx`
    INSERT INTO audit_events (actor_id, action, target_type, target_id, reason, before_state, after_state)
    VALUES (${actorId}, 'wiki.article_file.import', 'wiki_page', ${pageId},
      'Importação de arquivo de autoria da wiki.', ${tx.json(before)}, ${tx.json(after)})`;
}

async function insertNewPage(tx, actor, plan) {
  const pageRows = await tx`
    INSERT INTO wiki_pages (created_by, access_level)
    VALUES (${actor.id}, 'staff') RETURNING id`;
  const pageId = validateUuid(pageRows[0].id);
  const revision = await insertRevision(tx, {
    pageId,
    actorId: actor.id,
    sequence: 1,
    parentId: null,
    basePublishedId: null,
    summary: 'Importação de arquivo de autoria.',
    snapshot: plan.snapshot,
    restoresId: null,
  });
  await tx`UPDATE wiki_pages SET head_revision_id = ${revision.id}, updated_at = now() WHERE id = ${pageId}`;
  await saveRevisionIndexes(tx, revision.id, plan.snapshot);
  await insertRevisionCitations(tx, revision.id, plan.citations);
  await writeArticleImportAudit(tx, actor.id, pageId, { state: 'new' }, auditState(plan.snapshot, plan.citations));
  return { pageId, page: await loadStaffPageDto(tx, pageId) };
}

async function insertPageRevision(tx, actor, current, plan) {
  const nextWorkVersion = Number(current.work_version) + 1;
  if (!Number.isSafeInteger(nextWorkVersion) || nextWorkVersion > MAX_INT) {
    throw apiError(409, 'WORK_VERSION_EXHAUSTED', 'Este artigo atingiu o limite de revisões de trabalho.');
  }
  const sequenceRows = await tx`SELECT COALESCE(max(sequence), 0)::integer AS sequence FROM wiki_revisions WHERE page_id = ${current.id}`;
  const sequence = Number(sequenceRows[0].sequence);
  if (!Number.isSafeInteger(sequence) || sequence >= MAX_INT) {
    throw apiError(409, 'REVISION_SEQUENCE_EXHAUSTED', 'Este artigo atingiu o limite de revisões.');
  }
  const revision = await insertRevision(tx, {
    pageId: current.id,
    actorId: actor.id,
    sequence: sequence + 1,
    parentId: current.head_revision_id,
    basePublishedId: current.published_revision_id,
    summary: 'Importação de arquivo de autoria.',
    snapshot: plan.snapshot,
    restoresId: null,
  });
  await tx`
    UPDATE wiki_pages SET head_revision_id = ${revision.id}, work_version = ${nextWorkVersion}, updated_at = now()
    WHERE id = ${current.id}`;
  await saveRevisionIndexes(tx, revision.id, plan.snapshot);
  await insertRevisionCitations(tx, revision.id, plan.citations);
  await writeArticleImportAudit(tx, actor.id, current.id,
    { headRevisionId: String(current.head_revision_id).toLowerCase(), workVersion: Number(current.work_version) },
    auditState(plan.snapshot, plan.citations));
  return { pageId: current.id, page: await loadStaffPageDto(tx, current.id) };
}

function buildAuthoringExport(page, sourceRows) {
  const snapshot = page.head.snapshot;
  if (snapshot.body.sections.some((section) => section.blocks.length > 0)) return null;
  const sourceById = new Map(sourceRows.map((source) => [source.sourceId, source]));
  const citationsBySection = new Map();
  for (const citation of page.head.citations || []) {
    const list = citationsBySection.get(citation.sectionId) || [];
    list.push(citation);
    citationsBySection.set(citation.sectionId, list);
  }
  if (snapshot.body.sections.some((section) => !(citationsBySection.get(section.id) || []).length)) return null;
  if ((page.head.citations || []).some((citation) => !sourceById.has(citation.sourceId))) return null;

  const sourceSetMeta = new Map();
  const sourceKeys = new Map();
  const sources = sourceRows.map((source) => {
    const set = `archive-${source.archiveSha256}`;
    const key = `source-${source.sourceId}`;
    sourceKeys.set(source.sourceId, key);
    const paths = sourceSetMeta.get(set) || new Set();
    paths.add(source.relativePath);
    sourceSetMeta.set(set, paths);
    return { key, set, path: source.relativePath };
  }).sort((left, right) => left.key.localeCompare(right.key, 'en'));

  const file = {
    format: AUTHORING_FORMAT,
    workspace: `wiki-article-${page.id}`,
    sources,
    pages: [{
      key: `page-${page.id}`,
      title: snapshot.title,
      slug: snapshot.slug,
      aliases: snapshot.aliases,
      type: snapshot.type,
      summary: snapshot.summary,
      categories: snapshot.categories,
      audience: snapshot.audience,
      infobox: snapshot.body.infobox,
      sections: snapshot.body.sections.map((section) => ({
        key: `section-${section.id}`,
        heading: section.heading,
        html: section.html,
        authority: section.authority,
        knowledgeLayer: section.knowledgeLayer,
        citations: (citationsBySection.get(section.id) || []).map((citation) => ({
          source: sourceKeys.get(citation.sourceId),
          locator: citation.locator,
        })),
      })),
    }],
  };
  const sourceSets = [...sourceSetMeta.entries()].sort(([left], [right]) => left.localeCompare(right, 'en'))
    .map(([set, paths]) => ({
      set,
      archiveSha256: set.slice('archive-'.length),
      paths: [...paths].sort((left, right) => left.localeCompare(right, 'en')),
    }));
  try {
    const { compileAuthoringContent, validateAuthoring } = authoringCompiler();
    const validated = validateAuthoring(file);
    if (validated.pages.length !== 1) return null;
    const manifests = new Map();
    for (const set of sourceSets) {
      const files = sources.filter((source) => source.set === set.set).map((source) => {
        const original = sourceRows.find((item) => item.sourceId === source.key.slice('source-'.length));
        return {
          archiveSha256: original.archiveSha256,
          relativePath: original.relativePath,
          fileSha256: original.fileSha256,
          family: original.family,
          language: original.language,
          declaredVersion: original.declaredVersion,
          declaredDate: original.declaredDate,
          role: 'source',
          content: original.content,
        };
      });
      manifests.set(set.set, { archiveSha256: set.archiveSha256, files });
    }
    compileAuthoringContent(file, manifests);
  } catch {
    return null;
  }
  return { file, sourceSets };
}

async function loadExportSources(tx, citations) {
  const ids = [...new Set(citations.map((citation) => citation.sourceId))].sort();
  if (!ids.length) return [];
  await assertSourceByteLimits(tx, ids);
  const rows = await tx`
    SELECT id, archive_sha256, relative_path, file_sha256, family, language,
           declared_version, declared_date, octet_length(content)::bigint AS content_bytes, content
    FROM wiki_sources WHERE id = ANY(${tx.array(ids, 2950)})
    ORDER BY archive_sha256, relative_path, id`;
  if (rows.length !== ids.length) throw apiError(409, 'WIKI_ARTICLE_SOURCE_CHANGED', 'Uma fonte citada não está disponível para exportação.');
  return rows.map(sourceRowDto);
}

async function guideSourceSets(tx) {
  const rows = await tx`
    SELECT archive_sha256, relative_path FROM wiki_sources
    ORDER BY archive_sha256 ASC, relative_path ASC`;
  const grouped = new Map();
  for (const row of rows) {
    const archiveSha256 = row.archive_sha256;
    if (!HASH_RE.test(archiveSha256) || typeof row.relative_path !== 'string') {
      throw apiError(409, 'WIKI_ARTICLE_SOURCE_CHANGED', 'O catálogo de fontes precisa de revisão antes da exportação.');
    }
    const paths = grouped.get(archiveSha256) || [];
    paths.push(row.relative_path);
    grouped.set(archiveSha256, paths);
  }
  return [...grouped.entries()].map(([archiveSha256, paths]) => ({
    set: `archive-${archiveSha256}`,
    archiveSha256,
    paths,
  }));
}

function createWikiArticleFilesRouter({ sql, auth, sessionSecret } = {}) {
  if (typeof sql !== 'function' || typeof sql.begin !== 'function') {
    throw new TypeError('createWikiArticleFilesRouter requires the injected postgres client.');
  }
  if (typeof sessionSecret !== 'string' || !sessionSecret) {
    throw new TypeError('createWikiArticleFilesRouter requires config.sessionSecret.');
  }
  for (const method of ['requireIdentity', 'requireRole', 'withActorTransaction', 'assertRole']) {
    if (!auth || typeof auth[method] !== 'function') throw new TypeError(`createWikiArticleFilesRouter requires auth.${method}.`);
  }

  const router = express.Router();
  const staff = express.Router();
  staff.use(auth.requireIdentity, auth.requireRole(...STAFF_ROLES));
  router.use('/staff/wiki', staff);

  staff.get('/article-files/guide', route(async (req, res) => {
    const data = await withStaffTransaction(auth, req, async (tx) => ({
      brief: AUTHORING_BRIEF,
      example: AUTHORING_EXAMPLE,
      sourceSets: await guideSourceSets(tx),
    }));
    return res.json({ data });
  }));

  staff.get('/pages/:id/article-file', route(async (req, res) => {
    const id = validateUuid(req.params.id);
    const data = await withStaffTransaction(auth, req, async (tx) => {
      const page = await loadStaffPageDto(tx, id);
      if (!page.head) throw apiError(409, 'WIKI_ARTICLE_TARGET_NEEDS_REPAIR', 'O artigo precisa de revisão antes de ser exportado.');
      const citations = page.head.citations || [];
      const sources = await loadExportSources(tx, citations);
      const authoring = buildAuthoringExport(page, sources);
      if (authoring) {
        return {
          file: authoring.file,
          filename: `aetherverse-wiki-${page.head.snapshot.slug}.authoring-v1.json`,
          notes: Buffer.byteLength(JSON.stringify(authoring.file), 'utf8') > ARTICLE_FILE_MAX_BYTES
            ? ['O arquivo excede o limite de quatro MiB aceito pela prévia de importação.']
            : [],
        };
      }
      const bundle = await createWikiArticleBundle(tx, id);
      const notes = [EXPORT_NOTE];
      if (Buffer.byteLength(JSON.stringify(bundle), 'utf8') > ARTICLE_FILE_MAX_BYTES) {
        notes.push('Este pacote excede o limite de quatro MiB aceito pela prévia de importação.');
      }
      return {
        file: bundle,
        filename: `aetherverse-wiki-${page.head.snapshot.slug}.bundle-v1.json`,
        notes,
      };
    }, { beforeActorLock: setRepeatableRead });
    return res.json({ data });
  }));

  staff.post('/article-files/preview', route(async (req, res) => {
    const body = assertObjectShape(req.body, {
      allowedKeys: ['fileText', 'sourceSets', 'targetPageId', 'sectionBindings'],
      requiredKeys: ['fileText'],
    });
    const parsed = parseArticleFileText(body.fileText);
    const targetPageId = body.targetPageId === undefined || body.targetPageId === null
      ? null : validateUuid(body.targetPageId, 'targetPageId');
    const sourceSetInput = body.sourceSets;
    const sectionBindings = body.sectionBindings;

    const result = await withStaffTransaction(auth, req, async (tx, actor) => {
      let originalSnapshot;
      let citations;
      let authoringValidation = null;
      let sectionKeys = new Map();
      let sourceMatches = [];
      let sourceIdentities = [];
      let needsBindings = [];
      let hintedPageId = null;

      if (parsed && parsed.format === AUTHORING_FORMAT) {
        try { authoringValidation = authoringCompiler().validateAuthoring(parsed); } catch { throw invalidFile(); }
        if (authoringValidation.pages.length !== 1) throw invalidFile();
        hintedPageId = authoringPageHint(parsed);
        const resolved = await resolveAuthoringSources(tx, parsed, sourceSetInput);
        sourceMatches = resolved.sourceMatches;
        needsBindings = resolved.needsBindings;
        if (!needsBindings.length) {
          let compiled;
          try { compiled = authoringCompiler().compileAuthoringContent(parsed, resolved.sourceSets); } catch { throw invalidFile(); }
          const mapped = mapCompiledSources(compiled, resolved.sourceByDeclaration, parsed);
          originalSnapshot = mapped.snapshot;
          citations = mapped.citations;
          sectionKeys = mapped.sectionKeys;
          const usedDbSources = new Map([...resolved.sourceByDeclaration.values()].map((source) => [source.sourceId, source]));
          sourceIdentities = [...usedDbSources.values()].map(sourceTokenIdentity).sort((left, right) => left.sourceId.localeCompare(right.sourceId, 'en'));
        }
      } else if (parsed && parsed.format === BUNDLE_FORMAT) {
        let validatedBundle;
        try { validatedBundle = validateBundle(parsed).bundle; } catch { throw invalidFile(); }
        if (validatedBundle.pages.length !== 1) throw invalidFile();
        hintedPageId = validatedBundle.pages[0].sourcePageId;
        const resolved = await resolveBundleSources(tx, validatedBundle.pages[0], validatedBundle.sources);
        originalSnapshot = validatedBundle.pages[0].snapshot;
        citations = resolved.citations;
        sourceMatches = resolved.sourceMatches;
        sourceIdentities = resolved.sources.map(sourceTokenIdentity).sort((left, right) => left.sourceId.localeCompare(right.sourceId, 'en'));
        sectionKeys = new Map(originalSnapshot.body.sections.map((section) => [section.id, '']));
      } else {
        throw invalidFile();
      }

      const candidateSource = originalSnapshot
        ? validateWikiSnapshot({ ...originalSnapshot, accessLevel: 'staff' })
        : parsed.format === AUTHORING_FORMAT
          ? {
            slug: authoringValidation.pages[0].slug,
            aliases: authoringValidation.pages[0].aliases,
          }
          : null;
      if (!candidateSource) throw invalidFile();
      const candidateResult = await findNameCandidatesWithHint(tx, pageNames(candidateSource), hintedPageId);
      const candidates = Array.isArray(candidateResult) ? [] : candidateResult.items;
      const nameMatchIds = Array.isArray(candidateResult) ? new Set() : candidateResult.nameMatchIds;
      let target = targetPageId ? await loadTargetPage(tx, targetPageId) : null;
      if (targetPageId && [...nameMatchIds].some((id) => id !== targetPageId)) {
        throw apiError(409, 'WIKI_NAME_CONFLICT', 'Um dos nomes do arquivo já pertence a outro artigo.');
      }

      if (needsBindings.length) {
        return {
          data: {
            snapshot: null,
            citations: [],
            sourceMatches,
            candidates: candidates.map(({ id, title, workVersion }) => ({ id, title, workVersion })),
            beforeSnapshot: target?.snapshot || null,
            targetPageId: target?.id || null,
            expectedVersion: target?.workVersion || null,
            sectionOptions: [],
            previewToken: null,
            warnings: ['Vincule cada catálogo ambíguo a um arquivo de origem antes de confirmar a prévia.'],
            needsBindings,
          },
          status: 200,
        };
      }

      if (!targetPageId && candidates.length) {
        return {
          data: {
            snapshot: validateWikiSnapshot({ ...originalSnapshot, accessLevel: 'staff' }),
            citations: validatePlanCitations(citations, validateWikiSnapshot({ ...originalSnapshot, accessLevel: 'staff' })),
            sourceMatches,
            candidates: candidates.map(({ id, title, workVersion }) => ({ id, title, workVersion })),
            beforeSnapshot: null,
            targetPageId: null,
            expectedVersion: null,
            sectionOptions: [],
            previewToken: null,
            warnings: ['Escolha explicitamente o artigo que receberá esta revisão.'],
          },
          status: 200,
        };
      }

      if (targetPageId && nameMatchIds.size && !nameMatchIds.has(targetPageId)) {
        throw apiError(409, 'WIKI_NAME_CONFLICT', 'Um dos nomes do arquivo já pertence a outro artigo.');
      }

      const baseSnapshot = validateWikiSnapshot({ ...originalSnapshot, accessLevel: 'staff' });
      const applied = applySectionBindings(baseSnapshot, citations, sectionKeys, target?.snapshot || null, sectionBindings);
      const cleanCitations = validatePlanCitations(applied.citations, applied.snapshot);
      await assertCitationSourcesExist(tx, cleanCitations);
      const expiresAt = Date.now() + PREVIEW_TOKEN_TTL_MS;
      const plan = {
        version: 1,
        actorId: actor.id,
        expiresAt,
        snapshot: applied.snapshot,
        citations: cleanCitations,
        sourceIdentities,
        target: target ? {
          pageId: target.id,
          headRevisionId: target.headRevisionId,
          workVersion: target.workVersion,
          publishedRevisionId: target.publishedRevisionId,
        } : {
          pageId: null,
          headRevisionId: null,
          workVersion: null,
          publishedRevisionId: null,
        },
      };
      const previewToken = signPreviewToken(sessionSecret, plan);
      const warnings = [...applied.warnings];
      if (!target) warnings.push('A importação criará um novo artigo privado para a equipe.');
      if (Buffer.byteLength(previewToken, 'utf8') > PREVIEW_TOKEN_MAX_BYTES) {
        throw apiError(413, 'WIKI_ARTICLE_FILE_TOO_LARGE', 'A prévia assinada excede o limite permitido.');
      }
      return {
        data: {
          snapshot: applied.snapshot,
          citations: cleanCitations,
          sourceMatches,
          candidates: candidates.map(({ id, title, workVersion }) => ({ id, title, workVersion })),
          beforeSnapshot: target?.snapshot || null,
          targetPageId: target?.id || null,
          expectedVersion: target?.workVersion || null,
          sectionOptions: applied.sectionOptions,
          previewToken,
          warnings,
        },
        status: 200,
      };
    });
    return res.status(result.status).json({ data: result.data });
  }));

  staff.post('/article-files/commit', route(async (req, res) => {
    const body = assertObjectShape(req.body, { allowedKeys: ['previewToken'], requiredKeys: ['previewToken'] });
    const token = body.previewToken;
    const payload = verifyPreviewToken(sessionSecret, token);
    const snapshot = validateWikiSnapshot(payload.snapshot);
    const citations = validatePlanCitations(payload.citations, snapshot);
    if (snapshot.accessLevel !== 'staff') throw apiError(400, 'INVALID_WIKI_ARTICLE_PREVIEW_TOKEN', 'A prévia do artigo não é válida. Gere uma nova prévia.');
    const requestHash = sha256(Buffer.from(token, 'utf8'));
    const key = deterministicIdempotencyKey(token);

    const result = await withStaffTransaction(auth, req, async (tx, actor) => {
      if (payload.actorId !== actor.id) {
        throw apiError(403, 'WIKI_ARTICLE_PREVIEW_ACTOR', 'A prévia foi criada por outra conta da equipe. Gere uma nova prévia.');
      }
      const replay = await findReplay(tx, actor.id, OPERATION, key, requestHash);
      if (replay) return { page: await loadReplayPage(tx, replay.resourceIds), replay: true };

      let current = null;
      if (payload.target.pageId) {
        current = await lockPage(tx, validateUuid(payload.target.pageId, 'targetPageId'));
        if (!sameId(current.head_revision_id, payload.target.headRevisionId)
            || Number(current.work_version) !== payload.target.workVersion
            || !sameNullableId(current.published_revision_id, payload.target.publishedRevisionId)) {
          throw apiError(409, 'WIKI_ARTICLE_FILE_PREVIEW_STALE', 'O artigo mudou desde a prévia. Gere uma nova prévia antes de importar.');
        }
      }
      await lockAndCheckSources(tx, payload.sourceIdentities);
      const targetId = current ? String(current.id).toLowerCase() : randomUUID();
      await assertArticleNamesAvailable(tx, targetId, snapshot);

      let saved;
      if (current) saved = await insertPageRevision(tx, actor, current, { snapshot, citations });
      else saved = await insertNewPage(tx, actor, { snapshot, citations });
      await insertRequestKey(tx, actor.id, OPERATION, key, requestHash, [saved.pageId]);
      return { page: saved.page, replay: false };
    });
    return res.status(result.replay ? 200 : payload.target.pageId ? 200 : 201).json({ data: result });
  }));

  return router;
}

function sameId(left, right) {
  return typeof left === 'string' && typeof right === 'string'
    && left.toLowerCase() === right.toLowerCase();
}

function sameNullableId(left, right) {
  if (left === null || left === undefined) return right === null || right === undefined;
  if (right === null || right === undefined) return false;
  return sameId(String(left), String(right));
}

module.exports = {
  ARTICLE_FILE_MAX_BYTES,
  createWikiArticleFilesRouter,
  deterministicIdempotencyKey,
  parseArticleFileText,
  signPreviewToken,
  verifyPreviewToken,
};
