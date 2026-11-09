'use strict';

const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const { ApiError, sendError } = require('./errors');
const { validateUuid } = require('./validation');

const SEED_FILE = path.join(__dirname, 'timeline-seed.json');

function publicTimelineEvent(row) {
  return {
    id: row.id,
    internalId: row.internal_id,
    title: row.title,
    shortTitle: row.short_title || row.title,
    summary: row.summary || '',
    color: row.color || 'Green',
    era: row.era || 'Before Daare',
    startDate: row.start_date,
    endDate: row.end_date || '',
    orderIndex: row.order_index || 0,
    tags: row.tags || '',
    storyArc: row.story_arc || '',
    characters: row.characters || '',
    characterGroup: row.character_group || '',
    location: row.location || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function ensureTimelineSchema(sql) {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS "timeline_events" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "internal_id" varchar(50) NOT NULL,
        "title" varchar(250) NOT NULL,
        "short_title" varchar(150),
        "summary" text DEFAULT '',
        "color" varchar(50) DEFAULT 'Green',
        "era" varchar(50) DEFAULT 'Before Daare' NOT NULL,
        "start_date" varchar(100) NOT NULL,
        "end_date" varchar(100),
        "order_index" integer DEFAULT 0 NOT NULL,
        "tags" varchar(250) DEFAULT '',
        "story_arc" varchar(150) DEFAULT '',
        "characters" text DEFAULT '',
        "character_group" varchar(150) DEFAULT '',
        "location" varchar(150) DEFAULT '',
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
      )`;

    await sql`CREATE INDEX IF NOT EXISTS "idx_timeline_events_era" ON "timeline_events" ("era")`;
    await sql`CREATE INDEX IF NOT EXISTS "idx_timeline_events_order" ON "timeline_events" ("order_index")`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS "idx_timeline_events_internal_id" ON "timeline_events" ("internal_id")`;

    await seedTimelineIfEmpty(sql);
  } catch (err) {
    console.warn('Aviso ao verificar schema da timeline:', err.message);
  }
}

async function seedTimelineIfEmpty(sql) {
  try {
    const existing = await sql`SELECT count(*)::int AS total FROM timeline_events`;
    if (existing[0] && existing[0].total > 0) return;

    if (!fs.existsSync(SEED_FILE)) return;
    const items = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
    if (!Array.isArray(items) || items.length === 0) return;

    for (const item of items) {
      await sql`
        INSERT INTO timeline_events (
          internal_id, title, short_title, summary, color, era,
          start_date, end_date, order_index, tags, story_arc,
          characters, character_group, location
        ) VALUES (
          ${item.internalId}, ${item.title}, ${item.shortTitle || item.title},
          ${item.summary || ''}, ${item.color || 'Green'}, ${item.era || 'Before Daare'},
          ${item.startDate}, ${item.endDate || ''}, ${item.orderIndex || 0},
          ${item.tags || ''}, ${item.storyArc || ''}, ${item.characters || ''},
          ${item.characterGroup || ''}, ${item.location || ''}
        ) ON CONFLICT (internal_id) DO NOTHING`;
    }
    console.log(`[Timeline] Seed de ${items.length} eventos executado com sucesso.`);
  } catch (err) {
    console.warn('[Timeline] Falha ao popular seed inicial da timeline:', err.message);
  }
}

