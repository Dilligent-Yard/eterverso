'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const postgres = require('postgres');
const { validateArchivePath } = require('./wiki-source-stage');

const OUTPUT_FORMAT = 'eterverso-wiki-source-stage-v1';
const MANIFEST_NAME = 'manifest.json';
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 5 * 1024 * 1024;
const MAX_ENTRIES = 2_000;
const HASH_RE = /^[a-f0-9]{64}$/u;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const DATABASE_NAME_RE = /^[A-Za-z_][A-Za-z0-9_-]{0,62}$/u;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function publicError(message) {
  const error = new Error(message);
  error.safeToPrint = true;
  return error;
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw publicError(`The staged ${label} is invalid.`);
  }
}

function assertExactKeys(value, keys, label) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw publicError(`The staged ${label} has an unsupported format.`);
  }
}

function assertHash(value, label) {
  if (typeof value !== 'string' || !HASH_RE.test(value)) {
    throw publicError(`The staged ${label} hash is invalid.`);
  }
  return value;
}

function assertText(value, label, maxLength) {
  if (typeof value !== 'string' || value.length === 0
      || Array.from(value).length > maxLength
      || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw publicError(`The staged ${label} is invalid.`);
  }
  return value;
}

function assertPrivateEntry(filePath, kind, fsImpl) {
  let stat;
  try {
    stat = fsImpl.lstatSync(filePath);
  } catch (_error) {
    throw publicError('Private staged source data is incomplete.');
  }

  const isDirectory = kind === 'directory';
  const expectedMode = isDirectory ? 0o700 : 0o600;
  if (stat.isSymbolicLink() || (isDirectory ? !stat.isDirectory() : !stat.isFile())) {
    throw publicError('Private staged source data contains an unsupported filesystem entry.');
  }
  if ((stat.mode & 0o7777) !== expectedMode) {
    throw publicError('Private staged source permissions are too broad.');
  }
  return stat;
}

