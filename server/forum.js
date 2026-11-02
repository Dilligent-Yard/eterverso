'use strict';

const express = require('express');
const { createHash } = require('node:crypto');
const {
  hasMeaningfulContent,
  sanitizeHtml,
  sanitizeUrl,
  ContentValidationError,
} = require('./content');
const { publicAuthor } = require('./dto');
const { ApiError } = require('./errors');
const {
  MAX_POSTGRES_INTEGER,
  assertObjectShape,
  expectedVersion,
  normalizeString,
  paginationParams,
  validateUuid,
} = require('./validation');

const STAFF_ROLES = ['moderador', 'admin'];
const CONTENT_OPTIONS = Object.freeze({ maxBytes: 1_000_000 });
const NOT_FOUND = () => new ApiError(404, 'NOT_FOUND', 'O conteúdo solicitado não foi encontrado.');
const FORBIDDEN = () => new ApiError(403, 'FORBIDDEN', 'Você não tem permissão para esta ação.');

function createForumRouter(options = {}) {
  const { sql, auth } = options;
  if (typeof sql !== 'function' || typeof sql.begin !== 'function') {
    throw new TypeError('createForumRouter requires the injected postgres client.');
  }
  for (const method of ['requireIdentity', 'requireRole', 'withActorTransaction', 'assertRole']) {
    if (!auth || typeof auth[method] !== 'function') {
      throw new TypeError(`createForumRouter requires auth.${method}.`);
    }
  }

  const router = express.Router();

  router.get('/categories', asyncRoute(async (req, res) => {
    const query = assertQueryShape(req.query, ['limit', 'offset']);
    const { limit, offset } = paginationParams(query);
    const rows = await sql`
      SELECT c.id, c.name, c.description, c.archived_at, c.version,
             c.created_at, c.updated_at,
             (SELECT count(*)::bigint FROM threads t
              WHERE t.category_id = c.id AND t.quarantined_at IS NULL) AS topics_count,
             (SELECT count(*)::bigint FROM posts p
              JOIN threads t ON t.id = p.thread_id
              WHERE t.category_id = c.id AND t.quarantined_at IS NULL
                AND p.deleted_at IS NULL) AS posts_count
      FROM categories c
      WHERE c.archived_at IS NULL
      ORDER BY lower(c.name) ASC, c.id ASC
      LIMIT ${limit + 1} OFFSET ${offset}`;
    return res.json(pageResponse(rows, limit, offset, categoryDto));
  }));

  router.get('/categories/:id/threads', asyncRoute(async (req, res) => {
    const categoryId = validateUuid(req.params.id, 'id');
    const query = assertQueryShape(req.query, ['limit', 'offset', 'tag', 'search', 'includeArchived']);
    const { limit, offset } = paginationParams(query);
    const includeArchived = parseBooleanQuery(query.includeArchived, 'includeArchived');
    const tag = query.tag === undefined ? null : normalizeString(query.tag, {
      field: 'tag', min: 0, max: 20,
    });
    const search = query.search === undefined ? null : normalizeString(query.search, {
      field: 'search', min: 1, max: 100,
    });

    const categories = await sql`
      SELECT id, archived_at FROM categories WHERE id = ${categoryId} LIMIT 1`;
    if (!categories.length || (categories[0].archived_at && !includeArchived)) throw NOT_FOUND();

    const rows = await sql`
      SELECT t.id, t.category_id, t.author_id, t.author_label,
             u.username AS author_username, u.avatar AS author_avatar,
             u.title AS author_title, u.role AS author_role,
             c.name AS category_name, t.title, t.tag, t.pinned, t.locked,
             t.archived_at, t.version, t.last_activity_at, t.created_at,
             t.updated_at,
             (SELECT count(*)::bigint FROM posts p
              WHERE p.thread_id = t.id AND p.deleted_at IS NULL) AS post_count
      FROM threads t
      JOIN categories c ON c.id = t.category_id
      LEFT JOIN users u ON u.id = t.author_id
      WHERE t.category_id = ${categoryId}
        AND t.quarantined_at IS NULL
        AND (${includeArchived} OR (c.archived_at IS NULL AND t.archived_at IS NULL))
        AND (${tag}::text IS NULL OR t.tag = ${tag})
        AND (${search}::text IS NULL OR position(lower(${search}) in lower(t.title)) > 0)
      ORDER BY t.pinned DESC, t.last_activity_at DESC, t.id ASC
      LIMIT ${limit + 1} OFFSET ${offset}`;
    return res.json(pageResponse(rows, limit, offset, threadDto));
  }));

  router.get('/threads/:id', asyncRoute(async (req, res) => {
    const threadId = validateUuid(req.params.id, 'id');
    const rows = await loadThreadDto(sql, threadId);
    if (!rows.length) throw NOT_FOUND();
    return res.json({ data: threadDto(rows[0]) });
  }));

  router.get('/threads/:id/posts', asyncRoute(async (req, res) => {
    const threadId = validateUuid(req.params.id, 'id');
    const query = assertQueryShape(req.query, ['limit', 'offset']);
    const { limit, offset } = paginationParams(query);
    const threadRows = await sql`
      SELECT id FROM threads
      WHERE id = ${threadId} AND quarantined_at IS NULL
      LIMIT 1`;
    if (!threadRows.length) throw NOT_FOUND();

    const rows = await sql`
      SELECT p.id, p.thread_id, p.post_no, p.author_id, p.author_label,
             u.username AS author_username, u.avatar AS author_avatar,
             u.title AS author_title, u.role AS author_role,
             p.content, p.edited, p.deleted_at, p.version,
             p.created_at, p.updated_at
      FROM posts p
      LEFT JOIN users u ON u.id = p.author_id
      WHERE p.thread_id = ${threadId}
      ORDER BY p.post_no ASC, p.id ASC
      LIMIT ${limit + 1} OFFSET ${offset}`;
    return res.json(pageResponse(rows, limit, offset, postDto));
  }));

  router.post('/threads', auth.requireIdentity, asyncRoute(async (req, res) => {
    const body = assertObjectShape(req.body, {
      allowedKeys: ['categoryId', 'title', 'tag', 'content'],
      requiredKeys: ['categoryId', 'title', 'tag', 'content'],
    });
    const categoryId = validateUuid(body.categoryId, 'categoryId');
    const title = normalizeString(body.title, { field: 'title', min: 1, max: 200 });
    const tag = normalizeString(body.tag, { field: 'tag', min: 0, max: 20 });
    const content = acceptedPostContent(body.content);
    const idempotencyKey = readIdempotencyKey(req);
    const requestHash = hashPayload({ categoryId, title, tag, content });
    const result = await auth.withActorTransaction(req, async (tx, actor) => {
      const replay = await findReplay(tx, actor.id, 'forum.topic.create', idempotencyKey, requestHash);
      if (replay) return replayCreatedTopic(tx, replay.resourceIds);

      const category = await lockCategory(tx, categoryId);
      assertCategoryWritable(category);
      const threadRows = await tx`
        INSERT INTO threads (category_id, author_id, title, tag)
        VALUES (${categoryId}, ${actor.id}, ${title}, ${tag})
        RETURNING id`;
      const threadId = threadRows[0].id;
      const postRows = await tx`
        INSERT INTO posts (thread_id, author_id, content, post_no)
        VALUES (${threadId}, ${actor.id}, ${content}, 1)
        RETURNING id`;
      const postId = postRows[0].id;
      await insertRequestKey(tx, actor.id, 'forum.topic.create', idempotencyKey, requestHash, [threadId, postId]);
      return loadCreatedTopic(tx, threadId, postId);
    });
    return res.status(201).json({ data: result.data });
  }));

  router.post('/threads/:id/posts', auth.requireIdentity, asyncRoute(async (req, res) => {
    const threadId = validateUuid(req.params.id, 'id');
    const body = assertObjectShape(req.body, {
      allowedKeys: ['content'],
      requiredKeys: ['content'],
    });
    const content = acceptedPostContent(body.content);
    const idempotencyKey = readIdempotencyKey(req);
    const requestHash = hashPayload({ threadId, content });
    const result = await auth.withActorTransaction(req, async (tx, actor) => {
      const replay = await findReplay(tx, actor.id, 'forum.reply.create', idempotencyKey, requestHash);
      if (replay) return replayCreatedReply(tx, threadId, replay.resourceIds);

      const hint = await findThreadCategoryHint(tx, threadId);
      if (!hint) throw NOT_FOUND();
      const category = await lockCategory(tx, hint.categoryId);
      const thread = await lockThread(tx, threadId);
      assertThreadRelationship(thread, hint.categoryId);
      assertThreadPublicResource(thread);
      assertWritable(category, thread);
      const postNo = integerFromRow(thread.next_post_no, 'next_post_no');
      if (postNo >= MAX_POSTGRES_INTEGER) throw conflict('POST_SEQUENCE_EXHAUSTED', 'Esta conversa não pode receber novas respostas.');
      await tx`
        UPDATE threads
        SET next_post_no = ${postNo + 1}, last_activity_at = now(), updated_at = now()
        WHERE id = ${threadId}`;
      const posts = await tx`
        INSERT INTO posts (thread_id, author_id, content, post_no)
        VALUES (${threadId}, ${actor.id}, ${content}, ${postNo})
        RETURNING id`;
      const postId = posts[0].id;
      await insertRequestKey(tx, actor.id, 'forum.reply.create', idempotencyKey, requestHash, [threadId, postId]);
      const dto = await loadPostDto(tx, threadId, postId);
      return { replayed: false, data: dto };
    });
    return res.status(201).json({ data: result.data });
  }));

  router.patch('/threads/:id', auth.requireIdentity, asyncRoute(async (req, res) => {
    const threadId = validateUuid(req.params.id, 'id');
    const body = assertObjectShape(req.body, {
      allowedKeys: ['title', 'tag', 'expectedVersion'],
      requiredKeys: ['title', 'tag'],
    });
    const title = normalizeString(body.title, { field: 'title', min: 1, max: 200 });
    const tag = normalizeString(body.tag, { field: 'tag', min: 0, max: 20 });
    const version = expectedVersion(body.expectedVersion);
    const dto = await auth.withActorTransaction(req, async (tx, actor) => {
      const hint = await findThreadCategoryHint(tx, threadId);
      if (!hint) throw NOT_FOUND();
      const category = await lockCategory(tx, hint.categoryId);
      const thread = await lockThread(tx, threadId);
      assertThreadRelationship(thread, hint.categoryId);
      assertThreadPublicResource(thread);
      assertOwnerOrStaff(auth, actor, thread.author_id);
      assertWritable(category, thread);
      assertExpectedVersion(thread.version, version);
      const nextVersion = nextVersionOf(thread.version);
      await tx`
        UPDATE threads SET title = ${title}, tag = ${tag}, version = ${nextVersion}, updated_at = now()
        WHERE id = ${threadId}`;
      const rows = await loadThreadDto(tx, threadId);
      return threadDto(rows[0]);
    });
    return res.json({ data: dto });
  }));

  router.patch('/posts/:id', auth.requireIdentity, asyncRoute(async (req, res) => {
    const postId = validateUuid(req.params.id, 'id');
    const body = assertObjectShape(req.body, {
      allowedKeys: ['content', 'summary', 'expectedVersion'],
      requiredKeys: ['content', 'summary'],
    });
    const content = acceptedPostContent(body.content);
    const summary = normalizeString(body.summary, { field: 'summary', min: 1, max: 1_000 });
    const version = expectedVersion(body.expectedVersion);
    const dto = await auth.withActorTransaction(req, async (tx, actor) => {
      const hint = await findPostContextHint(tx, postId);
      if (!hint) throw NOT_FOUND();
      const category = await lockCategory(tx, hint.categoryId);
      const thread = await lockThread(tx, hint.threadId);
      assertThreadRelationship(thread, hint.categoryId);
      assertThreadPublicResource(thread);
      const post = await lockPost(tx, postId);
      assertPostRelationship(post, hint.threadId);
      if (post.deleted_at) throw NOT_FOUND();
      assertOwnerOrStaff(auth, actor, post.author_id);
      assertWritable(category, thread);
      assertExpectedVersion(post.version, version);
      const nextVersion = nextVersionOf(post.version);
      const previousContent = sanitizeStoredContent(post.content);
      await tx`
        INSERT INTO post_revisions (post_id, version, content, actor_id, summary)
        VALUES (${postId}, ${post.version}, ${previousContent}, ${actor.id}, ${summary})`;
      await tx`
        UPDATE posts
        SET content = ${content}, edited = true, version = ${nextVersion}, updated_at = now()
        WHERE id = ${postId}`;
      return loadPostDto(tx, thread.id, postId);
    });
    return res.json({ data: dto });
  }));

  router.post('/posts/:id/hide', auth.requireIdentity, asyncRoute(async (req, res) => {
    const postId = validateUuid(req.params.id, 'id');
    const body = assertObjectShape(req.body, {
      allowedKeys: ['reason', 'expectedVersion'],
      requiredKeys: ['reason'],
    });
    const reason = normalizeReason(body.reason);
    const version = expectedVersion(body.expectedVersion);
    const dto = await auth.withActorTransaction(req, async (tx, actor) => {
      const hint = await findPostContextHint(tx, postId);
      if (!hint) throw NOT_FOUND();
      const category = await lockCategory(tx, hint.categoryId);
      const thread = await lockThread(tx, hint.threadId);
      assertThreadRelationship(thread, hint.categoryId);
      assertThreadPublicResource(thread);
      const post = await lockPost(tx, postId);
      assertPostRelationship(post, hint.threadId);
      if (post.deleted_at) throw conflict('POST_ALREADY_HIDDEN', 'Esta publicação já está ocultada.');
      assertOwnerOrStaff(auth, actor, post.author_id);
      const staffAction = isStaff(auth, actor);
      if (!staffAction) {
        assertWritable(category, thread);
        if (Number(post.post_no) === 1) {
          throw new ApiError(403, 'OPENING_POST_PROTECTED', 'A primeira publicação da conversa não pode ser ocultada pelo autor.');
        }
      }
      assertExpectedVersion(post.version, version);
      const nextVersion = nextVersionOf(post.version);
      await tx`
        UPDATE posts SET deleted_at = now(), version = ${nextVersion}, updated_at = now()
        WHERE id = ${postId}`;
      await refreshThreadActivity(tx, thread.id);
      await writeAuditEvent(tx, actor, 'forum.post.hide', 'post', postId, reason,
        { deleted: false, version: Number(post.version) },
        { deleted: true, version: nextVersion });
      return loadPostDto(tx, thread.id, postId);
    });
    return res.json({ data: dto });
  }));

  router.post('/posts/:id/restore', auth.requireIdentity, auth.requireRole(...STAFF_ROLES), asyncRoute(async (req, res) => {
    const postId = validateUuid(req.params.id, 'id');
    const body = assertObjectShape(req.body, {
      allowedKeys: ['reason', 'expectedVersion'],
      requiredKeys: ['reason'],
    });
    const reason = normalizeReason(body.reason);
    const version = expectedVersion(body.expectedVersion);
    const dto = await auth.withActorTransaction(req, async (tx, actor) => {
      auth.assertRole(actor, ...STAFF_ROLES);
      const hint = await findPostContextHint(tx, postId);
      if (!hint) throw NOT_FOUND();
      await lockCategory(tx, hint.categoryId);
      const thread = await lockThread(tx, hint.threadId);
      assertThreadRelationship(thread, hint.categoryId);
      assertThreadPublicResource(thread);
      const post = await lockPost(tx, postId);
      assertPostRelationship(post, hint.threadId);
      if (!post.deleted_at) throw conflict('POST_NOT_HIDDEN', 'Esta publicação não está ocultada.');
      assertExpectedVersion(post.version, version);
      const nextVersion = nextVersionOf(post.version);
      const restoredContent = sanitizeRestorableContent(post.content);
      await tx`
        UPDATE posts
        SET content = ${restoredContent}, deleted_at = NULL, version = ${nextVersion}, updated_at = now()
        WHERE id = ${postId}`;
      await refreshThreadActivity(tx, thread.id);
      await writeAuditEvent(tx, actor, 'forum.post.restore', 'post', postId, reason,
        { deleted: true, version: Number(post.version) },
        { deleted: false, version: nextVersion });
      return loadPostDto(tx, thread.id, postId);
    });
    return res.json({ data: dto });
  }));

  router.post('/threads/:id/moderate', auth.requireIdentity, auth.requireRole(...STAFF_ROLES), asyncRoute(async (req, res) => {
    const threadId = validateUuid(req.params.id, 'id');
    const body = assertObjectShape(req.body, {
      allowedKeys: ['action', 'targetCategoryId', 'reason', 'expectedVersion'],
      requiredKeys: ['action', 'reason'],
    });
    const action = normalizeString(body.action, { field: 'action', min: 1, max: 20 });
    const reason = normalizeReason(body.reason);
    const version = expectedVersion(body.expectedVersion);
    const actions = new Set(['pin', 'unpin', 'lock', 'unlock', 'archive', 'unarchive', 'move']);
    if (!actions.has(action)) throw new ApiError(400, 'INVALID_VALUE', 'A ação de moderação é inválida.', { field: 'action' });
    if (action === 'move' && body.targetCategoryId === undefined) {
      throw new ApiError(400, 'INVALID_SHAPE', 'A ação de movimentação exige uma categoria de destino.', { field: 'targetCategoryId' });
    }
    if (action !== 'move' && body.targetCategoryId !== undefined) {
      throw new ApiError(400, 'INVALID_SHAPE', 'Esta ação não aceita uma categoria de destino.', { field: 'targetCategoryId' });
    }
    const targetCategoryId = action === 'move'
      ? validateUuid(body.targetCategoryId, 'targetCategoryId')
      : null;
    const dto = await auth.withActorTransaction(req, async (tx, actor) => {
      auth.assertRole(actor, ...STAFF_ROLES);
      const hint = await findThreadCategoryHint(tx, threadId);
      if (!hint) throw NOT_FOUND();
      const categoryIds = [...new Set([hint.categoryId, targetCategoryId].filter(Boolean))].sort();
      const categories = new Map();
      for (const categoryId of categoryIds) categories.set(categoryId, await lockCategory(tx, categoryId));
      const thread = await lockThread(tx, threadId);
      assertThreadRelationship(thread, hint.categoryId);
      assertThreadPublicResource(thread);
      assertExpectedVersion(thread.version, version);
      if (targetCategoryId && categories.get(targetCategoryId).archived_at) {
        throw conflict('CATEGORY_ARCHIVED', 'A categoria de destino está arquivada.');
      }

      const before = moderationState(thread);
      const after = { ...before };
      switch (action) {
        case 'pin': after.pinned = true; break;
        case 'unpin': after.pinned = false; break;
        case 'lock': after.locked = true; break;
        case 'unlock': after.locked = false; break;
        case 'archive': after.archived = true; break;
        case 'unarchive': after.archived = false; break;
        case 'move': after.categoryId = targetCategoryId; break;
      }
      const changed = !sameModerationState(before, after);
      if (changed) {
        const nextVersion = nextVersionOf(thread.version);
        await tx`
          UPDATE threads SET
            category_id = ${after.categoryId},
            pinned = ${after.pinned},
            locked = ${after.locked},
            archived_at = ${action === 'archive' ? tx`now()` : action === 'unarchive' ? null : thread.archived_at},
            version = ${nextVersion}, updated_at = now()
          WHERE id = ${threadId}`;
        after.version = nextVersion;
        await writeAuditEvent(tx, actor, `forum.thread.${action}`, 'thread', threadId, reason, before, after);
      }
      const rows = await loadThreadDto(tx, threadId);
      return threadDto(rows[0]);
    });
    return res.json({ data: dto });
  }));

  return router;
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function assertQueryShape(query, allowedKeys) {
  if (!query || typeof query !== 'object' || Array.isArray(query)) {
    throw new ApiError(400, 'INVALID_SHAPE', 'Os parâmetros da solicitação são inválidos.');
  }
  const keys = Object.keys(query);
  const unknownKeys = keys.filter((key) => !allowedKeys.includes(key));
  if (unknownKeys.length) {
    throw new ApiError(400, 'INVALID_SHAPE', 'A solicitação contém parâmetros não permitidos.', { unknownKeys });
  }
  for (const key of keys) {
    if (Array.isArray(query[key]) || (query[key] !== undefined && typeof query[key] !== 'string' && typeof query[key] !== 'number')) {
      throw new ApiError(400, 'INVALID_VALUE', 'Um parâmetro da solicitação é inválido.', { field: key });
    }
  }
  return query;
}

function parseBooleanQuery(value, field) {
  if (value === undefined || value === 'false') return false;
  if (value === 'true') return true;
  throw new ApiError(400, 'INVALID_VALUE', 'Um parâmetro da solicitação é inválido.', { field });
}

function readIdempotencyKey(req) {
  const raw = typeof req.get === 'function' ? req.get('Idempotency-Key') : req.headers?.['idempotency-key'];
  if (raw === undefined) throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'A chave de repetição da solicitação é obrigatória.', { field: 'Idempotency-Key' });
  return validateUuid(raw, 'Idempotency-Key');
}

