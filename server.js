'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const postgres = require('postgres');
const { createApp } = require('./server/app');

const ROOT = __dirname;
const REQUIRED_MIGRATION = '0015_wiki_sections';
const REQUIRED_FORUM_TIMESTAMP_COLUMNS = [
  'categories.created_at', 'categories.updated_at',
  'posts.created_at', 'posts.updated_at',
  'threads.created_at', 'threads.updated_at', 'threads.last_activity_at',
  'users.created_at', 'users.updated_at',
];
const REQUIRED_COLUMNS = {
  users: ['id', 'username', 'email', 'password_hash', 'avatar', 'title', 'bio', 'role', 'posts_count', 'adm_tentativa_usada', 'join_date', 'disabled_at', 'auth_version', 'version'],
  personagens: ['id', 'author_id', 'nome', 'categoria', 'titulo', 'raca', 'faccao', 'status', 'imagem', 'descricao', 'stats', 'skills', 'mascara_tier', 'blocks', 'theme', 'created_at', 'updated_at'],
  categories: ['id', 'name', 'description', 'archived_at', 'version', 'created_at', 'updated_at'],
  threads: ['id', 'category_id', 'author_id', 'author_label', 'legacy_reference', 'title', 'tag', 'pinned', 'views', 'locked', 'archived_at', 'quarantined_at', 'quarantine_reason', 'version', 'last_activity_at', 'next_post_no', 'created_at', 'updated_at'],
  posts: ['id', 'thread_id', 'author_id', 'author_label', 'legacy_reference', 'content', 'edited', 'post_no', 'deleted_at', 'version', 'created_at', 'updated_at'],
  wiki_posts: ['id', 'author_id', 'titulo', 'subtitulo', 'categoria', 'status', 'resumo', 'banner', 'descricao', 'theme', 'infobox', 'blocks', 'turns', 'created_at', 'updated_at'],
  audit_events: ['id', 'actor_id', 'actor_label', 'action', 'target_type', 'target_id', 'reason', 'before_state', 'after_state', 'created_at'],
  forum_migration_issues: ['id', 'thread_id', 'reason', 'details', 'created_at', 'resolved_at'],
  post_revisions: ['id', 'post_id', 'version', 'content', 'actor_id', 'summary', 'created_at'],
  request_keys: ['id', 'actor_id', 'operation', 'idempotency_key', 'request_hash', 'resource_ids', 'created_at'],
  scene_turns: ['id', 'scene_id', 'author_id', 'legacy_author_label', 'legacy_id', 'ordinal', 'content', 'presentation', 'version', 'deleted_at', 'created_at', 'updated_at'],
  scene_turn_legacy_backups: ['scene_id', 'turns', 'legacy_sha256', 'created_at'],
  scene_turn_migrations: ['scene_id', 'turn_count', 'legacy_sha256', 'completed_at'],
  scene_turn_migration_issues: ['id', 'scene_id', 'ordinal', 'reason', 'details', 'created_at'],
  wiki_pages: ['id', 'head_revision_id', 'published_revision_id', 'work_version', 'public_version', 'access_level', 'archived_at', 'discussion_thread_id', 'created_by', 'published_at', 'created_at', 'updated_at'],
  wiki_revisions: ['id', 'page_id', 'sequence', 'parent_revision_id', 'base_published_revision_id', 'actor_id', 'edit_summary', 'snapshot', 'restores_id', 'accepted_proposal_id', 'created_at'],
  wiki_names: ['name_key', 'page_id', 'kind', 'created_at'],
  wiki_proposals: ['id', 'page_id', 'proposer_id', 'base_published_revision_id', 'snapshot', 'edit_summary', 'state', 'version', 'previous_proposal_id', 'review_reason', 'created_at', 'updated_at'],
  wiki_sources: ['id', 'archive_sha256', 'relative_path', 'file_sha256', 'family', 'language', 'declared_version', 'declared_date', 'content', 'imported_by', 'created_at'],
  wiki_revision_citations: ['revision_id', 'section_id', 'source_id', 'locator'],
  wiki_revision_categories: ['revision_id', 'category', 'category_key'],
  wiki_revision_links: ['revision_id', 'target_name_key', 'target_anchor'],
  wiki_transfer_instances: ['singleton', 'instance_id', 'created_at'],
  wiki_transfer_jobs: ['id', 'created_by', 'bundle_sha256', 'bundle', 'preview', 'preview_version', 'preview_sha256', 'state', 'commit_result', 'created_at', 'updated_at', 'committed_at'],
  wiki_transfer_page_mappings: ['origin_id', 'source_page_id', 'source_revision_id', 'source_snapshot_sha256', 'target_page_id', 'target_revision_id', 'target_snapshot_sha256', 'created_at'],
  wiki_transfer_source_mappings: ['origin_id', 'source_source_id', 'source_record_sha256', 'target_source_id', 'created_at'],
  legacy_import_batches: ['job_id', 'batch_number', 'batch_hash', 'payload', 'created_at'],
  legacy_import_jobs: ['id', 'created_by', 'source_id', 'export_id', 'raw_snapshot_sha256', 'legacy_origin', 'batch_count', 'state', 'version', 'content_digest', 'plan_hash', 'plan', 'preview_report', 'import_id', 'created_at', 'updated_at', 'committed_at'],
  legacy_import_provenance: ['id', 'import_id', 'source_id', 'export_id', 'raw_snapshot_sha256', 'origin_label', 'recorded_by', 'created_at'],
  legacy_import_source_mappings: ['source_id', 'resource_type', 'legacy_id', 'import_id', 'target_id', 'created_at'],
  legacy_import_targets: ['import_id', 'resource_type', 'legacy_id', 'target_id', 'author_id', 'author_label', 'legacy_created_at_text', 'legacy_updated_at_text', 'created_at'],
  legacy_imports: ['id', 'content_digest', 'first_source_id', 'first_export_id', 'first_raw_snapshot_sha256', 'first_origin_label', 'imported_by', 'created_at'],
  wiki_sections: ['key', 'name', 'description', 'parent_key', 'sort_order'],
};