function readPrivateFile(filePath, priorStat, fsImpl, label, maxBytes) {
  const constants = fsImpl.constants || fs.constants;
  if (!Number.isInteger(constants.O_NOFOLLOW)) {
    throw publicError('This runtime cannot safely read staged source files.');
  }

  let fileDescriptor;
  try {
    fileDescriptor = fsImpl.openSync(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (_error) {
    throw publicError(`A private staged ${label} could not be opened safely.`);
  }
  try {
    let openedStat;
    let bytes;
    try {
      openedStat = fsImpl.fstatSync(fileDescriptor);
      if (!openedStat.isFile() || (openedStat.mode & 0o7777) !== 0o600
          || openedStat.size !== priorStat.size || openedStat.size > maxBytes
          || (priorStat.dev !== undefined && openedStat.dev !== priorStat.dev)
          || (priorStat.ino !== undefined && openedStat.ino !== priorStat.ino)) {
        throw publicError(`A private staged ${label} changed while it was being read.`);
      }
      bytes = fsImpl.readFileSync(fileDescriptor);
    } catch (_error) {
      if (_error && _error.safeToPrint) throw _error;
      throw publicError(`A private staged ${label} could not be read safely.`);
    }
    if (bytes.length !== openedStat.size) {
      throw publicError(`A private staged ${label} changed while it was being read.`);
    }
    return bytes;
  } finally {
    try { fsImpl.closeSync(fileDescriptor); } catch (_error) { /* Preserve the read result or original error. */ }
  }
}

function validateRelativePath(value) {
  if (typeof value !== 'string' || value.length > 1000) {
    throw publicError('A staged source path is invalid.');
  }
  try {
    return validateArchivePath(value);
  } catch (_error) {
    throw publicError('A staged source path is invalid.');
  }
}

function sourceKind(relativePath) {
  const basename = path.posix.basename(relativePath);
  const isReadme = /^readme(?:\.(?:md|txt))?$/iu.test(basename);
  return isReadme ? 'context' : 'source';
}

function expectedMediaType(relativePath) {
  return path.posix.extname(relativePath).toLowerCase() === '.md' ? 'text/markdown' : 'text/plain';
}

function readPrivateStagedSources({ manifestPath, fsImpl = fs } = {}) {
  if (typeof manifestPath !== 'string' || !manifestPath) {
    throw publicError('A private staged manifest path is required.');
  }
  const absoluteManifestPath = path.resolve(manifestPath);
  if (path.basename(absoluteManifestPath) !== MANIFEST_NAME) {
    throw publicError('The staged manifest must be named manifest.json.');
  }

  const archiveDirectory = path.dirname(absoluteManifestPath);
  const stagingRoot = path.dirname(archiveDirectory);
  const manifestStat = assertPrivateEntry(absoluteManifestPath, 'file', fsImpl);
  if (manifestStat.size > MAX_MANIFEST_BYTES) {
    throw publicError('The staged manifest exceeds the size limit.');
  }
  assertPrivateEntry(stagingRoot, 'directory', fsImpl);
  assertPrivateEntry(archiveDirectory, 'directory', fsImpl);
  const filesRoot = path.join(archiveDirectory, 'files');
  assertPrivateEntry(filesRoot, 'directory', fsImpl);

  let manifestBytes;
  let manifest;
  try {
    manifestBytes = readPrivateFile(
      absoluteManifestPath, manifestStat, fsImpl, 'manifest', MAX_MANIFEST_BYTES,
    );
    const manifestText = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(manifestBytes);
    manifest = JSON.parse(manifestText);
  } catch (_error) {
    if (_error && _error.safeToPrint) throw _error;
    throw publicError('The staged manifest could not be read.');
  }
  if (manifestBytes.length !== manifestStat.size) {
    throw publicError('The staged manifest changed while it was being read.');
  }

  assertObject(manifest, 'manifest');
  assertExactKeys(manifest, [
    'format', 'archiveSha256', 'archiveSizeBytes', 'totalUncompressedBytes', 'fileCount', 'files',
  ], 'manifest');
  if (manifest.format !== OUTPUT_FORMAT) {
    throw publicError('The staged manifest format is unsupported.');
  }
  const archiveSha256 = assertHash(manifest.archiveSha256, 'archive');
  if (path.basename(archiveDirectory) !== archiveSha256) {
    throw publicError('The staged manifest is outside its archive hash directory.');
  }
  if (!Number.isSafeInteger(manifest.archiveSizeBytes) || manifest.archiveSizeBytes < 1
      || manifest.archiveSizeBytes > MAX_TOTAL_BYTES + 10 * 1024 * 1024) {
    throw publicError('The staged archive size is invalid.');
  }
  if (!Array.isArray(manifest.files) || manifest.files.length > MAX_ENTRIES
      || !Number.isSafeInteger(manifest.fileCount) || manifest.fileCount !== manifest.files.length) {
    throw publicError('The staged file list is invalid.');
  }

  const seenPaths = new Set();
  const files = [];
  let totalBytes = 0;
  for (const entry of manifest.files) {
    assertObject(entry, 'file entry');
    assertExactKeys(entry, [
      'relativePath', 'sizeBytes', 'sha256', 'family', 'language', 'declaredVersion',
      'declaredDate', 'role', 'mediaType',
    ], 'file entry');

    const relativePath = validateRelativePath(entry.relativePath);
    const collisionKey = relativePath.toLowerCase();
    if (seenPaths.has(collisionKey)) throw publicError('The staged manifest contains duplicate paths.');
    seenPaths.add(collisionKey);

    const expectedRole = sourceKind(relativePath);
    if (entry.role !== expectedRole || entry.mediaType !== expectedMediaType(relativePath)) {
      throw publicError('The staged source classification is invalid.');
    }
    if (!Number.isSafeInteger(entry.sizeBytes) || entry.sizeBytes < 0 || entry.sizeBytes > MAX_FILE_BYTES) {
      throw publicError('A staged source exceeds the per-file size limit.');
    }
    const fileSha256 = assertHash(entry.sha256, 'file');
    const family = assertText(entry.family, 'family', 80);
    const language = assertText(entry.language, 'language', 20);
    const declaredVersion = assertText(entry.declaredVersion, 'declared version', 120);
    const declaredDate = assertText(entry.declaredDate, 'declared date', 40);

    const segments = relativePath.split('/');
    let currentDirectory = filesRoot;
    for (const segment of segments.slice(0, -1)) {
      currentDirectory = path.join(currentDirectory, segment);
      assertPrivateEntry(currentDirectory, 'directory', fsImpl);
    }
    const stagedFilePath = path.join(filesRoot, ...segments);
    const fileStat = assertPrivateEntry(stagedFilePath, 'file', fsImpl);
    if (fileStat.size !== entry.sizeBytes || fileStat.size > MAX_FILE_BYTES) {
      throw publicError('A staged source size does not match its manifest.');
    }

    const contentBytes = readPrivateFile(stagedFilePath, fileStat, fsImpl, 'source file', MAX_FILE_BYTES);
    if (contentBytes.length !== entry.sizeBytes || sha256(contentBytes) !== fileSha256) {
      throw publicError('A staged source hash does not match its manifest.');
    }
    let content;
    try {
      // Preserve a leading UTF-8 BOM as U+FEFF so the stored text hashes back
      // to the exact staged bytes, as the staff source endpoint requires.
      content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(contentBytes);
    } catch (_error) {
      throw publicError('A staged source is not valid UTF-8 text.');
    }
    if (content.includes('\0')) {
      throw publicError('A staged source contains a character PostgreSQL text cannot store.');
    }

    totalBytes += contentBytes.length;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_TOTAL_BYTES) {
      throw publicError('The staged sources exceed the total size limit.');
    }
    files.push({
      archiveSha256,
      relativePath,
      fileSha256,
      family,
      language,
      declaredVersion,
      declaredDate,
      role: entry.role,
      content,
    });
  }

  if (!Number.isSafeInteger(manifest.totalUncompressedBytes)
      || manifest.totalUncompressedBytes !== totalBytes) {
    throw publicError('The staged total size does not match its manifest.');
  }

  return {
    archiveSha256,
    archiveSizeBytes: manifest.archiveSizeBytes,
    totalUncompressedBytes: totalBytes,
    fileCount: files.length,
    files,
  };
}

function normalizeModeratorId(value) {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw publicError('An explicit moderator or administrator UUID is required.');
  }
  return value.toLowerCase();
}

