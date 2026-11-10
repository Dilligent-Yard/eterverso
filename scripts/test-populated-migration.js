'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const dotenv = require('dotenv');
const postgres = require('postgres');
const { classifySchema, inspectDatabase, migrationHistory } = require('./db-migrate');
const { DATABASE, PROJECT, SERVICE, USER } = require('./test-db-target');

const ROOT = path.resolve(__dirname, '..');
const TEST_DIRECTORY = path.join(ROOT, '.local', 'test');
const CONNECTION_FILE = path.join(TEST_DIRECTORY, 'connection.env');
const SECRET_FILE = path.join(TEST_DIRECTORY, 'postgres.env');
const DEVELOPMENT_FILE = path.join(ROOT, '.env');
const BASELINE_DUMP = path.join(ROOT, '.local', 'development-baseline.dump');
const COMPOSE_FILE = path.join(ROOT, 'compose.test.yaml');
const REPORT_DIRECTORY = path.join(TEST_DIRECTORY, 'reports');
const SCRATCH_NAME = /^eterverso_test_restore_[a-f0-9]{16}$/u;
const FIXTURE = Object.freeze({
  user: 'a1000000-0000-4000-8000-000000000001',
  category: 'a2000000-0000-4000-8000-000000000002',
  thread: 'a3000000-0000-4000-8000-000000000003',
  post: 'a4000000-0000-4000-8000-000000000004',
  character: 'a5000000-0000-4000-8000-000000000005',
  comment: 'a6000000-0000-4000-8000-000000000006',
  scene: 'a7000000-0000-4000-8000-000000000007',
});

function requireNode24() {
  if (Number(process.versions.node.split('.')[0]) !== 24) {
    throw new Error('This migration check requires Node.js 24.');
  }
}

function parseArgs(args) {
  if (args.length !== 1 || args[0] !== '--target=test') {
    throw new Error('Usage: node scripts/test-populated-migration.js --target=test');
  }
}

function readSafeTestUrl() {
  if (!fs.existsSync(CONNECTION_FILE) || !fs.existsSync(SECRET_FILE) || !fs.existsSync(DEVELOPMENT_FILE)) {
    throw new Error('Required local database configuration is missing; no configuration was created or replaced.');
  }
  const connection = dotenv.parse(fs.readFileSync(CONNECTION_FILE));
  const development = dotenv.parse(fs.readFileSync(DEVELOPMENT_FILE));
  if (!connection.ETERVERSO_TEST_DATABASE_URL || !development.DATABASE_URL
      || connection.ETERVERSO_TEST_DATABASE_URL === development.DATABASE_URL) {
    throw new Error('The test and development database targets could not be separated safely.');
  }
  const checked = JSON.parse(execFileSync(process.execPath, [path.join(__dirname, 'test-env.js'), 'assert'], {
    cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  }));
  const parsed = new URL(connection.ETERVERSO_TEST_DATABASE_URL);
  if (parsed.hostname !== '127.0.0.1'
      || Number(parsed.port) !== checked.port
      || decodeURIComponent(parsed.pathname.slice(1)) !== DATABASE
      || decodeURIComponent(parsed.username) !== USER
      || checked.database !== DATABASE || checked.project !== PROJECT || checked.service !== SERVICE) {
    throw new Error('The isolated test target did not match its repository ownership markers.');
  }
  const dumpStat = fs.statSync(BASELINE_DUMP);
  if (!dumpStat.isFile() || dumpStat.size === 0 || (dumpStat.mode & 0o777) !== 0o600) {
    throw new Error('The restricted verified 0006 baseline dump is missing or has unsafe permissions.');
  }
  return { databaseUrl: connection.ETERVERSO_TEST_DATABASE_URL, target: checked };
}

function quoteScratchDatabase(name) {
  if (typeof name !== 'string' || !SCRATCH_NAME.test(name)) {
    throw new Error('Refusing to create or remove a database outside the generated scratch-name pattern.');
  }
  return `"${name}"`;
}

