'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { inflateRawSync } = require('node:zlib');

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = MAX_TOTAL_BYTES + (10 * 1024 * 1024);
const MAX_ENTRIES = 2_000;
const MANIFEST_NAME = 'manifest.json';
const OUTPUT_FORMAT = 'eterverso-wiki-source-stage-v1';

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function requireRange(buffer, offset, length, limit = buffer.length) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length)
      || offset < 0 || length < 0 || offset + length > limit || offset + length > buffer.length) {
    throw new Error('Malformed ZIP archive.');
  }
}

function decodeZipName(nameBytes, flags) {
  try {
    if (flags & 0x0800) return new TextDecoder('utf-8', { fatal: true }).decode(nameBytes);
    if (nameBytes.some((byte) => byte > 0x7f)) throw new Error('Unsupported ZIP filename encoding.');
    return nameBytes.toString('ascii');
  } catch (_error) {
    throw new Error('Unsupported ZIP filename encoding.');
  }
}

function validateArchivePath(name, directory = false) {
  if (typeof name !== 'string' || name.length === 0 || name.includes('\\')
      || name.includes('\0') || /[\u0000-\u001f\u007f]/u.test(name)
      || name.includes(':') || name.normalize('NFC') !== name
      || name.startsWith('/') || /^[a-z]:/iu.test(name)) {
    throw new Error('ZIP contains an invalid archive-relative path.');
  }

  const withoutTrailingSlash = directory ? name.slice(0, -1) : name;
  if (!withoutTrailingSlash) throw new Error('ZIP contains an invalid archive-relative path.');
  const segments = withoutTrailingSlash.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..'
      || /[. ]$/u.test(segment) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(segment))) {
    throw new Error('ZIP contains an invalid archive-relative path.');
  }

  const extension = path.posix.extname(segments[segments.length - 1]).toLowerCase();
  const isReadme = /^readme(?:\.(?:md|txt))?$/iu.test(segments[segments.length - 1]);
  if (!directory && !['.md', '.txt'].includes(extension) && !isReadme) {
    throw new Error('ZIP contains an unsupported content type.');
  }
  return withoutTrailingSlash;
}

function findEndOfCentralDirectory(buffer) {
  if (buffer.length < 22) throw new Error('ZIP central directory is missing or malformed.');
  const minimum = Math.max(0, buffer.length - 22 - 0xffff);
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) !== 0x06054b50) continue;
    requireRange(buffer, offset, 22);
    const commentLength = buffer.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength === buffer.length) return offset;
  }
  throw new Error('ZIP central directory is missing or malformed.');
}

function inspectExtraFields(buffer, start, length) {
  const end = start + length;
  requireRange(buffer, start, length);
  let offset = start;
  while (offset < end) {
    requireRange(buffer, offset, 4, end);
    const identifier = buffer.readUInt16LE(offset);
    const fieldLength = buffer.readUInt16LE(offset + 2);
    requireRange(buffer, offset + 4, fieldLength, end);
    if (identifier === 0x0001) throw new Error('ZIP64 archives are unsupported.');
    if (identifier === 0x7075) throw new Error('Unicode path overrides are unsupported.');
    offset += 4 + fieldLength;
  }
}

function entryIsDirectory(name, madeBy, externalAttributes) {
  const unixPlatform = (madeBy >>> 8) === 3;
  const unixMode = (externalAttributes >>> 16) & 0xffff;
  const unixType = unixMode & 0xf000;
  if (unixPlatform && unixType !== 0 && unixType !== 0x8000 && unixType !== 0x4000) {
    if (unixType === 0xa000) throw new Error('ZIP symlink entries are unsupported.');
    throw new Error('ZIP contains an unsupported filesystem entry.');
  }
  const slashDirectory = name.endsWith('/');
  const modeDirectory = unixPlatform && unixType === 0x4000;
  const dosDirectory = Boolean(externalAttributes & 0x10);
  if ((modeDirectory || dosDirectory) && !slashDirectory) {
    throw new Error('ZIP directory entry is malformed.');
  }
  if (unixPlatform && unixType === 0x8000 && slashDirectory) {
    throw new Error('ZIP file entry is malformed.');
  }
  return slashDirectory;
}

