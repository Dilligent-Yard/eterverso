'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const { DATABASE, PROJECT, SERVICE, USER } = require('./test-db-target');

const ROOT = path.resolve(__dirname, '..');
const COMPOSE_FILE = path.join(ROOT, 'compose.test.yaml');
const TEST_SECRETS_FILE = path.join(ROOT, '.local', 'test', 'postgres.env');
const BACKUP_DIRECTORY = path.join(ROOT, '.local', 'test', 'backup-restore');
const SELECTED_TABLES = Object.freeze(['users', 'personagens', 'wiki_posts', 'scene_turns']);
const USAGE = 'Usage: node scripts/test-db-backup-restore.js --target=test';

function requireNode24(version = process.versions.node) {
  if (Number(String(version).split('.')[0]) !== 24) {
    throw new Error(`This project uses Node 24 (.nvmrc); current runtime is ${version}. Run nvm use first.`);
  }
}

function parseArguments(argv) {
  if (argv.length === 1 && argv[0] === '--help') return { help: true };
  if (argv.length !== 1 || argv[0] !== '--target=test') {
    throw new Error(`${USAGE}; the isolated test target must be explicit.`);
  }
  return { target: 'test' };
}

function assertTargetRecord(target) {
  if (!target || target.database !== DATABASE || target.project !== PROJECT
      || target.service !== SERVICE || target.host !== '127.0.0.1'
      || !Number.isInteger(target.port) || target.port < 1) {
    throw new Error('The isolated test target did not match its expected database and Compose service markers.');
  }
  return target;
}

function scratchDatabaseName(suffix = crypto.randomBytes(8).toString('hex')) {
  if (typeof suffix !== 'string' || !/^[a-f0-9]{16}$/.test(suffix)) {
    throw new Error('Invalid scratch database suffix.');
  }
  return `eterverso_test_restore_${suffix}`;
}

function quoteScratchIdentifier(identifier) {
  if (typeof identifier !== 'string' || !/^eterverso_test_restore_[a-f0-9]{16}$/.test(identifier)) {
    throw new Error('Refusing to use a non-generated scratch database name.');
  }
  return `"${identifier}"`;
}

function quoteSqlLiteral(value) {
  if (typeof value !== 'string' || value.includes('\0')) throw new Error('Invalid SQL literal value.');
  return `'${value.replaceAll("'", "''")}'`;
}

function createPrivateBackupFile(directory = BACKUP_DIRECTORY, id = crypto.randomBytes(16).toString('hex')) {
  if (typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id)) throw new Error('Invalid backup identifier.');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  const backupPath = path.join(directory, `test-db-${id}.dump`);
  const descriptor = fs.openSync(backupPath, 'wx', 0o600);
  fs.closeSync(descriptor);
  return backupPath;
}

function composeExecArgs(commandArgs) {
  const secretFile = path.relative(ROOT, TEST_SECRETS_FILE);
  return [
    'compose', '--project-name', PROJECT, '-f', COMPOSE_FILE,
    '--env-file', secretFile, 'exec', '-T', '--env', 'PGTZ=UTC', SERVICE,
    ...commandArgs,
  ];
}

function runDockerSync(commandArgs, { stdout = 'ignore', outputFileDescriptor } = {}) {
  const stdio = ['ignore', outputFileDescriptor ?? stdout, 'ignore'];
  const result = spawnSync('docker', composeExecArgs(commandArgs), {
    cwd: ROOT,
    env: process.env,
    encoding: outputFileDescriptor === undefined ? 'utf8' : undefined,
    stdio,
  });
  if (result.error || result.status !== 0) {
    throw new Error('An isolated test database command failed. Command output is withheld.');
  }
  return typeof result.stdout === 'string' ? result.stdout.trim() : '';
}

function parseIdentityOutput(output) {
  let identity;
  try { identity = JSON.parse(output); } catch { throw new Error('Could not verify the database identity.'); }
  if (!Array.isArray(identity) || identity.length !== 5
      || typeof identity[0] !== 'string' || typeof identity[1] !== 'string'
      || !Number.isInteger(identity[2]) || !Array.isArray(identity[3])
      || !Array.isArray(identity[4])) {
    throw new Error('Could not verify the database identity.');
  }
  return {
    database: identity[0],
    user: identity[1],
    serverVersion: identity[2],
    databaseLocale: identity[3],
    templateLocale: identity[4],
  };
}

