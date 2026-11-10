import {
  CaptureFatalError,
  MAX_PAGES,
  PAGE_SIZE,
  ShapeError,
  UUID_RE,
  categoryKey,
  characterId,
  fingerprint,
  forumCategoryId,
  forumPostId,
  isRecord,
  pageId,
  sceneId,
  sectionId,
} from './contracts.js';
import type { CaptureRecord } from './contracts.js';
import type { CaptureSession } from './session.js';

export function requireArray(body: unknown, key: string, family: string): unknown[] {
  if (!isRecord(body)) {
    throw new ShapeError('INVALID_RESPONSE_SHAPE', `${family} response did not contain an array named ${key}.`);
  }
  const value = body[key];
  if (!Array.isArray(value)) {
    throw new ShapeError('INVALID_RESPONSE_SHAPE', `${family} response did not contain an array named ${key}.`);
  }
  return value;
}

export function rejectUnhandledPagination(
  session: CaptureSession,
  family: string,
  endpoint: string,
  body: unknown,
): void {
  if (isRecord(body) && isRecord(body.page) && body.page.hasMore === true) {
    session.recordGap(family, endpoint, new ShapeError(
      'UNEXPECTED_PAGINATION',
      'A single-page endpoint reported page.hasMore; refusing to treat it as complete.',
    ));
  }
}

export interface UniqueRecordsOptions {
  requireUuid?: boolean;
}

export function uniqueRecords(
  session: CaptureSession,
  family: string,
  records: readonly unknown[],
  idOf: (record: unknown) => unknown,
  endpoint: string,
  options: UniqueRecordsOptions = {},
): CaptureRecord[] {
  const unique: CaptureRecord[] = [];
  const seen = new Map<string, unknown>();
  for (const record of records) {
    const id = idOf(record);
    if (typeof id !== 'string' || !id || (options.requireUuid && !UUID_RE.test(id))) {
      session.recordGap(family, endpoint, new ShapeError('INVALID_ENTITY_ID', `${family} contained an invalid entity id.`));
      continue;
    }
    if (seen.has(id)) {
      const same = JSON.stringify(seen.get(id)) === JSON.stringify(record);
      session.recordGap(
        family,
        endpoint,
        new ShapeError(same ? 'DUPLICATE_ID' : 'CONFLICTING_ID', `${family} contained a duplicate entity id.`),
      );
      continue;
    }
    if (!isRecord(record)) {
      session.recordGap(family, endpoint, new ShapeError('INVALID_ENTITY_ID', `${family} contained an invalid entity id.`));
      continue;
    }
    seen.set(id, record);
    unique.push(record);
  }
  return unique;
}

export interface PaginatedOptions {
  idOf: (record: unknown) => unknown;
  requireUuid?: boolean;
}

export interface PaginatedResult {
  items: CaptureRecord[];
  complete: boolean;
}

