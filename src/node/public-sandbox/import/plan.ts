import bcrypt from 'bcryptjs';

import { plainTextFromHtml, sanitizeBlocks, sanitizeHtml, sanitizeUrl } from '../../../../server/content';
import { extractWikiLinks, normalizeSlug, validateWikiSnapshot } from '../../../../server/wiki';

import type {
  CaptureGap,
  CaptureResult,
  CharacterRow,
  CharacterSkill,
  ForumCategoryRow,
  ForumPlan,
  ImportPlan,
  Infobox,
  InfoboxField,
  Normalization,
  PlanCapture,
  PlanCounts,
  PlanReport,
  PostSeed,
  PublicAuthor,
  ResolvedAuthor,
  Role,
  SceneImage,
  ScenePlan,
  SceneRow,
  SceneTurnBannerStyle,
  SceneTurnFontFamily,
  SceneTurnPresentation,
  SceneTurnRow,
  TesterPasswords,
  TesterSpec,
  TesterSummary,
  Theme,
  ThemeKey,
  ThreadRow,
  ThreadSeed,
  UnknownRecord,
  UserRow,
  WikiCategoryRow,
  WikiLink,
  WikiNameRow,
  WikiPagePlan,
  WikiPageRow,
  WikiRevisionCategoryRow,
  WikiRevisionLinkRow,
  WikiRevisionRow,
  WikiSectionRow,
  WikiSnapshot,
} from './contracts.js';
import {
  RECONSTRUCTION_ID,
  RECONSTRUCTION_USERNAME,
  TESTER_SPECS,
} from './contracts.js';
import {
  NAME_KEY_RE,
  UUID_RE,
  assertAllowedKeys,
  assertExactKeys,
  assertPlainObject,
  canonicalJson,
  deterministicUuid,
  field,
  integer,
  legacyDigest,
  nullableTimestamp,
  nullableUuid,
  optionalText,
  publicError,
  text,
  timestamp,
  uuid,
} from './primitives.js';

const STAT_KEYS = ['ataque', 'destreza', 'defesa', 'reserva', 'controle', 'refino', 'emissao', 'alma', 'inteligencia', 'habilidade'];
const THEME_KEYS = ['accentColor', 'bannerStyle', 'layout', 'fontFamily', 'bgEffect', 'bgm'];
type NonColorThemeKey = Exclude<ThemeKey, 'accentColor' | 'bgm'>;
const THEME_VALUES: ReadonlyArray<readonly [NonColorThemeKey, readonly string[]]> = [
  ['bannerStyle', ['cinematic', 'standard', 'compact', 'none']],
  ['layout', ['sidebar-left', 'sidebar-right', 'full', 'book']],
  ['fontFamily', ['serif', 'sans', 'mono']],
  ['bgEffect', ['none', 'aura', 'grid', 'dots']],
];
const TURN_KEYS = new Set([
  'id', 'authorId', 'authorName', 'authorRole', 'authorAvatar', 'characterName', 'characterTitle',
  'characterAvatar', 'turnTitle', 'location', 'banner', 'bannerStyle', 'images',
  'content', 'oocNotes', 'accentColor', 'fontFamily', 'date', 'edited', 'version',
  'legacyReadOnly',
]);

interface NormalizationSink {
  normalizations: Normalization[];
}

interface ContentOptions {
  required?: boolean;
  maxBytes?: number;
}

interface PlannedTurn {
  rowId: string;
  row: SceneTurnRow;
  authorLabel: string;
  resolvedAuthorId: string | null;
}

function qualifyMediaUrl(
  value: unknown,
  origin: string,
  label: string,
  report: PlanReport,
): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') throw publicError(`The capture ${label} is not a media URL.`);
  let candidate = value;
  if (candidate.startsWith('/') && !candidate.startsWith('//')) {
    candidate = `${origin}${candidate}`;
    report.normalizations.push({ kind: 'origin_relative_media_qualified', field: label });
  }
  const safe = sanitizeUrl(candidate, { image: true });
  if (!safe) throw publicError(`The capture ${label} is not a safe HTTPS image URL.`);
  return safe;
}

function safeHtmlContent(
  raw: unknown,
  label: string,
  report: NormalizationSink,
  { required = true, maxBytes = 500_000 }: ContentOptions = {},
): string {
  if (typeof raw !== 'string') throw publicError(`The capture ${label} is not HTML text.`);
  let sanitized: string;
  try {
    sanitized = sanitizeHtml(raw, { maxBytes });
  } catch {
    throw publicError(`The capture ${label} contains unsupported HTML.`);
  }
  if (sanitized !== raw) {
    report.normalizations.push({ kind: 'html_sanitized', field: label });
  }
  if (required && !sanitized.replace(/<[^>]*>/gu, '').trim() && !/<img\b/iu.test(sanitized)) {
    throw publicError(`The capture ${label} has no meaningful content.`);
  }
  return sanitized;
}

function safeBlocksContent(
  raw: unknown,
  label: string,
  report: NormalizationSink,
): unknown[] {
  if (!Array.isArray(raw)) throw publicError(`The capture ${label} is not a block list.`);
  let sanitized: unknown[];
  try {
    sanitized = sanitizeBlocks(raw, { maxBytes: 500_000 });
  } catch {
    throw publicError(`The capture ${label} contains unsupported blocks.`);
  }
  if (canonicalJson(sanitized) !== canonicalJson(raw)) {
    report.normalizations.push({ kind: 'blocks_sanitized', field: label });
  }
  return sanitized;
}

function importStats(raw: unknown, label: string, report: NormalizationSink): Record<string, number> {
  if (raw === undefined || raw === null) return {};
  const record = assertPlainObject(raw, label);
  const output: Record<string, number> = {};
  for (const key of Object.keys(record)) {
    if (!STAT_KEYS.includes(key)) throw publicError(`The capture ${label} has an unsupported statistic.`);
    output[key] = integer(record[key], `${label}.${key}`, { min: 0, max: 100 });
  }
  if (canonicalJson(output) !== canonicalJson(raw)) {
    report.normalizations.push({ kind: 'stats_normalized', field: label });
  }
  return output;
}

