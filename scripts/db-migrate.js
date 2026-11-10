'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync, execFileSync } = require('node:child_process');
const dotenv = require('dotenv');
const postgres = require('postgres');
const { assertBuildOutput } = require('./check-build');

const ROOT = path.resolve(__dirname, '..');
const LOCAL_TEST = path.join(ROOT, '.local', 'test');
const JOURNAL_FILE = path.join(ROOT, 'drizzle', 'meta', '_journal.json');
const REPORT_DIR = path.join(LOCAL_TEST, 'reports');
const DEVELOPMENT_DATABASE = 'eterverso';

const BASELINE_COLUMNS = {
  categories: ['id', 'name', 'description', 'created_at', 'updated_at'],
  comments: ['id', 'personagem_id', 'author_id', 'content', 'created_at', 'updated_at'],
  personagens: ['id', 'author_id', 'nome', 'categoria', 'titulo', 'raca', 'faccao', 'status', 'imagem', 'descricao', 'stats', 'mascara_tier', 'created_at', 'updated_at', 'skills', 'blocks', 'theme'],
  posts: ['id', 'thread_id', 'author_id', 'content', 'edited', 'created_at', 'updated_at'],
  threads: ['id', 'category_id', 'author_id', 'title', 'tag', 'pinned', 'views', 'created_at', 'updated_at'],
  users: ['id', 'username', 'email', 'password_hash', 'avatar', 'title', 'bio', 'role', 'posts_count', 'adm_tentativa_usada', 'join_date', 'created_at', 'updated_at', 'is_staff'],
  wiki_posts: ['id', 'author_id', 'titulo', 'subtitulo', 'categoria', 'status', 'resumo', 'banner', 'descricao', 'theme', 'infobox', 'blocks', 'turns', 'created_at', 'updated_at'],
};

const BASELINE_CONSTRAINTS = [
  'categories.categories_name_key:u', 'categories.categories_pkey:p',
  'comments.comments_author_id_fkey:f', 'comments.comments_pkey:p', 'comments.comments_personagem_id_fkey:f',
  'personagens.personagens_author_id_fkey:f', 'personagens.personagens_pkey:p',
  'posts.posts_author_id_fkey:f', 'posts.posts_pkey:p', 'posts.posts_thread_id_fkey:f',
  'threads.threads_author_id_fkey:f', 'threads.threads_category_id_fkey:f', 'threads.threads_pkey:p',
  'users.users_email_key:u', 'users.users_pkey:p', 'users.users_role_check:c', 'users.users_username_key:u',
  'wiki_posts.wiki_posts_author_id_fkey:f', 'wiki_posts.wiki_posts_pkey:p',
].sort();

const ACCOUNT_SECURITY_COLUMNS = {
  ...BASELINE_COLUMNS,
  users: [...BASELINE_COLUMNS.users, 'disabled_at', 'auth_version', 'version'],
};
const ACCOUNT_SECURITY_CONSTRAINTS = [
  ...BASELINE_CONSTRAINTS,
  'users.users_auth_version_check:c',
  'users.users_version_check:c',
].sort();

