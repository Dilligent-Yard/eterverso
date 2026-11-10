export interface ForumPostRecord {
  id?: unknown;
  version?: unknown;
  postNo?: unknown;
  deleted?: unknown;
  edited?: unknown;
  [key: string]: unknown;
}

export function versionNumber(post: ForumPostRecord | null | undefined): number {
  const version = Number(post?.version);
  return Number.isFinite(version) ? version : -1;
}

export function chooseRecord(
  current: ForumPostRecord | null | undefined,
  incoming: ForumPostRecord | null | undefined,
): ForumPostRecord | null {
  if (!current) return incoming ?? null;
  if (!incoming) return current;
  const currentVersion = versionNumber(current);
  const incomingVersion = versionNumber(incoming);
  if (currentVersion > incomingVersion) return current;
  if (currentVersion < incomingVersion) return incoming;
  if (current.deleted === true && incoming.deleted !== true) return current;
  if (current.edited === true && incoming.edited !== true) return current;
  return incoming;
}

function keyOf(id: unknown): string | null {
  if (typeof id === 'string') return id;
  if (typeof id === 'number' && Number.isFinite(id)) return String(id);
  return null;
}

export function postsById(
  posts: readonly ForumPostRecord[] | null | undefined,
): Record<string, ForumPostRecord> {
  const byId: Record<string, ForumPostRecord> = Object.create(null) as Record<string, ForumPostRecord>;
  for (const item of posts ?? []) {
    const key = item ? keyOf(item.id) : null;
    if (key !== null) byId[key] = item;
  }
  return byId;
}

export function sortRecords(posts: ForumPostRecord[]): ForumPostRecord[] {
  return posts.sort((left, right) => {
    const leftNo = Number(left?.postNo);
    const rightNo = Number(right?.postNo);
    if (Number.isFinite(leftNo) && Number.isFinite(rightNo) && leftNo !== rightNo) {
      return leftNo - rightNo;
    }
    return 0;
  });
}

export function mergeRecords(
  posts: readonly ForumPostRecord[] | null | undefined,
  additions: readonly ForumPostRecord[] | null | undefined,
): ForumPostRecord[] {
  const merged: ForumPostRecord[] = [];
  const indexById: Record<string, number> = Object.create(null) as Record<string, number>;
  for (const item of [...(posts ?? []), ...(additions ?? [])]) {
    const id = item ? keyOf(item.id) : null;
    if (id === null) continue;
    if (!Object.prototype.hasOwnProperty.call(indexById, id)) {
      indexById[id] = merged.length;
      merged.push(item);
      continue;
    }
    const index = indexById[id];
    if (index !== undefined) merged[index] = chooseRecord(merged[index], item) ?? item;
  }
  return sortRecords(merged);
}

export function tagClass(tag: unknown): string {
  return ['ooc', 'rp', 'wiki'].includes(String(tag)) ? String(tag) : 'ooc';
}