function importSkills(raw: unknown, label: string): CharacterSkill[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > 60) {
    throw publicError(`The capture ${label} is not a valid skill list.`);
  }
  const items: unknown[] = raw;
  return items.map((item, index) => {
    const record = assertPlainObject(item, `${label}[${index}]`);
    assertExactKeys(record, ['nome', 'descricao', 'tipo'], `${label}[${index}]`);
    const tipo: CharacterSkill['tipo'] = record.tipo === 'equipamento' ? 'equipamento' : 'skill';
    return {
      nome: optionalText(record.nome, `${label}[${index}].nome`, { min: 0, max: 100 }),
      descricao: optionalText(record.descricao, `${label}[${index}].descricao`, { min: 0, max: 2_000 }),
      tipo,
    };
  });
}

function importTheme(raw: unknown, label: string, report: NormalizationSink): Theme {
  let value = raw;
  if (value === undefined || value === null) value = {};
  const record = assertPlainObject(value, label);
  assertAllowedKeys(record, THEME_KEYS, label);
  const output: Theme = {
    accentColor: '',
    bannerStyle: 'cinematic',
    layout: 'sidebar-left',
    fontFamily: 'sans',
    bgEffect: 'none',
    bgm: '',
  };
  if (record.accentColor !== undefined && record.accentColor !== '') {
    if (typeof record.accentColor !== 'string' || !/^#(?:[\da-f]{3}|[\da-f]{6})$/iu.test(record.accentColor)) {
      throw publicError(`The capture ${label}.accentColor is invalid.`);
    }
    output.accentColor = record.accentColor.toLowerCase();
  }
  for (const [key, choices] of THEME_VALUES) {
    const choice = record[key];
    if (choice === undefined || choice === '') continue;
    if (typeof choice !== 'string' || !choices.includes(choice)) {
      throw publicError(`The capture ${label}.${key} is invalid.`);
    }
    output[key] = choice;
  }
  if (record.bgm !== undefined) {
    output.bgm = optionalText(record.bgm, `${label}.bgm`, { min: 0, max: 300 });
  }
  if (canonicalJson(output) !== canonicalJson({ ...record, ...output })) {
    report.normalizations.push({ kind: 'theme_defaults_applied', field: label });
  }
  return output;
}

function importInfoboxEntryList(
  raw: unknown,
  label: string,
  report: PlanReport,
): Infobox {
  let value = raw;
  if (value === undefined || value === null) value = {};
  const record = assertPlainObject(value, label);
  assertAllowedKeys(record, ['show', 'title', 'image', 'caption', 'location', 'timeline', 'participants', 'fields'], label);
  const rawFields = record.fields === undefined ? [] : record.fields;
  if (!Array.isArray(rawFields) || rawFields.length > 30) {
    throw publicError(`The capture ${label}.fields is invalid.`);
  }
  const fields: unknown[] = rawFields;
  const safeFields: InfoboxField[] = fields.map((fieldValue, index) => {
    const fieldRecord = assertPlainObject(fieldValue, `${label}.fields[${index}]`);
    assertExactKeys(fieldRecord, ['label', 'value'], `${label}.fields[${index}]`);
    return {
      label: optionalText(fieldRecord.label, `${label}.fields[${index}].label`, { min: 0, max: 80 }),
      value: optionalText(fieldRecord.value, `${label}.fields[${index}].value`, { min: 0, max: 300 }),
    };
  });
  const rawParticipants = record.participants === undefined ? [] : record.participants;
  if (!Array.isArray(rawParticipants) || rawParticipants.length > 30) {
    throw publicError(`The capture ${label}.participants is invalid.`);
  }
  const participants: unknown[] = rawParticipants;
  const safeParticipants = participants.map((participant, index) => (
    text(participant, `${label}.participants[${index}]`, { min: 1, max: 100 })
  ));
  const output: Infobox = {
    show: record.show !== false,
    title: optionalText(record.title, `${label}.title`, { min: 0, max: 120 }),
    image: qualifyMediaUrl(record.image, report.origin, `${label}.image`, report),
    caption: optionalText(record.caption, `${label}.caption`, { min: 0, max: 200 }),
    location: optionalText(record.location, `${label}.location`, { min: 0, max: 160 }),
    timeline: optionalText(record.timeline, `${label}.timeline`, { min: 0, max: 160 }),
    participants: safeParticipants,
    fields: safeFields,
  };
  if (canonicalJson(output) !== canonicalJson({ ...record, ...output })) {
    report.normalizations.push({ kind: 'infobox_normalized', field: label });
  }
  return output;
}

function authorRecord(raw: unknown, label: string): PublicAuthor | null {
  if (raw === undefined || raw === null) return null;
  const record = assertPlainObject(raw, label);
  assertExactKeys(record, ['id', 'username', 'avatar', 'title', 'role'], label);
  const role: Role = record.role === 'moderador' || record.role === 'admin' ? record.role : 'member';
  return {
    id: uuid(record.id, `${label}.id`),
    username: text(record.username, `${label}.username`, { min: 1, max: 50 }),
    avatar: typeof record.avatar === 'string' ? record.avatar : '',
    title: optionalText(record.title, `${label}.title`, { min: 0, max: 100 }),
    role,
  };
}

