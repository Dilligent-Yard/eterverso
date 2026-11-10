import * as path from 'node:path';
import { URL } from 'node:url';
import {
  CaptureFatalError,
  CaptureHttpError,
  MAX_REDIRECTS,
  SCHEMA_VERSION,
  characterId,
  forumThreadId,
  isRecord,
  makeCaptureId,
  pageId,
  parseJsonUnknown,
  safeFamilyName,
  sceneId,
  sha256,
} from './contracts.js';
import type {
  CaptureDataset,
  CaptureGap,
  CaptureManifest,
  CaptureOptions,
  CaptureRecord,
  CaptureRequestRecord,
  UnresolvedChange,
} from './contracts.js';
import type { HttpExchangeResult } from './transport.js';
import {
  assertAllowedEndpoint,
  httpExchange,
  parseRetryAfter,
} from './transport.js';
import { writePrivateFile } from './policy.js';
import { findSensitiveKey } from './validation.js';

export interface StoredResponse {
  json: unknown;
  digest: string;
  storedAs: string | null;
}

function errorStringField(error: unknown, key: string): string {
  if (!isRecord(error)) return '';
  const value = error[key];
  return typeof value === 'string' ? value : '';
}

function errorStatusField(error: unknown): number {
  if (!isRecord(error)) return 0;
  const value = error.status;
  return typeof value === 'number' && Number.isInteger(value) ? value : 0;
}

function requiredId(record: CaptureRecord, idOf: (value: unknown) => unknown): string {
  const id = idOf(record);
  if (typeof id !== 'string' || !id) {
    throw new CaptureFatalError('INVALID_ENTITY_ID', 'A captured record did not contain a usable id.');
  }
  return id;
}

function entityIds(records: readonly CaptureRecord[], idOf: (value: unknown) => unknown): string[] {
  return records.map((record) => requiredId(record, idOf));
}

export class CaptureSession {
  readonly options: CaptureOptions;
  readonly origin: string;
  readonly startedAt: string;
  finishedAt: string | null;
  readonly captureId: string;
  attempts: number;
  readonly requests: CaptureRequestRecord[];
  readonly gaps: CaptureGap[];
  private readonly gapKeys: Set<string>;
  readonly unresolvedChanges: UnresolvedChange[];
  private readonly unresolvedKeys: Set<string>;
  clock: number;
  nextSlotAt: number;
  readonly outputDir: string;
  readonly dataset: CaptureDataset;

  constructor(options: CaptureOptions) {
    this.options = options;
    this.origin = options.origin;
    this.startedAt = new Date().toISOString();
    this.finishedAt = null;
    this.captureId = makeCaptureId();
    this.attempts = 0;
    this.requests = [];
    this.gaps = [];
    this.gapKeys = new Set();
    this.unresolvedChanges = [];
    this.unresolvedKeys = new Set();
    this.clock = 0;
    this.nextSlotAt = 0;
    this.outputDir = options.outputDir;
    this.dataset = {
      schemaVersion: SCHEMA_VERSION,
      origin: this.origin,
      capturedAt: null,
      characters: [],
      scenes: [],
      wikiPages: [],
      wikiSections: [],
      wikiCategories: [],
      forum: { categories: [], threads: [], postsByThread: {} },
    };
  }

  async sleepFor(ms: number): Promise<void> {
    if (ms <= 0) return;
    await this.options.sleep(ms);
    this.clock += ms;
  }

  async waitForSlot(): Promise<void> {
    const start = Math.max(this.clock, this.nextSlotAt);
    if (start > this.clock) await this.sleepFor(start - this.clock);
    this.clock = start;
    this.nextSlotAt = start + this.options.requestIntervalMs;
  }

  async reserveRequest(): Promise<void> {
    if (this.attempts >= this.options.maxRequests) {
      throw new CaptureFatalError('REQUEST_BUDGET_EXHAUSTED', 'The configured request budget was exhausted.');
    }
    this.attempts += 1;
    await this.waitForSlot();
  }

  recordGap(family: string, endpoint: string, error: unknown): void {
    const status = errorStatusField(error);
    const code = errorStringField(error, 'code');
    let reason = code || 'ERROR';
    if (status === 401 || status === 403) reason = 'VISIBILITY_BOUNDARY';
    else if (status === 404) reason = 'NOT_FOUND';
    else if (status === 429) reason = 'RATE_LIMITED';
    else if (status >= 500 && status <= 599) reason = 'SERVER_ERROR';
    const key = `${family}\0${endpoint}\0${status}\0${reason}`;
    if (this.gapKeys.has(key)) return;
    this.gapKeys.add(key);
    this.gaps.push({ family, endpoint, status, reason });
  }

