'use strict';

const express = require('express');
const { createHash, createHmac } = require('node:crypto');
const {
  hasMeaningfulContent,
  sanitizeBlocks,
  sanitizeHtmlWithReport,
  sanitizeUrl,
} = require('./content');
const { ApiError } = require('./errors');
const {
  MAX_POSTGRES_INTEGER,
  assertObjectShape,
  expectedVersion,
  isPlainObject,
  normalizeString,
  validateUuid,
} = require('./validation');

const RESOURCE_TYPES = Object.freeze(['categories', 'threads', 'posts', 'characters', 'scenes']);
const RESOURCE_NAMES = Object.freeze({
  categories: 'category', threads: 'thread', posts: 'post', characters: 'character', scenes: 'scene', turns: 'turn',
});
const MAX_BATCH_BYTES = 4 * 1024 * 1024;
const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
const MAX_BATCHES = 100;
const MAX_HTML_BYTES = 500_000;
const MAX_POST_BYTES = 1_000_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH_RE = /^[0-9a-f]{64}$/;
const UUID_NAMESPACE = Buffer.from('d4d8ef7f3cc65e40a1d6712a14aafe05', 'hex');

const LEGACY_FIELDS = Object.freeze({
  categories: new Set(['id', 'name', 'desc', 'description', 'date', 'createdAt', 'updatedAt']),
  threads: new Set(['id', 'catId', 'title', 'authorId', 'authorLabel', 'authorName', 'date', 'createdAt', 'updatedAt', 'tag', 'pinned', 'locked', 'archived', 'content']),
  posts: new Set(['id', 'threadId', 'authorId', 'authorLabel', 'authorName', 'date', 'createdAt', 'updatedAt', 'content', 'edited']),
  characters: new Set(['id', 'nome', 'name', 'categoria', 'category', 'titulo', 'title', 'raca', 'race', 'faccao', 'faction', 'status', 'imagem', 'image', 'descricao', 'description', 'stats', 'mascaraTier', 'skills', 'blocks', 'theme', 'authorId', 'authorLabel', 'authorName', 'date', 'createdAt', 'updatedAt']),
  scenes: new Set(['id', 'titulo', 'title', 'subtitulo', 'subtitle', 'categoria', 'category', 'status', 'resumo', 'summary', 'banner', 'descricao', 'description', 'theme', 'infobox', 'blocks', 'turns', 'authorId', 'authorLabel', 'authorName', 'date', 'createdAt', 'updatedAt', 'created_at', 'updated_at']),
  turns: new Set([
    'id', 'authorId', 'authorLabel', 'authorName', 'username', 'date', 'createdAt', 'updatedAt',
    'content', 'edited', 'blocks', 'characterName', 'characterTitle', 'characterAvatar',
    'turnTitle', 'location', 'banner', 'bannerStyle', 'oocNotes', 'accentColor', 'fontFamily',
  ]),
});
const AUTHOR_KEYS = new Set(['authorId', 'authorLabel', 'authorName']);
const TOP_LEVEL_FIELDS = new Set(['categories', 'attributionLabels', 'threads', 'posts', 'characters', 'scenes']);
const SECURITY_KEYS = /(^|_)(?:e?mail|password|passwd|passhash|hash|credential|token|secret|session|cookie|role|permission|privilege|auth|serverid|staff|admin|moderator)(_|$)/i;
const COUNTER_KEYS = /(^|_)(?:views?|posts?_count|postcount|threadcount|counter|count|next[a-z]*id|admtentativausada)(_|$)/i;
const THEME_FIELDS = new Set(['accentColor', 'bannerStyle', 'layout', 'fontFamily', 'bgEffect', 'bgm']);
const SKILL_FIELDS = new Set(['nome', 'name', 'descricao', 'description', 'tipo', 'type']);
const BLOCK_FIELDS = new Set(['type', 'title', 'items', 'cols', 'text', 'author', 'avatar', 'content']);
const BLOCK_ITEM_FIELDS = new Set(['label', 'content', 'url', 'caption', 'title', 'badge', 'color', 'image', 'desc', 'value', 'date']);
const INFOBOX_FIELDS = new Set(['show', 'title', 'image', 'caption', 'location', 'timeline', 'participants', 'fields']);
const INFOBOX_ITEM_FIELDS = new Set(['label', 'value', 'title', 'name', 'content']);

function apiError(status, code, message, details) { return new ApiError(status, code, message, details); }
function notFound() { return apiError(404, 'NOT_FOUND', 'O registro de importação não foi encontrado.'); }
function conflict(code, message) { return apiError(409, code, message); }
function asyncRoute(handler) { return (req, res, next) => Promise.resolve().then(() => handler(req, res)).catch(next); }