function composeArgs(args) {
  return [
    'compose', '--project-name', PROJECT, '-f', COMPOSE_FILE,
    '--env-file', path.relative(ROOT, SECRET_FILE), 'exec', '-T', SERVICE,
    ...args,
  ];
}

function restoreBaseline(name) {
  const result = spawnSync('docker', composeArgs([
    'pg_restore', '--exit-on-error', '--no-owner', '--no-acl',
    '--username', USER, '--dbname', name,
  ]), {
    cwd: ROOT,
    input: fs.readFileSync(BASELINE_DUMP),
    encoding: 'buffer',
    stdio: ['pipe', 'ignore', 'ignore'],
  });
  if (result.error || result.status !== 0) {
    throw new Error('The restricted baseline could not be restored to the isolated scratch database.');
  }
}

async function connect(databaseUrl) {
  const sql = postgres(databaseUrl, {
    prepare: false, max: 1, connect_timeout: 5, idle_timeout: 2,
    connection: { timezone: 'UTC' },
  });
  return sql;
}

function withDatabaseName(databaseUrl, name) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

async function assertDatabaseIdentity(sql, expected) {
  const rows = await sql`SELECT current_database() AS database, current_user AS username`;
  if (rows[0]?.database !== expected || rows[0]?.username !== USER) {
    throw new Error('The database connection identity did not match the selected isolated target.');
  }
}

