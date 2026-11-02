'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  assertDatabaseTarget,
  importStagedSources,
  main,
  parseArgs,
  readPrivateStagedSources,
} = require('../../scripts/wiki-source-import');

const MODERATOR_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_MODERATOR_ID = '22222222-2222-4222-8222-222222222222';
const FORMAT = 'eterverso-wiki-source-stage-v1';

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function makeFixture(entries, options = {}) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'eterverso-wiki-import-'));
  const stagingRoot = path.join(temporaryRoot, 'wiki-sources');
  const archiveSha256 = options.archiveSha256 || 'a'.repeat(64);
  const archiveDirectory = path.join(stagingRoot, archiveSha256);
  const filesRoot = path.join(archiveDirectory, 'files');
  fs.mkdirSync(filesRoot, { recursive: true, mode: 0o700 });
  fs.chmodSync(stagingRoot, 0o700);
  fs.chmodSync(archiveDirectory, 0o700);
  fs.chmodSync(filesRoot, 0o700);

  let totalUncompressedBytes = 0;
  const files = entries.map((entry) => {
    const content = Buffer.from(entry.content, 'utf8');
    totalUncompressedBytes += content.length;
    const segments = entry.relativePath.split('/');
    const filePath = path.join(filesRoot, ...segments);
    const parentPath = path.dirname(filePath);
    fs.mkdirSync(parentPath, { recursive: true, mode: 0o700 });
    let current = filesRoot;
    for (const segment of segments.slice(0, -1)) {
      current = path.join(current, segment);
      fs.chmodSync(current, 0o700);
    }
    fs.writeFileSync(filePath, content, { mode: 0o600 });
    fs.chmodSync(filePath, 0o600);
    const isReadme = /^readme(?:\.(?:md|txt))?$/iu.test(path.posix.basename(entry.relativePath));
    return {
      relativePath: entry.relativePath,
      sizeBytes: content.length,
      sha256: sha256(content),
      family: entry.family || 'Synthetic family',
      language: entry.language || 'pt-BR',
      declaredVersion: entry.declaredVersion || 'synthetic-v1',
      declaredDate: entry.declaredDate || 'unknown',
      role: isReadme ? 'context' : 'source',
      mediaType: path.posix.extname(entry.relativePath).toLowerCase() === '.md' ? 'text/markdown' : 'text/plain',
    };
  });

  const manifest = {
    format: options.format || FORMAT,
    archiveSha256,
    archiveSizeBytes: 100,
    totalUncompressedBytes,
    fileCount: files.length,
    files,
  };
  const manifestPath = path.join(archiveDirectory, 'manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(manifestPath, 0o600);
  return { temporaryRoot, stagingRoot, archiveDirectory, filesRoot, manifestPath, manifest };
}

async function withFixture(entries, callback, options) {
  const fixture = makeFixture(entries, options);
  try {
    return await callback(fixture);
  } finally {
    fs.rmSync(fixture.temporaryRoot, { recursive: true, force: true });
  }
}

function createFakeSql({ users, initialSources = [] } = {}) {
  let sources = new Map(initialSources.map((row) => [
    `${row.archive_sha256}\0${row.relative_path}`,
    { ...row },
  ]));
  const state = { begins: 0, commits: 0, rollbacks: 0 };

  function makeTag(currentSources) {
    const tag = async (strings, ...values) => {
      const query = strings.join(' ? ').replace(/\s+/gu, ' ').trim();
      if (query.includes('SELECT current_database()')) return [{ database: 'eterverso' }];
      if (query.includes('FROM users')) {
        const selected = (users || [{ id: MODERATOR_ID, role: 'moderador', disabled_at: null }])
          .find((user) => user.id === values[0] && user.disabled_at === null
            && ['moderador', 'admin'].includes(user.role));
        return selected ? [{ id: selected.id }] : [];
      }
      if (query.startsWith('INSERT INTO wiki_sources')) {
        const [archive_sha256, relative_path, file_sha256, family, language,
          declared_version, declared_date, content, imported_by] = values;
        const key = `${archive_sha256}\0${relative_path}`;
        if (currentSources.has(key)) return [];
        const row = {
          id: crypto.randomUUID(), archive_sha256, relative_path, file_sha256,
          family, language, declared_version, declared_date, content, imported_by,
        };
        currentSources.set(key, row);
        return [{ id: row.id }];
      }
      if (query.startsWith('SELECT id, archive_sha256')) {
        const key = `${values[0]}\0${values[1]}`;
        const row = currentSources.get(key);
        return row ? [{ ...row }] : [];
      }
      throw new Error(`Unexpected fake SQL operation: ${query}`);
    };
    return tag;
  }

  const sql = makeTag(sources);
  sql.begin = async (callback) => {
    state.begins += 1;
    const transactionSources = new Map([...sources].map(([key, row]) => [key, { ...row }]));
    try {
      const result = await callback(makeTag(transactionSources));
      sources = transactionSources;
      state.commits += 1;
      return result;
    } catch (error) {
      state.rollbacks += 1;
      throw error;
    }
  };
  sql.end = async () => {};
  return {
    sql,
    state,
    get sources() { return [...sources.values()].map((row) => ({ ...row })); },
  };
}