const FORUM_COLUMNS = {
  ...ACCOUNT_SECURITY_COLUMNS,
  categories: [...BASELINE_COLUMNS.categories, 'archived_at', 'version'],
  threads: [...BASELINE_COLUMNS.threads, 'author_label', 'legacy_reference', 'locked', 'archived_at', 'quarantined_at', 'quarantine_reason', 'version', 'last_activity_at', 'next_post_no'],
  posts: [...BASELINE_COLUMNS.posts, 'author_label', 'legacy_reference', 'post_no', 'deleted_at', 'version'],
  audit_events: ['id', 'actor_id', 'actor_label', 'action', 'target_type', 'target_id', 'reason', 'before_state', 'after_state', 'created_at'],
  forum_migration_issues: ['id', 'thread_id', 'reason', 'details', 'created_at', 'resolved_at'],
  post_revisions: ['id', 'post_id', 'version', 'content', 'actor_id', 'summary', 'created_at'],
  request_keys: ['id', 'actor_id', 'operation', 'idempotency_key', 'request_hash', 'resource_ids', 'created_at'],
};
const FORUM_CONSTRAINTS = [
  ...ACCOUNT_SECURITY_CONSTRAINTS,
  'audit_events.audit_events_actor_check:c',
  'audit_events.audit_events_actor_id_fkey:f',
  'audit_events.audit_events_pkey:p',
  'categories.categories_version_check:c',
  'forum_migration_issues.forum_migration_issues_pkey:p',
  'forum_migration_issues.forum_migration_issues_thread_id_fkey:f',
  'forum_migration_issues.forum_migration_issues_thread_reason_key:u',
  'posts.posts_post_no_check:c',
  'posts.posts_thread_post_no_key:u',
  'posts.posts_version_check:c',
  'post_revisions.post_revisions_actor_id_fkey:f',
  'post_revisions.post_revisions_post_id_fkey:f',
  'post_revisions.post_revisions_post_version_key:u',
  'post_revisions.post_revisions_pkey:p',
  'post_revisions.post_revisions_version_check:c',
  'request_keys.request_keys_actor_id_fkey:f',
  'request_keys.request_keys_actor_operation_key:u',
  'request_keys.request_keys_hash_check:c',
  'request_keys.request_keys_pkey:p',
  'threads.threads_next_post_no_check:c',
  'threads.threads_version_check:c',
].sort();
const FORUM_INTEGRITY_INDEX = 'users.users_username_lower_key';
const FORUM_TIMESTAMP_COLUMNS = [
  'categories.created_at', 'categories.updated_at',
  'posts.created_at', 'posts.updated_at',
  'threads.created_at', 'threads.updated_at', 'threads.last_activity_at',
  'users.created_at', 'users.updated_at',
];
const SCENE_COLUMNS = {
  ...FORUM_COLUMNS,
  personagens: [...BASELINE_COLUMNS.personagens, 'hidden_at', 'version'],
  wiki_posts: [...BASELINE_COLUMNS.wiki_posts, 'hidden_at', 'version'],
  scene_turns: ['id', 'scene_id', 'author_id', 'legacy_author_label', 'legacy_id', 'ordinal', 'content', 'presentation', 'version', 'deleted_at', 'created_at', 'updated_at'],
  scene_turn_legacy_backups: ['scene_id', 'turns', 'legacy_sha256', 'created_at'],
  scene_turn_migrations: ['scene_id', 'turn_count', 'legacy_sha256', 'completed_at'],
  scene_turn_migration_issues: ['id', 'scene_id', 'ordinal', 'reason', 'details', 'created_at'],
};
const SCENE_CONSTRAINTS = [
  ...FORUM_CONSTRAINTS,
  'personagens.personagens_version_check:c',
  'scene_turn_legacy_backups.scene_turn_legacy_backups_scene_id_fkey:f',
  'scene_turn_legacy_backups.scene_turn_legacy_backups_hash_check:c',
  'scene_turn_legacy_backups.scene_turn_legacy_backups_pkey:p',
  'scene_turn_migration_issues.scene_turn_migration_issues_ordinal_check:c',
  'scene_turn_migration_issues.scene_turn_migration_issues_scene_id_fkey:f',
  'scene_turn_migration_issues.scene_turn_migration_issues_scene_ordinal_reason_key:u',
  'scene_turn_migration_issues.scene_turn_migration_issues_pkey:p',
  'scene_turn_migrations.scene_turn_migrations_count_check:c',
  'scene_turn_migrations.scene_turn_migrations_hash_check:c',
  'scene_turn_migrations.scene_turn_migrations_pkey:p',
  'scene_turn_migrations.scene_turn_migrations_scene_id_fkey:f',
  'scene_turns.scene_turns_author_id_fkey:f',
  'scene_turns.scene_turns_ordinal_check:c',
  'scene_turns.scene_turns_pkey:p',
  'scene_turns.scene_turns_scene_id_fkey:f',
  'scene_turns.scene_turns_scene_ordinal_key:u',
  'scene_turns.scene_turns_version_check:c',
  'wiki_posts.wiki_posts_version_check:c',
].sort();
const WIKI_COLUMNS = {
  ...SCENE_COLUMNS,
  wiki_names: ['name_key', 'page_id', 'kind', 'created_at'],
  wiki_pages: ['id', 'head_revision_id', 'published_revision_id', 'work_version', 'public_version', 'access_level', 'archived_at', 'discussion_thread_id', 'created_by', 'published_at', 'created_at', 'updated_at'],
  wiki_proposals: ['id', 'page_id', 'proposer_id', 'base_published_revision_id', 'snapshot', 'edit_summary', 'state', 'version', 'previous_proposal_id', 'review_reason', 'created_at', 'updated_at'],
  wiki_revision_categories: ['revision_id', 'category', 'category_key'],
  wiki_revision_citations: ['revision_id', 'section_id', 'source_id', 'locator'],
  wiki_revision_links: ['revision_id', 'target_name_key', 'target_anchor'],
  wiki_revisions: ['id', 'page_id', 'sequence', 'parent_revision_id', 'base_published_revision_id', 'actor_id', 'edit_summary', 'snapshot', 'restores_id', 'accepted_proposal_id', 'created_at'],
  wiki_sources: ['id', 'archive_sha256', 'relative_path', 'file_sha256', 'family', 'language', 'declared_version', 'declared_date', 'content', 'imported_by', 'created_at'],
};
const WIKI_CONSTRAINTS = [
  ...SCENE_CONSTRAINTS,
  'wiki_names.wiki_names_kind_check:c',
  'wiki_names.wiki_names_key_check:c',
  'wiki_names.wiki_names_page_id_fkey:f',
  'wiki_names.wiki_names_pkey:p',
  'wiki_pages.wiki_pages_access_level_check:c',
  'wiki_pages.wiki_pages_created_by_fkey:f',
  'wiki_pages.wiki_pages_discussion_thread_id_fkey:f',
  'wiki_pages.wiki_pages_head_revision_fkey:f',
  'wiki_pages.wiki_pages_id_key:p',
  'wiki_pages.wiki_pages_public_version_check:c',
  'wiki_pages.wiki_pages_published_revision_fkey:f',
  'wiki_pages.wiki_pages_work_version_check:c',
  'wiki_proposals.wiki_proposals_base_revision_fkey:f',
  'wiki_proposals.wiki_proposals_page_id_fkey:f',
  'wiki_proposals.wiki_proposals_page_id_id_key:u',
  'wiki_proposals.wiki_proposals_previous_proposal_fkey:f',
  'wiki_proposals.wiki_proposals_proposer_id_fkey:f',
  'wiki_proposals.wiki_proposals_pkey:p',
  'wiki_proposals.wiki_proposals_snapshot_version_check:c',
  'wiki_proposals.wiki_proposals_state_check:c',
  'wiki_proposals.wiki_proposals_version_check:c',
  'wiki_revision_categories.wiki_revision_categories_revision_category_key:u',
  'wiki_revision_categories.wiki_revision_categories_revision_id_fkey:f',
  'wiki_revision_citations.wiki_revision_citations_identity_key:u',
  'wiki_revision_citations.wiki_revision_citations_revision_id_fkey:f',
  'wiki_revision_citations.wiki_revision_citations_source_id_fkey:f',
  'wiki_revision_links.wiki_revision_links_identity_key:u',
  'wiki_revision_links.wiki_revision_links_revision_id_fkey:f',
  'wiki_revisions.wiki_revisions_accepted_proposal_id_wiki_proposals_id_fk:f',
  'wiki_revisions.wiki_revisions_actor_id_fkey:f',
  'wiki_revisions.wiki_revisions_base_published_revision_fkey:f',
  'wiki_revisions.wiki_revisions_page_id_id_key:u',
  'wiki_revisions.wiki_revisions_page_id_wiki_pages_id_fk:f',
  'wiki_revisions.wiki_revisions_page_sequence_key:u',
  'wiki_revisions.wiki_revisions_parent_revision_fkey:f',
  'wiki_revisions.wiki_revisions_pkey:p',
  'wiki_revisions.wiki_revisions_restores_fkey:f',
  'wiki_revisions.wiki_revisions_sequence_check:c',
  'wiki_revisions.wiki_revisions_snapshot_version_check:c',
  'wiki_sources.wiki_sources_archive_hash_check:c',
  'wiki_sources.wiki_sources_archive_path_key:u',
  'wiki_sources.wiki_sources_file_hash_check:c',
  'wiki_sources.wiki_sources_imported_by_fkey:f',
  'wiki_sources.wiki_sources_pkey:p',
].sort();
const IMPORT_COLUMNS = {
  ...WIKI_COLUMNS,
  legacy_import_batches: ['job_id', 'batch_number', 'batch_hash', 'payload', 'created_at'],
  legacy_import_jobs: ['id', 'created_by', 'source_id', 'export_id', 'raw_snapshot_sha256', 'legacy_origin', 'batch_count', 'state', 'version', 'content_digest', 'plan_hash', 'plan', 'preview_report', 'import_id', 'created_at', 'updated_at', 'committed_at'],
  legacy_import_provenance: ['id', 'import_id', 'source_id', 'export_id', 'raw_snapshot_sha256', 'origin_label', 'recorded_by', 'created_at'],
  legacy_import_source_mappings: ['source_id', 'resource_type', 'legacy_id', 'import_id', 'target_id', 'created_at'],
  legacy_import_targets: ['import_id', 'resource_type', 'legacy_id', 'target_id', 'author_id', 'author_label', 'legacy_created_at_text', 'legacy_updated_at_text', 'created_at'],
  legacy_imports: ['id', 'content_digest', 'first_source_id', 'first_export_id', 'first_raw_snapshot_sha256', 'first_origin_label', 'imported_by', 'created_at'],
};
const IMPORT_CONSTRAINTS = [
  ...WIKI_CONSTRAINTS,
  'legacy_import_batches.legacy_import_batches_job_id_fkey:f',
  'legacy_import_batches.legacy_import_batches_job_number_key:u',
  'legacy_import_batches.legacy_import_batches_number_check:c',
  'legacy_import_batches.legacy_import_batches_hash_check:c',
  'legacy_import_jobs.legacy_import_jobs_batch_count_check:c',
  'legacy_import_jobs.legacy_import_jobs_content_digest_check:c',
  'legacy_import_jobs.legacy_import_jobs_created_by_fkey:f',
  'legacy_import_jobs.legacy_import_jobs_import_id_fkey:f',
  'legacy_import_jobs.legacy_import_jobs_actor_source_export_key:u',
  'legacy_import_jobs.legacy_import_jobs_pkey:p',
  'legacy_import_jobs.legacy_import_jobs_plan_hash_check:c',
  'legacy_import_jobs.legacy_import_jobs_raw_hash_check:c',
  'legacy_import_jobs.legacy_import_jobs_state_check:c',
  'legacy_import_jobs.legacy_import_jobs_version_check:c',
  'legacy_import_provenance.legacy_import_provenance_identity_key:u',
  'legacy_import_provenance.legacy_import_provenance_import_id_fkey:f',
  'legacy_import_provenance.legacy_import_provenance_pkey:p',
  'legacy_import_provenance.legacy_import_provenance_raw_hash_check:c',
  'legacy_import_provenance.legacy_import_provenance_recorded_by_fkey:f',
  'legacy_import_source_mappings.legacy_import_source_mappings_identity_key:u',
  'legacy_import_source_mappings.legacy_import_source_mappings_import_id_fkey:f',
  'legacy_import_source_mappings.legacy_import_source_mappings_type_check:c',
  'legacy_import_targets.legacy_import_targets_author_id_fkey:f',
  'legacy_import_targets.legacy_import_targets_identity_key:u',
  'legacy_import_targets.legacy_import_targets_import_id_fkey:f',
  'legacy_import_targets.legacy_import_targets_type_check:c',
  'legacy_imports.legacy_imports_content_digest_check:c',
  'legacy_imports.legacy_imports_content_digest_key:u',
  'legacy_imports.legacy_imports_imported_by_fkey:f',
  'legacy_imports.legacy_imports_pkey:p',
  'legacy_imports.legacy_imports_raw_hash_check:c',
].sort();
const TRANSFER_COLUMNS = {
  ...IMPORT_COLUMNS,
  wiki_transfer_instances: ['singleton', 'instance_id', 'created_at'],
  wiki_transfer_jobs: ['id', 'created_by', 'bundle_sha256', 'bundle', 'preview', 'preview_version', 'preview_sha256', 'state', 'commit_result', 'created_at', 'updated_at', 'committed_at'],
  wiki_transfer_page_mappings: ['origin_id', 'source_page_id', 'source_revision_id', 'source_snapshot_sha256', 'target_page_id', 'target_revision_id', 'target_snapshot_sha256', 'created_at'],
  wiki_transfer_source_mappings: ['origin_id', 'source_source_id', 'source_record_sha256', 'target_source_id', 'created_at'],
};
const TRANSFER_CONSTRAINTS = [
  ...IMPORT_CONSTRAINTS,
  'wiki_transfer_instances.wiki_transfer_instances_instance_id_key:u',
  'wiki_transfer_instances.wiki_transfer_instances_pkey:p',
  'wiki_transfer_instances.wiki_transfer_instances_singleton_check:c',
  'wiki_transfer_jobs.wiki_transfer_jobs_bundle_hash_check:c',
  'wiki_transfer_jobs.wiki_transfer_jobs_bundle_sha256_key:u',
  'wiki_transfer_jobs.wiki_transfer_jobs_bundle_shape_check:c',
  'wiki_transfer_jobs.wiki_transfer_jobs_created_by_fkey:f',
  'wiki_transfer_jobs.wiki_transfer_jobs_preview_hash_check:c',
  'wiki_transfer_jobs.wiki_transfer_jobs_preview_shape_check:c',
  'wiki_transfer_jobs.wiki_transfer_jobs_preview_version_check:c',
  'wiki_transfer_jobs.wiki_transfer_jobs_pkey:p',
  'wiki_transfer_jobs.wiki_transfer_jobs_state_check:c',
  'wiki_transfer_page_mappings.wiki_transfer_page_mappings_identity_key:p',
  'wiki_transfer_page_mappings.wiki_transfer_page_mappings_source_hash_check:c',
  'wiki_transfer_page_mappings.wiki_transfer_page_mappings_target_hash_check:c',
  'wiki_transfer_page_mappings.wiki_transfer_page_mappings_target_page_fkey:f',
  'wiki_transfer_page_mappings.wiki_transfer_page_mappings_target_page_key:u',
  'wiki_transfer_page_mappings.wiki_transfer_page_mappings_target_revision_fkey:f',
  'wiki_transfer_source_mappings.wiki_transfer_source_mappings_hash_check:c',
  'wiki_transfer_source_mappings.wiki_transfer_source_mappings_identity_key:p',
  'wiki_transfer_source_mappings.wiki_transfer_source_mappings_target_source_fkey:f',
].sort();
const SECTION_COLUMNS = {
  ...TRANSFER_COLUMNS,
  wiki_sections: ['key', 'name', 'description', 'parent_key', 'sort_order'],
};
const SECTION_TYPES = {
  key: 'text',
  name: 'text',
  description: 'text',
  parent_key: 'text',
  sort_order: 'integer',
};
const SECTION_CONSTRAINTS = [
  ...TRANSFER_CONSTRAINTS,
  'wiki_sections.wiki_sections_key_check:c',
  'wiki_sections.wiki_sections_parent_check:c',
  'wiki_sections.wiki_sections_parent_key_fkey:f',
  'wiki_sections.wiki_sections_pkey:p',
  'wiki_sections.wiki_sections_sort_order_check:c',
].sort();
const INTERACTIONS_COLUMNS = {
  ...SECTION_COLUMNS,
  likes: ['id', 'user_id', 'target_type', 'target_id', 'created_at'],
  notifications: ['id', 'user_id', 'actor_id', 'type', 'reference_id', 'reference_type', 'title', 'message', 'read', 'created_at'],
};
const INTERACTIONS_TYPES = {
  likes: {
    id: 'uuid',
    user_id: 'uuid',
    target_type: 'character varying',
    target_id: 'character varying',
    created_at: 'timestamp with time zone',
  },
  notifications: {
    id: 'uuid',
    user_id: 'uuid',
    actor_id: 'uuid',
    type: 'character varying',
    reference_id: 'character varying',
    reference_type: 'character varying',
    title: 'character varying',
    message: 'text',
    read: 'boolean',
    created_at: 'timestamp with time zone',
  },
};
const INTERACTIONS_INDEXES = {
  likes: ['idx_likes_target', 'likes_pkey', 'likes_unique'],
  notifications: ['idx_notifications_user_id', 'idx_notifications_user_read', 'notifications_pkey'],
};
const INTERACTIONS_CONSTRAINTS = [
  ...SECTION_CONSTRAINTS,
  'likes.likes_pkey:p',
  'likes.likes_unique:u',
  'likes.likes_user_id_fkey:f',
  'notifications.notifications_actor_id_fkey:f',
  'notifications.notifications_pkey:p',
  'notifications.notifications_user_id_fkey:f',
].sort();
const TIMELINE_COLUMNS = {
  ...INTERACTIONS_COLUMNS,
  timeline_events: ['id', 'internal_id', 'title', 'short_title', 'summary', 'color', 'era', 'start_date', 'end_date', 'order_index', 'tags', 'story_arc', 'characters', 'character_group', 'location', 'created_at', 'updated_at'],
};
const TIMELINE_TYPES = {
  timeline_events: {
    id: 'uuid',
    internal_id: 'character varying',
    title: 'character varying',
    short_title: 'character varying',
    summary: 'text',
    color: 'character varying',
    era: 'character varying',
    start_date: 'character varying',
    end_date: 'character varying',
    order_index: 'integer',
    tags: 'character varying',
    story_arc: 'character varying',
    characters: 'text',
    character_group: 'character varying',
    location: 'character varying',
    created_at: 'timestamp with time zone',
    updated_at: 'timestamp with time zone',
  },
};
const TIMELINE_INDEXES = {
  timeline_events: ['idx_timeline_events_era', 'idx_timeline_events_internal_id', 'idx_timeline_events_order', 'timeline_events_pkey'],
};
const TIMELINE_CONSTRAINTS = [
  ...INTERACTIONS_CONSTRAINTS,
  'timeline_events.timeline_events_pkey:p',
].sort();

