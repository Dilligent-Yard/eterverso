import {
  CaptureFatalError,
  ShapeError,
  UUID_RE,
  categoryKey,
  characterId,
  forumCategoryId,
  forumPostId,
  fingerprint,
  isRecord,
  sceneId,
  sectionId,
} from './contracts.js';
import type { CaptureRecord } from './contracts.js';
import type { CaptureSession } from './session.js';
import {
  captureForumThread,
  captureWikiPageList,
  fetchPaginated,
  filterThreadPosts,
  idsOf,
  normalizeSceneRecords,
  rejectUnhandledPagination,
  requireArray,
  uniqueRecords,
} from './families.js';
import { visibleForumPostCount } from './validation.js';

async function recheckSingleList(
  session: CaptureSession,
  family: string,
  endpoint: string,
  extract: (body: unknown) => unknown[],
  idOf: (record: unknown) => unknown,
  requireUuid: boolean,
): Promise<void> {
  if (session.hasGap(family)) return;
  const targetKey = 'characters';
  const current = session.dataset[targetKey];
  let previous = current;
  for (let attempt = 0; attempt < session.options.recheckAttempts; attempt += 1) {
    let next: CaptureRecord[];
    try {
      const body = await session.getJson(family, endpoint);
      rejectUnhandledPagination(session, family, endpoint, body);
      next = uniqueRecords(session, family, extract(body), idOf, endpoint, { requireUuid });
    } catch (error) {
      if (error instanceof CaptureFatalError) throw error;
      session.recordGap(family, endpoint, error);
      return;
    }
    if (fingerprint(next) === fingerprint(previous)) {
      if (fingerprint(next) !== fingerprint(current)) {
        session.dataset[targetKey] = next;
      }
      return;
    }
    previous = next;
  }
  session.recordUnresolved(family, 'Records kept changing during the final recheck.', idsOf(previous, idOf));
}

async function recheckScenes(session: CaptureSession): Promise<void> {
  if (session.hasGap('scenes')) return;
  const endpoint = '/api/wiki-posts';
  const current = session.dataset.scenes;
  let previous = current;
  for (let attempt = 0; attempt < session.options.recheckAttempts; attempt += 1) {
    let next: CaptureRecord[];
    try {
      const body = await session.getJson('scenes', endpoint);
      rejectUnhandledPagination(session, 'scenes', endpoint, body);
      next = await normalizeSceneRecords(session, requireArray(body, 'wikiPosts', 'scenes'));
    } catch (error) {
      if (error instanceof CaptureFatalError) throw error;
      session.recordGap('scenes', endpoint, error);
      return;
    }
    if (fingerprint(next) === fingerprint(previous)) {
      if (fingerprint(next) !== fingerprint(current)) session.dataset.scenes = next;
      return;
    }
    previous = next;
  }
  session.recordUnresolved('scenes', 'Scenes kept changing during the final recheck.', idsOf(previous, sceneId));
}

async function recheckWikiSections(session: CaptureSession): Promise<void> {
  if (session.hasGap('wikiSections')) return;
  const endpoint = '/api/wiki/sections';
  const current = session.dataset.wikiSections;
  let previous = current;
  for (let attempt = 0; attempt < session.options.recheckAttempts; attempt += 1) {
    let next: CaptureRecord[];
    try {
      const body = await session.getJson('wikiSections', endpoint);
      rejectUnhandledPagination(session, 'wikiSections', endpoint, body);
      next = uniqueRecords(session, 'wikiSections', requireArray(body, 'data', 'wikiSections'), sectionId, endpoint);
    } catch (error) {
      if (error instanceof CaptureFatalError) throw error;
      session.recordGap('wikiSections', endpoint, error);
      return;
    }
    if (fingerprint(next) === fingerprint(previous)) {
      if (fingerprint(next) !== fingerprint(current)) session.dataset.wikiSections = next;
      return;
    }
    previous = next;
  }
  session.recordUnresolved('wikiSections', 'Wiki sections kept changing during the final recheck.', idsOf(previous, sectionId));
}