export function buildAuthorIndex(capture: CaptureResult, report: PlanReport): Map<string, ResolvedAuthor> {
  const authors = new Map<string, ResolvedAuthor>();
  const names = new Map<string, string>();
  function add(
    raw: unknown,
    fallbackId: unknown,
    label: string,
  ): { id: string; username: string; fallback: boolean } | null {
    const parsed = authorRecord(raw, label);
    const id = parsed ? parsed.id : (fallbackId ? uuid(fallbackId, `${label}.authorId`) : null);
    if (!id) return null;
    let record = authors.get(id);
    if (!record) {
      record = {
        id,
        username: parsed ? parsed.username : `autor-publico-${id.slice(0, 8)}`,
        avatar: parsed ? parsed.avatar : '',
        title: parsed ? parsed.title : '',
        publicRole: parsed ? parsed.role : 'member',
        fallback: !parsed,
      };
      authors.set(id, record);
    } else {
      if (parsed && !record.fallback && parsed.username !== record.username) {
        throw publicError(`The capture maps one public author to conflicting usernames at ${label}.`);
      }
      if (parsed && record.fallback) {
        record.username = parsed.username;
        record.avatar = parsed.avatar;
        record.title = parsed.title;
        record.publicRole = parsed.role;
        record.fallback = false;
      }
    }
    const key = record.username.toLowerCase();
    const existing = names.get(key);
    if (existing !== undefined && existing !== id) {
      throw publicError('The capture contains two public authors with the same case-insensitive username.');
    }
    names.set(key, id);
    return { id, username: record.username, fallback: record.fallback };
  }
  for (let index = 0; index < capture.dataset.characters.length; index += 1) {
    const record = capture.dataset.characters[index];
    add(field(record, 'author'), field(record, 'authorId'), `characters[${index}].author`);
  }
  for (let index = 0; index < capture.dataset.scenes.length; index += 1) {
    const scene = capture.dataset.scenes[index];
    add(field(scene, 'author'), field(scene, 'authorId'), `scenes[${index}].author`);
    const sceneTurns = field(scene, 'turns');
    if (!Array.isArray(sceneTurns)) {
      throw publicError('A captured scene has an invalid turns collection.');
    }
    const turns: unknown[] = sceneTurns;
    for (let turnIndex = 0; turnIndex < turns.length; turnIndex += 1) {
      const turn = turns[turnIndex];
      add(null, field(turn, 'authorId'), `scenes[${index}].turns[${turnIndex}].author`);
    }
  }
  for (let index = 0; index < capture.dataset.wikiPages.length; index += 1) {
    add(field(capture.dataset.wikiPages[index], 'author'), null, `wikiPages[${index}].author`);
  }
  for (let index = 0; index < capture.dataset.forum.threads.length; index += 1) {
    const thread = capture.dataset.forum.threads[index];
    add(field(thread, 'author'), field(thread, 'authorId'), `forum.threads[${index}].author`);
  }
  for (const [threadId, posts] of Object.entries(capture.dataset.forum.postsByThread)) {
    if (!Array.isArray(posts)) continue;
    const postList: unknown[] = posts;
    for (let index = 0; index < postList.length; index += 1) {
      const post = postList[index];
      add(field(post, 'author'), field(post, 'authorId'), `forum.postsByThread.${threadId}[${index}].author`);
    }
  }
  for (const author of authors.values()) {
    if (author.fallback) {
      report.normalizations.push({ kind: 'missing_author_fallback', authorId: author.id });
    }
    if (author.publicRole !== 'member') {
      report.normalizations.push({ kind: 'public_author_role_not_imported', authorId: author.id });
    }
  }
  return authors;
}

function publicCaptureDate(capture: CaptureResult): string {
  return new Date(capture.capturedAt).toISOString().slice(0, 10);
}

function userRowFromAuthor(author: ResolvedAuthor, capture: CaptureResult): UserRow {
  return {
    id: author.id,
    username: author.username,
    email: `autor-${author.id}@public-sandbox.invalid`,
    password_hash: '',
    avatar: author.avatar,
    title: author.title,
    bio: 'Autor público reconstruído localmente; conta sem login e sem privilégios.',
    posts_count: 0,
    adm_tentativa_usada: false,
    role: 'member',
    is_staff: false,
    disabled_at: null,
    auth_version: 1,
    version: 1,
    join_date: publicCaptureDate(capture),
    created_at: capture.capturedAt,
    updated_at: capture.capturedAt,
    kind: 'public-author-placeholder',
  };
}

function reconstructionUserRow(capture: CaptureResult): UserRow {
  return {
    id: RECONSTRUCTION_ID,
    username: RECONSTRUCTION_USERNAME,
    email: 'reconstrucao@public-sandbox.invalid',
    password_hash: '',
    avatar: '',
    title: 'Ator de reconstrução local',
    bio: 'Conta local sem login usada para reconstruir conteúdo público capturado. Não representa autoria editorial original.',
    posts_count: 0,
    adm_tentativa_usada: false,
    role: 'member',
    is_staff: false,
    disabled_at: null,
    auth_version: 1,
    version: 1,
    join_date: publicCaptureDate(capture),
    created_at: capture.capturedAt,
    updated_at: capture.capturedAt,
    kind: 'reconstruction-actor',
  };
}

function testerUserRow(
  spec: TesterSpec,
  capture: CaptureResult,
  passwordHash: string | null,
): UserRow {
  return {
    id: deterministicUuid('eterverso-public-sandbox-testers', spec.key),
    username: spec.username,
    email: `${spec.username}@public-sandbox.invalid`,
    password_hash: passwordHash || null,
    avatar: '',
    title: spec.role === 'admin' ? 'Administrador local de teste' : (spec.role === 'moderador' ? 'Moderador local de teste' : 'Membro local de teste'),
    bio: 'Conta sintética do sandbox público local. Não representa uma pessoa real.',
    posts_count: 0,
    adm_tentativa_usada: false,
    role: spec.role,
    is_staff: spec.isStaff,
    disabled_at: null,
    auth_version: 1,
    version: 1,
    join_date: publicCaptureDate(capture),
    created_at: capture.capturedAt,
    updated_at: capture.capturedAt,
    kind: 'synthetic-tester',
  };
}

function characterPlan(
  raw: unknown,
  index: number,
  authors: Map<string, ResolvedAuthor>,
  capture: CaptureResult,
  report: PlanReport,
): CharacterRow {
  const record = assertPlainObject(raw, `characters[${index}]`);
  assertExactKeys(record, [
    'id', 'version', 'authorId', 'author', 'createdAt', 'updatedAt', 'nome', 'categoria',
    'titulo', 'raca', 'faccao', 'status', 'imagem', 'descricao', 'stats', 'skills',
    'mascaraTier', 'blocks', 'theme',
  ], `characters[${index}]`);
  const id = uuid(record.id, `characters[${index}].id`);
  const authorId = uuid(record.authorId, `characters[${index}].authorId`);
  const author = authors.get(authorId);
  if (!author) throw publicError(`The capture character ${index} has no resolvable author.`);
  return {
    id,
    author_id: authorId,
    hidden_at: null,
    version: integer(record.version, `characters[${index}].version`, { min: 1, max: 2_147_483_647 }),
    nome: text(record.nome, `characters[${index}].nome`, { min: 1, max: 100 }),
    categoria: optionalText(record.categoria, `characters[${index}].categoria`, { min: 0, max: 50 }),
    titulo: optionalText(record.titulo, `characters[${index}].titulo`, { min: 0, max: 100 }),
    raca: optionalText(record.raca, `characters[${index}].raca`, { min: 0, max: 80 }),
    faccao: optionalText(record.faccao, `characters[${index}].faccao`, { min: 0, max: 120 }),
    status: optionalText(record.status, `characters[${index}].status`, { min: 0, max: 80 }),
    imagem: qualifyMediaUrl(record.imagem, capture.origin, `characters[${index}].imagem`, report),
    descricao: safeHtmlContent(record.descricao, `characters[${index}].descricao`, report),
    stats: importStats(record.stats, `characters[${index}].stats`, report),
    skills: importSkills(record.skills, `characters[${index}].skills`),
    mascara_tier: optionalText(record.mascaraTier, `characters[${index}].mascaraTier`, { min: 0, max: 60 }),
    blocks: safeBlocksContent(record.blocks, `characters[${index}].blocks`, report),
    theme: importTheme(record.theme, `characters[${index}].theme`, report),
    created_at: timestamp(record.createdAt, `characters[${index}].createdAt`),
    updated_at: timestamp(record.updatedAt, `characters[${index}].updatedAt`),
  };
}

