import type { Request, RequestHandler } from 'express';
import type {} from 'cookie-session';

export type UnknownRecord = Record<string, unknown>;

export interface QueryExecutor {
  <Row extends Record<string, unknown> = UnknownRecord>(
    strings: TemplateStringsArray,
    ...values: readonly unknown[]
  ): Promise<Row[]>;
  readonly json?: (value: unknown) => unknown;
}

export interface TimelineQueryExecutor extends QueryExecutor {
  readonly begin?: <T>(callback: (tx: QueryExecutor) => Promise<T>) => Promise<T>;
}

export interface TimelineActor {
  id: string;
  username?: unknown;
  role: string;
}

/**
 * Mirrors the privileged-write contract in `server/auth.js`: the callback runs
 * inside a transaction that has already locked and revalidated the actor row,
 * and `assertRole` checks that fresh actor rather than the middleware snapshot.
 */
export interface TimelineAuth {
  readonly requireIdentity: RequestHandler;
  requireRole(...roles: string[]): RequestHandler;
  assertRole<T extends TimelineActor>(user: T, ...roles: string[]): T;
  withActorTransaction<T>(
    req: Request,
    callback: (tx: QueryExecutor, actor: TimelineActor) => Promise<T>
  ): Promise<T>;
}

export interface TimelineRow extends UnknownRecord {
  id: string;
  internal_id: string;
  title: string;
  short_title: string | null;
  summary: string | null;
  color: string | null;
  era: string;
  start_date: string;
  end_date: string | null;
  order_index: number;
  tags: string | null;
  story_arc: string | null;
  characters: string | null;
  character_group: string | null;
  location: string | null;
  created_at: string | Date;
  updated_at: string | Date;
}

export interface PublicTimelineEvent {
  id: string;
  internalId: string;
  title: string;
  shortTitle: string;
  summary: string;
  color: string;
  era: string;
  startDate: string;
  endDate: string;
  orderIndex: number;
  tags: string;
  storyArc: string;
  characters: string;
  characterGroup: string;
  location: string;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface TimelineMaxOrderRow extends UnknownRecord {
  max_o: number | null;
}

export interface TimelineInternalIdRow extends UnknownRecord {
  internal_id: string;
}

export interface TimelineCountRow extends UnknownRecord {
  total: number;
}

export interface TimelineDeletedRow extends UnknownRecord {
  id: string;
  title: string;
}

export interface TimelineSeedOptions {
  repoRoot: string;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
export const TIMELINE_TARGET_TYPE = 'timeline_event';
export const AUDIT_FALLBACK_LABEL = 'timeline';

export function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/**
 * Reproduce the legacy String() coercion for values that can arrive through
 * the JSON request boundary without asking the linter to assume an arbitrary
 * object stringification. Plain objects have always serialized as
 * "[object Object]" in this path; arrays follow Array.prototype.join.
 */
export function coerceText(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (typeof value === 'symbol') return String(value);
  if (Array.isArray(value)) {
    return value
      .map((item) => (item === null || item === undefined ? '' : coerceText(item)))
      .join(',');
  }
  return '[object Object]';
}

export function requestBody(req: Request): UnknownRecord {
  const body: unknown = req.body;
  return isRecord(body) ? body : {};
}

export function queryParam(query: Request['query'], key: string): unknown {
  return query[key];
}

export function sessionUserId(req: Request): unknown {
  const session: unknown = req.session;
  return isRecord(session) ? session.userId : undefined;
}

export function warningMessage(error: unknown): unknown {
  return isRecord(error) ? error.message : undefined;
}

export function parseInteger(value: unknown): number {
  return Number.parseInt(coerceText(value), 10);
}
