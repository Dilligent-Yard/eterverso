import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import {
  CaptureUsageError,
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_MAX_BODY_BYTES,
  DEFAULT_MAX_REQUESTS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_ORIGIN,
  DEFAULT_READ_TIMEOUT_MS,
  DEFAULT_RECHECK_ATTEMPTS,
  DEFAULT_REQUEST_INTERVAL_MS,
  DEFAULT_RETRY_BASE_DELAY_MS,
  DEFAULT_RETRY_MAX_DELAY_MS,
  SCHEMA_VERSION,
} from './contracts.js';
import type {
  CaptureOptions,
  CaptureOptionsInput,
  CapturePlan,
  SleepFunction,
} from './contracts.js';
import { isLoopbackHostname, normalizeOrigin } from './transport.js';

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function integerOption(
  value: unknown,
  fallback: number,
  name: string,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined || value === null) return fallback;
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new CaptureUsageError(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return number;
}

export function isPrivateCapturePath(outputDir: string, privateCaptureRoot: string): boolean {
  return outputDir.startsWith(`${privateCaptureRoot}${path.sep}`);
}

export function assertOutputLocation(
  outputDir: string,
  { origin, allowTestOutput }: { origin: string; allowTestOutput: boolean },
  privateCaptureRoot: string,
): void {
  if (allowTestOutput) {
    if (!isLoopbackHostname(new URL(origin).hostname)) {
      throw new CaptureUsageError(
        'The test-only output override requires a loopback capture origin.',
      );
    }
    return;
  }
  if (!isPrivateCapturePath(outputDir, privateCaptureRoot)) {
    throw new CaptureUsageError(
      `Capture output must be a new directory under ${privateCaptureRoot}. `
      + 'Use --allow-test-output only for loopback fake-server tests.',
    );
  }
}

export function normalizeCaptureOptions(
  raw: CaptureOptionsInput = {},
  privateCaptureRoot: string,
): CaptureOptions {
  const origin = normalizeOrigin(
    raw.origin === undefined ? DEFAULT_ORIGIN : raw.origin,
    { allowLoopbackHttp: raw.allowLoopbackHttp === true },
  );
  if (typeof raw.outputDir !== 'string' || !raw.outputDir.trim()) {
    throw new CaptureUsageError('--output is required.');
  }
  const outputDir = path.resolve(raw.outputDir.trim());
  const allowTestOutput = raw.allowTestOutput === true;
  assertOutputLocation(outputDir, { origin, allowTestOutput }, privateCaptureRoot);
  const requestIntervalMs = integerOption(
    raw.requestIntervalMs,
    DEFAULT_REQUEST_INTERVAL_MS,
    'requestIntervalMs',
    1000,
    60_000,
  );
  const retryBaseDelayMs = integerOption(
    raw.retryBaseDelayMs,
    DEFAULT_RETRY_BASE_DELAY_MS,
    'retryBaseDelayMs',
    1,
    DEFAULT_RETRY_MAX_DELAY_MS,
  );
  const retryMaxDelayMs = integerOption(
    raw.retryMaxDelayMs,
    DEFAULT_RETRY_MAX_DELAY_MS,
    'retryMaxDelayMs',
    1,
    300_000,
  );
  if (retryMaxDelayMs < retryBaseDelayMs) {
    throw new CaptureUsageError('retryMaxDelayMs must be at least retryBaseDelayMs.');
  }
  const sleepInput = raw.sleep;
  const sleep: SleepFunction = typeof sleepInput === 'function'
    ? async (ms: number): Promise<void> => { await sleepInput(ms); }
    : defaultSleep;
  return {
    origin,
    outputDir,
    allowTestOutput,
    maxRequests: integerOption(raw.maxRequests, DEFAULT_MAX_REQUESTS, 'maxRequests', 1, 100_000),
    requestIntervalMs,
    maxRetries: integerOption(raw.maxRetries, DEFAULT_MAX_RETRIES, 'maxRetries', 0, 10),
    connectTimeoutMs: integerOption(raw.connectTimeoutMs, DEFAULT_CONNECT_TIMEOUT_MS, 'connectTimeoutMs', 1, 120_000),
    readTimeoutMs: integerOption(raw.readTimeoutMs, DEFAULT_READ_TIMEOUT_MS, 'readTimeoutMs', 1, 120_000),
    maxBodyBytes: integerOption(raw.maxBodyBytes, DEFAULT_MAX_BODY_BYTES, 'maxBodyBytes', 1, 128 * 1024 * 1024),
    retryBaseDelayMs,
    retryMaxDelayMs,
    recheckAttempts: integerOption(raw.recheckAttempts, DEFAULT_RECHECK_ATTEMPTS, 'recheckAttempts', 1, 5),
    sleep,
    skipRecheck: raw.skipRecheck === true,
  };
}

