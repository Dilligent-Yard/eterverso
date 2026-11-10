import * as fs from 'node:fs';
import type { Stats } from 'node:fs';
import * as path from 'node:path';

import { validateDataset as validateCapturedDataset } from '../../public-snapshot/index.js';

import type {
  CaptureCounts,
  CaptureDataset,
  CaptureManifest,
  CaptureResult,
} from './contracts.js';
import { CAPTURE_SCHEMA } from './contracts.js';
import {
  CAPTURE_ID_RE,
  assertExactKeys,
  assertNoSensitiveKeys,
  assertPlainObject,
  booleanValue,
  field,
  hash,
  integer,
  isPlainObject,
  publicError,
  sha256,
  text,
  timestamp,
  uuid,
} from './primitives.js';

export const MANIFEST_FILE = 'manifest.json';
export const DATASET_FILE = 'dataset.json';
export const MAX_MANIFEST_BYTES = 10 * 1024 * 1024;
export const MAX_DATASET_BYTES = 250 * 1024 * 1024;
export const MAX_RAW_FILE_BYTES = 64 * 1024 * 1024;
export const MAX_CHARACTERS = 10_000;
export const MAX_SCENES = 10_000;
export const MAX_WIKI_PAGES = 10_000;
export const MAX_FORUM_THREADS = 20_000;
export const MAX_FORUM_POSTS = 200_000;
export const MAX_TURNS = 500_000;

const MANIFEST_KEYS = [
  'schemaVersion', 'captureId', 'origin', 'startedAt', 'finishedAt', 'datasetSha256',
  'requestPolicy', 'counts', 'entities', 'gaps', 'consistency', 'requests',
];
const COUNT_KEYS = [
  'characters', 'scenes', 'sceneTurns', 'wikiPages', 'wikiSections', 'wikiCategories',
  'forumThreads', 'forumPosts',
] as const;
const ENTITY_KEYS = ['characters', 'scenes', 'wikiPages', 'forumThreads'] as const;
const GAP_KEYS = ['family', 'endpoint', 'status', 'reason'];
const REQUEST_KEYS = ['family', 'url', 'status', 'bytes', 'sha256', 'storedAs'];
const DATASET_KEYS = [
  'schemaVersion', 'origin', 'capturedAt', 'characters', 'scenes', 'wikiPages',
  'wikiSections', 'wikiCategories', 'forum',
];
const FORUM_KEYS = ['categories', 'threads', 'postsByThread'];

type EntityKey = typeof ENTITY_KEYS[number];

export interface PrivateFsConstants {
  O_NOFOLLOW?: number;
  O_RDONLY?: number;
}

/**
 * Minimal filesystem contract for the private capture reader. The default is
 * the real `node:fs`; tests and the CLI may inject another compatible object.
 */
export interface PrivateFs {
  constants?: PrivateFsConstants;
  lstatSync(filePath: string): Stats;
  openSync(filePath: string, flags: number): number;
  fstatSync(descriptor: number): Stats;
  readFileSync(descriptor: number): Buffer;
  closeSync(descriptor: number): void;
}

export interface ReadCaptureOptions {
  captureDirectory?: unknown;
  fsImpl?: PrivateFs;
}

interface ManifestIdentity {
  origin: string;
  startedAt: string;
  finishedAt: string;
}

function assertPrivateDirectory(directory: string, fsImpl: PrivateFs, label: string): void {
  let stat: Stats;
  try {
    stat = fsImpl.lstatSync(directory);
  } catch {
    throw publicError(`The ${label} is missing.`);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw publicError(`The ${label} must be a real directory.`);
  }
  if ((stat.mode & 0o077) !== 0) {
    throw publicError(`The ${label} must be private (mode 700).`);
  }
}

