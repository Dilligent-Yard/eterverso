'use strict';

const express = require('express');
const { ApiError } = require('./errors');
const { adminUser } = require('./dto');
const {
  MAX_POSTGRES_INTEGER, assertObjectShape, expectedVersion, normalizeString,
  paginationParams, validateUuid,
} = require('./validation');

// Shared by every account-role/disable operation and the operator bootstrap.
// These two int32 keys identify the application-wide administrator membership set.
const ADMIN_SET_LOCK = Object.freeze([1163150674, 1094995283]);
const ROLES = new Set(['member', 'moderador', 'admin']);

async function lockAdminSet(tx) {
  await tx`SELECT pg_advisory_xact_lock(${ADMIN_SET_LOCK[0]}, ${ADMIN_SET_LOCK[1]})`;
}

function conflict(code, message) { return new ApiError(409, code, message); }
function notFound() { return new ApiError(404, 'NOT_FOUND', 'O registro solicitado não foi encontrado.'); }
function nextVersion(version) {
  if (!Number.isInteger(version) || version < 1 || version >= MAX_POSTGRES_INTEGER) {
    throw conflict('VERSION_EXHAUSTED', 'Este registro atingiu o limite de versões.');
  }
  return version + 1;
}
function checkVersion(actual, supplied) {
  if (actual !== supplied) throw conflict('STALE_VERSION', 'O registro mudou. Atualize antes de salvar.');
}
function reasonOf(value) { return normalizeString(value, { field: 'reason', min: 1, max: 1000 }); }
function accountState(user) {
  return { role: user.role, disabledAt: user.disabled_at, version: user.version };
}
function categoryDto(category) {
  return {
    id: category.id, name: category.name, description: category.description,
    archivedAt: category.archived_at, version: category.version,
    createdAt: category.created_at, updatedAt: category.updated_at,
  };
}
function categoryState(category) {
  return { name: category.name, archived: category.archived_at !== null, version: category.version };
}
function collection(rows, limit, offset, dto) {
  return { data: rows.slice(0, limit).map(dto), page: { limit, offset, hasMore: rows.length > limit } };
}
function queryPage(query) {
  assertObjectShape(query, { allowedKeys: ['limit', 'offset'] });
  return paginationParams(query);
}
function route(handler) {
  return (req, res, next) => Promise.resolve().then(() => handler(req, res)).catch(next);
}
async function appendAudit(tx, actorId, actorLabel, action, type, targetId, reason, before, after) {
  await tx`
    INSERT INTO audit_events (actor_id, actor_label, action, target_type, target_id, reason, before_state, after_state)
    VALUES (${actorId}, ${actorLabel}, ${action}, ${type}, ${targetId}, ${reason}, ${tx.json(before)}, ${tx.json(after)})`;
}

function auditState(value) {
  // Do not pass arbitrary historical JSON through the administrative directory.
  const allowed = ['role', 'disabledAt', 'version', 'name', 'archived', 'categoryId', 'pinned', 'locked', 'deleted'];
  const safe = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return safe;
  for (const key of allowed) {
    const item = value[key];
    if (item === null || typeof item === 'boolean' || (typeof item === 'number' && Number.isSafeInteger(item))) safe[key] = item;
    else if (typeof item === 'string' && item.length <= 200) safe[key] = item;
  }
  return safe;
}
function auditDto(row) {
  return {
    id: row.id, actorId: row.actor_id, actorLabel: row.actor_label,
    action: row.action, targetType: row.target_type, targetId: row.target_id,
    reason: row.reason, beforeState: auditState(row.before_state),
    afterState: auditState(row.after_state), createdAt: row.created_at,
  };
}

/** Mount with app.use('/api/admin', createAdminRouter({ sql, auth })).
 * The app owns cookie-session, JSON, CSRF protection and the final error handler.
 * Account mutation: { role OR disabled:boolean, reason, expectedVersion }.
 * Category create/edit: { name, description, reason, expectedVersion? }.
 */