export function capturePlan(options: CaptureOptions, privateCaptureRoot: string): CapturePlan {
  return {
    schemaVersion: SCHEMA_VERSION,
    origin: options.origin,
    outputDir: options.outputDir,
    outputPolicy: {
      privateRoot: privateCaptureRoot,
      testOnlyOverride: options.allowTestOutput === true,
    },
    requestPolicy: {
      anonymous: true,
      methods: ['GET'],
      maxRequestsPerSecond: 1,
      requestIntervalMs: options.requestIntervalMs,
      maxRequests: options.maxRequests,
      timeoutsMs: {
        connect: options.connectTimeoutMs,
        read: options.readTimeoutMs,
      },
    },
    families: [
      'GET /api/personagens',
      'GET /api/wiki-posts',
      'GET /api/wiki/pages?limit=100&offset=... then GET /api/wiki/pages/:id',
      'GET /api/wiki/sections',
      'GET /api/wiki/categories?limit=100&offset=...',
      'GET /api/forum/threads/:id and GET /api/forum/threads/:id/posts?limit=100&offset=... for each discussionThreadId',
      'GET /api/forum/categories?limit=100&offset=... only to select referenced categories',
    ],
    notes: [
      'Anonymous GET only; no cookies, credentials, or authentication fallback.',
      'The capture is an observation interval, not a transactional database dump.',
      'Forum thread and post discovery is limited to discussionThreadId values found in captured wiki pages.',
    ],
  };
}

function findExistingAncestor(target: string): string {
  let current = target;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return current;
}

export function assertOutputPathAvailable(outputDir: string): void {
  if (fs.existsSync(outputDir)) {
    throw new CaptureUsageError(`Output directory already exists: ${outputDir}`);
  }
  const ancestor = findExistingAncestor(path.dirname(outputDir));
  try {
    fs.accessSync(ancestor, fs.constants.W_OK);
  } catch {
    throw new CaptureUsageError(`Output parent is not writable: ${ancestor}`);
  }
}

export async function createOutputDirectory(
  outputDir: string,
  privateCaptureRoot: string,
): Promise<void> {
  assertOutputPathAvailable(outputDir);
  if (isPrivateCapturePath(outputDir, privateCaptureRoot)) {
    await fsp.mkdir(privateCaptureRoot, { recursive: true, mode: 0o700 });
    await fsp.chmod(privateCaptureRoot, 0o700);
  }
  await fsp.mkdir(path.dirname(outputDir), { recursive: true });
  try {
    await fsp.mkdir(outputDir, { mode: 0o700 });
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST') {
      throw new CaptureUsageError(`Output directory already exists: ${outputDir}`);
    }
    throw error;
  }
  await fsp.chmod(outputDir, 0o700);
  const rawDir = path.join(outputDir, 'raw');
  await fsp.mkdir(rawDir, { mode: 0o700 });
  await fsp.chmod(rawDir, 0o700);
}

export async function writePrivateFile(target: string, bytes: string | Buffer): Promise<void> {
  await fsp.writeFile(target, bytes, { mode: 0o600, flag: 'wx' });
  await fsp.chmod(target, 0o600);
}