function stableStringify(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw apiError(400, 'INVALID_IMPORT_CONTENT', 'A importação contém um número inválido.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (!isPlainObject(value)) throw apiError(400, 'INVALID_IMPORT_CONTENT', 'A importação contém um valor inválido.');
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function sha256(value) { return createHash('sha256').update(value, 'utf8').digest('hex'); }

function deterministicUuid(namespaceName) {
  const digest = createHash('sha1').update(UUID_NAMESPACE).update(namespaceName, 'utf8').digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function nextVersion(value) {
  const version = Number(value);
  if (!Number.isInteger(version) || version < 1 || version >= MAX_POSTGRES_INTEGER) {
    throw conflict('VERSION_EXHAUSTED', 'Este trabalho de importação atingiu o limite de versões.');
  }
  return version + 1;
}

function checkVersion(actual, supplied) {
  if (Number(actual) !== supplied) throw conflict('STALE_VERSION', 'O trabalho de importação mudou. Atualize e tente novamente.');
}

function safeFieldName(key) {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

function rejectUnknownKeys(value, allowed, path) {
  if (!isPlainObject(value)) throw apiError(400, 'INVALID_IMPORT_CONTENT', `O conteúdo de ${path} deve ser um objeto.`);
  for (const key of Object.keys(value)) {
    const normalized = safeFieldName(key);
    if (SECURITY_KEYS.test(normalized)) {
      throw apiError(400, 'IMPORT_SECURITY_FIELD', `A importação contém um campo de segurança não permitido em ${path}.`);
    }
    if (COUNTER_KEYS.test(normalized)) {
      throw apiError(400, 'IMPORT_COUNTER_FIELD', `A importação contém um contador não permitido em ${path}.`);
    }
    if (!allowed.has(key)) {
      throw apiError(400, 'IMPORT_UNSUPPORTED_FIELD', `A importação contém um campo não permitido em ${path}.`);
    }
  }
}

function textValue(value, path, max, { allowEmpty = true, trim = false } = {}) {
  if (typeof value !== 'string') throw apiError(400, 'INVALID_IMPORT_CONTENT', `O campo ${path} deve ser texto.`);
  if (Buffer.byteLength(value, 'utf8') > max || Array.from(value).length > max
      || (!allowEmpty && value.length === 0) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
    throw apiError(400, 'INVALID_IMPORT_CONTENT', `O campo ${path} está fora dos limites permitidos.`);
  }
  return trim ? value.trim() : value;
}

function legacyId(value, path, { nullable = false } = {}) {
  if (value === null || value === undefined || value === '') {
    if (nullable) return null;
    throw apiError(400, 'INVALID_IMPORT_ID', `O identificador em ${path} é obrigatório.`);
  }
  let result;
  if (typeof value === 'string') result = value;
  else if (typeof value === 'number' && Number.isSafeInteger(value)) result = String(value);
  else throw apiError(400, 'INVALID_IMPORT_ID', `O identificador em ${path} é inválido.`);
  if (!result || Array.from(result).length > 80 || /[\u0000-\u001f\u007f]/u.test(result)) {
    throw apiError(400, 'INVALID_IMPORT_ID', `O identificador em ${path} é inválido.`);
  }
  return result;
}

function normalizeScalar(value, path, { max = 500_000, allowNumber = false, allowBoolean = false } = {}) {
  if (typeof value === 'string') return textValue(value, path, max);
  if (allowNumber && typeof value === 'number' && Number.isFinite(value)) return value;
  if (allowBoolean && typeof value === 'boolean') return value;
  if (value === null) return null;
  throw apiError(400, 'INVALID_IMPORT_CONTENT', `O campo ${path} possui um tipo inválido.`);
}

function normalizeThemeInput(value, path) {
  rejectUnknownKeys(value, THEME_FIELDS, path);
  const result = {};
  for (const [key, item] of Object.entries(value)) result[key] = normalizeScalar(item, `${path}.${key}`, { max: 600 });
  return result;
}

function normalizeStatsInput(value, path) {
  if (!isPlainObject(value)) throw apiError(400, 'INVALID_IMPORT_CONTENT', `O campo ${path} deve ser um objeto.`);
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (!/^[\p{L}\p{N}_ -]{1,80}$/u.test(key)) throw apiError(400, 'INVALID_IMPORT_CONTENT', `Uma chave de ${path} é inválida.`);
    const normalized = safeFieldName(key);
    if (SECURITY_KEYS.test(normalized) || COUNTER_KEYS.test(normalized)) {
      throw apiError(400, SECURITY_KEYS.test(normalized) ? 'IMPORT_SECURITY_FIELD' : 'IMPORT_COUNTER_FIELD', `A importação contém um campo não permitido em ${path}.`);
    }
    result[key] = normalizeScalar(item, `${path}.${key}`, { max: 500, allowNumber: true, allowBoolean: true });
  }
  return result;
}

function normalizeSimpleArray(value, fields, path) {
  if (!Array.isArray(value) || value.length > 1000) throw apiError(400, 'INVALID_IMPORT_CONTENT', `A lista ${path} é inválida.`);
  return value.map((item, index) => {
    rejectUnknownKeys(item, fields, `${path}[${index}]`);
    const result = {};
    for (const [key, nested] of Object.entries(item)) {
      result[key] = normalizeScalar(nested, `${path}[${index}].${key}`, { max: 500, allowNumber: true, allowBoolean: true });
    }
    return result;
  });
}

function normalizeInfoboxInput(value, path) {
  rejectUnknownKeys(value, INFOBOX_FIELDS, path);
  const result = {};
  for (const [key, nested] of Object.entries(value)) {
    if (key === 'participants') {
      if (!Array.isArray(nested) || nested.length > 100) throw apiError(400, 'INVALID_IMPORT_CONTENT', `A lista ${path}.participants é inválida.`);
      result[key] = nested.map((item, index) => textValue(item, `${path}.participants[${index}]`, 200));
    } else if (key === 'fields') {
      result[key] = normalizeSimpleArray(nested, INFOBOX_ITEM_FIELDS, `${path}.fields`);
    } else {
      result[key] = normalizeScalar(nested, `${path}.${key}`, { max: 1000, allowBoolean: true });
    }
  }
  return result;
}

function normalizeBlocksInput(value, path) {
  if (!Array.isArray(value) || value.length > 40) throw apiError(400, 'INVALID_IMPORT_CONTENT', `A lista ${path} é inválida.`);
  return value.map((item, index) => {
    rejectUnknownKeys(item, BLOCK_FIELDS, `${path}[${index}]`);
    const result = {};
    for (const [key, nested] of Object.entries(item)) {
      if (key === 'items') result[key] = normalizeSimpleArray(nested, BLOCK_ITEM_FIELDS, `${path}[${index}].items`);
      else result[key] = normalizeScalar(nested, `${path}[${index}].${key}`, { max: 500_000, allowNumber: true, allowBoolean: true });
    }
    return result;
  });
}

function normalizeRecord(type, record, path) {
  rejectUnknownKeys(record, LEGACY_FIELDS[type], path);
  const normalized = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === 'id') normalized.id = legacyId(value, `${path}.id`);
    else if (key === 'authorId') normalized.authorId = legacyId(value, `${path}.authorId`, { nullable: true });
    else if (key === 'catId' || key === 'threadId') normalized[key] = legacyId(value, `${path}.${key}`, { nullable: true });
    else if (['date', 'createdAt', 'updatedAt', 'created_at', 'updated_at'].includes(key)) {
      normalized[key] = value === null ? null : textValue(value, `${path}.${key}`, 1000);
    } else if (['pinned', 'locked', 'archived', 'edited'].includes(key)) {
      if (typeof value !== 'boolean') throw apiError(400, 'INVALID_IMPORT_CONTENT', `O campo ${path}.${key} deve ser booleano.`);
      normalized[key] = value;
    } else if (key === 'theme') normalized.theme = normalizeThemeInput(value, `${path}.theme`);
    else if (key === 'stats') normalized.stats = normalizeStatsInput(value, `${path}.stats`);
    else if (key === 'skills') normalized.skills = normalizeSimpleArray(value, SKILL_FIELDS, `${path}.skills`);
    else if (key === 'blocks') normalized.blocks = normalizeBlocksInput(value, `${path}.blocks`);
    else if (key === 'infobox') normalized.infobox = normalizeInfoboxInput(value, `${path}.infobox`);
    else if (key === 'turns') {
      if (!Array.isArray(value) || value.length > 10_000) throw apiError(400, 'INVALID_IMPORT_CONTENT', `A lista ${path}.turns é inválida.`);
      normalized.turns = value.map((turn, index) => normalizeRecord('turns', turn, `${path}.turns[${index}]`));
    } else if (key === 'items') normalized.items = normalizeSimpleArray(value, BLOCK_ITEM_FIELDS, `${path}.items`);
    else if (key === 'content' || key === 'descricao' || key === 'description') {
      normalized[key] = textValue(value, `${path}.${key}`, 500_000);
    } else if (key === 'value') normalized.value = normalizeScalar(value, `${path}.${key}`, { max: 500, allowNumber: true, allowBoolean: true });
    else if (typeof value === 'string') {
      const max = key === 'id' ? 80 : key.toLowerCase().includes('name') || key.toLowerCase().includes('title') || key === 'titulo' ? 300 : 1000;
      normalized[key] = textValue(value, `${path}.${key}`, max);
    } else if (value === null) normalized[key] = null;
    else if (typeof value === 'number' && Number.isFinite(value)) normalized[key] = value;
    else if (typeof value === 'boolean') normalized[key] = value;
    else throw apiError(400, 'INVALID_IMPORT_CONTENT', `O campo ${path}.${key} possui um tipo inválido.`);
  }
  return normalized;
}

function normalizeAttributionLabels(value) {
  if (!Array.isArray(value) || value.length > 100_000) {
    throw apiError(400, 'INVALID_IMPORT_CONTENT', 'A lista attributionLabels é inválida.');
  }
  const seen = new Set();
  return value.map((label, index) => {
    rejectUnknownKeys(label, new Set(['id', 'username']), `attributionLabels[${index}]`);
    const id = legacyId(label.id, `attributionLabels[${index}].id`);
    if (seen.has(id)) throw apiError(400, 'DUPLICATE_LEGACY_ID', 'A exportação contém identificadores de autoria duplicados.');
    seen.add(id);
    const username = textValue(label.username, `attributionLabels[${index}].username`, 120, { allowEmpty: false });
    return { id, username };
  });
}

function validateBatchPayload(value) {
  rejectUnknownKeys(value, TOP_LEVEL_FIELDS, 'batch');
  const payload = {};
  for (const type of RESOURCE_TYPES) {
    if (value[type] === undefined) continue;
    if (!Array.isArray(value[type]) || value[type].length > 100_000) {
      throw apiError(400, 'INVALID_IMPORT_CONTENT', `A lista ${type} é inválida.`);
    }
    payload[type] = value[type].map((record, index) => {
      if (!isPlainObject(record) || !Object.hasOwn(record, 'id')) {
        throw apiError(400, 'INVALID_IMPORT_ID', `O identificador em ${type}[${index}] é obrigatório.`);
      }
      return normalizeRecord(type, record, `${type}[${index}]`);
    });
  }
  if (value.attributionLabels !== undefined) payload.attributionLabels = normalizeAttributionLabels(value.attributionLabels);
  if (!Object.keys(payload).length) throw apiError(400, 'INVALID_IMPORT_CONTENT', 'O lote não contém listas de conteúdo.');
  return payload;
}

function validateJobStart(body) {
  assertObjectShape(body, {
    allowedKeys: ['sourceId', 'exportId', 'rawSnapshotSha256', 'legacyOrigin', 'batchCount'],
    requiredKeys: ['sourceId', 'exportId', 'rawSnapshotSha256', 'legacyOrigin', 'batchCount'],
  });
  const sourceId = validateUuid(body.sourceId, 'sourceId');
  const exportId = validateUuid(body.exportId, 'exportId');
  if (typeof body.rawSnapshotSha256 !== 'string' || !HASH_RE.test(body.rawSnapshotSha256)) {
    throw apiError(400, 'INVALID_VALUE', 'O hash do snapshot bruto é inválido.', { field: 'rawSnapshotSha256' });
  }
  const legacyOrigin = normalizeString(body.legacyOrigin, { field: 'legacyOrigin', min: 1, max: 200 });
  if (/[\u0000-\u001f\u007f]/u.test(legacyOrigin)) {
    throw apiError(400, 'INVALID_VALUE', 'A origem da exportação é inválida.', { field: 'legacyOrigin' });
  }
  if (!Number.isInteger(body.batchCount) || body.batchCount < 1 || body.batchCount > MAX_BATCHES) {
    throw apiError(400, 'INVALID_VALUE', 'A quantidade de lotes é inválida.', { field: 'batchCount', max: MAX_BATCHES });
  }
  return {
    sourceId, exportId, rawSnapshotSha256: body.rawSnapshotSha256,
    legacyOrigin, batchCount: body.batchCount,
  };
}

function jobDto(row, batchCount) {
  return {
    id: validateUuid(row.id),
    sourceId: validateUuid(row.source_id, 'sourceId'),
    exportId: validateUuid(row.export_id, 'exportId'),
    state: row.state,
    version: Number(row.version),
    batchCount: Number(row.batch_count),
    receivedBatches: batchCount === undefined ? undefined : batchCount,
    contentDigest: row.content_digest || null,
    planHash: row.plan_hash || null,
    importId: row.import_id ? validateUuid(row.import_id, 'importId') : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function batchNumber(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,2}$/.test(value)) {
    throw apiError(400, 'INVALID_BATCH_NUMBER', 'O número do lote é inválido.', { field: 'number' });
  }
  const number = Number(value);
  if (!Number.isInteger(number) || number > MAX_BATCHES) {
    throw apiError(400, 'INVALID_BATCH_NUMBER', 'O número do lote é inválido.', { field: 'number' });
  }
  return number;
}

function requestPayload(body) {
  const payload = validateBatchPayload(body);
  const serialized = stableStringify(payload);
  const bytes = Buffer.byteLength(serialized, 'utf8');
  if (bytes >= MAX_BATCH_BYTES) {
    throw apiError(413, 'IMPORT_BATCH_TOO_LARGE', 'Cada lote deve ter menos de 4 MB.', { field: 'batch' });
  }
  return { payload, serialized, bytes, hash: sha256(serialized) };
}

async function lockOwnedJob(tx, jobId, actorId) {
  const rows = await tx`
    SELECT * FROM legacy_import_jobs
    WHERE id = ${jobId} AND created_by = ${actorId}
    FOR UPDATE`;
  if (!rows.length) throw notFound();
  return rows[0];
}

async function batchRows(tx, jobId) {
  return tx`
    SELECT batch_number, batch_hash, payload
    FROM legacy_import_batches WHERE job_id = ${jobId}
    ORDER BY batch_number ASC`;
}

function verifiedBatch(row, batchCount) {
  if (!Number.isInteger(Number(row.batch_number)) || Number(row.batch_number) < 1
      || Number(row.batch_number) > batchCount) {
    throw conflict('IMPORT_BATCH_CORRUPT', 'Os lotes armazenados não correspondem ao manifesto.');
  }
  const payload = validateBatchPayload(row.payload);
  const serialized = stableStringify(payload);
  const digest = sha256(serialized);
  if (digest !== row.batch_hash) throw conflict('IMPORT_BATCH_CORRUPT', 'A integridade dos lotes armazenados não pôde ser confirmada.');
  return { number: Number(row.batch_number), payload, hash: digest, bytes: Buffer.byteLength(serialized, 'utf8') };
}

async function assembleContent(tx, job) {
  const storedRows = await batchRows(tx, job.id);
  const batches = storedRows.map((row) => verifiedBatch(row, Number(job.batch_count)));
  if (batches.length !== Number(job.batch_count)
      || batches.some((batch, index) => batch.number !== index + 1)) {
    throw conflict('IMPORT_BATCHES_INCOMPLETE', 'Envie todos os lotes declarados antes de gerar a prévia.');
  }
  const byteCount = batches.reduce((sum, batch) => sum + batch.bytes, 0);
  if (byteCount > MAX_IMPORT_BYTES) {
    throw apiError(413, 'IMPORT_TOO_LARGE', 'O conteúdo combinado da importação excede 20 MB.');
  }
  const content = {
    formatVersion: 1,
    categories: [], attributionLabels: [], threads: [], posts: [], characters: [], scenes: [],
  };
  for (const batch of batches) {
    for (const key of Object.keys(batch.payload)) content[key].push(...batch.payload[key]);
  }
  const canonical = stableStringify({
    formatVersion: content.formatVersion,
    categories: content.categories,
    attributionLabels: content.attributionLabels,
    threads: content.threads,
    posts: content.posts,
    characters: content.characters,
    scenes: content.scenes,
  });
  if (Buffer.byteLength(canonical, 'utf8') > MAX_IMPORT_BYTES) {
    throw apiError(413, 'IMPORT_TOO_LARGE', 'O conteúdo combinado da importação excede 20 MB.');
  }
  const digest = sha256(canonical);
  return { content, digest, bytes: Buffer.byteLength(canonical, 'utf8') };
}

function validateSelections(value, content) {
  assertObjectShape(value, {
    allowedKeys: RESOURCE_TYPES,
    requiredKeys: RESOURCE_TYPES,
    field: 'selections',
  });
  const selections = {};
  for (const type of RESOURCE_TYPES) {
    if (!Array.isArray(value[type])) throw apiError(400, 'INVALID_SELECTION', `A seleção de ${type} deve ser uma lista.`, { field: type });
    const ids = value[type].map((item, index) => {
      if (typeof item !== 'string') throw apiError(400, 'INVALID_SELECTION', 'Os identificadores selecionados devem ser textos.', { field: `${type}.${index}` });
      return legacyId(item, `${type}[${index}]`);
    });
    if (new Set(ids).size !== ids.length) throw apiError(400, 'INVALID_SELECTION', `A seleção de ${type} contém itens repetidos.`, { field: type });
    const known = new Set(content[type].map((record) => record.id));
    if (ids.some((id) => !known.has(id))) throw apiError(400, 'INVALID_SELECTION', `A seleção de ${type} contém um identificador ausente.`, { field: type });
    selections[type] = ids;
  }
  return selections;
}

function validateAuthorDecisions(value, referencedIds) {
  if (!isPlainObject(value)) throw apiError(400, 'INVALID_SHAPE', 'authorMappings deve ser um objeto.', { field: 'authorMappings' });
  const decisions = {};
  const referenced = new Set(referencedIds);
  for (const [legacyAuthorId, accountId] of Object.entries(value)) {
    const key = legacyId(legacyAuthorId, 'authorMappings key');
    if (!referenced.has(key)) throw apiError(400, 'INVALID_AUTHOR_MAPPING', 'A decisão de autoria não corresponde a um autor selecionado.', { field: 'authorMappings' });
    decisions[key] = accountId === null ? null : validateUuid(accountId, `authorMappings.${key}`);
  }
  for (const id of referenced) {
    if (!Object.hasOwn(decisions, id)) {
      throw apiError(400, 'AUTHOR_DECISION_REQUIRED', 'Confirme cada autoria selecionada: associe uma conta verificada ou mantenha o rótulo legado.', { field: `authorMappings.${id}` });
    }
  }
  return decisions;
}

async function verifyAccounts(tx, decisions) {
  const ids = [...new Set(Object.values(decisions).filter(Boolean))];
  if (!ids.length) return new Set();
  const rows = await tx`SELECT id FROM users WHERE id = ANY(${tx.array(ids, 2950)}) AND disabled_at IS NULL`;
  const existing = new Set(rows.map((row) => String(row.id).toLowerCase()));
  if (ids.some((id) => !existing.has(id))) {
    throw apiError(400, 'INVALID_AUTHOR_MAPPING', 'Uma conta escolhida para autoria não existe. Use o identificador explícito de uma conta verificada.');
  }
  return existing;
}

function labelFor(record, legacyAuthorId, labels) {
  const value = record.authorLabel || record.authorName || record.username
    || (legacyAuthorId && labels.get(legacyAuthorId))
    || (legacyAuthorId ? `Autoria legada (ID ${legacyAuthorId})` : null);
  if (value === null || value === undefined || value === '') return null;
  return textValue(value, 'authorLabel', 120);
}

function recordDates(record) {
  const created = record.date ?? record.createdAt ?? record.created_at ?? null;
  const updated = record.updatedAt ?? record.updated_at ?? null;
  return {
    created: created === null ? null : textValue(created, 'legacyCreatedAt', 1000),
    updated: updated === null ? null : textValue(updated, 'legacyUpdatedAt', 1000),
  };
}

function selectionReport(content, selections) {
  const report = {
    counts: {},
    imported: {},
    alreadyImported: {},
    excluded: [],
    unresolved: [],
    candidateDuplicates: [],
    missingParents: [],
    formattingChanges: [],
    urlChanges: [],
    failed: [],
  };
  for (const type of RESOURCE_TYPES) {
    report.counts[type] = content[type].length;
    report.imported[type] = 0;
    report.alreadyImported[type] = 0;
    const selected = new Set(selections[type]);
    for (const record of content[type]) {
      if (!selected.has(record.id)) report.excluded.push({ resourceType: RESOURCE_NAMES[type], legacyId: record.id, reason: 'not_selected' });
    }
  }
  report.counts.turns = content.scenes.reduce((sum, scene) => sum + (scene.turns || []).length, 0);
  report.imported.turns = 0;
  report.alreadyImported.turns = 0;
  return report;
}

function validateUniqueIds(content) {
  for (const type of RESOURCE_TYPES) {
    const seen = new Set();
    for (const row of content[type]) {
      if (seen.has(row.id)) throw apiError(400, 'DUPLICATE_LEGACY_ID', `A lista ${type} contém identificadores duplicados.`);
      seen.add(row.id);
    }
  }
  const labels = new Set();
  for (const label of content.attributionLabels) {
    if (labels.has(label.id)) throw apiError(400, 'DUPLICATE_LEGACY_ID', 'A lista de rótulos de autoria contém identificadores duplicados.');
    labels.add(label.id);
  }
  for (const scene of content.scenes) {
    const seen = new Set();
    for (const turn of scene.turns || []) {
      if (!turn.id) continue;
      if (seen.has(turn.id)) throw apiError(400, 'DUPLICATE_LEGACY_ID', 'Uma cena contém identificadores de turno duplicados.');
      seen.add(turn.id);
    }
  }
}

function selectedRecords(content, selections) {
  const result = {};
  for (const type of RESOURCE_TYPES) {
    const ids = new Set(selections[type]);
    result[type] = content[type].filter((record) => ids.has(record.id));
  }
  return result;
}

function authorReferences(records) {
  const ids = new Set();
  for (const type of RESOURCE_TYPES) {
    for (const record of records[type]) {
      if (record.authorId) ids.add(record.authorId);
      if (type === 'scenes') for (const turn of record.turns || []) if (turn.authorId) ids.add(turn.authorId);
    }
  }
  return [...ids].sort();
}

function formattingChange(report, type, id, field, formattingLoss) {
  if (!formattingLoss || !formattingLoss.discarded) return;
  report.formattingChanges.push({
    resourceType: RESOURCE_NAMES[type] || type,
    legacyId: id,
    field,
    discarded: true,
    items: formattingLoss.items.slice(0, 20).map((item) => ({ kind: item.kind, name: item.name })),
  });
}

function safeHtml(value, type, id, field, report, { maxLength = 250_000, allowEmpty = false } = {}) {
  if (typeof value !== 'string' || Array.from(value).length > maxLength) {
    throw apiError(400, 'INVALID_IMPORT_CONTENT', `O conteúdo ${field} está fora dos limites permitidos.`);
  }
  const result = sanitizeHtmlWithReport(value, { maxBytes: MAX_HTML_BYTES });
  formattingChange(report, type, id, field, result.formattingLoss);
  if (!allowEmpty && !hasMeaningfulContent(result.html, { maxBytes: MAX_HTML_BYTES })) {
    throw apiError(400, 'EMPTY_IMPORT_CONTENT', `O conteúdo ${field} não pode ficar vazio depois da validação.`);
  }
  return result.html;
}

function safeImage(value, type, id, field, report) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') throw apiError(400, 'INVALID_IMPORT_CONTENT', `A imagem ${field} é inválida.`);
  const safe = sanitizeUrl(value, { image: true });
  if (!safe) {
    report.urlChanges.push({ resourceType: RESOURCE_NAMES[type] || type, legacyId: id, field, action: 'removed' });
    return '';
  }
  if (safe !== value) report.urlChanges.push({ resourceType: RESOURCE_NAMES[type] || type, legacyId: id, field, action: 'normalized' });
  return safe;
}

