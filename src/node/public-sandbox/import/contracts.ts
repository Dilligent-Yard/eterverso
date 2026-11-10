/**
 * Shared contracts for the public-sandbox import island.
 *
 * These types describe validated values and database write rows. They do not
 * replace the runtime guards in `capture.ts` and `plan.ts`: capture files are
 * still `unknown` until the reader validates them, and every mapped row is
 * rebuilt through the numeric/text/UUID/timestamp guards.
 */

export type UnknownRecord = Record<string, unknown>;

export interface PublicError extends Error {
  safeToPrint: true;
}

export const CAPTURE_SCHEMA = 'AetherversePublicCaptureV1';
export const RECONSTRUCTION_ID = 'b3c9a1f0-9d42-4a13-9a8e-1f6b8d2c7e54';
export const RECONSTRUCTION_USERNAME = 'reconstrucao-local';

export type TesterKey = 'admin' | 'moderador' | 'member';

export interface TesterSpec {
  readonly key: TesterKey;
  readonly username: string;
  readonly role: 'admin' | 'moderador' | 'member';
  readonly isStaff: boolean;
}

export const TESTER_SPECS: readonly TesterSpec[] = Object.freeze([
  { key: 'admin', username: 'sandbox-admin', role: 'admin', isStaff: true },
  { key: 'moderador', username: 'sandbox-moderador', role: 'moderador', isStaff: true },
  { key: 'member', username: 'sandbox-member', role: 'member', isStaff: false },
] as const);

/** Generated or file-read tester passwords. Values may be absent at runtime. */
export type TesterPasswords = Readonly<Record<string, string | undefined>>;

export type PasswordHasher = (value: string) => unknown;

export type Role = 'member' | 'moderador' | 'admin';

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

export interface CaptureGap {
  family: string;
  endpoint: string;
  status: number;
  reason: string;
}

export interface CaptureRequest {
  family: string;
  url: string;
  status: number;
  bytes: number;
  sha256: string;
  storedAs: string | null;
}

export type CaptureManifest = {
  schemaVersion: string;
  captureId: string;
  origin: string;
  startedAt: string;
  finishedAt: string;
  datasetSha256: string;
  requestPolicy: { anonymous: true; maxRequestsPerSecond: 1 };
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
    observedInterval: boolean;
    unresolvedChanges: unknown[];
  };
  requests: CaptureRequest[];
};

export type CaptureForum = {
  categories: unknown[];
  threads: unknown[];
  postsByThread: Record<string, unknown>;
};

export type CaptureDataset = {
  schemaVersion: string;
  origin: string;
  capturedAt: string;
  characters: unknown[];
  scenes: unknown[];
  wikiPages: unknown[];
  wikiSections: unknown[];
  wikiCategories: unknown[];
  forum: CaptureForum;
};

export interface CaptureResult {
  directory: string;
  manifest: CaptureManifest;
  dataset: CaptureDataset;
  origin: string;
  capturedAt: string;
  startedAt: string;
  finishedAt: string;
  datasetSha256: string;
  requestFiles: Array<string | null>;
  actualCounts: CaptureCounts;
}

export interface Normalization {
  kind: string;
  field?: string;
  authorId?: string;
  pageId?: string;
  count?: number;
}

export interface PlanReport {
  origin: string;
  normalizations: Normalization[];
}

export interface ResolvedAuthor {
  id: string;
  username: string;
  avatar: string;
  title: string;
  publicRole: Role;
  fallback: boolean;
}

export type UserKind =
  | 'public-author-placeholder'
  | 'reconstruction-actor'
  | 'synthetic-tester';

export interface UserRow {
  id: string;
  username: string;
  email: string;
  password_hash: string | null;
  avatar: string;
  title: string;
  bio: string;
  posts_count: number;
  adm_tentativa_usada: boolean;
  role: Role;
  is_staff: boolean;
  disabled_at: null;
  auth_version: number;
  version: number;
  join_date: string;
  created_at: string;
  updated_at: string;
  kind: UserKind;
}

export interface CharacterSkill {
  nome: string;
  descricao: string;
  tipo: 'skill' | 'equipamento';
}

export type ThemeKey =
  | 'accentColor'
  | 'bannerStyle'
  | 'layout'
  | 'fontFamily'
  | 'bgEffect'
  | 'bgm';

export type Theme = Record<ThemeKey, string>;

export interface InfoboxField {
  label: string;
  value: string;
}

export interface Infobox {
  show: boolean;
  title: string;
  image: string;
  caption: string;
  location: string;
  timeline: string;
  participants: string[];
  fields: InfoboxField[];
}

export interface CharacterRow {
  id: string;
  author_id: string;
  hidden_at: null;
  version: number;
  nome: string;
  categoria: string;
  titulo: string;
  raca: string;
  faccao: string;
  status: string;
  imagem: string;
  descricao: string;
  stats: Record<string, number>;
  skills: CharacterSkill[];
  mascara_tier: string;
  blocks: unknown[];
  theme: Theme;
  created_at: string;
  updated_at: string;
}

export type SceneTurnBannerStyle = 'panoramic' | 'full' | 'side';
export type SceneTurnFontFamily = 'serif' | 'sans' | 'mono';

export interface SceneImage {
  url: string;
  caption: string;
}

export interface SceneTurnPresentation {
  characterName: string;
  characterTitle: string;
  characterAvatar: string;
  turnTitle: string;
  location: string;
  banner: string;
  bannerStyle: SceneTurnBannerStyle;
  images: SceneImage[];
  oocNotes: string;
  accentColor: string;
  fontFamily: SceneTurnFontFamily;
  date: string;
  edited: boolean;
}