function acceptedPostContent(value) {
  if (typeof value !== 'string') {
    throw new ApiError(400, 'INVALID_VALUE', 'O conteúdo da publicação deve ser um texto válido.', { field: 'content' });
  }
  const length = Array.from(value).length;
  if (length < 1) throw new ApiError(400, 'INVALID_LENGTH', 'O conteúdo da publicação não pode ficar vazio.', { field: 'content' });
  if (length > 250_000) throw new ApiError(413, 'CONTENT_TOO_LARGE', 'O conteúdo enviado excede o limite permitido.', { field: 'content', max: 250_000 });
  if (Buffer.byteLength(value, 'utf8') > CONTENT_OPTIONS.maxBytes) {
    throw new ApiError(413, 'CONTENT_TOO_LARGE', 'O conteúdo enviado excede o limite permitido.', { field: 'content', max: 250_000 });
  }
  try {
    const safe = sanitizeHtml(value, CONTENT_OPTIONS);
    if (!hasMeaningfulContent(safe, CONTENT_OPTIONS)) {
      throw new ApiError(400, 'EMPTY_CONTENT', 'A publicação precisa conter texto ou uma imagem válida.', { field: 'content' });
    }
    return safe;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof ContentValidationError) {
      throw new ApiError(400, 'INVALID_CONTENT', 'O conteúdo da publicação não pôde ser validado.', { field: 'content' });
    }
    throw error;
  }
}