function safeTheme(value, type, id, field, report) {
  const raw = value || {};
  const allowed = {
    bannerStyle: ['cinematic', 'standard', 'compact', 'none'],
    layout: ['sidebar-left', 'sidebar-right', 'full', 'book'],
    fontFamily: ['serif', 'sans', 'mono'],
    bgEffect: ['none', 'aura', 'grid', 'dots'],
  };
  const output = {
    accentColor: '', bannerStyle: 'cinematic', layout: 'sidebar-left',
    fontFamily: 'sans', bgEffect: 'none', bgm: '',
  };
  const color = raw.accentColor || '';
  if (color && (typeof color !== 'string' || !/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(color))) {
    throw apiError(400, 'INVALID_IMPORT_CONTENT', `A cor em ${field} é inválida.`);
  }
  output.accentColor = color.toLowerCase();
  for (const [key, choices] of Object.entries(allowed)) {
    if (raw[key] !== undefined && raw[key] !== '') {
      if (!choices.includes(raw[key])) throw apiError(400, 'INVALID_IMPORT_CONTENT', `A opção ${field}.${key} é inválida.`);
      output[key] = raw[key];
    }
  }
  if (raw.bgm !== undefined && raw.bgm !== '') {
    if (typeof raw.bgm !== 'string') throw apiError(400, 'INVALID_IMPORT_CONTENT', `O endereço em ${field}.bgm é inválido.`);
    const safe = sanitizeUrl(raw.bgm);
    if (!safe) report.urlChanges.push({ resourceType: RESOURCE_NAMES[type] || type, legacyId: id, field: `${field}.bgm`, action: 'removed' });
    else output.bgm = safe;
  }
  return output;
}

function safeStats(value, id, report) {
  const allowed = new Set(['ataque', 'destreza', 'defesa', 'reserva', 'controle', 'refino', 'emissao', 'alma', 'inteligencia', 'habilidade']);
  const result = {};
  for (const [key, item] of Object.entries(value || {})) {
    if (!allowed.has(key)) {
      report.formattingChanges.push({ resourceType: 'character', legacyId: id, field: 'stats', reason: 'unsupported_stat_key', count: 1 });
      continue;
    }
    if (item === null || item === '') continue;
    const number = typeof item === 'number' ? item : typeof item === 'string' && /^\s*\d+\s*$/.test(item) ? Number(item) : NaN;
    if (!Number.isFinite(number)) throw apiError(400, 'INVALID_IMPORT_CONTENT', `Um atributo do personagem ${id} não é numérico.`);
    const normalized = Math.max(0, Math.min(100, Math.trunc(number)));
    result[key] = normalized;
    if (normalized !== number) report.formattingChanges.push({ resourceType: 'character', legacyId: id, field: `stats.${key}`, reason: 'value_clamped' });
  }
  return result;
}

function safeSkills(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 60).map((skill) => {
    const nome = normalizeString(skill.nome || skill.name || '', { field: 'skills.nome', min: 0, max: 100 });
    const descricao = normalizeString(skill.descricao || skill.description || '', { field: 'skills.descricao', min: 0, max: 2000 });
    const tipo = skill.tipo === 'equipamento' || skill.type === 'equipment' ? 'equipamento' : 'skill';
    return { nome, descricao, tipo };
  }).filter((skill) => skill.nome || skill.descricao);
}

