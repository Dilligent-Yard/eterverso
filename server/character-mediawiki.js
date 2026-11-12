'use strict';

const express = require('express');
const fengari = require('fengari');
const { ApiError } = require('./errors');
const {
  MAX_CSS_BYTES,
  MAX_WIKITEXT_BYTES,
  normalizeResourceKey,
  renderCharacterWikitext,
  sanitizeScopedCss,
} = require('./mediawiki');
const {
  MAX_POSTGRES_INTEGER,
  assertObjectShape,
  expectedVersion,
  normalizeString,
  validateUuid,
} = require('./validation');

const ALLOWED_KINDS = new Set(['template', 'lua', 'css']);
const STAFF_ROLES = new Set(['admin', 'moderador']);
const route = (handler) => (req, res, next) => Promise.resolve().then(() => handler(req, res)).catch(next);

function validateLuaSyntax(source, name) {
  const { lua, lauxlib, to_luastring, to_jsstring } = fengari;
  const L = lauxlib.luaL_newstate();
  const rc = lauxlib.luaL_loadbuffer(L, to_luastring(source), source.length, to_luastring(`@Module:${name}`));
  if (rc !== lua.LUA_OK) {
    const errMsg = to_jsstring(lua.lua_tostring(L, -1)) || 'Erro de sintaxe Lua.';
    throw new ApiError(400, 'INVALID_LUA_SYNTAX', `Erro de sintaxe no módulo Lua: ${errMsg}`);
  }
}

