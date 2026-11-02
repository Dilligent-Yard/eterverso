'use strict';

const express = require('express');
const { createHash, randomUUID } = require('node:crypto');
const { ApiError } = require('./errors');
const { validateWikiSnapshot, normalizeSlug } = require('./wiki');
const { assertObjectShape, expectedVersion, validateUuid } = require('./validation');
const { MAX_SOURCE_BYTES, archiveRelativePath, hash: validateSourceHash } = require('./sources');

const FORMAT = 'AetherverseWikiBundleV1';
const STAFF_DRAFT_SUMMARY = 'Importação de pacote portátil da wiki.';
const HASH_RE = /^[a-f0-9]{64}$/;
const MAX_PAGES = 100;
const MAX_SOURCES = 500;
const MAX_BUNDLE_BYTES = 4 * 1024 * 1024;
const MAX_BUNDLE_CITATIONS = 10_000;
const TRANSFER_LOCK = Object.freeze([1163150674, 1094995284]);

function route(handler) {
  return (req, res, next) => Promise.resolve().then(() => handler(req, res)).catch(next);
}

function apiError(status, code, message) {
  return new ApiError(status, code, message);
}

function hashBytes(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digestJson(value) {
  return hashBytes(Buffer.from(canonicalJson(value), 'utf8'));
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

function boundedText(value, max, nullable = false) {
  if (nullable && (value === null || value === undefined)) return null;
  if (typeof value !== 'string' || Array.from(value).length > max) throw new Error('text');
  return value;
}

function validateHash(value) {
  if (typeof value !== 'string' || !HASH_RE.test(value)) throw new Error('hash');
  return value;
}

function invalidBundle() {
  return apiError(400, 'INVALID_WIKI_BUNDLE', 'O pacote portátil da wiki é inválido ou seu hash não confere.');
}

/** Validate and sanitize the portable representation without retaining actors or account data. */
function validateBundle(value) {
  try {
    if (Buffer.byteLength(canonicalJson(value), 'utf8') > MAX_BUNDLE_BYTES) throw new Error('size');
    assertObjectShape(value, {
      allowedKeys: ['format', 'manifest', 'origin', 'pages', 'sources'],
      requiredKeys: ['format', 'manifest', 'origin', 'pages', 'sources'],
    });
    if (value.format !== FORMAT) throw new Error('format');
    assertObjectShape(value.manifest, {
      allowedKeys: ['version', 'createdAt', 'pageCount', 'sourceCount', 'bundleSha256'],
      requiredKeys: ['version', 'createdAt', 'pageCount', 'sourceCount', 'bundleSha256'],
    });
    if (value.manifest.version !== 1 || typeof value.manifest.createdAt !== 'string'
        || !Number.isFinite(Date.parse(value.manifest.createdAt))) throw new Error('manifest');
    assertObjectShape(value.origin, {
      allowedKeys: ['instanceId', 'siteName'], requiredKeys: ['instanceId', 'siteName'],
    });
    const origin = {
      instanceId: validateUuid(value.origin.instanceId, 'instanceId'),
      siteName: boundedText(value.origin.siteName, 120),
    };
    if (!Array.isArray(value.pages) || value.pages.length < 1 || value.pages.length > MAX_PAGES
        || !Array.isArray(value.sources) || value.sources.length > MAX_SOURCES
        || value.manifest.pageCount !== value.pages.length
        || value.manifest.sourceCount !== value.sources.length) throw new Error('counts');

    const sources = value.sources.map((source) => {
      assertObjectShape(source, {
        allowedKeys: ['sourceId', 'archiveSha256', 'relativePath', 'fileSha256', 'family', 'language', 'declaredVersion', 'declaredDate', 'content'],
        requiredKeys: ['sourceId', 'archiveSha256', 'relativePath', 'fileSha256', 'family', 'language', 'declaredVersion', 'declaredDate', 'content'],
      });
      const content = boundedText(source.content, MAX_SOURCE_BYTES);
      if (Buffer.byteLength(content, 'utf8') > MAX_SOURCE_BYTES) throw new Error('source_size');
      const fileSha256 = validateSourceHash(source.fileSha256);
      if (hashBytes(Buffer.from(content, 'utf8')) !== fileSha256) throw new Error('source_hash');
      return {
        sourceId: validateUuid(source.sourceId, 'sourceId'),
        archiveSha256: validateSourceHash(source.archiveSha256),
        relativePath: archiveRelativePath(source.relativePath),
        fileSha256,
        family: boundedText(source.family, 80),
        language: boundedText(source.language, 20),
        declaredVersion: boundedText(source.declaredVersion, 120, true),
        declaredDate: boundedText(source.declaredDate, 40, true),
        content,
      };
    });
    if (new Set(sources.map((source) => source.sourceId)).size !== sources.length) throw new Error('source_ids');
    if (new Set(sources.map((source) => `${source.archiveSha256}\0${source.relativePath}`)).size !== sources.length) throw new Error('source_paths');

    const sourceIds = new Set(sources.map((source) => source.sourceId));
    const pageIds = new Set();
    const revisionIds = new Set();
    let citationCount = 0;
    const pages = value.pages.map((page) => {
      assertObjectShape(page, {
        allowedKeys: ['sourcePageId', 'sourceRevisionId', 'snapshot', 'citations'],
        requiredKeys: ['sourcePageId', 'sourceRevisionId', 'snapshot', 'citations'],
      });
      const sourcePageId = validateUuid(page.sourcePageId, 'sourcePageId');
      const sourceRevisionId = validateUuid(page.sourceRevisionId, 'sourceRevisionId');
      if (pageIds.has(sourcePageId) || revisionIds.has(sourceRevisionId)) throw new Error('page_ids');
      pageIds.add(sourcePageId);
      revisionIds.add(sourceRevisionId);
      const snapshot = validateWikiSnapshot(page.snapshot);
      if (!Array.isArray(page.citations) || page.citations.length > 10_000) throw new Error('citations');
      citationCount += page.citations.length;
      if (citationCount > MAX_BUNDLE_CITATIONS) throw new Error('citations');
      const sectionIds = new Set(snapshot.body.sections.map((section) => section.id));
      const citations = page.citations.map((citation) => {
        assertObjectShape(citation, {
          allowedKeys: ['sectionId', 'sourceId', 'locator'],
          requiredKeys: ['sectionId', 'sourceId', 'locator'],
        });
        const sectionId = validateUuid(citation.sectionId, 'sectionId');
        const sourceId = validateUuid(citation.sourceId, 'sourceId');
        const locator = boundedText(citation.locator, 500);
        // Retain exact nonblank transfer text for hash/replay compatibility,
        // but never persist a locator that staff detail cannot read safely.
        if (!sectionIds.has(sectionId) || !sourceIds.has(sourceId) || locator.trim().length < 1) throw new Error('citation_ref');
        return { sectionId, sourceId, locator };
      });
      if (new Set(citations.map((citation) => `${citation.sectionId}\0${citation.sourceId}\0${citation.locator}`)).size !== citations.length) {
        throw new Error('citation_duplicate');
      }
      return { sourcePageId, sourceRevisionId, snapshot, citations };
    });

    const referencedSourceIds = new Set(pages.flatMap((page) => page.citations.map((citation) => citation.sourceId)));
    if (referencedSourceIds.size !== sources.length || sources.some((source) => !referencedSourceIds.has(source.sourceId))) {
      throw new Error('source_closure');
    }
    const cleanBundle = {
      format: FORMAT,
      manifest: {
        version: 1,
        createdAt: new Date(value.manifest.createdAt).toISOString(),
        pageCount: pages.length,
        sourceCount: sources.length,
        bundleSha256: validateHash(value.manifest.bundleSha256),
      },
      origin,
      pages,
      sources,
    };
    if (digestJson(bundleHashPayload(cleanBundle)) !== cleanBundle.manifest.bundleSha256) throw new Error('bundle_hash');
    return { bundle: cleanBundle, bundleSha256: cleanBundle.manifest.bundleSha256 };
  } catch {
    throw invalidBundle();
  }
}

function sourceRecord(source) {
  return {
    archiveSha256: source.archiveSha256,
    relativePath: source.relativePath,
    fileSha256: source.fileSha256,
    family: source.family,
    language: source.language,
    declaredVersion: source.declaredVersion,
    declaredDate: source.declaredDate,
    content: source.content,
  };
}

function sourceRecordHash(source) {
  return digestJson(sourceRecord(source));
}

function staffSnapshot(snapshot) {
  return validateWikiSnapshot({ ...snapshot, accessLevel: 'staff' });
}

function snapshotHash(snapshot) {
  return digestJson(snapshot);
}

function canonicalCitations(citations) {
  return citations.map((citation) => ({
    sectionId: citation.sectionId,
    sourceId: citation.sourceId,
    locator: citation.locator,
  })).sort((left, right) => {
    for (const key of ['sectionId', 'sourceId', 'locator']) {
      if (left[key] < right[key]) return -1;
      if (left[key] > right[key]) return 1;
    }
    return 0;
  });
}

function sourcePageIdentityHash(page, targetSnapshot = staffSnapshot(page.snapshot)) {
  return digestJson({
    sourceRevisionId: page.sourceRevisionId,
    snapshot: targetSnapshot,
    citations: canonicalCitations(page.citations),
  });
}

function sameCitations(left, right) {
  return canonicalJson(canonicalCitations(left)) === canonicalJson(canonicalCitations(right));
}

function buildPreviewHash(bundleSha256, preview) {
  return digestJson({ bundleSha256, preview });
}

function pageNames(snapshot) {
  return [snapshot.slug, ...snapshot.aliases].map((name) => normalizeSlug(name));
}

function addConflict(conflicts, resourceType, sourceId, reason) {
  conflicts.push({ resourceType, sourceId, reason });
}

/** Build a content-free preview from current target state. */
async function buildPreview(tx, bundle, bundleSha256) {
  const originId = bundle.origin.instanceId;
  const pageSnapshots = bundle.pages.map((page) => ({ ...page, targetSnapshot: staffSnapshot(page.snapshot) }));
  const allNames = [...new Set(pageSnapshots.flatMap((page) => pageNames(page.targetSnapshot)))];
  const existingNames = new Set();
  if (allNames.length) {
    const named = await tx`SELECT name_key FROM wiki_names WHERE name_key = ANY(${tx.array(allNames, 25)})`;
    for (const row of named) existingNames.add(row.name_key);
  }
  const existingPages = await tx`
    SELECT p.id AS page_id, p.head_revision_id, r.snapshot
    FROM wiki_pages p
    JOIN wiki_revisions r ON r.id = p.head_revision_id AND r.page_id = p.id`;
  const existingPageNames = new Map();
  for (const row of existingPages) {
    let snapshot;
    try { snapshot = validateWikiSnapshot(row.snapshot); } catch { continue; }
    for (const name of pageNames(snapshot)) {
      const targets = existingPageNames.get(name) || new Set();
      targets.add(String(row.page_id).toLowerCase());
      existingPageNames.set(name, targets);
    }
  }

  const pageMappings = pageSnapshots.length ? await tx`
    SELECT m.source_page_id, m.source_revision_id,
           m.source_snapshot_sha256 AS source_page_identity_sha256,
           m.target_page_id, m.target_revision_id, m.target_snapshot_sha256,
           p.head_revision_id, r.snapshot AS target_snapshot
    FROM wiki_transfer_page_mappings m
    LEFT JOIN wiki_pages p ON p.id = m.target_page_id
    LEFT JOIN wiki_revisions r ON r.id = p.head_revision_id AND r.page_id = p.id
    WHERE m.origin_id = ${originId}
      AND m.source_page_id = ANY(${tx.array(pageSnapshots.map((page) => page.sourcePageId), 2950)})` : [];
  const pageMappingById = new Map(pageMappings.map((row) => [String(row.source_page_id).toLowerCase(), row]));
  const pageActions = [];
  const conflicts = [];
  const selectedTargetNames = new Map();
  for (const page of pageSnapshots) {
    const sourcePageId = page.sourcePageId;
    const contentHash = snapshotHash(page.targetSnapshot);
    const sourcePageHash = sourcePageIdentityHash(page, page.targetSnapshot);
    const mapping = pageMappingById.get(sourcePageId);
    let action = 'create';
    let reason;
    let targetPageId;
    if (mapping) {
      targetPageId = String(mapping.target_page_id).toLowerCase();
      if (String(mapping.source_revision_id).toLowerCase() !== page.sourceRevisionId) {
        action = 'conflict';
        reason = 'source_revision_changed';
      } else if (mapping.source_page_identity_sha256 !== sourcePageHash) {
        action = 'conflict';
        reason = 'source_page_changed';
      } else if (!mapping.head_revision_id
          || String(mapping.head_revision_id).toLowerCase() !== String(mapping.target_revision_id).toLowerCase()
          || !mapping.target_snapshot
          || snapshotHash(staffSnapshot(mapping.target_snapshot)) !== mapping.target_snapshot_sha256) {
        action = 'conflict';
        reason = 'target_changed';
      } else {
        action = 'reuse';
      }
    } else {
      const idCollision = await tx`SELECT id FROM wiki_pages WHERE id = ${sourcePageId} LIMIT 1`;
      if (idCollision.length) {
        action = 'conflict';
        reason = 'page_id_collision';
      }
      for (const name of pageNames(page.targetSnapshot)) {
        const selectedOwner = selectedTargetNames.get(name);
        const existingOwners = existingPageNames.get(name) || new Set();
        if (existingNames.has(name) || (selectedOwner && selectedOwner !== sourcePageId)
            || [...existingOwners].some((id) => id !== targetPageId)) {
          action = 'conflict';
          reason = reason || 'slug_collision';
        }
        selectedTargetNames.set(name, sourcePageId);
      }
    }
    if (action === 'conflict') addConflict(conflicts, 'page', sourcePageId, reason);
    pageActions.push({
      sourcePageId,
      sourceRevisionId: page.sourceRevisionId,
      slug: page.targetSnapshot.slug,
      title: page.targetSnapshot.title,
      action,
      ...(reason ? { reason } : {}),
      ...(targetPageId ? { targetPageId } : {}),
      requiredSourceIds: [...new Set(page.citations.map((citation) => citation.sourceId))].sort(),
      snapshotSha256: contentHash,
    });
  }

  const sourceMappings = bundle.sources.length ? await tx`
    SELECT source_source_id, source_record_sha256, target_source_id,
           s.archive_sha256, s.relative_path, s.file_sha256, s.family, s.language,
           s.declared_version, s.declared_date, s.content
    FROM wiki_transfer_source_mappings m
    LEFT JOIN wiki_sources s ON s.id = m.target_source_id
    WHERE m.origin_id = ${originId}
      AND m.source_source_id = ANY(${tx.array(bundle.sources.map((source) => source.sourceId), 2950)})` : [];
  const sourceMappingById = new Map(sourceMappings.map((row) => [String(row.source_source_id).toLowerCase(), row]));
  const sourceActions = [];
  for (const source of bundle.sources) {
    const mapped = sourceMappingById.get(source.sourceId);
    const recordHash = sourceRecordHash(source);
    let action = 'create';
    let reason;
    let targetSourceId;
    if (mapped) {
      targetSourceId = mapped.target_source_id ? String(mapped.target_source_id).toLowerCase() : undefined;
      if (mapped.source_record_sha256 !== recordHash || !targetSourceId
          || sourceRecordHash({
            archiveSha256: mapped.archive_sha256,
            relativePath: mapped.relative_path,
            fileSha256: mapped.file_sha256,
            family: mapped.family,
            language: mapped.language,
            declaredVersion: mapped.declared_version,
            declaredDate: mapped.declared_date,
            content: mapped.content,
          }) !== recordHash) {
        action = 'conflict';
        reason = 'source_changed';
      } else action = 'reuse';
    } else {
      const matchingRows = await tx`
        SELECT id, archive_sha256, relative_path, file_sha256, family, language,
               declared_version, declared_date, content
        FROM wiki_sources WHERE archive_sha256 = ${source.archiveSha256}
          AND relative_path = ${source.relativePath} LIMIT 1`;
      if (matchingRows.length) {
        const row = matchingRows[0];
        const existingHash = sourceRecordHash({
          archiveSha256: row.archive_sha256,
          relativePath: row.relative_path,
          fileSha256: row.file_sha256,
          family: row.family,
          language: row.language,
          declaredVersion: row.declared_version,
          declaredDate: row.declared_date,
          content: row.content,
        });
        if (existingHash === recordHash) {
          action = 'reuse';
          targetSourceId = String(row.id).toLowerCase();
        } else {
          action = 'conflict';
          reason = 'source_collision';
        }
      }
    }
    if (action === 'conflict') addConflict(conflicts, 'source', source.sourceId, reason);
    const citedByPageIds = bundle.pages
      .filter((page) => page.citations.some((citation) => citation.sourceId === source.sourceId))
      .map((page) => page.sourcePageId).sort();
    sourceActions.push({
      sourceSourceId: source.sourceId,
      archiveSha256: source.archiveSha256,
      relativePath: source.relativePath,
      sha256: source.fileSha256,
      action,
      ...(reason ? { reason } : {}),
      ...(targetSourceId ? { targetSourceId } : {}),
      citedByPageIds,
      sourceRecordSha256: recordHash,
    });
  }

  const reusableSourceIds = new Map(sourceActions.map((source) => [source.sourceSourceId, source.targetSourceId]));
  const replayPages = pageActions.filter((page) => page.action === 'reuse');
  const replayRevisionIds = replayPages
    .map((page) => pageMappingById.get(page.sourcePageId)?.target_revision_id)
    .filter(Boolean);
  if (replayRevisionIds.length) {
    const citationRows = await tx`
      SELECT revision_id, section_id, source_id, locator
      FROM wiki_revision_citations
      WHERE revision_id = ANY(${tx.array(replayRevisionIds, 2950)})
      ORDER BY revision_id, section_id, source_id, locator`;
    const citationsByRevision = new Map();
    for (const row of citationRows) {
      const revisionId = String(row.revision_id).toLowerCase();
      const citations = citationsByRevision.get(revisionId) || [];
      citations.push({
        sectionId: String(row.section_id).toLowerCase(),
        sourceId: String(row.source_id).toLowerCase(),
        locator: row.locator,
      });
      citationsByRevision.set(revisionId, citations);
    }
    for (const action of replayPages) {
      const mapping = pageMappingById.get(action.sourcePageId);
      const page = pageSnapshots.find((item) => item.sourcePageId === action.sourcePageId);
      const expected = page.citations.map((citation) => {
        const targetSourceId = reusableSourceIds.get(citation.sourceId);
        return targetSourceId ? { ...citation, sourceId: targetSourceId } : null;
      });
      if (expected.some((citation) => !citation)) continue;
      const actual = citationsByRevision.get(String(mapping.target_revision_id).toLowerCase()) || [];
      if (!sameCitations(actual, expected)) {
        action.action = 'conflict';
        action.reason = 'target_changed';
        addConflict(conflicts, 'page', action.sourcePageId, 'target_changed');
      }
    }
  }

  const preview = {
    bundleId: bundle.origin.instanceId,
    status: conflicts.length ? 'conflict' : 'ready',
    pageCounts: { total: pageActions.length, create: pageActions.filter((item) => item.action === 'create').length, reuse: pageActions.filter((item) => item.action === 'reuse').length, conflict: pageActions.filter((item) => item.action === 'conflict').length },
    sourceCounts: { total: sourceActions.length, create: sourceActions.filter((item) => item.action === 'create').length, reuse: sourceActions.filter((item) => item.action === 'reuse').length, conflict: sourceActions.filter((item) => item.action === 'conflict').length },
    pages: pageActions,
    sources: sourceActions,
    conflicts,
  };
  const planHash = buildPreviewHash(bundleSha256, preview);
  return { preview: { ...preview, planHash }, planHash };
}

function publicPreview(row) {
  return {
    id: String(row.id).toLowerCase(),
    version: Number(row.preview_version),
    planHash: row.preview_sha256,
    preview: row.preview,
    state: row.state,
  };
}

function validateSelection(body) {
  assertObjectShape(body, {
    allowedKeys: ['expectedVersion', 'planHash', 'pageIds', 'sourceIds'],
    requiredKeys: ['expectedVersion', 'planHash', 'pageIds', 'sourceIds'],
  });
  const version = expectedVersion(body.expectedVersion);
  const planHash = validateHash(body.planHash);
  if (!Array.isArray(body.pageIds) || body.pageIds.length < 1 || body.pageIds.length > MAX_PAGES
      || !Array.isArray(body.sourceIds) || body.sourceIds.length > MAX_SOURCES) {
    throw apiError(400, 'INVALID_WIKI_TRANSFER_SELECTION', 'A seleção do pacote portátil é inválida.');
  }
  let pageIds;
  let sourceIds;
  try {
    pageIds = body.pageIds.map((id) => validateUuid(id, 'pageId'));
    sourceIds = body.sourceIds.map((id) => validateUuid(id, 'sourceId'));
  } catch {
    throw apiError(400, 'INVALID_WIKI_TRANSFER_SELECTION', 'A seleção do pacote portátil é inválida.');
  }
  if (new Set(pageIds).size !== pageIds.length || new Set(sourceIds).size !== sourceIds.length) {
    throw apiError(400, 'INVALID_WIKI_TRANSFER_SELECTION', 'A seleção do pacote portátil é inválida.');
  }
  return { version, planHash, pageIds, sourceIds };
}

function assertCitationClosure(bundle, pageIds, sourceIds) {
  const pageSet = new Set(pageIds);
  const selectedPages = bundle.pages.filter((page) => pageSet.has(page.sourcePageId));
  if (selectedPages.length !== pageIds.length) throw apiError(400, 'INVALID_WIKI_TRANSFER_SELECTION', 'A seleção do pacote portátil é inválida.');
  const required = [...new Set(selectedPages.flatMap((page) => page.citations.map((citation) => citation.sourceId)))].sort();
  if (required.length !== sourceIds.length || required.some((id, index) => id !== [...sourceIds].sort()[index])) {
    throw apiError(400, 'WIKI_TRANSFER_SOURCE_CLOSURE', 'Selecione exatamente as fontes citadas pelos artigos escolhidos.');
  }
  return selectedPages;
}

async function lockTransfers(tx) {
  await tx`SELECT pg_advisory_xact_lock(${TRANSFER_LOCK[0]}, ${TRANSFER_LOCK[1]})`;
}

async function setRepeatableRead(tx) {
  await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`;
}

async function writeTransferAudit(tx, actorId, jobId, bundleSha256, pageCount, sourceCount) {
  await tx`
    INSERT INTO audit_events
      (actor_id, action, target_type, target_id, reason, before_state, after_state)
    VALUES (${actorId}, 'admin.wiki_transfer.commit', 'wiki_transfer_job', ${jobId},
      'Importação de pacote portátil da wiki concluída.',
      ${tx.json({ state: 'staged' })},
      ${tx.json({ state: 'committed', bundleSha256, pageCount, sourceCount })})`;
}

async function getInstanceId(tx) {
  const rows = await tx`
    INSERT INTO wiki_transfer_instances (singleton, instance_id)
    VALUES (true, ${randomUUID()})
    ON CONFLICT (singleton) DO UPDATE SET singleton = EXCLUDED.singleton
    RETURNING instance_id`;
  return String(rows[0].instance_id).toLowerCase();
}

async function createBundle(tx, ids) {
  const pagesRows = await tx`
    SELECT p.id AS source_page_id, head.id AS source_revision_id
    FROM wiki_pages p
    JOIN wiki_revisions head ON head.id = p.head_revision_id AND head.page_id = p.id
    WHERE p.id = ANY(${tx.array(ids, 2950)})
    ORDER BY p.id`;
  if (pagesRows.length !== ids.length) throw apiError(404, 'WIKI_PAGE_NOT_FOUND', 'Um ou mais artigos não possuem uma revisão de trabalho exportável.');
  const revisionIds = pagesRows.map((row) => String(row.source_revision_id).toLowerCase());
  const sizes = await tx`
    SELECT COALESCE(sum(octet_length(head.snapshot::text)), 0)::bigint AS snapshot_bytes
    FROM wiki_pages p JOIN wiki_revisions head ON head.id = p.head_revision_id AND head.page_id = p.id
    WHERE p.id = ANY(${tx.array(ids, 2950)})`;
  if (Number(sizes[0].snapshot_bytes) > MAX_BUNDLE_BYTES) {
    throw apiError(413, 'WIKI_BUNDLE_TOO_LARGE', 'O pacote portátil excede o limite de quatro MiB.');
  }
  const citationCountRows = await tx`
    SELECT count(*)::bigint AS count FROM wiki_revision_citations
    WHERE revision_id = ANY(${tx.array(revisionIds, 2950)})`;
  if (Number(citationCountRows[0].count) > MAX_BUNDLE_CITATIONS) {
    throw apiError(413, 'WIKI_BUNDLE_TOO_LARGE', 'O pacote portátil contém referências demais.');
  }
  const citationsRows = await tx`
    SELECT c.revision_id, c.section_id, c.source_id, c.locator
    FROM wiki_revision_citations c
    WHERE c.revision_id = ANY(${tx.array(revisionIds, 2950)})
    ORDER BY c.revision_id, c.section_id, c.source_id, c.locator`;
  const citationsByRevision = new Map();
  for (const row of citationsRows) {
    const revisionId = String(row.revision_id).toLowerCase();
    const citations = citationsByRevision.get(revisionId) || [];
    citations.push({
      sectionId: String(row.section_id).toLowerCase(),
      sourceId: String(row.source_id).toLowerCase(),
      locator: row.locator,
    });
    citationsByRevision.set(revisionId, citations);
  }
  const sourceIds = [...new Set(citationsRows.map((row) => String(row.source_id).toLowerCase()))].sort();
  const sourceSizes = sourceIds.length ? await tx`
    SELECT COALESCE(sum(octet_length(to_json(content)::text)), 0)::bigint AS source_bytes
    FROM wiki_sources WHERE id = ANY(${tx.array(sourceIds, 2950)})` : [{ source_bytes: 0 }];
  if (Number(sourceSizes[0].source_bytes) + Number(sizes[0].snapshot_bytes) > MAX_BUNDLE_BYTES) {
    throw apiError(413, 'WIKI_BUNDLE_TOO_LARGE', 'O pacote portátil excede o limite de quatro MiB.');
  }
  const sourcesRows = sourceIds.length ? await tx`
    SELECT id, archive_sha256, relative_path, file_sha256, family, language,
           declared_version, declared_date, content
    FROM wiki_sources WHERE id = ANY(${tx.array(sourceIds, 2950)}) ORDER BY relative_path, id` : [];
  if (sourcesRows.length !== sourceIds.length) throw apiError(409, 'WIKI_TRANSFER_SOURCE_MISSING', 'Uma fonte citada não está disponível para exportação.');
  const snapshotRows = await tx`
    SELECT p.id AS source_page_id, head.snapshot
    FROM wiki_pages p
    JOIN wiki_revisions head ON head.id = p.head_revision_id AND head.page_id = p.id
    WHERE p.id = ANY(${tx.array(ids, 2950)})
    ORDER BY p.id`;
  const snapshotsByPage = new Map(snapshotRows.map((row) => [String(row.source_page_id).toLowerCase(), row.snapshot]));
  const pages = pagesRows.map((row) => ({
    sourcePageId: String(row.source_page_id).toLowerCase(),
    sourceRevisionId: String(row.source_revision_id).toLowerCase(),
    snapshot: validateWikiSnapshot(snapshotsByPage.get(String(row.source_page_id).toLowerCase())),
    citations: citationsByRevision.get(String(row.source_revision_id).toLowerCase()) || [],
  }));
  const sources = sourcesRows.map((row) => {
    if (typeof row.content !== 'string' || Buffer.byteLength(row.content, 'utf8') > MAX_SOURCE_BYTES) {
      throw apiError(409, 'WIKI_TRANSFER_SOURCE_INVALID', 'Uma fonte citada não pode ser incluída no pacote.');
    }
    const source = {
      sourceId: String(row.id).toLowerCase(),
      archiveSha256: row.archive_sha256,
      relativePath: row.relative_path,
      fileSha256: row.file_sha256,
      family: row.family,
      language: row.language,
      declaredVersion: row.declared_version,
      declaredDate: row.declared_date,
      content: row.content,
    };
    if (hashBytes(Buffer.from(source.content, 'utf8')) !== source.fileSha256) {
      throw apiError(409, 'WIKI_TRANSFER_SOURCE_INVALID', 'Uma fonte citada não pode ser incluída no pacote.');
    }
    return source;
  });
  const manifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    pageCount: pages.length,
    sourceCount: sources.length,
    bundleSha256: '0'.repeat(64),
  };
  const bundle = {
    format: FORMAT,
    manifest,
    origin: { instanceId: await getInstanceId(tx), siteName: 'aetherverse vault' },
    pages,
    sources,
  };
  bundle.manifest.bundleSha256 = digestJson(bundleHashPayload(bundle));
  if (Buffer.byteLength(canonicalJson(bundle), 'utf8') > MAX_BUNDLE_BYTES) {
    throw apiError(413, 'WIKI_BUNDLE_TOO_LARGE', 'O pacote portátil excede o limite de quatro MiB.');
  }
  try {
    return validateBundle(bundle).bundle;
  } catch {
    throw apiError(409, 'WIKI_TRANSFER_STORED_DATA_INVALID', 'Os dados armazenados não formam um pacote portátil válido. Revise as fontes e citações do artigo.');
  }
}

async function loadJob(tx, id, lock = false) {
  const rows = lock ? await tx`
    SELECT id, created_by, bundle_sha256, bundle, preview, preview_version, preview_sha256,
           state, commit_result
    FROM wiki_transfer_jobs WHERE id = ${id} FOR UPDATE` : await tx`
    SELECT id, created_by, bundle_sha256, bundle, preview, preview_version, preview_sha256,
           state, commit_result
    FROM wiki_transfer_jobs WHERE id = ${id} LIMIT 1`;
  if (!rows.length) throw apiError(404, 'NOT_FOUND', 'O pacote solicitado não foi encontrado.');
  return rows[0];
}

function assertPreviewVersion(job, selection) {
  if (Number(job.preview_version) !== selection.version || job.preview_sha256 !== selection.planHash) {
    throw apiError(409, 'WIKI_TRANSFER_PREVIEW_STALE', 'A prévia mudou. Atualize antes de confirmar a importação.');
  }
}

function selectionResultMatches(result, selection) {
  return result && Array.isArray(result.pageIds) && Array.isArray(result.sourceIds)
    && result.pageIds.length === selection.pageIds.length
    && result.sourceIds.length === selection.sourceIds.length
    && [...result.pageIds].sort().every((id, index) => id === [...selection.pageIds].sort()[index])
    && [...result.sourceIds].sort().every((id, index) => id === [...selection.sourceIds].sort()[index]);
}

async function commitImport(tx, actor, job, selection, pages) {
  const bundle = job.bundle;
  const originId = bundle.origin.instanceId;
  const pageTargets = new Map();
  const sourceTargets = new Map();
  const sourceRows = new Map(bundle.sources.map((source) => [source.sourceId, source]));

  for (const sourceId of selection.sourceIds) {
    const source = sourceRows.get(sourceId);
    const rows = await tx`
      SELECT m.target_source_id, m.source_record_sha256,
             s.archive_sha256, s.relative_path, s.file_sha256, s.family, s.language,
             s.declared_version, s.declared_date, s.content
      FROM wiki_transfer_source_mappings m
      LEFT JOIN wiki_sources s ON s.id = m.target_source_id
      WHERE m.origin_id = ${originId} AND m.source_source_id = ${sourceId} FOR UPDATE OF m`;
    let targetId;
    if (rows.length) {
      const row = rows[0];
      if (!row.target_source_id || row.source_record_sha256 !== sourceRecordHash(source)
          || sourceRecordHash({
            archiveSha256: row.archive_sha256,
            relativePath: row.relative_path,
            fileSha256: row.file_sha256,
            family: row.family,
            language: row.language,
            declaredVersion: row.declared_version,
            declaredDate: row.declared_date,
            content: row.content,
          }) !== sourceRecordHash(source)) {
        throw apiError(409, 'WIKI_TRANSFER_CONFLICT', 'Uma fonte mudou depois da prévia. Atualize e revise os conflitos.');
      }
      targetId = String(row.target_source_id).toLowerCase();
    } else {
      const existing = await tx`
        SELECT id, file_sha256, family, language, declared_version, declared_date, content
        FROM wiki_sources WHERE archive_sha256 = ${source.archiveSha256}
          AND relative_path = ${source.relativePath} FOR UPDATE`;
      if (existing.length) {
        const row = existing[0];
        const existingHash = sourceRecordHash({
          archiveSha256: source.archiveSha256,
          relativePath: source.relativePath,
          fileSha256: row.file_sha256,
          family: row.family,
          language: row.language,
          declaredVersion: row.declared_version,
          declaredDate: row.declared_date,
          content: row.content,
        });
        if (existingHash !== sourceRecordHash(source)) {
          throw apiError(409, 'WIKI_TRANSFER_CONFLICT', 'Uma fonte colidiu com um registro existente. Atualize e revise os conflitos.');
        }
        targetId = String(row.id).toLowerCase();
      } else {
        const created = await tx`
          INSERT INTO wiki_sources
            (archive_sha256, relative_path, file_sha256, family, language,
             declared_version, declared_date, content, imported_by)
          VALUES (${source.archiveSha256}, ${source.relativePath}, ${source.fileSha256},
             ${source.family}, ${source.language}, ${source.declaredVersion},
             ${source.declaredDate}, ${source.content}, ${actor.id})
          RETURNING id`;
        targetId = String(created[0].id).toLowerCase();
      }
      await tx`
        INSERT INTO wiki_transfer_source_mappings
          (origin_id, source_source_id, source_record_sha256, target_source_id)
        VALUES (${originId}, ${sourceId}, ${sourceRecordHash(source)}, ${targetId})`;
    }
    sourceTargets.set(sourceId, targetId);
  }

  for (const sourcePage of pages) {
    const targetSnapshot = staffSnapshot(sourcePage.snapshot);
    const expectedSnapshotHash = snapshotHash(targetSnapshot);
    const expectedSourcePageHash = sourcePageIdentityHash(sourcePage, targetSnapshot);
    const mappings = await tx`
      SELECT m.source_revision_id, m.source_snapshot_sha256 AS source_page_identity_sha256,
             m.target_page_id, m.target_revision_id,
             m.target_snapshot_sha256, p.head_revision_id, head.snapshot
      FROM wiki_transfer_page_mappings m
      LEFT JOIN wiki_pages p ON p.id = m.target_page_id
      LEFT JOIN wiki_revisions head ON head.id = p.head_revision_id AND head.page_id = p.id
      WHERE m.origin_id = ${originId} AND m.source_page_id = ${sourcePage.sourcePageId} FOR UPDATE OF m`;
    if (mappings.length) {
      const mapping = mappings[0];
      if (String(mapping.source_revision_id).toLowerCase() !== sourcePage.sourceRevisionId
          || mapping.source_page_identity_sha256 !== expectedSourcePageHash
          || String(mapping.head_revision_id || '').toLowerCase() !== String(mapping.target_revision_id).toLowerCase()
          || !mapping.snapshot
          || snapshotHash(staffSnapshot(mapping.snapshot)) !== mapping.target_snapshot_sha256) {
        throw apiError(409, 'WIKI_TRANSFER_CONFLICT', 'Um artigo importado mudou depois da prévia. Atualize e revise os conflitos.');
      }
      const targetCitations = await tx`
        SELECT section_id, source_id, locator FROM wiki_revision_citations
        WHERE revision_id = ${mapping.target_revision_id}
        ORDER BY section_id, source_id, locator`;
      const expectedCitations = sourcePage.citations.map((citation) => {
        const targetSourceId = sourceTargets.get(citation.sourceId);
        return targetSourceId ? { ...citation, sourceId: targetSourceId } : null;
      });
      const actualCitations = targetCitations.map((citation) => ({
        sectionId: String(citation.section_id).toLowerCase(),
        sourceId: String(citation.source_id).toLowerCase(),
        locator: citation.locator,
      }));
      if (expectedCitations.some((citation) => !citation) || !sameCitations(actualCitations, expectedCitations)) {
        throw apiError(409, 'WIKI_TRANSFER_CONFLICT', 'As citações do artigo importado mudaram. Atualize e revise os conflitos.');
      }
      pageTargets.set(sourcePage.sourcePageId, String(mapping.target_page_id).toLowerCase());
      continue;
    }
    const pageId = randomUUID();
    const revisionId = randomUUID();
    const createdPage = await tx`
      INSERT INTO wiki_pages (id, created_by, access_level)
      VALUES (${pageId}, ${actor.id}, 'staff') RETURNING id`;
    if (!createdPage.length) throw new Error('Wiki transfer page insert failed.');
    const revisionRows = await tx`
      INSERT INTO wiki_revisions
        (id, page_id, sequence, actor_id, edit_summary, snapshot)
      VALUES (${revisionId}, ${pageId}, 1, ${actor.id}, ${STAFF_DRAFT_SUMMARY}, ${tx.json(targetSnapshot)})
      RETURNING id`;
    await tx`UPDATE wiki_pages SET head_revision_id = ${revisionRows[0].id}, updated_at = now() WHERE id = ${pageId}`;
    for (const category of targetSnapshot.categories) {
      await tx`
        INSERT INTO wiki_revision_categories (revision_id, category, category_key)
        VALUES (${revisionId}, ${category}, ${normalizeSlug(category, 'category')})`;
    }
    // Reuse the wiki module's extracted link shape while keeping transfer pages unpublished.
    const { extractWikiLinks } = require('./wiki');
    for (const link of extractWikiLinks(targetSnapshot)) {
      await tx`
        INSERT INTO wiki_revision_links (revision_id, target_name_key, target_anchor)
        VALUES (${revisionId}, ${link.targetNameKey}, ${link.targetAnchor})`;
    }
    for (const citation of sourcePage.citations) {
      const targetSourceId = sourceTargets.get(citation.sourceId);
      if (!targetSourceId) throw apiError(409, 'WIKI_TRANSFER_SOURCE_CLOSURE', 'Uma fonte citada não está incluída na seleção.');
      await tx`
        INSERT INTO wiki_revision_citations (revision_id, section_id, source_id, locator)
        VALUES (${revisionId}, ${citation.sectionId}, ${targetSourceId}, ${citation.locator})`;
    }
    await tx`
      INSERT INTO wiki_transfer_page_mappings
        (origin_id, source_page_id, source_revision_id, source_snapshot_sha256,
         target_page_id, target_revision_id, target_snapshot_sha256)
      VALUES (${originId}, ${sourcePage.sourcePageId}, ${sourcePage.sourceRevisionId},
        ${expectedSourcePageHash}, ${pageId}, ${revisionId}, ${expectedSnapshotHash})`;
    pageTargets.set(sourcePage.sourcePageId, pageId);
  }

  return {
    pageIds: [...selection.pageIds].sort(),
    sourceIds: [...selection.sourceIds].sort(),
    pages: [...pageTargets].map(([sourcePageId, targetPageId]) => ({ sourcePageId, targetPageId })),
    sources: [...sourceTargets].map(([sourceSourceId, targetSourceId]) => ({ sourceSourceId, targetSourceId })),
  };
}

/** Mount under `/api/admin/wiki-transfers`; every route requires an active admin. */
function createWikiTransfersRouter({ sql, auth } = {}) {
  if (typeof sql !== 'function' || typeof sql.begin !== 'function') throw new TypeError('createWikiTransfersRouter requires the injected postgres client.');
  for (const method of ['requireIdentity', 'requireRole', 'assertRole', 'withActorTransaction']) {
    if (!auth || typeof auth[method] !== 'function') throw new TypeError(`createWikiTransfersRouter requires auth.${method}.`);
  }

  const router = express.Router();
  router.use(auth.requireIdentity, auth.requireRole('admin'));
  const withAdmin = (req, callback, options) => auth.withActorTransaction(req, async (tx, actor) => {
    auth.assertRole(actor, 'admin');
    return callback(tx, actor);
  }, options);

  router.post('/export', route(async (req, res) => {
    assertObjectShape(req.body, { allowedKeys: ['pageIds'], requiredKeys: ['pageIds'] });
    if (!Array.isArray(req.body.pageIds) || req.body.pageIds.length < 1 || req.body.pageIds.length > MAX_PAGES) {
      throw apiError(400, 'INVALID_WIKI_TRANSFER_SELECTION', 'Selecione entre um e cem artigos para exportar.');
    }
    let ids;
    try { ids = req.body.pageIds.map((id) => validateUuid(id, 'pageId')); } catch {
      throw apiError(400, 'INVALID_WIKI_TRANSFER_SELECTION', 'A seleção do pacote portátil é inválida.');
    }
    if (new Set(ids).size !== ids.length) throw apiError(400, 'INVALID_WIKI_TRANSFER_SELECTION', 'A seleção do pacote portátil é inválida.');
    const bundle = await withAdmin(req, async (tx) => createBundle(tx, ids), {
      beforeActorLock: setRepeatableRead,
    });
    res.status(200)
      .set('Content-Type', 'application/json; charset=utf-8')
      .set('Content-Disposition', 'attachment; filename="aetherverse-wiki-bundle-v1.json"')
      .send(JSON.stringify(bundle));
  }));

  router.post('/imports', route(async (req, res) => {
    assertObjectShape(req.body, { allowedKeys: ['bundle'], requiredKeys: ['bundle'] });
    const { bundle, bundleSha256 } = validateBundle(req.body.bundle);
    const staged = await withAdmin(req, async (tx, actor) => {
      const existing = await tx`
        SELECT id, preview, preview_version, preview_sha256, state
        FROM wiki_transfer_jobs WHERE bundle_sha256 = ${bundleSha256} LIMIT 1`;
      if (existing.length) return publicPreview(existing[0]);
      const { preview, planHash } = await buildPreview(tx, bundle, bundleSha256);
      const rows = await tx`
        INSERT INTO wiki_transfer_jobs
          (created_by, bundle_sha256, bundle, preview, preview_version, preview_sha256, state)
        VALUES (${actor.id}, ${bundleSha256}, ${tx.json(bundle)}, ${tx.json(preview)}, 1, ${planHash}, 'staged')
        ON CONFLICT (bundle_sha256) DO NOTHING
        RETURNING id, preview, preview_version, preview_sha256, state`;
      if (rows.length) return publicPreview(rows[0]);
      const replay = await tx`
        SELECT id, preview, preview_version, preview_sha256, state
        FROM wiki_transfer_jobs WHERE bundle_sha256 = ${bundleSha256} LIMIT 1`;
      if (!replay.length) throw new Error('Wiki transfer job insert failed.');
      return publicPreview(replay[0]);
    });
    return res.status(201).json({ data: staged });
  }));

  router.get('/imports/:id', route(async (req, res) => {
    const id = validateUuid(req.params.id);
    const row = await withAdmin(req, async (tx) => loadJob(tx, id));
    return res.json({ data: publicPreview(row) });
  }));

  router.post('/imports/:id/refresh', route(async (req, res) => {
    const id = validateUuid(req.params.id);
    if (req.body !== undefined) assertObjectShape(req.body, { allowedKeys: [] });
    const refreshed = await withAdmin(req, async (tx) => {
      const job = await loadJob(tx, id, true);
      if (job.state === 'committed') {
        throw apiError(409, 'WIKI_TRANSFER_ALREADY_COMMITTED', 'Este pacote já foi confirmado e não pode ter a prévia atualizada.');
      }
      const { preview, planHash } = await buildPreview(tx, job.bundle, job.bundle_sha256);
      if (planHash === job.preview_sha256) return publicPreview(job);
      const rows = await tx`
        UPDATE wiki_transfer_jobs SET preview = ${tx.json(preview)},
          preview_version = preview_version + 1, preview_sha256 = ${planHash}, updated_at = now()
        WHERE id = ${id}
        RETURNING id, preview, preview_version, preview_sha256, state`;
      if (!rows.length) throw apiError(404, 'NOT_FOUND', 'O pacote solicitado não foi encontrado.');
      return publicPreview(rows[0]);
    }, { beforeActorLock: lockTransfers });
    return res.json({ data: refreshed });
  }));

  router.post('/imports/:id/commit', route(async (req, res) => {
    const id = validateUuid(req.params.id);
    const selection = validateSelection(req.body);
    const result = await withAdmin(req, async (tx, actor) => {
      const job = await loadJob(tx, id, true);
      assertPreviewVersion(job, selection);
      if (job.state === 'committed') {
        if (!selectionResultMatches(job.commit_result, selection)) {
          return { status: 409, body: { error: 'Este pacote já foi confirmado com outra seleção.', code: 'WIKI_TRANSFER_ALREADY_COMMITTED' } };
        }
        return { status: 200, body: { data: { ...job.commit_result, replay: true } } };
      }
      const { preview: freshPreview, planHash: freshHash } = await buildPreview(tx, job.bundle, job.bundle_sha256);
      if (freshHash !== job.preview_sha256) {
        const nextVersion = Number(job.preview_version) + 1;
        await tx`
          UPDATE wiki_transfer_jobs SET preview = ${tx.json(freshPreview)}, preview_version = ${nextVersion},
            preview_sha256 = ${freshHash}, updated_at = now() WHERE id = ${id}`;
        return { status: 409, body: { error: 'O estado de destino mudou. Atualize a prévia antes de confirmar.', code: 'WIKI_TRANSFER_PREVIEW_STALE' } };
      }
      const selectedPages = assertCitationClosure(job.bundle, selection.pageIds, selection.sourceIds);
      const previewPageById = new Map(job.preview.pages.map((page) => [page.sourcePageId, page]));
      const previewSourceById = new Map(job.preview.sources.map((source) => [source.sourceSourceId, source]));
      const selectedConflicts = [
        ...selection.pageIds.map((sourceId) => previewPageById.get(sourceId)).filter((page) => page?.action === 'conflict'),
        ...selection.sourceIds.map((sourceId) => previewSourceById.get(sourceId)).filter((source) => source?.action === 'conflict'),
      ];
      if (selectedConflicts.length) {
        return { status: 409, body: { error: 'A prévia contém conflitos nos itens selecionados.', code: 'WIKI_TRANSFER_CONFLICT', conflicts: selectedConflicts.map(({ sourcePageId, sourceSourceId, reason }) => ({ sourceId: sourcePageId || sourceSourceId, reason })) } };
      }
      const selectedBundle = {
        ...job.bundle,
        pages: selectedPages,
        sources: job.bundle.sources.filter((source) => selection.sourceIds.includes(source.sourceId)),
      };
      const commit = await commitImport(tx, actor, { ...job, bundle: selectedBundle }, selection, selectedPages);
      const savedResult = { ...commit, pageIds: [...selection.pageIds].sort(), sourceIds: [...selection.sourceIds].sort(), replay: false };
      await tx`
        UPDATE wiki_transfer_jobs SET state = 'committed', commit_result = ${tx.json(savedResult)},
          committed_at = now(), updated_at = now() WHERE id = ${id}`;
      await writeTransferAudit(tx, actor.id, id, job.bundle_sha256, selection.pageIds.length, selection.sourceIds.length);
      return { status: 200, body: { data: savedResult } };
    }, { beforeActorLock: lockTransfers });
    return res.status(result.status).json(result.body);
  }));

  return router;
}

module.exports = {
  FORMAT,
  buildPreview,
  canonicalJson,
  createWikiArticleBundle: (tx, pageId) => createBundle(tx, [validateUuid(pageId, 'pageId')]),
  createWikiTransfersRouter,
  digestJson,
  validateBundle,
};