function safeInfobox(value, type, id, report) {
  const raw = value || {};
  const fields = Array.isArray(raw.fields) ? raw.fields : [];
  if (fields.length > 30) throw apiError(400, 'INVALID_IMPORT_CONTENT', 'A infobox excede o limite de campos.');
  const participants = Array.isArray(raw.participants) ? raw.participants : [];
  if (participants.length > 30) throw apiError(400, 'INVALID_IMPORT_CONTENT', 'A infobox excede o limite de participantes.');
  const image = safeImage(raw.image, type, id, 'infobox.image', report);
  return {
    show: raw.show !== false,
    title: normalizeString(raw.title || '', { field: 'infobox.title', min: 0, max: 120 }),
    image,
    caption: normalizeString(raw.caption || '', { field: 'infobox.caption', min: 0, max: 200 }),
    location: normalizeString(raw.location || '', { field: 'infobox.location', min: 0, max: 160 }),
    timeline: normalizeString(raw.timeline || '', { field: 'infobox.timeline', min: 0, max: 160 }),
    participants: participants.map((item) => normalizeString(item, { field: 'infobox.participants', min: 1, max: 100 })),
    fields: fields.map((item) => ({
      label: normalizeString(item.label || item.title || item.name || '', { field: 'infobox.fields.label', min: 0, max: 80 }),
      value: normalizeString(item.value || item.content || '', { field: 'infobox.fields.value', min: 0, max: 300 }),
    })).filter((item) => item.label || item.value),
  };
}

function safeBlocks(value) {
  try { return sanitizeBlocks(value || []); } catch (_error) {
    throw apiError(400, 'INVALID_IMPORT_BLOCKS', 'Um bloco de conteúdo não pôde ser validado.');
  }
}

function authorFor(record, decisions, labels) {
  const legacyAuthorId = record.authorId || null;
  const label = labelFor(record, legacyAuthorId, labels);
  return {
    authorId: legacyAuthorId ? decisions[legacyAuthorId] : null,
    authorLabel: label,
    legacyAuthorId,
  };
}

function validatedTitle(record, portugueseKey, englishKey, field, max) {
  const value = record[portugueseKey] === undefined ? record[englishKey] : record[portugueseKey];
  return normalizeString(value, { field, min: 1, max });
}

function normalizeCharacter(record, auth, digest, report) {
  if (!auth.authorId) {
    report.unresolved.push({ resourceType: 'character', legacyId: record.id, reason: 'verified_account_mapping_required' });
    report.excluded.push({ resourceType: 'character', legacyId: record.id, reason: 'author_unresolved' });
    return null;
  }
  const image = safeImage(record.imagem ?? record.image ?? '', 'character', record.id, 'image', report);
  const rawDescription = record.descricao === undefined ? record.description : record.descricao;
  const description = safeHtml(rawDescription || '', 'character', record.id, 'description', report, { maxLength: 250_000 });
  const fields = {
    nome: validatedTitle(record, 'nome', 'name', 'nome', 100),
    categoria: normalizeString(record.categoria ?? record.category ?? '', { field: 'categoria', min: 0, max: 50 }),
    titulo: normalizeString(record.titulo ?? record.title ?? '', { field: 'titulo', min: 0, max: 100 }),
    raca: normalizeString(record.raca ?? record.race ?? '', { field: 'raca', min: 0, max: 80 }),
    faccao: normalizeString(record.faccao ?? record.faction ?? '', { field: 'faccao', min: 0, max: 120 }),
    status: normalizeString(record.status || '', { field: 'status', min: 0, max: 80 }),
    imagem: image,
    descricao: description,
    stats: safeStats(record.stats || {}, record.id, report),
    skills: safeSkills(record.skills || []),
    mascaraTier: normalizeString(record.mascaraTier || '', { field: 'mascaraTier', min: 0, max: 60 }),
    blocks: safeBlocks(record.blocks || []),
    theme: safeTheme(record.theme, 'character', record.id, 'theme', report),
  };
  return {
    legacyId: record.id,
    targetId: deterministicUuid(`${digest}:character:${record.id}`),
    authorId: auth.authorId,
    authorLabel: auth.authorLabel,
    legacyCreatedAtText: recordDates(record).created,
    legacyUpdatedAtText: recordDates(record).updated,
    fields,
  };
}

function normalizeSceneTurn(turn, ordinal, sceneRecord, digest, decisions, labels, report) {
  const mappingLegacyId = turn.id || `ordinal:${sha256(`${sceneRecord.id}\u0000${ordinal}`).slice(0, 62)}`;
  const author = authorFor(turn, decisions, labels);
  try {
    const content = safeHtml(turn.content || '', 'turn', mappingLegacyId, 'content', report, { maxLength: 150_000 });
    const date = turn.date ?? turn.createdAt ?? turn.updatedAt ?? '';
    const presentation = {
      characterName: normalizeString(turn.characterName || '', { field: 'turn.characterName', min: 0, max: 100 }),
      characterTitle: normalizeString(turn.characterTitle || '', { field: 'turn.characterTitle', min: 0, max: 120 }),
      characterAvatar: safeImage(turn.characterAvatar || '', 'turn', mappingLegacyId, 'characterAvatar', report),
      turnTitle: normalizeString(turn.turnTitle || '', { field: 'turn.turnTitle', min: 0, max: 160 }),
      location: normalizeString(turn.location || '', { field: 'turn.location', min: 0, max: 120 }),
      banner: safeImage(turn.banner || '', 'turn', mappingLegacyId, 'banner', report),
      bannerStyle: ['panoramic', 'full', 'side'].includes(turn.bannerStyle) ? turn.bannerStyle : 'panoramic',
      images: [],
      oocNotes: normalizeString(turn.oocNotes || '', { field: 'turn.oocNotes', min: 0, max: 4000 }),
      accentColor: typeof turn.accentColor === 'string' && /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(turn.accentColor)
        ? turn.accentColor.toLowerCase() : '',
      fontFamily: ['serif', 'sans', 'mono'].includes(turn.fontFamily) ? turn.fontFamily : 'serif',
      date: textValue(date, 'turn.date', 80),
      edited: turn.edited === true,
    };
    if (turn.blocks && turn.blocks.length) presentation.blocks = safeBlocks(turn.blocks);
    return {
      legacyId: mappingLegacyId,
      scopedLegacyId: turn.id || null,
      targetId: deterministicUuid(`${digest}:turn:${mappingLegacyId}`),
      ordinal,
      content,
      presentation,
      authorId: author.authorId,
      authorLabel: author.authorLabel,
      legacyAuthorId: author.legacyAuthorId,
      legacyCreatedAtText: turn.date ?? turn.createdAt ?? null,
      legacyUpdatedAtText: turn.updatedAt ?? null,
    };
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    report.excluded.push({ resourceType: 'turn', legacyId: mappingLegacyId, parentLegacyId: sceneRecord.id, reason: error.publicCode });
    report.unresolved.push({ resourceType: 'turn', legacyId: mappingLegacyId, parentLegacyId: sceneRecord.id, reason: error.publicCode });
    return null;
  }
}

function normalizeScene(record, auth, digest, decisions, labels, report) {
  const title = validatedTitle(record, 'titulo', 'title', 'titulo', 200);
  const rawDescription = record.descricao === undefined ? record.description : record.descricao;
  const description = safeHtml(rawDescription || '', 'scene', record.id, 'description', report, { maxLength: 300_000 });
  const banner = safeImage(record.banner || '', 'scene', record.id, 'banner', report);
  const fields = {
    titulo: title,
    subtitulo: normalizeString(record.subtitulo ?? record.subtitle ?? '', { field: 'subtitulo', min: 0, max: 200 }),
    categoria: normalizeString(record.categoria ?? record.category ?? 'Cena de RPG', { field: 'categoria', min: 1, max: 80 }),
    status: normalizeString(record.status || 'Em Andamento', { field: 'status', min: 1, max: 80 }),
    resumo: normalizeString(record.resumo ?? record.summary ?? '', { field: 'resumo', min: 0, max: 1000 }),
    banner,
    descricao: description,
    theme: safeTheme(record.theme, 'scene', record.id, 'theme', report),
    infobox: safeInfobox(record.infobox, 'scene', record.id, report),
    blocks: safeBlocks(record.blocks || []),
    turns: [],
  };
  const turns = (record.turns || []).map((turn, ordinal) => normalizeSceneTurn(turn, ordinal, record, digest, decisions, labels, report)).filter(Boolean);
  fields.turns = turns.map((turn) => ({ legacyId: turn.scopedLegacyId, content: turn.content, presentation: turn.presentation }));
  return {
    legacyId: record.id,
    targetId: deterministicUuid(`${digest}:scene:${record.id}`),
    authorId: auth.authorId,
    authorLabel: auth.authorLabel,
    legacyCreatedAtText: recordDates(record).created,
    legacyUpdatedAtText: recordDates(record).updated,
    fields,
    turns,
  };
}

function importErrorCode(error) {
  return error && (error.publicCode || error.code) && /^[A-Z][A-Z0-9_]{1,63}$/.test(error.publicCode || error.code)
    ? (error.publicCode || error.code)
    : 'INVALID_IMPORT_CONTENT';
}

function normalizeCategory(record, digest) {
  const description = record.description === undefined ? record.desc : record.description;
  return {
    legacyId: record.id,
    targetId: deterministicUuid(`${digest}:category:${record.id}`),
    legacyCreatedAtText: recordDates(record).created,
    legacyUpdatedAtText: recordDates(record).updated,
    fields: {
      name: normalizeString(record.name, { field: 'category.name', min: 1, max: 100 }),
      description: normalizeString(description === undefined ? '' : description, { field: 'category.description', min: 0, max: 100_000 }),
    },
  };
}

function normalizeThread(record, auth, digest, labels, report) {
  const title = normalizeString(record.title, { field: 'thread.title', min: 1, max: 200 });
  const tag = normalizeString(record.tag === undefined ? '' : record.tag, { field: 'thread.tag', min: 0, max: 20 });
  const author = auth;
  return {
    legacyId: record.id,
    targetId: deterministicUuid(`${digest}:thread:${record.id}`),
    legacyCategoryId: record.catId || null,
    authorId: author.authorId,
    authorLabel: author.authorLabel,
    legacyCreatedAtText: recordDates(record).created,
    legacyUpdatedAtText: recordDates(record).updated,
    fields: {
      title,
      tag,
      pinned: record.pinned === true,
      locked: record.locked === true,
      archived: record.archived === true,
    },
  };
}

function normalizePost(record, auth, digest, report, sourceOrdinal) {
  const content = safeHtml(record.content || '', 'post', record.id, 'content', report, { maxLength: MAX_POST_BYTES });
  return {
    legacyId: record.id,
    targetId: deterministicUuid(`${digest}:post:${record.id}`),
    sourceOrdinal,
    legacyThreadId: record.threadId || null,
    authorId: auth.authorId,
    authorLabel: auth.authorLabel,
    legacyCreatedAtText: recordDates(record).created,
    legacyUpdatedAtText: recordDates(record).updated,
    fields: { content, edited: record.edited === true },
  };
}

function pushExcluded(report, type, id, reason, extra = {}) {
  report.excluded.push({ resourceType: RESOURCE_NAMES[type] || type, legacyId: id, reason, ...extra });
}

function pushFailure(report, type, id, error) {
  const reason = importErrorCode(error);
  report.failed.push({ resourceType: RESOURCE_NAMES[type] || type, legacyId: id, reason });
  pushExcluded(report, type, id, reason);
}

function plainClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function selectedAuthDecisions(content, selected, decisions, labels) {
  const result = {};
  for (const type of RESOURCE_TYPES) {
    for (const record of selected[type]) {
      const auth = authorFor(record, decisions, labels);
      result[`${RESOURCE_NAMES[type]}:${record.id}`] = auth;
      if (type === 'scenes') {
        for (const [ordinal, turn] of (record.turns || []).entries()) {
          const id = turn.id || `ordinal:${sha256(`${record.id}\u0000${ordinal}`).slice(0, 62)}`;
          result[`turn:${record.id}:${id}`] = authorFor(turn, decisions, labels);
        }
      }
    }
  }
  return result;
}

async function candidateDuplicateRows(tx, type, records) {
  if (!records.length) return [];
  const field = type === 'categories' ? 'name' : type === 'threads' ? 'title'
    : type === 'characters' ? 'nome' : type === 'scenes' ? 'titulo' : null;
  const table = type === 'categories' ? 'categories' : type === 'threads' ? 'threads'
    : type === 'characters' ? 'personagens' : type === 'scenes' ? 'wiki_posts' : null;
  if (!field || !table) return [];
  const values = [...new Set(records.map((item) => String(item.fields[field]).trim().toLocaleLowerCase('en-US')).filter(Boolean))];
  if (!values.length) return [];
  if (table === 'categories') return tx`
    SELECT id, name AS label FROM categories WHERE lower(name) = ANY(${tx.array(values, 25)}) ORDER BY id`;
  if (table === 'threads') return tx`
    SELECT id, title AS label FROM threads WHERE lower(title) = ANY(${tx.array(values, 25)}) ORDER BY id`;
  if (table === 'personagens') return tx`
    SELECT id, nome AS label FROM personagens WHERE lower(nome) = ANY(${tx.array(values, 25)}) ORDER BY id`;
  return tx`
    SELECT id, titulo AS label FROM wiki_posts WHERE lower(titulo) = ANY(${tx.array(values, 25)}) ORDER BY id`;
}

function sortForInsert(resources) {
  const categoryIds = new Set(resources.categories.map((item) => item.legacyId));
  const threadIds = new Set(resources.threads.map((item) => item.legacyId));
  const postIds = new Set(resources.posts.map((item) => item.legacyId));
  const sceneIds = new Set(resources.scenes.map((item) => item.legacyId));
  return {
    categoryIds, threadIds, postIds, sceneIds,
  };
}

function scopedTurnLegacyId(sceneId, turnId) {
  return `scene:${sha256(`${sceneId}\u0000${turnId}`).slice(0, 72)}`;
}

function pluralResourceType(type) {
  if (type === 'category') return 'categories';
  if (type === 'turn') return 'turns';
  return `${type}s`;
}

async function existingTargetIds(tx, type, ids) {
  if (!ids.length) return new Set();
  const array = tx.array(ids, 2950);
  const rows = type === 'categories' ? await tx`SELECT id FROM categories WHERE id = ANY(${array})`
    : type === 'threads' ? await tx`SELECT id FROM threads WHERE id = ANY(${array})`
      : type === 'posts' ? await tx`SELECT id FROM posts WHERE id = ANY(${array})`
        : type === 'characters' ? await tx`SELECT id FROM personagens WHERE id = ANY(${array})`
          : type === 'scenes' ? await tx`SELECT id FROM wiki_posts WHERE id = ANY(${array})`
            : await tx`SELECT id FROM scene_turns WHERE id = ANY(${array})`;
  return new Set(rows.map((row) => String(row.id).toLowerCase()));
}

function allPlanResources(resources) {
  const flattened = [];
  for (const type of RESOURCE_TYPES) {
    for (const item of resources[type] || []) flattened.push({ type: RESOURCE_NAMES[type], item });
  }
  for (const scene of resources.scenes || []) {
    for (const turn of scene.turns || []) flattened.push({ type: 'turn', item: turn, parent: scene });
  }
  return flattened;
}

function findLegacyMap(records, type, legacyId) {
  for (const { type: recordType, item } of records) {
    if (recordType === type && item.legacyId === legacyId) return item;
  }
  return null;
}

async function buildPreviewPlan(tx, job, content, selections, authorDecisions) {
  validateUniqueIds(content);
  const selected = selectedRecords(content, selections);
  const referencedAuthors = authorReferences(selected);
  const decisions = validateAuthorDecisions(authorDecisions, referencedAuthors);
  await verifyAccounts(tx, decisions);
  const labels = new Map(content.attributionLabels.map((item) => [item.id, item.username]));
  const report = selectionReport(content, selections);
  const resources = { categories: [], threads: [], posts: [], characters: [], scenes: [] };

  const categoryByLegacyId = new Map();
  for (const record of selected.categories) {
    try {
      const item = normalizeCategory(record, content.digest);
      resources.categories.push(item);
      categoryByLegacyId.set(record.id, item);
    } catch (error) { pushFailure(report, 'categories', record.id, error); }
  }

  const threadByLegacyId = new Map();
  for (const record of selected.threads) {
    if (!record.catId || !categoryByLegacyId.has(record.catId)) {
      report.missingParents.push({ resourceType: 'thread', legacyId: record.id, parentType: 'category', parentLegacyId: record.catId || null });
      pushExcluded(report, 'threads', record.id, 'category_not_selected_or_importable');
      continue;
    }
    try {
      const author = authorFor(record, decisions, labels);
      const item = normalizeThread(record, author, content.digest, labels, report);
      if (author.legacyAuthorId && !author.authorId) {
        report.unresolved.push({ resourceType: 'thread', legacyId: record.id, authorLegacyId: author.legacyAuthorId, reason: 'legacy_label_retained' });
      }
      resources.threads.push(item);
      threadByLegacyId.set(record.id, item);
    } catch (error) { pushFailure(report, 'threads', record.id, error); }
  }

  const firstPostByThread = new Map();
  const sourcePostOrdinalById = new Map();
  const sourcePostCountByThread = new Map();
  for (const record of content.posts) {
    if (record.threadId) {
      const ordinal = sourcePostCountByThread.get(record.threadId) || 0;
      sourcePostOrdinalById.set(record.id, ordinal);
      sourcePostCountByThread.set(record.threadId, ordinal + 1);
    }
    if (record.threadId && !firstPostByThread.has(record.threadId)) firstPostByThread.set(record.threadId, record.id);
  }
  for (const record of selected.posts) {
    if (!record.threadId || !threadByLegacyId.has(record.threadId)) {
      report.missingParents.push({ resourceType: 'post', legacyId: record.id, parentType: 'thread', parentLegacyId: record.threadId || null });
      pushExcluded(report, 'posts', record.id, 'thread_not_selected_or_importable');
      continue;
    }
    try {
      const item = normalizePost(record, authorFor(record, decisions, labels), content.digest, report, sourcePostOrdinalById.get(record.id));
      const author = authorFor(record, decisions, labels);
      if (author.legacyAuthorId && !author.authorId) {
        report.unresolved.push({ resourceType: 'post', legacyId: record.id, authorLegacyId: author.legacyAuthorId, reason: 'legacy_label_retained' });
      }
      resources.posts.push(item);
    } catch (error) { pushFailure(report, 'posts', record.id, error); }
  }

  const postCounts = new Map();
  for (const post of resources.posts) postCounts.set(post.legacyThreadId, (postCounts.get(post.legacyThreadId) || 0) + 1);
  const completeThreads = new Set();
  resources.threads = resources.threads.filter((thread) => {
    const openingPostId = firstPostByThread.get(thread.legacyId);
    const openingSelected = resources.posts.some((post) => post.legacyId === openingPostId);
    if (postCounts.get(thread.legacyId) && openingSelected) { completeThreads.add(thread.legacyId); return true; }
    pushExcluded(report, 'threads', thread.legacyId, openingPostId ? 'opening_post_not_selected_or_importable' : 'selected_opening_content_missing');
    return false;
  });
  resources.posts = resources.posts.filter((post) => {
    if (completeThreads.has(post.legacyThreadId)) return true;
    pushExcluded(report, 'posts', post.legacyId, 'thread_dependency_excluded');
    return false;
  });

  for (const record of selected.characters) {
    try {
      const item = normalizeCharacter(record, authorFor(record, decisions, labels), content.digest, report);
      if (item) resources.characters.push(item);
    } catch (error) { pushFailure(report, 'characters', record.id, error); }
  }

  for (const record of selected.scenes) {
    try {
      const item = normalizeScene(record, authorFor(record, decisions, labels), content.digest, decisions, labels, report);
      if (item.authorId === null && record.authorId) {
        report.unresolved.push({ resourceType: 'scene', legacyId: record.id, authorLegacyId: record.authorId, reason: 'legacy_label_retained' });
      }
      item.legacyTurns = plainClone(record.turns || []);
      item.turns = item.turns.map((turn) => {
        const legacyId = scopedTurnLegacyId(record.id, turn.legacyId);
        if (turn.legacyAuthorId && !turn.authorId) {
          report.unresolved.push({ resourceType: 'turn', legacyId, parentLegacyId: record.id, authorLegacyId: turn.legacyAuthorId, reason: 'legacy_label_retained' });
        }
        return { ...turn, legacyId, targetId: deterministicUuid(`${content.digest}:turn:${legacyId}`) };
      });
      resources.scenes.push(item);
    } catch (error) { pushFailure(report, 'scenes', record.id, error); }
  }

  for (const type of RESOURCE_TYPES) {
    if (type === 'categories') {
      const seenNames = new Map();
      for (const item of resources.categories) {
        const key = item.fields.name.toLowerCase();
        if (!seenNames.has(key)) seenNames.set(key, []);
        seenNames.get(key).push(item);
      }
      for (const duplicates of seenNames.values()) {
        if (duplicates.length < 2) continue;
        for (const item of duplicates) {
          report.failed.push({ resourceType: 'category', legacyId: item.legacyId, reason: 'DUPLICATE_CATEGORY_NAME' });
          pushExcluded(report, 'categories', item.legacyId, 'duplicate_category_name_in_snapshot');
        }
      }
    }
    const candidateRows = await candidateDuplicateRows(tx, type, resources[type]);
    const byLabel = new Map();
    for (const row of candidateRows) {
      const key = String(row.label || '').trim().toLocaleLowerCase('en-US');
      if (!byLabel.has(key)) byLabel.set(key, []);
      byLabel.get(key).push(String(row.id).toLowerCase());
    }
    for (const item of resources[type]) {
      const field = type === 'categories' ? 'name' : type === 'threads' ? 'title'
        : type === 'characters' ? 'nome' : type === 'scenes' ? 'titulo' : null;
      if (!field) continue;
      const matches = (byLabel.get(String(item.fields[field]).trim().toLocaleLowerCase('en-US')) || [])
        .filter((id) => id !== item.targetId.toLowerCase());
      for (const existingId of matches) {
        report.candidateDuplicates.push({ resourceType: RESOURCE_NAMES[type], legacyId: item.legacyId, existingId, field });
      }
      if (type === 'categories' && matches.length) {
        report.failed.push({ resourceType: 'category', legacyId: item.legacyId, reason: 'CATEGORY_NAME_CONFLICT' });
        pushExcluded(report, 'categories', item.legacyId, 'candidate_duplicate_requires_resolution');
        categoryByLegacyId.delete(item.legacyId);
      }
    }
  }

  const invalidCategoryIds = new Set(report.excluded.filter((item) => item.resourceType === 'category').map((item) => item.legacyId));
  resources.categories = resources.categories.filter((item) => !invalidCategoryIds.has(item.legacyId));
  const stillValidCategories = new Set(resources.categories.map((item) => item.legacyId));
  const invalidThreads = new Set();
  resources.threads = resources.threads.filter((item) => {
    if (stillValidCategories.has(item.legacyCategoryId)) return true;
    invalidThreads.add(item.legacyId);
    pushExcluded(report, 'threads', item.legacyId, 'category_dependency_excluded');
    return false;
  });
  const stillValidThreads = new Set(resources.threads.map((item) => item.legacyId));
  resources.posts = resources.posts.filter((item) => {
    if (stillValidThreads.has(item.legacyThreadId)) return true;
    pushExcluded(report, 'posts', item.legacyId, 'thread_dependency_excluded');
    return false;
  });

  const importedRows = await tx`SELECT id FROM legacy_imports WHERE content_digest = ${content.digest} LIMIT 1`;
  const existingImportId = importedRows.length ? String(importedRows[0].id).toLowerCase() : null;
  const priorTargets = existingImportId
    ? await tx`SELECT resource_type, legacy_id, target_id, author_id, author_label
      FROM legacy_import_targets WHERE import_id = ${existingImportId}`
    : [];
  const priorMap = new Map(priorTargets.map((row) => [`${row.resource_type}:${row.legacy_id}`, row]));

  for (const type of RESOURCE_TYPES) {
    const ids = resources[type].map((item) => item.targetId);
    const occupied = await existingTargetIds(tx, type, ids);
    for (const item of resources[type]) {
      const prior = priorMap.get(`${RESOURCE_NAMES[type]}:${item.legacyId}`);
      if (occupied.has(item.targetId.toLowerCase())
          && (!prior || String(prior.target_id).toLowerCase() !== item.targetId.toLowerCase())) {
        report.failed.push({ resourceType: RESOURCE_NAMES[type], legacyId: item.legacyId, reason: 'TARGET_ID_CONFLICT' });
        pushExcluded(report, type, item.legacyId, 'target_conflict_requires_resolution');
      }
    }
    const invalid = new Set(report.excluded.filter((item) => item.resourceType === RESOURCE_NAMES[type]).map((item) => item.legacyId));
    resources[type] = resources[type].filter((item) => !invalid.has(item.legacyId));
  }
  for (const scene of resources.scenes) {
    const occupied = await existingTargetIds(tx, 'turns', scene.turns.map((item) => item.targetId));
    scene.turns = scene.turns.filter((turn) => {
      const prior = priorMap.get(`turn:${turn.legacyId}`);
      if (!occupied.has(turn.targetId.toLowerCase())
          || (prior && String(prior.target_id).toLowerCase() === turn.targetId.toLowerCase())) return true;
      report.failed.push({ resourceType: 'turn', legacyId: turn.legacyId, reason: 'TARGET_ID_CONFLICT' });
      pushExcluded(report, 'turns', turn.legacyId, 'target_conflict_requires_resolution', { parentLegacyId: scene.legacyId });
      return false;
    });
  }

  const allResources = allPlanResources(resources);
  for (const { type, item } of allResources) {
    const existing = priorMap.get(`${type}:${item.legacyId}`);
    if (existing) {
      if (String(existing.target_id).toLowerCase() !== item.targetId.toLowerCase()
          || String(existing.author_id || '').toLowerCase() !== String(item.authorId || '').toLowerCase()
          || existing.author_label !== item.authorLabel) {
        report.failed.push({ resourceType: type, legacyId: item.legacyId, reason: 'CANONICAL_MAPPING_CONFLICT' });
        pushExcluded(report, type, item.legacyId, 'canonical_mapping_conflict');
      }
    }
  }

  const sourceMappings = await tx`SELECT resource_type, legacy_id, import_id, target_id
    FROM legacy_import_source_mappings WHERE source_id = ${job.source_id}`;
  const sourceMap = new Map(sourceMappings.map((row) => [`${row.resource_type}:${row.legacy_id}`, row]));
  for (const { type, item } of allResources) {
    const existing = sourceMap.get(`${type}:${item.legacyId}`);
    if (existing && (String(existing.import_id).toLowerCase() !== existingImportId
        || String(existing.target_id).toLowerCase() !== item.targetId.toLowerCase())) {
      report.failed.push({ resourceType: type, legacyId: item.legacyId, reason: 'SOURCE_MAPPING_CONFLICT' });
      pushExcluded(report, type, item.legacyId, 'source_mapping_conflict');
    }
  }

  for (const type of RESOURCE_TYPES) {
    const key = RESOURCE_NAMES[type];
    const excludedIds = new Set(report.excluded.filter((item) => item.resourceType === key).map((item) => item.legacyId));
    resources[type] = resources[type].filter((item) => !excludedIds.has(item.legacyId));
  }
  const failedTurns = new Set(report.excluded.filter((item) => item.resourceType === 'turn').map((item) => item.legacyId));
  for (const scene of resources.scenes) scene.turns = scene.turns.filter((turn) => !failedTurns.has(turn.legacyId));

  for (const type of RESOURCE_TYPES) {
    report.imported[type] = 0;
    report.alreadyImported[type] = 0;
    const resourceType = RESOURCE_NAMES[type];
    for (const item of resources[type]) {
      const plural = `${resourceType}:${item.legacyId}`;
      if (priorMap.has(plural)) report.alreadyImported[type] += 1;
      else report.imported[type] += 1;
    }
  }
  report.imported.turns = 0;
  report.alreadyImported.turns = 0;
  for (const scene of resources.scenes) {
    for (const turn of scene.turns) {
      if (priorMap.has(`turn:${turn.legacyId}`)) report.alreadyImported.turns += 1;
      else report.imported.turns += 1;
    }
  }

  return {
    plan: {
      formatVersion: 1,
      contentDigest: content.digest,
      sourceId: String(job.source_id).toLowerCase(),
      exportId: String(job.export_id).toLowerCase(),
      existingImportId,
      selections: plainClone(selections),
      authorMappings: plainClone(decisions),
      resources,
      report,
    },
    report,
  };
}

