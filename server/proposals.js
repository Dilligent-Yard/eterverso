'use strict';

const express = require('express');
const { createHash } = require('node:crypto');
const { sanitizeUrl } = require('./content');
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
const { extractWikiLinks, normalizeSlug, validateWikiSnapshot } = require('./wiki');

const STAFF_ROLES = ['moderador', 'admin'];
const PROPOSAL_COLUMNS = `
  proposal.id AS proposal_id, proposal.page_id, proposal.proposer_id,
  proposal.base_published_revision_id, proposal.snapshot, proposal.edit_summary,
  proposal.state, proposal.version AS proposal_version,
  proposal.previous_proposal_id, proposal.review_reason,
  proposal.created_at AS proposal_created_at,
  proposal.updated_at AS proposal_updated_at,
  proposer.username AS proposer_username, proposer.avatar AS proposer_avatar,
  proposer.title AS proposer_title, proposer.role AS proposer_role,
  base.snapshot AS base_snapshot,
  page.published_revision_id AS current_published_revision_id,
  current_revision.snapshot AS current_snapshot,
  page.work_version AS current_work_version`;

function apiError(status, code, message, details) {
  return new ApiError(status, code, message, details);
}
const notFound = () => apiError(404, 'NOT_FOUND', 'A proposta solicitada não foi encontrada.');
const forbidden = () => apiError(403, 'FORBIDDEN', 'Você não tem permissão para esta ação.');
const conflict = (code, message) => apiError(409, code, message);
const route = (handler) => (req, res, next) => Promise.resolve().then(() => handler(req, res)).catch(next);

/**
 * Mount the returned router at `/api`. It implements member proposal and
 * staff review routes; the application owns JSON, session, CSRF and errors.
 */
