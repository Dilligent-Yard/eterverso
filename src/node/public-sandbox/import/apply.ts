import type {
  ApplyResult,
  ImportPlan,
  ImportStats,
  UnknownRecord,
} from './contracts.js';
import { canonicalJson, publicError } from './primitives.js';
import type { ImportRepository, TransactionSql } from './repository.js';
import { createPostgresRepository } from './repository.js';

const USER_COMPARE = [
  'username', 'email', 'avatar', 'title', 'bio', 'posts_count', 'adm_tentativa_usada',
  'role', 'is_staff', 'disabled_at', 'auth_version', 'version', 'join_date',
] as const;
const CHARACTER_COMPARE = [
  'author_id', 'hidden_at', 'version', 'nome', 'categoria', 'titulo', 'raca', 'faccao',
  'status', 'imagem', 'descricao', 'stats', 'skills', 'mascara_tier', 'blocks', 'theme',
  'created_at', 'updated_at',
] as const;
const SCENE_COMPARE = [
  'author_id', 'hidden_at', 'version', 'titulo', 'subtitulo', 'categoria', 'status',
  'resumo', 'banner', 'descricao', 'theme', 'infobox', 'blocks', 'turns',
  'created_at', 'updated_at',
] as const;
const TURN_COMPARE = [
  'scene_id', 'author_id', 'legacy_author_label', 'legacy_id', 'ordinal', 'content',
  'presentation', 'version', 'deleted_at',
] as const;
const SECTION_COMPARE = ['name', 'description', 'parent_key', 'sort_order'] as const;
const PAGE_COMPARE = [
  'head_revision_id', 'published_revision_id', 'work_version', 'public_version',
  'access_level', 'archived_at', 'discussion_thread_id', 'created_by', 'published_at',
  'created_at', 'updated_at',
] as const;
const REVISION_COMPARE = [
  'page_id', 'sequence', 'parent_revision_id', 'base_published_revision_id', 'actor_id',
  'edit_summary', 'snapshot', 'restores_id', 'accepted_proposal_id', 'created_at',
] as const;
const NAME_COMPARE = ['page_id', 'kind'] as const;
const REVISION_CATEGORY_COMPARE = ['revision_id', 'category', 'category_key'] as const;
const REVISION_LINK_COMPARE = ['revision_id', 'target_name_key', 'target_anchor'] as const;
const FORUM_CATEGORY_COMPARE = ['name', 'description', 'archived_at', 'version', 'created_at', 'updated_at'] as const;
const THREAD_COMPARE = [
  'category_id', 'author_id', 'author_label', 'title', 'tag', 'pinned', 'views',
  'locked', 'archived_at', 'version', 'last_activity_at', 'next_post_no',
  'created_at', 'updated_at',
] as const;
const POST_COMPARE = [
  'thread_id', 'author_id', 'author_label', 'content', 'edited', 'post_no',
  'deleted_at', 'version', 'created_at', 'updated_at',
] as const;

function rowField(row: object, key: string): unknown {
  return (row as Record<string, unknown>)[key];
}

function dateValue(value: unknown): string | number | Date {
  return value as string | number | Date;
}

function sameTimestamp(left: unknown, right: unknown): boolean {
  const leftTime = new Date(dateValue(left)).getTime();
  const rightTime = new Date(dateValue(right)).getTime();
  if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) return String(left) === String(right);
  return leftTime === rightTime;
}

function sameValue(left: unknown, right: unknown): boolean {
  if (right === null || right === undefined) return left === null || left === undefined;
  if (typeof right === 'boolean') return Boolean(left) === right;
  if (typeof right === 'number') return Number(left) === right;
  if (right instanceof Date) return sameTimestamp(left, right);
  if (typeof right === 'string') {
    if (/^\d{4}-\d{2}-\d{2}(?:[T ].*)?$/u.test(right) && !Number.isNaN(new Date(right).getTime())) {
      return sameTimestamp(left, right);
    }
    return String(left) === right;
  }
  if (typeof right === 'object') return canonicalJson(left) === canonicalJson(right);
  return left === right;
}

function assertRowMatches(
  label: string,
  actual: UnknownRecord,
  expected: object,
  fields: readonly string[],
): void {
  for (const field of fields) {
    if (!sameValue(actual[field], rowField(expected, field))) {
      throw publicError(`The sandbox already contains different local content for ${label} (${field}); refusing to overwrite it.`);
    }
  }
}