function parseZip(buffer, limits = {}) {
  if (!Buffer.isBuffer(buffer)) throw new TypeError('ZIP input must be a Buffer.');
  const maxFileBytes = limits.maxFileBytes ?? MAX_FILE_BYTES;
  const maxTotalBytes = limits.maxTotalBytes ?? MAX_TOTAL_BYTES;
  const maxEntries = limits.maxEntries ?? MAX_ENTRIES;
  if (![maxFileBytes, maxTotalBytes, maxEntries].every((value) => Number.isSafeInteger(value) && value >= 0)) {
    throw new Error('ZIP limits must be non-negative safe integers.');
  }
  const endOffset = findEndOfCentralDirectory(buffer);
  const disk = buffer.readUInt16LE(endOffset + 4);
  const centralDisk = buffer.readUInt16LE(endOffset + 6);
  const entriesOnDisk = buffer.readUInt16LE(endOffset + 8);
  const entryCount = buffer.readUInt16LE(endOffset + 10);
  const centralSize = buffer.readUInt32LE(endOffset + 12);
  const centralOffset = buffer.readUInt32LE(endOffset + 16);

  if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
    throw new Error('Multi-disk ZIP archives are unsupported.');
  }
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new Error('ZIP64 archives are unsupported.');
  }
  if (entryCount > maxEntries) throw new Error('ZIP contains too many entries.');
  requireRange(buffer, centralOffset, centralSize, endOffset);
  if (centralOffset + centralSize !== endOffset) throw new Error('ZIP central directory is malformed.');

  const parsed = [];
  const records = [];
  const names = new Map();
  let offset = centralOffset;
  let totalBytes = 0;

  for (let index = 0; index < entryCount; index += 1) {
    requireRange(buffer, offset, 46, centralOffset + centralSize);
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('ZIP central directory is malformed.');

    const madeBy = buffer.readUInt16LE(offset + 4);
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const expectedCrc = buffer.readUInt32LE(offset + 16);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const diskStart = buffer.readUInt16LE(offset + 34);
    const externalAttributes = buffer.readUInt32LE(offset + 38);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const recordLength = 46 + nameLength + extraLength + commentLength;
    requireRange(buffer, offset, recordLength, centralOffset + centralSize);

    if (flags & 0x0041) throw new Error('Encrypted ZIP entries are unsupported.');
    const allowedFlags = 0x0008 | 0x0800 | (method === 8 ? 0x0006 : 0);
    if ((flags & ~allowedFlags) !== 0) throw new Error('ZIP entry uses unsupported flags.');
    if (method !== 0 && method !== 8) throw new Error('ZIP compression method is unsupported.');
    if (diskStart !== 0) throw new Error('Multi-disk ZIP archives are unsupported.');
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new Error('ZIP64 archives are unsupported.');
    }
    const nameBytes = buffer.subarray(offset + 46, offset + 46 + nameLength);
    inspectExtraFields(buffer, offset + 46 + nameLength, extraLength);
    const name = decodeZipName(nameBytes, flags);
    const isDirectory = entryIsDirectory(name, madeBy, externalAttributes);
    const relativePath = validateArchivePath(name, isDirectory);

    const collisionKey = relativePath.toLowerCase();
    if (names.has(collisionKey)) throw new Error('ZIP contains duplicate or colliding paths.');
    names.set(collisionKey, isDirectory ? 'directory' : 'file');

    const entry = {
      relativePath,
      nameBytes: Buffer.from(nameBytes),
      flags,
      method,
      expectedCrc,
      compressedSize,
      uncompressedSize,
      localOffset,
      isDirectory,
    };
    records.push(entry);

    if (!isDirectory) {
      if (uncompressedSize > maxFileBytes) throw new Error('ZIP entry exceeds the per-file size limit.');
      totalBytes += uncompressedSize;
      if (totalBytes > maxTotalBytes) throw new Error('ZIP exceeds the total uncompressed size limit.');
      parsed.push(entry);
    } else if (compressedSize !== 0 || uncompressedSize !== 0) {
      throw new Error('ZIP directory entries cannot contain data.');
    }
    offset += recordLength;
  }
  if (offset !== centralOffset + centralSize) throw new Error('ZIP central directory is malformed.');

  for (const entry of records) {
    const { localOffset } = entry;
    requireRange(buffer, localOffset, 30, centralOffset);
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('ZIP local entry is malformed.');
    const localFlags = buffer.readUInt16LE(localOffset + 6);
    const localMethod = buffer.readUInt16LE(localOffset + 8);
    const localCrc = buffer.readUInt32LE(localOffset + 14);
    const localCompressedSize = buffer.readUInt32LE(localOffset + 18);
    const localUncompressedSize = buffer.readUInt32LE(localOffset + 22);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    requireRange(buffer, localOffset + 30, localNameLength + localExtraLength, centralOffset);
    const localName = buffer.subarray(localOffset + 30, localOffset + 30 + localNameLength);
    if (!localName.equals(entry.nameBytes)) {
      throw new Error('ZIP local and central filenames do not match.');
    }
    inspectExtraFields(buffer, localOffset + 30 + localNameLength, localExtraLength);
    if (localFlags !== entry.flags || localMethod !== entry.method) {
      throw new Error('ZIP local and central headers do not match.');
    }
    if (!(entry.flags & 0x0008)
        && (localCrc !== entry.expectedCrc || localCompressedSize !== entry.compressedSize
          || localUncompressedSize !== entry.uncompressedSize)) {
      throw new Error('ZIP local and central sizes do not match.');
    }
    requireRange(buffer, dataOffset, entry.compressedSize, centralOffset);
    if (entry.isDirectory) continue;
    const compressed = buffer.subarray(dataOffset, dataOffset + entry.compressedSize);
    let data;
    try {
      data = entry.method === 0
        ? Buffer.from(compressed)
        : inflateRawSync(compressed, { maxOutputLength: Math.max(1, entry.uncompressedSize) });
    } catch (_error) {
      throw new Error('ZIP entry data is invalid.');
    }
    if (data.length !== entry.uncompressedSize || crc32(data) !== entry.expectedCrc) {
      throw new Error('ZIP entry size or checksum is invalid.');
    }
    entry.data = data;
    entry.sha256 = sha256(data);
  }

  // Reject files nested below another file, including paths whose directory
  // records are omitted from the archive.
  for (const entry of parsed) {
    const segments = entry.relativePath.split('/');
    for (let index = 1; index < segments.length; index += 1) {
      if (names.get(segments.slice(0, index).join('/').toLowerCase()) === 'file') {
        throw new Error('ZIP contains conflicting file paths.');
      }
    }
  }
  return { entries: parsed, totalUncompressedBytes: totalBytes };
}