async function seedSyntheticBaseline(sql) {
  const turns = [
    { id: 101, authorId: 501, content: 'Synthetic legacy turn one.', date: '01/01/2025' },
    { id: 102, authorId: 502, content: 'Synthetic legacy turn two.', date: '02/01/2025' },
  ];
  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO public.users (
        id, username, email, password_hash, role, avatar, title, bio,
        posts_count, adm_tentativa_usada, join_date, is_staff, created_at, updated_at
      ) VALUES (
        ${FIXTURE.user}, 'mig02-synthetic-user', 'mig02-synthetic@example.test',
        'synthetic-credential-hash-never-valid', 'member', '', 'Synthetic member',
        'Migration fixture only.', 1, false, '2025-01-01', false,
        '2025-01-02 03:04:05', '2025-01-02 03:04:05'
      )`;
    await tx`
      INSERT INTO public.categories (id, name, description, created_at, updated_at)
      VALUES (${FIXTURE.category}, 'MIG02 synthetic category', 'Synthetic migration fixture.',
        '2025-01-02 03:04:05', '2025-01-02 03:04:05')`;
    await tx`
      INSERT INTO public.threads (id, category_id, author_id, title, tag, pinned, views, created_at, updated_at)
      VALUES (${FIXTURE.thread}, ${FIXTURE.category}, ${FIXTURE.user}, 'MIG02 synthetic topic', 'test', false, 0,
        '2025-01-02 03:04:05', '2025-01-02 03:04:05')`;
    await tx`
      INSERT INTO public.posts (id, thread_id, author_id, content, edited, created_at, updated_at)
      VALUES (${FIXTURE.post}, ${FIXTURE.thread}, ${FIXTURE.user}, '<p>Synthetic opening post.</p>', false,
        '2025-01-02 03:04:05', '2025-01-02 03:04:05')`;
    await tx`
      INSERT INTO public.personagens (
        id, author_id, nome, categoria, titulo, raca, faccao, status, imagem,
        descricao, stats, mascara_tier, skills, blocks, theme, created_at, updated_at
      ) VALUES (
        ${FIXTURE.character}, ${FIXTURE.user}, 'MIG02 synthetic character', 'Fixture',
        'Character fixture', 'Synthetic', 'Migration test', 'Active', '',
        'Synthetic character description.', ${tx.json({ power: 7 })}, 'Synthetic tier',
        ${tx.json(['synthetic-skill'])}, ${tx.json([{ type: 'paragraph', content: 'Synthetic block.' }])},
        ${tx.json({ color: 'synthetic' })}, '2025-01-02 03:04:05', '2025-01-02 03:04:05'
      )`;
    await tx`
      INSERT INTO public.comments (id, personagem_id, author_id, content, created_at, updated_at)
      VALUES (${FIXTURE.comment}, ${FIXTURE.character}, ${FIXTURE.user}, 'Synthetic character comment.',
        '2025-01-02 03:04:05', '2025-01-02 03:04:05')`;
    await tx`
      INSERT INTO public.wiki_posts (
        id, author_id, titulo, subtitulo, categoria, status, resumo, banner,
        descricao, theme, infobox, blocks, turns, created_at, updated_at
      ) VALUES (
        ${FIXTURE.scene}, ${FIXTURE.user}, 'MIG02 synthetic scene', 'Scene fixture',
        'Cena de RPG', 'Em Andamento', 'Synthetic scene summary.', '',
        'Synthetic scene description.', ${tx.json({ tone: 'synthetic' })},
        ${tx.json({ location: 'Synthetic place' })},
        ${tx.json([{ type: 'paragraph', content: 'Synthetic scene block.' }])},
        ${tx.json(turns)}, '2025-01-02 03:04:05', '2025-01-02 03:04:05'
      )`;
  });
}

async function capturePreservedRows(sql) {
  const time = (column) => `to_char(${column}::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US')`;
  const tables = {
    users: await sql`
      SELECT id, username, email, password_hash, role, avatar, title, bio, posts_count,
        adm_tentativa_usada, join_date::text AS join_date, is_staff,
        ${sql.unsafe(time('created_at'))} AS created_at_utc,
        ${sql.unsafe(time('updated_at'))} AS updated_at_utc
      FROM public.users WHERE id = ${FIXTURE.user} ORDER BY id`,
    categories: await sql`
      SELECT id, name, description,
        ${sql.unsafe(time('created_at'))} AS created_at_utc,
        ${sql.unsafe(time('updated_at'))} AS updated_at_utc
      FROM public.categories WHERE id = ${FIXTURE.category} ORDER BY id`,
    threads: await sql`
      SELECT id, category_id, author_id, title, tag, pinned, views,
        ${sql.unsafe(time('created_at'))} AS created_at_utc,
        ${sql.unsafe(time('updated_at'))} AS updated_at_utc
      FROM public.threads WHERE id = ${FIXTURE.thread} ORDER BY id`,
    posts: await sql`
      SELECT id, thread_id, author_id, content, edited,
        ${sql.unsafe(time('created_at'))} AS created_at_utc,
        ${sql.unsafe(time('updated_at'))} AS updated_at_utc
      FROM public.posts WHERE id = ${FIXTURE.post} ORDER BY id`,
    characters: await sql`
      SELECT id, author_id, nome, categoria, titulo, raca, faccao, status, imagem,
        descricao, stats, mascara_tier, skills, blocks, theme, created_at::text, updated_at::text
      FROM public.personagens WHERE id = ${FIXTURE.character} ORDER BY id`,
    comments: await sql`
      SELECT id, personagem_id, author_id, content, created_at::text, updated_at::text
      FROM public.comments WHERE id = ${FIXTURE.comment} ORDER BY id`,
    scenes: await sql`
      SELECT id, author_id, titulo, subtitulo, categoria, status, resumo, banner,
        descricao, theme, infobox, blocks, turns, created_at::text, updated_at::text
      FROM public.wiki_posts WHERE id = ${FIXTURE.scene} ORDER BY id`,
    relationships: await sql`
      SELECT 'character-author' AS relation, id::text AS source_id, author_id::text AS target_id
        FROM public.personagens WHERE id = ${FIXTURE.character}
      UNION ALL
      SELECT 'comment-character', id::text, personagem_id::text FROM public.comments WHERE id = ${FIXTURE.comment}
      UNION ALL
      SELECT 'comment-author', id::text, author_id::text FROM public.comments WHERE id = ${FIXTURE.comment}
      UNION ALL
      SELECT 'thread-category', id::text, category_id::text FROM public.threads WHERE id = ${FIXTURE.thread}
      UNION ALL
      SELECT 'thread-author', id::text, author_id::text FROM public.threads WHERE id = ${FIXTURE.thread}
      UNION ALL
      SELECT 'post-thread', id::text, thread_id::text FROM public.posts WHERE id = ${FIXTURE.post}
      UNION ALL
      SELECT 'post-author', id::text, author_id::text FROM public.posts WHERE id = ${FIXTURE.post}
      UNION ALL
      SELECT 'scene-author', id::text, author_id::text FROM public.wiki_posts WHERE id = ${FIXTURE.scene}
      ORDER BY relation`,
  };
  const normalized = Object.fromEntries(Object.entries(tables).map(([name, rows]) => [
    name, rows.map((row) => JSON.parse(JSON.stringify(row))),
  ]));
  return {
    rowCounts: Object.fromEntries(Object.entries(normalized).map(([name, rows]) => [name, rows.length])),
    rowHashes: Object.fromEntries(Object.entries(normalized).map(([name, rows]) => [
      name, crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex'),
    ])),
    credentials: crypto.createHash('sha256')
      .update(JSON.stringify(normalized.users.map(({ id, password_hash }) => ({ id, password_hash }))))
      .digest('hex'),
    rawTurnCount: normalized.scenes[0]?.turns?.length || 0,
  };
}

function savePrivateReport(report) {
  fs.mkdirSync(REPORT_DIRECTORY, { recursive: true, mode: 0o700 });
  fs.chmodSync(REPORT_DIRECTORY, 0o700);
  const reportPath = path.join(REPORT_DIRECTORY, `mig02-populated-${report.scratchDatabase}.json`);
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  fs.chmodSync(reportPath, 0o600);
  return reportPath;
}

async function run() {
  requireNode24();
  parseArgs(process.argv.slice(2));
  const { databaseUrl, target } = readSafeTestUrl();
  const suffix = crypto.randomBytes(8).toString('hex');
  const scratchDatabase = `eterverso_test_restore_${suffix}`;
  quoteScratchDatabase(scratchDatabase);
  let control;
  let source;
  let created = false;
  let finalReport;
  try {
    const controlUrl = withDatabaseName(databaseUrl, 'postgres');
    control = await connect(controlUrl);
    const controlIdentity = await control`SELECT current_database() AS database, current_user AS username`;
    if (controlIdentity[0]?.database !== 'postgres' || controlIdentity[0]?.username !== USER) {
      throw new Error('Could not verify the isolated test service control connection.');
    }
    await control.unsafe(`CREATE DATABASE ${quoteScratchDatabase(scratchDatabase)} WITH TEMPLATE template0`);
    created = true;
    restoreBaseline(scratchDatabase);

    const scratchUrl = withDatabaseName(databaseUrl, scratchDatabase);
    const targetDescription = { label: scratchDatabase, databaseUrl: scratchUrl, host: target.host, port: target.port, database: scratchDatabase };
    const history = migrationHistory();
    const baseline = await inspectDatabase(targetDescription, history);
    const baselineClass = classifySchema(baseline, history);
    if (baselineClass.state !== 'verified-0006-baseline' || !baselineClass.supported) {
      throw new Error('The restored scratch database was not the exact reviewed 0006 baseline.');
    }
    if (Object.values(baseline.rowCounts).some((count) => count !== '0')) {
      throw new Error('The restored baseline contains rows; refusing to mix source data with synthetic fixtures.');
    }

    source = await connect(scratchUrl);
    await assertDatabaseIdentity(source, scratchDatabase);
    await seedSyntheticBaseline(source);
    const before = await capturePreservedRows(source);
    if (Object.entries(before.rowCounts).some(([table, count]) => count !== (table === 'relationships' ? 8 : 1))
        || before.rawTurnCount !== 2) {
      throw new Error(`The synthetic populated-baseline fixture was incomplete: ${JSON.stringify({ rowCounts: before.rowCounts, rawTurnCount: before.rawTurnCount })}`);
    }
    await source.end({ timeout: 5 });
    source = null;

    const cli = path.join(ROOT, 'node_modules', '.bin', 'drizzle-kit');
    const migration = spawnSync(cli, ['migrate'], {
      cwd: ROOT,
      env: {
        ...process.env,
        DATABASE_URL: scratchUrl,
        PATH: `${path.dirname(process.execPath)}:${process.env.PATH || ''}`,
      },
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024,
    });
    const migrationOutput = `${migration.stdout || ''}${migration.stderr || ''}`
      .replaceAll(scratchUrl, '[redacted scratch database URL]');
    if (migration.error || migration.status !== 0) {
      const diagnostic = migrationOutput.replace(/\s+/gu, ' ').slice(-600);
      throw new Error(`Additive migration from verified 0006 baseline failed${diagnostic ? `: ${diagnostic}` : '.'}`);
    }

    source = await connect(scratchUrl);
    await assertDatabaseIdentity(source, scratchDatabase);
    const after = await capturePreservedRows(source);
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      throw new Error('A selected baseline content, credential hash, turn array or relationship changed during migration.');
    }
    const finalSchema = await inspectDatabase(targetDescription, history);
    const finalClass = classifySchema(finalSchema, history);
    if (finalClass.state !== 'verified-0017-timeline-events' || !finalClass.supported
        || finalSchema.pendingMigrations.length !== 0) {
      throw new Error('The populated-baseline upgrade did not reach the exact reviewed 0017 schema.');
    }

    finalReport = {
      gate: 'MIG-02',
      baseline: baselineClass.state,
      upgraded: finalClass.state,
      scratchDatabase,
      migrationsApplied: finalSchema.migrations.slice(7).map((entry) => entry.tag),
      before: {
        rowCounts: before.rowCounts,
        rowHashes: before.rowHashes,
        credentialsHash: before.credentials,
        rawTurnCount: before.rawTurnCount,
      },
      after: {
        rowCounts: after.rowCounts,
        rowHashes: after.rowHashes,
        credentialsHash: after.credentials,
        rawTurnCount: after.rawTurnCount,
      },
      preservedExactly: true,
      generatedAt: new Date().toISOString(),
    };
    const reportPath = savePrivateReport(finalReport);
    process.stdout.write(`MIG-02 passed: populated verified 0006 baseline upgraded to 0017; selected content, credentials, raw turns and relationships matched. Restricted report: ${path.relative(ROOT, reportPath)}\n`);
  } finally {
    if (source) await source.end({ timeout: 5 }).catch(() => {});
    if (control) {
      let cleanupError;
      if (created) {
        try {
          const safeName = quoteScratchDatabase(scratchDatabase);
          await control.unsafe(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${scratchDatabase}' AND pid <> pg_backend_pid()`);
          await control.unsafe(`DROP DATABASE ${safeName}`);
        } catch (_error) {
          cleanupError = new Error(`Could not remove the isolated scratch database ${scratchDatabase}; inspect only this generated database before retrying.`);
        }
      }
      await control.end({ timeout: 5 }).catch(() => {});
      if (cleanupError) throw cleanupError;
    }
  }
  return finalReport;
}

if (require.main === module) {
  run().catch((error) => {
    process.stderr.write(`${error && error.message || 'MIG-02 failed.'}\n`);
    process.exitCode = 1;
  });
}

module.exports = { capturePreservedRows, parseArgs, quoteScratchDatabase, run, seedSyntheticBaseline };