  recordUnresolved(family: string, reason: string, ids: readonly unknown[] = []): void {
    const cleanIds = [...new Set(ids.filter((id): id is string => typeof id === 'string' && Boolean(id)))];
    const key = `${family}\0${reason}\0${cleanIds.join(',')}`;
    if (this.unresolvedKeys.has(key)) return;
    this.unresolvedKeys.add(key);
    this.unresolvedChanges.push({ family, reason, ids: cleanIds });
  }

  recordFatal(error: unknown): void {
    this.recordGap(
      errorStringField(error, 'family') || 'capture',
      errorStringField(error, 'endpoint'),
      error,
    );
  }

  hasGap(family: string): boolean {
    return this.gaps.some((gap) => gap.family === family);
  }

  async storeResponse(family: string, response: HttpExchangeResult): Promise<StoredResponse> {
    const body = response.body;
    let json: unknown = null;
    if (body.length) {
      try {
        json = parseJsonUnknown(body.toString('utf8'));
      } catch {
        json = null;
      }
    }
    const digest = sha256(body);
    if (json !== null) {
      const sensitivePath = findSensitiveKey(json);
      if (sensitivePath) {
        this.requests.push({
          family,
          url: response.url,
          status: response.status,
          bytes: body.length,
          sha256: digest,
          storedAs: null,
        });
        throw new CaptureFatalError(
          'SENSITIVE_FIELD_REJECTED',
          'A public response contained an unexpected sensitive field.',
          { family },
        );
      }
    } else if (body.length
        && /"(?:email|password|passwd|session|token|secret|cookie|authorization)"\s*:/i.test(body.toString('utf8'))) {
      this.requests.push({
        family,
        url: response.url,
        status: response.status,
        bytes: body.length,
        sha256: digest,
        storedAs: null,
      });
      throw new CaptureFatalError(
        'SENSITIVE_FIELD_REJECTED',
        'A public response contained an unexpected sensitive field.',
        { family },
      );
    }

    const sequence = this.requests.length + 1;
    let storedAs: string | null = null;
    if (body.length) {
      const extension = json !== null ? 'json' : 'body';
      storedAs = `raw/${String(sequence).padStart(4, '0')}-${safeFamilyName(family)}.${extension}`;
      await writePrivateFile(path.join(this.outputDir, storedAs), body);
    }
    this.requests.push({
      family,
      url: response.url,
      status: response.status,
      bytes: body.length,
      sha256: digest,
      storedAs,
    });
    return { json, digest, storedAs };
  }

  async backoff(attempt: number, retryAfterMs: number | null): Promise<void> {
    const exponential = Math.min(
      this.options.retryMaxDelayMs,
      this.options.retryBaseDelayMs * (2 ** attempt),
    );
    await this.sleepFor(Math.max(exponential, retryAfterMs || 0));
  }

  async request(family: string, pathAndQuery: string): Promise<HttpExchangeResult> {
    let current = new URL(pathAndQuery, `${this.origin}/`);
    try {
      assertAllowedEndpoint(this.origin, current, { family, endpoint: pathAndQuery });
    } catch (error) {
      if (error instanceof CaptureHttpError) {
        error.endpoint = pathAndQuery;
        error.family = family;
      }
      throw error;
    }

    let attempt = 0;
    let redirects = 0;
    for (;;) {
      try {
        await this.reserveRequest();
      } catch (error) {
        if (error instanceof CaptureFatalError) {
          error.family = family;
          error.endpoint = pathAndQuery;
        }
        throw error;
      }

      let response: HttpExchangeResult;
      try {
        response = await httpExchange({
          url: current,
          connectTimeoutMs: this.options.connectTimeoutMs,
          readTimeoutMs: this.options.readTimeoutMs,
          maxBodyBytes: this.options.maxBodyBytes,
        });
      } catch (error) {
        if (error instanceof CaptureHttpError && error.retryable && attempt < this.options.maxRetries) {
          await this.backoff(attempt, null);
          attempt += 1;
          continue;
        }
        if (error instanceof CaptureHttpError) {
          error.family = family;
          error.endpoint = pathAndQuery;
        }
        throw error;
      }

      const stored = await this.storeResponse(family, response);
      response.json = stored.json;

      if (response.status === 304) return response;

      if (response.status >= 300 && response.status < 400) {
        redirects += 1;
        if (redirects > MAX_REDIRECTS) {
          throw new CaptureHttpError('TOO_MANY_REDIRECTS', 'Redirect limit exceeded.', {
            status: response.status,
            family,
            endpoint: pathAndQuery,
          });
        }
        const location = response.headers.location;
        if (typeof location !== 'string' || !location) {
          throw new CaptureHttpError('INVALID_REDIRECT', 'Redirect response had no Location header.', {
            status: response.status,
            family,
            endpoint: pathAndQuery,
          });
        }
        let target: URL;
        try {
          target = new URL(location, current);
        } catch {
          throw new CaptureHttpError('INVALID_REDIRECT', 'Redirect target was invalid.', {
            status: response.status,
            family,
            endpoint: pathAndQuery,
          });
        }
        assertAllowedEndpoint(this.origin, target, { family, endpoint: pathAndQuery });
        current = target;
        continue;
      }

      if (response.status === 429 || (response.status >= 500 && response.status <= 599)) {
        if (attempt < this.options.maxRetries) {
          const retryAfterMs = parseRetryAfter(response.headers['retry-after']);
          await this.backoff(attempt, retryAfterMs);
          attempt += 1;
          continue;
        }
        throw new CaptureHttpError(`HTTP_${response.status}`, `Server returned HTTP ${response.status}.`, {
          status: response.status,
          family,
          endpoint: pathAndQuery,
        });
      }

      if (response.status < 200 || response.status >= 300) {
        throw new CaptureHttpError(`HTTP_${response.status}`, `Server returned HTTP ${response.status}.`, {
          status: response.status,
          family,
          endpoint: pathAndQuery,
        });
      }
      return response;
    }
  }