function safeMetadataValue(value) {
  if (typeof value !== 'string') return 'unknown';
  const cleaned = value.trim().replace(/^(["'])(.*)\1$/u, '$2');
  if (!cleaned || cleaned.length > 80 || /[\u0000-\u001f\u007f]/u.test(cleaned)) return 'unknown';
  return cleaned;
}

function declaredMetadata(data, relativePath) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch (_error) {
    throw new Error('ZIP contains a non-UTF-8 text entry.');
  }
  const metadata = {};
  const frontMatter = /^---\r?\n([\s\S]{0,8192}?)\r?\n---(?:\r?\n|$)/u.exec(text);
  if (frontMatter) {
    for (const line of frontMatter[1].split(/\r?\n/u)) {
      const match = /^\s*([a-z][a-z0-9_-]*)\s*:\s*(.*?)\s*$/iu.exec(line);
      if (!match) continue;
      const key = match[1].toLowerCase().replaceAll('-', '_');
      if (['family', 'language', 'lang', 'version', 'declared_version', 'date', 'declared_date'].includes(key)) {
        metadata[key] = safeMetadataValue(match[2]);
      }
    }
  }

  const segments = relativePath.split('/');
  const basename = segments[segments.length - 1];
  const isReadme = /^readme(?:\.(?:md|txt))?$/iu.test(basename);
  return {
    family: metadata.family && metadata.family !== 'unknown'
      ? metadata.family
      : (segments.length > 1 && !isReadme ? safeMetadataValue(segments[0]) : 'unknown'),
    language: metadata.language || metadata.lang || 'unknown',
    declaredVersion: metadata.declared_version || metadata.version || 'unknown',
    declaredDate: metadata.declared_date || metadata.date || 'unknown',
    role: isReadme ? 'context' : 'source',
    mediaType: path.posix.extname(basename).toLowerCase() === '.md' ? 'text/markdown' : 'text/plain',
  };
}

function manifestFor(archiveHash, archiveSizeBytes, parsed) {
  const files = parsed.entries.map((entry) => {
    const metadata = declaredMetadata(entry.data, entry.relativePath);
    return {
      relativePath: entry.relativePath,
      sizeBytes: entry.uncompressedSize,
      sha256: entry.sha256,
      family: metadata.family,
      language: metadata.language,
      declaredVersion: metadata.declaredVersion,
      declaredDate: metadata.declaredDate,
      role: metadata.role,
      mediaType: metadata.mediaType,
    };
  }).sort((left, right) => (left.relativePath < right.relativePath ? -1 : (left.relativePath > right.relativePath ? 1 : 0)));
  return {
    format: OUTPUT_FORMAT,
    archiveSha256: archiveHash,
    archiveSizeBytes,
    totalUncompressedBytes: parsed.totalUncompressedBytes,
    fileCount: files.length,
    files,
  };
}

function ensurePrivateDirectory(directoryPath) {
  const absolute = path.resolve(directoryPath);
  const root = path.parse(absolute).root;
  let current = root;
  const segments = absolute.slice(root.length).split(path.sep).filter(Boolean);
  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      fs.mkdirSync(current, { mode: 0o700 });
    } catch (error) {
      if (!error || error.code !== 'EEXIST') throw new Error('Unable to create private source storage.');
    }
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (_error) {
      throw new Error('Unable to inspect private source storage.');
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error('Private source storage contains an unsupported filesystem entry.');
    }
  }
  try {
    fs.chmodSync(absolute, 0o700);
  } catch (_error) {
    throw new Error('Unable to restrict private source storage permissions.');
  }
  return absolute;
}

