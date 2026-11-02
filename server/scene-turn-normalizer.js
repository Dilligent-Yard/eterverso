'use strict';

const crypto = require('node:crypto');
const {
  hasMeaningfulContent,
  sanitizeHtmlWithReport,
  sanitizeUrl,
} = require('./content');
const { isPlainObject } = require('./validation');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CONTENT_LENGTH = 150_000;
const MAX_CONTENT_BYTES = 500_000;
const MAX_IMAGES = 20;
const TURN_KEYS = new Set([
  'id', 'authorId', 'authorName', 'authorRole', 'characterName', 'characterTitle',
  'characterAvatar', 'turnTitle', 'location', 'banner', 'bannerStyle', 'images',
  'content', 'oocNotes', 'accentColor', 'fontFamily', 'date', 'edited',
]);

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('JSON number is not finite.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!isPlainObject(value)) throw new TypeError('Value is not a plain JSON object.');
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function legacyDigest(turns) {
  // PostgreSQL JSONB no longer retains source whitespace or object-key order.
  // Hash its canonical value while preserving array and string contents.
  // Stream pieces to avoid allocating a second full-size copy of a large scene.
  const hash = crypto.createHash('sha256');
  function update(value) {
    if (value === null || typeof value === 'boolean' || typeof value === 'string') {
      hash.update(JSON.stringify(value), 'utf8');
      return;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new TypeError('JSON number is not finite.');
      hash.update(JSON.stringify(value), 'utf8');
      return;
    }
    if (Array.isArray(value)) {
      hash.update('[', 'utf8');
      value.forEach((item, index) => {
        if (index) hash.update(',', 'utf8');
        update(item);
      });
      hash.update(']', 'utf8');
      return;
    }
    if (!isPlainObject(value)) throw new TypeError('Value is not a plain JSON object.');
    hash.update('{', 'utf8');
    Object.keys(value).sort().forEach((key, index) => {
      if (index) hash.update(',', 'utf8');
      hash.update(JSON.stringify(key), 'utf8');
      hash.update(':', 'utf8');
      update(value[key]);
    });
    hash.update('}', 'utf8');
  }
  update(turns);
  return hash.digest('hex');
}

function valueType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function addIssue(issues, ordinal, reason, details = {}, blocking = false) {
  issues.push({ ordinal, reason, details, blocking });
}

function truncateCodePoints(value, maximum) {
  const characters = Array.from(value);
  return characters.length > maximum
    ? { value: characters.slice(0, maximum).join(''), truncated: true }
    : { value, truncated: false };
}

function safeText(value, field, maximum, ordinal, issues, options = {}) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') {
    addIssue(issues, ordinal, 'invalid_text_field', { field, valueType: valueType(value) });
    return '';
  }

  const cleaned = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  if (cleaned !== value) addIssue(issues, ordinal, 'control_characters_removed', { field });
  const shortened = truncateCodePoints(cleaned, maximum);
  if (shortened.truncated) addIssue(issues, ordinal, 'text_truncated', { field, maximum });
  if (options.trim) return shortened.value.trim();
  return shortened.value;
}

function parseLegacyId(turn, ordinal, issues) {
  if (!Object.hasOwn(turn, 'id')) return { value: null, blocking: false };
  const raw = turn.id;
  let value;
  if (typeof raw === 'string') value = raw;
  else if (typeof raw === 'number' && Number.isSafeInteger(raw)) value = String(raw);
  else {
    addIssue(issues, ordinal, 'malformed_legacy_id', { valueType: valueType(raw) }, true);
    return { value: null, blocking: true };
  }
  if (!value || Array.from(value).length > 80 || /[\u0000-\u001f\u007f]/.test(value)) {
    addIssue(issues, ordinal, 'malformed_legacy_id', { valueType: 'string' }, true);
    return { value: null, blocking: true };
  }
  return { value, blocking: false };
}

function safeImage(value, field, ordinal, issues) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') {
    addIssue(issues, ordinal, 'invalid_image_url', { field, valueType: valueType(value) });
    return '';
  }
  const safeUrl = sanitizeUrl(value, { image: true });
  if (!safeUrl) {
    addIssue(issues, ordinal, 'unsafe_image_url_removed', { field });
    return '';
  }
  return safeUrl;
}

