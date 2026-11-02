'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { deflateRawSync } = require('node:zlib');
const {
  MAX_ARCHIVE_BYTES,
  crc32,
  parseArgs,
  parseZip,
  sha256,
  stageArchive,
} = require('../../scripts/wiki-source-stage');

function makeZip(entries) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.from(entry.data || '');
    const method = entry.method ?? 8;
    const flags = entry.flags ?? 0x0800;
    const directory = entry.name.endsWith('/');
    const compressed = directory ? Buffer.alloc(0) : (method === 0 ? data : deflateRawSync(data));
    const checksum = crc32(data);
    const mode = entry.mode ?? (directory ? 0x41ed : 0x81a4);
    const externalAttributes = entry.externalAttributes
      ?? ((((mode << 16) >>> 0) | (directory ? 0x10 : 0)) >>> 0);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(flags, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localParts.push(localHeader, name, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE((3 << 8) | 20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(flags, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE(externalAttributes, 38);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(centralHeader, name);
    localOffset += localHeader.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function withTemporaryDirectory(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'eterverso-wiki-stage-'));
  try {
    return callback(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('WIKI-SOURCE-01 parses safe Markdown and text files and records source metadata', () => {
  const archive = makeZip([
    {
      name: 'characters/hero.md',
      data: '---\nfamily: Character Profiles\nlanguage: pt-BR\nversion: v2\ndate: 2025-04-02\n---\nConteúdo sintético de teste.\n',
    },
    { name: 'README.md', data: '# Synthetic package context\n' },
  ]);
  const result = parseZip(archive);
  assert.equal(result.entries.length, 2);
  assert.equal(result.totalUncompressedBytes, Buffer.byteLength(
    '---\nfamily: Character Profiles\nlanguage: pt-BR\nversion: v2\ndate: 2025-04-02\n---\nConteúdo sintético de teste.\n# Synthetic package context\n',
  ));
  assert.equal(result.entries[0].sha256, sha256(Buffer.from(
    '---\nfamily: Character Profiles\nlanguage: pt-BR\nversion: v2\ndate: 2025-04-02\n---\nConteúdo sintético de teste.\n',
  )));

  withTemporaryDirectory((directory) => {
    const archivePath = path.join(directory, 'fixture.zip');
    const outputRoot = path.join(directory, 'private', 'wiki-sources');
    fs.writeFileSync(archivePath, archive);
    const staged = stageArchive({ archivePath, outputRoot });
    assert.equal(staged.fileCount, 2);
    assert.equal(staged.createdFiles, 2);
    assert.equal(staged.manifestStatus, 'created');

    const manifestPath = path.join(outputRoot, staged.archiveSha256, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.archiveSha256, sha256(archive));
    assert.deepEqual(manifest.files.map((file) => file.relativePath), ['README.md', 'characters/hero.md']);
    assert.deepEqual(manifest.files[1], {
      relativePath: 'characters/hero.md',
      sizeBytes: Buffer.byteLength('---\nfamily: Character Profiles\nlanguage: pt-BR\nversion: v2\ndate: 2025-04-02\n---\nConteúdo sintético de teste.\n'),
      sha256: sha256(Buffer.from('---\nfamily: Character Profiles\nlanguage: pt-BR\nversion: v2\ndate: 2025-04-02\n---\nConteúdo sintético de teste.\n')),
      family: 'Character Profiles',
      language: 'pt-BR',
      declaredVersion: 'v2',
      declaredDate: '2025-04-02',
      role: 'source',
      mediaType: 'text/markdown',
    });
    assert.equal(manifest.files[0].role, 'context');
    assert.equal(manifest.files[0].declaredVersion, 'unknown');

    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(outputRoot).mode & 0o777, 0o700);
      assert.equal(fs.statSync(manifestPath).mode & 0o777, 0o600);
      assert.equal(fs.statSync(path.join(outputRoot, staged.archiveSha256, 'files', 'README.md')).mode & 0o777, 0o600);
    }
  });
});

test('WIKI-SOURCE-02 repeat staging is idempotent and preserves human-edited files', () => {
  const archive = makeZip([{ name: 'drafts/example.txt', data: 'Synthetic source text.\n' }]);
  withTemporaryDirectory((directory) => {
    const archivePath = path.join(directory, 'fixture.zip');
    const outputRoot = path.join(directory, 'wiki-sources');
    fs.writeFileSync(archivePath, archive);

    const first = stageArchive({ archivePath, outputRoot });
    const second = stageArchive({ archivePath, outputRoot });
    assert.equal(second.createdFiles, 0);
    assert.equal(second.unchangedFiles, 1);
    assert.equal(second.manifestStatus, 'unchanged');

    const stagedFile = path.join(outputRoot, first.archiveSha256, 'files', 'drafts', 'example.txt');
    fs.writeFileSync(stagedFile, 'Human revision.\n', { mode: 0o600 });
    const manifestPath = path.join(outputRoot, first.archiveSha256, 'manifest.json');
    fs.writeFileSync(manifestPath, 'Human-edited manifest.\n', { mode: 0o600 });
    const third = stageArchive({ archivePath, outputRoot });
    assert.equal(third.modifiedFiles, 1);
    assert.equal(third.manifestStatus, 'modified');
    assert.equal(fs.readFileSync(stagedFile, 'utf8'), 'Human revision.\n');
    assert.equal(fs.readFileSync(manifestPath, 'utf8'), 'Human-edited manifest.\n');

    if (process.platform !== 'win32') {
      const outsideFile = path.join(directory, 'outside.txt');
      fs.writeFileSync(outsideFile, 'Keep this untouched.\n');
      fs.unlinkSync(stagedFile);
      fs.symlinkSync(outsideFile, stagedFile);
      assert.throws(() => stageArchive({ archivePath, outputRoot }), /unsupported filesystem entry/);
      assert.equal(fs.readFileSync(outsideFile, 'utf8'), 'Keep this untouched.\n');
    }
  });
});

test('WIKI-SOURCE-03 refuses unsafe paths, unsupported types, symlinks and encrypted entries', () => {
  for (const name of ['../escape.md', '/absolute.md', 'C:/drive.md', 'safe\\..\\escape.md', 'folder/./item.md', 'folder/CON.md', 'folder/trailing. /bad.md']) {
    assert.throws(() => parseZip(makeZip([{ name, data: 'x' }])), /invalid archive-relative path/);
  }
  assert.throws(() => parseZip(makeZip([{ name: 'payload.bin', data: 'x' }])), /unsupported content type/);
  assert.throws(() => parseZip(makeZip([{ name: 'link.md', data: 'x', mode: 0xa1ff }])), /symlink entries/);
  assert.throws(() => parseZip(makeZip([{ name: 'secret.md', data: 'x', flags: 0x0801 }])), /Encrypted ZIP entries/);
  assert.throws(() => parseZip(makeZip([{ name: 'notes.md', data: 'x', method: 12 }])), /compression method is unsupported/);
  assert.throws(() => parseZip(makeZip([{ name: 'one.md', data: 'x' }, { name: 'one.md/two.md', data: 'y' }])), /conflicting file paths/);

  const directoryWithoutAttributes = parseZip(makeZip([
    { name: 'folder/', data: '', mode: 0, externalAttributes: 0 },
    { name: 'folder/note.md', data: 'Synthetic.' },
  ]));
  assert.equal(directoryWithoutAttributes.entries.length, 1);
});

test('WIKI-SOURCE-04 enforces per-file and total expanded size limits before staging', () => {
  const oneFile = makeZip([{ name: 'large.md', data: '123456' }]);
  assert.throws(() => parseZip(oneFile, { maxFileBytes: 5 }), /per-file size limit/);

  const twoFiles = makeZip([
    { name: 'one.md', data: '1234' },
    { name: 'two.md', data: '5678' },
  ]);
  assert.throws(() => parseZip(twoFiles, { maxFileBytes: 10, maxTotalBytes: 7 }), /total uncompressed size limit/);
});

test('WIKI-SOURCE-04A refuses oversized archive files before reading them', () => {
  withTemporaryDirectory((directory) => {
    const archivePath = path.join(directory, 'oversized.zip');
    const descriptor = fs.openSync(archivePath, 'w');
    try { fs.ftruncateSync(descriptor, MAX_ARCHIVE_BYTES + 1); } finally { fs.closeSync(descriptor); }
    assert.throws(() => stageArchive({ archivePath, outputRoot: path.join(directory, 'private') }), /archive size limit/);
    assert.equal(fs.existsSync(path.join(directory, 'private')), false);
  });
});

test('WIKI-SOURCE-05 validates data checksums and local/central path agreement', () => {
  const archive = makeZip([{ name: 'entry.md', data: 'Synthetic payload.' }]);
  const corruptedData = Buffer.from(archive);
  corruptedData[30 + Buffer.byteLength('entry.md')] ^= 0x20;
  assert.throws(() => parseZip(corruptedData), /invalid|checksum/i);

  const mismatchedHeader = Buffer.from(archive);
  mismatchedHeader[30] ^= 0x01;
  assert.throws(() => parseZip(mismatchedHeader), /filenames do not match/);
});

test('WIKI-SOURCE-06 parses an explicit CLI command and rejects implicit staging', () => {
  assert.deepEqual(parseArgs(['stage', '--archive', '/tmp/synthetic.zip']), {
    command: 'stage',
    archivePath: '/tmp/synthetic.zip',
  });
  assert.deepEqual(parseArgs(['--help']), { help: true });
  assert.throws(() => parseArgs([]), /Usage:/);
  assert.throws(() => parseArgs(['stage', '--archive']), /Usage:/);
  assert.throws(() => parseArgs(['stage', '--archive', 'one.zip', '--archive', 'two.zip']), /Usage:/);
});

test('WIKI-SOURCE-07 archive SHA-256 is stable and the ZIP builder has valid checksums', () => {
  const sample = Buffer.from('synthetic');
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  assert.equal(sha256(sample), crypto.createHash('sha256').update(sample).digest('hex'));
  assert.equal(parseZip(makeZip([{ name: 'small.md', data: sample }])).entries[0].sha256, sha256(sample));
});