export async function fetchPaginated(
  session: CaptureSession,
  family: string,
  endpoint: string,
  options: PaginatedOptions,
): Promise<PaginatedResult> {
  const idOf = options.idOf;
  const requireUuid = options.requireUuid === true;
  const items: CaptureRecord[] = [];
  const seen = new Map<string, unknown>();
  const signatures = new Set<string>();
  let offset = 0;

  for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex += 1) {
    const requestPath = `${endpoint}?limit=${PAGE_SIZE}&offset=${offset}`;
    let body: unknown;
    try {
      body = await session.getJson(family, requestPath);
    } catch (error) {
      if (error instanceof CaptureFatalError) throw error;
      session.recordGap(family, requestPath, error);
      return { items, complete: false };
    }

    const data = isRecord(body) ? body.data : undefined;
    const page = isRecord(body) ? body.page : undefined;
    if (!Array.isArray(data) || !isRecord(page) || typeof page.hasMore !== 'boolean') {
      session.recordGap(family, requestPath, new ShapeError(
        'INVALID_PAGE_SHAPE',
        `${family} did not return data[] plus page.hasMore.`,
      ));
      return { items, complete: false };
    }

    const signature = fingerprint(data.map((item) => idOf(item) ?? null));
    if (signatures.has(signature)) {
      session.recordGap(family, requestPath, new ShapeError(
        'REPEATED_PAGE',
        `${family} returned the same page more than once.`,
      ));
      return { items, complete: false };
    }
    signatures.add(signature);

    if (data.length === 0) {
      if (page.hasMore) {
        session.recordGap(family, requestPath, new ShapeError(
          'EMPTY_PAGE_WITH_HAS_MORE',
          `${family} returned an empty page while reporting hasMore.`,
        ));
        return { items, complete: false };
      }
      return { items, complete: true };
    }

    for (const item of data) {
      const id = idOf(item);
      if (typeof id !== 'string' || !id || (requireUuid && !UUID_RE.test(id))) {
        session.recordGap(family, requestPath, new ShapeError(
          'INVALID_ENTITY_ID',
          `${family} contained an invalid entity id.`,
        ));
        continue;
      }
      if (seen.has(id)) {
        const same = JSON.stringify(seen.get(id)) === JSON.stringify(item);
        session.recordGap(family, requestPath, new ShapeError(
          same ? 'DUPLICATE_ID' : 'CONFLICTING_ID',
          `${family} contained a duplicate entity id.`,
        ));
        continue;
      }
      if (!isRecord(item)) {
        session.recordGap(family, requestPath, new ShapeError(
          'INVALID_ENTITY_ID',
          `${family} contained an invalid entity id.`,
        ));
        continue;
      }
      seen.set(id, item);
      items.push(item);
    }

    if (!page.hasMore) return { items, complete: true };
    offset += data.length;
  }

  session.recordGap(family, endpoint, new ShapeError('PAGE_LIMIT_EXCEEDED', `${family} exceeded the page traversal limit.`));
  return { items, complete: false };
}

export async function captureCharacters(session: CaptureSession): Promise<void> {
  const endpoint = '/api/personagens';
  try {
    const body = await session.getJson('characters', endpoint);
    const records = requireArray(body, 'personagens', 'characters');
    rejectUnhandledPagination(session, 'characters', endpoint, body);
    session.dataset.characters = uniqueRecords(session, 'characters', records, characterId, endpoint, { requireUuid: true });
  } catch (error) {
    if (error instanceof CaptureFatalError) throw error;
    session.recordGap('characters', endpoint, error);
  }
}

export async function normalizeSceneRecords(
  session: CaptureSession,
  records: readonly unknown[],
): Promise<CaptureRecord[]> {
  const unique = uniqueRecords(session, 'scenes', records, sceneId, '/api/wiki-posts', { requireUuid: true });
  const normalized: CaptureRecord[] = [];
  for (const record of unique) {
    let scene = record;
    if (!Array.isArray(scene.turns)) {
      const endpoint = `/api/wiki-posts/${String(scene.id)}`;
      try {
        const body = await session.getJson('sceneDetail', endpoint);
        const candidate = isRecord(body) ? body.wikiPost : undefined;
        if (!isRecord(candidate) || candidate.id !== scene.id) {
          throw new ShapeError('INVALID_SCENE_DETAIL', 'Scene detail did not match the listed scene.');
        }
        scene = candidate;
      } catch (error) {
        if (error instanceof CaptureFatalError) throw error;
        session.recordGap('scenes', endpoint, error);
      }
    }
    if (!Array.isArray(scene.turns)) {
      session.recordGap('scenes', '/api/wiki-posts', new ShapeError(
        'SCENE_TURNS_MISSING',
        'Scene record did not contain a turns array.',
      ));
    }
    if (Array.isArray(scene.turns)) {
      const seenTurns = new Map<string, unknown>();
      for (const turn of scene.turns) {
        const id = isRecord(turn) ? turn.id : undefined;
        if (typeof id !== 'string' || !id) {
          session.recordGap('scenes', '/api/wiki-posts', new ShapeError(
            'INVALID_TURN_ID',
            'Scene turn did not contain a usable id.',
          ));
          continue;
        }
        if (seenTurns.has(id)) {
          const same = JSON.stringify(seenTurns.get(id)) === JSON.stringify(turn);
          session.recordGap('scenes', '/api/wiki-posts', new ShapeError(
            same ? 'DUPLICATE_TURN_ID' : 'CONFLICTING_TURN_ID',
            'Scene contained a duplicate turn id.',
          ));
          continue;
        }
        seenTurns.set(id, turn);
      }
    }
    normalized.push(scene);
  }
  return normalized;
}