function getDatabaseIdentity(database) {
  const sql = `SELECT json_build_array(
    current_database(), current_user, current_setting('server_version_num')::int,
    (SELECT json_build_array(pg_encoding_to_char(encoding), datcollate, datctype)
      FROM pg_database WHERE datname = current_database()),
    (SELECT json_build_array(pg_encoding_to_char(encoding), datcollate, datctype)
      FROM pg_database WHERE datname = 'template0')
  )::text`;
  const output = runDockerSync([
    'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', USER, '-d', database, '-c', sql,
  ], { stdout: 'pipe' });
  const identity = parseIdentityOutput(output);
  if (identity.database !== database || identity.user !== USER
      || Math.floor(identity.serverVersion / 10000) !== 17) {
    throw new Error('Database identity or PostgreSQL major version did not match the isolated test service.');
  }
  if (JSON.stringify(identity.databaseLocale) !== JSON.stringify(identity.templateLocale)
      || identity.databaseLocale[0] !== 'UTF8') {
    throw new Error('The selected test database locale cannot be cloned safely from template0.');
  }
  return identity;
}

async function runDockerCapture(commandArgs, onChunk) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', composeExecArgs(commandArgs), {
      cwd: ROOT,
      env: process.env,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let count = 0;
    child.stdout.on('data', (chunk) => {
      if (onChunk) onChunk(chunk);
      count += chunk.length;
    });
    child.once('error', () => reject(new Error('Could not start an isolated test database command.')));
    child.once('close', (status) => {
      if (status !== 0) return reject(new Error('An isolated test database command failed. Command output is withheld.'));
      resolve(count);
    });
  });
}

async function fingerprintCopy(database, sql) {
  const digest = crypto.createHash('sha256');
  let rowCount = 0;
  await runDockerCapture([
    'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', USER, '-d', database, '-c', sql,
  ], (chunk) => {
    digest.update(chunk);
    for (const byte of chunk) if (byte === 0x0a) rowCount += 1;
  });
  return { count: rowCount, sha256: digest.digest('hex') };
}

async function snapshotSelectedData(database) {
  getDatabaseIdentity(database);
  const tables = {};
  for (const table of SELECTED_TABLES) {
    const quotedTable = `"${table}"`;
    tables[table] = await fingerprintCopy(database,
      `COPY (SELECT to_jsonb(t)::text FROM public.${quotedTable} AS t ORDER BY t.id) TO STDOUT`);
  }
  const credentials = await fingerprintCopy(database,
    'COPY (SELECT json_build_array(id, password_hash)::text FROM public."users" ORDER BY id) TO STDOUT');
  return { tables, credentials };
}

function compareSnapshots(source, restored) {
  const mismatches = [];
  for (const table of SELECTED_TABLES) {
    if (!source?.tables?.[table] || !restored?.tables?.[table]
        || source.tables[table].count !== restored.tables[table].count
        || source.tables[table].sha256 !== restored.tables[table].sha256) {
      mismatches.push(`${table} rows`);
    }
  }
  if (!source?.credentials || !restored?.credentials
      || source.credentials.count !== restored.credentials.count
      || source.credentials.sha256 !== restored.credentials.sha256) {
    mismatches.push('users password hashes');
  }
  return { matches: mismatches.length === 0, mismatches };
}