function sourceIdentityFields(source) {
  return {
    archive_sha256: source.archiveSha256,
    relative_path: source.relativePath,
    file_sha256: source.fileSha256,
    family: source.family,
    language: source.language,
    declared_version: source.declaredVersion,
    declared_date: source.declaredDate,
    content: source.content,
  };
}

function storedFields(source, importedBy) {
  return { ...sourceIdentityFields(source), imported_by: importedBy };
}

function assertMatchingExisting(existing, expected) {
  if (!existing) throw publicError('A conflicting staged source could not be resolved.');
  for (const [field, value] of Object.entries(expected)) {
    if (existing[field] !== value) {
      throw publicError('A staged source conflicts with an existing database record. No source records were changed.');
    }
  }
  if (typeof existing.id !== 'string' || !UUID_RE.test(existing.id)) {
    throw publicError('An existing source record has an invalid identifier.');
  }
  return existing.id;
}

async function persistStagedSources({ staged, importedBy, sql } = {}) {
  if (!staged || !Array.isArray(staged.files) || typeof sql !== 'function'
      || typeof sql.begin !== 'function') {
    throw new TypeError('persistStagedSources requires validated source data and an injected postgres client.');
  }
  const moderatorId = normalizeModeratorId(importedBy);
  const sourceFiles = staged.files.filter((source) => source.role === 'source');
  const contextFilesSkipped = staged.files.length - sourceFiles.length;

  const outcome = await sql.begin(async (tx) => {
    const moderators = await tx`
      SELECT id FROM users
      WHERE id = ${moderatorId} AND disabled_at IS NULL AND role IN ('moderador', 'admin')
      FOR SHARE`;
    if (!moderators.length) {
      throw publicError('The selected UUID is not an existing active moderator or administrator.');
    }

    const sourceIds = [];
    let inserted = 0;
    let reused = 0;
    for (const source of sourceFiles) {
      const expected = storedFields(source, moderatorId);
      const insertedRows = await tx`
        INSERT INTO wiki_sources (
          archive_sha256, relative_path, file_sha256, family, language,
          declared_version, declared_date, content, imported_by
        ) VALUES (
          ${expected.archive_sha256}, ${expected.relative_path}, ${expected.file_sha256},
          ${expected.family}, ${expected.language}, ${expected.declared_version},
          ${expected.declared_date}, ${expected.content}, ${expected.imported_by}
        )
        ON CONFLICT (archive_sha256, relative_path) DO NOTHING
        RETURNING id`;

      if (insertedRows.length) {
        const id = insertedRows[0].id;
        if (typeof id !== 'string' || !UUID_RE.test(id)) {
          throw publicError('The database returned an invalid source identifier.');
        }
        sourceIds.push({ id, relativePath: source.relativePath, status: 'inserted' });
        inserted += 1;
        continue;
      }

      const existingRows = await tx`
        SELECT id, archive_sha256, relative_path, file_sha256, family, language,
               declared_version, declared_date, content, imported_by
        FROM wiki_sources
        WHERE archive_sha256 = ${expected.archive_sha256}
          AND relative_path = ${expected.relative_path}
        FOR UPDATE`;
      const id = assertMatchingExisting(existingRows[0], sourceIdentityFields(source));
      sourceIds.push({ id, relativePath: source.relativePath, status: 'reused' });
      reused += 1;
    }

    return { sourceIds, inserted, reused, contextFilesSkipped };
  });

  return {
    archiveSha256: staged.archiveSha256,
    stagedFiles: staged.fileCount,
    imported: outcome.inserted,
    reused: outcome.reused,
    contextFilesSkipped: outcome.contextFilesSkipped,
    sourceIds: outcome.sourceIds,
  };
}