function createTimelineRouter(dependencies = {}) {
  const sql = dependencies.sql;
  const auth = dependencies.auth;
  if (!sql) throw new TypeError('createTimelineRouter requires an injected postgres sql client.');

  const router = express.Router();

  // Listar todos os eventos da timeline com suporte a filtros
  router.get('/', async (req, res) => {
    try {
      const eraFilter = typeof req.query.era === 'string' ? req.query.era.trim() : '';
      const characterFilter = typeof req.query.character === 'string' ? req.query.character.trim().toLowerCase() : '';
      const search = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';

      let rows;
      if (eraFilter && eraFilter !== 'all') {
        rows = await sql`
          SELECT * FROM timeline_events
          WHERE era = ${eraFilter}
          ORDER BY order_index ASC, created_at ASC`;
      } else {
        rows = await sql`
          SELECT * FROM timeline_events
          ORDER BY order_index ASC, created_at ASC`;
      }

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

      return res.json({ events });
    } catch (err) {
      return sendError(res, err);
    }
  });

  // Obter um evento específico por ID ou internalId
  router.get('/:id', async (req, res) => {
    try {
      const idOrInternal = req.params.id;
      let rows;
      try {
        validateUuid(idOrInternal);
        rows = await sql`SELECT * FROM timeline_events WHERE id = ${idOrInternal} LIMIT 1`;
      } catch {
        rows = await sql`SELECT * FROM timeline_events WHERE internal_id = ${idOrInternal} LIMIT 1`;
      }

      if (!rows.length) {
        throw new ApiError(404, 'NOT_FOUND', 'Evento da timeline não encontrado.');
      }

      return res.json({ event: publicTimelineEvent(rows[0]) });
    } catch (err) {
      return sendError(res, err);
    }
  });

  // Middleware de autorização para Moderadores e Administradores
  const requireStaff = [
    auth.requireIdentity,
    auth.requireRole('moderador', 'admin'),
  ];

  // Criar um novo evento na timeline
  router.post('/', requireStaff, async (req, res) => {
    try {
      const {
        title, shortTitle, summary, color, era,
        startDate, endDate, orderIndex, tags,
        storyArc, characters, characterGroup, location,
      } = req.body;

      if (!title || typeof title !== 'string' || !title.trim()) {
        throw new ApiError(400, 'INVALID_INPUT', 'O título do evento é obrigatório.');
      }
      if (!startDate || typeof startDate !== 'string' || !startDate.trim()) {
        throw new ApiError(400, 'INVALID_INPUT', 'A data de início do evento é obrigatória.');
      }

      // Gera internal_id automático se não fornecido
      let internalId = typeof req.body.internalId === 'string' && req.body.internalId.trim()
        ? req.body.internalId.trim()
        : null;

      if (!internalId) {
        const lastRow = await sql`
          SELECT internal_id FROM timeline_events
          WHERE internal_id ~ '^EV[0-9]+$'
          ORDER BY (SUBSTRING(internal_id FROM 3)::int) DESC
          LIMIT 1`;
        let nextNum = 1;
        if (lastRow.length && lastRow[0].internal_id) {
          const match = lastRow[0].internal_id.match(/^EV([0-9]+)$/);
          if (match) nextNum = parseInt(match[1], 10) + 1;
        }
        internalId = `EV${nextNum}`;
      }

      let parsedOrder = parseInt(orderIndex, 10);
      if (isNaN(parsedOrder)) {
        const maxOrder = await sql`SELECT COALESCE(MAX(order_index), 0) AS max_o FROM timeline_events`;
        parsedOrder = (maxOrder[0]?.max_o || 0) + 1;
      }

      const cleanTitle = title.trim().slice(0, 250);
      const cleanShortTitle = (shortTitle ? String(shortTitle).trim() : cleanTitle).slice(0, 150);
      const cleanSummary = String(summary || '').trim();
      const cleanColor = String(color || 'Green').trim().slice(0, 50);
      const cleanEra = String(era || 'Before Daare').trim().slice(0, 50);
      const cleanStartDate = startDate.trim().slice(0, 100);
      const cleanEndDate = String(endDate || '').trim().slice(0, 100);
      const cleanTags = String(tags || '').trim().slice(0, 250);
      const cleanStoryArc = String(storyArc || '').trim().slice(0, 150);
      const cleanCharacters = String(characters || '').trim();
      const cleanCharGroup = String(characterGroup || '').trim().slice(0, 150);
      const cleanLocation = String(location || '').trim().slice(0, 150);

      const rows = await sql`
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

      return res.status(201).json({ event: publicTimelineEvent(rows[0]) });
    } catch (err) {
      return sendError(res, err);
    }
  });

  // Atualizar evento existente
  router.put('/:id', requireStaff, async (req, res) => {
    try {
      const id = req.params.id;
      validateUuid(id);

      const existing = await sql`SELECT * FROM timeline_events WHERE id = ${id} LIMIT 1`;
      if (!existing.length) {
        throw new ApiError(404, 'NOT_FOUND', 'Evento não encontrado para edição.');
      }

      const row = existing[0];
      const title = req.body.title !== undefined ? String(req.body.title).trim().slice(0, 250) : row.title;
      const shortTitle = req.body.shortTitle !== undefined ? String(req.body.shortTitle).trim().slice(0, 150) : row.short_title;
      const summary = req.body.summary !== undefined ? String(req.body.summary).trim() : row.summary;
      const color = req.body.color !== undefined ? String(req.body.color).trim().slice(0, 50) : row.color;
      const era = req.body.era !== undefined ? String(req.body.era).trim().slice(0, 50) : row.era;
      const startDate = req.body.startDate !== undefined ? String(req.body.startDate).trim().slice(0, 100) : row.start_date;
      const endDate = req.body.endDate !== undefined ? String(req.body.endDate).trim().slice(0, 100) : row.end_date;
      const tags = req.body.tags !== undefined ? String(req.body.tags).trim().slice(0, 250) : row.tags;
      const storyArc = req.body.storyArc !== undefined ? String(req.body.storyArc).trim().slice(0, 150) : row.story_arc;
      const characters = req.body.characters !== undefined ? String(req.body.characters).trim() : row.characters;
      const characterGroup = req.body.characterGroup !== undefined ? String(req.body.characterGroup).trim().slice(0, 150) : row.character_group;
      const location = req.body.location !== undefined ? String(req.body.location).trim().slice(0, 150) : row.location;

      let orderIndex = row.order_index;
      if (req.body.orderIndex !== undefined && !isNaN(parseInt(req.body.orderIndex, 10))) {
        orderIndex = parseInt(req.body.orderIndex, 10);
      }

      const updated = await sql`
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
        RETURNING *`;

      return res.json({ event: publicTimelineEvent(updated[0]) });
    } catch (err) {
      return sendError(res, err);
    }
  });

  // Excluir evento
  router.delete('/:id', requireStaff, async (req, res) => {
    try {
      const id = req.params.id;
      validateUuid(id);

      const deleted = await sql`DELETE FROM timeline_events WHERE id = ${id} RETURNING id, title`;
      if (!deleted.length) {
        throw new ApiError(404, 'NOT_FOUND', 'Evento não encontrado para exclusão.');
      }

      return res.json({ success: true, deletedId: id });
    } catch (err) {
      return sendError(res, err);
    }
  });

  return router;
}

module.exports = {
  createTimelineRouter,
  ensureTimelineSchema,
  seedTimelineIfEmpty,
  publicTimelineEvent,
};