function createStats(): ImportStats {
  return { inserted: 0, unchanged: 0, byType: {} };
}

function record(stats: ImportStats, type: string, outcome: 'inserted' | 'unchanged'): void {
  stats.byType[type] ||= { inserted: 0, unchanged: 0 };
  stats.byType[type][outcome] += 1;
  stats[outcome] += 1;
}

interface EnsureRowOptions<Row extends object> {
  get: () => Promise<UnknownRecord | null>;
  insert: (row: Row) => Promise<void>;
  expected: Row;
  compare: readonly string[];
}

async function ensureRow<Row extends object>(
  stats: ImportStats,
  type: string,
  { get, insert, expected, compare }: EnsureRowOptions<Row>,
): Promise<'inserted' | 'unchanged'> {
  const existing = await get();
  if (!existing) {
    await insert(expected);
    record(stats, type, 'inserted');
    return 'inserted';
  }
  assertRowMatches(type, existing, expected, compare);
  record(stats, type, 'unchanged');
  return 'unchanged';
}

export async function applyPlanWithRepository(
  plan: ImportPlan,
  repository: ImportRepository,
): Promise<ApplyResult> {
  if (!plan || !repository) {
    throw new TypeError('applyPlanWithRepository requires a plan and repository.');
  }
  const stats = createStats();
  for (const user of plan.users) {
    const existing = await repository.getUser(user.id);
    if (existing) {
      const byName = await repository.getUserByUsername(user.username);
      if (byName && rowField(byName, 'id') !== user.id) {
        throw publicError('A synthetic or placeholder username is already used by another account.');
      }
      assertRowMatches('user', existing, user, USER_COMPARE);
      const passwordHash = rowField(existing, 'password_hash');
      if (user.kind === 'synthetic-tester') {
        if (typeof passwordHash !== 'string' || !passwordHash) {
          throw publicError('An existing synthetic tester has no usable password hash; refusing to replace it.');
        }
      } else if (passwordHash !== '') {
        throw publicError('A public author placeholder unexpectedly has login credentials; refusing to modify it.');
      }
      record(stats, 'user', 'unchanged');
    } else {
      if (user.kind === 'synthetic-tester' && !user.password_hash) {
        throw publicError('Synthetic tester credentials are required before creating the local testers.');
      }
      const byName = await repository.getUserByUsername(user.username);
      if (byName) throw publicError('A synthetic or placeholder username is already used by another account.');
      await repository.insertUser(user);
      record(stats, 'user', 'inserted');
    }
  }

  for (const character of plan.characters) {
    await ensureRow(stats, 'character', {
      get: () => repository.getCharacter(character.id),
      insert: (row) => repository.insertCharacter(row),
      expected: character,
      compare: CHARACTER_COMPARE,
    });
  }

  for (const category of plan.forum.categories) {
    await ensureRow(stats, 'forum-category', {
      get: () => repository.getForumCategory(category.id),
      insert: (row) => repository.insertForumCategory(row),
      expected: category,
      compare: FORUM_CATEGORY_COMPARE,
    });
  }
  for (const thread of plan.forum.threads) {
    await ensureRow(stats, 'forum-thread', {
      get: () => repository.getThread(thread.id),
      insert: (row) => repository.insertThread(row),
      expected: thread,
      compare: THREAD_COMPARE,
    });
  }
  for (const post of plan.forum.posts) {
    await ensureRow(stats, 'forum-post', {
      get: () => repository.getPost(post.id),
      insert: (row) => repository.insertPost(row),
      expected: post,
      compare: POST_COMPARE,
    });
  }

  for (const section of plan.sections) {
    await ensureRow(stats, 'wiki-section', {
      get: () => repository.getWikiSection(section.key),
      insert: (row) => repository.insertWikiSection(row),
      expected: section,
      compare: SECTION_COMPARE,
    });
  }

  for (const wikiPage of plan.wikiPages) {
    const existing = await repository.getWikiPage(wikiPage.page.id);
    if (existing) {
      assertRowMatches('wiki page', existing, wikiPage.page, PAGE_COMPARE);
      record(stats, 'wiki-page', 'unchanged');
    } else {
      await repository.insertWikiPage({
        ...wikiPage.page,
        head_revision_id: null,
        published_revision_id: null,
      });
      record(stats, 'wiki-page', 'inserted');
    }
    await ensureRow(stats, 'wiki-revision', {
      get: () => repository.getWikiRevision(wikiPage.revision.id),
      insert: (row) => repository.insertWikiRevision(row),
      expected: wikiPage.revision,
      compare: REVISION_COMPARE,
    });
    if (!existing) await repository.updateWikiPageRevisionPointers(wikiPage.page.id, wikiPage.revision.id);
    for (const name of wikiPage.names) {
      await ensureRow(stats, 'wiki-name', {
        get: () => repository.getWikiName(name.name_key),
        insert: (row) => repository.insertWikiName(row),
        expected: name,
        compare: NAME_COMPARE,
      });
    }
    for (const category of wikiPage.categories) {
      await ensureRow(stats, 'wiki-revision-category', {
        get: () => repository.getWikiRevisionCategory(category.revision_id, category.category_key),
        insert: (row) => repository.insertWikiRevisionCategory(row),
        expected: category,
        compare: REVISION_CATEGORY_COMPARE,
      });
    }
    for (const link of wikiPage.links) {
      await ensureRow(stats, 'wiki-revision-link', {
        get: () => repository.getWikiRevisionLink(link.revision_id, link.target_name_key, link.target_anchor),
        insert: (row) => repository.insertWikiRevisionLink(row),
        expected: link,
        compare: REVISION_LINK_COMPARE,
      });
    }
  }

  for (const scene of plan.scenes) {
    const sceneExisted = !!(await repository.getScene(scene.row.id));
    await ensureRow(stats, 'scene', {
      get: () => repository.getScene(scene.row.id),
      insert: (row) => repository.insertScene(row),
      expected: scene.row,
      compare: SCENE_COMPARE,
    });
    const existingTurns = await repository.getSceneTurns(scene.row.id);
    if (sceneExisted && existingTurns.length !== scene.turns.length) {
      throw publicError('The sandbox scene has a different local turn count; refusing to overwrite it.');
    }
    const turnsByOrdinal = new Map<number, UnknownRecord>(
      existingTurns.map((turn) => [Number(rowField(turn, 'ordinal')), turn]),
    );
    for (const turn of scene.turns) {
      const existing = turnsByOrdinal.get(turn.ordinal);
      if (!existing) {
        await repository.insertSceneTurn(turn);
        record(stats, 'scene-turn', 'inserted');
        continue;
      }
      assertRowMatches('scene turn', existing, turn, TURN_COMPARE);
      record(stats, 'scene-turn', 'unchanged');
    }
    await ensureRow(stats, 'scene-turn-backup', {
      get: () => repository.getSceneTurnBackup(scene.row.id),
      insert: (row) => repository.insertSceneTurnBackup(row),
      expected: {
        scene_id: scene.row.id,
        turns: scene.legacyTurns,
        legacy_sha256: scene.legacySha256,
        created_at: scene.row.updated_at,
      },
      compare: ['turns', 'legacy_sha256'],
    });
    await ensureRow(stats, 'scene-turn-marker', {
      get: () => repository.getSceneTurnMarker(scene.row.id),
      insert: (row) => repository.insertSceneTurnMarker(row),
      expected: {
        scene_id: scene.row.id,
        turn_count: scene.turnCount,
        legacy_sha256: scene.legacySha256,
        completed_at: scene.row.updated_at,
      },
      compare: ['turn_count', 'legacy_sha256'],
    });
  }

  return {
    ...stats,
    noop: stats.inserted === 0,
    plan: {
      captureId: plan.capture.captureId,
      counts: plan.counts,
    },
  };
}

export interface ImportSql extends TransactionSql {
  begin<T>(callback: (tx: TransactionSql) => Promise<T>): Promise<T>;
}

export interface ApplyImportPlanOptions {
  plan?: ImportPlan;
  sql?: ImportSql;
  verifyIdentity?: (tx: TransactionSql) => Promise<void>;
}

export async function applyImportPlan({
  plan,
  sql,
  verifyIdentity,
}: ApplyImportPlanOptions = {}): Promise<ApplyResult> {
  if (!plan || !sql || typeof sql.begin !== 'function') {
    throw new TypeError('applyImportPlan requires a plan and a postgres client with transaction support.');
  }
  return sql.begin(async (tx) => {
    if (verifyIdentity) await verifyIdentity(tx);
    const repository = createPostgresRepository(tx);
    return applyPlanWithRepository(plan, repository);
  });
}
