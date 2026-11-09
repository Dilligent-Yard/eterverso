/**
 * Tipos centrais do Aetherverse Vault (TypeScript)
 * Compartilhados pelo backend e documentando os contratos da API.
 */

export type UserRole = 'member' | 'moderador' | 'admin';

export interface DbUser {
  id: string;
  username: string;
  email: string;
  password_hash: string;
  avatar: string;
  title: string;
  bio: string;
  posts_count: number;
  adm_tentativa_usada: boolean;
  role: UserRole;
  is_staff: boolean;
  join_date: string;
  disabled_at?: string | null;
  auth_version?: number;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface PublicUser {
  id: string;
  username: string;
  email?: string;
  avatar: string;
  title: string;
  bio: string;
  role: UserRole;
  posts: number;
  joinDate: string;
  admTentativaUsada?: boolean;
}

export interface DbPersonagem {
  id: string;
  author_id: string;
  nome: string;
  categoria: string;
  titulo: string;
  raca: string;
  faccao: string;
  status: string;
  imagem: string;
  descricao: string;
  stats: Record<string, number>;
  skills: Array<{ nome: string; descricao: string; tipo: string }>;
  mascara_tier: string;
  blocks: unknown[];
  theme: Record<string, unknown>;
  hidden_at?: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface PublicPersonagem {
  id: string;
  authorId: string;
  authorUsername?: string;
  authorAvatar?: string;
  authorTitle?: string;
  authorRole?: string;
  nome: string;
  categoria: string;
  titulo: string;
  raca: string;
  faccao: string;
  status: string;
  imagem: string;
  descricao: string;
  stats: Record<string, number>;
  skills: Array<{ nome: string; descricao: string; tipo: string }>;
  mascaraTier: string;
  blocks: unknown[];
  theme: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface DbWikiPost {
  id: string;
  author_id: string;
  titulo: string;
  subtitulo: string;
  categoria: string;
  status: string;
  resumo: string;
  banner: string;
  descricao: string;
  theme: Record<string, unknown>;
  infobox: Record<string, unknown>;
  blocks: unknown[];
  turns: unknown[];
  hidden_at?: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface TurnImage {
  url: string;
  caption: string;
}

export interface DbTurnPresentation {
  characterName?: string;
  characterTitle?: string;
  characterAvatar?: string;
  turnTitle?: string;
  location?: string;
  banner?: string;
  bannerStyle?: 'panoramic' | 'full' | 'side';
  images?: TurnImage[];
  oocNotes?: string;
  accentColor?: string;
  fontFamily?: 'serif' | 'sans' | 'mono';
  date?: string;
  edited?: boolean;
}

export interface PublicSceneTurn {
  id: string;
  authorId: string | null;
  authorName: string;
  authorRole: UserRole;
  authorAvatar: string;
  characterName: string;
  characterTitle: string;
  characterAvatar: string;
  turnTitle: string;
  location: string;
  banner: string;
  bannerStyle: 'panoramic' | 'full' | 'side';
  images: TurnImage[];
  content: string;
  oocNotes: string;
  accentColor: string;
  fontFamily: 'serif' | 'sans' | 'mono';
  date: string;
  edited: boolean;
  version?: number;
}

export type NotificationType = 'turn_replied' | 'like_personagem' | 'like_wiki_post' | 'like_turn';

export interface DbNotification {
  id: string;
  user_id: string;
  actor_id: string | null;
  type: NotificationType | string;
  reference_id: string | null;
  reference_type: string | null;
  title: string;
  message: string;
  read: boolean;
  created_at: string;
}

export interface PublicNotification {
  id: string;
  type: string;
  referenceId: string | null;
  referenceType: string | null;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
  actorId: string | null;
}

export type LikeTargetType = 'personagem' | 'wiki_post' | 'turn';

export interface DbLike {
  id: string;
  user_id: string;
  target_type: LikeTargetType | string;
  target_id: string;
  created_at: string;
}

export interface LikeToggleResult {
  liked: boolean;
  likeCount: number;
}

export interface LikeStatusResult {
  likeCount: number;
  userLiked: boolean;
}

export interface DbTimelineEvent {
  id: string;
  internal_id: string;
  title: string;
  short_title?: string;
  summary: string;
  color: string;
  era: string;
  start_date: string;
  end_date?: string;
  order_index: number;
  tags?: string;
  story_arc?: string;
  characters?: string;
  character_group?: string;
  location?: string;
  created_at: string;
  updated_at: string;
}

export interface PublicTimelineEvent {
  id: string;
  internalId: string;
  title: string;
  shortTitle: string;
  summary: string;
  color: string;
  era: string;
  startDate: string;
  endDate: string;
  orderIndex: number;
  tags: string;
  storyArc: string;
  characters: string;
  characterGroup: string;
  location: string;
  createdAt: string;
  updatedAt: string;
}

export interface ServerConfig {
  databaseUrl: string;
  sessionSecret: string;
  secureCookies: boolean;
  production: boolean;
  publicOrigin: string;
  port: number;
}