function createAdminRouter({ sql, auth } = {}) {
  if (typeof sql !== 'function' || typeof sql.begin !== 'function') throw new TypeError('An injected SQL client is required.');
  for (const key of ['requireIdentity', 'requireRole', 'assertRole', 'withActorTransaction', 'clearSession']) {
    if (!auth || typeof auth[key] !== 'function') throw new TypeError(`auth.${key} is required.`);
  }
  const router = express.Router();
  router.use(auth.requireIdentity, auth.requireRole('admin'));
  const withAdmin = (req, callback, options) => auth.withActorTransaction(req, (tx, actor) => {
    auth.assertRole(actor, 'admin');
    return callback(tx, actor);
  }, options);

  router.get('/users', route(async (req, res) => {
    const { limit, offset } = queryPage(req.query);
    const rows = await sql`
      SELECT id, username, email, role, disabled_at, version, join_date
      FROM users ORDER BY lower(username), id LIMIT ${limit + 1} OFFSET ${offset}`;
    res.json(collection(rows, limit, offset, adminUser));
  }));

  router.patch('/users/:id', route(async (req, res) => {
    const id = validateUuid(req.params.id);
    assertObjectShape(req.body, { allowedKeys: ['role', 'disabled', 'reason', 'expectedVersion'], requiredKeys: ['reason'] });
    const version = expectedVersion(req.body.expectedVersion);
    const reason = reasonOf(req.body.reason);
    const roleChange = Object.hasOwn(req.body, 'role');
    if (roleChange === Object.hasOwn(req.body, 'disabled')) {
      throw new ApiError(400, 'ONE_ACCOUNT_ACTION_REQUIRED', 'Escolha somente uma alteração de cargo ou de acesso.');
    }
    if (roleChange ? !ROLES.has(req.body.role) : typeof req.body.disabled !== 'boolean') {
      throw new ApiError(400, 'INVALID_ACCOUNT_ACTION', 'A alteração de conta é inválida.');
    }
    const updated = await withAdmin(req, async (tx, actor) => {
      const rows = await tx`
        SELECT id, username, email, role, disabled_at, auth_version, version, join_date
        FROM users WHERE id = ${id}`;
      if (!rows.length) throw notFound();
      const current = rows[0];
      checkVersion(current.version, version);
      const role = roleChange ? req.body.role : current.role;
      const disabled = roleChange ? current.disabled_at !== null : req.body.disabled;
      if (role === current.role && disabled === (current.disabled_at !== null)) {
        throw conflict('STATE_UNCHANGED', 'A conta já está no estado solicitado.');
      }
      const next = nextVersion(current.version);
      const authVersion = nextVersion(current.auth_version);
      if (current.role === 'admin' && current.disabled_at === null && (role !== 'admin' || disabled)) {
        const counts = await tx`SELECT count(*)::integer AS count FROM users WHERE role = 'admin' AND disabled_at IS NULL`;
        if (counts[0].count <= 1) throw conflict('LAST_ACTIVE_ADMIN', 'É necessário manter pelo menos um administrador ativo.');
      }
      const result = await tx`
        UPDATE users SET role = ${role}, disabled_at = CASE WHEN ${disabled} THEN COALESCE(disabled_at, now()) ELSE NULL END,
          version = ${next}, auth_version = ${authVersion}, updated_at = now()
        WHERE id = ${id}
        RETURNING id, username, email, role, disabled_at, version, join_date`;
      await appendAudit(tx, actor.id, null, roleChange ? 'admin.user.role' : (disabled ? 'admin.user.disable' : 'admin.user.enable'),
        'user', id, reason, accountState(current), accountState(result[0]));
      return { user: result[0], expireSelf: actor.id === id };
    }, {
      beforeActorLock: async (tx) => {
        await lockAdminSet(tx);
        // Lock the actor AND target in one deterministic order, before the
        // normal wrapper revalidates the actor. Never actor-first here.
        await tx`SELECT id FROM users WHERE id IN (${req.session.userId}, ${id}) ORDER BY id FOR UPDATE`;
      },
    });
    if (updated.expireSelf) auth.clearSession(req);
    res.json({ data: adminUser(updated.user) });
  }));

  router.get('/categories', route(async (req, res) => {
    const { limit, offset } = queryPage(req.query);
    const rows = await sql`SELECT * FROM categories ORDER BY lower(name), id LIMIT ${limit + 1} OFFSET ${offset}`;
    res.json(collection(rows, limit, offset, categoryDto));
  }));

  router.post('/categories', route(async (req, res) => {
    assertObjectShape(req.body, { allowedKeys: ['name', 'description', 'reason'], requiredKeys: ['name', 'reason'] });
    const name = normalizeString(req.body.name, { field: 'name', min: 1, max: 100 });
    const description = normalizeString(req.body.description === undefined ? '' : req.body.description, { field: 'description', min: 0, max: 1000 });
    const reason = reasonOf(req.body.reason);
    const category = await withAdmin(req, async (tx, actor) => {
      const rows = await tx`INSERT INTO categories (name, description) VALUES (${name}, ${description}) RETURNING *`;
      await appendAudit(tx, actor.id, null, 'admin.category.create', 'category', rows[0].id, reason, {}, categoryState(rows[0]));
      return rows[0];
    });
    res.status(201).json({ data: categoryDto(category) });
  }));

  router.patch('/categories/:id', route(async (req, res) => {
    const id = validateUuid(req.params.id);
    assertObjectShape(req.body, { allowedKeys: ['name', 'description', 'reason', 'expectedVersion'], requiredKeys: ['reason'] });
    const version = expectedVersion(req.body.expectedVersion);
    const reason = reasonOf(req.body.reason);
    if (!Object.hasOwn(req.body, 'name') && !Object.hasOwn(req.body, 'description')) throw new ApiError(400, 'CATEGORY_CHANGE_REQUIRED', 'Informe o nome ou a descrição da categoria.');
    const name = Object.hasOwn(req.body, 'name') ? normalizeString(req.body.name, { field: 'name', min: 1, max: 100 }) : null;
    const description = Object.hasOwn(req.body, 'description') ? normalizeString(req.body.description, { field: 'description', min: 0, max: 1000 }) : null;
    const category = await withAdmin(req, async (tx, actor) => {
      const rows = await tx`SELECT * FROM categories WHERE id = ${id} FOR UPDATE`;
      if (!rows.length) throw notFound();
      const current = rows[0];
      checkVersion(current.version, version);
      const result = await tx`
        UPDATE categories SET name = ${name === null ? current.name : name}, description = ${description === null ? current.description : description},
          version = ${nextVersion(current.version)}, updated_at = now() WHERE id = ${id} RETURNING *`;
      await appendAudit(tx, actor.id, null, 'admin.category.edit', 'category', id, reason, categoryState(current), categoryState(result[0]));
      return result[0];
    });
    res.json({ data: categoryDto(category) });
  }));

  for (const action of ['archive', 'restore']) {
    router.post(`/categories/:id/${action}`, route(async (req, res) => {
      const id = validateUuid(req.params.id);
      assertObjectShape(req.body, { allowedKeys: ['reason', 'expectedVersion'], requiredKeys: ['reason'] });
      const version = expectedVersion(req.body.expectedVersion);
      const reason = reasonOf(req.body.reason);
      const category = await withAdmin(req, async (tx, actor) => {
        const rows = await tx`SELECT * FROM categories WHERE id = ${id} FOR UPDATE`;
        if (!rows.length) throw notFound();
        const current = rows[0];
        checkVersion(current.version, version);
        if ((current.archived_at !== null) === (action === 'archive')) throw conflict('STATE_UNCHANGED', 'A categoria já está no estado solicitado.');
        const result = await tx`
          UPDATE categories SET archived_at = CASE WHEN ${action === 'archive'} THEN now() ELSE NULL END,
            version = ${nextVersion(current.version)}, updated_at = now() WHERE id = ${id} RETURNING *`;
        await appendAudit(tx, actor.id, null, `admin.category.${action}`, 'category', id, reason, categoryState(current), categoryState(result[0]));
        return result[0];
      });
      res.json({ data: categoryDto(category) });
    }));
  }

  router.get('/audit-events', route(async (req, res) => {
    const { limit, offset } = queryPage(req.query);
    const rows = await sql`
      SELECT id, actor_id, actor_label, action, target_type, target_id, reason, before_state, after_state, created_at
      FROM audit_events ORDER BY created_at DESC, id DESC LIMIT ${limit + 1} OFFSET ${offset}`;
    res.json(collection(rows, limit, offset, auditDto));
  }));
  return router;
}