function readDotEnv(file) {
  if (!fs.existsSync(file)) return {};
  return dotenv.parse(fs.readFileSync(file));
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).digest('hex');
}

function migrationHistory() {
  const journal = JSON.parse(fs.readFileSync(JOURNAL_FILE, 'utf8'));
  return journal.entries.map((entry) => {
    const file = path.join(ROOT, 'drizzle', `${entry.tag}.sql`);
    if (!fs.existsSync(file)) throw new Error(`Journal entry ${entry.tag} has no SQL file.`);
    return { id: entry.idx + 1, tag: entry.tag, hash: sha256(file), file: path.basename(file) };
  });
}

function quoteIdentifier(name) {
  return `"${String(name).replaceAll('"', '""')}"`;
}

function sameList(left, right) {
  return JSON.stringify([...(left || [])].sort()) === JSON.stringify([...(right || [])].sort());
}

function exactColumnTypes(report, expected) {
  return Object.entries(expected).every(([table, columns]) => (
    Object.entries(columns).every(([column, type]) => report.columnTypes?.[table]?.[column] === type)
  ));
}

function exactTableIndexes(report, table, names) {
  return sameList((report.indexes || []).filter((index) => index.table === table).map((index) => index.name), names);
}

function hasIndexDefinition(report, table, name, pattern) {
  return (report.indexes || []).some((index) => (
    index.table === table && index.name === name && pattern.test(index.definition)
  ));
}