function createProposalRouter({ sql, auth } = {}) {
  if (typeof sql !== 'function' || typeof sql.begin !== 'function') {
    throw new TypeError('createProposalRouter requires the injected postgres client.');
  }
  for (const method of ['requireIdentity', 'requireRole', 'withActorTransaction', 'assertRole']) {
    if (!auth || typeof auth[method] !== 'function') throw new TypeError(`createProposalRouter requires auth.${method}.`);
  }

  const router = express.Router();
  const staff = express.Router();
  staff.use(auth.requireIdentity, auth.requireRole(...STAFF_ROLES));
  router.use('/staff/wiki', staff);

  router.post('/wiki/pages/:id/proposals', auth.requireIdentity, route(async (req, res) => {
    const pageId = validateUuid(req.params.id, 'pageId');
    const body = assertObjectShape(req.body, {
      allowedKeys: ['snapshot', 'basePublishedRevisionId', 'summary', 'previousProposalId'],
      requiredKeys: ['snapshot', 'basePublishedRevisionId', 'summary'],
    });
    const snapshot = validateWikiSnapshot(body.snapshot);
    const basePublishedRevisionId = validateUuid(body.basePublishedRevisionId, 'basePublishedRevisionId');
    const summary = plainText(body.summary, 'summary', 1000);
    const previousProposalId = body.previousProposalId === undefined || body.previousProposalId === null
      ? null
      : validateUuid(body.previousProposalId, 'previousProposalId');
    const key = idempotencyKey(req);
    const requestHash = hashPayload({ pageId, snapshot, basePublishedRevisionId, summary, previousProposalId });

    const proposal = await auth.withActorTransaction(req, async (tx, actor) => {
      const page = await lockAccessiblePage(tx, pageId);
      const replay = await findReplay(tx, actor.id, 'wiki.proposal.create', key, requestHash);
      if (replay) {
        const replayRows = await loadProposalRows(tx, {
          id: replay.resourceIds[0], proposerId: actor.id, accessibleOnly: true,
        });
        if (!replayRows.length || String(replayRows[0].page_id).toLowerCase() !== pageId) throw notFound();
        return proposalDto(replayRows[0]);
      }

      if (!sameId(page.published_revision_id, basePublishedRevisionId)) {
        throw conflict('STALE_PROPOSAL_BASE', 'A publicação mudou. Atualize o artigo antes de enviar outra proposta.');
      }
      if (previousProposalId) {
        const previous = await tx`
          SELECT id, state FROM wiki_proposals
          WHERE id = ${previousProposalId} AND page_id = ${pageId} AND proposer_id = ${actor.id}
          FOR SHARE`;
        if (!previous.length) throw notFound();
        if (previous[0].state !== 'withdrawn') {
          throw conflict('PREVIOUS_PROPOSAL_NOT_WITHDRAWN', 'Retire a proposta anterior antes de enviar uma revisão.');
        }
      }

      const inserted = await tx`
        INSERT INTO wiki_proposals (
          page_id, proposer_id, base_published_revision_id, snapshot,
          edit_summary, previous_proposal_id
        ) VALUES (
          ${pageId}, ${actor.id}, ${basePublishedRevisionId}, ${tx.json(snapshot)},
          ${summary}, ${previousProposalId}
        )
        RETURNING id`;
      const proposalId = validateUuid(inserted[0].id);
      await insertRequestKey(tx, actor.id, 'wiki.proposal.create', key, requestHash, [proposalId]);
      await appendAudit(tx, actor.id, 'wiki.proposal.submit', proposalId, 'Proposta enviada para revisão.',
        {}, { state: 'submitted', version: 1, pageId });
      const rows = await loadProposalRows(tx, { id: proposalId, proposerId: actor.id, accessibleOnly: true });
      if (!rows.length) throw notFound();
      return proposalDto(rows[0]);
    });
    return res.status(201).json({ data: proposal });
  }));

  router.get('/wiki/proposals', auth.requireIdentity, route(async (req, res) => {
    const { limit, offset } = queryPage(req.query);
    const rows = await loadProposalRows(sql, {
      proposerId: req.authUser.id,
      accessibleOnly: true,
      limit: limit + 1,
      offset,
    });
    return res.json({
      data: rows.slice(0, limit).map(proposalDto),
      page: { limit, offset, hasMore: rows.length > limit },
    });
  }));

  router.get('/wiki/proposals/:id', auth.requireIdentity, route(async (req, res) => {
    const id = validateUuid(req.params.id);
    const rows = await loadProposalRows(sql, {
      id, proposerId: req.authUser.id, accessibleOnly: true,
    });
    if (!rows.length) throw notFound();
    return res.json({ data: proposalDto(rows[0]) });
  }));

  router.post('/wiki/proposals/:id/withdraw', auth.requireIdentity, route(async (req, res) => {
    const id = validateUuid(req.params.id);
    const body = assertObjectShape(req.body, { allowedKeys: ['expectedVersion'] });
    const version = expectedVersion(body.expectedVersion);
    const result = await auth.withActorTransaction(req, async (tx, actor) => {
      const rows = await tx`
        SELECT id, page_id, proposer_id, state, version FROM wiki_proposals
        WHERE id = ${id} FOR UPDATE`;
      if (!rows.length || String(rows[0].proposer_id).toLowerCase() !== String(actor.id).toLowerCase()) throw notFound();
      const proposal = rows[0];
      requireSubmitted(proposal.state);
      checkVersion(proposal.version, version);
      const next = nextVersion(proposal.version);
      const changed = await tx`
        UPDATE wiki_proposals SET state = 'withdrawn', version = ${next}, updated_at = now()
        WHERE id = ${id} AND proposer_id = ${actor.id} AND state = 'submitted' AND version = ${version}
        RETURNING id, state, version, updated_at`;
      if (!changed.length) throw conflict('STALE_VERSION', 'A proposta mudou. Atualize e tente novamente.');
      await appendAudit(tx, actor.id, 'wiki.proposal.withdraw', id, 'Proposta retirada pelo autor.',
        { state: 'submitted', version }, { state: 'withdrawn', version: next });
      return proposalStatusDto(changed[0]);
    });
    return res.json({ data: result });
  }));

  staff.get('/proposals', route(async (req, res) => {
    const { limit, offset } = queryPage(req.query);
    const rows = await loadProposalRows(sql, {
      state: 'submitted', limit: limit + 1, offset,
    });
    return res.json({
      data: rows.slice(0, limit).map(proposalDto),
      page: { limit, offset, hasMore: rows.length > limit },
    });
  }));

  staff.get('/proposals/:id', route(async (req, res) => {
    const id = validateUuid(req.params.id);
    const rows = await loadProposalRows(sql, { id });
    if (!rows.length) throw notFound();
    return res.json({ data: proposalDto(rows[0]) });
  }));

  staff.post('/proposals/:id/reject', route(async (req, res) => {
    const id = validateUuid(req.params.id);
    const body = assertObjectShape(req.body, { allowedKeys: ['expectedVersion', 'reason'], requiredKeys: ['reason'] });
    const version = expectedVersion(body.expectedVersion);
    const reason = plainText(body.reason, 'reason', 1000);
    const result = await withStaffTransaction(auth, req, async (tx, actor) => {
      const rows = await tx`SELECT id, state, version FROM wiki_proposals WHERE id = ${id} FOR UPDATE`;
      if (!rows.length) throw notFound();
      const proposal = rows[0];
      requireSubmitted(proposal.state);
      checkVersion(proposal.version, version);
      const next = nextVersion(proposal.version);
      const changed = await tx`
        UPDATE wiki_proposals SET state = 'rejected', review_reason = ${reason},
          version = ${next}, updated_at = now()
        WHERE id = ${id} AND state = 'submitted' AND version = ${version}
        RETURNING id, state, version, review_reason, updated_at`;
      if (!changed.length) throw conflict('STALE_VERSION', 'A proposta mudou. Atualize e tente novamente.');
      await appendAudit(tx, actor.id, 'wiki.proposal.reject', id, reason,
        { state: 'submitted', version }, { state: 'rejected', version: next });
      return proposalStatusDto(changed[0]);
    });
    return res.json({ data: result });
  }));

  staff.post('/proposals/:id/accept', route(async (req, res) => {
    const id = validateUuid(req.params.id);
    const body = assertObjectShape(req.body, {
      allowedKeys: ['expectedVersion', 'expectedWorkVersion', 'expectedPublishedRevisionId'],
      requiredKeys: ['expectedPublishedRevisionId'],
    });
    const proposalVersion = expectedVersion(body.expectedVersion);
    const workVersion = expectedVersion(body.expectedWorkVersion, 'expectedWorkVersion');
    const expectedPublishedRevisionId = validateUuid(body.expectedPublishedRevisionId, 'expectedPublishedRevisionId');

    const accepted = await withStaffTransaction(auth, req, async (tx, actor) => {
      // This first read discovers the page lock target without locking the
      // proposal. The mutation lock order is actor, page, then proposal.
      const hintRows = await tx`SELECT page_id FROM wiki_proposals WHERE id = ${id}`;
      if (!hintRows.length) throw notFound();
      const pageId = validateUuid(hintRows[0].page_id, 'pageId');
      const page = await lockPage(tx, pageId);
      const proposals = await tx`
        SELECT id, page_id, proposer_id, base_published_revision_id, snapshot,
               edit_summary, state, version, previous_proposal_id,
               review_reason, created_at, updated_at
        FROM wiki_proposals WHERE id = ${id} AND page_id = ${pageId} FOR UPDATE`;
      if (!proposals.length) throw notFound();
      const proposal = proposals[0];
      requireSubmitted(proposal.state);
      checkVersion(proposal.version, proposalVersion);

      if (!page.published_revision_id
          || !sameId(proposal.base_published_revision_id, page.published_revision_id)
          || !sameId(expectedPublishedRevisionId, page.published_revision_id)) {
        throw conflict('STALE_PROPOSAL_BASE', 'A publicação mudou desde o envio da proposta.');
      }
      if (page.archived_at !== null || page.access_level !== 'public') {
        throw conflict('PROPOSAL_PAGE_UNAVAILABLE', 'O artigo não está mais disponível para aceitar propostas.');
      }
      if (page.head_revision_id !== page.published_revision_id) {
        throw conflict('STAFF_DRAFT_EXISTS', 'Há um rascunho da equipe. Integre a proposta manualmente nesse rascunho.');
      }
      checkVersion(page.work_version, workVersion);

      const snapshot = validateWikiSnapshot(proposal.snapshot);
      const currentBase = await tx`
        SELECT id, snapshot FROM wiki_revisions
        WHERE page_id = ${pageId} AND id = ${page.published_revision_id} LIMIT 1`;
      if (!currentBase.length || validateWikiSnapshot(currentBase[0].snapshot).accessLevel !== 'public') {
        throw conflict('PROPOSAL_PAGE_UNAVAILABLE', 'O artigo não está mais disponível para aceitar propostas.');
      }

      const sequenceRows = await tx`
        SELECT COALESCE(max(sequence), 0)::integer AS sequence
        FROM wiki_revisions WHERE page_id = ${pageId}`;
      const sequence = intValue(sequenceRows[0].sequence, 'sequence');
      if (sequence >= MAX_POSTGRES_INTEGER) throw conflict('REVISION_SEQUENCE_EXHAUSTED', 'Este artigo atingiu o limite de revisões.');
      const nextWorkVersion = nextVersion(page.work_version, 'WORK_VERSION_EXHAUSTED');
      const inserted = await tx`
        INSERT INTO wiki_revisions (
          page_id, sequence, parent_revision_id, base_published_revision_id,
          actor_id, edit_summary, snapshot, accepted_proposal_id
        ) VALUES (
          ${pageId}, ${sequence + 1}, ${page.head_revision_id}, ${page.published_revision_id},
          ${actor.id}, ${proposal.edit_summary}, ${tx.json(snapshot)}, ${proposal.id}
        )
        RETURNING id, sequence, parent_revision_id, base_published_revision_id,
                  page_id, actor_id, edit_summary, snapshot, accepted_proposal_id, created_at`;
      const revision = inserted[0];
      await saveRevisionIndexes(tx, revision.id, snapshot);
      const pageUpdate = await tx`
        UPDATE wiki_pages SET head_revision_id = ${revision.id},
          work_version = ${nextWorkVersion}, updated_at = now()
        WHERE id = ${pageId} AND work_version = ${page.work_version}
        RETURNING head_revision_id, published_revision_id, work_version, public_version`;
      if (!pageUpdate.length) throw conflict('STALE_VERSION', 'O artigo foi alterado. Atualize antes de aceitar a proposta.');
      const nextProposalVersion = nextVersion(proposal.version);
      const changed = await tx`
        UPDATE wiki_proposals SET state = 'accepted', version = ${nextProposalVersion}, updated_at = now()
        WHERE id = ${id} AND state = 'submitted' AND version = ${proposalVersion}
        RETURNING id, state, version, review_reason, updated_at`;
      if (!changed.length) throw conflict('STALE_VERSION', 'A proposta mudou. Atualize e tente novamente.');
      await appendAudit(tx, actor.id, 'wiki.proposal.accept', id, 'Proposta aceita como rascunho da equipe.',
        { state: 'submitted', version: proposalVersion }, {
          state: 'accepted', version: nextProposalVersion,
          pageId, revisionId: revision.id, workVersion: nextWorkVersion,
        });
      const proposalRows = await loadProposalRows(tx, { id });
      if (!proposalRows.length) throw notFound();
      return {
        proposal: proposalDto(proposalRows[0]),
        revision: revisionDto(revision, {
          actor,
          proposer: proposalRows[0],
        }),
        page: {
          id: pageId,
          headRevisionId: revision.id,
          publishedRevisionId: validateUuid(pageUpdate[0].published_revision_id),
          workVersion: intValue(pageUpdate[0].work_version, 'workVersion'),
          publicVersion: intValue(pageUpdate[0].public_version, 'publicVersion'),
        },
      };
    });
    return res.status(201).json({ data: accepted });
  }));

  return router;
}