function readPrivateFile(
  filePath: string,
  fsImpl: PrivateFs,
  label: string,
  maxBytes: number,
): Buffer {
  assertPrivateDirectory(path.dirname(filePath), fsImpl, `${label} parent directory`);
  let pathStat: Stats;
  try {
    pathStat = fsImpl.lstatSync(filePath);
  } catch {
    throw publicError(`The ${label} is missing.`);
  }
  if (pathStat.isSymbolicLink() || !pathStat.isFile() || (pathStat.mode & 0o777) !== 0o600
      || pathStat.size < 1 || pathStat.size > maxBytes) {
    throw publicError(`The ${label} must be a non-empty private file (mode 600) within its size limit.`);
  }
  const constants = fsImpl.constants || fs.constants;
  const noFollow = constants.O_NOFOLLOW;
  if (typeof noFollow !== 'number' || !Number.isInteger(noFollow)) {
    throw publicError('This runtime cannot safely read a private capture.');
  }
  let descriptor: number;
  try {
    descriptor = fsImpl.openSync(filePath, (constants.O_RDONLY ?? 0) | noFollow);
  } catch {
    throw publicError(`The ${label} could not be opened safely.`);
  }
  try {
    const openedStat = fsImpl.fstatSync(descriptor);
    if (!openedStat.isFile() || (openedStat.mode & 0o777) !== 0o600
        || openedStat.size !== pathStat.size || openedStat.size > maxBytes
        || (pathStat.dev !== undefined && openedStat.dev !== pathStat.dev)
        || (pathStat.ino !== undefined && openedStat.ino !== pathStat.ino)) {
      throw publicError(`The ${label} changed while it was being read.`);
    }
    const bytes = fsImpl.readFileSync(descriptor);
    if (bytes.length !== openedStat.size) {
      throw publicError(`The ${label} changed while it was being read.`);
    }
    return bytes;
  } finally {
    try { fsImpl.closeSync(descriptor); } catch { /* Preserve the read result. */ }
  }
}

function readJsonFile(
  filePath: string,
  fsImpl: PrivateFs,
  label: string,
  maxBytes: number,
): { value: unknown; bytes: Buffer } {
  const bytes = readPrivateFile(filePath, fsImpl, label, maxBytes);
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes));
  } catch {
    throw publicError(`The ${label} is not valid UTF-8 JSON.`);
  }
  return { value, bytes };
}

function assertSafeRelativePath(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value || value.length > 1000
      || value.startsWith('/') || value.includes('\\') || value.includes('\0')
      || value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
      || !/^raw\/[A-Za-z0-9._/-]+$/u.test(value)) {
    throw publicError(`The capture ${label} path is invalid.`);
  }
  return value;
}

function validateManifest(manifest: unknown): ManifestIdentity {
  const record = assertPlainObject(manifest, 'manifest');
  assertExactKeys(record, MANIFEST_KEYS, 'manifest');
  if (record.schemaVersion !== CAPTURE_SCHEMA) {
    throw publicError('The capture manifest schema version is unsupported.');
  }
  if (typeof record.captureId !== 'string' || !CAPTURE_ID_RE.test(record.captureId)) {
    throw publicError('The capture identifier is invalid.');
  }
  let origin: URL;
  try {
    origin = new URL(String(record.origin));
  } catch {
    throw publicError('The capture origin is invalid.');
  }
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/'
      || origin.search || origin.hash) {
    throw publicError('The capture origin must be a plain HTTPS origin.');
  }
  const startedAt = timestamp(record.startedAt, 'manifest.startedAt');
  const finishedAt = timestamp(record.finishedAt, 'manifest.finishedAt');
  if (new Date(finishedAt).getTime() < new Date(startedAt).getTime()) {
    throw publicError('The capture interval is reversed.');
  }
  hash(record.datasetSha256, 'manifest.datasetSha256');
  const requestPolicy = assertPlainObject(record.requestPolicy, 'request policy');
  assertExactKeys(requestPolicy, ['anonymous', 'maxRequestsPerSecond'], 'request policy');
  if (requestPolicy.anonymous !== true || requestPolicy.maxRequestsPerSecond !== 1) {
    throw publicError('The capture did not use the required anonymous serial request policy.');
  }
  const counts = assertPlainObject(record.counts, 'counts');
  assertExactKeys(counts, COUNT_KEYS, 'counts');
  for (const key of COUNT_KEYS) integer(counts[key], `counts.${key}`);
  const entities = assertPlainObject(record.entities, 'entities');
  assertExactKeys(entities, ENTITY_KEYS, 'entities');
  for (const key of ENTITY_KEYS) {
    const list = entities[key];
    if (!Array.isArray(list)) throw publicError(`The capture entity list ${key} is invalid.`);
    const seen = new Set<string>();
    for (const value of list) {
      const id = uuid(value, `entities.${key}`);
      if (seen.has(id)) throw publicError(`The capture entity list ${key} contains duplicates.`);
      seen.add(id);
    }
  }
  if (!Array.isArray(record.gaps)) throw publicError('The capture gaps list is invalid.');
  for (const gap of record.gaps) {
    const gapRecord = assertPlainObject(gap, 'gap');
    assertExactKeys(gapRecord, GAP_KEYS, 'gap');
    text(gapRecord.family, 'gap family', { min: 1, max: 80 });
    text(gapRecord.endpoint, 'gap endpoint', { min: 1, max: 500 });
    integer(gapRecord.status, 'gap status', { min: 0, max: 599 });
    text(gapRecord.reason, 'gap reason', { min: 1, max: 500 });
  }
  const consistency = assertPlainObject(record.consistency, 'consistency');
  assertExactKeys(consistency, ['complete', 'observedInterval', 'unresolvedChanges'], 'consistency');
  booleanValue(consistency.complete, 'consistency.complete');
  booleanValue(consistency.observedInterval, 'consistency.observedInterval');
  if (consistency.observedInterval !== true) {
    throw publicError('The capture does not record an observed interval.');
  }
  if (!Array.isArray(consistency.unresolvedChanges)) {
    throw publicError('The capture unresolvedChanges list is invalid.');
  }
  const gaps = record.gaps;
  const derivedComplete = gaps.length === 0 && consistency.unresolvedChanges.length === 0;
  if (consistency.complete !== derivedComplete) {
    throw publicError('The capture completeness claim does not match its gaps and unresolved changes.');
  }
  if (!Array.isArray(record.requests) || record.requests.length === 0) {
    throw publicError('The capture must contain at least one observed response.');
  }
  for (const request of record.requests) {
    const requestRecord = assertPlainObject(request, 'request');
    assertExactKeys(requestRecord, REQUEST_KEYS, 'request');
    text(requestRecord.family, 'request family', { min: 1, max: 80 });
    let requestUrl: URL;
    try {
      requestUrl = new URL(String(requestRecord.url));
    } catch {
      throw publicError('A capture request URL is invalid.');
    }
    if (requestUrl.origin !== origin.origin) {
      throw publicError('A capture request points outside the recorded origin.');
    }
    integer(requestRecord.status, 'request status', { min: 100, max: 599 });
    integer(requestRecord.bytes, 'request byte length', { min: 0, max: MAX_RAW_FILE_BYTES });
    hash(requestRecord.sha256, 'request hash');
    if (requestRecord.storedAs !== null) {
      assertSafeRelativePath(requestRecord.storedAs, 'request storage');
    }
  }
  return { origin: origin.origin, startedAt, finishedAt };
}

