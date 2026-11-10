import express from 'express';
import type { Request } from 'express';
import { ApiError, sendError } from '../../../server/errors.js';
import { validateUuid } from '../../../server/validation.js';
import type {
  QueryExecutor,
  TimelineAuth,
  TimelineDeletedRow,
  TimelineInternalIdRow,
  TimelineMaxOrderRow,
  TimelineQueryExecutor,
  TimelineRow,
} from './contract.js';
import { coerceText, parseInteger, queryParam, requestBody } from './contract.js';
import {
  expectedUpdatedAtFrom,
  publicTimelineEvent,
  staleUpdateError,
  updatedAtMatches,
  writeTimelineAudit,
} from './service.js';

export interface TimelineDependencies {
  sql: TimelineQueryExecutor;
  auth: TimelineAuth;
}

const STAFF_ROLES = ['moderador', 'admin'] as const;

/**
 * Privileged timeline writes share the app's actor-locking transaction: the
 * actor row is locked and revalidated from the database, and the role is
 * checked against that fresh row before the callback can read, mutate or audit
 * a timeline event. A revocation that committed after the middleware snapshot
 * is therefore either refused here or blocked until the transaction finishes.
 */
async function withStaffTransaction<T>(
  auth: TimelineAuth,
  req: Request,
  callback: (tx: QueryExecutor) => Promise<T>,
): Promise<T> {
  return auth.withActorTransaction(req, async (tx, actor) => {
    auth.assertRole(actor, ...STAFF_ROLES);
    return callback(tx);
  });
}