export interface SceneTurnRow {
  id: string;
  scene_id: string | null;
  author_id: string | null;
  legacy_author_label: string | null;
  legacy_id: string | null;
  ordinal: number;
  content: string;
  presentation: SceneTurnPresentation;
  version: number;
  deleted_at: null;
  created_at: string;
  updated_at: string;
}

export interface SceneRow {
  id: string;
  author_id: string | null;
  hidden_at: null;
  version: number;
  titulo: string;
  subtitulo: string;
  categoria: string;
  status: string;
  resumo: string;
  banner: string;
  descricao: string;
  theme: Theme;
  infobox: Infobox;
  blocks: unknown[];
  turns: unknown[];
  created_at: string;
  updated_at: string;
}

export interface ScenePlan {
  row: SceneRow;
  turns: SceneTurnRow[];
  legacyTurns: unknown[];
  sourceMode: 'legacy' | 'normalized';
  legacySha256: string;
  turnCount: number;
}

export interface SceneTurnBackupRow {
  scene_id: string;
  turns: unknown[];
  legacy_sha256: string;
  created_at: string;
}

export interface SceneTurnMarkerRow {
  scene_id: string;
  turn_count: number;
  legacy_sha256: string;
  completed_at: string;
}

export interface WikiSnapshotInfoboxEntry {
  label: string;
  value: string;
}

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
    infobox: WikiSnapshotInfoboxEntry[];
    sections: WikiSnapshotSection[];
  };
}

export interface WikiLink {
  targetNameKey: string;
  targetAnchor: string;
}

export interface PublicAuthor {
  id: string;
  username: string;
  avatar: string;
  title: string;
  role: Role;
}

export interface WikiPageRow {
  id: string;
  head_revision_id: string | null;
  published_revision_id: string | null;
  work_version: number;
  public_version: number;
  access_level: 'public';
  archived_at: null;
  discussion_thread_id: string | null;
  created_by: string;
  published_at: string;
  created_at: string;
  updated_at: string;
}

export interface WikiRevisionRow {
  id: string;
  page_id: string;
  sequence: number;
  parent_revision_id: null;
  base_published_revision_id: null;
  actor_id: string;
  edit_summary: string;
  snapshot: WikiSnapshot;
  restores_id: null;
  accepted_proposal_id: null;
  created_at: string;
}

export interface WikiNameRow {
  name_key: string;
  page_id: string;
  kind: 'canonical' | 'alias';
  created_at: string;
}

export interface WikiRevisionCategoryRow {
  revision_id: string;
  category: string;
  category_key: string;
}

export interface WikiRevisionLinkRow {
  revision_id: string;
  target_name_key: string;
  target_anchor: string;
}

export interface WikiPagePlan {
  page: WikiPageRow;
  revision: WikiRevisionRow;
  names: WikiNameRow[];
  categories: WikiRevisionCategoryRow[];
  links: WikiRevisionLinkRow[];
  searchText: string;
  publicAuthor: PublicAuthor | null;
}

export interface WikiSectionRow {
  key: string;
  name: string;
  description: string;
  parent_key: string | null;
  sort_order: number;
}

export interface WikiCategoryRow {
  name: string;
  key: string;
  pagesCount: number;
}

export interface ForumCategoryRow {
  id: string;
  name: string;
  description: string;
  archived_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface ThreadSeed {
  id: string;
  category_id: string;
  author_id: string | null;
  author_label: string | null;
  title: string;
  tag: string;
  pinned: boolean;
  locked: boolean;
  archived_at: string | null;
  version: number;
  last_activity_at: string;
  created_at: string;
  updated_at: string;
}

export type ThreadRow = ThreadSeed & {
  views: number;
  next_post_no: number;
  quarantined_at: null;
  quarantine_reason: null;
  legacy_reference: null;
};

export interface PostSeed {
  id: string;
  thread_id: string;
  author_id: string | null;
  author_label: string | null;
  content: string;
  edited: boolean;
  post_no: number;
  deleted_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export type PostRow = PostSeed & { legacy_reference: null };

export interface ForumPlan {
  categories: ForumCategoryRow[];
  threads: ThreadRow[];
  posts: PostRow[];
}

export interface TesterSummary {
  key: TesterKey;
  username: string;
  role: Role;
  isStaff: boolean;
  id: string;
}

export interface PlanCounts {
  users: number;
  publicAuthorPlaceholders: number;
  missingAuthorFallbacks: number;
  characters: number;
  scenes: number;
  sceneTurns: number;
  wikiPages: number;
  wikiSections: number;
  wikiCategories: number;
  forumCategories: number;
  forumThreads: number;
  forumPosts: number;
  citations: number;
}

export type PlanCapture = {
  captureId: string;
  origin: string;
  capturedAt: string;
  datasetSha256: string;
  complete: boolean;
  gaps: CaptureGap[];
  requestFiles: Array<string | null>;
};

export interface ImportPlan {
  capture: PlanCapture;
  users: UserRow[];
  characters: CharacterRow[];
  scenes: ScenePlan[];
  sections: WikiSectionRow[];
  categories: WikiCategoryRow[];
  wikiPages: WikiPagePlan[];
  forum: ForumPlan;
  testers: TesterSummary[];
  reconstructionActorId: string;
  normalizations: Normalization[];
  counts: PlanCounts;
  gaps: CaptureGap[];
}

export type ApplyOutcome = 'inserted' | 'unchanged';

export interface ImportStats {
  inserted: number;
  unchanged: number;
  byType: Record<string, { inserted: number; unchanged: number }>;
}

export interface ApplyResult extends ImportStats {
  noop: boolean;
  plan: {
    captureId: string;
    counts: PlanCounts;
  };
}

export interface ExistingTesterRow {
  id: string;
  username: string;
}