export async function captureScenes(session: CaptureSession): Promise<void> {
  const endpoint = '/api/wiki-posts';
  try {
    const body = await session.getJson('scenes', endpoint);
    const records = requireArray(body, 'wikiPosts', 'scenes');
    rejectUnhandledPagination(session, 'scenes', endpoint, body);
    session.dataset.scenes = await normalizeSceneRecords(session, records);
  } catch (error) {
    if (error instanceof CaptureFatalError) throw error;
    session.recordGap('scenes', endpoint, error);
  }
}

export async function captureWikiSections(session: CaptureSession): Promise<void> {
  const endpoint = '/api/wiki/sections';
  try {
    const body = await session.getJson('wikiSections', endpoint);
    const records = requireArray(body, 'data', 'wikiSections');
    rejectUnhandledPagination(session, 'wikiSections', endpoint, body);
    session.dataset.wikiSections = uniqueRecords(session, 'wikiSections', records, sectionId, endpoint);
  } catch (error) {
    if (error instanceof CaptureFatalError) throw error;
    session.recordGap('wikiSections', endpoint, error);
  }
}

export async function captureWikiCategories(session: CaptureSession): Promise<PaginatedResult> {
  const endpoint = '/api/wiki/categories';
  const result = await fetchPaginated(session, 'wikiCategories', endpoint, {
    idOf: categoryKey,
    requireUuid: false,
  });
  session.dataset.wikiCategories = result.items;
  return result;
}

export async function captureWikiPageList(session: CaptureSession): Promise<PaginatedResult> {
  return fetchPaginated(session, 'wikiPages', '/api/wiki/pages', {
    idOf: pageId,
    requireUuid: true,
  });
}

export async function captureWikiPageDetails(
  session: CaptureSession,
  listing: readonly CaptureRecord[],
): Promise<void> {
  const records: CaptureRecord[] = [];
  const seen = new Set<string>();
  for (const meta of listing) {
    const id = String(meta.id);
    if (seen.has(id)) continue;
    seen.add(id);
    const endpoint = `/api/wiki/pages/${id}`;
    try {
      const body = await session.getJson('wikiPageDetail', endpoint);
      const candidate = isRecord(body) ? body.data : undefined;
      if (!isRecord(candidate) || candidate.id !== meta.id) {
        throw new ShapeError('INVALID_PAGE_DETAIL', 'Wiki page detail did not match the listing record.');
      }
      records.push(candidate);
    } catch (error) {
      if (error instanceof CaptureFatalError) throw error;
      session.recordGap('wikiPages', endpoint, error);
    }
  }
  session.dataset.wikiPages = records;
}

export function filterThreadPosts(
  session: CaptureSession,
  threadId: string,
  postsPath: string,
  posts: readonly CaptureRecord[],
): CaptureRecord[] {
  const threadKey = threadId.toLowerCase();
  return posts.filter((post) => {
    const postThreadId = isRecord(post) ? post.threadId : undefined;
    if (typeof postThreadId === 'string' && postThreadId.toLowerCase() === threadKey) {
      return true;
    }
    session.recordGap('forumPosts', postsPath, new ShapeError(
      'WRONG_THREAD_POST',
      'A forum post did not belong to the requested thread.',
    ));
    return false;
  });
}

