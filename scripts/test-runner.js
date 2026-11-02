'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const dotenv = require('dotenv');
const crypto = require('node:crypto');
const postgres = require('postgres');

const ROOT = path.resolve(__dirname, '..');

function requireNode24() {
  if (Number(process.versions.node.split('.')[0]) !== 24) {
    throw new Error(`This project uses Node 24 (.nvmrc); current runtime is ${process.version}. Run nvm use first.`);
  }
}

function filesBelow(directory, pattern) {
  if (!fs.existsSync(directory)) return [];
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...filesBelow(fullPath, pattern));
    else if (pattern.test(entry.name)) result.push(path.relative(ROOT, fullPath));
  }
  return result.sort();
}

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Test command exited with status ${result.status || 'unknown'}.`);
}

function runNodeTests(kind, env = process.env) {
  const directory = path.join(ROOT, 'tests', kind);
  const files = filesBelow(directory, kind === 'browser' ? /\.spec\.js$/ : /\.test\.js$/);
  if (files.length === 0) {
    throw new Error(`No ${kind} tests exist yet; refusing to report this gate as passed.`);
  }
  if (kind === 'browser') {
    const cli = path.join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js');
    if (!fs.existsSync(cli)) throw new Error('Playwright is not installed. Run npm ci.');
    run(process.execPath, [cli, 'test', `--config=${path.join(ROOT, 'tests/browser/playwright.config.js')}`, ...files], env);
    return;
  }
  const args = ['--test'];
  if (kind === 'integration') args.push('--test-concurrency=1');
  run(process.execPath, [...args, ...files], env);
}

function loadTestConnection() {
  const configFile = path.join(ROOT, '.local', 'test', 'connection.env');
  if (!fs.existsSync(configFile)) throw new Error('Run npm run test:env:up before integration tests.');
  const config = dotenv.parse(fs.readFileSync(configFile));
  if (!config.ETERVERSO_TEST_DATABASE_URL) throw new Error('Private isolated test DSN is missing.');

  // The assertion inspects Docker ownership and the loopback/database markers
  // before a test process receives the test DSN.
  execFileSync(process.execPath, [path.join(__dirname, 'test-env.js'), 'assert'], {
    cwd: ROOT,
    stdio: 'ignore',
  });
  return config.ETERVERSO_TEST_DATABASE_URL;
}

function testChildEnvironment(testUrl) {
  const env = { ...process.env };
  delete env.DATABASE_URL;
  delete env.DEV_DATABASE_URL;
  if (testUrl) env.ETERVERSO_TEST_DATABASE_URL = testUrl;
  return env;
}

async function readDevSentinel() {
  const envFile = path.join(ROOT, '.env');
  if (!fs.existsSync(envFile)) throw new Error('Cannot verify the development database sentinel because the existing .env is missing.');
  const config = dotenv.parse(fs.readFileSync(envFile));
  if (!config.DATABASE_URL) throw new Error('Cannot verify the development database sentinel without DATABASE_URL.');
  const target = new URL(config.DATABASE_URL);
  if (!['127.0.0.1', 'localhost'].includes(target.hostname)
      || Number(target.port || 5432) !== 55432
      || decodeURIComponent(target.pathname.slice(1)) !== 'eterverso') {
    throw new Error('Development sentinel check only accepts the local eterverso database on loopback port 55432.');
  }

  const sql = postgres(config.DATABASE_URL, { prepare: false, max: 1, connect_timeout: 5, idle_timeout: 1, connection: { timezone: 'UTC' } });
  try {
    const tables = (await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name`).map((row) => row.table_name);
    const ledgerExists = await sql`SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS present`;
    const ledger = ledgerExists[0].present
      ? await sql`SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id`
      : [];
    const columnRows = await sql`
      SELECT table_name, column_name, data_type, is_nullable, column_default
      FROM information_schema.columns WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position`;
    const constraints = await sql`
      SELECT c.relname AS table_name, x.conname, x.contype, pg_get_constraintdef(x.oid) AS definition
      FROM pg_constraint x JOIN pg_class c ON c.oid = x.conrelid
      WHERE x.connamespace = 'public'::regnamespace ORDER BY c.relname, x.conname`;
    const counts = {};
    const rowHashes = {};
    for (const table of tables) {
      if (!/^[a-z_][a-z0-9_]*$/.test(table)) throw new Error('Unexpected development table name in sentinel query.');
      const rows = await sql.unsafe(`
        SELECT count(*)::bigint AS count,
          COALESCE(md5(string_agg(md5(row_to_json(t)::text), '' ORDER BY md5(row_to_json(t)::text))), md5('')) AS digest
        FROM public."${table.replaceAll('"', '""')}" AS t`);
      counts[table] = String(rows[0].count);
      rowHashes[table] = rows[0].digest;
    }
    const canonical = JSON.stringify({ tables, ledger, counts, rowHashes, columnRows, constraints });
    return crypto.createHash('sha256').update(canonical).digest('hex');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function withDevSentinel(runSuites) {
  return readDevSentinel().then(async (before) => {
    let failure;
    try { runSuites(); } catch (err) { failure = err; }
    const after = await readDevSentinel();
    if (before !== after) throw new Error('Development database sentinel changed while isolated tests ran; investigate before continuing.');
    if (failure) throw failure;
    console.log('Development database sentinel unchanged.');
  });
}

function main() {
  requireNode24();
  const command = process.argv[2];
  if (command === 'unit') return runNodeTests('unit', testChildEnvironment());
  if (command === 'integration') {
    const testUrl = loadTestConnection();
    return withDevSentinel(() => runNodeTests('integration', testChildEnvironment(testUrl)));
  }
  if (command === 'browser') {
    const testUrl = loadTestConnection();
    return withDevSentinel(() => runNodeTests('browser', testChildEnvironment(testUrl)));
  }
  if (command === 'default') {
    const testUrl = loadTestConnection();
    return withDevSentinel(() => {
      runNodeTests('unit', testChildEnvironment());
      runNodeTests('integration', testChildEnvironment(testUrl));
    });
  }
  if (command === 'all') {
    const testUrl = loadTestConnection();
    return withDevSentinel(() => {
      runNodeTests('unit', testChildEnvironment());
      runNodeTests('integration', testChildEnvironment(testUrl));
      runNodeTests('browser', testChildEnvironment(testUrl));
    });
  }
  throw new Error('Usage: node scripts/test-runner.js <unit|integration|browser|default|all>');
}

Promise.resolve().then(main).catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