function normalizeReason(value) {
  const reason = normalizeString(value, { field: 'reason', min: 1, max: 1_000 });
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f<>]/u.test(reason)) {
    throw new ApiError(400, 'INVALID_VALUE', 'O motivo deve ser texto simples.', { field: 'reason' });
  }
  return reason;
}

function hashPayload(value) {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

async function findReplay(tx, actorId, operation, key, requestHash) {
  const rows = await tx`
    SELECT request_hash, resource_ids FROM request_keys
    WHERE actor_id = ${actorId} AND operation = ${operation} AND idempotency_key = ${key}
    LIMIT 1`;
  if (!rows.length) return null;
  if (rows[0].request_hash !== requestHash) {
    throw conflict('IDEMPOTENCY_CONFLICT', 'Esta chave já foi usada com outra solicitação.');
  }
  const resourceIds = rows[0].resource_ids;
  if (!Array.isArray(resourceIds) || resourceIds.some((id) => typeof id !== 'string')) throw NOT_FOUND();
  return { resourceIds };
}

async function insertRequestKey(tx, actorId, operation, idempotencyKey, requestHash, resourceIds) {
  await tx`
    INSERT INTO request_keys (actor_id, operation, idempotency_key, request_hash, resource_ids)
    VALUES (${actorId}, ${operation}, ${idempotencyKey}, ${requestHash}, ${tx.json(resourceIds)})`;
}

async function replayCreatedTopic(tx, resourceIds) {
  if (resourceIds.length !== 2) throw NOT_FOUND();
  const result = await loadCreatedTopic(tx, validateUuid(resourceIds[0]), validateUuid(resourceIds[1]));
  if (result.data.openingPost.deleted) throw NOT_FOUND();
  return { ...result, replayed: true };
}

async function replayCreatedReply(tx, threadId, resourceIds) {
  if (resourceIds.length !== 2 || String(resourceIds[0]).toLowerCase() !== threadId) throw NOT_FOUND();
  const postId = validateUuid(resourceIds[1]);
  const dto = await loadPostDto(tx, threadId, postId, { visibleOnly: true });
  return { replayed: true, data: dto };
}

async function loadCreatedTopic(tx, threadId, postId) {
  const threadRows = await loadThreadDto(tx, threadId);
  const openingPost = await loadPostDto(tx, threadId, postId);
  if (!threadRows.length || !openingPost || openingPost.postNo !== 1) throw NOT_FOUND();
  return {
    replayed: false,
    data: { thread: threadDto(threadRows[0]), openingPost },
  };
}

async function loadThreadDto(sql, threadId) {
  return sql`
    SELECT t.id, t.category_id, t.author_id, t.author_label,
           u.username AS author_username, u.avatar AS author_avatar,
           u.title AS author_title, u.role AS author_role,
           c.name AS category_name, t.title, t.tag, t.pinned, t.locked,
           t.archived_at, t.version, t.last_activity_at, t.created_at,
           t.updated_at,
           (SELECT count(*)::bigint FROM posts p
            WHERE p.thread_id = t.id AND p.deleted_at IS NULL) AS post_count
    FROM threads t
    JOIN categories c ON c.id = t.category_id
    LEFT JOIN users u ON u.id = t.author_id
    WHERE t.id = ${threadId} AND t.quarantined_at IS NULL
    LIMIT 1`;
}

async function loadPostDto(sql, threadId, postId, options = {}) {
  const rows = await sql`
    SELECT p.id, p.thread_id, p.post_no, p.author_id, p.author_label,
           u.username AS author_username, u.avatar AS author_avatar,
           u.title AS author_title, u.role AS author_role,
           p.content, p.edited, p.deleted_at, p.version,
           p.created_at, p.updated_at
    FROM posts p
    JOIN threads t ON t.id = p.thread_id
    LEFT JOIN users u ON u.id = p.author_id
    WHERE p.id = ${postId} AND p.thread_id = ${threadId}
      AND t.quarantined_at IS NULL
      ${options.visibleOnly ? sql`AND p.deleted_at IS NULL` : sql``}
    LIMIT 1`;
  if (!rows.length) throw NOT_FOUND();
  return postDto(rows[0]);
}

async function findThreadCategoryHint(tx, threadId) {
  const rows = await tx`SELECT category_id FROM threads WHERE id = ${threadId} LIMIT 1`;
  return rows.length ? { categoryId: validateUuid(rows[0].category_id, 'categoryId') } : null;
}

async function findPostContextHint(tx, postId) {
  const rows = await tx`
    SELECT p.thread_id, t.category_id
    FROM posts p JOIN threads t ON t.id = p.thread_id
    WHERE p.id = ${postId} LIMIT 1`;
  if (!rows.length) return null;
  return {
    threadId: validateUuid(rows[0].thread_id, 'threadId'),
    categoryId: validateUuid(rows[0].category_id, 'categoryId'),
  };
}

async function lockCategory(tx, categoryId) {
  const rows = await tx`
    SELECT id, archived_at, version FROM categories WHERE id = ${categoryId} FOR UPDATE`;
  if (!rows.length) throw NOT_FOUND();
  return rows[0];
}

async function lockThread(tx, threadId) {
  const rows = await tx`
    SELECT id, category_id, author_id, title, tag, pinned, locked, archived_at,
           quarantined_at, version, next_post_no, last_activity_at
    FROM threads WHERE id = ${threadId} FOR UPDATE`;
  if (!rows.length) throw NOT_FOUND();
  return rows[0];
}

async function lockPost(tx, postId) {
  const rows = await tx`
    SELECT id, thread_id, post_no, author_id, content, deleted_at, version
    FROM posts WHERE id = ${postId} FOR UPDATE`;
  if (!rows.length) throw NOT_FOUND();
  return rows[0];
}

function assertThreadRelationship(thread, hintedCategoryId) {
  if (String(thread.category_id).toLowerCase() !== hintedCategoryId) {
    throw conflict('THREAD_MOVED', 'A conversa mudou de categoria. Atualize e tente novamente.');
  }
}

function assertPostRelationship(post, hintedThreadId) {
  if (String(post.thread_id).toLowerCase() !== hintedThreadId) {
    throw conflict('POST_MOVED', 'A publicação mudou de conversa. Atualize e tente novamente.');
  }
}

function assertThreadPublicResource(thread) {
  if (thread.quarantined_at) throw NOT_FOUND();
}

function assertCategoryWritable(category) {
  if (category.archived_at) throw conflict('CATEGORY_ARCHIVED', 'A categoria está arquivada e não aceita alterações.');
}

function assertWritable(category, thread) {
  assertCategoryWritable(category);
  if (thread.locked) throw conflict('THREAD_LOCKED', 'A conversa está bloqueada e não aceita alterações.');
  if (thread.archived_at) throw conflict('THREAD_ARCHIVED', 'A conversa está arquivada e não aceita alterações.');
}

function assertOwnerOrStaff(auth, actor, ownerId) {
  if (ownerId && String(ownerId).toLowerCase() === String(actor.id).toLowerCase()) return;
  if (isStaff(auth, actor)) return;
  throw FORBIDDEN();
}

function isStaff(auth, actor) {
  try {
    auth.assertRole(actor, ...STAFF_ROLES);
    return true;
  } catch (error) {
    if (error && error.status === 403) return false;
    throw error;
  }
}

function assertExpectedVersion(current, expected) {
  if (Number(current) !== expected) throw conflict('STALE_VERSION', 'O conteúdo foi alterado. Atualize antes de salvar.');
}

function nextVersionOf(current) {
  const version = Number(current);
  if (!Number.isInteger(version) || version < 1 || version >= MAX_POSTGRES_INTEGER) {
    throw conflict('VERSION_EXHAUSTED', 'Este conteúdo atingiu o limite de versões.');
  }
  return version + 1;
}

function integerFromRow(value, field) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > MAX_POSTGRES_INTEGER) {
    throw new ApiError(409, 'INVALID_STORED_STATE', 'A conversa precisa de revisão antes de receber alterações.', { field });
  }
  return number;
}