function normalizeImages(value, ordinal, issues) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    addIssue(issues, ordinal, 'invalid_images_collection', { valueType: valueType(value) });
    return [];
  }
  if (value.length > MAX_IMAGES) {
    addIssue(issues, ordinal, 'images_truncated', { maximum: MAX_IMAGES });
  }

  const images = [];
  for (let index = 0; index < Math.min(value.length, MAX_IMAGES); index += 1) {
    const rawImage = value[index];
    const item = typeof rawImage === 'string' ? { url: rawImage, caption: '' } : rawImage;
    if (!isPlainObject(item)) {
      addIssue(issues, ordinal, 'invalid_image_removed', { field: 'images', index });
      continue;
    }
    const unknownKeys = Object.keys(item).filter((key) => !['url', 'caption'].includes(key));
    if (unknownKeys.length) {
      addIssue(issues, ordinal, 'unknown_image_fields_ignored', { field: 'images', index, count: unknownKeys.length });
    }
    if (!Object.hasOwn(item, 'url') || item.url === null || item.url === '') {
      addIssue(issues, ordinal, 'invalid_image_removed', { field: 'images', index, condition: 'missing_url' });
      continue;
    }
    const url = safeImage(item.url, `images.${index}.url`, ordinal, issues);
    if (!url) continue;
    const caption = safeText(item.caption, `images.${index}.caption`, 240, ordinal, issues);
    images.push({ url, caption });
  }
  return images;
}