function classifySchema(report, history) {
  const appTables = report.publicTables || [];
  const ledger = report.ledger || [];
  const emptyLedger = ledger.length === 0;
  if (appTables.length === 0 && emptyLedger) return { state: 'empty', supported: true };

  const knownLedger = ledger.length <= history.length
    && ledger.every((entry, index) => (
      Number(entry.id) === index + 1 && entry.hash === history[index]?.hash
    ));
  const baselineTables = Object.keys(BASELINE_COLUMNS).sort();
  const exactBaselineTables = sameList(appTables, baselineTables);
  const exactBaselineColumns = exactBaselineTables && baselineTables.every((table) => (
    sameList(report.columns[table] || [], BASELINE_COLUMNS[table])
  ));
  const exactBaselineConstraints = sameList(report.constraints, BASELINE_CONSTRAINTS);

  if (knownLedger && ledger.length === 7 && exactBaselineTables && exactBaselineColumns && exactBaselineConstraints) {
    return { state: 'verified-0006-baseline', supported: true };
  }

  const exactSecurityColumns = sameList(appTables, Object.keys(ACCOUNT_SECURITY_COLUMNS).sort())
    && Object.keys(ACCOUNT_SECURITY_COLUMNS).every((table) => (
      sameList(report.columns[table] || [], ACCOUNT_SECURITY_COLUMNS[table])
    ));
  const exactSecurityConstraints = sameList(report.constraints, ACCOUNT_SECURITY_CONSTRAINTS);
  if (knownLedger && ledger.length === 8 && exactSecurityColumns && exactSecurityConstraints) {
    return { state: 'verified-0007-account-security', supported: true };
  }

  const exactForumColumns = sameList(appTables, Object.keys(FORUM_COLUMNS).sort())
    && Object.keys(FORUM_COLUMNS).every((table) => (
      sameList(report.columns[table] || [], FORUM_COLUMNS[table])
    ));
  const exactForumConstraints = sameList(report.constraints, FORUM_CONSTRAINTS);
  if (knownLedger && ledger.length === 9 && exactForumColumns && exactForumConstraints) {
    return { state: 'verified-0008-forum', supported: true };
  }

  const hasCaseInsensitiveUsernameIndex = (report.indexes || []).some((index) => (
    index.table === 'users' && index.name === 'users_username_lower_key'
      && /CREATE UNIQUE INDEX/i.test(index.definition) && /lower\s*\(/i.test(index.definition)
  ));
  if (knownLedger && ledger.length === 10 && exactForumColumns && exactForumConstraints && hasCaseInsensitiveUsernameIndex) {
    return { state: 'verified-0009-forum-integrity', supported: true };
  }

  const forumTimestampsUseTimezone = FORUM_TIMESTAMP_COLUMNS.every((entry) => {
    const [table, column] = entry.split('.');
    return report.columnTypes?.[table]?.[column] === 'timestamp with time zone';
  });
  if (knownLedger && ledger.length === 11 && exactForumColumns && exactForumConstraints
      && hasCaseInsensitiveUsernameIndex && forumTimestampsUseTimezone) {
    return { state: 'verified-0010-forum-timestamps', supported: true };
  }

  const exactSceneColumns = sameList(appTables, Object.keys(SCENE_COLUMNS).sort())
    && Object.keys(SCENE_COLUMNS).every((table) => (
      sameList(report.columns[table] || [], SCENE_COLUMNS[table])
    ));
  const exactSceneConstraints = sameList(report.constraints, SCENE_CONSTRAINTS);
  const hasSceneIndexes = (report.indexes || []).some((index) => (
    index.table === 'scene_turns' && index.name === 'scene_turns_scene_legacy_id_key'
      && /CREATE UNIQUE INDEX/i.test(index.definition) && /WHERE\s+\(legacy_id IS NOT NULL\)/i.test(index.definition)
  )) && (report.indexes || []).some((index) => (
    index.table === 'scene_turns' && index.name === 'idx_scene_turns_author_id'
  ));
  if (knownLedger && ledger.length === 12 && exactSceneColumns && exactSceneConstraints
      && hasCaseInsensitiveUsernameIndex && forumTimestampsUseTimezone && hasSceneIndexes) {
    return { state: 'verified-0011-scene-turns', supported: true };
  }

  const exactWikiColumns = sameList(appTables, Object.keys(WIKI_COLUMNS).sort())
    && Object.keys(WIKI_COLUMNS).every((table) => sameList(report.columns[table] || [], WIKI_COLUMNS[table]));
  const exactWikiConstraints = sameList(report.constraints, WIKI_CONSTRAINTS);
  const hasWikiNameIndex = (report.indexes || []).some((index) => (
    index.table === 'wiki_names' && index.name === 'wiki_names_one_canonical_per_page_key'
      && /CREATE UNIQUE INDEX/i.test(index.definition)
      && /WHERE\s+\(\(?kind\)?\)::text\s*=\s*'canonical'::text\)/i.test(index.definition)
  ));
  const hasWikiRevisionImmutability = (report.triggers || []).some((trigger) => (
    trigger.table === 'wiki_revisions' && trigger.name === 'wiki_revisions_immutable'
      && trigger.functionName === 'prevent_wiki_revision_mutation'
      && /BEFORE (?:UPDATE OR DELETE|DELETE OR UPDATE)/i.test(trigger.definition)
  ));
  if (knownLedger && ledger.length === 13 && exactWikiColumns && exactWikiConstraints
      && hasCaseInsensitiveUsernameIndex && forumTimestampsUseTimezone && hasSceneIndexes
      && hasWikiNameIndex && hasWikiRevisionImmutability) {
    return { state: 'verified-0012-wiki-core', supported: true };
  }

  const exactImportColumns = sameList(appTables, Object.keys(IMPORT_COLUMNS).sort())
    && Object.keys(IMPORT_COLUMNS).every((table) => sameList(report.columns[table] || [], IMPORT_COLUMNS[table]));
  const exactImportConstraints = sameList(report.constraints, IMPORT_CONSTRAINTS);
  if (knownLedger && ledger.length === 14 && exactImportColumns && exactImportConstraints
      && hasCaseInsensitiveUsernameIndex && forumTimestampsUseTimezone && hasSceneIndexes
      && hasWikiNameIndex && hasWikiRevisionImmutability) {
    return { state: 'verified-0013-legacy-import', supported: true };
  }

  const exactTransferColumns = sameList(appTables, Object.keys(TRANSFER_COLUMNS).sort())
    && Object.keys(TRANSFER_COLUMNS).every((table) => sameList(report.columns[table] || [], TRANSFER_COLUMNS[table]));
  const exactTransferConstraints = sameList(report.constraints, TRANSFER_CONSTRAINTS);
  if (knownLedger && ledger.length === 15 && exactTransferColumns && exactTransferConstraints
      && hasCaseInsensitiveUsernameIndex && forumTimestampsUseTimezone && hasSceneIndexes
      && hasWikiNameIndex && hasWikiRevisionImmutability) {
    return { state: 'verified-0014-wiki-portable-transfers', supported: true };
  }

  const exactSectionColumns = sameList(appTables, Object.keys(SECTION_COLUMNS).sort())
    && Object.keys(SECTION_COLUMNS).every((table) => sameList(report.columns[table] || [], SECTION_COLUMNS[table]));
  const exactSectionTypes = Object.entries(SECTION_TYPES).every(([column, type]) => (
    report.columnTypes?.wiki_sections?.[column] === type
  ));
  const exactSectionConstraints = sameList(report.constraints, SECTION_CONSTRAINTS);
  const hasSectionIndex = (report.indexes || []).some((index) => (
    index.table === 'wiki_sections' && index.name === 'wiki_sections_parent_order_idx'
      && /CREATE INDEX/i.test(index.definition)
  ));
  if (knownLedger && ledger.length === 16 && exactSectionColumns && exactSectionTypes && exactSectionConstraints
      && hasCaseInsensitiveUsernameIndex && forumTimestampsUseTimezone && hasSceneIndexes
      && hasWikiNameIndex && hasWikiRevisionImmutability && hasSectionIndex) {
    return { state: 'verified-0015-wiki-sections', supported: true };
  }

  const hasPriorReviewedIndexes = hasCaseInsensitiveUsernameIndex && forumTimestampsUseTimezone
    && hasSceneIndexes && hasWikiNameIndex && hasWikiRevisionImmutability && hasSectionIndex
    && exactSectionTypes;

  const exactInteractionColumns = sameList(appTables, Object.keys(INTERACTIONS_COLUMNS).sort())
    && Object.keys(INTERACTIONS_COLUMNS).every((table) => (
      sameList(report.columns[table] || [], INTERACTIONS_COLUMNS[table])
    ));
  const exactInteractionTypes = exactColumnTypes(report, INTERACTIONS_TYPES);
  const exactInteractionConstraints = sameList(report.constraints, INTERACTIONS_CONSTRAINTS);
  const exactInteractionIndexes = exactTableIndexes(report, 'notifications', INTERACTIONS_INDEXES.notifications)
    && exactTableIndexes(report, 'likes', INTERACTIONS_INDEXES.likes)
    && hasIndexDefinition(report, 'notifications', 'notifications_pkey',
      /^CREATE UNIQUE INDEX notifications_pkey ON public\.notifications USING btree \(id\)$/)
    && hasIndexDefinition(report, 'notifications', 'idx_notifications_user_id',
      /^CREATE INDEX idx_notifications_user_id ON public\.notifications USING btree \(user_id\)$/)
    && hasIndexDefinition(report, 'notifications', 'idx_notifications_user_read',
      /^CREATE INDEX idx_notifications_user_read ON public\.notifications USING btree \(user_id,\s*"?read"?\)$/)
    && hasIndexDefinition(report, 'likes', 'likes_pkey',
      /^CREATE UNIQUE INDEX likes_pkey ON public\.likes USING btree \(id\)$/)
    && hasIndexDefinition(report, 'likes', 'likes_unique',
      /^CREATE UNIQUE INDEX likes_unique ON public\.likes USING btree \(user_id, target_type, target_id\)$/)
    && hasIndexDefinition(report, 'likes', 'idx_likes_target',
      /^CREATE INDEX idx_likes_target ON public\.likes USING btree \(target_type, target_id\)$/);
  if (knownLedger && ledger.length === 17 && exactInteractionColumns && exactInteractionTypes
      && exactInteractionConstraints && exactInteractionIndexes && hasPriorReviewedIndexes) {
    return { state: 'verified-0016-notifications-and-likes', supported: true };
  }

  const exactTimelineColumns = sameList(appTables, Object.keys(TIMELINE_COLUMNS).sort())
    && Object.keys(TIMELINE_COLUMNS).every((table) => (
      sameList(report.columns[table] || [], TIMELINE_COLUMNS[table])
    ));
  const exactTimelineTypes = exactColumnTypes(report, TIMELINE_TYPES);
  const exactTimelineConstraints = sameList(report.constraints, TIMELINE_CONSTRAINTS);
  const exactTimelineIndexes = exactTableIndexes(report, 'timeline_events', TIMELINE_INDEXES.timeline_events)
    && hasIndexDefinition(report, 'timeline_events', 'timeline_events_pkey',
      /^CREATE UNIQUE INDEX timeline_events_pkey ON public\.timeline_events USING btree \(id\)$/)
    && hasIndexDefinition(report, 'timeline_events', 'idx_timeline_events_era',
      /^CREATE INDEX idx_timeline_events_era ON public\.timeline_events USING btree \(era\)$/)
    && hasIndexDefinition(report, 'timeline_events', 'idx_timeline_events_order',
      /^CREATE INDEX idx_timeline_events_order ON public\.timeline_events USING btree \(order_index\)$/)
    && hasIndexDefinition(report, 'timeline_events', 'idx_timeline_events_internal_id',
      /^CREATE UNIQUE INDEX idx_timeline_events_internal_id ON public\.timeline_events USING btree \(internal_id\)$/);
  if (knownLedger && ledger.length === 18 && exactTimelineColumns && exactTimelineTypes
      && exactInteractionTypes && exactInteractionIndexes && exactTimelineConstraints
      && exactTimelineIndexes && hasPriorReviewedIndexes) {
    return { state: 'verified-0017-timeline-events', supported: true };
  }

  return {
    state: 'unsupported-or-divergent',
    supported: false,
    checks: {
      knownLedger,
      migrationCount: ledger.length,
      expectedCurrentMigrationCount: history.length,
      exactBaselineTables,
      exactBaselineColumns,
      exactBaselineConstraints,
      exactSecurityColumns,
      exactSecurityConstraints,
      exactForumColumns,
      exactForumConstraints,
      hasCaseInsensitiveUsernameIndex,
      forumTimestampsUseTimezone,
      exactSceneColumns,
      exactSceneConstraints,
      hasSceneIndexes,
      exactWikiColumns,
      exactWikiConstraints,
      exactImportColumns,
      exactImportConstraints,
      exactTransferColumns,
      exactTransferConstraints,
      exactSectionColumns,
      exactSectionTypes,
      exactSectionConstraints,
      hasWikiNameIndex,
      hasWikiRevisionImmutability,
      hasSectionIndex,
      exactInteractionColumns,
      exactInteractionTypes,
      exactInteractionConstraints,
      exactInteractionIndexes,
      exactTimelineColumns,
      exactTimelineTypes,
      exactTimelineConstraints,
      exactTimelineIndexes,
    },
  };
}