function runTestTargetGuard() {
  const result = spawnSync(process.execPath, [path.join(__dirname, 'test-env.js'), 'assert'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (result.error || result.status !== 0) {
    throw new Error('The isolated test target guard failed; no backup or restore database was created.');
  }
  let target;
  try { target = JSON.parse(result.stdout); } catch { throw new Error('The isolated test target guard returned invalid metadata.'); }
  return assertTargetRecord(target);
}

function databaseExists(database) {
  const name = quoteSqlLiteral(database);
  const output = runDockerSync([
    'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', USER, '-d', 'postgres',
    '-c', `SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = ${name})`,
  ], { stdout: 'pipe' });
  if (!['t', 'f'].includes(output)) throw new Error('Could not verify scratch database availability.');
  return output === 't';
}

function createScratchDatabase(database) {
  runDockerSync([
    'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-U', USER, '-d', 'postgres',
    '-c', `CREATE DATABASE ${quoteScratchIdentifier(database)} WITH TEMPLATE template0`,
  ]);
}

function dropScratchDatabase(database) {
  const name = quoteSqlLiteral(database);
  runDockerSync([
    'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-U', USER, '-d', 'postgres',
    '-c', `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${name} AND pid <> pg_backend_pid()`,
  ]);
  runDockerSync([
    'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-U', USER, '-d', 'postgres',
    '-c', `DROP DATABASE ${quoteScratchIdentifier(database)}`,
  ]);
}

function dumpDatabase(database, backupPath) {
  const fileDescriptor = fs.openSync(backupPath, 'r+');
  try {
    fs.ftruncateSync(fileDescriptor, 0);
    runDockerSync([
      'pg_dump', '--format=custom', '--no-owner', '--no-acl', '--username', USER, '--dbname', database,
    ], { outputFileDescriptor: fileDescriptor });
  } finally {
    fs.closeSync(fileDescriptor);
  }
  const stat = fs.statSync(backupPath);
  if (!stat.isFile() || stat.size === 0 || (stat.mode & 0o777) !== 0o600) {
    throw new Error('The restricted backup file was empty or had unexpected permissions.');
  }
  return stat.size;
}

async function restoreDatabase(database, backupPath) {
  const child = spawn('docker', composeExecArgs([
    'pg_restore', '--exit-on-error', '--no-owner', '--no-acl', '--username', USER, '--dbname', database,
  ]), {
    cwd: ROOT,
    env: process.env,
    stdio: ['pipe', 'ignore', 'ignore'],
  });
  const stream = fs.createReadStream(backupPath);
  let inputError = null;
  stream.once('error', (error) => { inputError = error; });
  child.stdin.once('error', (error) => { if (error.code !== 'EPIPE') inputError = error; });
  try {
    await Promise.all([
      pipeline(stream, child.stdin).catch((error) => { if (error.code !== 'EPIPE') inputError = error; }),
      new Promise((resolve, reject) => {
        child.once('error', () => reject(new Error('Could not start the isolated restore command.')));
        child.once('close', (status) => status === 0
          ? resolve()
          : reject(new Error('The isolated backup restore failed. Command output is withheld.')));
      }),
    ]);
  } finally {
    stream.destroy();
  }
  if (inputError) throw new Error('Could not stream the restricted backup into the isolated restore database.');
}

async function main(argv = process.argv.slice(2)) {
  requireNode24();
  const args = parseArguments(argv);
  if (args.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  const target = runTestTargetGuard();
  const sourceIdentity = getDatabaseIdentity(target.database);
  let scratch = null;
  let scratchCreated = false;
  let backupPath = null;
  let primaryError = null;
  let report = null;

  try {
    const before = await snapshotSelectedData(target.database);
    backupPath = createPrivateBackupFile();
    const backupBytes = dumpDatabase(target.database, backupPath);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = scratchDatabaseName();
      if (!databaseExists(candidate)) {
        scratch = candidate;
        break;
      }
    }
    if (!scratch) throw new Error('Could not allocate a unique isolated restore database.');

    createScratchDatabase(scratch);
    scratchCreated = true;
    await restoreDatabase(scratch, backupPath);
    const restored = await snapshotSelectedData(scratch);
    const after = await snapshotSelectedData(target.database);
    const sourceStayedStable = compareSnapshots(before, after);
    if (!sourceStayedStable.matches) {
      throw new Error('Selected source data changed during verification; rerun with the isolated test database idle.');
    }
    const comparison = compareSnapshots(before, restored);
    if (!comparison.matches) {
      throw new Error(`Restored selected counts or content hashes differed: ${comparison.mismatches.join(', ')}.`);
    }
    report = {
      target: { project: target.project, service: target.service, database: target.database, host: target.host, port: target.port },
      postgresMajor: Math.floor(sourceIdentity.serverVersion / 10000),
      restoredTo: scratch,
      backup: { format: 'custom', bytes: backupBytes, fileMode: '0600', directoryMode: '0700' },
      selectedData: { ...before, verifiedSourceStable: true, restoredMatches: true },
    };
  } catch (error) {
    primaryError = error;
  }

  const cleanupErrors = [];
  if (scratchCreated && scratch) {
    try { dropScratchDatabase(scratch); } catch { cleanupErrors.push('scratch database cleanup failed'); }
  }
  if (backupPath) {
    try { fs.unlinkSync(backupPath); } catch { cleanupErrors.push('restricted backup cleanup failed'); }
  }

  if (primaryError) {
    const extra = cleanupErrors.length ? ` Also, ${cleanupErrors.join(' and ')}.` : '';
    throw new Error(`${primaryError.message}${extra}`);
  }
  if (cleanupErrors.length) throw new Error(cleanupErrors.join(' and '));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
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
};
