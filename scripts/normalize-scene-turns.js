'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const dotenv = require('dotenv');
const postgres = require('postgres');
const { normalizeSceneTurns } = require('../server/scene-turn-normalizer');

const ROOT = path.resolve(__dirname, '..');
const LOCAL_TEST = path.join(ROOT, '.local', 'test');

function usageError(message) {
  const error = new Error(message);
  error.safeToPrint = true;
  return error;
}

function parseArgs(args) {
  let targetName = null;
  let apply = false;
  for (const arg of args) {
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg === '--apply') {
      if (apply) throw usageError('Duplicate --apply flag.');
      apply = true;
      continue;
    }
    if (arg.startsWith('--target=')) {
      if (targetName !== null) throw usageError('Provide one explicit target.');
      targetName = arg.slice('--target='.length);
      continue;
    }
    throw usageError('Unknown argument.');
  }
  if (!targetName || !['test', 'development'].includes(targetName)) {
    throw usageError('Choose an explicit named target: --target=test or --target=development.');
  }
  if (!apply) throw usageError('Pass --apply to write normalized scene turns.');
  return { targetName, apply };
}

function readTarget(targetName) {
  if (targetName === 'development') {
    const envPath = path.join(ROOT, '.env');
    if (!fs.existsSync(envPath)) throw usageError('The existing .env file is missing; no environment file was created.');
    const databaseUrl = dotenv.parse(fs.readFileSync(envPath)).DATABASE_URL;
    if (!databaseUrl) throw usageError('The existing .env file does not define DATABASE_URL.');
    let parsed;
    try {
      parsed = new URL(databaseUrl);
    } catch (_error) {
      throw usageError('The development database URL is invalid.');
    }
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol)
        || !['127.0.0.1', 'localhost'].includes(parsed.hostname)
        || Number(parsed.port || 5432) !== 55432
        || decodeURIComponent(parsed.pathname.slice(1)) !== 'eterverso') {
      throw usageError('Development target must be the local eterverso database on loopback port 55432.');
    }
    return { databaseUrl, database: 'eterverso' };
  }

  const connectionPath = path.join(LOCAL_TEST, 'connection.env');
  if (!fs.existsSync(connectionPath)) {
    throw usageError('The isolated test database is not configured; run npm run test:env:up first.');
  }
  const databaseUrl = dotenv.parse(fs.readFileSync(connectionPath)).ETERVERSO_TEST_DATABASE_URL;
  if (!databaseUrl) throw usageError('The isolated test database configuration is incomplete.');
  let safety;
  try {
    safety = execFileSync(process.execPath, [path.join(__dirname, 'test-env.js'), 'assert'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (_error) {
    throw usageError('The isolated test database target failed its safety check.');
  }
  let safeTarget;
  try {
    safeTarget = JSON.parse(safety);
  } catch (_error) {
    throw usageError('The isolated test database safety check returned invalid metadata.');
  }
  if (safeTarget.database !== 'eterverso_test' || !Number.isInteger(safeTarget.port)) {
    throw usageError('The isolated test database target failed its safety check.');
  }
  return { databaseUrl, database: safeTarget.database };
}

function printReport(report) {
  const reasons = {};
  for (const issue of report.issues) reasons[issue.reason] = (reasons[issue.reason] || 0) + 1;
  process.stdout.write(`${JSON.stringify({
    scenesScanned: report.scenesScanned,
    scenesNormalized: report.scenesNormalized,
    scenesAlreadyNormalized: report.scenesAlreadyNormalized,
    scenesIncomplete: report.scenesIncomplete,
    scenesMissing: report.scenesMissing,
    scenesFailed: report.scenesFailed,
    turnsNormalized: report.turnsNormalized,
    issueCounts: reasons,
  })}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write('Usage: node scripts/normalize-scene-turns.js --target=test|development --apply\n');
    return;
  }
  if (Number(process.versions.node.split('.')[0]) !== 24) {
    throw usageError('Scene-turn normalization requires Node.js 24.');
  }

  const target = readTarget(args.targetName);
  const sql = postgres(target.databaseUrl, {
    prepare: false,
    max: 1,
    connect_timeout: 5,
    idle_timeout: 5,
    connection: { timezone: 'UTC' },
  });
  try {
    const identity = await sql`SELECT current_database() AS database`;
    if (!identity.length || identity[0].database !== target.database) {
      throw usageError('Connected database identity does not match the selected named target.');
    }
    printReport(await normalizeSceneTurns({ sql }));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (require.main === module) {
  main().catch((error) => {
    if (error && error.safeToPrint) process.stderr.write(`${error.message}\n`);
    else process.stderr.write('Scene-turn normalization failed; database details are withheld.\n');
    process.exitCode = 1;
  });
}
