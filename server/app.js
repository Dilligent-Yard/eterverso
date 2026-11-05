const path = require('path');
const crypto = require('node:crypto');
const express = require('express');
const cookieSession = require('cookie-session');
const bcrypt = require('bcryptjs');
const { createAuth, createCookieSessionOptions, selfUser } = require('./auth');
const { isOwnAvatarUrl, isUserAvatarPath, parseStoredAvatarData } = require('./avatar');
const { publicAuthor } = require('./dto');
const { ApiError, errorMiddleware, sendError } = require('./errors');
const { assertObjectShape, expectedVersion, normalizeString, validateUuid } = require('./validation');
const { hasMeaningfulContent, sanitizeBlocks: sanitizeSafeBlocks, sanitizeHtml, sanitizeHtmlWithReport, sanitizeUrl } = require('./content');
const { createForumRouter } = require('./forum');
const { createAdminRouter } = require('./admin');
const { createWikiRouter } = require('./wiki');
const { createWikiSectionsRouter } = require('./wiki-sections');
const { createWikiArticleFilesRouter } = require('./wiki-article-files');
const { createProposalRouter } = require('./proposals');
const { createSourceRouter } = require('./sources');
const { createLegacyImportRouter } = require('./legacy-import');
const { createWikiTransfersRouter } = require('./wiki-transfers');