function batchCountFor(tx, jobId) {
  return tx`SELECT count(*)::integer AS count FROM legacy_import_batches WHERE job_id = ${jobId}`;
}

async function commitPlan(tx, actor, job, plan) {
  let importRows = await tx`SELECT id FROM legacy_imports WHERE content_digest = ${plan.contentDigest} FOR UPDATE`;
  let createdImport = false;
  if (!importRows.length) {
    importRows = await tx`
      INSERT INTO legacy_imports (
        content_digest, first_source_id, first_export_id, first_raw_snapshot_sha256,
        first_origin_label, imported_by
      ) VALUES (
        ${plan.contentDigest}, ${job.source_id}, ${job.export_id}, ${job.raw_snapshot_sha256},
        ${job.legacy_origin}, ${actor.id}
      )
      ON CONFLICT (content_digest) DO NOTHING
      RETURNING id`;
    createdImport = importRows.length > 0;
    if (!importRows.length) importRows = await tx`SELECT id FROM legacy_imports WHERE content_digest = ${plan.contentDigest} FOR UPDATE`;
  }
  if (!importRows.length) throw conflict('IMPORT_CANONICAL_CONFLICT', 'A identidade canônica da importação não pôde ser confirmada.');
  const importId = String(importRows[0].id).toLowerCase();
  const replayed = !createdImport;
  const flattened = allPlanResources(plan.resources);
  const existingTargetRows = await tx`
    SELECT resource_type, legacy_id, target_id, author_id, author_label,
      legacy_created_at_text, legacy_updated_at_text
    FROM legacy_import_targets WHERE import_id = ${importId} FOR UPDATE`;
  const targetMap = new Map(existingTargetRows.map((row) => [`${row.resource_type}:${row.legacy_id}`, row]));

  const byType = new Map();
  for (const { type, item } of flattened) {
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type).push(item);
  }
  const sourceMap = new Map();
  for (const [type, items] of byType) {
    const ids = [...new Set(items.map((item) => item.legacyId))];
    if (!ids.length) continue;
    const rows = await tx`
      SELECT resource_type, legacy_id, import_id, target_id
      FROM legacy_import_source_mappings
      WHERE source_id = ${job.source_id} AND resource_type = ${type}
        AND legacy_id = ANY(${tx.array(ids, 1043)})`;
    for (const row of rows) sourceMap.set(`${row.resource_type}:${row.legacy_id}`, row);
  }
  for (const { type, item } of flattened) {
    const canonical = targetMap.get(`${type}:${item.legacyId}`);
    if (canonical && (String(canonical.target_id).toLowerCase() !== item.targetId.toLowerCase()
        || String(canonical.author_id || '').toLowerCase() !== String(item.authorId || '').toLowerCase()
        || canonical.author_label !== item.authorLabel)) {
      throw conflict('IMPORT_TARGET_CONFLICT', 'Um mapeamento canônico existente não corresponde ao plano aprovado.');
    }
    const source = sourceMap.get(`${type}:${item.legacyId}`);
    if (source && (String(source.import_id).toLowerCase() !== importId
        || String(source.target_id).toLowerCase() !== item.targetId.toLowerCase())) {
      throw conflict('IMPORT_SOURCE_CONFLICT', 'Um identificador desta origem já aponta para outro conteúdo.');
    }
  }

  const report = plainClone(plan.report);
  for (const type of RESOURCE_TYPES) {
    report.imported[type] = 0;
    report.alreadyImported[type] = 0;
  }
  report.imported.turns = 0;
  report.alreadyImported.turns = 0;

  const targetIdsByType = {};
  for (const type of RESOURCE_TYPES) {
    const resourceType = RESOURCE_NAMES[type];
    const rows = await existingTargetIds(tx, type, plan.resources[type].map((item) => item.targetId));
    targetIdsByType[resourceType] = rows;
    for (const item of plan.resources[type]) {
      const key = `${resourceType}:${item.legacyId}`;
      const mapping = targetMap.get(key);
      const exists = rows.has(item.targetId.toLowerCase());
      if (mapping && !exists) throw conflict('IMPORT_TARGET_MISSING', 'Um alvo canônico do plano deixou de existir e requer revisão.');
      if (!mapping && exists) throw conflict('IMPORT_TARGET_CONFLICT', 'Um identificador de destino já pertence a outro registro.');
    }
  }
  for (const scene of plan.resources.scenes) {
    const turnRows = await existingTargetIds(tx, 'turns', scene.turns.map((item) => item.targetId));
    for (const item of scene.turns) {
      const mapping = targetMap.get(`turn:${item.legacyId}`);
      const exists = turnRows.has(item.targetId.toLowerCase());
      if (mapping && !exists) throw conflict('IMPORT_TARGET_MISSING', 'Um alvo canônico do plano deixou de existir e requer revisão.');
      if (!mapping && exists) throw conflict('IMPORT_TARGET_CONFLICT', 'Um identificador de destino já pertence a outro registro.');
    }
  }

  const categoryMap = new Map(plan.resources.categories.map((item) => [item.legacyId, item.targetId]));
  const threadMap = new Map(plan.resources.threads.map((item) => [item.legacyId, item.targetId]));
  for (const row of existingTargetRows) {
    if (row.resource_type === 'category') categoryMap.set(row.legacy_id, String(row.target_id).toLowerCase());
    if (row.resource_type === 'thread') threadMap.set(row.legacy_id, String(row.target_id).toLowerCase());
  }
  const newTargets = new Set();
  for (const type of RESOURCE_TYPES) {
    for (const item of plan.resources[type]) {
      if (!targetMap.has(`${RESOURCE_NAMES[type]}:${item.legacyId}`)) newTargets.add(`${RESOURCE_NAMES[type]}:${item.legacyId}`);
    }
  }
  for (const scene of plan.resources.scenes) {
    for (const item of scene.turns) if (!targetMap.has(`turn:${item.legacyId}`)) newTargets.add(`turn:${item.legacyId}`);
  }

  const existingThreadsToExtend = new Set();
  for (const item of plan.resources.posts) {
    if (!newTargets.has(`post:${item.legacyId}`)) continue;
    if (targetMap.has(`thread:${item.legacyThreadId}`)) {
      const threadId = threadMap.get(item.legacyThreadId);
      if (!threadId) throw conflict('IMPORT_DEPENDENCY_CHANGED', 'O tópico necessário não está disponível no plano aprovado.');
      existingThreadsToExtend.add(threadId);
    }
  }

  const hintedThreadRows = existingThreadsToExtend.size
    ? await tx`SELECT id, category_id FROM threads
      WHERE id = ANY(${tx.array([...existingThreadsToExtend], 2950)}) ORDER BY id`
    : [];
  if (hintedThreadRows.length !== existingThreadsToExtend.size) {
    throw conflict('IMPORT_TARGET_MISSING', 'Um tópico canônico do plano deixou de existir e requer revisão.');
  }
  const hintedCategoryByThread = new Map(hintedThreadRows.map((row) => [
    String(row.id).toLowerCase(), String(row.category_id).toLowerCase(),
  ]));

  const categoriesToLock = new Set(hintedThreadRows.map((row) => String(row.category_id).toLowerCase()));
  for (const item of plan.resources.threads) {
    if (!newTargets.has(`thread:${item.legacyId}`)
        || newTargets.has(`category:${item.legacyCategoryId}`)) continue;
    const categoryId = categoryMap.get(item.legacyCategoryId);
    if (!categoryId) throw conflict('IMPORT_DEPENDENCY_CHANGED', 'A categoria necessária não está disponível no plano aprovado.');
    categoriesToLock.add(categoryId);
  }
  const lockedCategoryRows = categoriesToLock.size
    ? await tx`SELECT id, archived_at FROM categories
      WHERE id = ANY(${tx.array([...categoriesToLock].sort(), 2950)}) ORDER BY id FOR UPDATE`
    : [];
  if (lockedCategoryRows.length !== categoriesToLock.size) {
    throw conflict('IMPORT_TARGET_MISSING', 'Uma categoria necessária deixou de existir e requer revisão.');
  }
  const lockedCategoryById = new Map(lockedCategoryRows.map((row) => [String(row.id).toLowerCase(), row]));

  for (const item of plan.resources.threads) {
    if (!newTargets.has(`thread:${item.legacyId}`)
        || newTargets.has(`category:${item.legacyCategoryId}`)) continue;
    const category = lockedCategoryById.get(categoryMap.get(item.legacyCategoryId));
    if (category?.archived_at) throw conflict('CATEGORY_ARCHIVED', 'A categoria está arquivada e não aceita alterações.');
  }

  const lockedThreadRows = existingThreadsToExtend.size
    ? await tx`SELECT id, category_id, locked, archived_at, quarantined_at FROM threads
      WHERE id = ANY(${tx.array([...existingThreadsToExtend].sort(), 2950)}) ORDER BY id FOR UPDATE`
    : [];
  if (lockedThreadRows.length !== existingThreadsToExtend.size) {
    throw conflict('IMPORT_TARGET_MISSING', 'Um tópico canônico do plano deixou de existir e requer revisão.');
  }
  for (const thread of lockedThreadRows) {
    const threadId = String(thread.id).toLowerCase();
    const categoryId = String(thread.category_id).toLowerCase();
    if (categoryId !== hintedCategoryByThread.get(threadId)) {
      throw conflict('IMPORT_TARGET_CONFLICT', 'A categoria do tópico mudou durante a importação; gere uma nova prévia.');
    }
    const category = lockedCategoryById.get(categoryId);
    if (!category) throw conflict('IMPORT_TARGET_MISSING', 'Uma categoria necessária deixou de existir e requer revisão.');
    if (category.archived_at) throw conflict('CATEGORY_ARCHIVED', 'A categoria está arquivada e não aceita alterações.');
    if (thread.quarantined_at) throw conflict('IMPORT_TARGET_CONFLICT', 'Um tópico em quarentena não pode receber conteúdo importado.');
    if (thread.locked) throw conflict('THREAD_LOCKED', 'A conversa está bloqueada e não aceita alterações.');
    if (thread.archived_at) throw conflict('THREAD_ARCHIVED', 'A conversa está arquivada e não aceita alterações.');
  }

  for (const item of plan.resources.categories) {
    const key = `category:${item.legacyId}`;
    if (!newTargets.has(key)) continue;
    await tx`INSERT INTO categories (id, name, description)
      VALUES (${item.targetId}, ${item.fields.name}, ${item.fields.description})`;
  }
  const lastPostNoByThread = new Map();
  for (const post of plan.resources.posts) {
    lastPostNoByThread.set(post.legacyThreadId, Math.max(lastPostNoByThread.get(post.legacyThreadId) || 0, post.sourceOrdinal + 1));
  }
  for (const item of plan.resources.threads) {
    const key = `thread:${item.legacyId}`;
    if (!newTargets.has(key)) continue;
    const categoryId = categoryMap.get(item.legacyCategoryId);
    if (!categoryId) throw conflict('IMPORT_DEPENDENCY_CHANGED', 'A categoria necessária não está disponível no plano aprovado.');
    const nextPostNo = (lastPostNoByThread.get(item.legacyId) || 0) + 1;
    if (nextPostNo < 2) throw conflict('IMPORT_DEPENDENCY_CHANGED', 'Um tópico selecionado não tem publicação de abertura.');
    await tx`INSERT INTO threads (
      id, category_id, author_id, author_label, legacy_reference, title, tag,
      pinned, locked, archived_at, version, next_post_no, last_activity_at
    ) VALUES (
      ${item.targetId}, ${categoryId}, ${item.authorId}, ${item.authorLabel},
      ${`${job.source_id}:${item.legacyId}`}, ${item.fields.title}, ${item.fields.tag},
      ${item.fields.pinned}, ${item.fields.locked}, CASE WHEN ${item.fields.archived} THEN now() ELSE NULL END,
      1, ${nextPostNo}, now()
    )`;
  }
  for (const item of plan.resources.posts) {
    const key = `post:${item.legacyId}`;
    if (!newTargets.has(key)) continue;
    const threadId = threadMap.get(item.legacyThreadId);
    if (!threadId) throw conflict('IMPORT_DEPENDENCY_CHANGED', 'O tópico necessário não está disponível no plano aprovado.');
    const postNo = item.sourceOrdinal + 1;
    await tx`INSERT INTO posts (
      id, thread_id, author_id, author_label, legacy_reference, content, edited, post_no
    ) VALUES (
      ${item.targetId}, ${threadId}, ${item.authorId}, ${item.authorLabel},
      ${`${job.source_id}:${item.legacyId}`}, ${item.fields.content}, ${item.fields.edited}, ${postNo}
    )`;
  }
  const threadsWithNewPosts = new Set(plan.resources.posts
    .filter((item) => newTargets.has(`post:${item.legacyId}`))
    .map((item) => threadMap.get(item.legacyThreadId))
    .filter(Boolean));
  for (const threadId of [...threadsWithNewPosts].sort()) {
    const maxRows = await tx`SELECT COALESCE(MAX(post_no)::bigint, 0)::text AS max_post_no
      FROM posts WHERE thread_id = ${threadId}`;
    const nextPostNo = Number(maxRows[0].max_post_no) + 1;
    if (!Number.isSafeInteger(nextPostNo) || nextPostNo > MAX_POSTGRES_INTEGER) {
      throw conflict('POST_SEQUENCE_EXHAUSTED', 'Esta conversa não pode receber novas publicações.');
    }
    await tx`UPDATE threads SET
        next_post_no = GREATEST(next_post_no, ${nextPostNo}),
        last_activity_at = now(), updated_at = now()
      WHERE id = ${threadId}`;
  }
  for (const item of plan.resources.characters) {
    const key = `character:${item.legacyId}`;
    if (!newTargets.has(key)) continue;
    const value = item.fields;
    await tx`INSERT INTO personagens (
      id, author_id, nome, categoria, titulo, raca, faccao, status, imagem, descricao,
      stats, skills, mascara_tier, blocks, theme
    ) VALUES (
      ${item.targetId}, ${item.authorId}, ${value.nome}, ${value.categoria}, ${value.titulo},
      ${value.raca}, ${value.faccao}, ${value.status}, ${value.imagem}, ${value.descricao},
      ${tx.json(value.stats)}, ${tx.json(value.skills)}, ${value.mascaraTier}, ${tx.json(value.blocks)}, ${tx.json(value.theme)}
    )`;
  }
  for (const item of plan.resources.scenes) {
    const key = `scene:${item.legacyId}`;
    if (!newTargets.has(key)) continue;
    const value = item.fields;
    const backup = item.legacyTurns || [];
    const legacyTurnDigest = sha256(stableStringify(backup));
    await tx`INSERT INTO wiki_posts (
      id, author_id, titulo, subtitulo, categoria, status, resumo, banner, descricao,
      theme, infobox, blocks, turns
    ) VALUES (
      ${item.targetId}, ${item.authorId}, ${value.titulo}, ${value.subtitulo}, ${value.categoria},
      ${value.status}, ${value.resumo}, ${value.banner}, ${value.descricao},
      ${tx.json(value.theme)}, ${tx.json(value.infobox)}, ${tx.json(value.blocks)}, ${tx.json(backup)}
    )`;
    await tx`INSERT INTO scene_turn_legacy_backups (scene_id, turns, legacy_sha256)
      VALUES (${item.targetId}, ${tx.json(backup)}, ${legacyTurnDigest})`;
    for (const turn of item.turns) {
      await tx`INSERT INTO scene_turns (
        id, scene_id, author_id, legacy_author_label, legacy_id, ordinal, content, presentation
      ) VALUES (
        ${turn.targetId}, ${item.targetId}, ${turn.authorId}, ${turn.authorLabel},
        ${turn.scopedLegacyId}, ${turn.ordinal}, ${turn.content}, ${tx.json(turn.presentation)}
      )`;
    }
    await tx`INSERT INTO scene_turn_migrations (scene_id, turn_count, legacy_sha256)
      VALUES (${item.targetId}, ${item.turns.length}, ${legacyTurnDigest})`;
  }

  for (const { type, item } of flattened) {
    const key = `${type}:${item.legacyId}`;
    const existing = targetMap.get(key);
    if (!existing) {
      await tx`INSERT INTO legacy_import_targets (
        import_id, resource_type, legacy_id, target_id, author_id, author_label,
        legacy_created_at_text, legacy_updated_at_text
      ) VALUES (
        ${importId}, ${type}, ${item.legacyId}, ${item.targetId}, ${item.authorId || null}, ${item.authorLabel || null},
        ${item.legacyCreatedAtText || null}, ${item.legacyUpdatedAtText || null}
      )`;
      report.imported[pluralResourceType(type)] += 1;
    } else report.alreadyImported[pluralResourceType(type)] += 1;
    if (!sourceMap.has(key)) {
      await tx`INSERT INTO legacy_import_source_mappings (source_id, resource_type, legacy_id, import_id, target_id)
        VALUES (${job.source_id}, ${type}, ${item.legacyId}, ${importId}, ${item.targetId})`;
    }
  }

  await tx`INSERT INTO legacy_import_provenance (
    import_id, source_id, export_id, raw_snapshot_sha256, origin_label, recorded_by
  ) VALUES (
    ${importId}, ${job.source_id}, ${job.export_id}, ${job.raw_snapshot_sha256}, ${job.legacy_origin}, ${actor.id}
  ) ON CONFLICT (import_id, source_id, raw_snapshot_sha256) DO NOTHING`;
  await tx`INSERT INTO audit_events (
    actor_id, action, target_type, target_id, reason, before_state, after_state
  ) VALUES (
    ${actor.id}, 'legacy-import.commit', 'legacy_import', ${importId}, 'Content-only legacy recovery import',
    ${tx.json({ state: job.state, contentDigest: plan.contentDigest })},
    ${tx.json({ state: replayed ? 'replay' : 'committed', importId, imported: report.imported, alreadyImported: report.alreadyImported })}
  )`;
  return { importId, report, replayed, state: replayed ? 'replay' : 'committed' };
}

