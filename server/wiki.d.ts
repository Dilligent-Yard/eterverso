/**
 * Narrow facade for the untouched CommonJS wiki module.
 *
 * These declarations describe only the snapshot/link helpers imported by the
 * public-sandbox import island. `server/wiki.js` remains the implementation;
 * `validateWikiSnapshot` still performs all runtime normalization and rejects
 * malformed or non-public-wiki input before the import plan uses it.
 */
export interface WikiSnapshotSection {
  id: string;
  heading: string;
  html: string;
  blocks: unknown[];
  authority: string[];
  knowledgeLayer: string;
}

export interface WikiSnapshot {
  schemaVersion: number;
  title: string;
  slug: string;
  aliases: string[];
  type: string;
  summary: string;
  categories: string[];
  accessLevel: 'staff' | 'public';
  audience: string;
  body: {
    format: 'richtext-v1';
    infobox: Array<{ label: string; value: string }>;
    sections: WikiSnapshotSection[];
  };
}

export interface WikiLink {
  targetNameKey: string;
  targetAnchor: string;
}

export function normalizeSlug(value: string, field?: string): string;

export function validateWikiSnapshot(value: unknown): WikiSnapshot;

export function extractWikiLinks(snapshot: WikiSnapshot): WikiLink[];
