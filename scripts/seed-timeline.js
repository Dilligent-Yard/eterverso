'use strict';

const fs = require('node:fs');
const path = require('node:path');
const postgres = require('postgres');
const { assertBuildOutput } = require('./check-build');

const ROOT = path.resolve(__dirname, '..');
const SEED_FILE = path.join(ROOT, 'server', 'timeline-seed.json');
const TARGETS = new Set(['development', 'test', 'sandbox']);

function publicError(message) {
  const error = new Error(message);
  error.safeToPrint = true;
  return error;
}

function parseArguments(args) {
  let confirmEmpty = false;
  let target;
  for (const arg of args) {
    if (arg === '--confirm-empty') {
      if (confirmEmpty) throw publicError('--confirm-empty may be supplied only once.');
      confirmEmpty = true;
    } else if (arg.startsWith('--target=')) {
      if (target !== undefined) throw publicError('--target may be supplied only once.');
      target = arg.slice('--target='.length);
      if (!TARGETS.has(target)) {
        throw publicError('Choose --target=development, --target=test, or --target=sandbox.');
      }
    } else {
      throw publicError(`Unknown timeline seed argument: ${arg}.`);
    }
  }
  if (!confirmEmpty) {
    throw publicError('Timeline seeding requires the explicit --confirm-empty flag.');
  }
  return { confirmEmpty, target };
}

function readSeedItems(file = SEED_FILE) {
  if (!fs.existsSync(file)) {
    throw publicError(`Committed timeline seed is missing: ${path.relative(ROOT, file)}.`);
  }
  let items;
  try {
    items = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw publicError('Committed timeline seed is not valid JSON.');
  }
  if (!Array.isArray(items) || items.length === 0) {
    throw publicError('Committed timeline seed must be a non-empty array.');
  }
  return items;
}

function assertTimelineEmpty(total) {
  if (!Number.isInteger(total) || total < 0) {
    throw publicError(`Invalid timeline row count: ${total}.`);
  }
  if (total !== 0) {
    throw publicError(`Timeline already contains ${total} event(s); refusing to seed an existing timeline.`);
  }
}

async function resolveConnection(parsed, environment = process.env) {
  const suppliedUrl = typeof environment.DATABASE_URL === 'string' && environment.DATABASE_URL.trim();
  if (parsed.target && suppliedUrl) {
    throw publicError('Choose either --target=... or an explicit DATABASE_URL, not both.');
  }
  if (parsed.target) {
    const { readTarget } = require('./db-migrate');
    const target = await readTarget(parsed.target);
    return {
      databaseUrl: target.databaseUrl,
      database: target.database,
      label: target.label,
      guard: target,
    };
  }
  if (!suppliedUrl) {
    throw publicError('Provide an explicit DATABASE_URL or --target=development|test|sandbox.');
  }

  let url;
  try {
    url = new URL(suppliedUrl);
  } catch {
    throw publicError('DATABASE_URL is not a valid URL.');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw publicError('DATABASE_URL must use the postgres or postgresql protocol.');
  }
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!database) throw publicError('DATABASE_URL must name a database.');
  return { databaseUrl: suppliedUrl, database, label: 'DATABASE_URL', guard: null };
}

async function assertConnectedTarget(sql, connection) {
  const rows = await sql`
    SELECT current_database() AS database, current_user AS role,
      inet_server_addr()::text AS address, inet_server_port() AS server_port,
      current_setting('server_version_num') AS version`;
  const identity = rows[0];
  if (!identity || identity.database !== connection.database) {
    throw publicError('Connected database does not match the selected target.');
  }
  if (connection.guard && connection.guard.label === 'sandbox') {
    const publicSandboxTarget = require('./public-sandbox-target');
    publicSandboxTarget.assertConnectedIdentityRow({
      database: identity.database,
      role: identity.role,
      address: identity.address,
      port: identity.server_port,
      version: identity.version,
    }, connection.guard);
  }
}

async function countTimeline(sql) {
  const table = await sql`SELECT to_regclass('public.timeline_events') IS NOT NULL AS present`;
  if (!table[0] || !table[0].present) {
    throw publicError('The timeline_events table is missing. Apply the reviewed migrations through 0017_timeline_events first.');
  }
  const rows = await sql`SELECT count(*)::int AS total FROM timeline_events`;
  return Number(rows[0] ? rows[0].total : 0);
}

async function main(args = process.argv.slice(2), environment = process.env) {
  const parsed = parseArguments(args);
  const seedItems = readSeedItems();
  const required = ['timeline'];
  if (parsed.target === 'sandbox') required.push('publicSandboxTarget');
  assertBuildOutput({ required });

  const connection = await resolveConnection(parsed, environment);
  const sql = postgres(connection.databaseUrl, {
    prepare: false,
    max: 1,
    connect_timeout: 5,
    idle_timeout: 1,
    connection: { timezone: 'UTC' },
  });
  try {
    await assertConnectedTarget(sql, connection);
    const before = await countTimeline(sql);
    assertTimelineEmpty(before);

    // The adapter and typed helper only count and insert; no DDL is run here.
    const { seedTimelineIfEmpty } = require('../server/timeline');
    await seedTimelineIfEmpty(sql);

    const after = await countTimeline(sql);
    const inserted = after - before;
    console.log(`Timeline seed target: ${connection.label} (${connection.database}).`);
    console.log(`Timeline events: seed=${seedItems.length} before=${before} inserted=${inserted} after=${after}.`);
    if (after !== seedItems.length) {
      throw publicError(`Timeline seed incomplete: expected ${seedItems.length} events after seeding, found ${after}.`);
    }
    return { before, inserted, after, seed: seedItems.length, database: connection.database, label: connection.label };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

module.exports = {
  main,
  parseArguments,
  readSeedItems,
  assertTimelineEmpty,
  resolveConnection,
  countTimeline,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.safeToPrint ? error.message : (error && error.message) || 'Timeline seed failed.');
    process.exitCode = 1;
  });
}