function assertCaptureContract(dataset: unknown, manifest: unknown): void {
  try {
    validateCapturedDataset(dataset, manifest);
  } catch (error) {
    const message = isPlainObject(error) ? error.message : undefined;
    if (typeof message === 'string' && message) {
      throw publicError(`The capture violates the capture contract: ${message}`);
    }
    throw error;
  }
}

export function readCapture({
  captureDirectory,
  fsImpl = fs,
}: ReadCaptureOptions = {}): CaptureResult {
  if (typeof captureDirectory !== 'string' || !captureDirectory) {
    throw publicError('A private capture directory is required.');
  }
  const directory = path.resolve(captureDirectory);
  assertPrivateDirectory(directory, fsImpl, 'capture directory');
  const manifestResult = readJsonFile(
    path.join(directory, MANIFEST_FILE),
    fsImpl,
    'capture manifest',
    MAX_MANIFEST_BYTES,
  );
  const manifestIdentity = validateManifest(manifestResult.value);
  // `validateManifest` has checked every field and exact key; keep the original
  // object so `validateDataset` sees the capture's own manifest values.
  const manifest = manifestResult.value as CaptureManifest;

  const datasetResult = readJsonFile(
    path.join(directory, DATASET_FILE),
    fsImpl,
    'capture dataset',
    MAX_DATASET_BYTES,
  );
  const datasetRaw = datasetResult.value;
  assertNoSensitiveKeys(datasetRaw);
  const datasetRecord = assertPlainObject(datasetRaw, 'dataset');
  assertExactKeys(datasetRecord, DATASET_KEYS, 'dataset');
  if (datasetRecord.schemaVersion !== CAPTURE_SCHEMA) {
    throw publicError('The capture dataset schema version is unsupported.');
  }
  if (datasetRecord.origin !== manifest.origin) {
    throw publicError('The capture dataset origin does not match its manifest.');
  }
  const capturedAt = timestamp(datasetRecord.capturedAt, 'dataset.capturedAt');
  const forum = assertPlainObject(datasetRecord.forum, 'forum');
  assertExactKeys(forum, FORUM_KEYS, 'forum');
  for (const key of ['characters', 'scenes', 'wikiPages', 'wikiSections', 'wikiCategories']) {
    if (!Array.isArray(datasetRecord[key])) {
      throw publicError(`The capture dataset list ${key} is invalid.`);
    }
  }
  for (const key of ['categories', 'threads']) {
    if (!Array.isArray(forum[key])) {
      throw publicError(`The capture forum list ${key} is invalid.`);
    }
  }
  assertPlainObject(forum.postsByThread, 'forum postsByThread');
  const datasetSha256 = sha256(datasetResult.bytes);
  if (datasetSha256 !== manifest.datasetSha256) {
    throw publicError('dataset.json does not match manifest.datasetSha256.');
  }
  assertCaptureContract(datasetRaw, manifestResult.value);
  // The dataset contract above has checked the top-level arrays and forum
  // object; individual records remain `unknown` until the plan maps them.
  const dataset = datasetRecord as CaptureDataset;

  const requestFiles: Array<string | null> = manifest.requests.map((request) => {
    if (request.storedAs === null) {
      const emptyDigest = sha256(Buffer.alloc(0));
      if (request.bytes !== 0 || request.sha256 !== emptyDigest) {
        throw publicError(`A captured empty response is inconsistent in the manifest (${request.family}).`);
      }
      return null;
    }
    const filePath = path.join(directory, ...request.storedAs.split('/'));
    const bytes = readPrivateFile(filePath, fsImpl, `capture response ${request.family}`, MAX_RAW_FILE_BYTES);
    if (bytes.length !== request.bytes || sha256(bytes) !== request.sha256) {
      throw publicError(`A captured response hash or byte length does not match the manifest (${request.family}).`);
    }
    return request.storedAs;
  });

  const sceneTurnCount = dataset.scenes.reduce<number>((total, scene) => {
    if (!isPlainObject(scene) || !Array.isArray(scene.turns)) {
      throw publicError('A captured scene has an invalid turns collection.');
    }
    return total + scene.turns.length;
  }, 0);
  const forumPostCount = Object.values(dataset.forum.postsByThread).reduce<number>((total, posts) => {
    if (!Array.isArray(posts)) throw publicError('A captured forum post collection is invalid.');
    return total + posts.length;
  }, 0);

  const actualCounts: CaptureCounts = {
    characters: dataset.characters.length,
    scenes: dataset.scenes.length,
    sceneTurns: sceneTurnCount,
    wikiPages: dataset.wikiPages.length,
    wikiSections: dataset.wikiSections.length,
    wikiCategories: dataset.wikiCategories.length,
    forumThreads: dataset.forum.threads.length,
    forumPosts: forumPostCount,
  };
  for (const key of COUNT_KEYS) {
    if (actualCounts[key] !== manifest.counts[key]) {
      throw publicError(`The capture ${key} count does not match the dataset.`);
    }
  }
  if (actualCounts.characters > MAX_CHARACTERS || actualCounts.scenes > MAX_SCENES
      || actualCounts.wikiPages > MAX_WIKI_PAGES || actualCounts.forumThreads > MAX_FORUM_THREADS
      || actualCounts.forumPosts > MAX_FORUM_POSTS || actualCounts.sceneTurns > MAX_TURNS) {
    throw publicError('The capture exceeds the sandbox import limits.');
  }

  const datasetIds: Record<EntityKey, string[]> = {
    characters: dataset.characters.map((record, index) => uuid(field(record, 'id'), `characters[${index}].id`)),
    scenes: dataset.scenes.map((record, index) => uuid(field(record, 'id'), `scenes[${index}].id`)),
    wikiPages: dataset.wikiPages.map((record, index) => uuid(field(record, 'id'), `wikiPages[${index}].id`)),
    forumThreads: dataset.forum.threads.map((record, index) => uuid(field(record, 'id'), `forum.threads[${index}].id`)),
  };
  for (const key of ENTITY_KEYS) {
    const expected = [...manifest.entities[key]].sort();
    const actual = [...datasetIds[key]].sort();
    if (new Set(actual).size !== actual.length || JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw publicError(`The capture ${key} entity inventory does not match the dataset exactly.`);
    }
  }

  return {
    directory,
    manifest,
    dataset,
    origin: manifestIdentity.origin,
    capturedAt,
    startedAt: manifestIdentity.startedAt,
    finishedAt: manifestIdentity.finishedAt,
    datasetSha256,
    requestFiles,
    actualCounts,
  };
}