function normalizeTurn(rawTurn, ordinal, duplicateIds) {
  const issues = [];
  let blocking = false;
  if (!isPlainObject(rawTurn)) {
    addIssue(issues, ordinal, 'malformed_turn', { valueType: valueType(rawTurn) }, true);
    return { issues, blocking: true, plan: null };
  }

  const id = parseLegacyId(rawTurn, ordinal, issues);
  blocking ||= id.blocking;
  if (id.value && duplicateIds.has(id.value)) {
    addIssue(issues, ordinal, 'duplicate_legacy_id', {}, true);
    blocking = true;
  }

  const rawContent = rawTurn.content;
  if (typeof rawContent !== 'string'
      || Array.from(rawContent).length < 1
      || Array.from(rawContent).length > MAX_CONTENT_LENGTH
      || rawContent.includes('\u0000')
      || /[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(rawContent)) {
    addIssue(issues, ordinal, 'unsafe_or_invalid_content', { valueType: valueType(rawContent) }, true);
    blocking = true;
  }

  let content = '';
  if (typeof rawContent === 'string' && !blocking) {
    try {
      const sanitized = sanitizeHtmlWithReport(rawContent, { maxBytes: MAX_CONTENT_BYTES });
      content = sanitized.html;
      if (sanitized.formattingLoss.discarded) {
        addIssue(issues, ordinal, 'content_formatting_sanitized', {
          discarded: sanitized.formattingLoss.items.map((item) => ({ kind: item.kind, name: item.name })),
        });
      }
      if (!hasMeaningfulContent(content, { maxBytes: MAX_CONTENT_BYTES })) {
        addIssue(issues, ordinal, 'empty_content_after_sanitization', {}, true);
        blocking = true;
      }
    } catch (_error) {
      addIssue(issues, ordinal, 'unsafe_or_invalid_content', { valueType: 'string' }, true);
      blocking = true;
    }
  }

  const label = safeText(rawTurn.authorName, 'authorName', 60, ordinal, issues) || null;
  let authorCandidate = null;
  if (Object.hasOwn(rawTurn, 'authorId') && rawTurn.authorId !== null) {
    if (typeof rawTurn.authorId === 'string' && UUID_RE.test(rawTurn.authorId)) {
      authorCandidate = rawTurn.authorId.toLowerCase();
    } else {
      addIssue(issues, ordinal, 'invalid_author_id', { valueType: valueType(rawTurn.authorId) });
    }
  }

  const presentation = {
    characterName: safeText(rawTurn.characterName, 'characterName', 100, ordinal, issues),
    characterTitle: safeText(rawTurn.characterTitle, 'characterTitle', 120, ordinal, issues),
    characterAvatar: safeImage(rawTurn.characterAvatar, 'characterAvatar', ordinal, issues),
    turnTitle: safeText(rawTurn.turnTitle, 'turnTitle', 160, ordinal, issues),
    location: safeText(rawTurn.location, 'location', 120, ordinal, issues),
    banner: safeImage(rawTurn.banner, 'banner', ordinal, issues),
    bannerStyle: ['panoramic', 'full', 'side'].includes(rawTurn.bannerStyle)
      ? rawTurn.bannerStyle
      : 'panoramic',
    images: normalizeImages(rawTurn.images, ordinal, issues),
    oocNotes: safeText(rawTurn.oocNotes, 'oocNotes', 4_000, ordinal, issues),
    accentColor: typeof rawTurn.accentColor === 'string'
      && /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(rawTurn.accentColor)
      ? rawTurn.accentColor.toLowerCase()
      : '',
    fontFamily: ['serif', 'sans', 'mono'].includes(rawTurn.fontFamily)
      ? rawTurn.fontFamily
      : 'serif',
    date: safeText(rawTurn.date, 'date', 80, ordinal, issues),
    edited: rawTurn.edited === true,
  };

  if (rawTurn.bannerStyle !== undefined && !['panoramic', 'full', 'side'].includes(rawTurn.bannerStyle)) {
    addIssue(issues, ordinal, 'invalid_presentation_style', { field: 'bannerStyle' });
  }
  if (rawTurn.fontFamily !== undefined && !['serif', 'sans', 'mono'].includes(rawTurn.fontFamily)) {
    addIssue(issues, ordinal, 'invalid_presentation_style', { field: 'fontFamily' });
  }
  if (rawTurn.accentColor !== undefined && rawTurn.accentColor !== '' && !/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(rawTurn.accentColor || '')) {
    addIssue(issues, ordinal, 'invalid_presentation_style', { field: 'accentColor' });
  }
  if (rawTurn.edited !== undefined && typeof rawTurn.edited !== 'boolean') {
    addIssue(issues, ordinal, 'invalid_legacy_flag', { field: 'edited', valueType: valueType(rawTurn.edited) });
  }
  if (Object.hasOwn(rawTurn, 'authorRole')) {
    addIssue(issues, ordinal, 'legacy_role_ignored', { field: 'authorRole' });
  }
  const unknownKeys = Object.keys(rawTurn).filter((key) => !TURN_KEYS.has(key));
  if (unknownKeys.length) {
    addIssue(issues, ordinal, 'unknown_turn_fields_ignored', { count: unknownKeys.length });
  }

  if (blocking) return { issues, blocking, plan: null };
  return {
    issues,
    blocking,
    plan: {
      scene_id: null,
      author_id: null,
      legacy_author_label: label,
      legacy_id: id.value,
      ordinal,
      content,
      presentation,
      version: 1,
      deleted_at: null,
    },
  };
}

async function prepareSceneTurns(tx, sceneId, turns) {
  const issues = [];
  if (!Array.isArray(turns)) {
    addIssue(issues, 0, 'turns_not_array', { valueType: valueType(turns) }, true);
    return { plans: [], issues, blocking: true };
  }

  const idOccurrences = new Map();
  // The source array index is the stable, zero-based legacy ordinal.
  turns.forEach((turn, ordinal) => {
    if (!isPlainObject(turn) || !Object.hasOwn(turn, 'id')) return;
    const parsed = parseLegacyId(turn, ordinal, []);
    if (parsed.value && !parsed.blocking) {
      idOccurrences.set(parsed.value, (idOccurrences.get(parsed.value) || 0) + 1);
    }
  });
  const duplicateIds = new Set([...idOccurrences].filter(([, count]) => count > 1).map(([id]) => id));

  const plans = [];
  const authorCandidates = new Set(turns.filter(isPlainObject)
    .filter((turn) => typeof turn.authorId === 'string' && UUID_RE.test(turn.authorId))
    .map((turn) => turn.authorId.toLowerCase()));
  let blocking = false;
  for (let ordinal = 0; ordinal < turns.length; ordinal += 1) {
    const normalized = normalizeTurn(turns[ordinal], ordinal, duplicateIds);
    issues.push(...normalized.issues);
    if (normalized.blocking) blocking = true;
    if (normalized.plan) {
      normalized.plan.scene_id = sceneId;
      plans.push(normalized.plan);
    }
  }

  const verifiedAuthors = new Set();
  if (authorCandidates.size) {
    const authorRows = await tx`
      SELECT id FROM users
      WHERE id = ANY(${tx.array([...authorCandidates], 2950)})`;
    for (const row of authorRows) verifiedAuthors.add(String(row.id).toLowerCase());
  }
  for (let ordinal = 0; ordinal < turns.length; ordinal += 1) {
    const raw = turns[ordinal];
    if (!isPlainObject(raw) || typeof raw.authorId !== 'string' || !UUID_RE.test(raw.authorId)) continue;
    const candidate = raw.authorId.toLowerCase();
    const plan = plans.find((item) => item.ordinal === ordinal);
    if (!verifiedAuthors.has(candidate)) {
      addIssue(issues, ordinal, 'unknown_author_id', { mapping: 'unresolved' });
    } else if (plan) {
      plan.author_id = candidate;
    }
  }

  return { plans, issues, blocking };
}

async function insertIssues(tx, sceneId, issues) {
  for (const issue of issues) {
    await tx`
      INSERT INTO scene_turn_migration_issues (scene_id, ordinal, reason, details)
      VALUES (${sceneId}, ${issue.ordinal}, ${issue.reason}, ${tx.json(issue.details)})
      ON CONFLICT (scene_id, ordinal, reason) DO NOTHING`;
  }
}

function sameJson(left, right) {
  try {
    return canonicalJson(left) === canonicalJson(right);
  } catch (_error) {
    return false;
  }
}

function matchesPlan(row, plan) {
  return String(row.scene_id) === plan.scene_id
    && String(row.author_id || '').toLowerCase() === String(plan.author_id || '').toLowerCase()
    && row.legacy_author_label === plan.legacy_author_label
    && row.legacy_id === plan.legacy_id
    && Number(row.ordinal) === plan.ordinal
    && row.content === plan.content
    && sameJson(row.presentation, plan.presentation)
    && Number(row.version) === plan.version
    && row.deleted_at === null;
}

async function reconcilePlans(tx, sceneId, plans) {
  const rows = await tx`
    SELECT scene_id, author_id, legacy_author_label, legacy_id, ordinal,
           content, presentation, version, deleted_at
    FROM scene_turns WHERE scene_id = ${sceneId}
    ORDER BY ordinal`;
  if (rows.length !== plans.length) return false;
  const byOrdinal = new Map(rows.map((row) => [Number(row.ordinal), row]));
  return plans.every((plan) => {
    const row = byOrdinal.get(plan.ordinal);
    return row && matchesPlan(row, plan);
  });
}

async function normalizeOneScene(sql, sceneId) {
  return sql.begin(async (tx) => {
    const rows = await tx`SELECT id, turns FROM wiki_posts WHERE id = ${sceneId} FOR UPDATE`;
    if (!rows.length) return { state: 'missing', turns: 0, issues: [] };
    const source = rows[0].turns;
    const digest = legacyDigest(source);

    await tx`
      INSERT INTO scene_turn_legacy_backups (scene_id, turns, legacy_sha256)
      VALUES (${sceneId}, ${tx.json(source)}, ${digest})
      ON CONFLICT (scene_id) DO NOTHING`;
    const backups = await tx`
      SELECT turns, legacy_sha256 FROM scene_turn_legacy_backups WHERE scene_id = ${sceneId}`;
    if (!backups.length) throw new Error('Scene-turn backup was not available after insert.');
    if (backups[0].legacy_sha256 !== digest || legacyDigest(backups[0].turns) !== digest) {
      const issues = [{ ordinal: 0, reason: 'source_changed_after_backup', details: { condition: 'backup_hash_differs' }, blocking: true }];
      await insertIssues(tx, sceneId, issues);
      return { state: 'incomplete', turns: 0, issues };
    }

    const migrations = await tx`
      SELECT turn_count, legacy_sha256 FROM scene_turn_migrations WHERE scene_id = ${sceneId}`;
    if (migrations.length && migrations[0].legacy_sha256 !== digest) {
      const issues = [{ ordinal: 0, reason: 'source_changed_after_normalization', details: { condition: 'migration_hash_differs' }, blocking: true }];
      await insertIssues(tx, sceneId, issues);
      return { state: 'incomplete', turns: 0, issues };
    }

    // A completed marker certifies the immutable legacy snapshot was imported
    // and reconciled. The child rows are now authoritative and may have been
    // appended, edited, or hidden through normal routes, so do not reconcile
    // them against the original source on later normalizer runs.
    if (migrations.length) {
      return { state: 'already-normalized', turns: Number(migrations[0].turn_count), issues: [] };
    }

    const prepared = await prepareSceneTurns(tx, sceneId, source);
    const rejectedOrdinals = new Set(prepared.issues.filter((issue) => issue.blocking).map((issue) => issue.ordinal));
    const plans = prepared.plans.filter((plan) => !rejectedOrdinals.has(plan.ordinal));

    const existingRows = await tx`
      SELECT scene_id, author_id, legacy_author_label, legacy_id, ordinal,
             content, presentation, version, deleted_at
      FROM scene_turns WHERE scene_id = ${sceneId}`;
    const occupiedOrdinals = new Map(existingRows.map((row) => [Number(row.ordinal), row]));
    const occupiedLegacyIds = new Map(existingRows.filter((row) => row.legacy_id !== null).map((row) => [row.legacy_id, Number(row.ordinal)]));
    const conflictOrdinals = new Set();
    for (const plan of plans) {
      const ordinalRow = occupiedOrdinals.get(plan.ordinal);
      const legacyOrdinal = plan.legacy_id === null ? undefined : occupiedLegacyIds.get(plan.legacy_id);
      if (ordinalRow && !matchesPlan(ordinalRow, plan)) {
        addIssue(prepared.issues, plan.ordinal, 'destination_ordinal_conflict', {}, true);
        conflictOrdinals.add(plan.ordinal);
      }
      if (legacyOrdinal !== undefined && legacyOrdinal !== plan.ordinal) {
        addIssue(prepared.issues, plan.ordinal, 'destination_legacy_id_conflict', {}, true);
        conflictOrdinals.add(plan.ordinal);
      }
    }
    const insertable = plans.filter((plan) => !conflictOrdinals.has(plan.ordinal));
    for (const plan of insertable) {
      await tx`
        INSERT INTO scene_turns (
          scene_id, author_id, legacy_author_label, legacy_id, ordinal,
          content, presentation, version, deleted_at
        ) VALUES (
          ${sceneId}, ${plan.author_id}, ${plan.legacy_author_label}, ${plan.legacy_id},
          ${plan.ordinal}, ${plan.content}, ${tx.json(plan.presentation)}, ${plan.version}, NULL
        )
        ON CONFLICT (scene_id, ordinal) DO NOTHING`;
    }
    await insertIssues(tx, sceneId, prepared.issues);

    if (prepared.blocking || conflictOrdinals.size) {
      return { state: 'incomplete', turns: insertable.length, issues: prepared.issues };
    }
    if (!await reconcilePlans(tx, sceneId, plans)) {
      const issue = { ordinal: 0, reason: 'normalization_reconciliation_failed', details: { condition: 'stored_rows_do_not_match_source' }, blocking: true };
      await insertIssues(tx, sceneId, [issue]);
      return { state: 'incomplete', turns: plans.length, issues: [...prepared.issues, issue] };
    }

    await tx`
      INSERT INTO scene_turn_migrations (scene_id, turn_count, legacy_sha256)
      VALUES (${sceneId}, ${plans.length}, ${digest})
      ON CONFLICT (scene_id) DO NOTHING`;
    const finalMarker = await tx`
      SELECT turn_count, legacy_sha256 FROM scene_turn_migrations WHERE scene_id = ${sceneId}`;
    if (!finalMarker.length || finalMarker[0].legacy_sha256 !== digest
        || Number(finalMarker[0].turn_count) !== plans.length) {
      const issue = { ordinal: 0, reason: 'migration_marker_conflict', details: { condition: 'marker_does_not_match_source' }, blocking: true };
      await insertIssues(tx, sceneId, [issue]);
      return { state: 'incomplete', turns: plans.length, issues: [...prepared.issues, issue] };
    }
    return { state: 'normalized', turns: plans.length, issues: prepared.issues };
  });
}

/** Normalize legacy JSONB turns one scene at a time; all mutations use injected sql. */
async function normalizeSceneTurns({ sql } = {}) {
  if (typeof sql !== 'function' || typeof sql.begin !== 'function' || typeof sql.json !== 'function') {
    throw new TypeError('normalizeSceneTurns requires a postgres.js SQL client.');
  }
  const sceneRows = await sql`SELECT id FROM wiki_posts ORDER BY id`;
  const report = {
    scenesScanned: sceneRows.length,
    scenesNormalized: 0,
    scenesAlreadyNormalized: 0,
    scenesIncomplete: 0,
    scenesMissing: 0,
    scenesFailed: 0,
    turnsNormalized: 0,
    issues: [],
  };

  for (const row of sceneRows) {
    const sceneId = String(row.id);
    let result;
    try {
      result = await normalizeOneScene(sql, sceneId);
    } catch (_error) {
      report.scenesFailed += 1;
      report.issues.push({ sceneId, ordinal: null, reason: 'scene_transaction_failed' });
      continue;
    }
    if (result.state === 'normalized') report.scenesNormalized += 1;
    else if (result.state === 'already-normalized') report.scenesAlreadyNormalized += 1;
    else if (result.state === 'missing') report.scenesMissing += 1;
    else report.scenesIncomplete += 1;
    report.turnsNormalized += result.turns;
    for (const issue of result.issues) {
      report.issues.push({ sceneId, ordinal: issue.ordinal, reason: issue.reason });
    }
  }
  return report;
}

module.exports = { normalizeSceneTurns };