function createApp(options) {
  if (!options || typeof options.sql !== 'function' || typeof options.sql.json !== 'function') {
    throw new TypeError('createApp requires an injected postgres-compatible sql client.');
  }
  const config = options.config || {};
  if (typeof config.sessionSecret !== 'string' || config.sessionSecret.length < 1) {
    throw new TypeError('createApp requires config.sessionSecret.');
  }
  const sql = options.sql;
  const staticRoot = config.staticRoot || path.resolve(__dirname, '..');
  const app = express();
  const auth = createAuth({ sql, config });
  app.locals.sql = sql;
  app.locals.auth = auth;
  app.locals.config = {
    secureCookies: config.secureCookies === true,
    production: config.production === true,
    publicOrigin: config.publicOrigin || null,
  };
  app.set('trust proxy', 1);
  // Article files are JSON strings inside a JSON request. Give these two
  // staff endpoints their own bounded parser so a four-MiB file plus escaping
  // and the signed preview can fit without raising limits for other routes.
  app.use('/api/staff/wiki/article-files/preview', express.json({ limit: '10mb' }));
  app.use('/api/staff/wiki/article-files/commit', express.json({ limit: '10mb' }));
  app.use(express.json({ limit: '5mb' }));
  app.use(function (req, res, next) {
    if (!req.body) req.body = {};
    next();
  });
  app.use(cookieSession(createCookieSessionOptions(config)));
  app.use(auth.csrfProtection);

  // ---------- Arquivos estáticos (allowlist: nada além do site é servido) ----------

  const STATIC_FILES = {
    '/': 'index.html',
    '/index.html': 'index.html',
    '/forum': 'index.html',
    '/wiki': 'index.html',
    '/wiki/novo': 'index.html',
    '/wiki/editor': 'index.html',
    '/wiki/propostas': 'index.html',
    '/personagens': 'index.html',
    '/admin': 'index.html',
    '/app.js': 'app.js',
    '/client/api.js': 'client/api.js',
    '/editor.js': 'editor.js',
    '/style.css': 'style.css',
    '/legacy-recovery.html': 'legacy-recovery.html',
    '/legacy-recovery.js': 'legacy-recovery.js',
  };
  Object.keys(STATIC_FILES).forEach(function (route) {
    app.get(route, function (req, res) {
      res.sendFile(path.join(staticRoot, STATIC_FILES[route]));
    });
  });

  // Canonical client routes serve the shell on direct visits and reloads.
  // Regex routes avoid Express 5's changed wildcard syntax and stay separate
  // from API and static paths.
  app.get([
    /^\/forum\/categorias\/[0-9a-f-]{36}$/i,
    /^\/forum\/topicos\/[0-9a-f-]{36}$/i,
    /^\/wiki(?:\/[a-z0-9][a-z0-9_-]{0,119})?$/i,
    /^\/personagens\/[0-9a-f-]{36}$/i,
    /^\/wiki\/editor\/[0-9a-f-]{36}$/i,
    /^\/wiki\/rascunhos\/[0-9a-f-]{36}$/i,
    /^\/wiki\/propostas\/[0-9a-f-]{36}$/i,
    /^\/cenas$/i,
    /^\/cenas\/[0-9a-f-]{36}$/i,
  ], function (_req, res) {
    res.sendFile(path.join(staticRoot, 'index.html'));
  });

  // ---------- Autenticação por usuário e senha ----------

  const USERNAME_RE = /^[A-Za-z0-9_.\- ]{3,50}$/;
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  app.get('/api/auth/csrf', function (req, res) {
    res.json({ csrfToken: auth.csrfTokenForSession(req) });
  });

  app.post('/api/content/preview', auth.requireIdentity, function (req, res) {
    try {
      assertObjectShape(req.body, { allowedKeys: ['html', 'blocks'] });
      if (!Object.hasOwn(req.body, 'html') && !Object.hasOwn(req.body, 'blocks')) {
        throw new ApiError(400, 'INVALID_SHAPE', 'Informe conteúdo para validar.');
      }
      const result = {};
      if (Object.hasOwn(req.body, 'html')) {
        const html = sanitizeHtmlWithReport(req.body.html, { maxBytes: 250_000 });
        result.html = html.html;
        result.formattingLoss = html.formattingLoss;
      }
      if (Object.hasOwn(req.body, 'blocks')) result.blocks = sanitizeSafeBlocks(req.body.blocks);
      return res.json(result);
    } catch (err) {
      return sendError(res, err);
    }
  });

  app.post('/api/auth/signup', async function (req, res, next) {
    try {
      assertObjectShape(req.body, { allowedKeys: ['username', 'email', 'password'], requiredKeys: ['username', 'email', 'password'] });
      const username = normalizeString(req.body.username, { field: 'username', min: 3, max: 50 });
      const email = normalizeString(req.body.email, { field: 'email', min: 3, max: 120 }).toLowerCase();
      const password = req.body.password;
      if (!USERNAME_RE.test(username)) throw new ApiError(400, 'INVALID_USERNAME', 'O nome de usuário possui um formato inválido.');
      if (!EMAIL_RE.test(email)) throw new ApiError(400, 'INVALID_EMAIL', 'O email possui um formato inválido.');
      if (typeof password !== 'string' || password.length < 6 || password.length > 200) {
        throw new ApiError(400, 'INVALID_PASSWORD', 'A senha deve ter entre 6 e 200 caracteres.');
      }

      const existing = await sql`
        SELECT username, email FROM users
        WHERE lower(username) = lower(${username}) OR lower(email) = ${email}
        LIMIT 1`;
      if (existing.length > 0) throw new ApiError(409, 'ACCOUNT_CONFLICT', 'Esse nome de usuário ou email já está em uso.');

      const passwordHash = await bcrypt.hash(password, 10);
      const rows = await sql`
        INSERT INTO users (username, email, password_hash, title)
        VALUES (${username}, ${email}, ${passwordHash}, 'Membro')
        RETURNING id, username, email, avatar, title, bio, role, posts_count, join_date,
                  disabled_at, auth_version, version`;
      const csrfToken = auth.issueSession(req, rows[0]);
      res.status(201).json({ user: selfUser(rows[0]), csrfToken });
    } catch (err) {
      if (err && err.code === '23505' && ['users_username_lower_key', 'users_username_key', 'users_email_key'].includes(err.constraint_name || err.constraint)) {
        return next(new ApiError(409, 'ACCOUNT_CONFLICT', 'Esse nome de usuário ou email já está em uso.'));
      }
      return next(err);
    }
  });

  app.post('/api/auth/login', async function (req, res, next) {
    try {
      assertObjectShape(req.body, { allowedKeys: ['username', 'password'], requiredKeys: ['username', 'password'] });
      const username = normalizeString(req.body.username, { field: 'username', min: 1, max: 50 });
      const password = req.body.password;
      if (typeof password !== 'string' || password.length < 1 || password.length > 200) {
        throw new ApiError(400, 'INVALID_CREDENTIALS', 'Preencha usuário e senha.');
      }

      const rows = await sql`
        SELECT id, username, email, password_hash,
               CASE WHEN avatar LIKE 'data:image/%' THEN '/api/users/' || lower(id::text) || '/avatar?v=' || version::text ELSE avatar END AS avatar,
               title, bio, role, posts_count,
               (SELECT count(*)::integer FROM posts p WHERE p.author_id = users.id AND p.deleted_at IS NULL) AS forum_posts_count,
               join_date,
               disabled_at, auth_version, version
        FROM users WHERE lower(username) = lower(${username}) LIMIT 1`;
      const user = rows[0];
      const ok = user && user.password_hash && (await bcrypt.compare(password, user.password_hash));
      if (!ok || user.disabled_at !== null) throw new ApiError(401, 'INVALID_CREDENTIALS', 'Usuário ou senha incorretos.');
      const csrfToken = auth.issueSession(req, user);
      res.json({ user: selfUser(user), csrfToken });
    } catch (err) {
      return next(err);
    }
  });

  app.post('/api/auth/logout', auth.requireIdentity, async function (req, res, next) {
    try {
      await auth.withActorTransaction(req, async function (tx, actor) {
        if (actor.auth_version >= 2_147_483_647) {
          throw new ApiError(409, 'VERSION_EXHAUSTED', 'Esta sessão não pode mais ser revogada automaticamente.');
        }
        await tx`UPDATE users SET auth_version = auth_version + 1 WHERE id = ${actor.id}`;
      });
      auth.clearSession(req);
      return res.json({ ok: true });
    } catch (err) {
      return next(err);
    }
  });

  app.get('/api/auth/me', async function (req, res, next) {
    try {
      const user = await auth.readFreshIdentity(req);
      if (!user) return res.status(401).json({ user: null });
      res.json({ user: selfUser(user) });
    } catch (err) {
      return next(err);
    }
  });

  app.get('/api/users/:id/avatar', async function (req, res, next) {
    try {
      const id = validateUuid(req.params.id, 'id');
      const rows = await sql`
        SELECT avatar, version, disabled_at
        FROM users WHERE id = ${id} LIMIT 1`;
      if (!rows.length || rows[0].disabled_at !== null) {
        throw new ApiError(404, 'NOT_FOUND', 'A imagem de perfil solicitada não foi encontrada.');
      }
      const parsed = parseStoredAvatarData(rows[0].avatar);
      if (!parsed) {
        throw new ApiError(404, 'NOT_FOUND', 'A imagem de perfil solicitada não foi encontrada.');
      }
      const etag = `"avatar-${id}-${rows[0].version}"`;
      const ifNoneMatch = req.get('If-None-Match');
      if (typeof ifNoneMatch === 'string' && ifNoneMatch.split(',').some((item) => item.trim().replace(/^W\//, '') === etag)) {
        return res.status(304).set('ETag', etag).end();
      }
      return res.status(200)
        .set('Content-Type', parsed.mimeType)
        .set('Content-Length', String(parsed.buffer.length))
        .set('ETag', etag)
        .set('X-Content-Type-Options', 'nosniff')
        .set('Content-Security-Policy', "default-src 'none'; sandbox")
        .set('Cache-Control', 'public, max-age=86400')
        .send(parsed.buffer);
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api/users/:id', async function (req, res, next) {
    try {
      const id = validateUuid(req.params.id, 'id');
      const rows = await sql`
        SELECT u.id, u.username,
          CASE WHEN u.avatar LIKE 'data:image/%' THEN '/api/users/' || lower(u.id::text) || '/avatar?v=' || u.version::text ELSE u.avatar END AS avatar,
          u.title, u.role,
          (SELECT count(*)::integer FROM posts p
           WHERE p.author_id = u.id AND p.deleted_at IS NULL) AS forum_posts_count
        FROM users u WHERE u.id = ${id} LIMIT 1`;
      if (!rows.length) throw new ApiError(404, 'NOT_FOUND', 'O perfil solicitado não foi encontrado.');
      return res.json({ user: { ...publicAuthor(rows[0]), posts: rows[0].forum_posts_count } });
    } catch (error) {
      return next(error);
    }
  });

  app.put('/api/auth/profile', async function (req, res, next) {
    try {
      assertObjectShape(req.body, {
        allowedKeys: ['avatar', 'avatarUpload', 'title', 'bio', 'currentPassword', 'newPassword', 'expectedVersion'],
      });
      const version = expectedVersion(req.body.expectedVersion);
      const hasAvatarUpload = Object.hasOwn(req.body, 'avatarUpload')
        && req.body.avatarUpload !== null
        && req.body.avatarUpload !== '';
      let parsedUpload = null;
      if (hasAvatarUpload) {
        parsedUpload = parseStoredAvatarData(req.body.avatarUpload);
        if (!parsedUpload) {
          throw new ApiError(400, 'INVALID_AVATAR_UPLOAD', 'Envie uma imagem PNG, JPEG, WebP ou GIF válida de até 512 KB.');
        }
      } else if (Object.hasOwn(req.body, 'avatarUpload')
          && req.body.avatarUpload !== null
          && typeof req.body.avatarUpload !== 'string') {
        throw new ApiError(400, 'INVALID_AVATAR_UPLOAD', 'Envie uma imagem PNG, JPEG, WebP ou GIF válida de até 512 KB.');
      }
      const changePassword = Object.hasOwn(req.body, 'newPassword') && req.body.newPassword !== '';
      if (changePassword && (typeof req.body.currentPassword !== 'string' || !req.body.currentPassword)) {
        throw new ApiError(400, 'CURRENT_PASSWORD_REQUIRED', 'Informe a senha atual para alterá-la.');
      }
      if (!changePassword && Object.hasOwn(req.body, 'currentPassword') && req.body.currentPassword !== '') {
        throw new ApiError(400, 'INVALID_PROFILE', 'A senha atual só é aceita junto com uma nova senha.');
      }
      if (changePassword && (typeof req.body.newPassword !== 'string'
          || req.body.newPassword.length < 6 || req.body.newPassword.length > 200)) {
        throw new ApiError(400, 'INVALID_PASSWORD', 'A nova senha deve ter entre 6 e 200 caracteres.');
      }
      const result = await auth.withActorTransaction(req, async (tx, actor) => {
        if (actor.version !== version) throw new ApiError(409, 'STALE_VERSION', 'O perfil mudou. Atualize e tente novamente.');
        if (actor.version >= 2147483647 || (changePassword && actor.auth_version >= 2147483647)) {
          throw new ApiError(409, 'VERSION_EXHAUSTED', 'A versão deste perfil não pode mais ser atualizada.');
        }
        const currentRows = await tx`
          SELECT id, username, email, password_hash, avatar, title, bio, role, posts_count, join_date,
                 disabled_at, auth_version, version
          FROM users WHERE id = ${actor.id} LIMIT 1`;
        const current = currentRows[0];
        if (changePassword && !(await bcrypt.compare(req.body.currentPassword, current.password_hash))) {
          throw new ApiError(403, 'CURRENT_PASSWORD_INVALID', 'A senha atual está incorreta.');
        }
        let avatar;
        if (parsedUpload) {
          avatar = parsedUpload.dataUrl;
        } else if (Object.hasOwn(req.body, 'avatar')) {
          const avatarInput = normalizeString(req.body.avatar, { field: 'avatar', min: 0, max: 500 });
          if (avatarInput === '') {
            avatar = '';
          } else if (isOwnAvatarUrl(avatarInput, actor.id)
              && typeof current.avatar === 'string'
              && current.avatar.startsWith('data:image/')) {
            avatar = current.avatar;
          } else {
            let parsedUrl = null;
            try { parsedUrl = new URL(avatarInput, 'https://aetherverse.invalid'); } catch {}
            const isLocalAvatar = parsedUrl
              && parsedUrl.origin === 'https://aetherverse.invalid'
              && isUserAvatarPath(parsedUrl.pathname, parsedUrl.search);
            const safeAvatar = isLocalAvatar ? null : sanitizeUrl(avatarInput, { image: true });
            if (!safeAvatar) {
              throw new ApiError(400, 'INVALID_AVATAR', 'A imagem do perfil deve usar uma URL HTTPS permitida.');
            }
            avatar = safeAvatar;
          }
        } else {
          avatar = current.avatar || '';
        }
        const title = Object.hasOwn(req.body, 'title')
          ? (normalizeString(req.body.title, { field: 'title', min: 0, max: 80 }) || 'Membro')
          : current.title;
        const bio = Object.hasOwn(req.body, 'bio')
          ? normalizeString(req.body.bio, { field: 'bio', min: 0, max: 2_000 })
          : current.bio;
        const passwordHash = changePassword ? await bcrypt.hash(req.body.newPassword, 10) : current.password_hash;
        const rows = await tx`
          UPDATE users SET avatar = ${avatar}, title = ${title}, bio = ${bio},
            password_hash = ${passwordHash}, version = version + 1,
            auth_version = auth_version + ${changePassword ? 1 : 0}
          WHERE id = ${actor.id} AND version = ${version}
          RETURNING id, username, email, avatar, title, bio, role, posts_count, join_date,
                    disabled_at, auth_version, version`;
        if (rows.length !== 1) throw new ApiError(409, 'STALE_VERSION', 'O perfil mudou. Atualize e tente novamente.');
        return rows[0];
      });
      const forumCount = await sql`SELECT count(*)::integer AS count FROM posts WHERE author_id = ${result.id} AND deleted_at IS NULL`;
      result.forum_posts_count = forumCount[0].count;
      const response = { user: selfUser(result) };
      if (changePassword) response.csrfToken = auth.issueSession(req, result);
      return res.json(response);
    } catch (err) {
      return next(err);
    }
  });

  // ---------- Personagens (fichas) ----------

  const STAT_KEYS = ['ataque', 'destreza', 'defesa', 'reserva', 'controle', 'refino', 'emissao', 'alma', 'inteligencia', 'habilidade'];
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function safeStoredHtml(value) {
    try { return sanitizeHtml(typeof value === 'string' ? value : ''); } catch (_error) { return ''; }
  }

  function safeStoredBlocks(value) {
    try { return sanitizeSafeBlocks(Array.isArray(value) ? value : []); } catch (_error) { return []; }
  }

  function safeStoredImage(value) {
    return typeof value === 'string' ? (sanitizeUrl(value, { image: true }) || '') : '';
  }

  function safeStoredTheme(value) {
    try { return sanitizeTheme(value); } catch (_error) { return sanitizeTheme({}); }
  }

  function publicPersonagem(p) {
    return {
      id: p.id,
      version: Number(p.version) || 1,
      authorId: p.author_id ? validateUuid(p.author_id) : null,
      author: p.author_id && p.author_username ? publicAuthor({
        id: p.author_id,
        username: p.author_username,
        avatar: safeStoredImage(p.author_avatar),
        title: p.author_title || '',
        role: p.author_role,
      }) : null,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
      nome: p.nome,
      categoria: p.categoria,
      titulo: p.titulo,
      raca: p.raca,
      faccao: p.faccao,
      status: p.status,
      imagem: safeStoredImage(p.imagem),
      descricao: safeStoredHtml(p.descricao),
      stats: p.stats || {},
      skills: p.skills || [],
      mascaraTier: p.mascara_tier,
      blocks: safeStoredBlocks(p.blocks),
      theme: safeStoredTheme(p.theme),
    };
  }

  async function loadPersonagemWithAuthor(executor, id) {
    const rows = await executor`
      SELECT p.*, u.username AS author_username,
        CASE WHEN u.avatar LIKE 'data:image/%' THEN '/api/users/' || lower(u.id::text) || '/avatar?v=' || u.version::text ELSE u.avatar END AS author_avatar,
        u.title AS author_title, u.role AS author_role
      FROM personagens p
      LEFT JOIN users u ON u.id = p.author_id
      WHERE p.id = ${id}
      LIMIT 1`;
    return rows[0] || null;
  }

  function sanitizeStats(raw) {
    const stats = {};
    if (!raw || typeof raw !== 'object') return stats;
    STAT_KEYS.forEach(function (k) {
      if (raw[k] === undefined || raw[k] === null || raw[k] === '') return;
      let n = parseInt(raw[k], 10);
      if (isNaN(n)) n = 0;
      stats[k] = Math.max(0, Math.min(100, n));
    });
    return stats;
  }

  function sanitizeSkills(raw) {
    if (!Array.isArray(raw)) return [];
    const skills = [];
    for (const item of raw) {
      if (skills.length >= 60) break;
      if (!item || typeof item !== 'object') continue;
      const nome = String(item.nome || '').trim().slice(0, 100);
      const descricao = String(item.descricao || '').trim().slice(0, 2000);
      const tipo = item.tipo === 'equipamento' ? 'equipamento' : 'skill';
      if (nome || descricao) skills.push({ nome, descricao, tipo });
    }
    return skills;
  }

  function sanitizeTheme(raw) {
    const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const allowed = {
      bannerStyle: ['cinematic', 'standard', 'compact', 'none'],
      layout: ['sidebar-left', 'sidebar-right', 'full', 'book'],
      fontFamily: ['serif', 'sans', 'mono'],
      bgEffect: ['none', 'aura', 'grid', 'dots'],
    };
    for (const key of Object.keys(value)) {
      if (!['accentColor', 'bannerStyle', 'layout', 'fontFamily', 'bgEffect', 'bgm'].includes(key)) {
        throw new ApiError(400, 'INVALID_THEME', 'A aparência contém um campo não permitido.');
      }
    }
    const accentColor = value.accentColor || '';
    if (accentColor && !/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(accentColor)) {
      throw new ApiError(400, 'INVALID_THEME', 'A cor de destaque é inválida.');
    }
    for (const [key, choices] of Object.entries(allowed)) {
      if (value[key] !== undefined && value[key] !== '' && !choices.includes(value[key])) {
        throw new ApiError(400, 'INVALID_THEME', 'A aparência contém uma opção inválida.');
      }
    }
    const bgm = value.bgm === undefined ? '' : normalizeString(value.bgm, { field: 'theme.bgm', min: 0, max: 300 });
    return {
      accentColor: accentColor.toLowerCase(),
      bannerStyle: value.bannerStyle || 'cinematic',
      layout: value.layout || 'sidebar-left',
      fontFamily: value.fontFamily || 'sans',
      bgEffect: value.bgEffect || 'none',
      bgm,
    };
  }

  function sanitizeInfobox(raw) {
    const value = raw === undefined || raw === null ? {} : raw;
    assertObjectShape(value, { allowedKeys: ['show', 'title', 'image', 'caption', 'location', 'timeline', 'participants', 'fields'] });
    const fields = value.fields === undefined ? [] : value.fields;
    if (!Array.isArray(fields) || fields.length > 30) throw new ApiError(400, 'INVALID_INFOBOX', 'Os campos da infobox são inválidos.');
    const safeFields = fields.map(function (field) {
      assertObjectShape(field, { allowedKeys: ['label', 'value'], requiredKeys: ['label', 'value'] });
      return {
        label: normalizeString(field.label, { field: 'infobox.fields.label', min: 0, max: 80 }),
        value: normalizeString(field.value, { field: 'infobox.fields.value', min: 0, max: 300 }),
      };
    }).filter(function (field) { return field.label || field.value; });
    const participants = value.participants === undefined ? [] : value.participants;
    if (!Array.isArray(participants) || participants.length > 30) throw new ApiError(400, 'INVALID_INFOBOX', 'Os participantes da infobox são inválidos.');
    const safeParticipants = participants.map(function (participant) {
      return normalizeString(participant, { field: 'infobox.participants', min: 1, max: 100 });
    });
    const imageInput = value.image === undefined ? '' : normalizeString(value.image, { field: 'infobox.image', min: 0, max: 600 });
    const image = imageInput ? sanitizeUrl(imageInput, { image: true }) : '';
    if (imageInput && !image) throw new ApiError(400, 'INVALID_INFOBOX_IMAGE', 'A imagem da infobox deve usar uma URL HTTPS permitida.');
    return {
      show: value.show !== false,
      title: normalizeString(value.title === undefined ? '' : value.title, { field: 'infobox.title', min: 0, max: 120 }),
      image,
      caption: normalizeString(value.caption === undefined ? '' : value.caption, { field: 'infobox.caption', min: 0, max: 200 }),
      location: normalizeString(value.location === undefined ? '' : value.location, { field: 'infobox.location', min: 0, max: 160 }),
      timeline: normalizeString(value.timeline === undefined ? '' : value.timeline, { field: 'infobox.timeline', min: 0, max: 160 }),
      participants: safeParticipants,
      fields: safeFields,
    };
  }

  const PERSONAGEM_CAMPOS = [
    ['nome', 100],
    ['categoria', 50],
    ['titulo', 100],
    ['raca', 80],
    ['faccao', 120],
    ['status', 80],
    ['imagem', 500],
    ['mascaraTier', 60],
  ];

  function lerPersonagemBody(body) {
    assertObjectShape(body, {
      allowedKeys: ['nome', 'categoria', 'titulo', 'raca', 'faccao', 'status', 'imagem', 'mascaraTier', 'descricao', 'stats', 'skills', 'blocks', 'theme'],
      requiredKeys: ['nome', 'descricao'],
    });
    const v = {};
    for (const [campo, max] of PERSONAGEM_CAMPOS) {
      const valor = body[campo] === undefined ? '' : normalizeString(body[campo], { field: campo, min: 0, max });
      if (campo === 'imagem' && valor && !sanitizeUrl(valor, { image: true })) {
        throw new ApiError(400, 'INVALID_IMAGE', 'A imagem deve usar uma URL HTTPS permitida.');
      }
      v[campo] = valor;
    }
    if (!v.nome) throw new ApiError(400, 'NAME_REQUIRED', 'O nome é obrigatório.');
    const rawDescription = normalizeString(body.descricao, { field: 'descricao', min: 1, max: 250_000, trim: false });
    v.descricao = sanitizeHtml(rawDescription, { maxBytes: 500_000 });
    if (!hasMeaningfulContent(v.descricao)) throw new ApiError(400, 'CONTENT_REQUIRED', 'A descrição é obrigatória.');
    v.stats = sanitizeStats(body.stats);
    v.skills = sanitizeSkills(body.skills);
    v.blocks = sanitizeSafeBlocks(body.blocks === undefined ? [] : body.blocks);
    v.theme = sanitizeTheme(body.theme);
    return v;
  }

  async function withStaffTransaction(req, callback) {
    return auth.withActorTransaction(req, function (tx, actor) {
      auth.assertRole(actor, 'admin', 'moderador');
      return callback(tx, actor);
    });
  }

  async function withMemberTransaction(req, callback) {
    return auth.withActorTransaction(req, function (tx, actor) {
      return callback(tx, actor);
    });
  }

  function safeStoredInfobox(value) {
    try { return sanitizeInfobox(value); } catch (_error) { return {}; }
  }

  app.get('/api/personagens', async function (req, res) {
    try {
      const rows = await sql`
        SELECT p.*, u.username AS author_username,
          CASE WHEN u.avatar LIKE 'data:image/%' THEN '/api/users/' || lower(u.id::text) || '/avatar?v=' || u.version::text ELSE u.avatar END AS author_avatar,
          u.title AS author_title, u.role AS author_role
        FROM personagens p
        LEFT JOIN users u ON u.id = p.author_id
        WHERE p.hidden_at IS NULL
        ORDER BY p.created_at ASC`;
      res.json({ personagens: rows.map(publicPersonagem) });
    } catch (err) {
      return sendError(res, err);
    }
  });

  app.get('/api/staff/personagens/hidden', auth.requireIdentity, auth.requireRole('admin', 'moderador'), async function (_req, res) {
    try {
      const rows = await sql`
        SELECT p.*, u.username AS author_username,
          CASE WHEN u.avatar LIKE 'data:image/%' THEN '/api/users/' || lower(u.id::text) || '/avatar?v=' || u.version::text ELSE u.avatar END AS author_avatar,
          u.title AS author_title, u.role AS author_role
        FROM personagens p
        LEFT JOIN users u ON u.id = p.author_id
        WHERE p.hidden_at IS NOT NULL
        ORDER BY p.hidden_at DESC
        LIMIT 100`;
      res.json({ data: rows.map(publicPersonagem) });
    } catch (err) {
      return sendError(res, err);
    }
  });

  app.post('/api/personagens', async function (req, res) {
    try {
      const v = lerPersonagemBody(req.body);
      const row = await withStaffTransaction(req, async (tx, user) => {
        const inserted = await tx`
          INSERT INTO personagens (author_id, nome, categoria, titulo, raca, faccao, status, imagem, descricao, stats, skills, mascara_tier, blocks, theme)
          VALUES (${user.id}, ${v.nome}, ${v.categoria}, ${v.titulo}, ${v.raca}, ${v.faccao}, ${v.status}, ${v.imagem}, ${v.descricao}, ${tx.json(v.stats)}, ${tx.json(v.skills)}, ${v.mascaraTier}, ${tx.json(v.blocks)}, ${tx.json(v.theme)})
          RETURNING id`;
        return loadPersonagemWithAuthor(tx, inserted[0].id);
      });
      res.status(201).json({ personagem: publicPersonagem(row) });
    } catch (err) {
      return sendError(res, err);
    }
  });

  app.put('/api/personagens/:id', async function (req, res) {
    try {
      const id = validateUuid(req.params.id);
      assertObjectShape(req.body, {
        allowedKeys: ['nome', 'categoria', 'titulo', 'raca', 'faccao', 'status', 'imagem', 'descricao', 'stats', 'skills', 'mascaraTier', 'blocks', 'theme', 'expectedVersion'],
      });
      const version = expectedVersion(req.body.expectedVersion);
      const body = { ...req.body };
      delete body.expectedVersion;
      const v = lerPersonagemBody(body);
      const row = await withStaffTransaction(req, async (tx) => {
        const current = await tx`SELECT id, version, hidden_at FROM personagens WHERE id = ${id} FOR UPDATE`;
        if (!current.length || current[0].hidden_at) throw new ApiError(404, 'NOT_FOUND', 'Personagem não encontrado.');
        if (Number(current[0].version) !== version) throw new ApiError(409, 'STALE_VERSION', 'A ficha mudou. Atualize e tente novamente.');
        if (version >= 2147483647) throw new ApiError(409, 'VERSION_EXHAUSTED', 'A ficha atingiu o limite de versões.');
        const updated = await tx`
        UPDATE personagens SET
          nome = ${v.nome}, categoria = ${v.categoria}, titulo = ${v.titulo}, raca = ${v.raca},
          faccao = ${v.faccao}, status = ${v.status}, imagem = ${v.imagem}, descricao = ${v.descricao},
          stats = ${tx.json(v.stats)}, skills = ${tx.json(v.skills)}, mascara_tier = ${v.mascaraTier},
          blocks = ${tx.json(v.blocks)}, theme = ${tx.json(v.theme)}, version = version + 1, updated_at = now()
        WHERE id = ${id} AND version = ${version} AND hidden_at IS NULL
        RETURNING id`;
        if (!updated.length) return null;
        return loadPersonagemWithAuthor(tx, updated[0].id);
      });
      if (!row) return res.status(404).json({ error: 'Personagem não encontrado.' });
      res.json({ personagem: publicPersonagem(row) });
    } catch (err) {
      return sendError(res, err);
    }
  });

  app.post('/api/personagens/:id/hide', async function (req, res) {
    try {
      const id = validateUuid(req.params.id);
      assertObjectShape(req.body, { allowedKeys: ['expectedVersion'] });
      const version = expectedVersion(req.body.expectedVersion);
      const rows = await withStaffTransaction(req, async (tx) => {
        const current = await tx`SELECT version, hidden_at FROM personagens WHERE id = ${id} FOR UPDATE`;
        if (!current.length || current[0].hidden_at) return [];
        if (Number(current[0].version) !== version) throw new ApiError(409, 'STALE_VERSION', 'A ficha mudou. Atualize e tente novamente.');
        if (version >= 2147483647) throw new ApiError(409, 'VERSION_EXHAUSTED', 'A ficha atingiu o limite de versões.');
        return tx`UPDATE personagens SET hidden_at = now(), version = version + 1, updated_at = now()
          WHERE id = ${id} AND version = ${version} AND hidden_at IS NULL RETURNING id`;
      });
      if (rows.length === 0) return res.status(404).json({ error: 'Personagem não encontrado.' });
      res.json({ ok: true });
    } catch (err) {
      return sendError(res, err);
    }
  });

  app.post('/api/personagens/:id/restore', auth.requireIdentity, auth.requireRole('admin', 'moderador'), async function (req, res) {
    try {
      const id = validateUuid(req.params.id);
      assertObjectShape(req.body, { allowedKeys: ['expectedVersion'] });
      const version = expectedVersion(req.body.expectedVersion);
      const row = await withStaffTransaction(req, async (tx) => {
        const current = await tx`SELECT version, hidden_at FROM personagens WHERE id = ${id} FOR UPDATE`;
        if (!current.length || !current[0].hidden_at) return null;
        if (Number(current[0].version) !== version) throw new ApiError(409, 'STALE_VERSION', 'A ficha mudou. Atualize e tente novamente.');
        if (version >= 2147483647) throw new ApiError(409, 'VERSION_EXHAUSTED', 'A ficha atingiu o limite de versões.');
        const updated = await tx`UPDATE personagens SET hidden_at = NULL, version = version + 1, updated_at = now()
          WHERE id = ${id} AND version = ${version} RETURNING id`;
        if (!updated.length) return null;
        return loadPersonagemWithAuthor(tx, updated[0].id);
      });
      if (!row) return res.status(404).json({ error: 'Personagem oculto não encontrado.' });
      res.json({ data: publicPersonagem(row) });
    } catch (err) {
      return sendError(res, err);
    }
  });

  // ---------- Wikia Posts / Cenas de RPG ----------

  function publicWikiPost(w) {
    return {
      id: w.id,
      version: Number(w.version) || 1,
      turnsReadOnly: w.turns_read_only === true,
      authorId: w.author_id,
      author: w.public_author || null,
      titulo: w.titulo,
      subtitulo: w.subtitulo || '',
      categoria: w.categoria || 'Cena de RPG',
      status: w.status || 'Em Andamento',
      resumo: w.resumo || '',
      banner: safeStoredImage(w.banner),
      descricao: safeStoredHtml(w.descricao),
      theme: safeStoredTheme(w.theme),
      infobox: safeStoredInfobox(w.infobox),
      blocks: safeStoredBlocks(w.blocks),
      turns: Array.isArray(w.public_turns) ? w.public_turns : [],
      createdAt: w.created_at,
      updatedAt: w.updated_at,
    };
  }

  function safeStoredTurn(turn) {
    if (!turn || typeof turn !== 'object' || Array.isArray(turn)) return null;
    const images = Array.isArray(turn.images) ? turn.images.slice(0, 20).map(function (image) {
      const url = typeof image === 'string' ? image : image && image.url;
      const safeUrl = safeStoredImage(url);
      if (!safeUrl) return null;
      return { url: safeUrl, caption: String((image && image.caption) || '').slice(0, 240) };
    }).filter(Boolean) : [];
    const authorId = typeof turn.authorId === 'string' && UUID_RE.test(turn.authorId) ? turn.authorId : null;
    const authorRole = ['member', 'moderador', 'admin'].includes(turn.authorRole) ? turn.authorRole : 'member';
    const bannerStyle = ['panoramic', 'full', 'side'].includes(turn.bannerStyle) ? turn.bannerStyle : 'panoramic';
    const fontFamily = ['serif', 'sans', 'mono'].includes(turn.fontFamily) ? turn.fontFamily : 'serif';
    const accentColor = /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(turn.accentColor || '') ? turn.accentColor : '';
    return {
      id: typeof turn.id === 'string' || typeof turn.id === 'number' ? String(turn.id).slice(0, 80) : '',
      authorId,
      authorName: String(turn.authorName || 'Autoria não identificada').slice(0, 60),
      authorRole,
      authorAvatar: safeStoredImage(turn.authorAvatar),
      characterName: String(turn.characterName || '').slice(0, 100),
      characterTitle: String(turn.characterTitle || '').slice(0, 120),
      characterAvatar: safeStoredImage(turn.characterAvatar),
      turnTitle: String(turn.turnTitle || '').slice(0, 160),
      location: String(turn.location || '').slice(0, 120),
      banner: safeStoredImage(turn.banner),
      bannerStyle,
      images,
      content: safeStoredHtml(turn.content),
      oocNotes: String(turn.oocNotes || '').slice(0, 4_000),
      accentColor,
      fontFamily,
      date: typeof turn.date === 'string' ? turn.date.slice(0, 80) : '',
      edited: turn.edited === true,
    };
  }

  async function publicWikiPostsWithTurns(executor, scenes) {
    if (!scenes.length) return [];
    const ids = scenes.map((scene) => scene.id);
    const authorIds = [...new Set(scenes.map((scene) => scene.author_id).filter((value) => typeof value === 'string' && UUID_RE.test(value)))];
    const authorRows = authorIds.length
      ? await executor`
          SELECT u.id, u.username,
            CASE WHEN u.avatar LIKE 'data:image/%' THEN '/api/users/' || lower(u.id::text) || '/avatar?v=' || u.version::text ELSE u.avatar END AS avatar,
            u.title, u.role
          FROM users u
          WHERE u.id = ANY(${executor.array(authorIds, 2950)})`
      : [];
    const authorsById = new Map();
    authorRows.forEach((row) => {
      if (!row.id || !row.username) return;
      authorsById.set(String(row.id).toLowerCase(), publicAuthor({
        id: row.id,
        username: row.username,
        avatar: safeStoredImage(row.avatar),
        title: row.title || '',
        role: row.role,
      }));
    });
    const markers = await executor`
      SELECT scene_id FROM scene_turn_migrations
      WHERE scene_id = ANY(${executor.array(ids, 2950)})`;
    const normalized = new Set(markers.map((row) => String(row.scene_id)));
    const childTurns = await executor`
      SELECT st.*, u.username AS author_username, u.role AS author_role,
        CASE WHEN u.avatar LIKE 'data:image/%' THEN '/api/users/' || lower(u.id::text) || '/avatar?v=' || u.version::text ELSE u.avatar END AS author_avatar
      FROM scene_turns st LEFT JOIN users u ON u.id = st.author_id
      WHERE st.scene_id = ANY(${executor.array(ids, 2950)}) AND st.deleted_at IS NULL
      ORDER BY st.scene_id ASC, st.ordinal ASC`;
    const grouped = new Map(ids.map((id) => [String(id), []]));
    childTurns.forEach((row) => {
      const presentation = row.presentation && typeof row.presentation === 'object' ? row.presentation : {};
      const turn = safeStoredTurn(Object.assign({}, presentation, {
        id: row.legacy_id || row.id,
        authorId: row.author_id,
        authorName: row.author_username || row.legacy_author_label || 'Autoria não identificada',
        authorRole: row.author_role,
        authorAvatar: row.author_avatar,
        content: row.content,
        date: presentation.date || (row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at || '')),
      }));
      if (turn) grouped.get(String(row.scene_id)).push(Object.assign(turn, { version: Number(row.version) || 1 }));
    });

    return scenes.map((scene) => {
      const isNormalized = normalized.has(String(scene.id));
      const publicTurns = isNormalized
        ? grouped.get(String(scene.id))
        : (Array.isArray(scene.turns) ? scene.turns.map((item) => {
          const turn = safeStoredTurn(item);
          return turn ? Object.assign(turn, { authorId: null, authorAvatar: '', version: 1, legacyReadOnly: true }) : null;
        }).filter(Boolean) : []);
      return publicWikiPost(Object.assign({}, scene, {
        public_author: scene.author_id ? (authorsById.get(String(scene.author_id).toLowerCase()) || null) : null,
        public_turns: publicTurns,
        turns_read_only: !isNormalized,
      }));
    });
  }

  function assertCurrentVersion(current, expected, label) {
    if (Number(current) !== expected) throw new ApiError(409, 'STALE_VERSION', `A ${label} mudou. Atualize e tente novamente.`);
  }

  function nextResourceVersion(current, label) {
    const value = Number(current);
    if (!Number.isInteger(value) || value < 1 || value >= 2147483647) {
      throw new ApiError(409, 'VERSION_EXHAUSTED', `A ${label} atingiu o limite de versões.`);
    }
    return value + 1;
  }

  async function lockWritableScene(tx, sceneId) {
    const scenes = await tx`SELECT * FROM wiki_posts WHERE id = ${sceneId} AND hidden_at IS NULL FOR UPDATE`;
    if (!scenes.length) throw new ApiError(404, 'NOT_FOUND', 'A cena solicitada não foi encontrada.');
    const marker = await tx`SELECT scene_id FROM scene_turn_migrations WHERE scene_id = ${sceneId}`;
    if (!marker.length) throw new ApiError(409, 'TURN_MIGRATION_PENDING', 'Esta cena está disponível apenas para leitura enquanto seus turnos são revisados.');
    return scenes[0];
  }

  async function publicSceneForWrite(tx, scene) {
    const [result] = await publicWikiPostsWithTurns(tx, [scene]);
    return result;
  }

  async function findSceneTurn(tx, sceneId, rawTurnId, lock = false) {
    const turnId = String(rawTurnId || '');
    if (!turnId || turnId.length > 80 || /[\u0000-\u001f\u007f]/.test(turnId)) {
      throw new ApiError(400, 'INVALID_TURN_ID', 'O identificador do turno é inválido.');
    }
    if (UUID_RE.test(turnId)) {
      const rows = await tx`
        SELECT st.*, u.username AS author_username FROM scene_turns st
        LEFT JOIN users u ON u.id = st.author_id
        WHERE st.scene_id = ${sceneId} AND (st.id = ${turnId.toLowerCase()} OR st.legacy_id = ${turnId})
        ${lock ? tx`FOR UPDATE OF st` : tx``}`;
      return rows[0] || null;
    }
    const rows = await tx`
      SELECT st.*, u.username AS author_username FROM scene_turns st
      LEFT JOIN users u ON u.id = st.author_id
      WHERE st.scene_id = ${sceneId} AND st.legacy_id = ${turnId}
      ${lock ? tx`FOR UPDATE OF st` : tx``}`;
    return rows[0] || null;
  }

  function turnForEditing(row) {
    const presentation = row.presentation && typeof row.presentation === 'object' ? row.presentation : {};
    return Object.assign({}, presentation, {
      id: row.legacy_id || row.id,
      authorId: row.author_id,
      authorName: row.author_username || row.legacy_author_label || 'Autoria não identificada',
      content: row.content,
    });
  }

  function turnPresentation(turn) {
    const presentation = Object.assign({}, turn);
    delete presentation.id;
    delete presentation.authorId;
    delete presentation.authorName;
    delete presentation.authorRole;
    delete presentation.authorAvatar;
    delete presentation.content;
    return presentation;
  }

  function lerWikiPostBody(body) {
    assertObjectShape(body, {
      allowedKeys: ['titulo', 'subtitulo', 'categoria', 'status', 'resumo', 'banner', 'descricao', 'theme', 'infobox', 'blocks', 'turns'],
      requiredKeys: ['titulo', 'descricao'],
    });
    const titulo = normalizeString(body.titulo, { field: 'titulo', min: 1, max: 200 });
    const subtitulo = normalizeString(body.subtitulo === undefined ? '' : body.subtitulo, { field: 'subtitulo', min: 0, max: 200 });
    const categoria = normalizeString(body.categoria === undefined ? 'Cena de RPG' : body.categoria, { field: 'categoria', min: 1, max: 80 });
    const status = normalizeString(body.status === undefined ? 'Em Andamento' : body.status, { field: 'status', min: 1, max: 80 });
    const resumo = normalizeString(body.resumo === undefined ? '' : body.resumo, { field: 'resumo', min: 0, max: 1_000 });
    const bannerInput = normalizeString(body.banner === undefined ? '' : body.banner, { field: 'banner', min: 0, max: 600 });
    const banner = bannerInput ? sanitizeUrl(bannerInput, { image: true }) : '';
    if (bannerInput && !banner) throw new ApiError(400, 'INVALID_BANNER', 'O banner deve usar uma URL HTTPS permitida.');
    const rawDescription = normalizeString(body.descricao, { field: 'descricao', min: 1, max: 300_000, trim: false });
    const descricao = sanitizeHtml(rawDescription, { maxBytes: 500_000 });
    if (!hasMeaningfulContent(descricao)) throw new ApiError(400, 'CONTENT_REQUIRED', 'O conteúdo principal não pode ficar vazio.');
    const theme = sanitizeTheme(body.theme);
    const infobox = sanitizeInfobox(body.infobox);
    const blocks = sanitizeSafeBlocks(body.blocks === undefined ? [] : body.blocks);
    if (Object.hasOwn(body, 'turns')) throw new ApiError(400, 'INITIAL_TURNS_NOT_ALLOWED', 'Turnos devem ser publicados separadamente após criar a cena.');
    const turns = [];
    return {
      valores: { titulo, subtitulo, categoria, status, resumo, banner, descricao, theme, infobox, blocks, turns },
    };
  }

  function sanitizeTurnBody(body, user, options = {}) {
    const fields = ['content', 'images', 'characterName', 'characterTitle', 'characterAvatar', 'turnTitle', 'location', 'banner', 'bannerStyle', 'oocNotes', 'accentColor', 'fontFamily'];
    assertObjectShape(body, { allowedKeys: fields, requiredKeys: ['content'] });
    const previous = options.previous || {};
    const value = Object.assign({}, previous, body);
    const rawContent = normalizeString(value.content, { field: 'content', min: 1, max: 150_000, trim: false });
    const content = sanitizeHtml(rawContent, { maxBytes: 500_000 });
    if (!hasMeaningfulContent(content)) throw new ApiError(400, 'CONTENT_REQUIRED', 'O texto do turno não pode ficar vazio.');
    const imagesInput = value.images === undefined ? [] : value.images;
    if (!Array.isArray(imagesInput) || imagesInput.length > 20) throw new ApiError(400, 'INVALID_IMAGES', 'Os anexos do turno são inválidos.');
    const images = imagesInput.map(function (image) {
      const item = typeof image === 'string' ? { url: image, caption: '' } : image;
      assertObjectShape(item, { allowedKeys: ['url', 'caption'], requiredKeys: ['url'] });
      const url = normalizeString(item.url, { field: 'images.url', min: 1, max: 600 });
      const safeUrl = sanitizeUrl(url, { image: true });
      if (!safeUrl) throw new ApiError(400, 'INVALID_IMAGE', 'Cada anexo deve usar uma URL HTTPS permitida.');
      return { url: safeUrl, caption: normalizeString(item.caption === undefined ? '' : item.caption, { field: 'images.caption', min: 0, max: 240 }) };
    });
    function textField(key, maximum) {
      return normalizeString(value[key] === undefined ? '' : value[key], { field: key, min: 0, max: maximum });
    }
    const avatarInput = textField('characterAvatar', 600);
    const bannerInput = textField('banner', 600);
    const characterAvatar = avatarInput ? sanitizeUrl(avatarInput, { image: true }) : '';
    const banner = bannerInput ? sanitizeUrl(bannerInput, { image: true }) : '';
    if ((avatarInput && !characterAvatar) || (bannerInput && !banner)) {
      throw new ApiError(400, 'INVALID_IMAGE', 'As imagens do turno devem usar URLs HTTPS permitidas.');
    }
    const bannerStyle = value.bannerStyle === undefined ? 'panoramic' : value.bannerStyle;
    const fontFamily = value.fontFamily === undefined ? 'serif' : value.fontFamily;
    if (!['panoramic', 'full', 'side'].includes(bannerStyle) || !['serif', 'sans', 'mono'].includes(fontFamily)) {
      throw new ApiError(400, 'INVALID_TURN_STYLE', 'O estilo visual do turno é inválido.');
    }
    const accentColor = value.accentColor === undefined || value.accentColor === '' ? '' : value.accentColor;
    if (accentColor && (typeof accentColor !== 'string' || !/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(accentColor))) {
      throw new ApiError(400, 'INVALID_TURN_STYLE', 'A cor do turno é inválida.');
    }
    return {
      id: options.previous ? String(previous.id) : require('node:crypto').randomUUID(),
      authorId: options.previous ? previous.authorId : (user ? user.id : null),
      authorName: options.previous ? previous.authorName : (user ? user.username : 'Viajante'),
      authorRole: options.previous ? previous.authorRole : (user ? user.role : 'member'),
      characterName: textField('characterName', 100),
      characterTitle: textField('characterTitle', 120),
      characterAvatar,
      turnTitle: textField('turnTitle', 160),
      location: textField('location', 120),
      banner,
      bannerStyle,
      images,
      content,
      oocNotes: textField('oocNotes', 4_000),
      accentColor: accentColor.toLowerCase(),
      fontFamily,
      date: options.previous ? previous.date : new Date().toISOString(),
      edited: !!options.previous,
    };
  }

  app.get('/api/wiki-posts', async function (req, res) {
    try {
      const rows = await sql`SELECT * FROM wiki_posts WHERE hidden_at IS NULL ORDER BY created_at DESC`;
      res.json({ wikiPosts: await publicWikiPostsWithTurns(sql, rows) });
    } catch (err) {
      return sendError(res, err);
    }
  });

  app.get('/api/wiki-posts/:id', async function (req, res) {
    try {
      const id = validateUuid(req.params.id);
      const rows = await sql`SELECT * FROM wiki_posts WHERE id = ${id} AND hidden_at IS NULL LIMIT 1`;
      if (!rows.length) return res.status(404).json({ error: 'Cena não encontrada.' });
      const [wikiPost] = await publicWikiPostsWithTurns(sql, rows);
      res.json({ wikiPost });
    } catch (err) {
      return sendError(res, err);
    }
  });

  app.get('/api/staff/wiki-posts/hidden', auth.requireIdentity, auth.requireRole('admin', 'moderador'), async function (_req, res) {
    try {
      const rows = await sql`SELECT * FROM wiki_posts WHERE hidden_at IS NOT NULL ORDER BY hidden_at DESC LIMIT 100`;
      res.json({ data: await publicWikiPostsWithTurns(sql, rows) });
    } catch (err) {
      return sendError(res, err);
    }
  });

  app.post('/api/wiki-posts', async function (req, res) {
    try {
      const { error, valores: v } = lerWikiPostBody(req.body);
      if (error) throw new ApiError(400, 'INVALID_SCENE', error);
      const emptyDigest = crypto.createHash('sha256').update('[]', 'utf8').digest('hex');
      const wikiPost = await withStaffTransaction(req, async (tx, user) => {
        const rows = await tx`
          INSERT INTO wiki_posts (id, author_id, titulo, subtitulo, categoria, status, resumo, banner, descricao, theme, infobox, blocks, turns)
          VALUES (${crypto.randomUUID()}, ${user.id}, ${v.titulo}, ${v.subtitulo}, ${v.categoria}, ${v.status}, ${v.resumo}, ${v.banner}, ${v.descricao}, ${tx.json(v.theme)}, ${tx.json(v.infobox)}, ${tx.json(v.blocks)}, ${tx.json([])})
          RETURNING *`;
        const scene = rows[0];
        await tx`INSERT INTO scene_turn_legacy_backups (scene_id, turns, legacy_sha256)
          VALUES (${scene.id}, ${tx.json([])}, ${emptyDigest})`;
        await tx`INSERT INTO scene_turn_migrations (scene_id, turn_count, legacy_sha256)
          VALUES (${scene.id}, 0, ${emptyDigest})`;
        return publicSceneForWrite(tx, scene);
      });
      res.status(201).json({ wikiPost });
    } catch (err) {
      return sendError(res, err);
    }
  });

  app.put('/api/wiki-posts/:id', async function (req, res) {
    try {
      const id = validateUuid(req.params.id);
      assertObjectShape(req.body, {
        allowedKeys: ['titulo', 'subtitulo', 'categoria', 'status', 'resumo', 'banner', 'descricao', 'theme', 'infobox', 'blocks', 'turns', 'expectedVersion'],
      });
      const version = expectedVersion(req.body.expectedVersion);
      const body = { ...req.body };
      delete body.expectedVersion;
      const { error, valores: v } = lerWikiPostBody(body);
      if (error) throw new ApiError(400, 'INVALID_SCENE', error);
      const wikiPost = await withStaffTransaction(req, async (tx) => {
        const current = await lockWritableScene(tx, id);
        assertCurrentVersion(current.version, version, 'cena');
        nextResourceVersion(current.version, 'cena');
        const rows = await tx`UPDATE wiki_posts SET
          titulo = ${v.titulo}, subtitulo = ${v.subtitulo}, categoria = ${v.categoria}, status = ${v.status},
          resumo = ${v.resumo}, banner = ${v.banner}, descricao = ${v.descricao},
          theme = ${tx.json(v.theme)}, infobox = ${tx.json(v.infobox)}, blocks = ${tx.json(v.blocks)},
          version = version + 1, updated_at = now()
          WHERE id = ${id} AND version = ${version} AND hidden_at IS NULL RETURNING *`;
        if (!rows.length) throw new ApiError(409, 'STALE_VERSION', 'A cena mudou. Atualize e tente novamente.');
        return publicSceneForWrite(tx, rows[0]);
      });
      res.json({ wikiPost });
    } catch (err) {
      return sendError(res, err);
    }
  });

  app.post('/api/wiki-posts/:id/hide', async function (req, res) {
    try {
      const id = validateUuid(req.params.id);
      assertObjectShape(req.body, { allowedKeys: ['expectedVersion'] });
      const version = expectedVersion(req.body.expectedVersion);
      const rows = await withStaffTransaction(req, async (tx) => {
        const current = await tx`SELECT version, hidden_at FROM wiki_posts WHERE id = ${id} FOR UPDATE`;
        if (!current.length || current[0].hidden_at) return [];
        assertCurrentVersion(current[0].version, version, 'cena');
        nextResourceVersion(current[0].version, 'cena');
        return tx`UPDATE wiki_posts SET hidden_at = now(), version = version + 1, updated_at = now()
          WHERE id = ${id} AND version = ${version} AND hidden_at IS NULL RETURNING id`;
      });
      if (rows.length === 0) return res.status(404).json({ error: 'Página não encontrada.' });
      res.json({ ok: true });
    } catch (err) {
      return sendError(res, err);
    }
  });

  app.post('/api/wiki-posts/:id/restore', auth.requireIdentity, auth.requireRole('admin', 'moderador'), async function (req, res) {
    try {
      const id = validateUuid(req.params.id);
      assertObjectShape(req.body, { allowedKeys: ['expectedVersion'] });
      const version = expectedVersion(req.body.expectedVersion);
      const wikiPost = await withStaffTransaction(req, async (tx) => {
        const current = await tx`SELECT * FROM wiki_posts WHERE id = ${id} AND hidden_at IS NOT NULL FOR UPDATE`;
        if (!current.length) throw new ApiError(404, 'NOT_FOUND', 'Cena oculta não encontrada.');
        assertCurrentVersion(current[0].version, version, 'cena');
        nextResourceVersion(current[0].version, 'cena');
        const rows = await tx`UPDATE wiki_posts SET hidden_at = NULL, version = version + 1, updated_at = now()
          WHERE id = ${id} AND version = ${version} RETURNING *`;
        return publicSceneForWrite(tx, rows[0]);
      });
      res.json({ data: wikiPost });
    } catch (err) {
      return sendError(res, err);
    }
  });

  app.post('/api/wiki-posts/:id/turns', async function (req, res) {
    try {
      const id = validateUuid(req.params.id);
      const result = await withMemberTransaction(req, async (tx, user) => {
        const existing = await lockWritableScene(tx, id);
        const turno = sanitizeTurnBody(req.body, user);
        const ordinalRows = await tx`SELECT COALESCE(max(ordinal), -1)::integer + 1 AS next_ordinal FROM scene_turns WHERE scene_id = ${id}`;
        const presentation = turnPresentation(turno);
        const turnRows = await tx`INSERT INTO scene_turns (
            id, scene_id, author_id, legacy_author_label, legacy_id, ordinal, content, presentation
          ) VALUES (${turno.id}, ${id}, ${user.id}, NULL, NULL, ${ordinalRows[0].next_ordinal}, ${turno.content}, ${tx.json(presentation)})
          RETURNING *`;
        const sceneRows = await tx`UPDATE wiki_posts SET version = version + 1, updated_at = now()
          WHERE id = ${id} RETURNING *`;
        nextResourceVersion(existing.version, 'cena');
        const wikiPost = await publicSceneForWrite(tx, sceneRows[0]);
        const createdTurn = wikiPost.turns.find((item) => String(item.id) === String(turnRows[0].id));
        return { wikiPost, turno: createdTurn };
      });
      res.status(201).json(result);
    } catch (err) {
      return sendError(res, err);
    }
  });

  app.put('/api/wiki-posts/:id/turns/:turnId', async function (req, res) {
    try {
      const id = validateUuid(req.params.id);
      assertObjectShape(req.body, {
        allowedKeys: ['content', 'images', 'characterName', 'characterTitle', 'characterAvatar', 'turnTitle', 'location', 'banner', 'bannerStyle', 'oocNotes', 'accentColor', 'fontFamily', 'expectedVersion'],
        requiredKeys: ['content'],
      });
      const version = expectedVersion(req.body.expectedVersion);
      const body = { ...req.body };
      delete body.expectedVersion;
      const result = await withMemberTransaction(req, async (tx, user) => {
        const scene = await lockWritableScene(tx, id);
        const row = await findSceneTurn(tx, id, req.params.turnId, true);
        if (!row || row.deleted_at) throw new ApiError(404, 'NOT_FOUND', 'O turno solicitado não foi encontrado.');
        assertCurrentVersion(row.version, version, 'turno');
        nextResourceVersion(row.version, 'turno');
        const oldTurn = turnForEditing(row);
        const canEdit = user.role === 'admin' || user.role === 'moderador' || String(row.author_id || '') === String(user.id);
        if (!canEdit) throw new ApiError(403, 'FORBIDDEN', 'Você não tem permissão para editar este turno.');
        const turno = sanitizeTurnBody(body, null, { previous: oldTurn });
        const rows = await tx`UPDATE scene_turns SET content = ${turno.content}, presentation = ${tx.json(turnPresentation(turno))},
          version = version + 1, updated_at = now()
          WHERE id = ${row.id} AND scene_id = ${id} AND version = ${version} AND deleted_at IS NULL RETURNING *`;
        if (!rows.length) throw new ApiError(409, 'STALE_VERSION', 'O turno mudou. Atualize e tente novamente.');
        nextResourceVersion(scene.version, 'cena');
        const sceneRows = await tx`UPDATE wiki_posts SET version = version + 1, updated_at = now() WHERE id = ${id} RETURNING *`;
        const wikiPost = await publicSceneForWrite(tx, sceneRows[0]);
        const updatedTurn = wikiPost.turns.find((item) => String(item.id) === String(row.legacy_id || row.id));
        return { wikiPost, turno: updatedTurn };
      });
      res.json(result);
    } catch (err) {
      return sendError(res, err);
    }
  });

  app.post('/api/wiki-posts/:id/turns/:turnId/hide', async function (req, res) {
    try {
      const id = validateUuid(req.params.id);
      assertObjectShape(req.body, { allowedKeys: ['expectedVersion'] });
      const version = expectedVersion(req.body.expectedVersion);
      const result = await withMemberTransaction(req, async (tx, user) => {
        const scene = await lockWritableScene(tx, id);
        const row = await findSceneTurn(tx, id, req.params.turnId, true);
        if (!row || row.deleted_at) throw new ApiError(404, 'NOT_FOUND', 'O turno solicitado não foi encontrado.');
        assertCurrentVersion(row.version, version, 'turno');
        nextResourceVersion(row.version, 'turno');
        const canHide = user.role === 'admin' || user.role === 'moderador' || String(row.author_id || '') === String(user.id);
        if (!canHide) throw new ApiError(403, 'FORBIDDEN', 'Você não tem permissão para ocultar este turno.');
        await tx`UPDATE scene_turns SET deleted_at = now(), version = version + 1, updated_at = now()
          WHERE id = ${row.id} AND scene_id = ${id} AND version = ${version} AND deleted_at IS NULL`;
        nextResourceVersion(scene.version, 'cena');
        const scenes = await tx`UPDATE wiki_posts SET version = version + 1, updated_at = now() WHERE id = ${id} RETURNING *`;
        return { wikiPost: await publicSceneForWrite(tx, scenes[0]) };
      });
      res.json(result);
    } catch (err) {
      return sendError(res, err);
    }
  });

  app.post('/api/wiki-posts/:id/turns/:turnId/restore', auth.requireIdentity, auth.requireRole('admin', 'moderador'), async function (req, res) {
    try {
      const id = validateUuid(req.params.id);
      assertObjectShape(req.body, { allowedKeys: ['expectedVersion'] });
      const version = expectedVersion(req.body.expectedVersion);
      const result = await withStaffTransaction(req, async (tx) => {
        const scene = await lockWritableScene(tx, id);
        const row = await findSceneTurn(tx, id, req.params.turnId, true);
        if (!row || !row.deleted_at) throw new ApiError(404, 'NOT_FOUND', 'Turno oculto não encontrado.');
        assertCurrentVersion(row.version, version, 'turno');
        nextResourceVersion(row.version, 'turno');
        await tx`UPDATE scene_turns SET deleted_at = NULL, version = version + 1, updated_at = now()
          WHERE id = ${row.id} AND scene_id = ${id} AND version = ${version} AND deleted_at IS NOT NULL`;
        nextResourceVersion(scene.version, 'cena');
        const scenes = await tx`UPDATE wiki_posts SET version = version + 1, updated_at = now() WHERE id = ${id} RETURNING *`;
        return { wikiPost: await publicSceneForWrite(tx, scenes[0]) };
      });
      res.json(result);
    } catch (err) {
      return sendError(res, err);
    }
  });

  app.use('/api/forum', createForumRouter({ sql, auth }));
  app.use('/api/admin', createLegacyImportRouter({ sql, auth }));
  app.use('/api/admin/wiki-transfers', createWikiTransfersRouter({ sql, auth }));
  app.use('/api/admin', createAdminRouter({ sql, auth }));
  app.use('/api', createWikiArticleFilesRouter({ sql, auth, sessionSecret: config.sessionSecret }));
  app.use('/api', createWikiSectionsRouter({ sql }));
  app.use('/api', createWikiRouter({ sql, auth }));
  app.use('/api', createProposalRouter({ sql, auth }));
  app.use('/api', createSourceRouter({ sql, auth }));
  app.use('/api', function (_req, res) {
    return sendError(res, new ApiError(404, 'NOT_FOUND', 'Rota não encontrada.'));
  });
  app.use(function (_req, res) {
    res.status(404).type('text/plain').send('Página não encontrada.');
  });
  app.use(errorMiddleware);

  return app;
}

module.exports = { createApp };
