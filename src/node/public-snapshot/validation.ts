import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import {
  CaptureUsageError,
  SCHEMA_VERSION,
  categoryKey,
  characterId,
  forumCategoryId,
  forumPostId,
  forumThreadId,
  isRecord,
  pageId,
  parseJsonUnknown,
  sceneId,
  sectionId,
  sha256,
} from './contracts.js';
import type {
  CaptureDataset,
  CaptureManifest,
  CaptureRecord,
} from './contracts.js';

export function findSensitiveKey(value: unknown, location = '$'): string | null {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findSensitiveKey(value[index], `${location}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (/(email|password|passwd|session|token|secret|cookie|authorization)/.test(normalized)) {
      return `${location}.${key}`;
    }
    const found = findSensitiveKey(child, `${location}.${key}`);
    if (found) return found;
  }
  return null;
}

export function isDeletedForumPost(post: unknown): boolean {
  if (!isRecord(post)) return false;
  return post.deleted === true
    || (post.deletedAt !== null && post.deletedAt !== undefined);
}

export function visibleForumPostCount(posts: readonly unknown[]): number {
  return posts.filter((post) => !isDeletedForumPost(post)).length;
}

function assertUniqueEntityList(
  label: string,
  records: readonly unknown[],
  idOf: (record: unknown) => unknown,
): Set<string> {
  const ids = new Set<string>();
  for (const record of records) {
    const id = idOf(record);
    if (typeof id !== 'string' || !id) {
      throw new CaptureUsageError(`${label} contains a record without a usable id.`);
    }
    if (ids.has(id)) throw new CaptureUsageError(`${label} contains duplicate entity id ${id}.`);
    ids.add(id);
  }
  return ids;
}

function requireArrayField(record: CaptureRecord, key: string, prefix: string): unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    throw new CaptureUsageError(`${prefix}.${key} must be an array.`);
  }
  return value;
}

function requireRecordField(record: CaptureRecord, key: string, message: string): CaptureRecord {
  const value = record[key];
  if (!isRecord(value)) throw new CaptureUsageError(message);
  return value;
}

export function validateManifest(manifest: unknown): manifest is CaptureManifest {
  if (!isRecord(manifest)) {
    throw new CaptureUsageError('manifest.json must be an object.');
  }
  if (manifest.schemaVersion !== SCHEMA_VERSION) {
    throw new CaptureUsageError(`manifest.schemaVersion must be ${SCHEMA_VERSION}.`);
  }
  if (typeof manifest.captureId !== 'string' || !manifest.captureId) {
    throw new CaptureUsageError('manifest.captureId is required.');
  }
  if (typeof manifest.origin !== 'string' || !manifest.origin) {
    throw new CaptureUsageError('manifest.origin is required.');
  }
  const timestampFields = ['startedAt', 'finishedAt'] as const;
  for (const field of timestampFields) {
    const value = manifest[field];
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
      throw new CaptureUsageError(`manifest.${field} must be an ISO timestamp.`);
    }
  }
  if (typeof manifest.datasetSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(manifest.datasetSha256)) {
    throw new CaptureUsageError('manifest.datasetSha256 must be the SHA-256 of dataset.json.');
  }
  const policy = manifest.requestPolicy;
  if (!isRecord(policy) || policy.anonymous !== true
      || typeof policy.maxRequestsPerSecond !== 'number'
      || !Number.isInteger(policy.maxRequestsPerSecond)
      || policy.maxRequestsPerSecond < 1) {
    throw new CaptureUsageError('manifest.requestPolicy must describe anonymous GET capture.');
  }
  const countKeys = [
    'characters', 'scenes', 'sceneTurns', 'wikiPages', 'wikiSections',
    'wikiCategories', 'forumThreads', 'forumPosts',
  ] as const;
  const counts = manifest.counts;
  if (!isRecord(counts)) {
    throw new CaptureUsageError('manifest.counts is required.');
  }
  for (const key of countKeys) {
    const value = counts[key];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      throw new CaptureUsageError(`manifest.counts.${key} must be a non-negative integer.`);
    }
  }
  const entityKeys = ['characters', 'scenes', 'wikiPages', 'forumThreads'] as const;
  const entities = manifest.entities;
  if (!isRecord(entities)) {
    throw new CaptureUsageError('manifest.entities is required.');
  }
  for (const key of entityKeys) {
    const listed = entities[key];
    if (!Array.isArray(listed)) {
      throw new CaptureUsageError(`manifest.entities.${key} must be an array.`);
    }
    if (listed.some((id) => typeof id !== 'string' || !id)) {
      throw new CaptureUsageError(`manifest.entities.${key} must contain string ids.`);
    }
    if (new Set(listed).size !== listed.length) {
      throw new CaptureUsageError(`manifest.entities.${key} contains duplicate ids.`);
    }
  }
  const gaps = manifest.gaps;
  if (!Array.isArray(gaps)) throw new CaptureUsageError('manifest.gaps must be an array.');
  for (const gap of gaps) {
    if (!isRecord(gap) || typeof gap.family !== 'string'
        || typeof gap.endpoint !== 'string' || typeof gap.reason !== 'string') {
      throw new CaptureUsageError('Every manifest gap must contain family, endpoint, and reason.');
    }
    if (typeof gap.status !== 'number' || !Number.isInteger(gap.status) || gap.status < 0) {
      throw new CaptureUsageError('Gap status must be a non-negative integer.');
    }
  }
  const consistency = manifest.consistency;
  if (!isRecord(consistency) || typeof consistency.complete !== 'boolean'
      || consistency.observedInterval !== true || !Array.isArray(consistency.unresolvedChanges)) {
    throw new CaptureUsageError('manifest.consistency must include complete, observedInterval, and unresolvedChanges.');
  }
  const derivedComplete = gaps.length === 0 && consistency.unresolvedChanges.length === 0;
  if (consistency.complete !== derivedComplete) {
    throw new CaptureUsageError(
      'manifest.consistency.complete must match the observed gaps and unresolved changes.',
    );
  }
  const requests = manifest.requests;
  if (!Array.isArray(requests) || requests.length === 0) {
    throw new CaptureUsageError('manifest.requests must contain at least one observed response.');
  }
  for (const request of requests) {
    if (!isRecord(request) || typeof request.family !== 'string'
        || typeof request.url !== 'string'
        || typeof request.status !== 'number' || !Number.isInteger(request.status)
        || typeof request.bytes !== 'number' || !Number.isInteger(request.bytes) || request.bytes < 0
        || typeof request.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(request.sha256)
        || (request.storedAs !== null && typeof request.storedAs !== 'string')) {
      throw new CaptureUsageError('Every manifest request must contain family, url, status, bytes, sha256, and storedAs.');
    }
  }
  return true;
}

export function validateDataset(dataset: unknown, manifest: unknown): dataset is CaptureDataset {
  if (!validateManifest(manifest)) {
    throw new CaptureUsageError('manifest.json must be a valid capture manifest.');
  }
  if (!isRecord(dataset)) {
    throw new CaptureUsageError('dataset.json must be an object.');
  }
  if (dataset.schemaVersion !== SCHEMA_VERSION) {
    throw new CaptureUsageError(`dataset.schemaVersion must be ${SCHEMA_VERSION}.`);
  }
  if (dataset.origin !== manifest.origin) throw new CaptureUsageError('dataset.origin must match manifest.origin.');
  if (typeof dataset.capturedAt !== 'string' || Number.isNaN(Date.parse(dataset.capturedAt))) {
    throw new CaptureUsageError('dataset.capturedAt must be an ISO timestamp.');
  }
  const arrayKeys = ['characters', 'scenes', 'wikiPages', 'wikiSections', 'wikiCategories'] as const;
  for (const key of arrayKeys) {
    if (!Array.isArray(dataset[key])) throw new CaptureUsageError(`dataset.${key} must be an array.`);
  }
  const forumValue = dataset.forum;
  if (!isRecord(forumValue)) {
    throw new CaptureUsageError('dataset.forum is required.');
  }
  for (const key of ['categories', 'threads'] as const) {
    if (!Array.isArray(forumValue[key])) throw new CaptureUsageError(`dataset.forum.${key} must be an array.`);
  }
  if (!isRecord(forumValue.postsByThread)) {
    throw new CaptureUsageError('dataset.forum.postsByThread must be an object.');
  }

  // Re-read the validated fields through typed helpers; the loop above proves
  // the shape at runtime while these locals keep the rest of the validator
  // working with unknown arrays rather than assumptions.
  const characters = requireArrayField(dataset, 'characters', 'dataset');
  const scenes = requireArrayField(dataset, 'scenes', 'dataset');
  const wikiPages = requireArrayField(dataset, 'wikiPages', 'dataset');
  const wikiSections = requireArrayField(dataset, 'wikiSections', 'dataset');
  const wikiCategories = requireArrayField(dataset, 'wikiCategories', 'dataset');
  const forum = requireRecordField(dataset, 'forum', 'dataset.forum is required.');
  const forumCategories = requireArrayField(forum, 'categories', 'dataset.forum');
  const forumThreads = requireArrayField(forum, 'threads', 'dataset.forum');
  const postsByThread = requireRecordField(
    forum,
    'postsByThread',
    'dataset.forum.postsByThread must be an object.',
  );

  const characterIds = assertUniqueEntityList('dataset.characters', characters, characterId);
  const sceneIds = assertUniqueEntityList('dataset.scenes', scenes, sceneId);
  const pageIds = assertUniqueEntityList('dataset.wikiPages', wikiPages, pageId);
  const threadIds = assertUniqueEntityList('dataset.forum.threads', forumThreads, forumThreadId);
  assertUniqueEntityList('dataset.wikiSections', wikiSections, sectionId);
  assertUniqueEntityList('dataset.wikiCategories', wikiCategories, categoryKey);
  assertUniqueEntityList('dataset.forum.categories', forumCategories, forumCategoryId);

  const sceneTurns = scenes.reduce((total: number, scene) => {
    const turns = isRecord(scene) ? scene.turns : undefined;
    return total + (Array.isArray(turns) ? turns.length : 0);
  }, 0);
  let forumPosts = 0;
  for (const posts of Object.values(postsByThread)) {
    forumPosts += Array.isArray(posts) ? posts.length : 0;
  }

  const counts: Array<[keyof CaptureManifest['counts'], number]> = [
    ['characters', characters.length],
    ['scenes', scenes.length],
    ['sceneTurns', sceneTurns],
    ['wikiPages', wikiPages.length],
    ['wikiSections', wikiSections.length],
    ['wikiCategories', wikiCategories.length],
    ['forumThreads', forumThreads.length],
    ['forumPosts', forumPosts],
  ];
  for (const [key, value] of counts) {
    if (manifest.counts[key] !== value) {
      throw new CaptureUsageError(`manifest.counts.${key} does not match dataset.json.`);
    }
  }

  const entityChecks: Array<[
    keyof CaptureManifest['entities'],
    Set<string>,
  ]> = [
    ['characters', characterIds],
    ['scenes', sceneIds],
    ['wikiPages', pageIds],
    ['forumThreads', threadIds],
  ];
  for (const [key, ids] of entityChecks) {
    const listed = manifest.entities[key];
    if (listed.length !== ids.size) {
      throw new CaptureUsageError(`manifest.entities.${key} does not match dataset.json.`);
    }
    for (const id of listed) {
      if (!ids.has(id)) throw new CaptureUsageError(`manifest.entities.${key} lists an entity missing from dataset.json.`);
    }
  }

  const postEntries = Object.entries(postsByThread);
  if (postEntries.length !== threadIds.size) {
    throw new CaptureUsageError('dataset.forum.postsByThread must have exactly one entry per captured thread.');
  }
  for (const [key, posts] of postEntries) {
    if (!threadIds.has(key)) throw new CaptureUsageError(`postsByThread contains an uncaptured thread ${key}.`);
    if (!Array.isArray(posts)) throw new CaptureUsageError(`postsByThread.${key} must be an array.`);
    const thread = forumThreads.find((record) => forumThreadId(record) === key);
    if (!thread) throw new CaptureUsageError(`postsByThread.${key} has no matching captured thread.`);
    const postsCount = isRecord(thread) ? thread.postsCount : undefined;
    if (typeof postsCount !== 'number' || !Number.isInteger(postsCount) || postsCount < 0) {
      throw new CaptureUsageError(
        `Captured thread ${key} must include a non-negative integer postsCount.`,
      );
    }
    const ids = new Set<string>();
    for (const post of posts) {
      const id = forumPostId(post);
      if (typeof id !== 'string' || !id || ids.has(id)) {
        throw new CaptureUsageError(`postsByThread.${key} contains missing or duplicate post ids.`);
      }
      const threadId = isRecord(post) ? post.threadId : undefined;
      if (typeof threadId !== 'string' || threadId.toLowerCase() !== key.toLowerCase()) {
        throw new CaptureUsageError(`postsByThread.${key} contains a post from a different thread.`);
      }
      ids.add(id);
    }
    const visiblePosts = visibleForumPostCount(posts);
    if (visiblePosts !== postsCount) {
      throw new CaptureUsageError(
        `Captured thread ${key} has postsCount ${postsCount} but ${visiblePosts} visible captured posts.`,
      );
    }
  }
  return true;
}

function parseJsonText(text: string): unknown {
  return parseJsonUnknown(text);
}

export async function validateCaptureDirectory(
  directory: string,
): Promise<{ manifest: CaptureManifest; dataset: CaptureDataset }> {
  const base = path.resolve(directory);
  const manifestValue: unknown = parseJsonText(await fsp.readFile(path.join(base, 'manifest.json'), 'utf8'));
  const datasetBytes = await fsp.readFile(path.join(base, 'dataset.json'));
  const datasetValue: unknown = parseJsonText(datasetBytes.toString('utf8'));
  if (!validateManifest(manifestValue)) {
    throw new CaptureUsageError('manifest.json must be a valid capture manifest.');
  }
  if (!validateDataset(datasetValue, manifestValue)) {
    throw new CaptureUsageError('dataset.json must be a valid capture dataset.');
  }
  if (sha256(datasetBytes) !== manifestValue.datasetSha256) {
    throw new CaptureUsageError('dataset.json does not match manifest.datasetSha256.');
  }
  for (const request of manifestValue.requests) {
    if (!request.storedAs) continue;
    const target = path.resolve(base, request.storedAs);
    if (!target.startsWith(`${base}${path.sep}`)) {
      throw new CaptureUsageError('A stored response path escaped the capture directory.');
    }
    const bytes = await fsp.readFile(target);
    if (bytes.length !== request.bytes || sha256(bytes) !== request.sha256) {
      throw new CaptureUsageError(`Stored response ${request.storedAs} does not match its manifest hash.`);
    }
  }
  return { manifest: manifestValue, dataset: datasetValue };
}
