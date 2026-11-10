import fs from 'node:fs';
import path from 'node:path';
import type { Request } from 'express';
import { ApiError } from '../../../server/errors.js';
import type {
  PublicTimelineEvent,
  QueryExecutor,
  TimelineCountRow,
  TimelineQueryExecutor,
  TimelineRow,
  TimelineSeedOptions,
} from './contract.js';
import {
  AUDIT_FALLBACK_LABEL,
  ISO_TIMESTAMP_RE,
  TIMELINE_TARGET_TYPE,
  UUID_RE,
  isRecord,
  requestBody,
  queryParam,
  sessionUserId,
  warningMessage,
} from './contract.js';

export function validateExpectedUpdatedAt(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string'
      || !ISO_TIMESTAMP_RE.test(value)
      || Number.isNaN(Date.parse(value))) {
    throw new ApiError(400, 'INVALID_TIMESTAMP', 'O campo expectedUpdatedAt deve ser um timestamp ISO válido.');
  }
  return value;
}

export function expectedUpdatedAtFrom(req: Request): string | undefined {
  const body = requestBody(req);
  const bodyValue = body.expectedUpdatedAt;
  if (bodyValue !== undefined) return validateExpectedUpdatedAt(bodyValue);
  const queryValue = queryParam(req.query, 'expectedUpdatedAt');
  if (queryValue !== undefined) return validateExpectedUpdatedAt(queryValue);
  return undefined;
}

function asDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') return new Date(value);
  return new Date(Number.NaN);
}

export function updatedAtMatches(rowValue: unknown, expected: string): boolean {
  const actual = asDate(rowValue).getTime();
  const wanted = Date.parse(expected);
  return Number.isFinite(actual) && Number.isFinite(wanted) && actual === wanted;
}

export function staleUpdateError(): ApiError {
  return new ApiError(409, 'STALE_UPDATE', 'O evento foi alterado por outra pessoa. Recarregue e tente novamente.');
}

export function auditActor(req: Request): { actorId: string | null; actorLabel: string | null } {
  const sessionUserIdValue = sessionUserId(req);
  if (typeof sessionUserIdValue === 'string' && UUID_RE.test(sessionUserIdValue)) {
    return { actorId: sessionUserIdValue.toLowerCase(), actorLabel: null };
  }
  return { actorId: null, actorLabel: AUDIT_FALLBACK_LABEL };
}

function jsonParameter(executor: QueryExecutor, value: unknown): unknown {
  const payload = value === undefined || value === null ? {} : value;
  if (executor && typeof executor.json === 'function') return executor.json(payload);
  return JSON.stringify(payload);
}

interface TimelineAuditInput {
  action: string;
  targetId: string;
  reason: string;
  before: unknown;
  after: unknown;
}

export async function writeTimelineAudit(
  executor: QueryExecutor,
  req: Request,
  { action, targetId, reason, before, after }: TimelineAuditInput,
): Promise<void> {
  const actor = auditActor(req);
  await executor`
    INSERT INTO audit_events (
      actor_id, actor_label, action, target_type, target_id, reason, before_state, after_state
    ) VALUES (
      ${actor.actorId}, ${actor.actorLabel}, ${action}, ${TIMELINE_TARGET_TYPE}, ${targetId},
      ${reason}, ${jsonParameter(executor, before)}, ${jsonParameter(executor, after)}
    )`;
}

/**
 * Plain transaction helper for maintenance paths that do not represent an
 * authenticated actor. Privileged timeline writes must use
 * `auth.withActorTransaction` so the actor row is locked and its role is
 * revalidated inside the same transaction before any event read or write.
 */
export async function withTimelineTransaction<T>(
  sql: TimelineQueryExecutor,
  callback: (tx: QueryExecutor) => Promise<T>,
): Promise<T> {
  if (typeof sql.begin === 'function') return sql.begin(callback);
  return callback(sql);
}

export function publicTimelineEvent(row: TimelineRow): PublicTimelineEvent {
  return {
    id: row.id,
    internalId: row.internal_id,
    title: row.title,
    shortTitle: row.short_title || row.title,
    summary: row.summary || '',
    color: row.color || 'Green',
    era: row.era || 'Before Daare',
    startDate: row.start_date,
    endDate: row.end_date || '',
    orderIndex: row.order_index || 0,
    tags: row.tags || '',
    storyArc: row.story_arc || '',
    characters: row.characters || '',
    characterGroup: row.character_group || '',
    location: row.location || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function ensureTimelineSchema(sql: QueryExecutor): Promise<void> {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS "timeline_events" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "internal_id" varchar(50) NOT NULL,
        "title" varchar(250) NOT NULL,
        "short_title" varchar(150),
        "summary" text DEFAULT '',
        "color" varchar(50) DEFAULT 'Green',
        "era" varchar(50) DEFAULT 'Before Daare' NOT NULL,
        "start_date" varchar(100) NOT NULL,
        "end_date" varchar(100),
        "order_index" integer DEFAULT 0 NOT NULL,
        "tags" varchar(250) DEFAULT '',
        "story_arc" varchar(150) DEFAULT '',
        "characters" text DEFAULT '',
        "character_group" varchar(150) DEFAULT '',
        "location" varchar(150) DEFAULT '',
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
      )`;

    await sql`CREATE INDEX IF NOT EXISTS "idx_timeline_events_era" ON "timeline_events" ("era")`;
    await sql`CREATE INDEX IF NOT EXISTS "idx_timeline_events_order" ON "timeline_events" ("order_index")`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS "idx_timeline_events_internal_id" ON "timeline_events" ("internal_id")`;
  } catch (error) {
    console.warn('Aviso ao verificar schema da timeline:', warningMessage(error));
  }
}

export async function seedTimelineIfEmpty(
  sql: TimelineQueryExecutor,
  options: TimelineSeedOptions,
): Promise<void> {
  const seedFile = path.join(options.repoRoot, 'server', 'timeline-seed.json');
  if (!fs.existsSync(seedFile)) return;
  const items: unknown = JSON.parse(fs.readFileSync(seedFile, 'utf8'));
  if (!Array.isArray(items) || items.length === 0) return;
  if (typeof sql.begin !== 'function') {
    throw new Error('Timeline seeding requires a transactional PostgreSQL client.');
  }

  // The empty check, all inserts and any failure share one transaction. A
  // failed seed therefore leaves the table unchanged instead of creating a
  // partial public timeline that the explicit-empty guard would then refuse to
  // repair.
  await sql.begin(async (tx) => {
    const existing = await tx<TimelineCountRow>`SELECT count(*)::int AS total FROM timeline_events`;
    const existingRow = existing[0];
    if (existingRow && existingRow.total > 0) return;

    for (const rawItem of items) {
      const item = isRecord(rawItem) ? rawItem : {};
      await tx`
        INSERT INTO timeline_events (
          internal_id, title, short_title, summary, color, era,
          start_date, end_date, order_index, tags, story_arc,
          characters, character_group, location
        ) VALUES (
          ${item.internalId}, ${item.title}, ${item.shortTitle || item.title},
          ${item.summary || ''}, ${item.color || 'Green'}, ${item.era || 'Before Daare'},
          ${item.startDate}, ${item.endDate || ''}, ${item.orderIndex || 0},
          ${item.tags || ''}, ${item.storyArc || ''}, ${item.characters || ''},
          ${item.characterGroup || ''}, ${item.location || ''}
        ) ON CONFLICT (internal_id) DO NOTHING`;
    }
  });
  console.log(`[Timeline] Seed de ${items.length} eventos executado com sucesso.`);
}
