'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  SELECTED_TABLES,
  assertTargetRecord,
  compareSnapshots,
  composeExecArgs,
  createPrivateBackupFile,
  parseArguments,
  parseIdentityOutput,
  quoteScratchIdentifier,
  quoteSqlLiteral,
  requireNode24,
  scratchDatabaseName,
} = require('../../scripts/test-db-backup-restore');

test('backup verification requires an explicit isolated test target', () => {
  assert.deepEqual(parseArguments(['--target=test']), { target: 'test' });
  assert.deepEqual(parseArguments(['--help']), { help: true });
  assert.throws(() => parseArguments([]), /explicit/);
  assert.throws(() => parseArguments(['--target=development']), /explicit/);
  assert.throws(() => parseArguments(['--target=test', '--force']), /explicit/);
});

test('target metadata must match the isolated service markers', () => {
  const target = {
    database: 'eterverso_test',
    host: '127.0.0.1',
    port: 55433,
    project: 'eterverso-test',
    service: 'db',
  };
  assert.deepEqual(assertTargetRecord(target), target);
  assert.throws(() => assertTargetRecord({ ...target, database: 'eterverso' }), /markers/);
  assert.throws(() => assertTargetRecord({ ...target, host: 'localhost' }), /markers/);
});

test('Node runtime guard accepts only the configured major version', () => {
  assert.doesNotThrow(() => requireNode24('24.0.0'));
  assert.throws(() => requireNode24('22.8.1'), /Node 24/);
});

test('scratch database identifiers are generated and SQL-safe', () => {
  const database = scratchDatabaseName('0123456789abcdef');
  assert.equal(database, 'eterverso_test_restore_0123456789abcdef');
  assert.equal(quoteScratchIdentifier(database), '"eterverso_test_restore_0123456789abcdef"');
  assert.throws(() => scratchDatabaseName('not-random'), /suffix/);
  assert.throws(() => quoteScratchIdentifier('eterverso_test'), /non-generated/);
  assert.equal(quoteSqlLiteral("a'b"), "'a''b'");
  assert.throws(() => quoteSqlLiteral('unsafe\0value'), /literal/);
});

test('backup files and their directory are created with private permissions', (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'eterverso-backup-test-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const directory = path.join(temporary, 'backup');
  const backupPath = createPrivateBackupFile(directory, 'a'.repeat(32));
  assert.equal(path.dirname(backupPath), directory);
  assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
  assert.equal(fs.statSync(backupPath).mode & 0o777, 0o600);
  assert.throws(() => createPrivateBackupFile(directory, 'a'.repeat(32)), /EEXIST/);
});

test('restore identity parser returns only the safe server identity fields', () => {
  const identity = parseIdentityOutput(JSON.stringify([
    'eterverso_test', 'eterverso_test', 170004,
    ['UTF8', 'C.UTF-8', 'C.UTF-8'],
    ['UTF8', 'C.UTF-8', 'C.UTF-8'],
  ]));
  assert.deepEqual(identity, {
    database: 'eterverso_test',
    user: 'eterverso_test',
    serverVersion: 170004,
    databaseLocale: ['UTF8', 'C.UTF-8', 'C.UTF-8'],
    templateLocale: ['UTF8', 'C.UTF-8', 'C.UTF-8'],
  });
  assert.throws(() => parseIdentityOutput('not json'), /identity/);
});

test('Compose invocation uses only the named test service and no DSN argument', () => {
  const args = composeExecArgs(['psql', '-d', 'eterverso_test']);
  assert.ok(args.includes('--project-name'));
  assert.ok(args.includes('eterverso-test'));
  assert.ok(args.some((value) => value.endsWith(`${path.sep}compose.test.yaml`)));
  assert.ok(args.some((value) => value.endsWith(path.join('.local', 'test', 'postgres.env'))));
  assert.ok(args.includes('db'));
  assert.ok(args.includes('eterverso_test'));
  assert.equal(args.some((value) => /postgres:\/\/|password=/i.test(value)), false);
});

test('comparison covers selected table counts/content hashes and credential hashes', () => {
  const source = {
    tables: Object.fromEntries(SELECTED_TABLES.map((table) => [table, { count: 2, sha256: `hash-${table}` }])),
    credentials: { count: 2, sha256: 'credential-hash' },
  };
  const restored = structuredClone(source);
  assert.deepEqual(compareSnapshots(source, restored), { matches: true, mismatches: [] });

  restored.tables.scene_turns.sha256 = 'different';
  restored.credentials.count = 1;
  assert.deepEqual(compareSnapshots(source, restored), {
    matches: false,
    mismatches: ['scene_turns rows', 'users password hashes'],
  });
});
