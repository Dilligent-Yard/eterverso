import type { Request, RequestHandler } from 'express';
import type {} from 'cookie-session';

export type UnknownRecord = Record<string, unknown>;

/**
 * Small accurate port for the injected `postgres` client. The callable query
 * form is required; savepoint/json capabilities are feature-detected by the
 * callers because test doubles and non-transaction executors do not expose
 * them.
 */
export interface QueryExecutor {
  <Row extends Record<string, unknown> = UnknownRecord>(
    strings: TemplateStringsArray,
    ...values: readonly unknown[]
  ): Promise<Row[]>;
  readonly savepoint?: <T>(
    callback: (executor: QueryExecutor | undefined) => Promise<T>
  ) => Promise<T>;
  readonly json?: (value: unknown) => unknown;
}

export interface ActorUser {
  id: string;
  username?: unknown;
}

export interface InteractionsAuth {
  readonly requireIdentity: RequestHandler;
  withActorTransaction<T>(
    req: Request,
    callback: (tx: QueryExecutor, user: ActorUser) => Promise<T>
  ): Promise<T>;
}

export interface CountRow extends UnknownRecord {
  cnt: number;
}

export interface IdRow extends UnknownRecord {
  id: string;
}

export interface NotificationRow extends UnknownRecord {
  id: string;
  user_id: string;
  actor_id: string | null;
  type: string;
  reference_id: string | null;
  reference_type: string | null;
  title: string;
  message: string;
  read: boolean;
  created_at: string | Date;
}

export interface PublicNotification {
  id: string;
  type: string;
  referenceId: string | null;
  referenceType: string | null;
  title: string;
  message: string;
  read: boolean;
  createdAt: string | Date;
  actorId: string | null;
}

export interface NotificationInput {
  recipientId?: unknown;
  actorId?: unknown;
  type?: unknown;
  referenceId?: unknown;
  referenceType?: unknown;
  title?: unknown;
  message?: unknown;
}

export interface SceneTurnRow extends UnknownRecord {
  id: string;
  legacy_id: string | null;
  author_id: string | null;
}

export interface SceneLikeRow extends UnknownRecord {
  id: string;
  author_id: string | null;
  titulo?: string | null;
  turns?: unknown;
}

export interface CharacterLikeRow extends UnknownRecord {
  id: string;
  author_id: string | null;
  nome?: string | null;
}

export interface TurnLikeTarget {
  key: string;
  turnAuthorId: unknown;
  source: 'scene_turn' | 'json_turn';
}

export interface LikeToggleResult {
  liked: boolean;
  likeCount: number;
}

export interface LikeStatusResult {
  likeCount: number;
  userLiked: boolean;
}

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

export function warningDetail(error: unknown): unknown {
  return isRecord(error) && error.message ? error.message : error;
}

export function countValue(rows: readonly unknown[]): number {
  const row = rows[0];
  if (!isRecord(row)) return 0;
  const value = row.cnt;
  return typeof value === 'number' ? value : 0;
}