function routeWithAdmin({ auth, sql }) {
  const router = express.Router();
  router.use(auth.requireIdentity, auth.requireRole('admin'));
  const withAdmin = (req, callback, options) => auth.withActorTransaction(req, (tx, actor) => {
    auth.assertRole(actor, 'admin');
    return callback(tx, actor);
  }, options);

  router.post('/legacy-imports', asyncRoute(async (req, res) => {
    const manifest = validateJobStart(req.body);
    const outcome = await withAdmin(req, async (tx, actor) => {
      const inserted = await tx`
        INSERT INTO legacy_import_jobs (
          created_by, source_id, export_id, raw_snapshot_sha256, legacy_origin, batch_count, state, version
        ) VALUES (
          ${actor.id}, ${manifest.sourceId}, ${manifest.exportId}, ${manifest.rawSnapshotSha256},
          ${manifest.legacyOrigin}, ${manifest.batchCount}, 'uploading', 1
        )
        ON CONFLICT (created_by, source_id, export_id) DO NOTHING
        RETURNING *`;
      let row = inserted[0];
      let replayed = false;
      if (!row) {
        const rows = await tx`
          SELECT * FROM legacy_import_jobs
          WHERE created_by = ${actor.id} AND source_id = ${manifest.sourceId} AND export_id = ${manifest.exportId}
          FOR UPDATE`;
        if (!rows.length) throw conflict('IMPORT_START_CONFLICT', 'O trabalho não pôde ser iniciado. Tente novamente.');
        row = rows[0];
        replayed = true;
        if (row.raw_snapshot_sha256 !== manifest.rawSnapshotSha256
            || row.legacy_origin !== manifest.legacyOrigin
            || Number(row.batch_count) !== manifest.batchCount) {
          throw conflict('IMPORT_MANIFEST_CONFLICT', 'Este par de origem e exportação já foi iniciado com outro manifesto.');
        }
      }
      const countRows = await batchCountFor(tx, row.id);
      return { row, count: Number(countRows[0].count), replayed };
    });
    return res.status(outcome.replayed ? 200 : 201).json({ data: jobDto(outcome.row, outcome.count), replayed: outcome.replayed });
  }));

  router.put('/legacy-imports/:id/batches/:number', asyncRoute(async (req, res) => {
    const jobId = validateUuid(req.params.id, 'id');
    const number = batchNumber(req.params.number);
    assertObjectShape(req.body, { allowedKeys: ['payload'], requiredKeys: ['payload'] });
    const batch = requestPayload(req.body.payload);
    const outcome = await withAdmin(req, async (tx, actor) => {
      const job = await lockOwnedJob(tx, jobId, actor.id);
      if (number > Number(job.batch_count)) throw apiError(400, 'INVALID_BATCH_NUMBER', 'O lote excede a quantidade declarada.', { field: 'number' });
      if (!['uploading', 'staged'].includes(job.state)) {
        throw conflict('IMPORT_BATCHES_FROZEN', 'Os lotes ficam imutáveis depois da prévia.');
      }
      const existing = await tx`
        SELECT batch_number, batch_hash, payload FROM legacy_import_batches
        WHERE job_id = ${job.id} AND batch_number = ${number}`;
      if (existing.length) {
        const verified = verifiedBatch(existing[0], Number(job.batch_count));
        if (verified.hash !== batch.hash) throw conflict('IMPORT_BATCH_CONFLICT', 'Este número de lote já contém outros dados.');
        return { job, replayed: true };
      }
      const currentRows = await batchRows(tx, job.id);
      const priorBytes = currentRows.reduce((sum, row) => sum + verifiedBatch(row, Number(job.batch_count)).bytes, 0);
      if (priorBytes + batch.bytes > MAX_IMPORT_BYTES) {
        throw apiError(413, 'IMPORT_TOO_LARGE', 'O conteúdo combinado da importação excede 20 MB.');
      }
      await tx`
        INSERT INTO legacy_import_batches (job_id, batch_number, batch_hash, payload)
        VALUES (${job.id}, ${number}, ${batch.hash}, ${tx.json(batch.payload)})`;
      const received = currentRows.length + 1;
      const state = received === Number(job.batch_count) ? 'staged' : 'uploading';
      const version = nextVersion(Number(job.version));
      const updated = await tx`
        UPDATE legacy_import_jobs SET state = ${state}, version = ${version}, updated_at = now()
        WHERE id = ${job.id} RETURNING *`;
      return { job: updated[0], replayed: false };
    });
    const countRows = await sql`SELECT count(*)::integer AS count FROM legacy_import_batches WHERE job_id = ${jobId}`;
    return res.status(outcome.replayed ? 200 : 201).json({ data: jobDto(outcome.job, Number(countRows[0].count)), replayed: outcome.replayed });
  }));

  router.post('/legacy-imports/:id/preview', asyncRoute(async (req, res) => {
    const jobId = validateUuid(req.params.id, 'id');
    assertObjectShape(req.body, {
      allowedKeys: ['expectedVersion', 'selections', 'authorMappings'],
      requiredKeys: ['expectedVersion', 'selections', 'authorMappings'],
    });
    const version = expectedVersion(req.body.expectedVersion);
    const result = await withAdmin(req, async (tx, actor) => {
      const job = await lockOwnedJob(tx, jobId, actor.id);
      checkVersion(job.version, version);
      if (!['staged', 'previewed'].includes(job.state) || job.committed_at) {
        throw conflict('IMPORT_NOT_PREVIEWABLE', 'Envie todos os lotes antes de gerar a prévia.');
      }
      const assembled = await assembleContent(tx, job);
      const selections = validateSelections(req.body.selections, assembled.content);
      const built = await buildPreviewPlan(tx, job, { ...assembled.content, digest: assembled.digest }, selections, req.body.authorMappings);
      const planHash = sha256(stableStringify(built.plan));
      const next = nextVersion(Number(job.version));
      const existingImport = Boolean(built.plan.existingImportId);
      const state = existingImport ? 'replay' : 'previewed';
      const updated = await tx`
        UPDATE legacy_import_jobs SET
          state = ${state}, version = ${next}, content_digest = ${assembled.digest}, plan_hash = ${planHash},
          plan = ${tx.json(built.plan)}, preview_report = ${tx.json(built.report)}, updated_at = now()
        WHERE id = ${job.id} RETURNING *`;
      return { job: updated[0], plan: built.plan, report: built.report };
    });
    return res.json({ data: { job: jobDto(result.job), planHash: result.job.plan_hash, contentDigest: result.job.content_digest, plan: result.plan, report: result.report } });
  }));

  router.post('/legacy-imports/:id/commit', asyncRoute(async (req, res) => {
    const jobId = validateUuid(req.params.id, 'id');
    assertObjectShape(req.body, {
      allowedKeys: ['expectedVersion', 'planHash'],
      requiredKeys: ['expectedVersion', 'planHash'],
    });
    const version = expectedVersion(req.body.expectedVersion);
    if (typeof req.body.planHash !== 'string' || !HASH_RE.test(req.body.planHash)) {
      throw apiError(400, 'INVALID_VALUE', 'O hash da prévia é inválido.', { field: 'planHash' });
    }
    const result = await withAdmin(req, async (tx, actor) => {
      const job = await lockOwnedJob(tx, jobId, actor.id);
      checkVersion(job.version, version);
      if (req.body.planHash !== job.plan_hash || !job.plan || sha256(stableStringify(job.plan)) !== job.plan_hash) {
        throw conflict('IMPORT_PLAN_CONFLICT', 'O plano informado não corresponde à prévia aprovada.');
      }
      if (job.committed_at && ['committed', 'replay'].includes(job.state)) {
        return { job, report: job.preview_report, replayed: true };
      }
      if (!['previewed', 'replay'].includes(job.state)) {
        throw conflict('IMPORT_NOT_PREVIEWED', 'Gere uma prévia válida antes de confirmar a importação.');
      }
      const assembled = await assembleContent(tx, job);
      if (assembled.digest !== job.content_digest || assembled.digest !== job.plan.contentDigest) {
        throw conflict('IMPORT_CONTENT_CHANGED', 'O conteúdo em estágio não corresponde ao plano aprovado.');
      }
      await verifyAccounts(tx, job.plan.authorMappings);
      const committed = await commitPlan(tx, actor, job, job.plan, assembled.content);
      const updated = await tx`
        UPDATE legacy_import_jobs SET state = ${committed.state}, version = ${nextVersion(Number(job.version))},
          import_id = ${committed.importId}, preview_report = ${tx.json(committed.report)}, committed_at = now(), updated_at = now()
        WHERE id = ${job.id} RETURNING *`;
      return { job: updated[0], report: committed.report, replayed: committed.replayed };
    });
    return res.json({ data: { job: jobDto(result.job), report: result.report, replayed: result.replayed } });
  }));

  return router;
}

function createLegacyImportRouter({ sql, auth } = {}) {
  if (typeof sql !== 'function' || typeof sql.begin !== 'function' || typeof sql.json !== 'function') {
    throw new TypeError('createLegacyImportRouter requires an injected postgres.js SQL client.');
  }
  for (const key of ['requireIdentity', 'requireRole', 'assertRole', 'withActorTransaction']) {
    if (!auth || typeof auth[key] !== 'function') throw new TypeError(`createLegacyImportRouter requires auth.${key}.`);
  }
  return routeWithAdmin({ sql, auth });
}

module.exports = {
  createLegacyImportRouter,
  stableStringify,
};