async function recheckWikiCategories(session: CaptureSession): Promise<void> {
  if (session.hasGap('wikiCategories')) return;
  const endpoint = '/api/wiki/categories';
  const current = session.dataset.wikiCategories;
  let previous = current;
  for (let attempt = 0; attempt < session.options.recheckAttempts; attempt += 1) {
    const result = await fetchPaginated(session, 'wikiCategories', endpoint, {
      idOf: categoryKey,
      requireUuid: false,
    });
    if (!result.complete) return;
    const next = result.items;
    if (fingerprint(next) === fingerprint(previous)) {
      if (fingerprint(next) !== fingerprint(current)) session.dataset.wikiCategories = next;
      return;
    }
    previous = next;
  }
  session.recordUnresolved('wikiCategories', 'Wiki categories kept changing during the final recheck.', idsOf(previous, categoryKey));
}

async function readStablePage(
  session: CaptureSession,
  id: string,
  current: CaptureRecord,
): Promise<CaptureRecord | null> {
  const endpoint = `/api/wiki/pages/${id}`;
  let previous = current;
  for (let attempt = 0; attempt <= session.options.recheckAttempts; attempt += 1) {
    let next: CaptureRecord;
    try {
      const body = await session.getJson('wikiPageDetail', endpoint);
      const candidate = isRecord(body) ? body.data : undefined;
      if (!isRecord(candidate) || candidate.id !== id) {
        throw new ShapeError('INVALID_PAGE_DETAIL', 'Wiki page detail did not match the requested page.');
      }
      next = candidate;
    } catch (error) {
      if (error instanceof CaptureFatalError) throw error;
      session.recordGap('wikiPages', endpoint, error);
      return null;
    }
    if (fingerprint(next) === fingerprint(previous)) return next;
    previous = next;
  }
  return null;
}

async function recheckWikiPages(session: CaptureSession): Promise<void> {
  if (session.hasGap('wikiPages')) return;
  const listing = await captureWikiPageList(session);
  if (!listing.complete) return;

  const currentById = new Map<string, CaptureRecord>(
    session.dataset.wikiPages.map((page) => [String(page.id), page]),
  );
  const listingById = new Map<string, CaptureRecord>(
    listing.items.map((page) => [String(page.id), page]),
  );
  const records = new Map(currentById);
  const missing: string[] = [];

  for (const id of currentById.keys()) {
    if (!listingById.has(id)) missing.push(id);
  }
  if (missing.length) {
    session.recordUnresolved('wikiPages', 'Pages disappeared during the final recheck.', missing);
  }

  for (const id of listingById.keys()) {
    if (currentById.has(id)) continue;
    const endpoint = `/api/wiki/pages/${id}`;
    try {
      const body = await session.getJson('wikiPageDetail', endpoint);
      const candidate = isRecord(body) ? body.data : undefined;
      if (!isRecord(candidate) || candidate.id !== id) {
        throw new ShapeError('INVALID_PAGE_DETAIL', 'New wiki page detail did not match the listing record.');
      }
      records.set(id, candidate);
    } catch (error) {
      if (error instanceof CaptureFatalError) throw error;
      session.recordGap('wikiPages', endpoint, error);
    }
  }

  for (const [id, meta] of listingById.entries()) {
    const current = currentById.get(id);
    if (!current) continue;
    if (meta.publicVersion === current.publicVersion) continue;
    const stable = await readStablePage(session, id, current);
    if (stable) records.set(id, stable);
    else session.recordUnresolved('wikiPages', 'Page version changed during the final recheck.', [id]);
  }

  const ordered: CaptureRecord[] = [];
  for (const meta of listing.items) {
    const record = records.get(String(meta.id));
    if (record) ordered.push(record);
  }
  for (const id of missing) {
    const record = records.get(id);
    if (record) ordered.push(record);
  }
  session.dataset.wikiPages = ordered;
}

async function recheckForumCategories(session: CaptureSession): Promise<void> {
  if (!session.dataset.forum.threads.length) return;
  const endpoint = '/api/forum/categories';
  const wanted = new Set(session.dataset.forum.threads.map((thread) => String(thread.categoryId).toLowerCase()));
  const current = session.dataset.forum.categories;
  let previous = current;
  for (let attempt = 0; attempt < session.options.recheckAttempts; attempt += 1) {
    const result = await fetchPaginated(session, 'forumCategories', endpoint, {
      idOf: forumCategoryId,
      requireUuid: true,
    });
    if (!result.complete) return;
    const selected = result.items.filter((category) => wanted.has(String(category.id).toLowerCase()));
    if (fingerprint(selected) === fingerprint(previous)) {
      if (fingerprint(selected) !== fingerprint(current)) session.dataset.forum.categories = selected;
      return;
    }
    previous = selected;
  }
  session.recordUnresolved('forumCategories', 'Forum categories kept changing during the final recheck.', idsOf(previous, forumCategoryId));
}