function expectedRowFromFixture(fixture, relativePath, importedBy = MODERATOR_ID) {
  const entry = fixture.manifest.files.find((item) => item.relativePath === relativePath);
  const content = fs.readFileSync(path.join(fixture.filesRoot, ...relativePath.split('/')), 'utf8');
  return {
    archive_sha256: fixture.manifest.archiveSha256,
    relative_path: relativePath,
    file_sha256: entry.sha256,
    family: entry.family,
    language: entry.language,
    declared_version: entry.declaredVersion,
    declared_date: entry.declaredDate,
    content,
    imported_by: importedBy,
  };
}

test('WIKI-SOURCE-IMPORT validates all staged files and skips context README entries', async () => {
  await withFixture([
    { relativePath: 'characters/hero.md', content: 'Conteúdo sintético para teste.\n' },
    { relativePath: 'README.md', content: 'Contexto sintético; não é cânone.\n' },
  ], async (fixture) => {
    const staged = readPrivateStagedSources({ manifestPath: fixture.manifestPath });
    assert.equal(staged.fileCount, 2);
    assert.equal(staged.files.find((file) => file.relativePath === 'README.md').role, 'context');

    const database = createFakeSql();
    const report = await importStagedSources({
      manifestPath: fixture.manifestPath,
      importedBy: MODERATOR_ID,
      sql: database.sql,
    });

    assert.equal(report.imported, 1);
    assert.equal(report.reused, 0);
    assert.equal(report.contextFilesSkipped, 1);
    assert.equal(report.sourceIds.length, 1);
    assert.equal(database.sources.length, 1);
    assert.deepEqual(
      Object.fromEntries(Object.entries(database.sources[0]).filter(([key]) => key !== 'id')),
      expectedRowFromFixture(fixture, 'characters/hero.md'),
    );
    assert.equal(database.sources.some((row) => row.relative_path === 'README.md'), false);
  });
});

test('WIKI-SOURCE-IMPORT reuses the same source IDs on an exact second import', async () => {
  await withFixture([
    { relativePath: 'characters/hero.md', content: 'Conteúdo sintético estável.\n' },
  ], async (fixture) => {
    const database = createFakeSql({ users: [
      { id: MODERATOR_ID, role: 'moderador', disabled_at: null },
      { id: OTHER_MODERATOR_ID, role: 'admin', disabled_at: null },
    ] });
    const first = await importStagedSources({ manifestPath: fixture.manifestPath, importedBy: MODERATOR_ID, sql: database.sql });
    const second = await importStagedSources({ manifestPath: fixture.manifestPath, importedBy: OTHER_MODERATOR_ID, sql: database.sql });

    assert.equal(first.imported, 1);
    assert.equal(second.imported, 0);
    assert.equal(second.reused, 1);
    assert.deepEqual(second.sourceIds, [{
      id: first.sourceIds[0].id,
      relativePath: 'characters/hero.md',
      status: 'reused',
    }]);
    assert.equal(database.sources.length, 1);
    assert.equal(database.sources[0].imported_by, MODERATOR_ID, 'replay preserves original importer provenance');
    assert.equal(database.state.commits, 2);
  });
});

test('WIKI-SOURCE-IMPORT rolls back earlier inserts when a later conflict differs', async () => {
  await withFixture([
    { relativePath: 'a-first.md', content: 'Primeiro conteúdo sintético.\n' },
    { relativePath: 'z-conflict.md', content: 'Conteúdo novo sintético.\n' },
  ], async (fixture) => {
    const conflicting = expectedRowFromFixture(fixture, 'z-conflict.md');
    conflicting.family = 'Different stored metadata';
    conflicting.id = crypto.randomUUID();
    const database = createFakeSql({ initialSources: [conflicting] });

    await assert.rejects(
      importStagedSources({ manifestPath: fixture.manifestPath, importedBy: MODERATOR_ID, sql: database.sql }),
      /conflicts with an existing database record/,
    );
    assert.equal(database.state.rollbacks, 1);
    assert.equal(database.state.commits, 0);
    assert.deepEqual(database.sources, [conflicting]);
  });
});