function proposalDto(row) {
  const snapshot = validateWikiSnapshot(row.snapshot);
  const baseSnapshot = validateWikiSnapshot(row.base_snapshot);
  const currentSnapshot = row.current_snapshot ? validateWikiSnapshot(row.current_snapshot) : null;
  const currentPublishedRevisionId = row.current_published_revision_id
    ? validateUuid(row.current_published_revision_id, 'currentPublishedRevisionId')
    : null;
  const basePublishedRevisionId = validateUuid(row.base_published_revision_id, 'basePublishedRevisionId');
  const pageId = validateUuid(row.page_id, 'pageId');
  return {
    id: validateUuid(row.proposal_id || row.id),
    pageId,
    page: {
      id: pageId,
      title: currentSnapshot?.title || baseSnapshot.title,
      slug: currentSnapshot?.slug || baseSnapshot.slug,
      publishedRevisionId: currentPublishedRevisionId,
    },
    proposer: publicAuthor({
      id: row.proposer_id,
      username: row.proposer_username,
      avatar: sanitizeUrl(row.proposer_avatar || '', { image: true }) || '',
      title: row.proposer_title,
      role: row.proposer_role,
    }),
    basePublishedRevisionId,
    currentPublishedRevisionId,
    baseSnapshot,
    snapshot,
    summary: row.edit_summary,
    state: row.state,
    version: intValue(row.proposal_version ?? row.version, 'proposalVersion'),
    previousProposalId: row.previous_proposal_id ? validateUuid(row.previous_proposal_id, 'previousProposalId') : null,
    reviewReason: row.review_reason,
    stale: !sameId(basePublishedRevisionId, currentPublishedRevisionId),
    createdAt: isoTimestamp(row.proposal_created_at || row.created_at),
    updatedAt: isoTimestamp(row.proposal_updated_at || row.updated_at),
  };
}