async function readTarget(targetName) {
  if (targetName === 'development') {
    const env = readDotEnv(path.join(ROOT, '.env'));
    const databaseUrl = env.DATABASE_URL;
    if (!databaseUrl) throw new Error('Existing .env is missing DATABASE_URL; no environment file was created.');
    const parsed = new URL(databaseUrl);
    if (!['127.0.0.1', 'localhost'].includes(parsed.hostname)
        || Number(parsed.port || 5432) !== 55432
        || decodeURIComponent(parsed.pathname.slice(1)) !== 'eterverso') {
      throw new Error('Development migrations require the local eterverso database on loopback port 55432.');
    }
    return { databaseUrl, label: 'development', host: parsed.hostname, port: Number(parsed.port || 5432), database: 'eterverso' };
  }

  if (targetName === 'test') {
    const connection = readDotEnv(path.join(LOCAL_TEST, 'connection.env'));
    if (!connection.ETERVERSO_TEST_DATABASE_URL) throw new Error('Run npm run test:env:up before targeting the test database.');
    const safety = execFileSync(process.execPath, [path.join(__dirname, 'test-env.js'), 'assert'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const safeTarget = JSON.parse(safety);
    return {
      databaseUrl: connection.ETERVERSO_TEST_DATABASE_URL,
      label: 'test',
      host: safeTarget.host,
      port: safeTarget.port,
      database: safeTarget.database,
    };
  }

  if (targetName === 'sandbox') {
    const publicSandboxTarget = require('./public-sandbox-target');
    const target = publicSandboxTarget.resolveSandboxTarget({ root: ROOT });
    return {
      databaseUrl: target.databaseUrl,
      label: 'sandbox',
      host: target.host,
      port: target.port,
      containerPort: target.containerPort,
      database: target.database,
      role: target.role,
      containerAddresses: target.containerAddresses,
    };
  }

  throw new Error('Choose an explicit target: --target=test, --target=development, or --target=sandbox.');
}

async function inspectDatabase(target, history) {
  const dbUrl = new URL(target.databaseUrl);
  const sql = postgres(target.databaseUrl, { prepare: false, max: 1, connect_timeout: 5, idle_timeout: 1, connection: { timezone: 'UTC' } });
  try {
    const identity = await sql`SELECT current_database() AS database, current_user AS role,
      inet_server_addr()::text AS address, inet_server_port() AS server_port,
      current_setting('server_version_num') AS version`;
    if (identity[0].database !== target.database) throw new Error('Connected database name does not match the selected target.');
    if (target.label === 'sandbox') {
      publicSandboxTarget.assertConnectedIdentityRow({
        database: identity[0].database,
        role: identity[0].role,
        address: identity[0].address,
        port: identity[0].server_port,
        version: identity[0].version,
      }, target);
    }

    const publicTables = (await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name`).map((row) => row.table_name);
    const hasLedger = await sql`SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS present`;
    let ledger = [];
    if (hasLedger[0].present) {
      ledger = await sql`SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id`;
    }
    const columnRows = await sql`
      SELECT table_name, column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`;
    const columns = {};
    const columnTypes = {};
    for (const row of columnRows) {
      (columns[row.table_name] ||= []).push(row.column_name);
      (columnTypes[row.table_name] ||= {})[row.column_name] = row.data_type;
    }
    const constraintRows = await sql`
      SELECT c.relname AS table_name, x.conname, x.contype
      FROM pg_constraint x JOIN pg_class c ON c.oid = x.conrelid
      WHERE x.connamespace = 'public'::regnamespace
      ORDER BY c.relname, x.conname`;
    const constraints = constraintRows.map((row) => `${row.table_name}.${row.conname}:${row.contype}`).sort();
    const indexRows = await sql`
      SELECT tablename, indexname, indexdef
      FROM pg_indexes WHERE schemaname = 'public' ORDER BY tablename, indexname`;
    const indexes = indexRows.map((row) => ({ table: row.tablename, name: row.indexname, definition: row.indexdef }));
    const triggerRows = await sql`
      SELECT c.relname AS table_name, t.tgname, p.proname AS function_name,
             pg_get_triggerdef(t.oid, true) AS definition
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE NOT t.tgisinternal AND c.relnamespace = 'public'::regnamespace
      ORDER BY c.relname, t.tgname`;
    const triggers = triggerRows.map((row) => ({
      table: row.table_name, name: row.tgname, functionName: row.function_name, definition: row.definition,
    }));

    const rowCounts = {};
    for (const table of publicTables) {
      if (!/^[a-z_][a-z0-9_]*$/.test(table)) throw new Error('Unexpected public table name; refusing dynamic row-count query.');
      const rows = await sql.unsafe(`SELECT count(*)::bigint AS count FROM public.${quoteIdentifier(table)}`);
      rowCounts[table] = String(rows[0].count);
    }
    return {
      target: { name: target.label, host: target.host, port: target.port, database: target.database },
      connectedDatabase: identity[0].database,
      serverPort: identity[0].server_port,
      migrations: history,
      ledger,
      publicTables,
      columns,
      columnTypes,
      constraints,
      indexes,
      triggers,
      rowCounts,
      pendingMigrations: history.slice(ledger.length).map((entry) => entry.tag),
      dsnHost: dbUrl.hostname,
      dsnPort: Number(dbUrl.port || 5432),
      dsnDatabase: decodeURIComponent(dbUrl.pathname.slice(1)),
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function saveReport(report) {
  const reportDirectory = report.target.name === 'sandbox'
    ? path.join(ROOT, '.local', 'public-sandbox', 'reports')
    : REPORT_DIR;
  fs.mkdirSync(reportDirectory, { recursive: true, mode: 0o700 });
  fs.chmodSync(reportDirectory, 0o700);
  const date = new Date().toISOString().replaceAll(':', '-');
  const file = path.join(reportDirectory, `db-preflight-${report.target.name}-${date}.json`);
  fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  fs.chmodSync(file, 0o600);
  return file;
}

function targetArgument(args) {
  const value = args.find((arg) => arg.startsWith('--target='));
  if (!value) throw new Error('Choose an explicit target: --target=test, --target=development, or --target=sandbox.');
  return value.slice('--target='.length);
}

async function preflight(targetName) {
  const target = await readTarget(targetName);
  const history = migrationHistory();
  const report = await inspectDatabase(target, history);
  const classification = classifySchema(report, history);
  report.classification = classification;
  report.generatedAt = new Date().toISOString();
  const reportPath = saveReport(report);
  console.log(`Target ${target.label}: ${classification.state}; ${report.ledger.length} migrations recorded, ${report.pendingMigrations.length} pending.`);
  console.log(`Read-only report saved privately to ${path.relative(ROOT, reportPath)}.`);
  if (!classification.supported) {
    throw new Error('Automatic migration refused. Preserve this report and follow the operator-reviewed recovery path.');
  }
  return { report, target };
}

async function migrate(targetName) {
  const { report, target } = await preflight(targetName);
  if (!['empty', 'verified-0006-baseline', 'verified-0007-account-security', 'verified-0008-forum', 'verified-0009-forum-integrity', 'verified-0010-forum-timestamps', 'verified-0011-scene-turns', 'verified-0012-wiki-core', 'verified-0013-legacy-import', 'verified-0014-wiki-portable-transfers', 'verified-0015-wiki-sections', 'verified-0016-notifications-and-likes', 'verified-0017-timeline-events'].includes(report.classification.state)) {
    throw new Error('Automatic migration is supported only from an empty database or an exact reviewed schema state.');
  }
  if (report.pendingMigrations.length === 0) {
    console.log('Database already matches the known migration history; no changes applied.');
    return;
  }
  const backup = path.join(ROOT, '.local', 'development-baseline.dump');
  if (target.label === 'development') await validateDevelopmentBackup(backup);
  const cli = path.join(ROOT, 'node_modules', '.bin', 'drizzle-kit');
  if (!fs.existsSync(cli)) throw new Error('Drizzle Kit is not installed; run npm ci.');
  console.log(`Applying ${report.pendingMigrations.length} reviewed migration(s) to the ${target.label} target.`);
  const result = spawnSync(cli, ['migrate'], {
    cwd: ROOT,
    env: {
      ...process.env,
      DATABASE_URL: target.databaseUrl,
      PATH: `${path.dirname(process.execPath)}:${process.env.PATH || ''}`,
    },
    encoding: 'utf8',
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`.replaceAll(target.databaseUrl, '[redacted database URL]');
  if (output.trim()) process.stdout.write(output);
  if (result.error) throw new Error(`Migration command could not start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`Migration command failed with exit code ${result.status}.`);
  console.log('Migration command completed. Run the target preflight again to verify the resulting schema.');
}

function assertPrivateBackupFile(backupPath) {
  let pathStat;
  try { pathStat = fs.lstatSync(backupPath); } catch {
    throw new Error('Development migration requires a private baseline dump created before migration.');
  }
  if (!pathStat.isFile() || (pathStat.mode & 0o077) !== 0 || (pathStat.mode & 0o400) === 0) {
    throw new Error('The development baseline dump must be a regular file readable only by its owner.');
  }

  let descriptor;
  try {
    const noFollow = fs.constants.O_NOFOLLOW || 0;
    descriptor = fs.openSync(backupPath, fs.constants.O_RDONLY | noFollow);
    const openedStat = fs.fstatSync(descriptor);
    if (!openedStat.isFile() || openedStat.dev !== pathStat.dev || openedStat.ino !== pathStat.ino
        || openedStat.size < 5 || (openedStat.mode & 0o077) !== 0) {
      throw new Error('The development baseline dump is empty, changed, or not private.');
    }
    const header = Buffer.alloc(5);
    if (fs.readSync(descriptor, header, 0, header.length, 0) !== header.length || header.toString('ascii') !== 'PGDMP') {
      throw new Error('The development baseline dump is not a PostgreSQL custom-format archive.');
    }
  } catch (error) {
    if (error && error.code === 'ELOOP') throw new Error('The development baseline dump must not be a symbolic link.');
    if (error && error.code === 'ENOENT') throw new Error('Development migration requires a private baseline dump created before migration.');
    throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

async function validateDevelopmentBackup(backupPath, verifyArchive = verifyDevelopmentBackupArchive) {
  assertPrivateBackupFile(backupPath);
  await verifyArchive(backupPath);
}

function verifyDevelopmentBackupArchive(backupPath) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['compose', 'exec', '-T', 'db', 'pg_restore', '--list'], {
      cwd: ROOT,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const archive = fs.createReadStream(backupPath);
    let output = '';
    let settled = false;
    const fail = () => {
      if (settled) return;
      settled = true;
      archive.destroy();
      child.kill();
      reject(new Error('The development baseline dump is not a readable archive for the local eterverso database.'));
    };
    child.stdout.on('data', (chunk) => {
      if (output.length < 4096) output += chunk.toString('utf8').slice(0, 4096 - output.length);
    });
    archive.once('error', fail);
    child.stdin.once('error', fail);
    child.once('error', fail);
    child.once('close', (status) => {
      if (settled) return;
      settled = true;
      const belongsToDevelopment = archiveListBelongsToDevelopment(output);
      if (status !== 0 || !belongsToDevelopment) {
        reject(new Error('The development baseline dump is not a readable archive for the local eterverso database.'));
        return;
      }
      resolve();
    });
    archive.pipe(child.stdin);
  });
}

function archiveListBelongsToDevelopment(output) {
  return new RegExp(`^;\\s*dbname:\\s*${DEVELOPMENT_DATABASE}\\s*$`, 'im').test(output);
}

async function main() {
  // Direct CLI use has no npm pre-hook. Fail before target resolution or a
  // database connection if the generated sandbox target adapter is absent.
  assertBuildOutput({ required: ['publicSandboxTarget'] });
  const command = process.argv[2];
  const target = targetArgument(process.argv.slice(3));
  if (command === 'preflight') return preflight(target);
  if (command === 'migrate') return migrate(target);
  throw new Error('Usage: node scripts/db-migrate.js <preflight|migrate> --target=<test|development|sandbox>');
}

module.exports = {
  BASELINE_COLUMNS,
  BASELINE_CONSTRAINTS,
  ACCOUNT_SECURITY_COLUMNS,
  ACCOUNT_SECURITY_CONSTRAINTS,
  FORUM_COLUMNS,
  FORUM_CONSTRAINTS,
  FORUM_INTEGRITY_INDEX,
  FORUM_TIMESTAMP_COLUMNS,
  SCENE_COLUMNS,
  SCENE_CONSTRAINTS,
  WIKI_COLUMNS,
  WIKI_CONSTRAINTS,
  IMPORT_COLUMNS,
  IMPORT_CONSTRAINTS,
  TRANSFER_COLUMNS,
  TRANSFER_CONSTRAINTS,
  SECTION_COLUMNS,
  SECTION_TYPES,
  SECTION_CONSTRAINTS,
  INTERACTIONS_COLUMNS,
  INTERACTIONS_TYPES,
  INTERACTIONS_INDEXES,
  INTERACTIONS_CONSTRAINTS,
  TIMELINE_COLUMNS,
  TIMELINE_TYPES,
  TIMELINE_INDEXES,
  TIMELINE_CONSTRAINTS,
  classifySchema,
  assertPrivateBackupFile,
  archiveListBelongsToDevelopment,
  validateDevelopmentBackup,
  verifyDevelopmentBackupArchive,
  inspectDatabase,
  migrationHistory,
  readTarget,
};

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}