function ensureParentDirectories(root, relativePath) {
  const segments = relativePath.split('/');
  let current = root;
  for (const segment of segments.slice(0, -1)) {
    current = ensurePrivateDirectory(path.join(current, segment));
  }
  return path.join(current, segments[segments.length - 1]);
}

function writeExclusive(filePath, data, mode) {
  const temporaryPath = `${filePath}.stage-${process.pid}-${crypto.randomBytes(6).toString('hex')}.tmp`;
  let handle;
  try {
    handle = fs.openSync(temporaryPath, 'wx', mode);
    fs.writeFileSync(handle, data);
    fs.fsyncSync(handle);
    fs.closeSync(handle);
    handle = undefined;
    fs.linkSync(temporaryPath, filePath);
    fs.unlinkSync(temporaryPath);
    fs.chmodSync(filePath, mode);
    return true;
  } catch (error) {
    if (handle !== undefined) {
      try { fs.closeSync(handle); } catch (_ignored) { /* Preserve the original failure. */ }
    }
    try { fs.unlinkSync(temporaryPath); } catch (_ignored) { /* It may not have been created. */ }
    if (error && error.code === 'EEXIST') return false;
    throw new Error('Unable to write private source staging data.');
  }
}

function stageArchive({ archivePath, outputRoot } = {}) {
  if (!archivePath) throw new Error('An archive path is required.');
  let archiveStat;
  try {
    archiveStat = fs.lstatSync(archivePath);
  } catch (_error) {
    throw new Error('The source ZIP could not be read.');
  }
  if (archiveStat.isSymbolicLink() || !archiveStat.isFile()) throw new Error('The source ZIP must be a regular file.');
  if (archiveStat.size > MAX_ARCHIVE_BYTES) throw new Error('The source ZIP exceeds the archive size limit.');

  let archive;
  try {
    archive = fs.readFileSync(archivePath);
  } catch (_error) {
    throw new Error('The source ZIP could not be read.');
  }
  const archiveSha256 = sha256(archive);
  const parsed = parseZip(archive);
  const manifest = manifestFor(archiveSha256, archive.length, parsed);
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const defaultRoot = path.resolve(__dirname, '..', '.local', 'wiki-sources');
  let root;
  if (outputRoot) {
    root = ensurePrivateDirectory(outputRoot);
  } else {
    ensurePrivateDirectory(path.dirname(defaultRoot));
    root = ensurePrivateDirectory(defaultRoot);
  }

  const archiveDirectory = ensurePrivateDirectory(path.join(root, archiveSha256));
  const filesRoot = ensurePrivateDirectory(path.join(archiveDirectory, 'files'));
  let createdFiles = 0;
  let unchangedFiles = 0;
  let modifiedFiles = 0;

  for (const entry of parsed.entries) {
    const targetPath = ensureParentDirectories(filesRoot, entry.relativePath);
    let stat;
    try {
      stat = fs.lstatSync(targetPath);
    } catch (error) {
      if (!error || error.code !== 'ENOENT') throw new Error('Unable to inspect private staged content.');
    }
    if (stat) {
      if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Private staged content contains an unsupported filesystem entry.');
      try { fs.chmodSync(targetPath, 0o600); } catch (_error) { throw new Error('Unable to restrict staged file permissions.'); }
      const existingHash = sha256(fs.readFileSync(targetPath));
      if (existingHash === entry.sha256) unchangedFiles += 1;
      else modifiedFiles += 1;
      continue;
    }
    if (writeExclusive(targetPath, entry.data, 0o600)) createdFiles += 1;
    else {
      const current = fs.lstatSync(targetPath);
      if (current.isSymbolicLink() || !current.isFile()) throw new Error('Private staged content contains an unsupported filesystem entry.');
      try { fs.chmodSync(targetPath, 0o600); } catch (_error) { throw new Error('Unable to restrict staged file permissions.'); }
      if (sha256(fs.readFileSync(targetPath)) === entry.sha256) unchangedFiles += 1;
      else modifiedFiles += 1;
    }
  }

  const manifestPath = path.join(archiveDirectory, MANIFEST_NAME);
  let manifestStatus;
  let manifestStat;
  try {
    manifestStat = fs.lstatSync(manifestPath);
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw new Error('Unable to inspect private source manifest.');
  }
  if (manifestStat) {
    if (manifestStat.isSymbolicLink() || !manifestStat.isFile()) throw new Error('Private source manifest is an unsupported filesystem entry.');
    try { fs.chmodSync(manifestPath, 0o600); } catch (_error) { throw new Error('Unable to restrict source manifest permissions.'); }
    manifestStatus = fs.readFileSync(manifestPath).equals(manifestBytes) ? 'unchanged' : 'modified';
  } else {
    manifestStatus = writeExclusive(manifestPath, manifestBytes, 0o600) ? 'created' : 'modified';
  }

  return {
    archiveSha256,
    fileCount: parsed.entries.length,
    totalUncompressedBytes: parsed.totalUncompressedBytes,
    createdFiles,
    unchangedFiles,
    modifiedFiles,
    manifestStatus,
  };
}