async function importStagedSources({ manifestPath, importedBy, sql, fsImpl = fs } = {}) {
  const staged = readPrivateStagedSources({ manifestPath, fsImpl });
  return persistStagedSources({ staged, importedBy, sql });
}

function assertDatabaseTarget(databaseUrl, databaseName) {
  if (typeof databaseName !== 'string' || !DATABASE_NAME_RE.test(databaseName)) {
    throw publicError('Select an explicit valid loopback database name with --database-name.');
  }
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch (_error) {
    throw publicError('The configured PostgreSQL target is invalid.');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw publicError('The selected database must use PostgreSQL on loopback.');
  }
  if (!LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw publicError('The selected database must use a loopback host.');
  }
  let configuredName;
  try {
    configuredName = decodeURIComponent(parsed.pathname.slice(1));
  } catch (_error) {
    throw publicError('The configured PostgreSQL database name is invalid.');
  }
  if (configuredName !== databaseName) {
    throw publicError('The configured database does not match the explicitly selected database name.');
  }
  return { database: databaseName, host: parsed.hostname };
}

function parseArgs(args) {
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) return { help: true };
  const allowed = new Set(['manifest', 'database-name', 'imported-by', 'env-file']);
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    const key = typeof flag === 'string' && flag.startsWith('--') ? flag.slice(2) : '';
    if (!allowed.has(key) || Object.hasOwn(values, key) || !value || value.startsWith('--')) {
      throw publicError('Usage: node scripts/wiki-source-import.js --manifest PATH --database-name NAME --imported-by UUID [--env-file PATH]');
    }
    values[key] = value;
  }
  if (!values.manifest || !values['database-name'] || !values['imported-by']) {
    throw publicError('Usage: node scripts/wiki-source-import.js --manifest PATH --database-name NAME --imported-by UUID [--env-file PATH]');
  }
  values['imported-by'] = normalizeModeratorId(values['imported-by']);
  if (!DATABASE_NAME_RE.test(values['database-name'])) {
    throw publicError('Select an explicit valid loopback database name with --database-name.');
  }
  return {
    help: false,
    manifestPath: values.manifest,
    databaseName: values['database-name'],
    importedBy: values['imported-by'],
    envFile: values['env-file'],
  };
}

function databaseUrlFor({ envFile, environment, fsImpl }) {
  let fileEnvironment = {};
  if (envFile) {
    try {
      fileEnvironment = dotenv.parse(fsImpl.readFileSync(path.resolve(envFile)));
    } catch (_error) {
      throw publicError('The explicitly selected environment file could not be read.');
    }
  }
  const databaseUrl = environment.DATABASE_URL || fileEnvironment.DATABASE_URL;
  if (!databaseUrl) throw publicError('Set DATABASE_URL or select an environment file that defines it.');
  return databaseUrl;
}

async function main(args = process.argv.slice(2), environment = process.env, dependencies = {}) {
  const fsImpl = dependencies.fsImpl || fs;
  const options = parseArgs(args);
  if (options.help) {
    process.stdout.write('Usage: node scripts/wiki-source-import.js --manifest PATH --database-name NAME --imported-by UUID [--env-file PATH]\n');
    process.stdout.write('Imports private source entries; staged role=context files, including README, are validated and skipped.\n');
    return null;
  }
  if (Number(process.versions.node.split('.')[0]) !== 24) {
    throw publicError('Wiki source import requires Node.js 24.');
  }

  const databaseUrl = databaseUrlFor({ envFile: options.envFile, environment, fsImpl });
  const target = assertDatabaseTarget(databaseUrl, options.databaseName);
  const staged = readPrivateStagedSources({ manifestPath: options.manifestPath, fsImpl });
  const sqlFactory = dependencies.sqlFactory || postgres;
  const sql = sqlFactory(databaseUrl, { prepare: false, max: 1, connect_timeout: 5, idle_timeout: 5 });
  try {
    const current = await sql`SELECT current_database() AS database`;
    if (!current.length || current[0].database !== target.database) {
      throw publicError('The connected database does not match the explicitly selected loopback target.');
    }
    const report = await persistStagedSources({ staged, importedBy: options.importedBy, sql });
    process.stdout.write(`Imported ${report.imported} source record(s); reused ${report.reused}; skipped ${report.contextFilesSkipped} context file(s). Context files, including README, remain context and are not imported as lore.\n`);
    return report;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error && error.safeToPrint
      ? error.message
      : 'Wiki source import failed; database details, credentials, SQL and source text are withheld.'}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  assertDatabaseTarget,
  importStagedSources,
  main,
  normalizeModeratorId,
  parseArgs,
  persistStagedSources,
  readPrivateStagedSources,
  sha256,
};