function proposalStatusDto(row) {
  return {
    id: validateUuid(row.id),
    state: row.state,
    version: intValue(row.version, 'proposalVersion'),
    reviewReason: row.review_reason ?? null,
    updatedAt: isoTimestamp(row.updated_at),
  };
}

function revisionDto(row, { actor, proposer } = {}) {
  return {
    id: validateUuid(row.id),
    pageId: validateUuid(row.page_id, 'pageId'),
    sequence: intValue(row.sequence, 'sequence'),
    parentRevisionId: row.parent_revision_id ? validateUuid(row.parent_revision_id, 'parentRevisionId') : null,
    basePublishedRevisionId: row.base_published_revision_id ? validateUuid(row.base_published_revision_id, 'basePublishedRevisionId') : null,
    acceptedProposalId: validateUuid(row.accepted_proposal_id, 'acceptedProposalId'),
    editSummary: row.edit_summary,
    actor: actor ? publicAuthor({
      id: actor.id,
      username: actor.username,
      avatar: sanitizeUrl(actor.avatar || '', { image: true }) || '',
      title: actor.title || '',
      role: actor.role,
    }) : null,
    proposer: proposer ? publicAuthor({
      id: proposer.proposer_id,
      username: proposer.proposer_username,
      avatar: sanitizeUrl(proposer.proposer_avatar || '', { image: true }) || '',
      title: proposer.proposer_title,
      role: proposer.proposer_role,
    }) : null,
    createdAt: isoTimestamp(row.created_at),
  };
}