function turnPlan(
  raw: unknown,
  sceneIndex: number,
  turnIndex: number,
  authors: Map<string, ResolvedAuthor>,
  capture: CaptureResult,
  report: PlanReport,
  sceneTimestamp: string,
): PlannedTurn {
  const record = assertPlainObject(raw, `scenes[${sceneIndex}].turns[${turnIndex}]`);
  for (const key of Object.keys(record)) {
    if (!TURN_KEYS.has(key)) {
      throw publicError(`The capture scene turn has an unsupported field at scene ${sceneIndex}.`);
    }
  }
  const label = `scenes[${sceneIndex}].turns[${turnIndex}]`;
  const authorId = nullableUuid(record.authorId, `${label}.authorId`);
  const author = authorId ? authors.get(authorId) : null;
  const authorName = optionalText(record.authorName, `${label}.authorName`, { min: 0, max: 60 });
  if (record.authorRole && record.authorRole !== 'member') {
    report.normalizations.push({ kind: 'turn_author_role_not_imported' });
  }
  const rawImages = record.images === undefined ? [] : record.images;
  if (!Array.isArray(rawImages) || rawImages.length > 20) {
    throw publicError(`The capture ${label}.images is invalid.`);
  }
  const images: unknown[] = rawImages;
  const safeImages: SceneImage[] = images.map((image, imageIndex) => {
    const imageRecord = assertPlainObject(image, `${label}.images[${imageIndex}]`);
    assertExactKeys(imageRecord, ['url', 'caption'], `${label}.images[${imageIndex}]`);
    return {
      url: qualifyMediaUrl(imageRecord.url, capture.origin, `${label}.images[${imageIndex}].url`, report),
      caption: optionalText(imageRecord.caption, `${label}.images[${imageIndex}].caption`, { min: 0, max: 240 }),
    };
  });
  const bannerStyleValue = record.bannerStyle === undefined ? 'panoramic' : record.bannerStyle;
  if (bannerStyleValue !== 'panoramic' && bannerStyleValue !== 'full' && bannerStyleValue !== 'side') {
    throw publicError(`The capture ${label}.bannerStyle is invalid.`);
  }
  const bannerStyle: SceneTurnBannerStyle = bannerStyleValue;
  const fontFamilyValue = record.fontFamily === undefined ? 'serif' : record.fontFamily;
  if (fontFamilyValue !== 'serif' && fontFamilyValue !== 'sans' && fontFamilyValue !== 'mono') {
    throw publicError(`The capture ${label}.fontFamily is invalid.`);
  }
  const fontFamily: SceneTurnFontFamily = fontFamilyValue;
  const accentColorValue = record.accentColor === undefined ? '' : record.accentColor;
  if (accentColorValue && (typeof accentColorValue !== 'string' || !/^#(?:[\da-f]{3}|[\da-f]{6})$/iu.test(accentColorValue))) {
    throw publicError(`The capture ${label}.accentColor is invalid.`);
  }
  if (typeof accentColorValue !== 'string') {
    throw publicError(`The capture ${label}.accentColor is invalid.`);
  }
  const accentColor = accentColorValue;
  const content = safeHtmlContent(record.content, `${label}.content`, report, { maxBytes: 500_000 });
  const legacyId = typeof record.id === 'string' && record.id && Array.from(record.id).length <= 80
    ? record.id
    : null;
  if (record.id !== undefined && record.id !== null && typeof record.id !== 'string') {
    throw publicError(`The capture ${label}.id is invalid.`);
  }
  const rowId = legacyId && UUID_RE.test(legacyId)
    ? legacyId.toLowerCase()
    : deterministicUuid('eterverso-public-sandbox-turn', `${sceneIndex}\0${turnIndex}\0${legacyId || ''}`);
  const presentation: SceneTurnPresentation = {
    characterName: optionalText(record.characterName, `${label}.characterName`, { min: 0, max: 100 }),
    characterTitle: optionalText(record.characterTitle, `${label}.characterTitle`, { min: 0, max: 120 }),
    characterAvatar: qualifyMediaUrl(record.characterAvatar, capture.origin, `${label}.characterAvatar`, report),
    turnTitle: optionalText(record.turnTitle, `${label}.turnTitle`, { min: 0, max: 160 }),
    location: optionalText(record.location, `${label}.location`, { min: 0, max: 120 }),
    banner: qualifyMediaUrl(record.banner, capture.origin, `${label}.banner`, report),
    bannerStyle,
    images: safeImages,
    oocNotes: optionalText(record.oocNotes, `${label}.oocNotes`, { min: 0, max: 4_000 }),
    accentColor: accentColor.toLowerCase(),
    fontFamily,
    date: optionalText(record.date, `${label}.date`, { min: 0, max: 80 }),
    edited: record.edited === true,
  };
  const row: SceneTurnRow = {
    id: rowId,
    scene_id: null,
    author_id: authorId || null,
    legacy_author_label: authorName || null,
    legacy_id: legacyId,
    ordinal: turnIndex,
    content,
    presentation,
    version: integer(record.version === undefined ? 1 : record.version, `${label}.version`, { min: 1, max: 2_147_483_647 }),
    deleted_at: null,
    created_at: sceneTimestamp,
    updated_at: sceneTimestamp,
  };
  return {
    rowId,
    row,
    authorLabel: authorName,
    resolvedAuthorId: author ? author.id : null,
  };
}

function scenePlan(
  raw: unknown,
  index: number,
  authors: Map<string, ResolvedAuthor>,
  capture: CaptureResult,
  report: PlanReport,
): ScenePlan {
  const record = assertPlainObject(raw, `scenes[${index}]`);
  assertExactKeys(record, [
    'id', 'version', 'turnsReadOnly', 'authorId', 'author', 'titulo', 'subtitulo',
    'categoria', 'status', 'resumo', 'banner', 'descricao', 'theme', 'infobox',
    'blocks', 'turns', 'createdAt', 'updatedAt',
  ], `scenes[${index}]`);
  const id = uuid(record.id, `scenes[${index}].id`);
  const authorId = nullableUuid(record.authorId, `scenes[${index}].authorId`);
  if (authorId && !authors.has(authorId)) {
    throw publicError(`The capture scene ${index} references an author that cannot be resolved.`);
  }
  const rawTurns = record.turns;
  if (!Array.isArray(rawTurns)) throw publicError(`The capture scene ${index} turns collection is invalid.`);
  const turnsInput: unknown[] = rawTurns;
  const createdAt = timestamp(record.createdAt, `scenes[${index}].createdAt`);
  const updatedAt = timestamp(record.updatedAt, `scenes[${index}].updatedAt`);
  const legacyMode = record.turnsReadOnly === true;
  if (typeof record.turnsReadOnly !== 'boolean') {
    throw publicError(`The capture scene ${index} turnsReadOnly flag is invalid.`);
  }
  const seenTurnIds = new Set<string>();
  const turns: SceneTurnRow[] = turnsInput.map((turn, turnIndex) => {
    const planned = turnPlan(turn, index, turnIndex, authors, capture, report, updatedAt);
    if (planned.row.legacy_id) {
      if (seenTurnIds.has(planned.row.legacy_id)) {
        throw publicError(`The capture scene ${index} contains duplicate turn identifiers.`);
      }
      seenTurnIds.add(planned.row.legacy_id);
    }
    planned.row.scene_id = id;
    if (planned.row.author_id && !authors.has(planned.row.author_id)) {
      throw publicError(`The capture scene ${index} has a turn author that cannot be resolved.`);
    }
    return planned.row;
  });
  const legacyTurns: unknown[] = legacyMode ? turnsInput : [];
  const row: SceneRow = {
    id,
    author_id: authorId,
    hidden_at: null,
    version: integer(record.version, `scenes[${index}].version`, { min: 1, max: 2_147_483_647 }),
    titulo: text(record.titulo, `scenes[${index}].titulo`, { min: 1, max: 200 }),
    subtitulo: optionalText(record.subtitulo, `scenes[${index}].subtitulo`, { min: 0, max: 200 }),
    categoria: optionalText(record.categoria, `scenes[${index}].categoria`, { min: 0, max: 80 }) || 'Cena de RPG',
    status: optionalText(record.status, `scenes[${index}].status`, { min: 0, max: 80 }) || 'Em Andamento',
    resumo: optionalText(record.resumo, `scenes[${index}].resumo`, { min: 0, max: 1_000 }),
    banner: qualifyMediaUrl(record.banner, capture.origin, `scenes[${index}].banner`, report),
    descricao: safeHtmlContent(record.descricao, `scenes[${index}].descricao`, report),
    theme: importTheme(record.theme, `scenes[${index}].theme`, report),
    infobox: importInfoboxEntryList(record.infobox, `scenes[${index}].infobox`, report),
    blocks: safeBlocksContent(record.blocks, `scenes[${index}].blocks`, report),
    turns: legacyTurns,
    created_at: createdAt,
    updated_at: updatedAt,
  };
  return {
    row,
    turns,
    legacyTurns,
    sourceMode: legacyMode ? 'legacy' : 'normalized',
    legacySha256: legacyDigest(legacyTurns),
    turnCount: turns.length,
  };
}

function snapshotSearchText(snapshot: WikiSnapshot): string {
  const values: string[] = [snapshot.title, snapshot.summary, ...snapshot.aliases, ...snapshot.categories];
  const visit = (value: unknown, key = ''): void => {
    if (typeof value === 'string') {
      if (key === 'html' || key === 'content') {
        try { values.push(plainTextFromHtml(value)); } catch { /* already validated */ }
      } else {
        values.push(value);
      }
    } else if (Array.isArray(value)) {
      const list: unknown[] = value;
      list.forEach((item) => visit(item));
    } else if (value && typeof value === 'object') {
      const record = value as UnknownRecord;
      Object.entries(record).forEach(([name, item]) => {
        if (!['id', 'authority', 'knowledgeLayer', 'format', 'type'].includes(name)) visit(item, name);
      });
    }
  };
  visit(snapshot.body);
  return values.join('\n');
}

function wikiPagePlan(
  raw: unknown,
  index: number,
  capture: CaptureResult,
  report: PlanReport,
  reconstructionActorId: string,
): WikiPagePlan {
  const record = assertPlainObject(raw, `wikiPages[${index}]`);
  assertExactKeys(record, [
    'id', 'publishedRevisionId', 'title', 'slug', 'aliases', 'type', 'summary',
    'categories', 'accessLevel', 'discussionThreadId', 'audience', 'author', 'body',
    'publicVersion', 'createdAt', 'publishedAt', 'updatedAt',
  ], `wikiPages[${index}]`);
  const id = uuid(record.id, `wikiPages[${index}].id`);
  const publishedRevisionId = uuid(record.publishedRevisionId, `wikiPages[${index}].publishedRevisionId`);
  const inputSnapshot: UnknownRecord = {
    schemaVersion: 1,
    title: record.title,
    slug: record.slug,
    aliases: record.aliases,
    type: record.type,
    summary: record.summary,
    categories: record.categories,
    accessLevel: record.accessLevel,
    audience: record.audience,
    body: record.body,
  };
  let snapshot: WikiSnapshot;
  try {
    snapshot = validateWikiSnapshot(inputSnapshot);
  } catch {
    throw publicError(`The capture wiki page ${index} does not satisfy the current wiki snapshot contract.`);
  }
  if (canonicalJson(snapshot) !== canonicalJson(inputSnapshot)) {
    report.normalizations.push({ kind: 'wiki_snapshot_normalized', pageId: id });
  }
  if (record.accessLevel !== 'public' || snapshot.accessLevel !== 'public') {
    throw publicError('The capture contains a non-public wiki page; only public captures may be imported.');
  }
  const publicVersion = integer(record.publicVersion, `wikiPages[${index}].publicVersion`, { min: 1, max: 2_147_483_647 });
  const createdAt = timestamp(record.createdAt, `wikiPages[${index}].createdAt`);
  const publishedAt = timestamp(record.publishedAt, `wikiPages[${index}].publishedAt`);
  const updatedAt = timestamp(record.updatedAt, `wikiPages[${index}].updatedAt`);
  let categories: WikiRevisionCategoryRow[];
  let links: WikiRevisionLinkRow[];
  try {
    categories = snapshot.categories.map((category) => ({
      revision_id: publishedRevisionId,
      category,
      category_key: normalizeSlug(category, 'category'),
    }));
    links = extractWikiLinks(snapshot).map((link: WikiLink) => ({
      revision_id: publishedRevisionId,
      target_name_key: link.targetNameKey,
      target_anchor: link.targetAnchor,
    }));
  } catch {
    throw publicError(`The capture wiki page ${index} has invalid category or link metadata.`);
  }
  const publicAuthor = authorRecord(record.author, `wikiPages[${index}].author`);
  const authorNote = publicAuthor ? ` Atribuição pública original: ${publicAuthor.username}.` : '';
  const editSummary = `Reconstrução local a partir de captura pública ${capture.manifest.captureId}; sem citações ou histórico originais.${authorNote}`.slice(0, 1000);
  const page: WikiPageRow = {
    id,
    head_revision_id: publishedRevisionId,
    published_revision_id: publishedRevisionId,
    work_version: 1,
    public_version: publicVersion,
    access_level: 'public',
    archived_at: null,
    discussion_thread_id: nullableUuid(record.discussionThreadId, `wikiPages[${index}].discussionThreadId`),
    created_by: reconstructionActorId,
    published_at: publishedAt,
    created_at: createdAt,
    updated_at: updatedAt,
  };
  const revision: WikiRevisionRow = {
    id: publishedRevisionId,
    page_id: id,
    sequence: 1,
    parent_revision_id: null,
    base_published_revision_id: null,
    actor_id: reconstructionActorId,
    edit_summary: editSummary,
    snapshot,
    restores_id: null,
    accepted_proposal_id: null,
    created_at: publishedAt || updatedAt,
  };
  const names: WikiNameRow[] = [snapshot.slug, ...snapshot.aliases].map((nameKey) => ({
    name_key: nameKey,
    page_id: id,
    kind: nameKey === snapshot.slug ? 'canonical' : 'alias',
    created_at: createdAt,
  }));
  return {
    page,
    revision,
    names,
    categories,
    links,
    searchText: snapshotSearchText(snapshot),
    publicAuthor,
  };
}

function validateWikiSection(raw: unknown, index: number): WikiSectionRow {
  const record = assertPlainObject(raw, `wikiSections[${index}]`);
  assertExactKeys(record, ['key', 'name', 'description', 'parentKey', 'order', 'pagesCount'], `wikiSections[${index}]`);
  const key = text(record.key, `wikiSections[${index}].key`, { min: 1, max: 100 });
  if (!NAME_KEY_RE.test(key)) throw publicError(`The capture wiki section ${index} key is invalid.`);
  return {
    key,
    name: text(record.name, `wikiSections[${index}].name`, { min: 1, max: 1_000 }),
    description: optionalText(record.description, `wikiSections[${index}].description`, { min: 0, max: 10_000 }),
    parent_key: record.parentKey === null || record.parentKey === undefined
      ? null
      : text(record.parentKey, `wikiSections[${index}].parentKey`, { min: 1, max: 100 }),
    sort_order: integer(record.order, `wikiSections[${index}].order`, { min: 0, max: 2_147_483_647 }),
  };
}

function validateWikiCategory(raw: unknown, index: number): WikiCategoryRow {
  const record = assertPlainObject(raw, `wikiCategories[${index}]`);
  assertExactKeys(record, ['name', 'key', 'pagesCount'], `wikiCategories[${index}]`);
  return {
    name: text(record.name, `wikiCategories[${index}].name`, { min: 1, max: 100 }),
    key: text(record.key, `wikiCategories[${index}].key`, { min: 1, max: 100 }),
    pagesCount: integer(record.pagesCount, `wikiCategories[${index}].pagesCount`, { min: 0 }),
  };
}

function validateForumCategory(raw: unknown, index: number): ForumCategoryRow {
  const record = assertPlainObject(raw, `forum.categories[${index}]`);
  assertAllowedKeys(record, [
    'id', 'name', 'description', 'archivedAt', 'version', 'createdAt', 'updatedAt',
    'topicsCount', 'postsCount',
  ], `forum.categories[${index}]`);
  return {
    id: uuid(record.id, `forum.categories[${index}].id`),
    name: text(record.name, `forum.categories[${index}].name`, { min: 1, max: 100 }),
    description: optionalText(record.description, `forum.categories[${index}].description`, { min: 0, max: 1_000 }),
    archived_at: nullableTimestamp(record.archivedAt, `forum.categories[${index}].archivedAt`),
    version: integer(record.version === undefined ? 1 : record.version, `forum.categories[${index}].version`, { min: 1, max: 2_147_483_647 }),
    created_at: timestamp(record.createdAt, `forum.categories[${index}].createdAt`),
    updated_at: timestamp(record.updatedAt, `forum.categories[${index}].updatedAt`),
  };
}

function validateThread(raw: unknown, index: number): ThreadSeed {
  const record = assertPlainObject(raw, `forum.threads[${index}]`);
  assertAllowedKeys(record, [
    'id', 'categoryId', 'categoryName', 'title', 'tag', 'pinned', 'locked', 'archivedAt',
    'version', 'lastActivityAt', 'createdAt', 'updatedAt', 'postsCount', 'author',
    'authorId', 'authorLabel',
  ], `forum.threads[${index}]`);
  const author = field(record, 'author');
  return {
    id: uuid(record.id, `forum.threads[${index}].id`),
    category_id: uuid(record.categoryId, `forum.threads[${index}].categoryId`),
    author_id: nullableUuid(record.authorId || field(author, 'id'), `forum.threads[${index}].authorId`),
    author_label: optionalText(record.authorLabel, `forum.threads[${index}].authorLabel`, { min: 0, max: 500 }) || null,
    title: text(record.title, `forum.threads[${index}].title`, { min: 1, max: 200 }),
    tag: optionalText(record.tag, `forum.threads[${index}].tag`, { min: 0, max: 20 }),
    pinned: record.pinned === true,
    locked: record.locked === true,
    archived_at: nullableTimestamp(record.archivedAt, `forum.threads[${index}].archivedAt`),
    version: integer(record.version === undefined ? 1 : record.version, `forum.threads[${index}].version`, { min: 1, max: 2_147_483_647 }),
    last_activity_at: timestamp(record.lastActivityAt, `forum.threads[${index}].lastActivityAt`),
    created_at: timestamp(record.createdAt, `forum.threads[${index}].createdAt`),
    updated_at: timestamp(record.updatedAt, `forum.threads[${index}].updatedAt`),
  };
}

function validatePost(
  raw: unknown,
  threadId: string,
  index: number,
  report: PlanReport,
): PostSeed {
  const record = assertPlainObject(raw, `forum posts[${index}]`);
  assertAllowedKeys(record, [
    'id', 'threadId', 'postNo', 'version', 'edited', 'deleted', 'deletedAt', 'createdAt',
    'updatedAt', 'content', 'author', 'authorId', 'authorLabel',
  ], `forum posts[${index}]`);
  let deletedAt = nullableTimestamp(record.deletedAt, `forum posts[${index}].deletedAt`);
  const deleted = record.deleted === true || deletedAt !== null;
  if (deleted && !deletedAt) {
    deletedAt = timestamp(record.updatedAt, `forum posts[${index}].updatedAt`);
    report.normalizations.push({ kind: 'deleted_post_tombstone_time_inferred' });
  }
  const author = field(record, 'author');
  let content = '';
  if (!deleted) content = safeHtmlContent(record.content, `forum posts[${index}].content`, { normalizations: [] });
  else if (record.content !== undefined && record.content !== '') {
    content = safeHtmlContent(record.content, `forum posts[${index}].content`, { normalizations: [] });
  }
  return {
    id: uuid(record.id, `forum posts[${index}].id`),
    thread_id: uuid(record.threadId || threadId, `forum posts[${index}].threadId`),
    author_id: nullableUuid(record.authorId || field(author, 'id'), `forum posts[${index}].authorId`),
    author_label: optionalText(record.authorLabel, `forum posts[${index}].authorLabel`, { min: 0, max: 500 }) || null,
    content,
    edited: record.edited === true,
    post_no: integer(record.postNo, `forum posts[${index}].postNo`, { min: 1, max: 2_147_483_646 }),
    deleted_at: deletedAt,
    version: integer(record.version === undefined ? 1 : record.version, `forum posts[${index}].version`, { min: 1, max: 2_147_483_647 }),
    created_at: timestamp(record.createdAt, `forum posts[${index}].createdAt`),
    updated_at: timestamp(record.updatedAt, `forum posts[${index}].updatedAt`),
  };
}

function buildForumPlan(
  capture: CaptureResult,
  authors: Map<string, ResolvedAuthor>,
  report: PlanReport,
): ForumPlan {
  const categories: ForumCategoryRow[] = capture.dataset.forum.categories
    .map((raw, index) => validateForumCategory(raw, index));
  const categoryIds = new Set(categories.map((category) => category.id));
  if (categoryIds.size !== categories.length) {
    throw publicError('The capture contains duplicate forum categories.');
  }
  const threads: ThreadSeed[] = capture.dataset.forum.threads
    .map((raw, index) => validateThread(raw, index));
  const threadIds = new Set(threads.map((thread) => thread.id));
  if (threadIds.size !== threads.length) {
    throw publicError('The capture contains duplicate forum threads.');
  }
  for (const thread of threads) {
    if (!categoryIds.has(thread.category_id)) {
      throw publicError('A captured forum thread references a category missing from the dataset.');
    }
    if (thread.author_id && !authors.has(thread.author_id)) {
      throw publicError('A captured forum thread references an author that cannot be resolved.');
    }
    if (!thread.author_id && !thread.author_label) {
      throw publicError('A captured forum thread has no author attribution or label.');
    }
  }
  const posts: PostSeed[] = [];
  const postIds = new Set<string>();
  for (const thread of threads) {
    const threadPostsValue: unknown = capture.dataset.forum.postsByThread[thread.id] || [];
    if (!Array.isArray(threadPostsValue)) {
      throw publicError('A captured forum post collection is invalid.');
    }
    const threadPosts: unknown[] = threadPostsValue;
    const seenPostNumbers = new Set<number>();
    for (let index = 0; index < threadPosts.length; index += 1) {
      const post = validatePost(threadPosts[index], thread.id, index, report);
      if (post.thread_id !== thread.id) {
        throw publicError('A captured forum post references a different thread.');
      }
      if (post.author_id && !authors.has(post.author_id)) {
        throw publicError('A captured forum post references an author that cannot be resolved.');
      }
      if (!post.author_id && !post.author_label) {
        throw publicError('A captured forum post has no author attribution or label.');
      }
      if (seenPostNumbers.has(post.post_no)) {
        throw publicError('A captured forum thread has duplicate post numbers.');
      }
      seenPostNumbers.add(post.post_no);
      if (postIds.has(post.id)) throw publicError('The capture contains duplicate forum posts.');
      postIds.add(post.id);
      posts.push(post);
    }
  }
  for (const key of Object.keys(capture.dataset.forum.postsByThread)) {
    if (!threadIds.has(key)) {
      throw publicError('The capture contains posts for a thread missing from its inventory.');
    }
  }
  const threadRows: ThreadRow[] = threads.map((thread) => {
    const threadPosts = posts.filter((post) => post.thread_id === thread.id);
    const maximum = threadPosts.reduce((value, post) => Math.max(value, post.post_no), 1);
    return {
      ...thread,
      views: 0,
      next_post_no: maximum + 1,
      quarantined_at: null,
      quarantine_reason: null,
      legacy_reference: null,
    };
  });
  return {
    categories,
    threads: threadRows,
    posts: posts.map((post) => ({ ...post, legacy_reference: null })),
  };
}

export interface BuildImportPlanOptions {
  capture?: CaptureResult;
  testerPasswords?: TesterPasswords | null;
  passwordHasher?: (value: string) => unknown;
}

export function buildImportPlan({
  capture,
  testerPasswords = null,
  passwordHasher = (value: string) => bcrypt.hashSync(value, 10),
}: BuildImportPlanOptions = {}): ImportPlan {
  if (!capture || !capture.dataset || !capture.manifest) {
    throw new TypeError('buildImportPlan requires a verified capture.');
  }
  const report: PlanReport = { origin: capture.origin, normalizations: [] };
  const authors = buildAuthorIndex(capture, report);
  const users: UserRow[] = [];
  for (const author of authors.values()) users.push(userRowFromAuthor(author, capture));
  if (users.some((user) => user.username.toLowerCase() === RECONSTRUCTION_USERNAME)) {
    throw publicError('A public author username conflicts with the local reconstruction actor.');
  }
  users.push(reconstructionUserRow(capture));
  for (const spec of TESTER_SPECS) {
    if (users.some((user) => user.username.toLowerCase() === spec.username)) {
      throw publicError('A public author username conflicts with a synthetic sandbox tester account.');
    }
    const password = testerPasswords ? testerPasswords[spec.key] : null;
    if (password !== null && password !== undefined
        && (typeof password !== 'string' || password.length < 20 || password.length > 200)) {
      throw publicError('A generated synthetic tester password is invalid.');
    }
    let passwordHash: string | null = null;
    if (password) {
      let hashed: unknown;
      try {
        hashed = passwordHasher(password);
      } catch {
        throw publicError('The synthetic tester password could not be hashed.');
      }
      if (typeof hashed !== 'string' || !hashed) {
        throw publicError('The synthetic tester password hash is invalid.');
      }
      passwordHash = hashed;
    }
    users.push(testerUserRow(spec, capture, passwordHash));
  }

  const characters: CharacterRow[] = capture.dataset.characters.map((record, index) => (
    characterPlan(record, index, authors, capture, report)
  ));
  const scenes: ScenePlan[] = capture.dataset.scenes.map((record, index) => (
    scenePlan(record, index, authors, capture, report)
  ));
  const turnRowIds = new Set<string>();
  for (const scene of scenes) {
    for (const turn of scene.turns) {
      if (turnRowIds.has(turn.id)) {
        throw publicError('The capture contains scene turns with colliding local identifiers.');
      }
      turnRowIds.add(turn.id);
    }
  }
  const validatedSections: WikiSectionRow[] = capture.dataset.wikiSections
    .map((raw, index) => validateWikiSection(raw, index));
  const sectionKeys = new Set(validatedSections.map((section) => section.key));
  if (sectionKeys.size !== validatedSections.length) {
    throw publicError('The capture contains duplicate wiki sections.');
  }
  for (const section of validatedSections) {
    if (section.parent_key && !sectionKeys.has(section.parent_key)) {
      throw publicError('A captured wiki section references a parent missing from the dataset.');
    }
  }
  const pendingSections = validatedSections.slice();
  const sections: WikiSectionRow[] = [];
  while (pendingSections.length) {
    const index = pendingSections.findIndex((section) => (
      !section.parent_key || sections.some((inserted) => inserted.key === section.parent_key)
    ));
    if (index < 0) throw publicError('The captured wiki sections contain a parent cycle.');
    const [nextSection] = pendingSections.splice(index, 1);
    if (!nextSection) throw publicError('The captured wiki sections contain a parent cycle.');
    sections.push(nextSection);
  }
  const categories: WikiCategoryRow[] = capture.dataset.wikiCategories
    .map((raw, index) => validateWikiCategory(raw, index));
  const categoryKeys = new Set(categories.map((category) => category.key));
  if (categoryKeys.size !== categories.length) {
    throw publicError('The capture contains duplicate wiki categories.');
  }
  const wikiPages: WikiPagePlan[] = capture.dataset.wikiPages.map((record, index) => (
    wikiPagePlan(record, index, capture, report, RECONSTRUCTION_ID)
  ));
  if (!categories.length && wikiPages.some((page) => page.categories.length)) {
    throw publicError('The capture includes wiki categories on pages but no wiki category inventory.');
  }
  const threadIds = new Set<unknown>(capture.dataset.forum.threads.map((thread) => field(thread, 'id')));
  for (const page of wikiPages) {
    if (page.page.discussion_thread_id && !threadIds.has(page.page.discussion_thread_id)) {
      throw publicError('A captured wiki page references a discussion thread missing from the dataset.');
    }
    for (const category of page.categories) {
      if (categories.length && !categoryKeys.has(category.category_key)) {
        throw publicError('A captured wiki page uses a category missing from the wiki category inventory.');
      }
    }
  }
  const forum = buildForumPlan(capture, authors, report);

  const nameOwners = new Map<string, string>();
  for (const page of wikiPages) {
    for (const name of page.names) {
      const owner = nameOwners.get(name.name_key);
      if (owner !== undefined && owner !== page.page.id) {
        throw publicError('The capture assigns one wiki name to multiple pages.');
      }
      nameOwners.set(name.name_key, page.page.id);
    }
  }
  const localGaps: CaptureGap[] = [];
  for (const page of wikiPages) {
    for (const link of page.links) {
      if (!nameOwners.has(link.target_name_key)) {
        localGaps.push({
          family: 'wiki-links',
          endpoint: link.target_name_key,
          status: 0,
          reason: 'target wiki name is not present in the capture',
        });
      }
    }
  }

  const localStateOnly = report.normalizations.filter((item) => (
    item.kind === 'missing_author_fallback'
      || item.kind === 'public_author_role_not_imported'
      || item.kind === 'turn_author_role_not_imported'
  )).length;
  if (localStateOnly) {
    report.normalizations.push({ kind: 'local_identity_substitutions', count: localStateOnly });
  }

  const planCapture: PlanCapture = {
    captureId: capture.manifest.captureId,
    origin: capture.origin,
    capturedAt: capture.capturedAt,
    datasetSha256: capture.datasetSha256,
    complete: capture.manifest.consistency.complete && localGaps.length === 0,
    gaps: [...capture.manifest.gaps, ...localGaps],
    requestFiles: capture.requestFiles,
  };
  const testers: TesterSummary[] = TESTER_SPECS.map((spec) => ({
    key: spec.key,
    username: spec.username,
    role: spec.role,
    isStaff: spec.isStaff,
    id: deterministicUuid('eterverso-public-sandbox-testers', spec.key),
  }));
  const counts: PlanCounts = {
    users: users.length,
    publicAuthorPlaceholders: [...authors.values()].filter((author) => !author.fallback).length,
    missingAuthorFallbacks: [...authors.values()].filter((author) => author.fallback).length,
    characters: characters.length,
    scenes: scenes.length,
    sceneTurns: scenes.reduce((total, scene) => total + scene.turnCount, 0),
    wikiPages: wikiPages.length,
    wikiSections: sections.length,
    wikiCategories: categories.length,
    forumCategories: forum.categories.length,
    forumThreads: forum.threads.length,
    forumPosts: forum.posts.length,
    citations: 0,
  };
  return {
    capture: planCapture,
    users,
    characters,
    scenes,
    sections,
    categories,
    wikiPages,
    forum,
    testers,
    reconstructionActorId: RECONSTRUCTION_ID,
    normalizations: report.normalizations,
    counts,
    gaps: [...capture.manifest.gaps, ...localGaps].map((gap) => ({
      family: gap.family,
      endpoint: gap.endpoint,
      status: gap.status,
      reason: gap.reason,
    })),
  };
}