/** Operator-only service. No route exposes this function. */
async function bootstrapAdmin({ sql, userId, operator, reason } = {}) {
  if (typeof sql !== 'function' || typeof sql.begin !== 'function') throw new TypeError('An injected SQL client is required.');
  const id = validateUuid(userId);
  const label = normalizeString(operator, { field: 'operator', min: 1, max: 120 });
  const justification = reasonOf(reason);
  return sql.begin(async (tx) => {
    await lockAdminSet(tx);
    const counts = await tx`SELECT count(*)::integer AS count FROM users WHERE role = 'admin' AND disabled_at IS NULL`;
    if (counts[0].count > 0) throw conflict('ADMIN_EXISTS', 'Já existe um administrador ativo. Use a administração autenticada.');
    const rows = await tx`
      SELECT id, username, email, role, disabled_at, auth_version, version, join_date FROM users WHERE id = ${id} FOR UPDATE`;
    if (!rows.length) throw notFound();
    const current = rows[0];
    if (current.disabled_at !== null) throw conflict('ACCOUNT_DISABLED', 'A conta selecionada está desativada.');
    const result = await tx`
      UPDATE users SET role = 'admin', auth_version = ${nextVersion(current.auth_version)}, version = ${nextVersion(current.version)}, updated_at = now()
      WHERE id = ${id} RETURNING id, username, email, role, disabled_at, version, join_date`;
    await appendAudit(tx, null, label, 'admin.bootstrap', 'user', id, justification, accountState(current), accountState(result[0]));
    return adminUser(result[0]);
  });
}

module.exports = { ADMIN_SET_LOCK, bootstrapAdmin, createAdminRouter };