async function loadProposalRows(executor, options = {}) {
  const idFilter = options.id ? executor`AND proposal.id = ${options.id}` : executor``;
  const proposerFilter = options.proposerId ? executor`AND proposal.proposer_id = ${options.proposerId}` : executor``;
  const stateFilter = options.state ? executor`AND proposal.state = ${options.state}` : executor``;
  const accessibleFilter = options.accessibleOnly ? executor`
    AND page.published_revision_id IS NOT NULL
    AND page.archived_at IS NULL AND page.access_level = 'public'
    AND current_revision.snapshot->>'accessLevel' = 'public'` : executor``;
  const limit = options.limit === undefined ? null : options.limit;
  const offset = options.offset === undefined ? null : options.offset;
  const pagination = limit === null ? executor`` : executor`LIMIT ${limit} OFFSET ${offset}`;
  return executor`
    SELECT ${executor.unsafe(PROPOSAL_COLUMNS)}
    FROM wiki_proposals proposal
    JOIN wiki_pages page ON page.id = proposal.page_id
    JOIN wiki_revisions base ON base.page_id = proposal.page_id
      AND base.id = proposal.base_published_revision_id
    LEFT JOIN wiki_revisions current_revision ON current_revision.page_id = page.id
      AND current_revision.id = page.published_revision_id
    LEFT JOIN users proposer ON proposer.id = proposal.proposer_id
    WHERE true ${idFilter} ${proposerFilter} ${stateFilter} ${accessibleFilter}
    ORDER BY proposal.created_at DESC, proposal.id DESC ${pagination}`;
}

async function lockAccessiblePage(tx, id) {
  const rows = await tx`
    SELECT page.id, page.head_revision_id, page.published_revision_id,
           page.work_version, page.public_version, page.access_level,
           page.archived_at
    FROM wiki_pages page
    WHERE page.id = ${id} AND page.published_revision_id IS NOT NULL
      AND page.archived_at IS NULL AND page.access_level = 'public'
    FOR SHARE OF page`;
  if (!rows.length) throw notFound();
  const page = rows[0];
  const currentRows = await tx`
    SELECT snapshot FROM wiki_revisions
    WHERE page_id = ${id} AND id = ${page.published_revision_id} LIMIT 1`;
  if (!currentRows.length) throw notFound();
  const current = validateWikiSnapshot(currentRows[0].snapshot);
  if (current.accessLevel !== 'public') throw notFound();
  return page;
}