async function refreshThreadActivity(tx, threadId) {
  await tx`
    UPDATE threads SET last_activity_at = COALESCE(
      (SELECT max(created_at) FROM posts WHERE thread_id = ${threadId} AND deleted_at IS NULL),
      created_at
    ), updated_at = now()
    WHERE id = ${threadId}`;
}

async function writeAuditEvent(tx, actor, action, targetType, targetId, reason, beforeState, afterState) {
  await tx`
    INSERT INTO audit_events (actor_id, action, target_type, target_id, reason, before_state, after_state)
    VALUES (${actor.id}, ${action}, ${targetType}, ${targetId}, ${reason},
      ${tx.json(beforeState)}, ${tx.json(afterState)})`;
}

function moderationState(thread) {
  return {
    categoryId: String(thread.category_id).toLowerCase(),
    pinned: Boolean(thread.pinned),
    locked: Boolean(thread.locked),
    archived: !!thread.archived_at,
    version: Number(thread.version),
  };
}

function sameModerationState(left, right) {
  return left.categoryId === right.categoryId
    && left.pinned === right.pinned
    && left.locked === right.locked
    && left.archived === right.archived;
}

function conflict(code, message) {
  return new ApiError(409, code, message);
}

function categoryDto(row) {
  return {
    id: validateUuid(row.id),
    name: row.name,
    description: row.description || '',
    archivedAt: isoTimestamp(row.archived_at),
    version: Number(row.version),
    createdAt: isoTimestamp(row.created_at),
    updatedAt: isoTimestamp(row.updated_at),
    topicsCount: countValue(row.topics_count),
    postsCount: countValue(row.posts_count),
  };
}

