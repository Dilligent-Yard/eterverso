import * as crypto from 'node:crypto';

/**
 * Shared capture contracts and error classes for the anonymous, read-only
 * public API capture. Runtime code treats every HTTP/JSON value as `unknown`
 * until the validators in this directory accept it.
 */

export const SCHEMA_VERSION = 'AetherversePublicCaptureV1';
export const DEFAULT_ORIGIN = 'https://eterverso.onrender.com';
export const DEFAULT_MAX_REQUESTS = 500;
export const DEFAULT_REQUEST_INTERVAL_MS = 1000;
export const DEFAULT_MAX_RETRIES = 2;
export const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
export const DEFAULT_READ_TIMEOUT_MS = 20_000;
export const DEFAULT_MAX_BODY_BYTES = 16 * 1024 * 1024;
export const DEFAULT_RETRY_BASE_DELAY_MS = 500;
export const DEFAULT_RETRY_MAX_DELAY_MS = 30_000;
export const DEFAULT_RECHECK_ATTEMPTS = 2;
export const MAX_REDIRECTS = 3;
export const MAX_PAGES = 1000;
export const PAGE_SIZE = 100;

export const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export const UUID_RE = new RegExp(`^${UUID_PATTERN}$`, 'i');
export const UUID_PATH_RE = new RegExp(`^/api/(?:wiki-posts|wiki/pages)/${UUID_PATTERN}$`, 'i');
export const FORUM_THREAD_PATH_RE = new RegExp(`^/api/forum/threads/${UUID_PATTERN}$`, 'i');
export const FORUM_POSTS_PATH_RE = new RegExp(`^/api/forum/threads/${UUID_PATTERN}/posts$`, 'i');
export const SAFE_FAMILY_RE = /[^a-z0-9-]+/g;
export const SENSITIVE_KEY_RE = /(email|password|passwd|session|token|secret|cookie|authorization)/;

export type CaptureRecord = Record<string, unknown>;

export interface CaptureGap {
  family: string;
  endpoint: string;
  status: number;
  reason: string;
}

export interface UnresolvedChange {
  family: string;
  reason: string;
  ids: string[];
}

export interface CaptureRequestRecord {
  family: string;
  url: string;
  status: number;
  bytes: number;
  sha256: string;
  storedAs: string | null;
}

export interface CaptureCounts {
  characters: number;
  scenes: number;
  sceneTurns: number;
  wikiPages: number;
  wikiSections: number;
  wikiCategories: number;
  forumThreads: number;
  forumPosts: number;
}

export interface CaptureDataset {
  schemaVersion: string;
  origin: string;
  capturedAt: string | null;
  characters: CaptureRecord[];
  scenes: CaptureRecord[];
  wikiPages: CaptureRecord[];
  wikiSections: CaptureRecord[];
  wikiCategories: CaptureRecord[];
  forum: {
    categories: CaptureRecord[];
    threads: CaptureRecord[];
    postsByThread: Record<string, CaptureRecord[]>;
  };
}

export interface CaptureManifest {
  schemaVersion: string;
  captureId: string;
  origin: string;
  startedAt: string;
  finishedAt: string;
  datasetSha256: string;
  requestPolicy: { anonymous: true; maxRequestsPerSecond: number };
  counts: CaptureCounts;
  entities: {
    characters: string[];
    scenes: string[];
    wikiPages: string[];
    forumThreads: string[];
  };
  gaps: CaptureGap[];
  consistency: {
    complete: boolean;
    observedInterval: true;
    unresolvedChanges: UnresolvedChange[];
  };
  requests: CaptureRequestRecord[];
}

export interface CapturePlan {
  schemaVersion: string;
  origin: string;
  outputDir: string;
  outputPolicy: {
    privateRoot: string;
    testOnlyOverride: boolean;
  };
  requestPolicy: {
    anonymous: true;
    methods: string[];
    maxRequestsPerSecond: number;
    requestIntervalMs: number;
    maxRequests: number;
    timeoutsMs: {
      connect: number;
      read: number;
    };
  };
  families: string[];
  notes: string[];
}

export type SleepFunction = (ms: number) => Promise<void>;