  async getJson(family: string, pathAndQuery: string): Promise<unknown> {
    const response = await this.request(family, pathAndQuery);
    if (response.status === 304) {
      throw new CaptureHttpError('UNEXPECTED_NOT_MODIFIED', 'Conditional response without a request condition.', {
        status: 304,
        family,
        endpoint: pathAndQuery,
      });
    }
    if (response.json === null) {
      throw new CaptureHttpError('INVALID_JSON', 'Response was not valid JSON.', {
        status: response.status,
        family,
        endpoint: pathAndQuery,
      });
    }
    return response.json;
  }

  buildDataset(): CaptureDataset {
    const capturedAt = this.finishedAt || new Date().toISOString();
    this.finishedAt = capturedAt;
    return {
      schemaVersion: SCHEMA_VERSION,
      origin: this.origin,
      capturedAt,
      characters: this.dataset.characters,
      scenes: this.dataset.scenes,
      wikiPages: this.dataset.wikiPages,
      wikiSections: this.dataset.wikiSections,
      wikiCategories: this.dataset.wikiCategories,
      forum: {
        categories: this.dataset.forum.categories,
        threads: this.dataset.forum.threads,
        postsByThread: this.dataset.forum.postsByThread,
      },
    };
  }

  buildManifest(datasetSha256: string): CaptureManifest {
    if (typeof datasetSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(datasetSha256)) {
      throw new TypeError('buildManifest requires the SHA-256 of the exact dataset bytes.');
    }
    const finishedAt = this.finishedAt || new Date().toISOString();
    this.finishedAt = finishedAt;
    const dataset = this.dataset;
    const sceneTurns = dataset.scenes.reduce((total, scene) => {
      const turns = isRecord(scene) ? scene.turns : undefined;
      return total + (Array.isArray(turns) ? turns.length : 0);
    }, 0);
    const forumPosts = dataset.forum.threads.reduce((total, thread) => {
      const posts = dataset.forum.postsByThread[requiredId(thread, forumThreadId)];
      return total + (Array.isArray(posts) ? posts.length : 0);
    }, 0);
    const complete = this.gaps.length === 0 && this.unresolvedChanges.length === 0;
    return {
      schemaVersion: SCHEMA_VERSION,
      captureId: this.captureId,
      origin: this.origin,
      startedAt: this.startedAt,
      finishedAt,
      datasetSha256,
      requestPolicy: { anonymous: true, maxRequestsPerSecond: 1 },
      counts: {
        characters: dataset.characters.length,
        scenes: dataset.scenes.length,
        sceneTurns,
        wikiPages: dataset.wikiPages.length,
        wikiSections: dataset.wikiSections.length,
        wikiCategories: dataset.wikiCategories.length,
        forumThreads: dataset.forum.threads.length,
        forumPosts,
      },
      entities: {
        characters: entityIds(dataset.characters, characterId),
        scenes: entityIds(dataset.scenes, sceneId),
        wikiPages: entityIds(dataset.wikiPages, pageId),
        forumThreads: entityIds(dataset.forum.threads, forumThreadId),
      },
      gaps: this.gaps,
      consistency: {
        complete,
        observedInterval: true,
        unresolvedChanges: this.unresolvedChanges,
      },
      requests: this.requests,
    };
  }

  async writeCapture(): Promise<{ manifest: CaptureManifest; dataset: CaptureDataset }> {
    const dataset = this.buildDataset();
    const datasetBytes = Buffer.from(`${JSON.stringify(dataset, null, 2)}\n`, 'utf8');
    const manifest = this.buildManifest(sha256(datasetBytes));
    await writePrivateFile(
      path.join(this.outputDir, 'manifest.json'),
      Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
    );
    await writePrivateFile(path.join(this.outputDir, 'dataset.json'), datasetBytes);
    return { manifest, dataset };
  }
}