async function recheckForum(session: CaptureSession): Promise<void> {
  const refs: string[] = [];
  const seen = new Set<string>();
  for (const page of session.dataset.wikiPages) {
    const reference = isRecord(page) ? page.discussionThreadId : undefined;
    if (typeof reference === 'string' && UUID_RE.test(reference)
        && !seen.has(reference)) {
      seen.add(reference);
      refs.push(reference);
    }
  }

  const captured = new Set(session.dataset.forum.threads.map((thread) => String(thread.id)));
  for (const threadId of refs) {
    if (!captured.has(threadId)) {
      const added = await captureForumThread(session, threadId);
      if (added) captured.add(String(added.thread.id));
    }
  }

  if (!session.dataset.forum.threads.length) return;

  for (const thread of session.dataset.forum.threads) {
    const threadKey = String(thread.id);
    const endpoint = `/api/forum/threads/${threadKey}`;
    let nextThread: CaptureRecord;
    try {
      const body = await session.getJson('forumThreadDetail', endpoint);
      const candidate = isRecord(body) ? body.data : undefined;
      if (!isRecord(candidate) || candidate.id !== thread.id) {
        throw new ShapeError('INVALID_THREAD_DETAIL', 'Forum thread detail did not match the requested thread.');
      }
      nextThread = candidate;
    } catch (error) {
      if (error instanceof CaptureFatalError) throw error;
      session.recordGap('forumThreads', endpoint, error);
      session.recordUnresolved('forumThreads', 'Thread detail could not be re-read.', [threadKey]);
      continue;
    }

    const currentPosts = session.dataset.forum.postsByThread[threadKey] || [];
    const currentVisible = visibleForumPostCount(currentPosts);
    const postsCount = nextThread.postsCount;
    const changed = fingerprint(nextThread) !== fingerprint(thread)
      || (typeof postsCount === 'number' && Number.isInteger(postsCount) && postsCount !== currentVisible);
    if (!changed) continue;

    let previous = currentPosts;
    let stable: CaptureRecord[] | null = null;
    const postsPath = `/api/forum/threads/${threadKey}/posts`;
    for (let attempt = 0; attempt < session.options.recheckAttempts; attempt += 1) {
      const result = await fetchPaginated(session, 'forumPosts', postsPath, {
        idOf: forumPostId,
        requireUuid: true,
      });
      if (!result.complete) break;
      const nextPosts = filterThreadPosts(session, threadKey, postsPath, result.items);
      if (fingerprint(nextPosts) === fingerprint(previous)) {
        stable = nextPosts;
        break;
      }
      previous = nextPosts;
    }
    if (stable) {
      const index = session.dataset.forum.threads.findIndex((item) => item.id === thread.id);
      if (index !== -1) session.dataset.forum.threads[index] = nextThread;
      session.dataset.forum.postsByThread[threadKey] = stable;
      const visibleCount = visibleForumPostCount(stable);
      const nextPostsCount = nextThread.postsCount;
      if (typeof nextPostsCount === 'number' && Number.isInteger(nextPostsCount)
          && nextPostsCount !== visibleCount) {
        session.recordUnresolved(
          'forumPosts',
          'Thread postsCount did not match the captured visible posts.',
          [threadKey],
        );
      }
    } else {
      session.recordUnresolved('forumPosts', 'Thread posts kept changing during the final recheck.', [threadKey]);
    }
  }

  if (!session.hasGap('forumCategories')) {
    await recheckForumCategories(session);
  }
}

export async function recheckAll(session: CaptureSession): Promise<void> {
  await recheckSingleList(
    session,
    'characters',
    '/api/personagens',
    (body) => requireArray(body, 'personagens', 'characters'),
    characterId,
    true,
  );
  await recheckScenes(session);
  await recheckWikiSections(session);
  await recheckWikiCategories(session);
  await recheckWikiPages(session);
  await recheckForum(session);
}
