import { createHash } from 'node:crypto';

export interface SentinelRow {
  id: number;
  marker: string;
}

export interface SentinelSnapshot {
  database: string;
  user: string;
  table: string;
  marker: string;
  rows: SentinelRow[];
}

export interface SentinelComparison {
  unchanged: boolean;
  beforeDigest: string;
  afterDigest: string;
}

export function sentinelFingerprint(snapshot: SentinelSnapshot): string {
  const canonical = JSON.stringify({
    database: snapshot.database,
    user: snapshot.user,
    table: snapshot.table,
    marker: snapshot.marker,
    rows: snapshot.rows.map((row) => ({ id: row.id, marker: row.marker })),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export function validateSentinelSnapshot(snapshot: SentinelSnapshot, expected: {
  database: string;
  user: string;
  table: string;
  marker: string;
}): SentinelSnapshot {
  if (snapshot.database !== expected.database) {
    throw new Error('The sentinel connection reached an unexpected database.');
  }
  if (snapshot.user !== expected.user) {
    throw new Error('The sentinel connection reached an unexpected database user.');
  }
  if (snapshot.table !== expected.table) {
    throw new Error('The sentinel table marker is unexpected.');
  }
  if (snapshot.marker !== expected.marker) {
    throw new Error('The sentinel marker does not match the recorded run state.');
  }
  if (!Array.isArray(snapshot.rows) || snapshot.rows.length !== 1) {
    throw new Error('The sentinel table must contain exactly one marker row.');
  }
  const row = snapshot.rows[0];
  if (!row || row.id !== 1 || row.marker !== expected.marker) {
    throw new Error('The sentinel marker row is missing or was altered.');
  }
  return snapshot;
}

export function compareSentinel(before: SentinelSnapshot, after: SentinelSnapshot): SentinelComparison {
  const beforeDigest = sentinelFingerprint(before);
  const afterDigest = sentinelFingerprint(after);
  return { unchanged: beforeDigest === afterDigest, beforeDigest, afterDigest };
}
