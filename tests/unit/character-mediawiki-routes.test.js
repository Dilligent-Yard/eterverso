'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const express = require('express');
const cookieSession = require('cookie-session');
const { createAuth, createCookieSessionOptions } = require('../../server/auth');
const { createApp } = require('../../server/app');
const { errorMiddleware } = require('../../server/errors');

function makeMockSql() {
  const users = new Map();
  const mwResources = new Map();
  const characters = new Map();

  function addUser(role = 'moderador') {
    const id = randomUUID();
    users.set(id, {
      id,
      username: role === 'member' ? 'leitor' : 'staffer',
      username_key: role === 'member' ? 'leitor' : 'staffer',
      role,
      auth_version: 1,
      bio: '',
      avatar: '',
      disabled_at: null,
      created_at: new Date().toISOString(),
    });
    return id;
  }

  function runQuery(queryText, params) {
    const normalized = queryText.replace(/\s+/g, ' ').trim();

    if (normalized.includes('FROM users') && normalized.includes('WHERE id =')) {
      const user = users.get(params[0]);
      if (!user || user.disabled_at) return [];
      return [user];
    }

    if (normalized.startsWith("SELECT set_config('app.current_user_id'") || normalized === 'SELECT 1') {
      return [{ ok: 1 }];
    }

    if (normalized.includes('FROM character_mw_resources') && normalized.includes('WHERE (') && normalized.includes('archived_at IS NULL')) {
      const includeArchived = Boolean(params[0]);
      const noKindFilter = Boolean(params[1]);
      const kind = params[2];
      return [...mwResources.values()]
        .filter((row) => (includeArchived || !row.archived_at) && (noKindFilter || row.kind === kind));
    }

    if (normalized.includes('FROM character_mw_resources') && normalized.includes('WHERE archived_at IS NULL')) {
      return [...mwResources.values()].filter((row) => !row.archived_at);
    }

    if (normalized.includes('INSERT INTO character_mw_resources')) {
      const [kind, name, nameKey, description, content, createdBy, updatedBy] = params;
      for (const existing of mwResources.values()) {
        if (existing.kind === kind && existing.name_key === nameKey) {
          const dupErr = new Error('duplicate key');
          dupErr.code = '23505';
          throw dupErr;
        }
      }
      const id = randomUUID();
      const now = new Date().toISOString();
      const row = {
        id,
        kind,
        name,
        name_key: nameKey,
        description,
        content,
        archived_at: null,
        version: 1,
        created_by: createdBy,
        updated_by: updatedBy,
        created_at: now,
        updated_at: now,
      };
      mwResources.set(id, row);
      return [row];
    }

    if (normalized.startsWith('SELECT * FROM character_mw_resources WHERE id =')) {
      const row = mwResources.get(params[0]);
      return row ? [row] : [];
    }

    if (normalized.startsWith('SELECT version, archived_at FROM character_mw_resources WHERE id =')) {
      const row = mwResources.get(params[0]);
      return row ? [{ version: row.version, archived_at: row.archived_at }] : [];
    }

    if (normalized.startsWith('UPDATE character_mw_resources SET name =')) {
      const [name, nameKey, description, content, updatedBy, id, version] = params;
      const row = mwResources.get(id);
      if (!row || Number(row.version) !== Number(version)) return [];
      Object.assign(row, {
        name,
        name_key: nameKey,
        description,
        content,
        updated_by: updatedBy,
        version: Number(row.version) + 1,
        updated_at: new Date().toISOString(),
      });
      return [row];
    }

    if (normalized.startsWith('UPDATE character_mw_resources SET archived_at = COALESCE(archived_at, now())')) {
      const [updatedBy, id, version] = params;
      const row = mwResources.get(id);
      if (!row || Number(row.version) !== Number(version)) return [];
      Object.assign(row, {
        archived_at: row.archived_at || new Date().toISOString(),
        updated_by: updatedBy,
        version: Number(row.version) + 1,
        updated_at: new Date().toISOString(),
      });
      return [row];
    }

    if (normalized.startsWith('UPDATE character_mw_resources SET archived_at = NULL')) {
      const [updatedBy, id, version] = params;
      const row = mwResources.get(id);
      if (!row || Number(row.version) !== Number(version)) return [];
      Object.assign(row, {
        archived_at: null,
        updated_by: updatedBy,
        version: Number(row.version) + 1,
        updated_at: new Date().toISOString(),
      });
      return [row];
    }

    if (normalized.includes('INSERT INTO personagens')) {
      const [
        authorId, nome, categoria, titulo, raca, faccao, status, imagem,
        descricao, contentMode, wikitext, customCss, stats, skills, mascaraTier, blocks, theme,
      ] = params;
      const id = randomUUID();
      const now = new Date().toISOString();
      const row = {
        id,
        author_id: authorId,
        nome,
        categoria,
        titulo,
        raca,
        faccao,
        status,
        imagem,
        descricao,
        content_mode: contentMode,
        wikitext,
        custom_css: customCss,
        stats,
        skills,
        mascara_tier: mascaraTier,
        blocks,
        theme,
        version: 1,
        hidden_at: null,
        created_at: now,
        updated_at: now,
      };
      characters.set(id, row);
      return [{ id }];
    }

    if (normalized.includes('FROM personagens p') && normalized.includes('WHERE p.id =')) {
      const row = characters.get(params[0]);
      if (!row) return [];
      const u = users.get(row.author_id);
      return [{
        ...row,
        author_username: u ? u.username : null,
        author_avatar: u ? u.avatar : '',
        author_title: u ? u.title : '',
        author_role: u ? u.role : 'member',
      }];
    }

    if (normalized.includes('FROM personagens') && (normalized.includes('WHERE p.hidden_at IS NULL') || normalized.includes('WHERE hidden_at IS NULL'))) {
      return [...characters.values()].filter((row) => !row.hidden_at).map((row) => {
        const u = users.get(row.author_id);
        return {
          ...row,
          author_username: u ? u.username : null,
          author_avatar: u ? u.avatar : '',
          author_title: u ? u.title : '',
          author_role: u ? u.role : 'member',
        };
      });
    }

    return [];
  }

  function sql(strings, ...values) {
    let text = '';
    for (let i = 0; i < strings.length; i += 1) {
      text += strings[i];
      if (i < values.length) text += `$${i + 1}`;
    }
    return Promise.resolve(runQuery(text, values));
  }
  sql.json = (value) => value;
  sql.begin = async (fn) => {
    const tx = (strings, ...values) => sql(strings, ...values);
    tx.json = sql.json;
    return fn(tx);
  };
  sql.__seedUser = addUser;
  return sql;
}