async function lockPage(tx, id) {
  const rows = await tx`
    SELECT id, head_revision_id, published_revision_id, work_version,
           public_version, access_level, archived_at
    FROM wiki_pages WHERE id = ${id} FOR UPDATE`;
  if (!rows.length) throw notFound();
  return rows[0];
}

async function saveRevisionIndexes(tx, revisionId, snapshot) {
  for (const category of snapshot.categories) {
    await tx`
      INSERT INTO wiki_revision_categories (revision_id, category, category_key)
      VALUES (${revisionId}, ${category}, ${normalizeSlug(category, 'category')})`;
  }
  for (const link of extractWikiLinks(snapshot)) {
    await tx`
      INSERT INTO wiki_revision_links (revision_id, target_name_key, target_anchor)
      VALUES (${revisionId}, ${link.targetNameKey}, ${link.targetAnchor})`;
  }
}

async function withStaffTransaction(auth, req, callback) {
  return auth.withActorTransaction(req, async (tx, actor) => {
    auth.assertRole(actor, ...STAFF_ROLES);
    return callback(tx, actor);
  });
}

function appendAudit(tx, actorId, action, targetId, reason, before, after) {
  return tx`
    INSERT INTO audit_events (actor_id, action, target_type, target_id, reason, before_state, after_state)
    VALUES (${actorId}, ${action}, 'wiki_proposal', ${targetId}, ${reason}, ${tx.json(before)}, ${tx.json(after)})`;
}

async function findReplay(tx, actorId, operation, key, requestHash) {
  const rows = await tx`
    SELECT request_hash, resource_ids FROM request_keys
    WHERE actor_id = ${actorId} AND operation = ${operation} AND idempotency_key = ${key}
    LIMIT 1`;
  if (!rows.length) return null;
  if (rows[0].request_hash !== requestHash) throw conflict('IDEMPOTENCY_CONFLICT', 'Esta chave já foi usada com outra solicitação.');
  const resourceIds = rows[0].resource_ids;
  if (!Array.isArray(resourceIds) || resourceIds.length !== 1 || typeof resourceIds[0] !== 'string') throw notFound();
  return { resourceIds };
}

function insertRequestKey(tx, actorId, operation, key, requestHash, resourceIds) {
  return tx`
    INSERT INTO request_keys (actor_id, operation, idempotency_key, request_hash, resource_ids)
    VALUES (${actorId}, ${operation}, ${key}, ${requestHash}, ${tx.json(resourceIds)})`;
}

function idempotencyKey(req) {
  const raw = typeof req.get === 'function' ? req.get('Idempotency-Key') : req.headers?.['idempotency-key'];
  if (raw === undefined) throw apiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'A chave de repetição da solicitação é obrigatória.', { field: 'Idempotency-Key' });
  return validateUuid(raw, 'Idempotency-Key');
}

function queryPage(query) {
  assertObjectShape(query, { allowedKeys: ['limit', 'offset'] });
  return paginationParams(query);
}

function plainText(value, field, maximum) {
  const text = normalizeString(value, { field, min: 1, max: maximum });
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f<>]/u.test(text)) {
    throw apiError(400, 'INVALID_VALUE', 'O campo deve conter texto simples.', { field });
  }
  return text;
}

function requireSubmitted(state) {
  if (state !== 'submitted') throw conflict('PROPOSAL_NOT_SUBMITTED', 'A proposta já foi revisada e não pode ser alterada.');
}

function checkVersion(actual, expected) {
  if (Number(actual) !== expected) throw conflict('STALE_VERSION', 'A proposta mudou. Atualize e tente novamente.');
}

function nextVersion(value, code = 'VERSION_EXHAUSTED') {
  const version = Number(value);
  if (!Number.isInteger(version) || version < 1 || version >= MAX_POSTGRES_INTEGER) {
    throw conflict(code, 'Este registro atingiu o limite de versões.');
  }
  return version + 1;
}

function intValue(value, field) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < (field === 'publicVersion' ? 0 : 1) || number > MAX_POSTGRES_INTEGER) {
    throw apiError(409, 'INVALID_STORED_STATE', 'O artigo precisa de revisão antes de continuar.', { field });
  }
  return number;
}

function sameId(left, right) {
  if (left === null || left === undefined || right === null || right === undefined) return left === right;
  return String(left).toLowerCase() === String(right).toLowerCase();
}

function hashPayload(value) {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function isoTimestamp(value) {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

module.exports = { createProposalRouter };