function threadDto(row) {
  const dto = {
    id: validateUuid(row.id),
    categoryId: validateUuid(row.category_id, 'categoryId'),
    categoryName: row.category_name,
    title: row.title,
    tag: row.tag || '',
    pinned: Boolean(row.pinned),
    locked: Boolean(row.locked),
    archivedAt: isoTimestamp(row.archived_at),
    version: Number(row.version),
    lastActivityAt: isoTimestamp(row.last_activity_at),
    createdAt: isoTimestamp(row.created_at),
    updatedAt: isoTimestamp(row.updated_at),
    postsCount: countValue(row.post_count),
  };
  addAuthor(dto, row);
  return dto;
}

function postDto(row) {
  const dto = {
    id: validateUuid(row.id),
    threadId: validateUuid(row.thread_id, 'threadId'),
    postNo: Number(row.post_no),
    version: Number(row.version),
    edited: Boolean(row.edited),
    deleted: !!row.deleted_at,
    deletedAt: isoTimestamp(row.deleted_at),
    createdAt: isoTimestamp(row.created_at),
    updatedAt: isoTimestamp(row.updated_at),
  };
  if (!row.deleted_at) dto.content = sanitizeStoredContent(row.content);
  addAuthor(dto, row);
  return dto;
}

function addAuthor(dto, row) {
  if (row.author_id) {
    dto.author = publicAuthor({
      id: row.author_id,
      username: row.author_username,
      avatar: sanitizeUrl(row.author_avatar || '', { image: true }) || '',
      title: row.author_title || '',
      role: row.author_role,
    });
  } else {
    dto.author = null;
    if (typeof row.author_label === 'string' && row.author_label.length) dto.authorLabel = row.author_label;
  }
}