export interface ForumThreadCapture {
  thread: CaptureRecord;
  posts: CaptureRecord[];
}

export async function captureForumThread(
  session: CaptureSession,
  threadId: string,
): Promise<ForumThreadCapture | null> {
  const detailPath = `/api/forum/threads/${threadId}`;
  let thread: CaptureRecord;
  try {
    const body = await session.getJson('forumThreadDetail', detailPath);
    const candidate = isRecord(body) ? body.data : undefined;
    if (!isRecord(candidate) || String(candidate.id).toLowerCase() !== threadId.toLowerCase()) {
      throw new ShapeError('INVALID_THREAD_DETAIL', 'Forum thread detail did not match the requested thread.');
    }
    thread = candidate;
  } catch (error) {
    if (error instanceof CaptureFatalError) throw error;
    session.recordGap('forumThreads', detailPath, error);
    return null;
  }

  const postsPath = `/api/forum/threads/${threadId}/posts`;
  const posts = await fetchPaginated(session, 'forumPosts', postsPath, {
    idOf: forumPostId,
    requireUuid: true,
  });
  const threadPosts = filterThreadPosts(session, threadId, postsPath, posts.items);
  session.dataset.forum.threads.push(thread);
  session.dataset.forum.postsByThread[String(thread.id)] = threadPosts;
  return { thread, posts: threadPosts };
}

export async function captureForumCategories(
  session: CaptureSession,
  threads: readonly CaptureRecord[],
): Promise<void> {
  if (!threads.length) return;
  const wanted = new Set(threads.map((thread) => String(thread.categoryId).toLowerCase()));
  const endpoint = '/api/forum/categories';
  const result = await fetchPaginated(session, 'forumCategories', endpoint, {
    idOf: forumCategoryId,
    requireUuid: true,
  });
  const selected = result.items.filter((category) => wanted.has(String(category.id).toLowerCase()));
  session.dataset.forum.categories = selected;
  const found = new Set(selected.map((category) => String(category.id).toLowerCase()));
  for (const categoryId of wanted) {
    if (!found.has(categoryId)) {
      session.recordGap('forumCategories', endpoint, new ShapeError(
        'REFERENCED_CATEGORY_NOT_FOUND',
        'A category referenced by a captured thread was not present in the public category list.',
      ));
    }
  }
}

export async function captureReferencedForum(session: CaptureSession): Promise<void> {
  const refs: string[] = [];
  const seen = new Set<string>();
  for (const page of session.dataset.wikiPages) {
    const reference = isRecord(page) ? page.discussionThreadId : undefined;
    if (reference === null || reference === undefined || reference === '') continue;
    if (typeof reference !== 'string' || !UUID_RE.test(reference)) {
      session.recordGap('forumThreads', '/api/wiki/pages', new ShapeError(
        'INVALID_DISCUSSION_REFERENCE',
        'A wiki page contained an invalid discussionThreadId.',
      ));
      continue;
    }
    if (seen.has(reference)) continue;
    seen.add(reference);
    refs.push(reference);
  }
  for (const threadId of refs) {
    await captureForumThread(session, threadId);
  }
  await captureForumCategories(session, session.dataset.forum.threads);
}

export async function captureAll(session: CaptureSession): Promise<void> {
  await captureCharacters(session);
  await captureScenes(session);
  await captureWikiSections(session);
  await captureWikiCategories(session);
  const listing = await captureWikiPageList(session);
  await captureWikiPageDetails(session, listing.items);
  await captureReferencedForum(session);
}

export function idsOf(
  records: readonly CaptureRecord[],
  idOf: (record: unknown) => unknown,
): string[] {
  const ids: string[] = [];
  for (const record of records) {
    const id = idOf(record);
    if (typeof id === 'string' && id) ids.push(id);
  }
  return ids;
}