test('WIKI-SOURCE-IMPORT compares every stored metadata and content field on conflict', async () => {
  await withFixture([
    { relativePath: 'characters/hero.md', content: 'Conteúdo sintético de origem.\n' },
  ], async (fixture) => {
    const baseline = expectedRowFromFixture(fixture, 'characters/hero.md');
    for (const field of [
      'file_sha256', 'family', 'language', 'declared_version', 'declared_date', 'content',
    ]) {
      const existing = { ...baseline, id: crypto.randomUUID() };
      existing[field] = field === 'imported_by' ? OTHER_MODERATOR_ID : `changed ${field}`;
      const database = createFakeSql({ initialSources: [existing] });
      await assert.rejects(
        importStagedSources({ manifestPath: fixture.manifestPath, importedBy: MODERATOR_ID, sql: database.sql }),
        /conflicts with an existing database record/,
        `must reject changed ${field}`,
      );
      assert.equal(database.state.rollbacks, 1, `${field} mismatch rolls back`);
      assert.deepEqual(database.sources, [existing], `${field} mismatch leaves the record unchanged`);
    }
  });
});

test('WIKI-SOURCE-IMPORT checks active staff identity inside the transaction', async () => {
  await withFixture([
    { relativePath: 'characters/hero.md', content: 'Conteúdo sintético.\n' },
  ], async (fixture) => {
    const database = createFakeSql({ users: [{ id: MODERATOR_ID, role: 'member', disabled_at: null }] });
    await assert.rejects(
      importStagedSources({ manifestPath: fixture.manifestPath, importedBy: MODERATOR_ID, sql: database.sql }),
      /not an existing active moderator or administrator/,
    );
    assert.equal(database.state.rollbacks, 1);
    assert.equal(database.sources.length, 0);
  });
});

test('WIKI-SOURCE-IMPORT rejects changed bytes and invalid paths before opening a transaction', async () => {
  await withFixture([
    { relativePath: 'characters/hero.md', content: 'Conteúdo sintético original.\n' },
  ], async (fixture) => {
    const filePath = path.join(fixture.filesRoot, 'characters', 'hero.md');
    fs.writeFileSync(filePath, 'Conteúdo sintético alterado.\n', { mode: 0o600 });
    fs.chmodSync(filePath, 0o600);
    const database = createFakeSql();
    await assert.rejects(
      importStagedSources({ manifestPath: fixture.manifestPath, importedBy: MODERATOR_ID, sql: database.sql }),
      /hash does not match/,
    );
    assert.equal(database.state.begins, 0);
  });

  await withFixture([
    { relativePath: 'characters/hero.md', content: 'Conteúdo sintético.\n' },
  ], async (fixture) => {
    fixture.manifest.files[0].relativePath = '../hero.md';
    fs.writeFileSync(fixture.manifestPath, `${JSON.stringify(fixture.manifest)}\n`, { mode: 0o600 });
    fs.chmodSync(fixture.manifestPath, 0o600);
    assert.throws(() => readPrivateStagedSources({ manifestPath: fixture.manifestPath }), /path is invalid/);
  });
});

