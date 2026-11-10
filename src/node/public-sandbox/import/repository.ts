import type {
  CharacterRow,
  ForumCategoryRow,
  PostRow,
  SceneRow,
  SceneTurnBackupRow,
  SceneTurnMarkerRow,
  SceneTurnRow,
  ThreadRow,
  UnknownRecord,
  UserRow,
  WikiNameRow,
  WikiPageRow,
  WikiRevisionCategoryRow,
  WikiRevisionLinkRow,
  WikiRevisionRow,
  WikiSectionRow,
} from './contracts.js';

/**
 * Transaction-scoped `postgres` tagged-template client. Only the callable
 * query form and `json` helper used by the import writer are required.
 */
export interface TransactionSql {
  <Row extends Record<string, unknown> = UnknownRecord>(
    strings: TemplateStringsArray,
    ...values: readonly unknown[]
  ): Promise<Row[]>;
  json(value: unknown): unknown;
}

/**
 * Repository port consumed by `applyPlanWithRepository`. `get*` methods return
 * untyped database rows because the comparison layer checks each expected
 * field explicitly; `insert*` methods accept the validated plan rows.
 */
export interface ImportRepository {
  getUser(id: string): Promise<UnknownRecord | null>;
  getUserByUsername(username: string): Promise<UnknownRecord | null>;
  insertUser(row: UserRow): Promise<void>;
  getCharacter(id: string): Promise<UnknownRecord | null>;
  insertCharacter(row: CharacterRow): Promise<void>;
  getScene(id: string): Promise<UnknownRecord | null>;
  insertScene(row: SceneRow): Promise<void>;
  getSceneTurns(sceneId: string): Promise<UnknownRecord[]>;
  insertSceneTurn(row: SceneTurnRow): Promise<void>;
  getSceneTurnBackup(sceneId: string): Promise<UnknownRecord | null>;
  insertSceneTurnBackup(row: SceneTurnBackupRow): Promise<void>;
  getSceneTurnMarker(sceneId: string): Promise<UnknownRecord | null>;
  insertSceneTurnMarker(row: SceneTurnMarkerRow): Promise<void>;
  getWikiSection(key: string): Promise<UnknownRecord | null>;
  insertWikiSection(row: WikiSectionRow): Promise<void>;
  getWikiPage(id: string): Promise<UnknownRecord | null>;
  insertWikiPage(row: WikiPageRow): Promise<void>;
  updateWikiPageRevisionPointers(pageId: string, revisionId: string): Promise<void>;
  getWikiRevision(id: string): Promise<UnknownRecord | null>;
  insertWikiRevision(row: WikiRevisionRow): Promise<void>;
  getWikiName(nameKey: string): Promise<UnknownRecord | null>;
  insertWikiName(row: WikiNameRow): Promise<void>;
  getWikiRevisionCategory(revisionId: string, categoryKey: string): Promise<UnknownRecord | null>;
  insertWikiRevisionCategory(row: WikiRevisionCategoryRow): Promise<void>;
  getWikiRevisionLink(
    revisionId: string,
    targetNameKey: string,
    targetAnchor: string,
  ): Promise<UnknownRecord | null>;
  insertWikiRevisionLink(row: WikiRevisionLinkRow): Promise<void>;
  getForumCategory(id: string): Promise<UnknownRecord | null>;
  insertForumCategory(row: ForumCategoryRow): Promise<void>;
  getThread(id: string): Promise<UnknownRecord | null>;
  insertThread(row: ThreadRow): Promise<void>;
  getPost(id: string): Promise<UnknownRecord | null>;
  insertPost(row: PostRow): Promise<void>;
}

function firstRow<Row extends Record<string, unknown>>(rows: Row[]): Row | null {
  return rows[0] || null;
}

