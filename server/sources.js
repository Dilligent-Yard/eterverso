'use strict';

const express = require('express');
const { createHash } = require('node:crypto');
const { ApiError } = require('./errors');
const { assertObjectShape, paginationParams, validateUuid } = require('./validation');

const STAFF_ROLES = ['moderador', 'admin'];
const HASH_RE = /^[a-f0-9]{64}$/;
const MAX_SOURCE_BYTES = 10 * 1024 * 1024;

function route(handler) {
  return (req, res, next) => Promise.resolve().then(() => handler(req, res)).catch(next);
}

function invalidStoredRecord() {
  // Stored source metadata is private input. Never echo malformed values in an
  // API error, even when an operator or an import process inserted them.
  return new TypeError('Invalid wiki source record.');
}

function archiveRelativePath(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 1000
      || value.startsWith('/') || value.includes('\\') || value.includes(':')
      || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw invalidStoredRecord();
  }
  const segments = value.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw invalidStoredRecord();
  }
  return value;
}

function hash(value) {
  if (typeof value !== 'string' || !HASH_RE.test(value)) throw invalidStoredRecord();
  return value;
}

function optionalText(value, max) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || Array.from(value).length > max) throw invalidStoredRecord();
  return value;
}

function sourceManifestDto(row) {
  if (typeof row.family !== 'string' || Array.from(row.family).length > 80
      || typeof row.language !== 'string' || Array.from(row.language).length > 20) {
    throw invalidStoredRecord();
  }
  return {
    id: validateUuid(row.id),
    archiveSha256: hash(row.archive_sha256),
    relativePath: archiveRelativePath(row.relative_path),
    fileSha256: hash(row.file_sha256),
    family: row.family,
    language: row.language,
    declaredVersion: optionalText(row.declared_version, 120),
    declaredDate: optionalText(row.declared_date, 40),
  };
}

function queryPage(query) {
  assertObjectShape(query, { allowedKeys: ['limit', 'offset'] });
  return paginationParams(query);
}

function collection(rows, limit, offset, map) {
  const items = rows.slice(0, limit).map(map);
  return { data: items, page: { limit, offset, hasMore: rows.length > limit } };
}

/**
 * Mount at `/api`. Source manifests, source text and citation locators are
 * deliberately available only through `/staff/wiki/sources`; this router has
 * no public wiki-source endpoint and never reads from the filesystem.
 */
function createSourceRouter({ sql, auth } = {}) {
  if (typeof sql !== 'function') throw new TypeError('createSourceRouter requires the injected postgres client.');
  for (const method of ['requireIdentity', 'requireRole']) {
    if (!auth || typeof auth[method] !== 'function') {
      throw new TypeError(`createSourceRouter requires auth.${method}.`);
    }
  }

  const router = express.Router();
  const staff = express.Router();
  staff.use(auth.requireIdentity, auth.requireRole(...STAFF_ROLES));
  router.use('/staff/wiki/sources', staff);

  staff.get('/', route(async (req, res) => {
    const { limit, offset } = queryPage(req.query);
    const rows = await sql`
      SELECT id, archive_sha256, relative_path, file_sha256, family, language,
             declared_version, declared_date
      FROM wiki_sources
      ORDER BY relative_path ASC, id ASC
      LIMIT ${limit + 1} OFFSET ${offset}`;
    return res.json(collection(rows, limit, offset, sourceManifestDto));
  }));

  staff.get('/:id/locators', route(async (req, res) => {
    const id = validateUuid(req.params.id);
    const { limit, offset } = queryPage(req.query);
    const sources = await sql`SELECT id FROM wiki_sources WHERE id = ${id} LIMIT 1`;
    if (!sources.length) throw new ApiError(404, 'NOT_FOUND', 'A fonte solicitada não foi encontrada.');

    const rows = await sql`
      SELECT revision_id, section_id, locator
      FROM wiki_revision_citations
      WHERE source_id = ${id}
      ORDER BY revision_id ASC, section_id ASC, locator ASC
      LIMIT ${limit + 1} OFFSET ${offset}`;
    return res.json(collection(rows, limit, offset, (row) => {
      if (typeof row.locator !== 'string') throw invalidStoredRecord();
      return {
        revisionId: validateUuid(row.revision_id, 'revisionId'),
        sectionId: validateUuid(row.section_id, 'sectionId'),
        locator: row.locator,
      };
    }));
  }));

  staff.get('/:id', route(async (req, res) => {
    const id = validateUuid(req.params.id);
    const rows = await sql`
      SELECT id, archive_sha256, relative_path, file_sha256, family, language,
             declared_version, declared_date, content
      FROM wiki_sources WHERE id = ${id} LIMIT 1`;
    if (!rows.length) throw new ApiError(404, 'NOT_FOUND', 'A fonte solicitada não foi encontrada.');
    if (typeof rows[0].content !== 'string'
        || Buffer.byteLength(rows[0].content, 'utf8') > MAX_SOURCE_BYTES) {
      throw invalidStoredRecord();
    }
    const expectedHash = hash(rows[0].file_sha256);
    const actualHash = createHash('sha256').update(rows[0].content, 'utf8').digest('hex');
    if (actualHash !== expectedHash) throw invalidStoredRecord();
    return res.json({ data: { ...sourceManifestDto(rows[0]), content: rows[0].content } });
  }));

  return router;
}

module.exports = {
  MAX_SOURCE_BYTES,
  archiveRelativePath,
  createSourceRouter,
  hash,
};