export interface CaptureOptionsInput {
  origin?: unknown;
  outputDir?: unknown;
  allowLoopbackHttp?: unknown;
  allowTestOutput?: unknown;
  requestIntervalMs?: unknown;
  maxRequests?: unknown;
  maxRetries?: unknown;
  connectTimeoutMs?: unknown;
  readTimeoutMs?: unknown;
  maxBodyBytes?: unknown;
  retryBaseDelayMs?: unknown;
  retryMaxDelayMs?: unknown;
  recheckAttempts?: unknown;
  sleep?: ((ms: number) => unknown) | undefined;
  skipRecheck?: unknown;
  dryRun?: unknown;
}

export interface CaptureOptions {
  origin: string;
  outputDir: string;
  allowTestOutput: boolean;
  maxRequests: number;
  requestIntervalMs: number;
  maxRetries: number;
  connectTimeoutMs: number;
  readTimeoutMs: number;
  maxBodyBytes: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
  recheckAttempts: number;
  sleep: SleepFunction;
  skipRecheck: boolean;
}

export interface DryRunResult {
  dryRun: true;
  ok: true;
  exitCode: 0;
  plan: CapturePlan;
  origin: string;
  outputDir: string;
}

export interface CompletedCaptureResult {
  dryRun: false;
  ok: boolean;
  exitCode: number;
  manifest: CaptureManifest;
  dataset: CaptureDataset;
  outputDir: string;
  plan: CapturePlan;
}

export type RunCaptureResult = DryRunResult | CompletedCaptureResult;

export interface CaptureErrorDetails {
  family?: string;
  endpoint?: string;
  status?: number;
  retryable?: boolean;
}

export class CaptureUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CaptureUsageError';
  }
}

export class CaptureFatalError extends Error {
  code: string;
  family: string;
  endpoint: string;
  status: number | null;

  constructor(code: string, message: string, details: CaptureErrorDetails = {}) {
    super(message);
    this.name = 'CaptureFatalError';
    this.code = code;
    this.family = details.family || 'capture';
    this.endpoint = details.endpoint || '';
    this.status = typeof details.status === 'number' && Number.isInteger(details.status)
      ? details.status
      : null;
  }
}

export class CaptureHttpError extends Error {
  code: string;
  status: number | null;
  retryable: boolean;
  family: string;
  endpoint: string;

  constructor(code: string, message: string, details: CaptureErrorDetails = {}) {
    super(message);
    this.name = 'CaptureHttpError';
    this.code = code;
    this.status = typeof details.status === 'number' && Number.isInteger(details.status)
      ? details.status
      : null;
    this.retryable = details.retryable === true;
    this.family = details.family || 'capture';
    this.endpoint = details.endpoint || '';
  }
}

export class ShapeError extends CaptureHttpError {
  constructor(code: string, message: string) {
    super(code, message, { retryable: false });
    this.name = 'ShapeError';
  }
}

export function isRecord(value: unknown): value is CaptureRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

export function parseJsonUnknown(text: string): unknown {
  const parsed: unknown = JSON.parse(text);
  return parsed;
}

export function stringField(record: CaptureRecord, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

export function characterId(record: unknown): unknown {
  return isRecord(record) ? record.id : undefined;
}

export function sceneId(record: unknown): unknown {
  return isRecord(record) ? record.id : undefined;
}

export function pageId(record: unknown): unknown {
  return isRecord(record) ? record.id : undefined;
}

export function sectionId(record: unknown): unknown {
  return isRecord(record) ? record.key : undefined;
}

export function categoryKey(record: unknown): unknown {
  return isRecord(record) ? record.key : undefined;
}

export function forumCategoryId(record: unknown): unknown {
  return isRecord(record) ? record.id : undefined;
}

export function forumThreadId(record: unknown): unknown {
  return isRecord(record) ? record.id : undefined;
}

export function forumPostId(record: unknown): unknown {
  return isRecord(record) ? record.id : undefined;
}

export function sha256(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function fingerprint(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new TypeError('Cannot fingerprint a value without a JSON representation.');
  }
  return sha256(Buffer.from(serialized, 'utf8'));
}

export function makeCaptureId(now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `capture-${stamp}-${crypto.randomBytes(4).toString('hex')}`;
}

export function safeFamilyName(family: unknown): string {
  const raw = typeof family === 'string' && family ? family : 'response';
  const value = raw.toLowerCase().replace(SAFE_FAMILY_RE, '-').replace(/^-+|-+$/g, '');
  return value || 'response';
}
