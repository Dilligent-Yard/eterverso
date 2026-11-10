'use strict';

const express = require('express');
const { createHash } = require('node:crypto');
const {
  extractInternalLinks,
  plainTextFromHtml,
  sanitizeBlocks,
  sanitizeHtml,
  sanitizeUrl,
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
const MAX_WIKI_CITATIONS = 10_000;
const WIKI_TYPES = new Set([
  'concept', 'organization', 'place', 'entity', 'technique', 'artifact', 'event', 'character-reference',
]);
const AUDIENCES = new Set(['unspecified', 'reader', 'player', 'author']);
const KNOWLEDGE_LAYERS = new Set(['unspecified', 'mundane', 'paranormal', 'authorial', 'mixed']);
const AUTHORITIES = new Set(['C', 'S', 'E', 'O']);
const SNAPSHOT_KEYS = [
  'schemaVersion', 'title', 'slug', 'aliases', 'type', 'summary', 'categories',
  'accessLevel', 'audience', 'body',
];
const RESERVED_WIKI_ROUTES = new Set(['novo', 'editor', 'propostas', 'equipe', 'rascunhos']);
const PAGE_COLUMNS = `p.id, p.head_revision_id, p.published_revision_id, p.work_version,
  p.public_version, p.access_level, p.archived_at, p.discussion_thread_id,
  p.created_by, p.published_at, p.created_at, p.updated_at`;

function apiError(status, code, message, details) {
  return new ApiError(status, code, message, details);
}
const notFound = () => apiError(404, 'NOT_FOUND', 'O artigo solicitado não foi encontrado.');
const forbidden = () => apiError(403, 'FORBIDDEN', 'Você não tem permissão para esta ação.');
const conflict = (code, message) => apiError(409, code, message);
const route = (handler) => (req, res, next) => Promise.resolve().then(() => handler(req, res)).catch(next);

/**
 * Mount the returned router at `/api`. Public routes are under `/wiki`; staff
 * routes are under `/staff/wiki`. The app owns JSON parsing, session/CSRF
 * middleware and the final error handler.
 */
function createWikiRouter({ sql, auth } = {}) {
  if (typeof sql !== 'function' || typeof sql.begin !== 'function') {
    throw new TypeError('createWikiRouter requires the injected postgres client.');
  }
  for (const method of ['requireIdentity', 'requireRole', 'withActorTransaction', 'assertRole']) {
    if (!auth || typeof auth[method] !== 'function') throw new TypeError(`createWikiRouter requires auth.${method}.`);
  }

  const router = express.Router();
  const staff = express.Router();
  staff.use(auth.requireIdentity, auth.requireRole(...STAFF_ROLES));
  router.use('/staff/wiki', staff);

  router.get('/wiki/pages', route(async (req, res) => {
    const query = queryShape(req.query, ['limit', 'offset', 'search', 'category', 'type']);
    const { limit, offset } = paginationParams(query);
    const search = query.search === undefined ? '' : normalizeString(query.search, { field: 'search', min: 1, max: 100 }).toLocaleLowerCase('pt-BR');
    const category = query.category === undefined ? '' : normalizeSlug(query.category, 'category');
    const type = query.type === undefined ? '' : readEnum(query.type, WIKI_TYPES, 'type');

    // The visibility predicate is applied in SQL before results, totals, search,
    // or pagination can reveal anything about drafts or staff-only articles.
    const rows = await sql`
      SELECT ${sql.unsafe(PAGE_COLUMNS)}, r.id AS revision_id, r.snapshot,
             r.created_at AS revision_created_at, r.actor_id,
             u.username AS author_username,
             CASE WHEN u.avatar LIKE 'data:image/%' THEN '/api/users/' || lower(u.id::text) || '/avatar?v=' || u.version::text ELSE u.avatar END AS author_avatar,
             u.title AS author_title, u.role AS author_role, u.version AS author_version
      FROM wiki_pages p
      JOIN wiki_revisions r ON r.id = p.published_revision_id AND r.page_id = p.id
      LEFT JOIN users u ON u.id = r.actor_id
      WHERE p.published_revision_id IS NOT NULL
        AND p.archived_at IS NULL AND p.access_level = 'public'
        AND r.snapshot->>'accessLevel' = 'public'
      ORDER BY lower(r.snapshot->>'title') ASC, p.id ASC`;
    const visible = rows.map(publicArticle).filter((article) => {
      if (category && !article.categories.some((item) => normalizeSlug(item, 'category') === category)) return false;
      if (type && article.type !== type) return false;
      if (search) {
        const haystack = `${article.title}\n${article.aliases.join('\n')}\n${article.summary}\n${article.searchText}`.toLocaleLowerCase('pt-BR');
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
    return res.json(collection(visible, limit, offset, pageListDto));
  }));

  router.get('/wiki/resolve/:slug', route(async (req, res) => {
    const key = normalizeSlug(req.params.slug, 'slug');
    const rows = await sql`
      SELECT n.kind, p.id, p.public_version, r.snapshot
      FROM wiki_names n
      JOIN wiki_pages p ON p.id = n.page_id
      JOIN wiki_revisions r ON r.id = p.published_revision_id AND r.page_id = p.id
      WHERE n.name_key = ${key} AND p.published_revision_id IS NOT NULL
        AND p.archived_at IS NULL AND p.access_level = 'public'
        AND r.snapshot->>'accessLevel' = 'public'
      LIMIT 1`;
    if (!rows.length) throw notFound();
    const snapshot = validateWikiSnapshot(rows[0].snapshot);
    const canonicalSlug = snapshot.slug;
    return res.json({ data: {
      id: validateUuid(rows[0].id),
      slug: canonicalSlug,
      redirect: rows[0].kind !== 'canonical' || key !== canonicalSlug,
      publicVersion: intValue(rows[0].public_version, 'publicVersion'),
    } });
  }));

  router.get('/wiki/pages/:id', route(async (req, res) => {
    const id = validateUuid(req.params.id);
    const rows = await loadPublicPage(sql, id);
    if (!rows.length) throw notFound();
    const article = publicArticle(rows[0]);
    const etag = wikiEtag(article.id, article.publicVersion, article.authorVersion);
    if (ifNoneMatchMatches(req.get('If-None-Match'), etag)) {
      return res.status(304).set('ETag', etag).end();
    }
    const body = JSON.stringify({ data: publicPageDto(article) });
    return res.status(200)
      .set('Content-Type', 'application/json; charset=utf-8')
      .set('ETag', etag)
      .send(body);
  }));

  router.get('/wiki/categories', route(async (req, res) => {
    const { limit, offset } = paginationParams(queryShape(req.query, ['limit', 'offset']));
    const rows = await sql`
      SELECT rc.category, rc.category_key, count(DISTINCT p.id)::bigint AS page_count
      FROM wiki_pages p
      JOIN wiki_revisions r ON r.id = p.published_revision_id AND r.page_id = p.id
      JOIN wiki_revision_categories rc ON rc.revision_id = r.id
      WHERE p.published_revision_id IS NOT NULL
        AND p.archived_at IS NULL AND p.access_level = 'public'
        AND r.snapshot->>'accessLevel' = 'public'
      GROUP BY rc.category, rc.category_key
      ORDER BY rc.category_key ASC, rc.category ASC`;
    return res.json(collection(rows, limit, offset, (row) => ({
      name: row.category,
      key: row.category_key,
      pagesCount: countValue(row.page_count),
    })));
  }));

  router.get('/wiki/pages/:id/backlinks', route(async (req, res) => {
    const id = validateUuid(req.params.id);
    const { limit, offset } = paginationParams(queryShape(req.query, ['limit', 'offset']));
    const target = await loadPublicPage(sql, id);
    if (!target.length) throw notFound();
    const rows = await sql`
      WITH visible_sources AS (
        SELECT DISTINCT source_page.id
        FROM wiki_pages source_page
        JOIN wiki_revisions current_revision
          ON current_revision.id = source_page.published_revision_id
         AND current_revision.page_id = source_page.id
        JOIN wiki_revision_links link ON link.revision_id = current_revision.id
        JOIN wiki_names n ON n.name_key = link.target_name_key AND n.page_id = ${id}
        WHERE source_page.published_revision_id IS NOT NULL
          AND source_page.archived_at IS NULL AND source_page.access_level = 'public'
          AND current_revision.snapshot->>'accessLevel' = 'public'
      )
      SELECT ${sql.unsafe(PAGE_COLUMNS)}, r.id AS revision_id, r.snapshot,
             r.created_at AS revision_created_at, r.actor_id,
             u.username AS author_username,
             CASE WHEN u.avatar LIKE 'data:image/%' THEN '/api/users/' || lower(u.id::text) || '/avatar?v=' || u.version::text ELSE u.avatar END AS author_avatar,
             u.title AS author_title, u.role AS author_role, u.version AS author_version
      FROM visible_sources v
      JOIN wiki_pages p ON p.id = v.id
      JOIN wiki_revisions r ON r.id = p.published_revision_id AND r.page_id = p.id
      LEFT JOIN users u ON u.id = r.actor_id
      ORDER BY lower(r.snapshot->>'title') ASC, p.id ASC`;
    const articles = rows.map(publicArticle);
    return res.json(collection(articles, limit, offset, pageListDto));
  }));

  staff.get('/pages', route(async (req, res) => {
    const query = queryShape(req.query, ['limit', 'offset', 'includeArchived', 'search']);
    const { limit, offset } = paginationParams(query);
    const includeArchived = booleanQuery(query.includeArchived, 'includeArchived');
    const search = query.search === undefined ? '' : normalizeString(query.search, { field: 'search', min: 1, max: 100 }).toLocaleLowerCase('pt-BR');
    const rows = await sql`
      SELECT ${sql.unsafe(PAGE_COLUMNS)}, head.id AS revision_id,
             head.sequence AS revision_sequence, head.parent_revision_id,
             head.base_published_revision_id, head.actor_id,
             head.edit_summary, head.snapshot, head.created_at AS revision_created_at,
             u.username AS actor_username,
             CASE WHEN u.avatar LIKE 'data:image/%' THEN '/api/users/' || lower(u.id::text) || '/avatar?v=' || u.version::text ELSE u.avatar END AS actor_avatar,
             u.title AS actor_title, u.role AS actor_role
      FROM wiki_pages p
      LEFT JOIN wiki_revisions head ON head.id = p.head_revision_id AND head.page_id = p.id
      LEFT JOIN users u ON u.id = head.actor_id
      WHERE (${includeArchived} OR p.archived_at IS NULL)
      ORDER BY p.updated_at DESC, p.id ASC`;
    const items = rows.map((row) => staffPageDto(row)).filter((page) => {
      return !search || `${page.head?.snapshot.title || ''}\n${page.head?.snapshot.summary || ''}`.toLocaleLowerCase('pt-BR').includes(search);
    });
    return res.json(collection(items, limit, offset, (item) => item));
  }));

  staff.get('/pages/:id', route(async (req, res) => {
    const id = validateUuid(req.params.id);
    const rows = await loadStaffPage(sql, id);
    if (!rows.length) throw notFound();
    return res.json({ data: staffPageDto(rows[0]) });
  }));

  staff.post('/pages', route(async (req, res) => {
    const body = assertObjectShape(req.body, { allowedKeys: ['snapshot', 'summary', 'citations'], requiredKeys: ['snapshot', 'summary'] });
    const snapshot = validateWikiSnapshot(body.snapshot);
    const summary = normalizeSummary(body.summary);
    const citationsProvided = Object.hasOwn(body, 'citations');
    const citations = citationsProvided ? validateWikiCitations(body.citations, snapshot) : [];
    const key = idempotencyKey(req);
    // Keep the historical citation-free hash stable for retries already stored
    // in request_keys. Explicit citation submissions bind their full payload.
    const requestHash = hashPayload(citationsProvided ? { snapshot, summary, citations } : { snapshot, summary });
    const created = await withStaffTransaction(auth, req, async (tx, actor) => {
      const replay = await findReplay(tx, actor.id, 'wiki.page.create', key, requestHash);
      await assertCitationSourcesExist(tx, citations);
      if (replay) return loadReplayPage(tx, replay.resourceIds);

      const pageRows = await tx`
        INSERT INTO wiki_pages (created_by, access_level)
        VALUES (${actor.id}, 'staff') RETURNING id`;
      const pageId = validateUuid(pageRows[0].id);
      const revision = await insertRevision(tx, {
        pageId, actorId: actor.id, sequence: 1, parentId: null,
        basePublishedId: null, summary, snapshot, restoresId: null,
      });
      await tx`UPDATE wiki_pages SET head_revision_id = ${revision.id}, updated_at = now() WHERE id = ${pageId}`;
      await saveRevisionIndexes(tx, revision.id, snapshot);
      await insertRevisionCitations(tx, revision.id, citations);
      await insertRequestKey(tx, actor.id, 'wiki.page.create', key, requestHash, [pageId]);
      const rows = await loadStaffPage(tx, pageId);
      return staffPageDto(rows[0]);
    });
    return res.status(201).json({ data: created });
  }));

  staff.post('/pages/:id/revisions', route(async (req, res) => {
    const id = validateUuid(req.params.id);
    const body = assertObjectShape(req.body, {
      allowedKeys: ['snapshot', 'summary', 'expectedVersion', 'citations'],
      requiredKeys: ['snapshot', 'summary'],
    });
    const snapshot = validateWikiSnapshot(body.snapshot);
    const summary = normalizeSummary(body.summary);
    const citationsProvided = Object.hasOwn(body, 'citations');
    const requestedCitations = citationsProvided ? validateWikiCitations(body.citations, snapshot) : null;
    const version = expectedVersion(body.expectedVersion);
    const page = await withStaffTransaction(auth, req, async (tx, actor) => {
      const current = await lockPage(tx, id);
      checkVersion(current.work_version, version);
      if (!current.head_revision_id) throw conflict('PAGE_NEEDS_REPAIR', 'Este artigo precisa de revisão antes de receber alterações.');
      const citations = citationsProvided
        ? requestedCitations
        : await retainedRevisionCitations(tx, current.head_revision_id, snapshot);
      await assertCitationSourcesExist(tx, citations);
      const nextWork = nextVersion(current.work_version, 'WORK_VERSION_EXHAUSTED');
      const sequenceRows = await tx`SELECT COALESCE(max(sequence), 0)::integer AS sequence FROM wiki_revisions WHERE page_id = ${id}`;
      const sequence = intValue(sequenceRows[0].sequence, 'sequence');
      if (sequence >= MAX_POSTGRES_INTEGER) throw conflict('REVISION_SEQUENCE_EXHAUSTED', 'Este artigo atingiu o limite de revisões.');
      const revision = await insertRevision(tx, {
        pageId: id, actorId: actor.id, sequence: sequence + 1,
        parentId: current.head_revision_id,
        basePublishedId: current.published_revision_id,
        summary, snapshot, restoresId: null,
      });
      await tx`UPDATE wiki_pages SET head_revision_id = ${revision.id}, work_version = ${nextWork}, updated_at = now() WHERE id = ${id}`;
      await saveRevisionIndexes(tx, revision.id, snapshot);
      await insertRevisionCitations(tx, revision.id, citations);
      return loadStaffPageDto(tx, id);
    });
    return res.json({ data: page });
  }));

  staff.post('/pages/:id/publish', route(async (req, res) => {
    const id = validateUuid(req.params.id);
    const body = assertObjectShape(req.body, {
      allowedKeys: ['revisionId', 'expectedVersion', 'expectedPublishedRevisionId', 'summary', 'makePublic'],
      requiredKeys: ['revisionId', 'expectedPublishedRevisionId', 'summary'],
    });
    const revisionId = validateUuid(body.revisionId, 'revisionId');
    const version = expectedVersion(body.expectedVersion);
    const makePublic = body.makePublic === undefined ? false : body.makePublic;
    if (typeof makePublic !== 'boolean') {
      throw apiError(400, 'INVALID_VALUE', 'A opção de publicação pública deve ser verdadeira ou falsa.', { field: 'makePublic' });
    }
    const expectedPublishedId = body.expectedPublishedRevisionId === null
      ? null : validateUuid(body.expectedPublishedRevisionId, 'expectedPublishedRevisionId');
    const summary = normalizeSummary(body.summary);
    try {
      const page = await withStaffTransaction(auth, req, async (tx, actor) => {
        const current = await lockPage(tx, id);
        checkVersion(current.work_version, version);
        if (current.archived_at) throw conflict('PAGE_ARCHIVED', 'Reative o artigo antes de publicar uma revisão.');
        if (!sameNullableId(current.published_revision_id, expectedPublishedId)) {
          throw conflict('STALE_PUBLICATION', 'A publicação mudou. Atualize o artigo antes de publicar.');
        }
        if (!sameNullableId(current.head_revision_id, revisionId)) {
          throw conflict('STALE_HEAD', 'A revisão não é mais a versão de trabalho atual.');
        }
        const revisions = await tx`
          SELECT id, sequence, base_published_revision_id, snapshot
          FROM wiki_revisions WHERE id = ${revisionId} AND page_id = ${id} LIMIT 1`;
        if (!revisions.length) throw notFound();
        const revision = revisions[0];
        const snapshot = validateWikiSnapshot(revision.snapshot);
        if (snapshot.accessLevel === 'staff' && !makePublic) {
          throw conflict('DRAFT_NOT_PUBLIC', 'Esta revisão é um rascunho reservado à equipe. Marque a opção “Publicar publicamente” para torná-la visível ao público.');
        }
        const isCurrentStaffPublication = makePublic
          && snapshot.accessLevel === 'staff'
          && sameNullableId(revision.id, current.published_revision_id);
        if (!sameNullableId(revision.base_published_revision_id, current.published_revision_id)
            && !isCurrentStaffPublication) {
          throw conflict('STALE_REVISION_BASE', 'A revisão se baseia em outra publicação. Salve uma nova revisão antes de publicar.');
        }

        let publishedRevisionId = revisionId;
        let publishedSnapshot = snapshot;
        if (snapshot.accessLevel === 'staff') {
          publishedSnapshot = validateWikiSnapshot({ ...snapshot, accessLevel: 'public' });
          const sequenceRows = await tx`SELECT COALESCE(max(sequence), 0)::integer AS sequence FROM wiki_revisions WHERE page_id = ${id}`;
          const sequence = intValue(sequenceRows[0].sequence, 'sequence');
          if (sequence >= MAX_POSTGRES_INTEGER) throw conflict('REVISION_SEQUENCE_EXHAUSTED', 'Este artigo atingiu o limite de revisões.');
          const citations = await revisionCitations(tx, revisionId);
          await assertCitationSourcesExist(tx, citations);
          const publicRevision = await insertRevision(tx, {
            pageId: id,
            actorId: actor.id,
            sequence: sequence + 1,
            parentId: revisionId,
            basePublishedId: current.published_revision_id,
            summary,
            snapshot: publishedSnapshot,
            restoresId: null,
          });
          publishedRevisionId = publicRevision.id;
          await saveRevisionIndexes(tx, publishedRevisionId, publishedSnapshot);
          await insertRevisionCitations(tx, publishedRevisionId, citations);
        }

        await reservePublishedNames(tx, id, publishedSnapshot);
        const nextPublic = nextPublicVersion(current.public_version);
        const nextWork = nextVersion(current.work_version, 'WORK_VERSION_EXHAUSTED');
        await tx`
          UPDATE wiki_pages SET head_revision_id = ${publishedRevisionId}, published_revision_id = ${publishedRevisionId}, access_level = ${publishedSnapshot.accessLevel},
            published_at = now(), public_version = ${nextPublic}, work_version = ${nextWork},
            updated_at = now()
          WHERE id = ${id}`;
        await writeAudit(tx, actor.id, 'wiki.page.publish', id, summary,
          { publishedRevisionId: current.published_revision_id, publicVersion: Number(current.public_version) },
          { publishedRevisionId, publicVersion: nextPublic, accessLevel: publishedSnapshot.accessLevel });
        return loadStaffPageDto(tx, id);
      });
      return res.json({ data: page });
    } catch (error) {
      if (error && error.code === '23505') throw conflict('WIKI_NAME_CONFLICT', 'Um dos nomes do artigo já está em uso.');
      throw error;
    }
  }));

  for (const action of ['archive', 'restore']) {
    staff.post(`/pages/:id/${action}`, route(async (req, res) => {
      const id = validateUuid(req.params.id);
      const body = assertObjectShape(req.body, { allowedKeys: ['reason', 'expectedVersion'], requiredKeys: ['reason'] });
      const reason = normalizeSummary(body.reason);
      const version = expectedVersion(body.expectedVersion);
      const page = await withStaffTransaction(auth, req, async (tx, actor) => {
        const current = await lockPage(tx, id);
        checkVersion(current.work_version, version);
        if (action === 'archive' ? !!current.archived_at : !current.archived_at) {
          throw conflict('STATE_UNCHANGED', action === 'archive' ? 'O artigo já está arquivado.' : 'O artigo já está ativo.');
        }
        const nextWork = nextVersion(current.work_version, 'WORK_VERSION_EXHAUSTED');
        const affectsPublic = current.access_level === 'public' && !!current.published_revision_id;
        const nextPublic = affectsPublic ? nextPublicVersion(current.public_version) : intValue(current.public_version, 'publicVersion');
        await tx`
          UPDATE wiki_pages SET archived_at = ${action === 'archive' ? tx`now()` : null},
            work_version = ${nextWork}, public_version = ${nextPublic}, updated_at = now()
          WHERE id = ${id}`;
        await writeAudit(tx, actor.id, `wiki.page.${action}`, id, reason,
          { archived: !!current.archived_at, publicVersion: Number(current.public_version) },
          { archived: action === 'archive', publicVersion: nextPublic });
        return loadStaffPageDto(tx, id);
      });
      return res.json({ data: page });
    }));
  }

  staff.get('/pages/:id/revisions', route(async (req, res) => {
    const id = validateUuid(req.params.id);
    const { limit, offset } = paginationParams(queryShape(req.query, ['limit', 'offset', 'compareTo']));
    const compareTo = req.query.compareTo === undefined ? null : validateUuid(req.query.compareTo, 'compareTo');
    const pageRows = await sql`SELECT id FROM wiki_pages WHERE id = ${id} LIMIT 1`;
    if (!pageRows.length) throw notFound();
    const rows = await sql`
      SELECT r.id, r.page_id, r.sequence, r.parent_revision_id,
             r.base_published_revision_id, r.actor_id, r.edit_summary, r.snapshot,
             r.restores_id, r.accepted_proposal_id, r.created_at,
             u.username AS actor_username,
             CASE WHEN u.avatar LIKE 'data:image/%' THEN '/api/users/' || lower(u.id::text) || '/avatar?v=' || u.version::text ELSE u.avatar END AS actor_avatar,
             u.title AS actor_title, u.role AS actor_role
      FROM wiki_revisions r LEFT JOIN users u ON u.id = r.actor_id
      WHERE r.page_id = ${id}
      ORDER BY r.sequence DESC, r.id ASC LIMIT ${limit + 1} OFFSET ${offset}`;
    const data = pagedCollection(rows, limit, offset, revisionDto);
    if (compareTo) {
      const chosen = rows[0];
      if (!chosen) throw notFound();
      const compared = await getRevision(sql, id, compareTo);
      data.diff = revisionDiff(chosen.snapshot, compared.snapshot);
      data.comparedTo = { revisionId: compared.id, sequence: compared.sequence };
    }
    return res.json(data);
  }));

  staff.get('/pages/:id/revisions/:revisionId', route(async (req, res) => {
    const id = validateUuid(req.params.id);
    const revisionId = validateUuid(req.params.revisionId, 'revisionId');
    const query = queryShape(req.query, ['compareTo']);
    const revision = await getRevision(sql, id, revisionId);
    const data = revisionDto(revision);
    if (query.compareTo !== undefined) {
      const compared = await getRevision(sql, id, validateUuid(query.compareTo, 'compareTo'));
      data.diff = revisionDiff(revision.snapshot, compared.snapshot);
      data.comparedTo = { revisionId: compared.id, sequence: compared.sequence };
    }
    return res.json({ data });
  }));

  staff.post('/pages/:id/restore-revision', route(async (req, res) => {
    const id = validateUuid(req.params.id);
    const body = assertObjectShape(req.body, {
      allowedKeys: ['oldRevisionId', 'expectedVersion', 'summary'],
      requiredKeys: ['oldRevisionId', 'summary'],
    });
    const oldRevisionId = validateUuid(body.oldRevisionId, 'oldRevisionId');
    const version = expectedVersion(body.expectedVersion);
    const summary = normalizeSummary(body.summary);
    const page = await withStaffTransaction(auth, req, async (tx, actor) => {
      const current = await lockPage(tx, id);
      checkVersion(current.work_version, version);
      const old = await getRevision(tx, id, oldRevisionId);
      const snapshot = validateWikiSnapshot(old.snapshot);
      const citations = await retainedRevisionCitations(tx, oldRevisionId, snapshot);
      await assertCitationSourcesExist(tx, citations);
      const nextWork = nextVersion(current.work_version, 'WORK_VERSION_EXHAUSTED');
      const sequenceRows = await tx`SELECT COALESCE(max(sequence), 0)::integer AS sequence FROM wiki_revisions WHERE page_id = ${id}`;
      const sequence = intValue(sequenceRows[0].sequence, 'sequence');
      if (sequence >= MAX_POSTGRES_INTEGER) throw conflict('REVISION_SEQUENCE_EXHAUSTED', 'Este artigo atingiu o limite de revisões.');
      const revision = await insertRevision(tx, {
        pageId: id, actorId: actor.id, sequence: sequence + 1,
        parentId: current.head_revision_id,
        basePublishedId: current.published_revision_id,
        summary, snapshot, restoresId: oldRevisionId,
      });
      await tx`UPDATE wiki_pages SET head_revision_id = ${revision.id}, work_version = ${nextWork}, updated_at = now() WHERE id = ${id}`;
      await saveRevisionIndexes(tx, revision.id, snapshot);
      await insertRevisionCitations(tx, revision.id, citations);
      await writeAudit(tx, actor.id, 'wiki.page.restore_revision', id, summary,
        { headRevisionId: current.head_revision_id, workVersion: Number(current.work_version) },
        { headRevisionId: revision.id, workVersion: nextWork, restoresId: oldRevisionId });
      return loadStaffPageDto(tx, id);
    });
    return res.json({ data: page });
  }));

  staff.patch('/pages/:id/discussion', route(async (req, res) => {
    const id = validateUuid(req.params.id);
    const body = assertObjectShape(req.body, {
      allowedKeys: ['threadId', 'expectedVersion'],
      requiredKeys: ['threadId'],
    });
    const threadId = body.threadId === null ? null : validateUuid(body.threadId, 'threadId');
    const version = expectedVersion(body.expectedVersion);
    const page = await withStaffTransaction(auth, req, async (tx, actor) => {
      const current = await lockPage(tx, id);
      checkVersion(current.work_version, version);
      if (threadId) {
        const threads = await tx`
          SELECT id FROM threads WHERE id = ${threadId} AND quarantined_at IS NULL FOR SHARE`;
        if (!threads.length) throw notFound();
      }
      if (sameNullableId(current.discussion_thread_id, threadId)) throw conflict('STATE_UNCHANGED', 'A discussão já está vinculada ao artigo.');
      const nextWork = nextVersion(current.work_version, 'WORK_VERSION_EXHAUSTED');
      const affectsPublic = !!current.published_revision_id && !current.archived_at && current.access_level === 'public';
      const nextPublic = affectsPublic
        ? nextPublicVersion(current.public_version)
        : intValue(current.public_version, 'publicVersion');
      await tx`UPDATE wiki_pages SET discussion_thread_id = ${threadId}, work_version = ${nextWork},
        public_version = ${nextPublic}, updated_at = now() WHERE id = ${id}`;
      await writeAudit(tx, actor.id, 'wiki.page.discussion', id, 'Vínculo de discussão atualizado.',
        { discussionThreadId: current.discussion_thread_id, publicVersion: Number(current.public_version) },
        { discussionThreadId: threadId, workVersion: nextWork, publicVersion: nextPublic });
      return loadStaffPageDto(tx, id);
    });
    return res.json({ data: page });
  }));

  return router;
}

async function withStaffTransaction(auth, req, callback, transactionOptions = {}) {
  return auth.withActorTransaction(req, async (tx, actor) => {
    auth.assertRole(actor, ...STAFF_ROLES);
    return callback(tx, actor);
  }, transactionOptions);
}

function normalizeSlug(value, field = 'slug') {
  if (typeof value !== 'string') throw apiError(400, 'INVALID_SLUG', 'O nome do artigo não é válido.', { field });
  if (/[\u0000-\u001f\u007f]/u.test(value)) throw apiError(400, 'INVALID_SLUG', 'O nome do artigo não é válido.', { field });
  const ascii = value.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase();
  // Punctuation and whitespace are separators. Other scripts are rejected
  // rather than transliterated or silently discarded.
  const separated = ascii.replace(/[\s\p{P}]+/gu, '-');
  if (/[^\x00-\x7f]/u.test(separated)) throw apiError(400, 'INVALID_SLUG', 'O nome do artigo não é válido.', { field });
  const key = separated.replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!key || key.length > 100 || !/^[a-z0-9][a-z0-9-]{0,99}$/.test(key)) {
    throw apiError(400, 'INVALID_SLUG', 'O nome do artigo não é válido.', { field });
  }
  return key;
}

function validateWikiSnapshot(value) {
  try {
    assertObjectShape(value, { allowedKeys: SNAPSHOT_KEYS, requiredKeys: SNAPSHOT_KEYS });
    if (value.schemaVersion !== 1) throw new Error('schemaVersion');
    const title = wikiText(value.title, { field: 'title', min: 1, max: 200 });
    const slug = normalizeSlug(value.slug, 'slug');
    const aliases = stringList(value.aliases, 30, 100, 'aliases').map((item) => normalizeSlug(item, 'aliases'));
    if (RESERVED_WIKI_ROUTES.has(slug) || aliases.some((alias) => RESERVED_WIKI_ROUTES.has(alias))) throw new Error('reservedSlug');
    const categories = stringList(value.categories, 30, 100, 'categories').map((item) => wikiText(item, { field: 'categories', min: 1, max: 100 }));
    const categoryKeys = categories.map((item) => normalizeSlug(item, 'categories'));
    if (new Set(aliases).size !== aliases.length || aliases.includes(slug)) throw new Error('aliases');
    if (new Set(categoryKeys).size !== categoryKeys.length) throw new Error('categories');
    if (WIKI_TYPES.has(value.type) !== true) throw new Error('type');
    if (value.accessLevel !== 'staff' && value.accessLevel !== 'public') throw new Error('accessLevel');
    if (!AUDIENCES.has(value.audience)) throw new Error('audience');
    const summary = wikiText(value.summary, { field: 'summary', min: 0, max: 1000 });
    assertObjectShape(value.body, { allowedKeys: ['format', 'infobox', 'sections'], requiredKeys: ['format', 'infobox', 'sections'] });
    if (value.body.format !== 'richtext-v1') throw new Error('format');
    if (!Array.isArray(value.body.infobox) || value.body.infobox.length > 30) throw new Error('infobox');
    const infobox = value.body.infobox.map((entry) => {
      assertObjectShape(entry, { allowedKeys: ['label', 'value'], requiredKeys: ['label', 'value'] });
      return {
        label: wikiText(entry.label, { field: 'label', min: 1, max: 80 }),
        value: wikiText(entry.value, { field: 'value', min: 0, max: 300 }),
      };
    });
    if (!Array.isArray(value.body.sections) || value.body.sections.length > 100) throw new Error('sections');
    const seenIds = new Set();
    const sections = value.body.sections.map((section) => {
      assertObjectShape(section, {
        allowedKeys: ['id', 'heading', 'html', 'blocks', 'authority', 'knowledgeLayer'],
        requiredKeys: ['id', 'heading', 'html', 'blocks', 'authority', 'knowledgeLayer'],
      });
      const id = validateUuid(section.id, 'sectionId');
      if (seenIds.has(id)) throw new Error('sectionId');
      seenIds.add(id);
      const heading = wikiText(section.heading, { field: 'heading', min: 1, max: 200 });
      if (typeof section.html !== 'string' || Array.from(section.html).length > 500_000) throw new Error('html');
      const html = sanitizeHtml(section.html, { maxBytes: 500_000 });
      const blocks = sanitizeBlocks(section.blocks, { maxBytes: 500_000 });
      if (!Array.isArray(section.authority) || section.authority.some((item) => !AUTHORITIES.has(item))
          || new Set(section.authority).size !== section.authority.length) throw new Error('authority');
      if (!KNOWLEDGE_LAYERS.has(section.knowledgeLayer)) throw new Error('knowledgeLayer');
      return { id, heading, html, blocks, authority: [...section.authority], knowledgeLayer: section.knowledgeLayer };
    });
    const snapshot = {
      schemaVersion: 1,
      title,
      slug,
      aliases,
      type: value.type,
      summary,
      categories,
      accessLevel: value.accessLevel,
      audience: value.audience,
      body: { format: 'richtext-v1', infobox, sections },
    };
    if (Array.from(JSON.stringify(snapshot)).length > 500_000) throw new Error('size');
    return snapshot;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw apiError(400, 'INVALID_WIKI_SNAPSHOT', 'O conteúdo do artigo possui campos ou valores inválidos.');
  }
}

function validateWikiCitations(value, snapshot) {
  try {
    if (!Array.isArray(value) || value.length > MAX_WIKI_CITATIONS) throw new Error('citations');
    const sectionIds = new Set(snapshot.body.sections.map((section) => section.id));
    const seen = new Set();
    return value.map((citation) => {
      assertObjectShape(citation, {
        allowedKeys: ['sectionId', 'sourceId', 'locator'],
        requiredKeys: ['sectionId', 'sourceId', 'locator'],
      });
      const sectionId = validateUuid(citation.sectionId, 'sectionId');
      const sourceId = validateUuid(citation.sourceId, 'sourceId');
      const locator = normalizeString(citation.locator, { field: 'locator', min: 1, max: 500 });
      if (locator.includes('\0') || !sectionIds.has(sectionId)) throw new Error('citationReference');
      const identity = JSON.stringify([sectionId, sourceId, locator]);
      if (seen.has(identity)) throw new Error('duplicateCitation');
      seen.add(identity);
      return { sectionId, sourceId, locator };
    });
  } catch {
    throw invalidWikiCitations();
  }
}

function invalidWikiCitations() {
  return apiError(400, 'INVALID_WIKI_CITATIONS', 'As referências do artigo possuem campos ou valores inválidos.');
}

function storedCitation(row) {
  if (typeof row.locator !== 'string' || !row.locator.trim() || Array.from(row.locator).length > 500 || row.locator.includes('\0')) {
    throw apiError(409, 'INVALID_STORED_STATE', 'As referências deste artigo precisam de revisão.');
  }
  return {
    sectionId: validateUuid(row.section_id, 'sectionId'),
    sourceId: validateUuid(row.source_id, 'sourceId'),
    locator: row.locator,
  };
}

async function retainedRevisionCitations(tx, revisionId, snapshot) {
  const sectionIds = new Set(snapshot.body.sections.map((section) => section.id));
  const citations = await revisionCitations(tx, revisionId);
  return citations.filter((citation) => sectionIds.has(citation.sectionId));
}

async function revisionCitations(tx, revisionId) {
  const rows = await tx`
    SELECT section_id, source_id, locator
    FROM wiki_revision_citations
    WHERE revision_id = ${revisionId}
    ORDER BY section_id ASC, source_id ASC, locator ASC`;
  return rows.map(storedCitation);
}

async function assertCitationSourcesExist(tx, citations) {
  const sourceIds = [...new Set(citations.map((citation) => citation.sourceId))].sort();
  if (!sourceIds.length) return;
  const rows = await tx`
    SELECT id FROM wiki_sources
    WHERE id = ANY(${tx.array(sourceIds, 2950)})
    ORDER BY id ASC FOR KEY SHARE`;
  if (rows.length !== sourceIds.length) {
    throw apiError(400, 'INVALID_WIKI_CITATIONS', 'Uma ou mais fontes citadas não foram encontradas.');
  }
}

async function insertRevisionCitations(tx, revisionId, citations) {
  if (!citations.length) return;
  const values = citations.map(({ sectionId, sourceId, locator }) => [revisionId, sectionId, sourceId, locator]);
  await tx`
    INSERT INTO wiki_revision_citations (revision_id, section_id, source_id, locator)
    VALUES ${tx(values)}`;
}

function stringList(value, maximum, maxLength, field) {
  if (!Array.isArray(value) || value.length > maximum) throw apiError(400, 'INVALID_WIKI_SNAPSHOT', 'O conteúdo do artigo possui campos ou valores inválidos.', { field });
  return value.map((item) => normalizeString(item, { field, min: 1, max: maxLength }));
}

function wikiText(value, options) {
  const normalized = normalizeString(value, options);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(normalized)) {
    throw apiError(400, 'INVALID_VALUE', 'Um dos campos de texto contém caracteres inválidos.', { field: options.field });
  }
  return normalized;
}

function normalizeSummary(value) {
  return wikiText(value, { field: 'summary', min: 1, max: 1000 });
}

function extractWikiLinks(snapshot) {
  const found = new Map();
  const visitBlocks = (items) => {
    for (const item of items || []) {
      if (!item || typeof item !== 'object') continue;
      for (const [key, value] of Object.entries(item)) {
        if (key === 'content' && typeof value === 'string') addHtml(value);
        else if (Array.isArray(value)) visitBlocks(value);
      }
    }
  };
  const addHtml = (html) => {
    for (const href of extractInternalLinks(html)) {
      const match = /^\/wiki\/([^/?#]+)(?:#([0-9a-f-]{36}))?$/i.exec(href);
      if (!match) continue;
      let key;
      try { key = normalizeSlug(decodeURIComponent(match[1]), 'slug'); } catch { continue; }
      let anchor = '';
      if (match[2]) {
        try { anchor = validateUuid(match[2], 'anchor'); } catch { continue; }
      }
      found.set(`${key}\0${anchor}`, { targetNameKey: key, targetAnchor: anchor });
    }
  };
  for (const section of snapshot.body.sections) {
    addHtml(section.html);
    visitBlocks(section.blocks);
  }
  return [...found.values()];
}

function publicArticle(row) {
  const snapshot = validateWikiSnapshot(row.snapshot);
  const id = validateUuid(row.id);
  const publishedAt = isoTimestamp(row.published_at || row.revision_created_at);
  const publicVersion = intValue(row.public_version, 'publicVersion');
  const author = row.actor_id && row.author_username ? publicAuthor({
    id: row.actor_id,
    username: row.author_username,
    avatar: sanitizeUrl(row.author_avatar || '', { image: true }) || '',
    title: row.author_title || '',
    role: row.author_role,
  }) : null;
  const authorVersion = row.author_version !== undefined && row.author_version !== null
    ? (Number.isInteger(Number(row.author_version)) && Number(row.author_version) > 0 ? Number(row.author_version) : null)
    : null;
  return {
    id,
    publishedRevisionId: validateUuid(row.revision_id, 'publishedRevisionId'),
    title: snapshot.title,
    slug: snapshot.slug,
    aliases: snapshot.aliases,
    type: snapshot.type,
    summary: snapshot.summary,
    categories: snapshot.categories,
    accessLevel: 'public',
    discussionThreadId: row.discussion_thread_id ? validateUuid(row.discussion_thread_id, 'discussionThreadId') : null,
    audience: snapshot.audience,
    author,
    authorVersion,
    body: snapshot.body,
    publicVersion,
    createdAt: isoTimestamp(row.created_at),
    publishedAt,
    updatedAt: publishedAt,
    searchText: snapshotPlainText(snapshot),
  };
}

function pageListDto(article) {
  return {
    id: article.id,
    publishedRevisionId: article.publishedRevisionId,
    title: article.title,
    slug: article.slug,
    aliases: article.aliases,
    type: article.type,
    summary: article.summary,
    categories: article.categories,
    accessLevel: article.accessLevel,
    discussionThreadId: article.discussionThreadId,
    audience: article.audience,
    author: article.author ?? null,
    publicVersion: article.publicVersion,
    createdAt: article.createdAt,
    publishedAt: article.publishedAt,
    updatedAt: article.updatedAt,
  };
}
function publicPageDto(article) {
  return {
    id: article.id,
    publishedRevisionId: article.publishedRevisionId,
    title: article.title,
    slug: article.slug,
    aliases: article.aliases,
    type: article.type,
    summary: article.summary,
    categories: article.categories,
    accessLevel: article.accessLevel,
    discussionThreadId: article.discussionThreadId,
    audience: article.audience,
    author: article.author ?? null,
    body: article.body,
    publicVersion: article.publicVersion,
    createdAt: article.createdAt,
    publishedAt: article.publishedAt,
    updatedAt: article.updatedAt,
  };
}

function snapshotPlainText(snapshot) {
  const values = [snapshot.title, snapshot.summary, ...snapshot.aliases, ...snapshot.categories];
  const visit = (value, key = '') => {
    if (typeof value === 'string') {
      if (key === 'html' || key === 'content') {
        try { values.push(plainTextFromHtml(value)); } catch { /* already sanitized and revalidated */ }
      } else values.push(value);
    } else if (Array.isArray(value)) value.forEach((item) => visit(item));
    else if (value && typeof value === 'object') Object.entries(value).forEach(([name, item]) => {
      if (!['id', 'authority', 'knowledgeLayer', 'format', 'type'].includes(name)) visit(item, name);
    });
  };
  visit(snapshot.body);
  return values.join('\n');
}

function setEtag(res, id, version) {
  res.set('ETag', wikiEtag(id, version));
}

function wikiEtag(id, version, authorVersion) {
  return Number.isInteger(authorVersion) && authorVersion > 0
    ? `"wiki-${id}-${version}-${authorVersion}"`
    : `"wiki-${id}-${version}"`;
}

function ifNoneMatchMatches(header, etag) {
  if (typeof header !== 'string' || !header) return false;
  const current = etag.replace(/^W\//, '');
  return header.split(',').some((candidate) => {
    const token = candidate.trim();
    return token === '*' || token.replace(/^W\//, '') === current;
  });
}

async function loadPublicPage(executor, id) {
  return executor`
    SELECT ${executor.unsafe(PAGE_COLUMNS)}, r.id AS revision_id, r.snapshot,
           r.created_at AS revision_created_at, r.actor_id,
           u.username AS author_username,
           CASE WHEN u.avatar LIKE 'data:image/%' THEN '/api/users/' || lower(u.id::text) || '/avatar?v=' || u.version::text ELSE u.avatar END AS author_avatar,
           u.title AS author_title, u.role AS author_role, u.version AS author_version
    FROM wiki_pages p
    JOIN wiki_revisions r ON r.id = p.published_revision_id AND r.page_id = p.id
    LEFT JOIN users u ON u.id = r.actor_id
    WHERE p.id = ${id} AND p.published_revision_id IS NOT NULL
      AND p.archived_at IS NULL AND p.access_level = 'public'
      AND r.snapshot->>'accessLevel' = 'public'
    LIMIT 1`;
}

async function loadStaffPage(executor, id) {
  return executor`
    SELECT ${executor.unsafe(PAGE_COLUMNS)}, head.id AS revision_id,
           head.sequence AS revision_sequence, head.parent_revision_id,
           head.base_published_revision_id, head.actor_id,
           head.edit_summary, head.restores_id, head.accepted_proposal_id,
           head.snapshot, head.created_at AS revision_created_at,
           u.username AS actor_username,
             CASE WHEN u.avatar LIKE 'data:image/%' THEN '/api/users/' || lower(u.id::text) || '/avatar?v=' || u.version::text ELSE u.avatar END AS actor_avatar,
           u.title AS actor_title, u.role AS actor_role,
           COALESCE((
             SELECT json_agg(json_build_object(
               'sectionId', citation.section_id,
               'sourceId', citation.source_id,
               'locator', citation.locator
             ) ORDER BY citation.section_id ASC, citation.source_id ASC, citation.locator ASC)
             FROM wiki_revision_citations citation
             WHERE citation.revision_id = head.id
           ), '[]'::json) AS head_citations
    FROM wiki_pages p
    LEFT JOIN wiki_revisions head ON head.id = p.head_revision_id AND head.page_id = p.id
    LEFT JOIN users u ON u.id = head.actor_id
    WHERE p.id = ${id} LIMIT 1`;
}
async function loadStaffPageDto(executor, id) {
  const rows = await loadStaffPage(executor, id);
  if (!rows.length) throw notFound();
  return staffPageDto(rows[0]);
}

function staffPageDto(row) {
  const page = {
    id: validateUuid(row.id),
    headRevisionId: row.head_revision_id ? validateUuid(row.head_revision_id, 'headRevisionId') : null,
    publishedRevisionId: row.published_revision_id ? validateUuid(row.published_revision_id, 'publishedRevisionId') : null,
    workVersion: intValue(row.work_version, 'workVersion'),
    publicVersion: intValue(row.public_version, 'publicVersion'),
    accessLevel: row.access_level,
    archivedAt: isoTimestamp(row.archived_at),
    discussionThreadId: row.discussion_thread_id ? validateUuid(row.discussion_thread_id, 'discussionThreadId') : null,
    publishedAt: isoTimestamp(row.published_at),
    createdAt: isoTimestamp(row.created_at),
    updatedAt: isoTimestamp(row.updated_at),
    head: row.revision_id ? staffHeadDto(row) : null,
  };
  return page;
}

function staffHeadDto(row) {
  const head = revisionDto(row);
  if (Object.hasOwn(row, 'head_citations')) {
    let citations = row.head_citations;
    if (typeof citations === 'string') {
      try { citations = JSON.parse(citations); } catch { citations = null; }
    }
    if (!Array.isArray(citations)) throw apiError(409, 'INVALID_STORED_STATE', 'As referências deste artigo precisam de revisão.');
    head.citations = citations.map((citation) => {
      try {
        assertObjectShape(citation, {
          allowedKeys: ['sectionId', 'sourceId', 'locator'],
          requiredKeys: ['sectionId', 'sourceId', 'locator'],
        });
        const normalized = {
          sectionId: validateUuid(citation.sectionId, 'sectionId'),
          sourceId: validateUuid(citation.sourceId, 'sourceId'),
          locator: citation.locator,
        };
        if (typeof normalized.locator !== 'string' || !normalized.locator.trim()
            || Array.from(normalized.locator).length > 500 || normalized.locator.includes('\0')) {
          throw new Error('locator');
        }
        return normalized;
      } catch {
        throw apiError(409, 'INVALID_STORED_STATE', 'As referências deste artigo precisam de revisão.');
      }
    });
  }
  return head;
}

function revisionDto(row) {
  const dto = {
    id: validateUuid(row.revision_id || row.id),
    sequence: intValue(row.sequence ?? row.revision_sequence, 'sequence'),
    parentRevisionId: row.parent_revision_id ? validateUuid(row.parent_revision_id, 'parentRevisionId') : null,
    basePublishedRevisionId: row.base_published_revision_id ? validateUuid(row.base_published_revision_id, 'basePublishedRevisionId') : null,
    editSummary: row.edit_summary,
    restoresId: row.restores_id ? validateUuid(row.restores_id, 'restoresId') : null,
    acceptedProposalId: row.accepted_proposal_id ? validateUuid(row.accepted_proposal_id, 'acceptedProposalId') : null,
    createdAt: isoTimestamp(row.revision_created_at || row.created_at),
    snapshot: validateWikiSnapshot(row.snapshot),
  };
  if (row.actor_id) {
    dto.actor = publicAuthor({
      id: row.actor_id,
      username: row.actor_username,
      avatar: sanitizeUrl(row.actor_avatar || '', { image: true }) || '',
      title: row.actor_title || '',
      role: row.actor_role,
    });
  } else dto.actor = null;
  return dto;
}

async function lockPage(tx, id) {
  const rows = await tx`
    SELECT id, head_revision_id, published_revision_id, work_version,
           public_version, access_level, archived_at, discussion_thread_id,
           published_at, created_at, updated_at
    FROM wiki_pages WHERE id = ${id} FOR UPDATE`;
  if (!rows.length) throw notFound();
  return rows[0];
}

async function insertRevision(tx, { pageId, actorId, sequence, parentId, basePublishedId, summary, snapshot, restoresId }) {
  const rows = await tx`
    INSERT INTO wiki_revisions
      (page_id, sequence, parent_revision_id, base_published_revision_id,
       actor_id, edit_summary, snapshot, restores_id)
    VALUES (${pageId}, ${sequence}, ${parentId}, ${basePublishedId}, ${actorId}, ${summary}, ${tx.json(snapshot)}, ${restoresId})
    RETURNING id, sequence, parent_revision_id, base_published_revision_id,
              actor_id, edit_summary, snapshot, restores_id, created_at`;
  return rows[0];
}

async function saveRevisionIndexes(tx, revisionId, snapshot) {
  for (let index = 0; index < snapshot.categories.length; index += 1) {
    await tx`
      INSERT INTO wiki_revision_categories (revision_id, category, category_key)
      VALUES (${revisionId}, ${snapshot.categories[index]}, ${normalizeSlug(snapshot.categories[index], 'category')})`;
  }
  for (const link of extractWikiLinks(snapshot)) {
    await tx`
      INSERT INTO wiki_revision_links (revision_id, target_name_key, target_anchor)
      VALUES (${revisionId}, ${link.targetNameKey}, ${link.targetAnchor})`;
  }
}

async function reservePublishedNames(tx, pageId, snapshot) {
  const canonical = snapshot.slug;
  const aliases = snapshot.aliases;
  const requested = [...new Set([canonical, ...aliases])];
  const rows = requested.length
    ? await tx`SELECT name_key, page_id, kind FROM wiki_names WHERE name_key = ANY(${tx.array(requested, 25)}) ORDER BY name_key FOR UPDATE`
    : [];
  if (rows.some((row) => String(row.page_id).toLowerCase() !== pageId)) {
    throw conflict('WIKI_NAME_CONFLICT', 'Um dos nomes do artigo já está em uso.');
  }

  // Keep old canonical and alias keys as historical redirects when a later
  // publication removes them from the current alias set.
  await tx`
    UPDATE wiki_names SET kind = CASE WHEN name_key = ANY(${tx.array(aliases, 25)}) THEN 'alias' ELSE 'historical' END
    WHERE page_id = ${pageId} AND kind = 'canonical' AND name_key <> ${canonical}`;
  await tx`
    UPDATE wiki_names SET kind = 'historical'
    WHERE page_id = ${pageId} AND kind = 'alias'
      AND NOT (name_key = ANY(${tx.array(requested, 25)}))`;
  const canonicalRows = await tx`
    INSERT INTO wiki_names (name_key, page_id, kind)
    VALUES (${canonical}, ${pageId}, 'canonical')
    ON CONFLICT (name_key) DO UPDATE SET kind = 'canonical'
    WHERE wiki_names.page_id = EXCLUDED.page_id
    RETURNING page_id`;
  if (!canonicalRows.length) throw conflict('WIKI_NAME_CONFLICT', 'Um dos nomes do artigo já está em uso.');
  for (const alias of aliases) {
    const aliasRows = await tx`
      INSERT INTO wiki_names (name_key, page_id, kind)
      VALUES (${alias}, ${pageId}, 'alias')
      ON CONFLICT (name_key) DO UPDATE SET kind = 'alias'
      WHERE wiki_names.page_id = EXCLUDED.page_id
      RETURNING page_id`;
    if (!aliasRows.length) throw conflict('WIKI_NAME_CONFLICT', 'Um dos nomes do artigo já está em uso.');
  }
}

async function findReplay(tx, actorId, operation, key, requestHash) {
  const rows = await tx`
    SELECT request_hash, resource_ids FROM request_keys
    WHERE actor_id = ${actorId} AND operation = ${operation} AND idempotency_key = ${key}
    LIMIT 1`;
  if (!rows.length) return null;
  if (rows[0].request_hash !== requestHash) throw conflict('IDEMPOTENCY_CONFLICT', 'Esta chave já foi usada com outra solicitação.');
  if (!Array.isArray(rows[0].resource_ids)) throw notFound();
  return { resourceIds: rows[0].resource_ids };
}
async function loadReplayPage(tx, resourceIds) {
  if (resourceIds.length !== 1) throw notFound();
  const id = validateUuid(resourceIds[0]);
  const rows = await loadStaffPage(tx, id);
  if (!rows.length) throw notFound();
  return staffPageDto(rows[0]);
}
async function insertRequestKey(tx, actorId, operation, key, requestHash, resourceIds) {
  await tx`
    INSERT INTO request_keys (actor_id, operation, idempotency_key, request_hash, resource_ids)
    VALUES (${actorId}, ${operation}, ${key}, ${requestHash}, ${tx.json(resourceIds)})`;
}

function idempotencyKey(req) {
  const raw = typeof req.get === 'function' ? req.get('Idempotency-Key') : req.headers?.['idempotency-key'];
  if (raw === undefined) throw apiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'A chave de repetição da solicitação é obrigatória.', { field: 'Idempotency-Key' });
  return validateUuid(raw, 'Idempotency-Key');
}
function hashPayload(value) { return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex'); }

async function getRevision(executor, pageId, revisionId) {
  const rows = await executor`
    SELECT r.id, r.page_id, r.sequence, r.parent_revision_id,
           r.base_published_revision_id, r.actor_id, r.edit_summary, r.snapshot,
           r.restores_id, r.accepted_proposal_id, r.created_at,
           u.username AS actor_username,
             CASE WHEN u.avatar LIKE 'data:image/%' THEN '/api/users/' || lower(u.id::text) || '/avatar?v=' || u.version::text ELSE u.avatar END AS actor_avatar,
           u.title AS actor_title, u.role AS actor_role
    FROM wiki_revisions r LEFT JOIN users u ON u.id = r.actor_id
    WHERE r.page_id = ${pageId} AND r.id = ${revisionId} LIMIT 1`;
  if (!rows.length) throw notFound();
  return rows[0];
}

function revisionDiff(leftValue, rightValue) {
  const left = validateWikiSnapshot(leftValue);
  const right = validateWikiSnapshot(rightValue);
  const fields = ['title', 'slug', 'aliases', 'type', 'summary', 'categories', 'accessLevel', 'audience', 'body'];
  const changedFields = fields.filter((field) => JSON.stringify(left[field]) !== JSON.stringify(right[field]));
  const leftSections = new Map(left.body.sections.map((section) => [section.id, section]));
  const rightSections = new Map(right.body.sections.map((section) => [section.id, section]));
  return {
    changedFields,
    addedSections: [...leftSections.keys()].filter((id) => !rightSections.has(id)),
    removedSections: [...rightSections.keys()].filter((id) => !leftSections.has(id)),
    changedSections: [...leftSections.keys()].filter((id) => rightSections.has(id)
      && JSON.stringify(leftSections.get(id)) !== JSON.stringify(rightSections.get(id))),
  };
}

async function writeAudit(tx, actorId, action, targetId, reason, before, after) {
  await tx`
    INSERT INTO audit_events (actor_id, action, target_type, target_id, reason, before_state, after_state)
    VALUES (${actorId}, ${action}, 'wiki_page', ${targetId}, ${reason}, ${tx.json(before)}, ${tx.json(after)})`;
}

function queryShape(query, allowedKeys) {
  assertObjectShape(query, { allowedKeys });
  for (const [field, value] of Object.entries(query)) {
    if (Array.isArray(value) || (value !== undefined && typeof value !== 'string' && typeof value !== 'number')) {
      throw apiError(400, 'INVALID_VALUE', 'Um parâmetro da solicitação é inválido.', { field });
    }
  }
  return query;
}
function booleanQuery(value, field) {
  if (value === undefined || value === 'false') return false;
  if (value === 'true') return true;
  throw apiError(400, 'INVALID_VALUE', 'Um parâmetro da solicitação é inválido.', { field });
}
function readEnum(value, values, field) {
  if (typeof value !== 'string' || !values.has(value)) throw apiError(400, 'INVALID_VALUE', 'Um parâmetro da solicitação é inválido.', { field });
  return value;
}
function collection(rows, limit, offset, mapper) {
  const pageRows = rows.slice(offset, offset + limit + 1);
  return {
    data: pageRows.slice(0, limit).map(mapper),
    page: { limit, offset, hasMore: pageRows.length > limit },
  };
}
function pagedCollection(rows, limit, offset, mapper) {
  return {
    data: rows.slice(0, limit).map(mapper),
    page: { limit, offset, hasMore: rows.length > limit },
  };
}
function nextVersion(value, code = 'VERSION_EXHAUSTED') {
  const version = intValue(value, 'version');
  if (version >= MAX_POSTGRES_INTEGER) throw conflict(code, 'Este artigo atingiu o limite de versões.');
  return version + 1;
}
function nextPublicVersion(value) {
  const version = Number(value);
  if (!Number.isInteger(version) || version < 0 || version >= MAX_POSTGRES_INTEGER) throw conflict('PUBLIC_VERSION_EXHAUSTED', 'Este artigo atingiu o limite de versões públicas.');
  return version + 1;
}
function checkVersion(current, expected) {
  if (intValue(current, 'workVersion') !== expected) throw conflict('STALE_VERSION', 'O artigo foi alterado. Atualize antes de salvar.');
}
function intValue(value, field) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < (field === 'publicVersion' ? 0 : 1) || number > MAX_POSTGRES_INTEGER) {
    throw apiError(409, 'INVALID_STORED_STATE', 'O artigo precisa de revisão antes de continuar.', { field });
  }
  return number;
}
function countValue(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError('A wiki count query returned an invalid integer.');
  return number;
}
function sameNullableId(left, right) {
  if (left === null || left === undefined) return right === null;
  if (right === null || right === undefined) return false;
  return String(left).toLowerCase() === String(right).toLowerCase();
}
function isoTimestamp(value) {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

module.exports = {
  assertCitationSourcesExist,
  createWikiRouter,
  extractWikiLinks,
  findReplay,
  insertRequestKey,
  insertRevision,
  insertRevisionCitations,
  loadReplayPage,
  loadStaffPageDto,
  lockPage,
  normalizeSlug,
  publicPageDto,
  retainedRevisionCitations,
  revisionDiff,
  saveRevisionIndexes,
  validateWikiSnapshot,
  withStaffTransaction,
};