test('WIKI-SOURCE-IMPORT rejects unsupported manifests, symlinks and broad permissions', async () => {
  await withFixture([
    { relativePath: 'characters/hero.md', content: 'Conteúdo sintético.\n' },
  ], (fixture) => {
    const invalidFormat = path.join(fixture.archiveDirectory, 'unsupported-manifest.json');
    assert.throws(() => readPrivateStagedSources({ manifestPath: invalidFormat }), /named manifest.json/);
    fixture.manifest.format = 'other-format';
    fs.writeFileSync(fixture.manifestPath, `${JSON.stringify(fixture.manifest)}\n`, { mode: 0o600 });
    fs.chmodSync(fixture.manifestPath, 0o600);
    assert.throws(() => readPrivateStagedSources({ manifestPath: fixture.manifestPath }), /format is unsupported/);
  });

  await withFixture([
    { relativePath: 'characters/hero.md', content: 'Conteúdo sintético.\n' },
  ], (fixture) => {
    fs.chmodSync(fixture.manifestPath, 0o644);
    assert.throws(() => readPrivateStagedSources({ manifestPath: fixture.manifestPath }), /permissions are too broad/);
  });

  await withFixture([
    { relativePath: 'characters/hero.md', content: 'Conteúdo sintético.\n' },
  ], (fixture) => {
    const sourcePath = path.join(fixture.filesRoot, 'characters', 'hero.md');
    const movedPath = `${sourcePath}.real`;
    fs.renameSync(sourcePath, movedPath);
    fs.symlinkSync(movedPath, sourcePath);
    assert.throws(() => readPrivateStagedSources({ manifestPath: fixture.manifestPath }), /unsupported filesystem entry/);
  });

  await withFixture([
    { relativePath: 'characters/hero.md', content: 'Conteúdo sintético.\n' },
  ], (fixture) => {
    fs.chmodSync(path.join(fixture.filesRoot, 'characters'), 0o755);
    assert.throws(() => readPrivateStagedSources({ manifestPath: fixture.manifestPath }), /permissions are too broad/);
  });

  await withFixture([
    { relativePath: 'characters/hero.md', content: 'Conteúdo sintético.\n' },
  ], (fixture) => {
    fs.chmodSync(fixture.stagingRoot, 0o755);
    assert.throws(() => readPrivateStagedSources({ manifestPath: fixture.manifestPath }), /permissions are too broad/);
  });

  await withFixture([
    { relativePath: 'characters/hero.md', content: 'Conteúdo sintético.\n' },
  ], (fixture) => {
    fs.chmodSync(path.join(fixture.filesRoot, 'characters', 'hero.md'), 0o644);
    assert.throws(() => readPrivateStagedSources({ manifestPath: fixture.manifestPath }), /permissions are too broad/);
  });
});

test('WIKI-SOURCE-IMPORT preserves the exact bytes of valid UTF-8 text including a BOM', async () => {
  const content = '\uFEFFSynthetic source with a BOM.\n';
  await withFixture([
    { relativePath: 'characters/hero.md', content },
  ], async (fixture) => {
    const staged = readPrivateStagedSources({ manifestPath: fixture.manifestPath });
    assert.equal(staged.files[0].content, content);
    assert.equal(sha256(Buffer.from(staged.files[0].content, 'utf8')), fixture.manifest.files[0].sha256);
  });
});

test('WIKI-SOURCE-IMPORT requires explicit PostgreSQL loopback target and moderator UUID', () => {
  assert.deepEqual(assertDatabaseTarget(
    'postgres://user:secret@127.0.0.1:55432/eterverso',
    'eterverso',
  ), { database: 'eterverso', host: '127.0.0.1' });
  assert.deepEqual(assertDatabaseTarget(
    'postgres://user:secret@localhost/eterverso_test',
    'eterverso_test',
  ), { database: 'eterverso_test', host: 'localhost' });
  assert.throws(() => assertDatabaseTarget('postgres://user:secret@example.test/db', 'db'), /loopback host/);
  assert.throws(() => assertDatabaseTarget('postgres://user:secret@127.0.0.1/db', 'other'), /does not match/);
  assert.throws(() => assertDatabaseTarget('postgres://user:secret@127.0.0.1/db', undefined), /explicit valid loopback database name/);
  assert.throws(() => parseArgs(['--manifest', 'manifest.json', '--database-name', 'eterverso']), /Usage:/);
  assert.throws(() => parseArgs([
    '--manifest', 'manifest.json', '--database-name', 'eterverso', '--imported-by', 'not-a-uuid',
  ]), /moderator or administrator UUID/);
  assert.deepEqual(parseArgs([
    '--manifest', 'manifest.json', '--database-name', 'eterverso', '--imported-by', MODERATOR_ID,
  ]), {
    help: false,
    manifestPath: 'manifest.json',
    databaseName: 'eterverso',
    importedBy: MODERATOR_ID,
    envFile: undefined,
  });
});

test('WIKI-SOURCE-IMPORT refuses a remote database before creating a SQL connection', async () => {
  let sqlWasCreated = false;
  await assert.rejects(main([
    '--manifest', '/unused/manifest.json',
    '--database-name', 'eterverso',
    '--imported-by', MODERATOR_ID,
  ], {
    DATABASE_URL: 'postgres://user:secret@example.test/eterverso',
  }, {
    sqlFactory() {
      sqlWasCreated = true;
      throw new Error('Unexpected SQL connection.');
    },
  }), /loopback host/);
  assert.equal(sqlWasCreated, false);
});