async function startHarness() {
  const sql = makeMockSql();
  const staffId = sql.__seedUser('moderador');
  const memberId = sql.__seedUser('member');
  const config = { sessionSecret: `mw-route-test-${randomUUID()}`, secureCookies: false };
  const auth = createAuth({ sql, config });
  const app = createApp({ sql, config });

  const sessionApp = express();
  sessionApp.use(cookieSession(createCookieSessionOptions(config)));
  sessionApp.get('/__session/:id', async (req, res, next) => {
    try {
      const rows = await sql`SELECT id, auth_version FROM users WHERE id = ${req.params.id} AND disabled_at IS NULL LIMIT 1`;
      if (!rows.length) return res.status(404).end();
      const csrfToken = auth.issueSession(req, rows[0]);
      return res.json({ csrfToken });
    } catch (err) {
      return next(err);
    }
  });
  sessionApp.use(errorMiddleware);

  const apiServer = await new Promise((resolve) => {
    const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
  });
  const sessServer = await new Promise((resolve) => {
    const srv = sessionApp.listen(0, '127.0.0.1', () => resolve(srv));
  });

  const apiBase = `http://127.0.0.1:${apiServer.address().port}`;
  const sessBase = `http://127.0.0.1:${sessServer.address().port}`;

  async function login(userId) {
    const r = await fetch(`${sessBase}/__session/${userId}`);
    const body = await r.json();
    const cookies = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    return { cookies, csrfToken: body.csrfToken };
  }

  async function request(method, path, body, session) {
    const headers = {};
    if (session) {
      headers.cookie = session.cookies;
      if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
        headers['x-csrf-token'] = session.csrfToken;
        headers['x-idempotency-key'] = createHash('sha256').update(`${method}:${path}:${randomUUID()}`).digest('hex');
      }
    }
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(`${apiBase}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = await res.json();
    return { status: res.status, body: payload };
  }

  return {
    apiBase,
    staffId,
    memberId,
    login,
    request,
    close: async () => {
      await new Promise((resolve) => sessServer.close(resolve));
      await new Promise((resolve) => apiServer.close(resolve));
    },
  };
}

test('character MediaWiki resource and character compilation routes enforce permissions, versions, and safe compilation', async (t) => {
  const h = await startHarness();
  t.after(() => h.close());

  const staffSession = await h.login(h.staffId);
  const memberSession = await h.login(h.memberId);

  const csrfRes = await fetch(`${h.apiBase}/api/auth/csrf`);
  const csrfData = await csrfRes.json();
  const anonCookies = csrfRes.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const unauthCreate = await h.request('POST', '/api/personagens/mediawiki/resources', {
    kind: 'template',
    name: 'Box',
    content: '<div>{{{1|}}}</div>',
  }, { cookies: anonCookies, csrfToken: csrfData.csrfToken });
  assert.equal(unauthCreate.status, 401);

  const memberCreate = await h.request('POST', '/api/personagens/mediawiki/resources', {
    kind: 'template',
    name: 'Box',
    content: '<div>{{{1|}}}</div>',
  }, memberSession);
  assert.equal(memberCreate.status, 403);

  const badLua = await h.request('POST', '/api/personagens/mediawiki/resources', {
    kind: 'lua',
    name: 'Quebrado',
    content: 'function p.broken( return end',
  }, staffSession);
  assert.equal(badLua.status, 400);
  assert.equal(badLua.body.code, 'INVALID_LUA_SYNTAX');

  const tpl = await h.request('POST', '/api/personagens/mediawiki/resources', {
    kind: 'template',
    name: 'Cartao',
    description: 'Cartão principal',
    content: '<templatestyles src="Estilo:CartaoCSS" /><div class="mw-card">{{#invoke:FichaUtil|titulo|nome={{{nome|}}}}}</div>',
  }, staffSession);
  assert.equal(tpl.status, 201);
  assert.equal(tpl.body.data.version, 1);

  const luaRes = await h.request('POST', '/api/personagens/mediawiki/resources', {
    kind: 'lua',
    name: 'FichaUtil',
    content: 'local p = {} function p.titulo(f) return "<b>" .. (f.args.nome or "Sem título — ação") .. "</b>" end return p',
  }, staffSession);
  assert.equal(luaRes.status, 201);

  const cssRes = await h.request('POST', '/api/personagens/mediawiki/resources', {
    kind: 'css',
    name: 'CartaoCSS',
    content: '.mw-card { color: #ddeeff; }',
  }, staffSession);
  assert.equal(cssRes.status, 201);

  const staleUpdate = await h.request('PUT', `/api/personagens/mediawiki/resources/${tpl.body.data.id}`, {
    name: 'Cartao',
    content: '<div class="mw-card">{{{nome|}}}</div>',
    expectedVersion: 99,
  }, staffSession);
  assert.equal(staleUpdate.status, 409);
  assert.equal(staleUpdate.body.code, 'STALE_VERSION');

  const preview = await h.request('POST', '/api/personagens/mediawiki/preview', {
    wikitext: '{{Cartao|nome={{PAGENAME}}}}',
    customCss: '.mw-card { border: 1px solid #556; }',
    character: { nome: 'Astraea' },
    scopeSelector: '.char-mw-preview-scope',
  }, staffSession);
  assert.equal(preview.status, 200);
  assert.match(preview.body.html, /<div class="mw-card"><b>Astraea<\/b><\/div>/);
  assert.match(preview.body.css, /\.char-mw-preview-scope \.mw-card \{ color:#ddeeff; \}/);
  assert.match(preview.body.css, /\.char-mw-preview-scope \.mw-card \{ border:1px solid #556; \}/);

  const charCreate = await h.request('POST', '/api/personagens', {
    nome: 'Astraea',
    categoria: 'NPCs',
    contentMode: 'wikitext',
    wikitext: '== Bio ==\n{{Cartao|nome=Astraea}}<script>alert(1)</script>',
    customCss: '.mw-card { border-radius: 8px; } @import url("x");',
  }, staffSession);
  assert.equal(charCreate.status, 201);
  assert.equal(charCreate.body.personagem.contentMode, 'wikitext');
  assert.match(charCreate.body.personagem.descricao, /<h2[^>]*>Bio<\/h2>/);
  assert.match(charCreate.body.personagem.descricao, /<div class="mw-card"><b>Astraea<\/b><\/div>/);
  assert.doesNotMatch(charCreate.body.personagem.descricao, /<script>/i);
  assert.match(charCreate.body.personagem.compiledCss, new RegExp(`\\.char-mw-scope-${charCreate.body.personagem.id} \\.mw-card`));
  assert.doesNotMatch(charCreate.body.personagem.compiledCss, /@import/i);

  const listed = await h.request('GET', '/api/personagens');
  assert.equal(listed.status, 200);
  assert.equal(listed.body.personagens.length, 1);
  assert.match(listed.body.personagens[0].compiledCss, new RegExp(`\\.char-mw-scope-${listed.body.personagens[0].id}`));

  const archived = await h.request('POST', `/api/personagens/mediawiki/resources/${cssRes.body.data.id}/archive`, {
    expectedVersion: cssRes.body.data.version,
  }, staffSession);
  assert.equal(archived.status, 200);
  assert.ok(archived.body.data.archivedAt);

  const restored = await h.request('POST', `/api/personagens/mediawiki/resources/${cssRes.body.data.id}/restore`, {
    expectedVersion: archived.body.data.version,
  }, staffSession);
  assert.equal(restored.status, 200);
  assert.equal(restored.body.data.archivedAt, null);
});