function expectedMigrationPrefix(rootDirectory) {
  const journalPath = path.join(rootDirectory, 'drizzle', 'meta', '_journal.json');
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
  const requiredIndex = journal.entries.findIndex((entry) => entry.tag === REQUIRED_MIGRATION);
  if (requiredIndex < 0) throw new Error(`Required migration ${REQUIRED_MIGRATION} is missing from the journal.`);
  return journal.entries.slice(0, requiredIndex + 1).map((entry) => {
    const filename = path.join(rootDirectory, 'drizzle', `${entry.tag}.sql`);
    if (!fs.existsSync(filename)) throw new Error(`Required migration ${entry.tag} has no SQL file.`);
    const hash = crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
    return { id: entry.idx + 1, tag: entry.tag, hash };
  });
}

async function verifySchemaReadiness(sql, options = {}) {
  const rootDirectory = options.rootDirectory || ROOT;
  const requiredMigrations = expectedMigrationPrefix(rootDirectory);
  const migrationTable = await sql`SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS present`;
  if (!migrationTable[0]?.present) {
    throw new Error('Database schema is not ready: migration history is missing; run the reviewed migration procedure.');
  }

  let applied;
  try {
    applied = await sql`SELECT id, hash FROM drizzle.__drizzle_migrations ORDER BY id`;
  } catch {
    throw new Error('Database schema is not ready: migration history cannot be read.');
  }
  const missing = requiredMigrations.find((migration, index) => (
    Number(applied[index]?.id) !== migration.id || applied[index]?.hash !== migration.hash
  ));
  if (missing) {
    throw new Error(`Database schema is not ready: migration ${missing.tag} is missing or differs from the reviewed SQL.`);
  }

  const rows = await sql`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'`;
  const columnsByTable = new Map();
  const typesByTable = new Map();
  for (const row of rows) {
    if (!columnsByTable.has(row.table_name)) columnsByTable.set(row.table_name, new Set());
    columnsByTable.get(row.table_name).add(row.column_name);
    if (!typesByTable.has(row.table_name)) typesByTable.set(row.table_name, new Map());
    typesByTable.get(row.table_name).set(row.column_name, row.data_type);
  }
  const missingColumns = [];
  for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
    const present = columnsByTable.get(table);
    for (const column of columns) {
      if (!present?.has(column)) missingColumns.push(`${table}.${column}`);
    }
  }
  if (missingColumns.length) {
    throw new Error(`Database schema is not ready: required columns are missing (${missingColumns.join(', ')}).`);
  }
  const invalidForumTimestamps = REQUIRED_FORUM_TIMESTAMP_COLUMNS.filter((entry) => {
    const [table, column] = entry.split('.');
    return typesByTable.get(table)?.get(column) !== 'timestamp with time zone';
  });
  if (invalidForumTimestamps.length) {
    throw new Error(`Database schema is not ready: forum timestamps must include a timezone (${invalidForumTimestamps.join(', ')}).`);
  }
  const indexes = await sql`
    SELECT indexdef FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'users' AND indexname = 'users_username_lower_key'`;
  if (indexes.length !== 1 || !/CREATE UNIQUE INDEX/i.test(indexes[0].indexdef) || !/lower\s*\(/i.test(indexes[0].indexdef)) {
    throw new Error('Database schema is not ready: case-insensitive username uniqueness is missing.');
  }
  return { migration: REQUIRED_MIGRATION, verifiedColumns: Object.keys(REQUIRED_COLUMNS).length };
}