function parseArgs(args) {
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) return { help: true };
  if (args[0] !== 'stage') throw new Error('Usage: node scripts/wiki-source-stage.js stage --archive <path>');
  let archivePath;
  for (let index = 1; index < args.length; index += 1) {
    if (args[index] === '--archive' && !archivePath && args[index + 1] && !args[index + 1].startsWith('--')) {
      archivePath = args[index + 1];
      index += 1;
    } else {
      throw new Error('Usage: node scripts/wiki-source-stage.js stage --archive <path>');
    }
  }
  if (!archivePath) throw new Error('Usage: node scripts/wiki-source-stage.js stage --archive <path>');
  return { command: 'stage', archivePath };
}

function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (options.help) {
    console.log('Usage: node scripts/wiki-source-stage.js stage --archive <path>');
    return;
  }
  const result = stageArchive(options);
  const state = result.createdFiles > 0 || result.manifestStatus === 'created' ? 'Staged' : 'Already staged';
  console.log(`${state} ${result.fileCount} private text files (${result.totalUncompressedBytes} uncompressed bytes).`);
  console.log(`Archive SHA-256: ${result.archiveSha256}`);
  if (result.modifiedFiles > 0 || result.manifestStatus === 'modified') {
    console.log(`Preserved existing edits in ${result.modifiedFiles} staged file(s); manifest status: ${result.manifestStatus}.`);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Source staging failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  MAX_ARCHIVE_BYTES,
  MAX_ENTRIES,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  crc32,
  parseArgs,
  parseZip,
  sha256,
  stageArchive,
  validateArchivePath,
};