function resourceDto(row) {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    nameKey: row.name_key,
    description: row.description || '',
    content: row.content || '',
    archivedAt: row.archived_at || null,
    version: Number(row.version) || 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function loadActiveCharacterMwResources(executor) {
  return executor`
    SELECT id, kind, name, name_key, description, content, archived_at, version, created_at, updated_at
    FROM character_mw_resources
    WHERE archived_at IS NULL
    ORDER BY kind ASC, lower(name) ASC, id ASC`;
}

function validateResourcePayload(kind, body, options = {}) {
  if (!ALLOWED_KINDS.has(kind)) {
    throw new ApiError(400, 'INVALID_RESOURCE_KIND', 'O tipo de recurso deve ser template, lua ou css.');
  }
  const name = normalizeString(body.name, { field: 'name', min: 1, max: 120 });
  const nameKey = normalizeResourceKey(name);
  if (!nameKey || nameKey.length > 120) {
    throw new ApiError(400, 'INVALID_RESOURCE_NAME', 'O nome do recurso MediaWiki é inválido.');
  }
  const description = body.description === undefined
    ? ''
    : normalizeString(body.description, { field: 'description', min: 0, max: 500 });
  const maxLen = kind === 'css' ? MAX_CSS_BYTES : MAX_WIKITEXT_BYTES;
  const content = normalizeString(body.content === undefined ? '' : body.content, {
    field: 'content',
    min: 0,
    max: maxLen,
    trim: false,
  });
  if (Buffer.byteLength(content, 'utf8') > maxLen) {
    throw new ApiError(400, 'CONTENT_TOO_LARGE', `O conteúdo excede o limite de ${maxLen} bytes.`);
  }
  if (kind === 'lua' && content.trim()) {
    validateLuaSyntax(content, name);
  }
  let diagnostics = [];
  if (kind === 'css' && content.trim() && options.checkCss !== false) {
    sanitizeScopedCss(content, '.char-mw-scope', { diagnostics, sourceLabel: `Estilo:${name}` });
  }
  return { kind, name, nameKey, description, content, diagnostics };
}

function createCharacterMediaWikiRouter({ sql, auth } = {}) {
  if (typeof sql !== 'function') {
    throw new TypeError('createCharacterMediaWikiRouter requires an injected postgres sql client.');
  }
  if (!auth || typeof auth.requireIdentity !== 'function' || typeof auth.requireRole !== 'function' || typeof auth.withActorTransaction !== 'function') {
    throw new TypeError('createCharacterMediaWikiRouter requires auth helpers.');
  }

  const router = express.Router();

  router.get('/personagens/mediawiki/resources', route(async (req, res) => {
    const kind = req.query && req.query.kind !== undefined ? String(req.query.kind) : '';
    const includeArchived = req.query && String(req.query.includeArchived) === 'true';
    if (kind && !ALLOWED_KINDS.has(kind)) {
      throw new ApiError(400, 'INVALID_RESOURCE_KIND', 'Filtro de tipo inválido.');
    }
    if (includeArchived) {
      const actor = await auth.readFreshIdentity(req);
      if (!actor || !STAFF_ROLES.has(actor.role)) {
        throw new ApiError(403, 'FORBIDDEN', 'Apenas a equipe pode consultar recursos arquivados.');
      }
    }
    const rows = await sql`
      SELECT id, kind, name, name_key, description, content, archived_at, version, created_at, updated_at
      FROM character_mw_resources
      WHERE (${includeArchived} OR archived_at IS NULL)
        AND (${kind === ''} OR kind = ${kind})
      ORDER BY kind ASC, lower(name) ASC, id ASC`;
    return res.json({ data: rows.map(resourceDto) });
  }));

  router.post('/personagens/mediawiki/resources', auth.requireIdentity, auth.requireRole('admin', 'moderador'), route(async (req, res) => {
    assertObjectShape(req.body, {
      allowedKeys: ['kind', 'name', 'description', 'content'],
      requiredKeys: ['kind', 'name', 'content'],
    });
    const parsed = validateResourcePayload(String(req.body.kind || ''), req.body);
    try {
      const created = await auth.withActorTransaction(req, async (tx, actor) => {
        auth.assertRole(actor, 'admin', 'moderador');
        const rows = await tx`
          INSERT INTO character_mw_resources (kind, name, name_key, description, content, created_by, updated_by)
          VALUES (${parsed.kind}, ${parsed.name}, ${parsed.nameKey}, ${parsed.description}, ${parsed.content}, ${actor.id}, ${actor.id})
          RETURNING *`;
        return rows[0];
      });
      return res.status(201).json({ data: resourceDto(created), diagnostics: parsed.diagnostics });
    } catch (err) {
      if (err && err.code === '23505') {
        throw new ApiError(409, 'RESOURCE_CONFLICT', 'Já existe um recurso MediaWiki com esse tipo e nome.');
      }
      throw err;
    }
  }));

  router.put('/personagens/mediawiki/resources/:id', auth.requireIdentity, auth.requireRole('admin', 'moderador'), route(async (req, res) => {
    const id = validateUuid(req.params.id);
    assertObjectShape(req.body, {
      allowedKeys: ['name', 'description', 'content', 'expectedVersion'],
      requiredKeys: ['name', 'content', 'expectedVersion'],
    });
    const version = expectedVersion(req.body.expectedVersion);
    try {
      const updated = await auth.withActorTransaction(req, async (tx, actor) => {
        auth.assertRole(actor, 'admin', 'moderador');
        const current = await tx`SELECT * FROM character_mw_resources WHERE id = ${id} FOR UPDATE`;
        if (!current.length) throw new ApiError(404, 'NOT_FOUND', 'Recurso MediaWiki não encontrado.');
        if (Number(current[0].version) !== version) {
          throw new ApiError(409, 'STALE_VERSION', 'O recurso mudou. Atualize e tente novamente.');
        }
        if (version >= MAX_POSTGRES_INTEGER) {
          throw new ApiError(409, 'VERSION_EXHAUSTED', 'O recurso atingiu o limite de versões.');
        }
        const parsed = validateResourcePayload(current[0].kind, req.body);
        const rows = await tx`
          UPDATE character_mw_resources
          SET name = ${parsed.name},
              name_key = ${parsed.nameKey},
              description = ${parsed.description},
              content = ${parsed.content},
              updated_by = ${actor.id},
              version = version + 1,
              updated_at = now()
          WHERE id = ${id} AND version = ${version}
          RETURNING *`;
        return { row: rows[0], diagnostics: parsed.diagnostics };
      });
      return res.json({ data: resourceDto(updated.row), diagnostics: updated.diagnostics });
    } catch (err) {
      if (err && err.code === '23505') {
        throw new ApiError(409, 'RESOURCE_CONFLICT', 'Já existe um recurso MediaWiki com esse tipo e nome.');
      }
      throw err;
    }
  }));

  router.post('/personagens/mediawiki/resources/:id/archive', auth.requireIdentity, auth.requireRole('admin', 'moderador'), route(async (req, res) => {
    const id = validateUuid(req.params.id);
    assertObjectShape(req.body, { allowedKeys: ['expectedVersion'], requiredKeys: ['expectedVersion'] });
    const version = expectedVersion(req.body.expectedVersion);
    const archived = await auth.withActorTransaction(req, async (tx, actor) => {
      auth.assertRole(actor, 'admin', 'moderador');
      const current = await tx`SELECT version, archived_at FROM character_mw_resources WHERE id = ${id} FOR UPDATE`;
      if (!current.length) throw new ApiError(404, 'NOT_FOUND', 'Recurso MediaWiki não encontrado.');
      if (Number(current[0].version) !== version) {
        throw new ApiError(409, 'STALE_VERSION', 'O recurso mudou. Atualize e tente novamente.');
      }
      if (version >= MAX_POSTGRES_INTEGER) {
        throw new ApiError(409, 'VERSION_EXHAUSTED', 'O recurso atingiu o limite de versões.');
      }
      const rows = await tx`
        UPDATE character_mw_resources
        SET archived_at = COALESCE(archived_at, now()),
            updated_by = ${actor.id},
            version = version + 1,
            updated_at = now()
        WHERE id = ${id} AND version = ${version}
        RETURNING *`;
      return rows[0];
    });
    return res.json({ data: resourceDto(archived) });
  }));

  router.post('/personagens/mediawiki/resources/:id/restore', auth.requireIdentity, auth.requireRole('admin', 'moderador'), route(async (req, res) => {
    const id = validateUuid(req.params.id);
    assertObjectShape(req.body, { allowedKeys: ['expectedVersion'], requiredKeys: ['expectedVersion'] });
    const version = expectedVersion(req.body.expectedVersion);
    const restored = await auth.withActorTransaction(req, async (tx, actor) => {
      auth.assertRole(actor, 'admin', 'moderador');
      const current = await tx`SELECT version, archived_at FROM character_mw_resources WHERE id = ${id} FOR UPDATE`;
      if (!current.length) throw new ApiError(404, 'NOT_FOUND', 'Recurso MediaWiki não encontrado.');
      if (Number(current[0].version) !== version) {
        throw new ApiError(409, 'STALE_VERSION', 'O recurso mudou. Atualize e tente novamente.');
      }
      if (version >= MAX_POSTGRES_INTEGER) {
        throw new ApiError(409, 'VERSION_EXHAUSTED', 'O recurso atingiu o limite de versões.');
      }
      const rows = await tx`
        UPDATE character_mw_resources
        SET archived_at = NULL,
            updated_by = ${actor.id},
            version = version + 1,
            updated_at = now()
        WHERE id = ${id} AND version = ${version}
        RETURNING *`;
      return rows[0];
    });
    return res.json({ data: resourceDto(restored) });
  }));

  router.post('/personagens/mediawiki/preview', auth.requireIdentity, route(async (req, res) => {
    assertObjectShape(req.body, {
      allowedKeys: ['wikitext', 'customCss', 'character', 'scopeSelector', 'resourceOverride'],
    });
    const wikitext = req.body.wikitext === undefined ? '' : normalizeString(req.body.wikitext, { field: 'wikitext', min: 0, max: MAX_WIKITEXT_BYTES, trim: false });
    const customCss = req.body.customCss === undefined ? '' : normalizeString(req.body.customCss, { field: 'customCss', min: 0, max: MAX_CSS_BYTES, trim: false });
    let scopeSelector = '.char-mw-scope';
    if (req.body.scopeSelector !== undefined) {
      const rawScope = normalizeString(req.body.scopeSelector, { field: 'scopeSelector', min: 1, max: 80 });
      if (!/^\.[a-zA-Z_-][a-zA-Z0-9_-]*$/.test(rawScope)) {
        throw new ApiError(400, 'INVALID_SCOPE', 'O seletor de escopo da prévia é inválido.');
      }
      scopeSelector = rawScope;
    }

    const characterInput = req.body.character && typeof req.body.character === 'object' && !Array.isArray(req.body.character)
      ? req.body.character : {};
    const character = {};
    for (const key of ['nome', 'categoria', 'titulo', 'raca', 'faccao', 'status', 'mascaraTier']) {
      if (typeof characterInput[key] === 'string') {
        character[key] = characterInput[key].trim().slice(0, 120);
      }
    }

    const resources = (await loadActiveCharacterMwResources(sql)).map((row) => ({
      kind: row.kind,
      name: row.name,
      nameKey: row.name_key,
      content: row.content,
    }));

    if (req.body.resourceOverride !== undefined) {
      const actor = await auth.readFreshIdentity(req);
      if (!actor || !STAFF_ROLES.has(actor.role)) {
        throw new ApiError(403, 'FORBIDDEN', 'Apenas a equipe pode simular recursos MediaWiki não salvos.');
      }
      assertObjectShape(req.body.resourceOverride, {
        allowedKeys: ['kind', 'name', 'content'],
        requiredKeys: ['kind', 'name', 'content'],
      });
      const override = validateResourcePayload(String(req.body.resourceOverride.kind || ''), req.body.resourceOverride, { checkCss: false });
      const filtered = resources.filter((item) => !(item.kind === override.kind && item.nameKey === override.nameKey));
      filtered.push({
        kind: override.kind,
        name: override.name,
        nameKey: override.nameKey,
        content: override.content,
      });
      resources.splice(0, resources.length, ...filtered);
    }

    const rendered = renderCharacterWikitext({
      wikitext,
      customCss,
      scopeSelector,
      resources,
      character,
    });
    return res.json(rendered);
  }));

  return router;
}

module.exports = {
  createCharacterMediaWikiRouter,
  loadActiveCharacterMwResources,
};