function sanitizeStoredContent(value) {
  if (typeof value !== 'string') return '<p>Conteúdo indisponível para visualização segura.</p>';
  try {
    return sanitizeHtml(value, CONTENT_OPTIONS);
  } catch (_error) {
    return '<p>Conteúdo indisponível para visualização segura.</p>';
  }
}

function sanitizeRestorableContent(value) {
  if (typeof value !== 'string') throw conflict('CONTENT_UNRESTORABLE', 'A publicação precisa ser revisada antes de ser restaurada.');
  try {
    const safe = sanitizeHtml(value, CONTENT_OPTIONS);
    if (!hasMeaningfulContent(safe, CONTENT_OPTIONS)) throw new Error('empty');
    return safe;
  } catch (_error) {
    throw conflict('CONTENT_UNRESTORABLE', 'A publicação precisa ser revisada antes de ser restaurada.');
  }
}

function pageResponse(rows, limit, offset, mapper) {
  const hasMore = rows.length > limit;
  return {
    data: rows.slice(0, limit).map(mapper),
    page: {
      limit,
      offset,
      hasMore,
    },
  };
}

function countValue(value) {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) throw new TypeError('A count query returned an invalid integer.');
  return count;
}

function isoTimestamp(value) {
  if (value === null || value === undefined) return null;
  let date;
  if (value instanceof Date) date = value;
  else if (typeof value === 'string') {
    const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)
      ? value
      : `${value.replace(' ', 'T')}Z`;
    date = new Date(normalized);
  }
  if (!date || Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

module.exports = { createForumRouter };