export function createTimelineRouter(dependencies: Partial<TimelineDependencies> = {}) {
  const sql = dependencies.sql;
  const auth = dependencies.auth;
  if (!sql) throw new TypeError('createTimelineRouter requires an injected postgres sql client.');
  if (!auth) throw new TypeError('createTimelineRouter requires an injected auth object.');

  const router = express.Router();

  // Listar todos os eventos da timeline com suporte a filtros
  router.get('/', async (req, res) => {
    try {
      const eraValue = queryParam(req.query, 'era');
      const characterValue = queryParam(req.query, 'character');
      const searchValue = queryParam(req.query, 'q');
      const eraFilter = typeof eraValue === 'string' ? eraValue.trim() : '';
      const characterFilter = typeof characterValue === 'string' ? characterValue.trim().toLowerCase() : '';
      const search = typeof searchValue === 'string' ? searchValue.trim().toLowerCase() : '';

      const rows = eraFilter && eraFilter !== 'all'
        ? await sql<TimelineRow>`
            SELECT * FROM timeline_events
            WHERE era = ${eraFilter}
            ORDER BY order_index ASC, created_at ASC`
        : await sql<TimelineRow>`
            SELECT * FROM timeline_events
            ORDER BY order_index ASC, created_at ASC`;

      let events = rows.map(publicTimelineEvent);

      if (characterFilter) {
        events = events.filter((e) => e.characters.toLowerCase().includes(characterFilter));
      }

      if (search) {
        events = events.filter((e) =>
          e.title.toLowerCase().includes(search)
          || e.summary.toLowerCase().includes(search)
          || e.storyArc.toLowerCase().includes(search)
          || e.characters.toLowerCase().includes(search)
          || e.startDate.toLowerCase().includes(search)
          || e.tags.toLowerCase().includes(search)
        );
      }

      res.json({ events });
    } catch (error) {
      sendError(res, error);
    }
  });

  // Obter um evento específico por ID ou internalId
  router.get('/:id', async (req, res) => {
    try {
      const idOrInternal = req.params.id;
      let rows: TimelineRow[];
      try {
        validateUuid(idOrInternal);
        rows = await sql<TimelineRow>`SELECT * FROM timeline_events WHERE id = ${idOrInternal} LIMIT 1`;
      } catch {
        rows = await sql<TimelineRow>`SELECT * FROM timeline_events WHERE internal_id = ${idOrInternal} LIMIT 1`;
      }

      const row = rows[0];
      if (!row) {
        throw new ApiError(404, 'NOT_FOUND', 'Evento da timeline não encontrado.');
      }

      res.json({ event: publicTimelineEvent(row) });
    } catch (error) {
      sendError(res, error);
    }
  });

  // Middleware de autorização para Moderadores e Administradores
  const requireStaff = [
    auth.requireIdentity,
    auth.requireRole(...STAFF_ROLES),
  ];

  // Criar um novo evento na timeline
  router.post('/', ...requireStaff, async (req, res) => {
    try {
      const body = requestBody(req);
      const {
        title, shortTitle, summary, color, era,
        startDate, endDate, orderIndex, tags,
        storyArc, characters, characterGroup, location,
      } = body;

      if (!title || typeof title !== 'string' || !title.trim()) {
        throw new ApiError(400, 'INVALID_INPUT', 'O título do evento é obrigatório.');
      }
      if (!startDate || typeof startDate !== 'string' || !startDate.trim()) {
        throw new ApiError(400, 'INVALID_INPUT', 'A data de início do evento é obrigatória.');
      }

      // Gera internal_id automático se não fornecido
      let internalId = typeof body.internalId === 'string' && body.internalId.trim()
        ? body.internalId.trim()
        : null;

      const cleanTitle = title.trim().slice(0, 250);
      const cleanShortTitle = (shortTitle ? coerceText(shortTitle).trim() : cleanTitle).slice(0, 150);
      const cleanSummary = coerceText(summary || '').trim();
      const cleanColor = coerceText(color || 'Green').trim().slice(0, 50);
      const cleanEra = coerceText(era || 'Before Daare').trim().slice(0, 50);
      const cleanStartDate = startDate.trim().slice(0, 100);
      const cleanEndDate = coerceText(endDate || '').trim().slice(0, 100);
      const cleanTags = coerceText(tags || '').trim().slice(0, 250);
      const cleanStoryArc = coerceText(storyArc || '').trim().slice(0, 150);
      const cleanCharacters = coerceText(characters || '').trim();
      const cleanCharGroup = coerceText(characterGroup || '').trim().slice(0, 150);
      const cleanLocation = coerceText(location || '').trim().slice(0, 150);

      const created = await withStaffTransaction(auth, req, async (tx) => {
        if (!internalId) {
          const lastRow = await tx<TimelineInternalIdRow>`
            SELECT internal_id FROM timeline_events
            WHERE internal_id ~ '^EV[0-9]+$'
            ORDER BY (SUBSTRING(internal_id FROM 3)::int) DESC
            LIMIT 1`;
          let nextNum = 1;
          const last = lastRow[0];
          if (last && last.internal_id) {
            const match = last.internal_id.match(/^EV([0-9]+)$/);
            const digits = match ? match[1] : undefined;
            if (digits) nextNum = Number.parseInt(digits, 10) + 1;
          }
          internalId = `EV${nextNum}`;
        }

        let parsedOrder = parseInteger(orderIndex);
        if (Number.isNaN(parsedOrder)) {
          const maxOrder = await tx<TimelineMaxOrderRow>`SELECT COALESCE(MAX(order_index), 0) AS max_o FROM timeline_events`;
          const maxRow = maxOrder[0];
          const maxValue = maxRow ? maxRow.max_o : null;
          parsedOrder = (typeof maxValue === 'number' ? maxValue : 0) + 1;
        }

        const rows = await tx<TimelineRow>`
          INSERT INTO timeline_events (
            internal_id, title, short_title, summary, color, era,
            start_date, end_date, order_index, tags, story_arc,
            characters, character_group, location
          ) VALUES (
            ${internalId}, ${cleanTitle}, ${cleanShortTitle}, ${cleanSummary},
            ${cleanColor}, ${cleanEra}, ${cleanStartDate}, ${cleanEndDate},
            ${parsedOrder}, ${cleanTags}, ${cleanStoryArc}, ${cleanCharacters},
            ${cleanCharGroup}, ${cleanLocation}
          ) RETURNING *`;
        const event = rows[0];
        if (!event) throw new Error('Timeline insert returned no row.');

        await writeTimelineAudit(tx, req, {
          action: 'timeline.create',
          targetId: event.id,
          reason: 'Criação de evento da timeline.',
          before: {},
          after: event,
        });
        return event;
      });

      res.status(201).json({ event: publicTimelineEvent(created) });
    } catch (error) {
      sendError(res, error);
    }
  });

  // Atualizar evento existente
  router.put('/:id', ...requireStaff, async (req, res) => {
    try {
      const id = validateUuid(req.params.id);
      const expectedUpdatedAt = expectedUpdatedAtFrom(req);
      const body = requestBody(req);

      const updated = await withStaffTransaction(auth, req, async (tx) => {
        const existing = await tx<TimelineRow>`SELECT * FROM timeline_events WHERE id = ${id} FOR UPDATE`;
        const row = existing[0];
        if (!row) {
          throw new ApiError(404, 'NOT_FOUND', 'Evento não encontrado para edição.');
        }

        if (expectedUpdatedAt !== undefined && !updatedAtMatches(row.updated_at, expectedUpdatedAt)) {
          throw staleUpdateError();
        }

        const title = body.title !== undefined ? coerceText(body.title).trim().slice(0, 250) : row.title;
        const shortTitle = body.shortTitle !== undefined ? coerceText(body.shortTitle).trim().slice(0, 150) : row.short_title;
        const summary = body.summary !== undefined ? coerceText(body.summary).trim() : row.summary;
        const color = body.color !== undefined ? coerceText(body.color).trim().slice(0, 50) : row.color;
        const era = body.era !== undefined ? coerceText(body.era).trim().slice(0, 50) : row.era;
        const startDate = body.startDate !== undefined ? coerceText(body.startDate).trim().slice(0, 100) : row.start_date;
        const endDate = body.endDate !== undefined ? coerceText(body.endDate).trim().slice(0, 100) : row.end_date;
        const tags = body.tags !== undefined ? coerceText(body.tags).trim().slice(0, 250) : row.tags;
        const storyArc = body.storyArc !== undefined ? coerceText(body.storyArc).trim().slice(0, 150) : row.story_arc;
        const characters = body.characters !== undefined ? coerceText(body.characters).trim() : row.characters;
        const characterGroup = body.characterGroup !== undefined ? coerceText(body.characterGroup).trim().slice(0, 150) : row.character_group;
        const location = body.location !== undefined ? coerceText(body.location).trim().slice(0, 150) : row.location;

        let orderIndex = row.order_index;
        if (body.orderIndex !== undefined) {
          const parsed = parseInteger(body.orderIndex);
          if (!Number.isNaN(parsed)) orderIndex = parsed;
        }

        const rows = expectedUpdatedAt === undefined
          ? await tx<TimelineRow>`
              UPDATE timeline_events
              SET title = ${title},
                  short_title = ${shortTitle},
                  summary = ${summary},
                  color = ${color},
                  era = ${era},
                  start_date = ${startDate},
                  end_date = ${endDate},
                  order_index = ${orderIndex},
                  tags = ${tags},
                  story_arc = ${storyArc},
                  characters = ${characters},
                  character_group = ${characterGroup},
                  location = ${location},
                  updated_at = now()
              WHERE id = ${id}
              RETURNING *`
          : await tx<TimelineRow>`
              UPDATE timeline_events
              SET title = ${title},
                  short_title = ${shortTitle},
                  summary = ${summary},
                  color = ${color},
                  era = ${era},
                  start_date = ${startDate},
                  end_date = ${endDate},
                  order_index = ${orderIndex},
                  tags = ${tags},
                  story_arc = ${storyArc},
                  characters = ${characters},
                  character_group = ${characterGroup},
                  location = ${location},
                  updated_at = now()
              WHERE id = ${id}
                AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', ${expectedUpdatedAt}::timestamptz)
              RETURNING *`;

        const updatedRow = rows[0];
        if (!updatedRow) {
          if (expectedUpdatedAt !== undefined) throw staleUpdateError();
          throw new ApiError(404, 'NOT_FOUND', 'Evento não encontrado para edição.');
        }

        await writeTimelineAudit(tx, req, {
          action: 'timeline.update',
          targetId: id,
          reason: 'Atualização de evento da timeline.',
          before: row,
          after: updatedRow,
        });
        return updatedRow;
      });

      res.json({ event: publicTimelineEvent(updated) });
    } catch (error) {
      sendError(res, error);
    }
  });

  // Excluir evento
  router.delete('/:id', ...requireStaff, async (req, res) => {
    try {
      const id = validateUuid(req.params.id);
      const expectedUpdatedAt = expectedUpdatedAtFrom(req);

      const result = await withStaffTransaction(auth, req, async (tx) => {
        const existing = await tx<TimelineRow>`SELECT * FROM timeline_events WHERE id = ${id} FOR UPDATE`;
        const row = existing[0];
        if (!row) {
          throw new ApiError(404, 'NOT_FOUND', 'Evento não encontrado para exclusão.');
        }

        if (expectedUpdatedAt !== undefined && !updatedAtMatches(row.updated_at, expectedUpdatedAt)) {
          throw staleUpdateError();
        }

        // Registra a linha completa antes da exclusão. A mesma transação garante
        // que auditoria e exclusão sejam confirmadas ou revertidas juntas.
        await writeTimelineAudit(tx, req, {
          action: 'timeline.delete',
          targetId: id,
          reason: 'Exclusão de evento da timeline.',
          before: row,
          after: {},
        });

        const deleted = expectedUpdatedAt === undefined
          ? await tx<TimelineDeletedRow>`DELETE FROM timeline_events WHERE id = ${id} RETURNING id, title`
          : await tx<TimelineDeletedRow>`
              DELETE FROM timeline_events
              WHERE id = ${id}
                AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', ${expectedUpdatedAt}::timestamptz)
              RETURNING id, title`;

        if (!deleted.length) {
          if (expectedUpdatedAt !== undefined) throw staleUpdateError();
          throw new ApiError(404, 'NOT_FOUND', 'Evento não encontrado para exclusão.');
        }

        return { success: true, deletedId: id };
      });

      res.json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  return router;
}