export function createPostgresRepository(tx: TransactionSql): ImportRepository {
  if (typeof tx !== 'function') throw new TypeError('A transaction SQL client is required.');
  return {
    getUser: async (id) => firstRow(await tx`SELECT * FROM users WHERE id = ${id}`),
    getUserByUsername: async (username) => firstRow(await tx`SELECT * FROM users WHERE lower(username) = lower(${username})`),
    insertUser: async (row) => {
      await tx`
        INSERT INTO users (
          id, email, username, password_hash, avatar, title, bio, posts_count,
          adm_tentativa_usada, role, is_staff, disabled_at, auth_version, version,
          join_date, created_at, updated_at
        ) VALUES (
          ${row.id}, ${row.email}, ${row.username}, ${row.password_hash}, ${row.avatar},
          ${row.title}, ${row.bio}, ${row.posts_count}, ${row.adm_tentativa_usada},
          ${row.role}, ${row.is_staff}, ${row.disabled_at}, ${row.auth_version},
          ${row.version}, ${row.join_date}, ${row.created_at}, ${row.updated_at}
        )`;
    },
    getCharacter: async (id) => firstRow(await tx`SELECT * FROM personagens WHERE id = ${id}`),
    insertCharacter: async (row) => {
      await tx`
        INSERT INTO personagens (
          id, author_id, hidden_at, version, nome, categoria, titulo, raca, faccao,
          status, imagem, descricao, stats, skills, mascara_tier, blocks, theme,
          created_at, updated_at
        ) VALUES (
          ${row.id}, ${row.author_id}, ${row.hidden_at}, ${row.version}, ${row.nome},
          ${row.categoria}, ${row.titulo}, ${row.raca}, ${row.faccao}, ${row.status},
          ${row.imagem}, ${row.descricao}, ${tx.json(row.stats)}, ${tx.json(row.skills)},
          ${row.mascara_tier}, ${tx.json(row.blocks)}, ${tx.json(row.theme)},
          ${row.created_at}, ${row.updated_at}
        )`;
    },
    getScene: async (id) => firstRow(await tx`SELECT * FROM wiki_posts WHERE id = ${id}`),
    insertScene: async (row) => {
      await tx`
        INSERT INTO wiki_posts (
          id, author_id, hidden_at, version, titulo, subtitulo, categoria, status,
          resumo, banner, descricao, theme, infobox, blocks, turns, created_at, updated_at
        ) VALUES (
          ${row.id}, ${row.author_id}, ${row.hidden_at}, ${row.version}, ${row.titulo},
          ${row.subtitulo}, ${row.categoria}, ${row.status}, ${row.resumo}, ${row.banner},
          ${row.descricao}, ${tx.json(row.theme)}, ${tx.json(row.infobox)},
          ${tx.json(row.blocks)}, ${tx.json(row.turns)}, ${row.created_at}, ${row.updated_at}
        )`;
    },
    getSceneTurns: async (sceneId) => tx`SELECT * FROM scene_turns WHERE scene_id = ${sceneId} ORDER BY ordinal`,
    insertSceneTurn: async (row) => {
      await tx`
        INSERT INTO scene_turns (
          id, scene_id, author_id, legacy_author_label, legacy_id, ordinal, content,
          presentation, version, deleted_at, created_at, updated_at
        ) VALUES (
          ${row.id}, ${row.scene_id}, ${row.author_id}, ${row.legacy_author_label},
          ${row.legacy_id}, ${row.ordinal}, ${row.content}, ${tx.json(row.presentation)},
          ${row.version}, ${row.deleted_at}, ${row.created_at}, ${row.updated_at}
        )`;
    },
    getSceneTurnBackup: async (sceneId) => firstRow(await tx`SELECT * FROM scene_turn_legacy_backups WHERE scene_id = ${sceneId}`),
    insertSceneTurnBackup: async (row) => {
      await tx`
        INSERT INTO scene_turn_legacy_backups (scene_id, turns, legacy_sha256, created_at)
        VALUES (${row.scene_id}, ${tx.json(row.turns)}, ${row.legacy_sha256}, ${row.created_at})`;
    },
    getSceneTurnMarker: async (sceneId) => firstRow(await tx`SELECT * FROM scene_turn_migrations WHERE scene_id = ${sceneId}`),
    insertSceneTurnMarker: async (row) => {
      await tx`
        INSERT INTO scene_turn_migrations (scene_id, turn_count, legacy_sha256, completed_at)
        VALUES (${row.scene_id}, ${row.turn_count}, ${row.legacy_sha256}, ${row.completed_at})`;
    },
    getWikiSection: async (key) => firstRow(await tx`SELECT * FROM wiki_sections WHERE key = ${key}`),
    insertWikiSection: async (row) => {
      await tx`
        INSERT INTO wiki_sections (key, name, description, parent_key, sort_order)
        VALUES (${row.key}, ${row.name}, ${row.description}, ${row.parent_key}, ${row.sort_order})`;
    },
    getWikiPage: async (id) => firstRow(await tx`SELECT * FROM wiki_pages WHERE id = ${id}`),
    insertWikiPage: async (row) => {
      await tx`
        INSERT INTO wiki_pages (
          id, head_revision_id, published_revision_id, work_version, public_version,
          access_level, archived_at, discussion_thread_id, created_by, published_at,
          created_at, updated_at
        ) VALUES (
          ${row.id}, ${row.head_revision_id}, ${row.published_revision_id}, ${row.work_version},
          ${row.public_version}, ${row.access_level}, ${row.archived_at},
          ${row.discussion_thread_id}, ${row.created_by}, ${row.published_at},
          ${row.created_at}, ${row.updated_at}
        )`;
    },
    updateWikiPageRevisionPointers: async (pageId, revisionId) => {
      await tx`UPDATE wiki_pages
        SET head_revision_id = ${revisionId}, published_revision_id = ${revisionId}
        WHERE id = ${pageId}`;
    },
    getWikiRevision: async (id) => firstRow(await tx`SELECT * FROM wiki_revisions WHERE id = ${id}`),
    insertWikiRevision: async (row) => {
      await tx`
        INSERT INTO wiki_revisions (
          id, page_id, sequence, parent_revision_id, base_published_revision_id,
          actor_id, edit_summary, snapshot, restores_id, accepted_proposal_id, created_at
        ) VALUES (
          ${row.id}, ${row.page_id}, ${row.sequence}, ${row.parent_revision_id},
          ${row.base_published_revision_id}, ${row.actor_id}, ${row.edit_summary},
          ${tx.json(row.snapshot)}, ${row.restores_id}, ${row.accepted_proposal_id},
          ${row.created_at}
        )`;
    },
    getWikiName: async (nameKey) => firstRow(await tx`SELECT * FROM wiki_names WHERE name_key = ${nameKey}`),
    insertWikiName: async (row) => {
      await tx`
        INSERT INTO wiki_names (name_key, page_id, kind, created_at)
        VALUES (${row.name_key}, ${row.page_id}, ${row.kind}, ${row.created_at})`;
    },
    getWikiRevisionCategory: async (revisionId, categoryKey) => firstRow(
      await tx`SELECT * FROM wiki_revision_categories
        WHERE revision_id = ${revisionId} AND category_key = ${categoryKey}`,
    ),
    insertWikiRevisionCategory: async (row) => {
      await tx`
        INSERT INTO wiki_revision_categories (revision_id, category, category_key)
        VALUES (${row.revision_id}, ${row.category}, ${row.category_key})`;
    },
    getWikiRevisionLink: async (revisionId, targetNameKey, targetAnchor) => firstRow(
      await tx`SELECT * FROM wiki_revision_links
        WHERE revision_id = ${revisionId} AND target_name_key = ${targetNameKey}
          AND target_anchor = ${targetAnchor}`,
    ),
    insertWikiRevisionLink: async (row) => {
      await tx`
        INSERT INTO wiki_revision_links (revision_id, target_name_key, target_anchor)
        VALUES (${row.revision_id}, ${row.target_name_key}, ${row.target_anchor})`;
    },
    getForumCategory: async (id) => firstRow(await tx`SELECT * FROM categories WHERE id = ${id}`),
    insertForumCategory: async (row) => {
      await tx`
        INSERT INTO categories (id, name, description, archived_at, version, created_at, updated_at)
        VALUES (${row.id}, ${row.name}, ${row.description}, ${row.archived_at}, ${row.version},
          ${row.created_at}, ${row.updated_at})`;
    },
    getThread: async (id) => firstRow(await tx`SELECT * FROM threads WHERE id = ${id}`),
    insertThread: async (row) => {
      await tx`
        INSERT INTO threads (
          id, category_id, author_id, author_label, legacy_reference, title, tag, pinned,
          views, locked, archived_at, quarantined_at, quarantine_reason, version,
          last_activity_at, next_post_no, created_at, updated_at
        ) VALUES (
          ${row.id}, ${row.category_id}, ${row.author_id}, ${row.author_label},
          ${row.legacy_reference}, ${row.title}, ${row.tag}, ${row.pinned}, ${row.views},
          ${row.locked}, ${row.archived_at}, ${row.quarantined_at},
          ${row.quarantine_reason}, ${row.version}, ${row.last_activity_at},
          ${row.next_post_no}, ${row.created_at}, ${row.updated_at}
        )`;
    },
    getPost: async (id) => firstRow(await tx`SELECT * FROM posts WHERE id = ${id}`),
    insertPost: async (row) => {
      await tx`
        INSERT INTO posts (
          id, thread_id, author_id, author_label, legacy_reference, content, edited,
          post_no, deleted_at, version, created_at, updated_at
        ) VALUES (
          ${row.id}, ${row.thread_id}, ${row.author_id}, ${row.author_label},
          ${row.legacy_reference}, ${row.content}, ${row.edited}, ${row.post_no},
          ${row.deleted_at}, ${row.version}, ${row.created_at}, ${row.updated_at}
        )`;
    },
  };
}
