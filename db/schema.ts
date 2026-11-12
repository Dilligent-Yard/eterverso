import { pgTable, serial, varchar, text, index, foreignKey, integer, boolean, timestamp, unique, uniqueIndex, primaryKey, check, date, jsonb, uuid, type AnyPgColumn } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

// Estrutura das tabelas na database

export const categories = pgTable("categories", {
	id: uuid().primaryKey().notNull().defaultRandom(),

	name: varchar({ length: 100 }).notNull(),
	description: text().default(''),
	archivedAt: timestamp("archived_at", { mode: 'string', withTimezone: true }),
	version: integer().default(1).notNull(),

	createdAt: timestamp("created_at", { mode: 'string', withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string', withTimezone: true }).defaultNow()
		.notNull()
		.$onUpdate(() => sql`CURRENT_TIMESTAMP`),
}, (table) => [
	unique("categories_name_key").on(table.name),
	index("idx_categories_name").using("btree", table.name.asc().nullsLast().op("text_ops")),
	check("categories_version_check", sql`version > 0`),
]);

export const threads = pgTable("threads", {
	id: uuid().primaryKey().notNull().defaultRandom(),
	categoryId: uuid("category_id").notNull(),
	authorId: uuid("author_id"),
	authorLabel: text("author_label"),
	legacyReference: text("legacy_reference"),

	title: varchar({ length: 200 }).notNull(),
	tag: varchar({ length: 20 }).default(''),
	pinned: boolean().default(false).notNull(),
	views: integer().default(0).notNull(),
	locked: boolean().default(false).notNull(),
	archivedAt: timestamp("archived_at", { mode: 'string', withTimezone: true }),
	quarantinedAt: timestamp("quarantined_at", { mode: 'string', withTimezone: true }),
	quarantineReason: varchar("quarantine_reason", { length: 80 }),
	version: integer().default(1).notNull(),
	lastActivityAt: timestamp("last_activity_at", { mode: 'string', withTimezone: true }).defaultNow().notNull(),
	nextPostNo: integer("next_post_no").default(2).notNull(),

	createdAt: timestamp("created_at", { mode: 'string', withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string', withTimezone: true }).defaultNow()
		.notNull()
		.$onUpdate(() => sql`CURRENT_TIMESTAMP`),
}, (table) => [
	index("idx_threads_category_id").using("btree", table.categoryId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
		columns: [table.authorId],
		foreignColumns: [users.id],
		name: "threads_author_id_fkey"
	}),
	foreignKey({
		columns: [table.categoryId],
		foreignColumns: [categories.id],
		name: "threads_category_id_fkey"
	}).onDelete("restrict"),
	check("threads_version_check", sql`version > 0`),
	check("threads_next_post_no_check", sql`next_post_no > 1`),
]);

export const users = pgTable("users", {
	id: uuid().primaryKey().notNull().defaultRandom(),

	email: varchar({ length: 120 }).notNull(),
	username: varchar({ length: 50 }).notNull(),
	passwordHash: text("password_hash").default('').notNull(),

	avatar: text().default(''),
	title: varchar({ length: 100 }).default(''),
	bio: text().default(''),
	postsCount: integer("posts_count").default(0).notNull(),
	admTentativaUsada: boolean("adm_tentativa_usada").default(false).notNull(),
	role: varchar({ length: 20 }).default('member').notNull(),
	isStaff: boolean("is_staff").default(false).notNull(),
	disabledAt: timestamp("disabled_at", { mode: 'string', withTimezone: true }),
	authVersion: integer("auth_version").default(1).notNull(),
	version: integer().default(1).notNull(),

	joinDate: date("join_date").default(sql`CURRENT_DATE`).notNull(),
	createdAt: timestamp("created_at", { mode: 'string', withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string', withTimezone: true }).defaultNow()
		.notNull()
		.$onUpdate(() => sql`CURRENT_TIMESTAMP`),
}, (table) => [
	unique("users_username_key").on(table.username),
	uniqueIndex("users_username_lower_key").on(sql`lower(${table.username})`),
	unique("users_email_key").on(table.email),
	check("users_role_check", sql`(role)::text = ANY (ARRAY[('member'::character varying)::text, ('moderador'::character varying)::text, ('admin'::character varying)::text])`),
	check("users_auth_version_check", sql`auth_version > 0`),
	check("users_version_check", sql`version > 0`),
]);

export const posts = pgTable("posts", {
	id: uuid().primaryKey().notNull().defaultRandom(),
	threadId: uuid("thread_id").notNull(),
	authorId: uuid("author_id"),
	authorLabel: text("author_label"),
	legacyReference: text("legacy_reference"),

	content: text().notNull(),
	edited: boolean().default(false).notNull(),
	postNo: integer("post_no").notNull(),
	deletedAt: timestamp("deleted_at", { mode: 'string', withTimezone: true }),
	version: integer().default(1).notNull(),

	createdAt: timestamp("created_at", { mode: 'string', withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string', withTimezone: true }).defaultNow()
		.notNull()
		.$onUpdate(() => sql`CURRENT_TIMESTAMP`),
}, (table) => [
	index("idx_posts_thread_id").using("btree", table.threadId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
		columns: [table.authorId],
		foreignColumns: [users.id],
		name: "posts_author_id_fkey"
	}),
	foreignKey({
		columns: [table.threadId],
		foreignColumns: [threads.id],
		name: "posts_thread_id_fkey"
	}).onDelete("restrict"),
	unique("posts_thread_post_no_key").on(table.threadId, table.postNo),
	check("posts_post_no_check", sql`post_no > 0`),
	check("posts_version_check", sql`version > 0`),
]);

export const postRevisions = pgTable("post_revisions", {
	id: uuid().primaryKey().notNull().defaultRandom(),
	postId: uuid("post_id").notNull(),
	version: integer().notNull(),
	content: text().notNull(),
	actorId: uuid("actor_id").notNull(),
	summary: varchar({ length: 1000 }).notNull(),
	createdAt: timestamp("created_at", { mode: 'string', withTimezone: true }).defaultNow().notNull(),
}, (table) => [
	unique("post_revisions_post_version_key").on(table.postId, table.version),
	foreignKey({ columns: [table.postId], foreignColumns: [posts.id], name: "post_revisions_post_id_fkey" }).onDelete("restrict"),
	foreignKey({ columns: [table.actorId], foreignColumns: [users.id], name: "post_revisions_actor_id_fkey" }).onDelete("restrict"),
	check("post_revisions_version_check", sql`version > 0`),
]);

export const requestKeys = pgTable("request_keys", {
	id: uuid().primaryKey().notNull().defaultRandom(),
	actorId: uuid("actor_id").notNull(),
	operation: varchar({ length: 100 }).notNull(),
	idempotencyKey: uuid("idempotency_key").notNull(),
	requestHash: varchar("request_hash", { length: 64 }).notNull(),
	resourceIds: jsonb("resource_ids").default([]).notNull(),
	createdAt: timestamp("created_at", { mode: 'string', withTimezone: true }).defaultNow().notNull(),
}, (table) => [
	unique("request_keys_actor_operation_key").on(table.actorId, table.operation, table.idempotencyKey),
	foreignKey({ columns: [table.actorId], foreignColumns: [users.id], name: "request_keys_actor_id_fkey" }).onDelete("restrict"),
	check("request_keys_hash_check", sql`length(request_hash) = 64`),
]);

export const forumMigrationIssues = pgTable("forum_migration_issues", {
	id: uuid().primaryKey().notNull().defaultRandom(),
	threadId: uuid("thread_id").notNull(),
	reason: varchar({ length: 80 }).notNull(),
	details: jsonb().default({}).notNull(),
	createdAt: timestamp("created_at", { mode: 'string', withTimezone: true }).defaultNow().notNull(),
	resolvedAt: timestamp("resolved_at", { mode: 'string', withTimezone: true }),
}, (table) => [
	unique("forum_migration_issues_thread_reason_key").on(table.threadId, table.reason),
	foreignKey({ columns: [table.threadId], foreignColumns: [threads.id], name: "forum_migration_issues_thread_id_fkey" }).onDelete("restrict"),
]);

export const auditEvents = pgTable("audit_events", {
	id: uuid().primaryKey().notNull().defaultRandom(),
	actorId: uuid("actor_id"),
	actorLabel: varchar("actor_label", { length: 120 }),
	action: varchar({ length: 80 }).notNull(),
	targetType: varchar("target_type", { length: 40 }).notNull(),
	targetId: uuid("target_id"),
	reason: varchar({ length: 1000 }).notNull(),
	beforeState: jsonb("before_state").default({}).notNull(),
	afterState: jsonb("after_state").default({}).notNull(),
	createdAt: timestamp("created_at", { mode: 'string', withTimezone: true }).defaultNow().notNull(),
}, (table) => [
	foreignKey({ columns: [table.actorId], foreignColumns: [users.id], name: "audit_events_actor_id_fkey" }).onDelete("restrict"),
	check("audit_events_actor_check", sql`actor_id IS NOT NULL OR actor_label IS NOT NULL`),
]);

export const personagens = pgTable("personagens", {
	id: uuid().primaryKey().notNull().defaultRandom(),
	authorId: uuid("author_id").notNull(),
	hiddenAt: timestamp("hidden_at", { mode: 'string', withTimezone: true }),
	version: integer().default(1).notNull(),

	nome: varchar({ length: 100 }).notNull(),
	categoria: varchar({ length: 50 }).default(''),
	titulo: varchar({ length: 100 }).default(''),
	raca: varchar({ length: 80 }).default(''),
	faccao: varchar({ length: 120 }).default(''),
	status: varchar({ length: 80 }).default(''),
	imagem: text().default(''),
	descricao: text().default(""),
	stats: jsonb().default({}),
	skills: jsonb().default([]),
	mascaraTier: varchar("mascara_tier", { length: 60 }).default(''),
	blocks: jsonb().default([]),
	theme: jsonb().default({}),
	contentMode: varchar("content_mode", { length: 20 }).default('html').notNull(),
	wikitext: text().default('').notNull(),
	customCss: text("custom_css").default('').notNull(),

	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow()
		.notNull()
		.$onUpdate(() => sql`CURRENT_TIMESTAMP`),
}, (table) => [
	index("idx_personagens_author_id").using("btree", table.authorId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
		columns: [table.authorId],
		foreignColumns: [users.id],
		name: "personagens_author_id_fkey"
	}),
	check("personagens_version_check", sql`version > 0`),
	check("personagens_content_mode_check", sql`content_mode IN ('html', 'wikitext')`),
]);

export const characterMwResources = pgTable("character_mw_resources", {
	id: uuid().primaryKey().notNull().defaultRandom(),
	kind: varchar({ length: 20 }).notNull(),
	name: varchar({ length: 120 }).notNull(),
	nameKey: varchar("name_key", { length: 120 }).notNull(),
	description: text().default('').notNull(),
	content: text().default('').notNull(),
	createdBy: uuid("created_by"),
	updatedBy: uuid("updated_by"),
	archivedAt: timestamp("archived_at", { mode: 'string', withTimezone: true }),
	version: integer().default(1).notNull(),
	createdAt: timestamp("created_at", { mode: 'string', withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string', withTimezone: true }).defaultNow()
		.notNull()
		.$onUpdate(() => sql`CURRENT_TIMESTAMP`),
}, (table) => [
	unique("character_mw_resources_kind_name_key").on(table.kind, table.nameKey),
	index("idx_character_mw_resources_kind_key").using("btree", table.kind.asc().nullsLast().op("text_ops"), table.nameKey.asc().nullsLast().op("text_ops")),
	foreignKey({ columns: [table.createdBy], foreignColumns: [users.id], name: "character_mw_resources_created_by_fkey" }).onDelete("set null"),
	foreignKey({ columns: [table.updatedBy], foreignColumns: [users.id], name: "character_mw_resources_updated_by_fkey" }).onDelete("set null"),
	check("character_mw_resources_kind_check", sql`kind IN ('template', 'lua', 'css')`),
	check("character_mw_resources_name_check", sql`length(trim(name)) > 0`),
	check("character_mw_resources_version_check", sql`version > 0`),
]);

export const comments = pgTable("comments", {
	id: uuid().primaryKey().notNull().defaultRandom(),
	personagemId: uuid("personagem_id").notNull(),
	authorId: uuid("author_id").notNull(),

	content: text().notNull(),

	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow()
		.notNull()
		.$onUpdate(() => sql`CURRENT_TIMESTAMP`),
}, (table) => [
	index("idx_comments_personagem_id").using("btree", table.personagemId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
		columns: [table.authorId],
		foreignColumns: [users.id],
		name: "comments_author_id_fkey"
	}),
	foreignKey({
		columns: [table.personagemId],
		foreignColumns: [personagens.id],
		name: "comments_personagem_id_fkey"
	}).onDelete("cascade"),
]);

export const wikiPosts = pgTable("wiki_posts", {
	id: uuid().primaryKey().notNull().defaultRandom(),
	authorId: uuid("author_id"),
	hiddenAt: timestamp("hidden_at", { mode: 'string', withTimezone: true }),
	version: integer().default(1).notNull(),

	titulo: varchar({ length: 200 }).notNull(),
	subtitulo: varchar({ length: 200 }).default(''),
	categoria: varchar({ length: 80 }).default('Cena de RPG'),
	status: varchar({ length: 80 }).default('Em Andamento'),
	resumo: text().default(''),
	banner: text().default(''),
	descricao: text().default(''),
	theme: jsonb().default({}),
	infobox: jsonb().default({}),
	blocks: jsonb().default([]),
	turns: jsonb().default([]),

	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow()
		.notNull()
		.$onUpdate(() => sql`CURRENT_TIMESTAMP`),
}, (table) => [
	index("idx_wiki_posts_author_id").using("btree", table.authorId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
		columns: [table.authorId],
		foreignColumns: [users.id],
		name: "wiki_posts_author_id_fkey"
	}).onDelete("set null"),
	check("wiki_posts_version_check", sql`version > 0`),
]);

export const sceneTurns = pgTable("scene_turns", {
	id: uuid().primaryKey().notNull().defaultRandom(),
	sceneId: uuid("scene_id").notNull(),
	authorId: uuid("author_id"),
	legacyAuthorLabel: text("legacy_author_label"),
	legacyId: varchar("legacy_id", { length: 80 }),
	ordinal: integer().notNull(),
	content: text().notNull(),
	presentation: jsonb().default({}).notNull(),
	version: integer().default(1).notNull(),
	deletedAt: timestamp("deleted_at", { mode: 'string', withTimezone: true }),
	createdAt: timestamp("created_at", { mode: 'string', withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string', withTimezone: true }).defaultNow().notNull(),
}, (table) => [
	unique("scene_turns_scene_ordinal_key").on(table.sceneId, table.ordinal),
	uniqueIndex("scene_turns_scene_legacy_id_key").on(table.sceneId, table.legacyId).where(sql`legacy_id IS NOT NULL`),
	index("idx_scene_turns_author_id").on(table.authorId),
	foreignKey({ columns: [table.sceneId], foreignColumns: [wikiPosts.id], name: "scene_turns_scene_id_fkey" }).onDelete("restrict"),
	foreignKey({ columns: [table.authorId], foreignColumns: [users.id], name: "scene_turns_author_id_fkey" }).onDelete("restrict"),
	check("scene_turns_ordinal_check", sql`ordinal >= 0`),
	check("scene_turns_version_check", sql`version > 0`),
]);

export const sceneTurnMigrations = pgTable("scene_turn_migrations", {
	sceneId: uuid("scene_id").primaryKey().notNull(),
	turnCount: integer("turn_count").default(0).notNull(),
	legacySha256: varchar("legacy_sha256", { length: 64 }).notNull(),
	completedAt: timestamp("completed_at", { mode: 'string', withTimezone: true }).defaultNow().notNull(),
}, (table) => [
	foreignKey({ columns: [table.sceneId], foreignColumns: [wikiPosts.id], name: "scene_turn_migrations_scene_id_fkey" }).onDelete("restrict"),
	check("scene_turn_migrations_count_check", sql`turn_count >= 0`),
	check("scene_turn_migrations_hash_check", sql`length(legacy_sha256) = 64`),
]);

export const sceneTurnLegacyBackups = pgTable("scene_turn_legacy_backups", {
	sceneId: uuid("scene_id").primaryKey().notNull(),
	turns: jsonb().notNull(),
	legacySha256: varchar("legacy_sha256", { length: 64 }).notNull(),
	createdAt: timestamp("created_at", { mode: 'string', withTimezone: true }).defaultNow().notNull(),
}, (table) => [
	foreignKey({ columns: [table.sceneId], foreignColumns: [wikiPosts.id], name: "scene_turn_legacy_backups_scene_id_fkey" }).onDelete("restrict"),
	check("scene_turn_legacy_backups_hash_check", sql`length(legacy_sha256) = 64`),
]);

export const sceneTurnMigrationIssues = pgTable("scene_turn_migration_issues", {
	id: uuid().primaryKey().notNull().defaultRandom(),
	sceneId: uuid("scene_id").notNull(),
	ordinal: integer().notNull(),
	reason: varchar({ length: 80 }).notNull(),
	details: jsonb().default({}).notNull(),
	createdAt: timestamp("created_at", { mode: 'string', withTimezone: true }).defaultNow().notNull(),
}, (table) => [
	unique("scene_turn_migration_issues_scene_ordinal_reason_key").on(table.sceneId, table.ordinal, table.reason),
	foreignKey({ columns: [table.sceneId], foreignColumns: [wikiPosts.id], name: "scene_turn_migration_issues_scene_id_fkey" }).onDelete("restrict"),
	check("scene_turn_migration_issues_ordinal_check", sql`ordinal >= 0`),
]);

// The reference wiki is deliberately separate from wiki_posts, which stores RPG scenes.
export const wikiRevisions = pgTable("wiki_revisions", {
	id: uuid().primaryKey().notNull().defaultRandom(),
	pageId: uuid("page_id").notNull().references((): AnyPgColumn => wikiPages.id),
	sequence: integer().notNull(),
	parentRevisionId: uuid("parent_revision_id"),
	basePublishedRevisionId: uuid("base_published_revision_id"),
	actorId: uuid("actor_id").notNull(),
	editSummary: varchar("edit_summary", { length: 1000 }).notNull(),
	snapshot: jsonb().notNull(),
	restoresId: uuid("restores_id"),
	acceptedProposalId: uuid("accepted_proposal_id").references((): AnyPgColumn => wikiProposals.id),
	createdAt: timestamp("created_at", { mode: 'string', withTimezone: true }).defaultNow().notNull(),
}, (table) => [
	unique("wiki_revisions_page_id_id_key").on(table.pageId, table.id),
	unique("wiki_revisions_page_sequence_key").on(table.pageId, table.sequence),
	foreignKey({ columns: [table.actorId], foreignColumns: [users.id], name: "wiki_revisions_actor_id_fkey" }).onDelete("restrict"),
	foreignKey({ columns: [table.pageId, table.parentRevisionId], foreignColumns: [table.pageId, table.id], name: "wiki_revisions_parent_revision_fkey" }).onDelete("restrict"),
	foreignKey({ columns: [table.pageId, table.basePublishedRevisionId], foreignColumns: [table.pageId, table.id], name: "wiki_revisions_base_published_revision_fkey" }).onDelete("restrict"),
	foreignKey({ columns: [table.pageId, table.restoresId], foreignColumns: [table.pageId, table.id], name: "wiki_revisions_restores_fkey" }).onDelete("restrict"),
	check("wiki_revisions_sequence_check", sql`sequence > 0`),
	check("wiki_revisions_snapshot_version_check", sql`jsonb_typeof(snapshot) = 'object' AND snapshot->>'schemaVersion' = '1'`),
]);

export const wikiPages = pgTable("wiki_pages", {
	id: uuid().primaryKey().notNull().defaultRandom(),
	headRevisionId: uuid("head_revision_id"),
	publishedRevisionId: uuid("published_revision_id"),
	workVersion: integer("work_version").default(1).notNull(),
	publicVersion: integer("public_version").default(0).notNull(),
	accessLevel: varchar("access_level", { length: 16 }).default("staff").notNull(),
	archivedAt: timestamp("archived_at", { mode: 'string', withTimezone: true }),
	discussionThreadId: uuid("discussion_thread_id"),
	createdBy: uuid("created_by").notNull(),
	publishedAt: timestamp("published_at", { mode: 'string', withTimezone: true }),
	createdAt: timestamp("created_at", { mode: 'string', withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string', withTimezone: true }).defaultNow().notNull(),
}, (table) => [
	unique("wiki_pages_id_key").on(table.id),
	foreignKey({ columns: [table.createdBy], foreignColumns: [users.id], name: "wiki_pages_created_by_fkey" }).onDelete("restrict"),
	foreignKey({ columns: [table.discussionThreadId], foreignColumns: [threads.id], name: "wiki_pages_discussion_thread_id_fkey" }).onDelete("restrict"),
	foreignKey({ columns: [table.id, table.headRevisionId], foreignColumns: [wikiRevisions.pageId, wikiRevisions.id], name: "wiki_pages_head_revision_fkey" }).onDelete("restrict"),
	foreignKey({ columns: [table.id, table.publishedRevisionId], foreignColumns: [wikiRevisions.pageId, wikiRevisions.id], name: "wiki_pages_published_revision_fkey" }).onDelete("restrict"),
	check("wiki_pages_work_version_check", sql`work_version > 0`),
	check("wiki_pages_public_version_check", sql`public_version >= 0`),
	check("wiki_pages_access_level_check", sql`access_level IN ('public', 'staff')`),
]);

export const wikiSections = pgTable("wiki_sections", {
	key: text().primaryKey().notNull(),
	name: text().notNull(),
	description: text().default('').notNull(),
	parentKey: text("parent_key"),
	sortOrder: integer("sort_order").notNull(),
}, (table) => [
	foreignKey({ columns: [table.parentKey], foreignColumns: [table.key], name: "wiki_sections_parent_key_fkey" })
		.onDelete("restrict")
		.onUpdate("restrict"),
	index("wiki_sections_parent_order_idx").on(table.parentKey, table.sortOrder, table.key),
	check("wiki_sections_key_check", sql`"key" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
	check("wiki_sections_parent_check", sql`parent_key IS NULL OR parent_key <> "key"`),
	check("wiki_sections_sort_order_check", sql`sort_order >= 0`),
]);

export const wikiNames = pgTable("wiki_names", {
	nameKey: varchar("name_key", { length: 100 }).primaryKey().notNull(),
	pageId: uuid("page_id").notNull(),
	kind: varchar({ length: 16 }).notNull(),
	createdAt: timestamp("created_at", { mode: 'string', withTimezone: true }).defaultNow().notNull(),
}, (table) => [
	foreignKey({ columns: [table.pageId], foreignColumns: [wikiPages.id], name: "wiki_names_page_id_fkey" }).onDelete("restrict"),
	uniqueIndex("wiki_names_one_canonical_per_page_key").on(table.pageId).where(sql`kind = 'canonical'`),
	check("wiki_names_kind_check", sql`kind IN ('canonical', 'alias', 'historical')`),
	check("wiki_names_key_check", sql`name_key ~ '^[a-z0-9][a-z0-9-]{0,99}$'`),
]);

export const wikiProposals = pgTable("wiki_proposals", {
	id: uuid().primaryKey().notNull().defaultRandom(),
	pageId: uuid("page_id").notNull(),
	proposerId: uuid("proposer_id").notNull(),
	basePublishedRevisionId: uuid("base_published_revision_id").notNull(),
	snapshot: jsonb().notNull(),
	editSummary: varchar("edit_summary", { length: 1000 }).notNull(),
	state: varchar({ length: 16 }).default("submitted").notNull(),
	version: integer().default(1).notNull(),
	previousProposalId: uuid("previous_proposal_id"),
	reviewReason: varchar("review_reason", { length: 1000 }),
	createdAt: timestamp("created_at", { mode: 'string', withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string', withTimezone: true }).defaultNow().notNull(),
}, (table) => [
	unique("wiki_proposals_page_id_id_key").on(table.pageId, table.id),
	foreignKey({ columns: [table.pageId], foreignColumns: [wikiPages.id], name: "wiki_proposals_page_id_fkey" }).onDelete("restrict"),
	foreignKey({ columns: [table.proposerId], foreignColumns: [users.id], name: "wiki_proposals_proposer_id_fkey" }).onDelete("restrict"),
	foreignKey({ columns: [table.pageId, table.basePublishedRevisionId], foreignColumns: [wikiRevisions.pageId, wikiRevisions.id], name: "wiki_proposals_base_revision_fkey" }).onDelete("restrict"),
	foreignKey({ columns: [table.pageId, table.previousProposalId], foreignColumns: [table.pageId, table.id], name: "wiki_proposals_previous_proposal_fkey" }).onDelete("restrict"),
	check("wiki_proposals_state_check", sql`state IN ('submitted', 'accepted', 'rejected', 'withdrawn')`),
	check("wiki_proposals_version_check", sql`version > 0`),
	check("wiki_proposals_snapshot_version_check", sql`jsonb_typeof(snapshot) = 'object' AND snapshot->>'schemaVersion' = '1'`),
]);

export const wikiSources = pgTable("wiki_sources", {
	id: uuid().primaryKey().notNull().defaultRandom(),
	archiveSha256: varchar("archive_sha256", { length: 64 }).notNull(),
	relativePath: text("relative_path").notNull(),
	fileSha256: varchar("file_sha256", { length: 64 }).notNull(),
	family: varchar({ length: 80 }).notNull(),
	language: varchar({ length: 20 }).notNull(),
	declaredVersion: varchar("declared_version", { length: 120 }),
	declaredDate: varchar("declared_date", { length: 40 }),
	content: text().notNull(),
	importedBy: uuid("imported_by").notNull(),
	createdAt: timestamp("created_at", { mode: 'string', withTimezone: true }).defaultNow().notNull(),
}, (table) => [
	unique("wiki_sources_archive_path_key").on(table.archiveSha256, table.relativePath),
	foreignKey({ columns: [table.importedBy], foreignColumns: [users.id], name: "wiki_sources_imported_by_fkey" }).onDelete("restrict"),
	check("wiki_sources_archive_hash_check", sql`archive_sha256 ~ '^[0-9a-f]{64}$'`),
	check("wiki_sources_file_hash_check", sql`file_sha256 ~ '^[0-9a-f]{64}$'`),
]);

export const wikiRevisionCitations = pgTable("wiki_revision_citations", {
	revisionId: uuid("revision_id").notNull(),
	sectionId: uuid("section_id").notNull(),
	sourceId: uuid("source_id").notNull(),
	locator: varchar({ length: 500 }).notNull(),
}, (table) => [
	unique("wiki_revision_citations_identity_key").on(table.revisionId, table.sectionId, table.sourceId, table.locator),
	foreignKey({ columns: [table.revisionId], foreignColumns: [wikiRevisions.id], name: "wiki_revision_citations_revision_id_fkey" }).onDelete("restrict"),
	foreignKey({ columns: [table.sourceId], foreignColumns: [wikiSources.id], name: "wiki_revision_citations_source_id_fkey" }).onDelete("restrict"),
]);

export const wikiTransferInstances = pgTable("wiki_transfer_instances", {
	singleton: boolean().primaryKey().notNull().default(true),
	instanceId: uuid("instance_id").notNull().defaultRandom(),
	createdAt: timestamp("created_at", { mode: 'string', withTimezone: true }).defaultNow().notNull(),
}, (table) => [
	unique("wiki_transfer_instances_instance_id_key").on(table.instanceId),
	check("wiki_transfer_instances_singleton_check", sql`singleton`),
]);

export const wikiTransferJobs = pgTable("wiki_transfer_jobs", {
	id: uuid().primaryKey().notNull().defaultRandom(),
	createdBy: uuid("created_by").notNull(),
	bundleSha256: varchar("bundle_sha256", { length: 64 }).notNull(),
	bundle: jsonb().notNull(),
	preview: jsonb().notNull(),
	previewVersion: integer("preview_version").default(1).notNull(),
	previewSha256: varchar("preview_sha256", { length: 64 }).notNull(),
	state: varchar({ length: 16 }).default("staged").notNull(),
	commitResult: jsonb("commit_result"),
	createdAt: timestamp("created_at", { mode: 'string', withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string', withTimezone: true }).defaultNow().notNull(),
	committedAt: timestamp("committed_at", { mode: 'string', withTimezone: true }),
}, (table) => [
	unique("wiki_transfer_jobs_bundle_sha256_key").on(table.bundleSha256),
	foreignKey({ columns: [table.createdBy], foreignColumns: [users.id], name: "wiki_transfer_jobs_created_by_fkey" }).onDelete("restrict"),
	check("wiki_transfer_jobs_preview_version_check", sql`preview_version > 0`),
	check("wiki_transfer_jobs_state_check", sql`state IN ('staged', 'committed')`),
	check("wiki_transfer_jobs_bundle_hash_check", sql`bundle_sha256 ~ '^[0-9a-f]{64}$'`),
	check("wiki_transfer_jobs_preview_hash_check", sql`preview_sha256 ~ '^[0-9a-f]{64}$'`),
	check("wiki_transfer_jobs_bundle_shape_check", sql`jsonb_typeof(bundle) = 'object' AND bundle->>'format' = 'AetherverseWikiBundleV1'`),
	check("wiki_transfer_jobs_preview_shape_check", sql`jsonb_typeof(preview) = 'object'`),
]);

export const wikiTransferPageMappings = pgTable("wiki_transfer_page_mappings", {
	originId: uuid("origin_id").notNull(),
	sourcePageId: uuid("source_page_id").notNull(),
	sourceRevisionId: uuid("source_revision_id").notNull(),
	// Digest of sourceRevisionId, the staff snapshot, and canonical citation tuples.
	sourcePageIdentitySha256: varchar("source_snapshot_sha256", { length: 64 }).notNull(),
	targetPageId: uuid("target_page_id").notNull(),
	targetRevisionId: uuid("target_revision_id").notNull(),
	targetSnapshotSha256: varchar("target_snapshot_sha256", { length: 64 }).notNull(),
	createdAt: timestamp("created_at", { mode: 'string', withTimezone: true }).defaultNow().notNull(),
}, (table) => [
	primaryKey({ columns: [table.originId, table.sourcePageId], name: "wiki_transfer_page_mappings_identity_key" }),
	unique("wiki_transfer_page_mappings_target_page_key").on(table.targetPageId),
	foreignKey({ columns: [table.targetPageId], foreignColumns: [wikiPages.id], name: "wiki_transfer_page_mappings_target_page_fkey" }).onDelete("restrict"),
	foreignKey({ columns: [table.targetPageId, table.targetRevisionId], foreignColumns: [wikiRevisions.pageId, wikiRevisions.id], name: "wiki_transfer_page_mappings_target_revision_fkey" }).onDelete("restrict"),
	check("wiki_transfer_page_mappings_source_hash_check", sql`source_snapshot_sha256 ~ '^[0-9a-f]{64}$'`),
	check("wiki_transfer_page_mappings_target_hash_check", sql`target_snapshot_sha256 ~ '^[0-9a-f]{64}$'`),
]);

export const wikiTransferSourceMappings = pgTable("wiki_transfer_source_mappings", {
	originId: uuid("origin_id").notNull(),
	sourceSourceId: uuid("source_source_id").notNull(),
	sourceRecordSha256: varchar("source_record_sha256", { length: 64 }).notNull(),
	targetSourceId: uuid("target_source_id").notNull(),
	createdAt: timestamp("created_at", { mode: 'string', withTimezone: true }).defaultNow().notNull(),
}, (table) => [
	primaryKey({ columns: [table.originId, table.sourceSourceId], name: "wiki_transfer_source_mappings_identity_key" }),
	foreignKey({ columns: [table.targetSourceId], foreignColumns: [wikiSources.id], name: "wiki_transfer_source_mappings_target_source_fkey" }).onDelete("restrict"),
	check("wiki_transfer_source_mappings_hash_check", sql`source_record_sha256 ~ '^[0-9a-f]{64}$'`),
]);

export const wikiRevisionCategories = pgTable("wiki_revision_categories", {
	revisionId: uuid("revision_id").notNull(),
	category: varchar({ length: 100 }).notNull(),
	categoryKey: varchar("category_key", { length: 100 }).notNull(),
}, (table) => [
	unique("wiki_revision_categories_revision_category_key").on(table.revisionId, table.categoryKey),
	foreignKey({ columns: [table.revisionId], foreignColumns: [wikiRevisions.id], name: "wiki_revision_categories_revision_id_fkey" }).onDelete("restrict"),
]);

export const wikiRevisionLinks = pgTable("wiki_revision_links", {
	revisionId: uuid("revision_id").notNull(),
	targetNameKey: varchar("target_name_key", { length: 100 }).notNull(),
	targetAnchor: varchar("target_anchor", { length: 80 }).notNull().default(''),
}, (table) => [
	unique("wiki_revision_links_identity_key").on(table.revisionId, table.targetNameKey, table.targetAnchor),
	foreignKey({ columns: [table.revisionId], foreignColumns: [wikiRevisions.id], name: "wiki_revision_links_revision_id_fkey" }).onDelete("restrict"),
]);

// Restricted staging and reconciliation records for content-only legacy recovery.
// The original browser snapshot and credentials never belong in this schema.
export const legacyImports = pgTable("legacy_imports", {
	id: uuid().primaryKey().notNull().defaultRandom(),
	contentDigest: varchar("content_digest", { length: 64 }).notNull(),
	firstSourceId: uuid("first_source_id").notNull(),
	firstExportId: uuid("first_export_id").notNull(),
	firstRawSnapshotSha256: varchar("first_raw_snapshot_sha256", { length: 64 }).notNull(),
	firstOriginLabel: varchar("first_origin_label", { length: 200 }).notNull(),
	importedBy: uuid("imported_by").notNull(),
	createdAt: timestamp("created_at", { mode: 'string', withTimezone: true }).defaultNow().notNull(),
}, (table) => [
	unique("legacy_imports_content_digest_key").on(table.contentDigest),
	foreignKey({ columns: [table.importedBy], foreignColumns: [users.id], name: "legacy_imports_imported_by_fkey" }).onDelete("restrict"),
	check("legacy_imports_content_digest_check", sql`content_digest ~ '^[0-9a-f]{64}$'`),
	check("legacy_imports_raw_hash_check", sql`first_raw_snapshot_sha256 ~ '^[0-9a-f]{64}$'`),
]);

export const legacyImportProvenance = pgTable("legacy_import_provenance", {
	id: uuid().primaryKey().notNull().defaultRandom(),
	importId: uuid("import_id").notNull(),
	sourceId: uuid("source_id").notNull(),
	exportId: uuid("export_id").notNull(),
	rawSnapshotSha256: varchar("raw_snapshot_sha256", { length: 64 }).notNull(),
	originLabel: varchar("origin_label", { length: 200 }).notNull(),
	recordedBy: uuid("recorded_by").notNull(),
	createdAt: timestamp("created_at", { mode: 'string', withTimezone: true }).defaultNow().notNull(),
}, (table) => [
	unique("legacy_import_provenance_identity_key").on(table.importId, table.sourceId, table.rawSnapshotSha256),
	foreignKey({ columns: [table.importId], foreignColumns: [legacyImports.id], name: "legacy_import_provenance_import_id_fkey" }).onDelete("restrict"),
	foreignKey({ columns: [table.recordedBy], foreignColumns: [users.id], name: "legacy_import_provenance_recorded_by_fkey" }).onDelete("restrict"),
	check("legacy_import_provenance_raw_hash_check", sql`raw_snapshot_sha256 ~ '^[0-9a-f]{64}$'`),
]);

export const legacyImportJobs = pgTable("legacy_import_jobs", {
	id: uuid().primaryKey().notNull().defaultRandom(),
	createdBy: uuid("created_by").notNull(),
	sourceId: uuid("source_id").notNull(),
	exportId: uuid("export_id").notNull(),
	rawSnapshotSha256: varchar("raw_snapshot_sha256", { length: 64 }).notNull(),
	legacyOrigin: varchar("legacy_origin", { length: 200 }).notNull(),
	batchCount: integer("batch_count").notNull(),
	state: varchar({ length: 16 }).default("uploading").notNull(),
	version: integer().default(1).notNull(),
	contentDigest: varchar("content_digest", { length: 64 }),
	planHash: varchar("plan_hash", { length: 64 }),
	plan: jsonb(),
	previewReport: jsonb("preview_report"),
	importId: uuid("import_id"),
	createdAt: timestamp("created_at", { mode: 'string', withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string', withTimezone: true }).defaultNow().notNull(),
	committedAt: timestamp("committed_at", { mode: 'string', withTimezone: true }),
}, (table) => [
	unique("legacy_import_jobs_actor_source_export_key").on(table.createdBy, table.sourceId, table.exportId),
	foreignKey({ columns: [table.createdBy], foreignColumns: [users.id], name: "legacy_import_jobs_created_by_fkey" }).onDelete("restrict"),
	foreignKey({ columns: [table.importId], foreignColumns: [legacyImports.id], name: "legacy_import_jobs_import_id_fkey" }).onDelete("restrict"),
	check("legacy_import_jobs_batch_count_check", sql`batch_count BETWEEN 1 AND 100`),
	check("legacy_import_jobs_version_check", sql`version > 0`),
	check("legacy_import_jobs_state_check", sql`state IN ('uploading', 'staged', 'previewed', 'committed', 'replay')`),
	check("legacy_import_jobs_raw_hash_check", sql`raw_snapshot_sha256 ~ '^[0-9a-f]{64}$'`),
	check("legacy_import_jobs_content_digest_check", sql`content_digest IS NULL OR content_digest ~ '^[0-9a-f]{64}$'`),
	check("legacy_import_jobs_plan_hash_check", sql`plan_hash IS NULL OR plan_hash ~ '^[0-9a-f]{64}$'`),
]);

export const legacyImportBatches = pgTable("legacy_import_batches", {
	jobId: uuid("job_id").notNull(),
	batchNumber: integer("batch_number").notNull(),
	batchHash: varchar("batch_hash", { length: 64 }).notNull(),
	payload: jsonb().notNull(),
	createdAt: timestamp("created_at", { mode: 'string', withTimezone: true }).defaultNow().notNull(),
}, (table) => [
	unique("legacy_import_batches_job_number_key").on(table.jobId, table.batchNumber),
	foreignKey({ columns: [table.jobId], foreignColumns: [legacyImportJobs.id], name: "legacy_import_batches_job_id_fkey" }).onDelete("restrict"),
	check("legacy_import_batches_number_check", sql`batch_number BETWEEN 1 AND 100`),
	check("legacy_import_batches_hash_check", sql`batch_hash ~ '^[0-9a-f]{64}$'`),
]);

export const legacyImportTargets = pgTable("legacy_import_targets", {
	importId: uuid("import_id").notNull(),
	resourceType: varchar("resource_type", { length: 16 }).notNull(),
	legacyId: varchar("legacy_id", { length: 80 }).notNull(),
	targetId: uuid("target_id").notNull(),
	authorId: uuid("author_id"),
	authorLabel: text("author_label"),
	legacyCreatedAtText: text("legacy_created_at_text"),
	legacyUpdatedAtText: text("legacy_updated_at_text"),
	createdAt: timestamp("created_at", { mode: 'string', withTimezone: true }).defaultNow().notNull(),
}, (table) => [
	unique("legacy_import_targets_identity_key").on(table.importId, table.resourceType, table.legacyId),
	foreignKey({ columns: [table.importId], foreignColumns: [legacyImports.id], name: "legacy_import_targets_import_id_fkey" }).onDelete("restrict"),
	foreignKey({ columns: [table.authorId], foreignColumns: [users.id], name: "legacy_import_targets_author_id_fkey" }).onDelete("restrict"),
	check("legacy_import_targets_type_check", sql`resource_type IN ('category', 'thread', 'post', 'character', 'scene', 'turn')`),
]);

export const legacyImportSourceMappings = pgTable("legacy_import_source_mappings", {
	sourceId: uuid("source_id").notNull(),
	resourceType: varchar("resource_type", { length: 16 }).notNull(),
	legacyId: varchar("legacy_id", { length: 80 }).notNull(),
	importId: uuid("import_id").notNull(),
	targetId: uuid("target_id").notNull(),
	createdAt: timestamp("created_at", { mode: 'string', withTimezone: true }).defaultNow().notNull(),
}, (table) => [
	unique("legacy_import_source_mappings_identity_key").on(table.sourceId, table.resourceType, table.legacyId),
	foreignKey({ columns: [table.importId], foreignColumns: [legacyImports.id], name: "legacy_import_source_mappings_import_id_fkey" }).onDelete("restrict"),
	check("legacy_import_source_mappings_type_check", sql`resource_type IN ('category', 'thread', 'post', 'character', 'scene', 'turn')`),
]);