function readConfig(env) {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL não definida. Configure o .env antes de iniciar.');
  if (!env.SESSION_SECRET) throw new Error('SESSION_SECRET não definida. Configure o .env antes de iniciar.');
  let databaseUrl;
  try {
    databaseUrl = new URL(env.DATABASE_URL);
  } catch {
    throw new Error('DATABASE_URL inválida. Configure uma URL PostgreSQL antes de iniciar.');
  }
  if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) {
    throw new Error('DATABASE_URL deve usar PostgreSQL.');
  }
  const port = env.PORT === undefined || env.PORT === '' ? 3000 : Number(env.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT deve ser um número entre 1 e 65535.');
  }
  const production = env.NODE_ENV === 'production' || !!env.RENDER;
  const configuredOrigin = env.APP_ORIGIN || '';
  if (production && !configuredOrigin) throw new Error('APP_ORIGIN must be explicitly configured in production.');
  let publicOrigin = configuredOrigin || `http://localhost:${port}`;
  try {
    const parsedOrigin = new URL(publicOrigin);
    if (!['http:', 'https:'].includes(parsedOrigin.protocol)
        || parsedOrigin.origin === 'null'
        || parsedOrigin.pathname !== '/'
        || parsedOrigin.search
        || parsedOrigin.hash
        || parsedOrigin.username
        || parsedOrigin.password) {
      throw new Error('invalid origin');
    }
    publicOrigin = parsedOrigin.origin;
  } catch {
    throw new Error('APP_ORIGIN must be an HTTP(S) origin without a path or credentials.');
  }

  return {
    databaseUrl: env.DATABASE_URL,
    sessionSecret: env.SESSION_SECRET,
    secureCookies: production,
    production,
    publicOrigin,
    port,
  };
}

async function startServer(options = {}) {
  const rootDirectory = options.rootDirectory || ROOT;
  if (options.loadEnv !== false) {
    require('dotenv').config({ path: path.join(rootDirectory, '.env') });
  }
  const config = readConfig(options.env || process.env);
  const sql = postgres(config.databaseUrl, { prepare: false, connection: { timezone: 'UTC' } });
  try {
    await verifySchemaReadiness(sql, { rootDirectory });
  } catch (error) {
    await sql.end({ timeout: 5 }).catch(() => {});
    throw error;
  }

  const app = createApp({
    sql,
    config: {
      sessionSecret: config.sessionSecret,
      secureCookies: config.secureCookies,
      production: config.production,
      publicOrigin: config.publicOrigin,
      staticRoot: rootDirectory,
    },
  });
  const server = app.listen(config.port);
  try {
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
  } catch (error) {
    await sql.end({ timeout: 5 }).catch(() => {});
    throw error;
  }
  return { app, server, sql, config: { port: config.port, secureCookies: config.secureCookies } };
}

function installGracefulShutdown(server, sql) {
  let shutdownPromise;
  const shutdown = (signal) => {
    if (shutdownPromise) return;
    console.log(`Encerrando aetherverse vault (${signal}).`);
    shutdownPromise = new Promise((resolve) => server.close(resolve))
      .then(() => sql.end({ timeout: 10 }))
      .catch(() => {
        console.error('Falha ao encerrar conexões do servidor.');
        process.exitCode = 1;
      });
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

if (require.main === module) {
  startServer().then(({ server, sql, config }) => {
    console.log('aetherverse vault no ar na porta ' + config.port);
    installGracefulShutdown(server, sql);
  }).catch((error) => {
    console.error('Falha ao iniciar o servidor:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { expectedMigrationPrefix, readConfig, startServer, verifySchemaReadiness };
