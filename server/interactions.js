'use strict';

const express = require('express');
const { ApiError, sendError } = require('./errors');
const { validateUuid } = require('./validation');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function publicNotification(n) {
  return {
    id: n.id,
    type: n.type,
    referenceId: n.reference_id,
    referenceType: n.reference_type,
    title: n.title,
    message: n.message,
    read: n.read === true,
    createdAt: n.created_at,
    actorId: n.actor_id,
  };
}

/**
 * Cria ou atualiza uma notificação com proteção anti-spam (dedup).
 * Se o usuário já tiver uma notificação recente não lida do mesmo ator/tipo/referência,
 * apenas renova o timestamp em vez de criar linhas duplicadas.
 */
async function createNotification(executor, { recipientId, actorId, type, referenceId, referenceType, title, message }) {
  if (!recipientId || String(recipientId) === String(actorId)) return null;
  const recipient = String(recipientId).toLowerCase();
  const actor = actorId && UUID_RE.test(String(actorId)) ? String(actorId).toLowerCase() : null;
  const safeType = String(type || '').slice(0, 40);
  const safeRefId = referenceId ? String(referenceId).slice(0, 200) : null;
  const safeRefType = referenceType ? String(referenceType).slice(0, 40) : null;
  const safeTitle = String(title || 'Notificação').slice(0, 200);
  const safeMessage = String(message || '').slice(0, 1000);

  try {
    // Dedup: se já existe notificação não lida para este recipient, do mesmo actor, tipo e referência
    const existing = await executor`
      SELECT id FROM notifications
      WHERE user_id = ${recipient}
        AND actor_id IS NOT DISTINCT FROM ${actor}
        AND type = ${safeType}
        AND reference_id IS NOT DISTINCT FROM ${safeRefId}
        AND read = false
        AND created_at > now() - interval '24 hours'
      LIMIT 1`;

    if (existing.length > 0) {
      const updated = await executor`
        UPDATE notifications
        SET title = ${safeTitle}, message = ${safeMessage}, created_at = now()
        WHERE id = ${existing[0].id}
        RETURNING *`;
      return updated[0] ? publicNotification(updated[0]) : null;
    }

    const inserted = await executor`
      INSERT INTO notifications (user_id, actor_id, type, reference_id, reference_type, title, message)
      VALUES (${recipient}, ${actor}, ${safeType}, ${safeRefId}, ${safeRefType}, ${safeTitle}, ${safeMessage})
      RETURNING *`;
    return inserted[0] ? publicNotification(inserted[0]) : null;
  } catch (err) {
    console.warn('createNotification aviso:', err.message);
    return null;
  }
}

function createInteractionsRouter({ sql, auth }) {
  const router = express.Router();

  // ==================== NOTIFICAÇÕES ====================

  router.get('/api/notifications', auth.requireIdentity, async function (req, res) {
    try {
      const userId = req.session.userId;
      const onlyUnread = req.query.unread === '1';
      const limitParsed = parseInt(req.query.limit, 10);
      const limit = Number.isInteger(limitParsed) && limitParsed > 0 && limitParsed <= 100 ? limitParsed : 50;

      let rows;
      if (onlyUnread) {
        rows = await sql`
          SELECT * FROM notifications
          WHERE user_id = ${userId} AND read = false
          ORDER BY created_at DESC
          LIMIT ${limit}`;
      } else {
        rows = await sql`
          SELECT * FROM notifications
          WHERE user_id = ${userId}
          ORDER BY created_at DESC
          LIMIT ${limit}`;
      }

      const unreadCountRows = await sql`
        SELECT COUNT(*)::integer AS cnt FROM notifications
        WHERE user_id = ${userId} AND read = false`;
      const unreadCount = unreadCountRows[0] ? unreadCountRows[0].cnt : 0;

      res.json({
        notifications: rows.map(publicNotification),
        unread: unreadCount,
      });
    } catch (err) {
      return sendError(res, err);
    }
  });

  router.post('/api/notifications/:id/read', auth.requireIdentity, async function (req, res) {
    try {
      const id = validateUuid(req.params.id);
      const rows = await sql`
        UPDATE notifications SET read = true
        WHERE id = ${id} AND user_id = ${req.session.userId}
        RETURNING id`;
      if (rows.length === 0) throw new ApiError(404, 'NOT_FOUND', 'Notificação não encontrada.');
      res.json({ ok: true });
    } catch (err) {
      return sendError(res, err);
    }
  });

  router.post('/api/notifications/read-all', auth.requireIdentity, async function (req, res) {
    try {
      await sql`
        UPDATE notifications SET read = true
        WHERE user_id = ${req.session.userId} AND read = false`;
      res.json({ ok: true });
    } catch (err) {
      return sendError(res, err);
    }
  });

  router.delete('/api/notifications/:id', auth.requireIdentity, async function (req, res) {
    try {
      const id = validateUuid(req.params.id);
      const rows = await sql`
        DELETE FROM notifications
        WHERE id = ${id} AND user_id = ${req.session.userId}
        RETURNING id`;
      if (rows.length === 0) throw new ApiError(404, 'NOT_FOUND', 'Notificação não encontrada.');
      res.json({ ok: true });
    } catch (err) {
      return sendError(res, err);
    }
  });

  // ==================== CURTIDAS (LIKES) ====================

  // Curtir / descurtir personagem (ficha)
  router.post('/api/personagens/:id/like', auth.requireIdentity, async function (req, res) {
    try {
      const id = validateUuid(req.params.id);
      const result = await auth.withActorTransaction(req, async (tx, user) => {
        const rows = await tx`SELECT id, author_id, nome FROM personagens WHERE id = ${id} AND hidden_at IS NULL LIMIT 1`;
        if (rows.length === 0) throw new ApiError(404, 'NOT_FOUND', 'Personagem não encontrado.');
        const p = rows[0];

        const existing = await tx`
          SELECT id FROM likes
          WHERE user_id = ${user.id} AND target_type = 'personagem' AND target_id = ${id}
          LIMIT 1`;

        let liked = false;
        if (existing.length > 0) {
          await tx`DELETE FROM likes WHERE id = ${existing[0].id}`;
          liked = false;
        } else {
          await tx`
            INSERT INTO likes (user_id, target_type, target_id)
            VALUES (${user.id}, 'personagem', ${id})
            ON CONFLICT (user_id, target_type, target_id) DO NOTHING`;
          liked = true;

          if (p.author_id && String(p.author_id) !== String(user.id)) {
            await createNotification(tx, {
              recipientId: p.author_id,
              actorId: user.id,
              type: 'like_personagem',
              referenceId: id,
              referenceType: 'personagem',
              title: 'Alguém curtiu sua ficha',
              message: `${user.username} curtiu a ficha do personagem "${p.nome || 'Personagem'}".`,
            });
          }
        }

        const countRows = await tx`
          SELECT COUNT(*)::integer AS cnt FROM likes
          WHERE target_type = 'personagem' AND target_id = ${id}`;
        return { liked, likeCount: countRows[0] ? countRows[0].cnt : 0 };
      });

      res.json(result);
    } catch (err) {
      return sendError(res, err);
    }
  });

  // Contagem de curtidas para personagem
  router.get('/api/personagens/:id/likes', async function (req, res) {
    try {
      const id = validateUuid(req.params.id);
      const countRows = await sql`
        SELECT COUNT(*)::integer AS cnt FROM likes
        WHERE target_type = 'personagem' AND target_id = ${id}`;
      let userLiked = false;
      if (req.session && req.session.userId) {
        const me = await sql`
          SELECT id FROM likes
          WHERE user_id = ${req.session.userId} AND target_type = 'personagem' AND target_id = ${id}
          LIMIT 1`;
        userLiked = me.length > 0;
      }
      res.json({ likeCount: countRows[0] ? countRows[0].cnt : 0, userLiked });
    } catch (err) {
      return sendError(res, err);
    }
  });

  // Curtir / descurtir cena / post da wikia
  router.post('/api/wiki-posts/:id/like', auth.requireIdentity, async function (req, res) {
    try {
      const id = validateUuid(req.params.id);
      const result = await auth.withActorTransaction(req, async (tx, user) => {
        const rows = await tx`SELECT id, author_id, titulo FROM wiki_posts WHERE id = ${id} AND hidden_at IS NULL LIMIT 1`;
        if (rows.length === 0) throw new ApiError(404, 'NOT_FOUND', 'Cena não encontrada.');
        const p = rows[0];

        const existing = await tx`
          SELECT id FROM likes
          WHERE user_id = ${user.id} AND target_type = 'wiki_post' AND target_id = ${id}
          LIMIT 1`;

        let liked = false;
        if (existing.length > 0) {
          await tx`DELETE FROM likes WHERE id = ${existing[0].id}`;
          liked = false;
        } else {
          await tx`
            INSERT INTO likes (user_id, target_type, target_id)
            VALUES (${user.id}, 'wiki_post', ${id})
            ON CONFLICT (user_id, target_type, target_id) DO NOTHING`;
          liked = true;

          if (p.author_id && String(p.author_id) !== String(user.id)) {
            await createNotification(tx, {
              recipientId: p.author_id,
              actorId: user.id,
              type: 'like_wiki_post',
              referenceId: id,
              referenceType: 'wiki_post',
              title: 'Alguém curtiu sua cena',
              message: `${user.username} curtiu a cena "${p.titulo || 'Cena'}".`,
            });
          }
        }

        const countRows = await tx`
          SELECT COUNT(*)::integer AS cnt FROM likes
          WHERE target_type = 'wiki_post' AND target_id = ${id}`;
        return { liked, likeCount: countRows[0] ? countRows[0].cnt : 0 };
      });

      res.json(result);
    } catch (err) {
      return sendError(res, err);
    }
  });

  // Contagem de curtidas para cena
  router.get('/api/wiki-posts/:id/likes', async function (req, res) {
    try {
      const id = validateUuid(req.params.id);
      const countRows = await sql`
        SELECT COUNT(*)::integer AS cnt FROM likes
        WHERE target_type = 'wiki_post' AND target_id = ${id}`;
      let userLiked = false;
      if (req.session && req.session.userId) {
        const me = await sql`
          SELECT id FROM likes
          WHERE user_id = ${req.session.userId} AND target_type = 'wiki_post' AND target_id = ${id}
          LIMIT 1`;
        userLiked = me.length > 0;
      }
      res.json({ likeCount: countRows[0] ? countRows[0].cnt : 0, userLiked });
    } catch (err) {
      return sendError(res, err);
    }
  });

  // Curtir / descurtir turno de uma cena
  router.post('/api/wiki-posts/:id/turns/:turnId/like', auth.requireIdentity, async function (req, res) {
    try {
      const sceneId = validateUuid(req.params.id);
      const rawTurnId = String(req.params.turnId || '');
      if (!rawTurnId || rawTurnId.length > 80 || /[\u0000-\u001f\u007f]/.test(rawTurnId)) {
        throw new ApiError(400, 'INVALID_TURN_ID', 'Identificador de turno inválido.');
      }

      const result = await auth.withActorTransaction(req, async (tx, user) => {
        const sceneRows = await tx`SELECT id, author_id, titulo, turns FROM wiki_posts WHERE id = ${sceneId} AND hidden_at IS NULL LIMIT 1`;
        if (sceneRows.length === 0) throw new ApiError(404, 'NOT_FOUND', 'Cena não encontrada.');
        const scene = sceneRows[0];

        // Tenta encontrar turno em scene_turns (UUID ou legacy_id)
        let turnAuthorId = null;
        let canonicalTurnId = rawTurnId;

        const isUuid = UUID_RE.test(rawTurnId);
        const stRows = isUuid
          ? await tx`SELECT id, legacy_id, author_id FROM scene_turns WHERE scene_id = ${sceneId} AND (id = ${rawTurnId.toLowerCase()} OR legacy_id = ${rawTurnId}) AND deleted_at IS NULL LIMIT 1`
          : await tx`SELECT id, legacy_id, author_id FROM scene_turns WHERE scene_id = ${sceneId} AND legacy_id = ${rawTurnId} AND deleted_at IS NULL LIMIT 1`;

        if (stRows.length > 0) {
          turnAuthorId = stRows[0].author_id;
          canonicalTurnId = stRows[0].legacy_id || String(stRows[0].id);
        } else if (Array.isArray(scene.turns)) {
          // Fallback para turns em JSON
          const found = scene.turns.find(function (t) { return String(t && t.id) === rawTurnId; });
          if (!found) throw new ApiError(404, 'NOT_FOUND', 'Turno não encontrado.');
          turnAuthorId = found.authorId || null;
        } else {
          throw new ApiError(404, 'NOT_FOUND', 'Turno não encontrado.');
        }

        const existing = await tx`
          SELECT id FROM likes
          WHERE user_id = ${user.id} AND target_type = 'turn' AND target_id = ${rawTurnId}
          LIMIT 1`;

        let liked = false;
        if (existing.length > 0) {
          await tx`DELETE FROM likes WHERE id = ${existing[0].id}`;
          liked = false;
        } else {
          await tx`
            INSERT INTO likes (user_id, target_type, target_id)
            VALUES (${user.id}, 'turn', ${rawTurnId})
            ON CONFLICT (user_id, target_type, target_id) DO NOTHING`;
          liked = true;

          if (turnAuthorId && String(turnAuthorId) !== String(user.id)) {
            await createNotification(tx, {
              recipientId: turnAuthorId,
              actorId: user.id,
              type: 'like_turn',
              referenceId: sceneId,
              referenceType: 'wiki_post',
              title: 'Alguém curtiu seu turno',
              message: `${user.username} curtiu seu turno na cena "${scene.titulo || 'Cena'}".`,
            });
          }
        }

        const countRows = await tx`
          SELECT COUNT(*)::integer AS cnt FROM likes
          WHERE target_type = 'turn' AND target_id = ${rawTurnId}`;
        return { liked, likeCount: countRows[0] ? countRows[0].cnt : 0 };
      });

      res.json(result);
    } catch (err) {
      return sendError(res, err);
    }
  });

  // Contagem de curtidas para turno
  router.get('/api/wiki-posts/:id/turns/:turnId/likes', async function (req, res) {
    try {
      const rawTurnId = String(req.params.turnId || '');
      if (!rawTurnId || rawTurnId.length > 80) throw new ApiError(400, 'INVALID_TURN_ID', 'ID de turno inválido.');

      const countRows = await sql`
        SELECT COUNT(*)::integer AS cnt FROM likes
        WHERE target_type = 'turn' AND target_id = ${rawTurnId}`;
      let userLiked = false;
      if (req.session && req.session.userId) {
        const me = await sql`
          SELECT id FROM likes
          WHERE user_id = ${req.session.userId} AND target_type = 'turn' AND target_id = ${rawTurnId}
          LIMIT 1`;
        userLiked = me.length > 0;
      }
      res.json({ likeCount: countRows[0] ? countRows[0].cnt : 0, userLiked });
    } catch (err) {
      return sendError(res, err);
    }
  });

  return router;
}

module.exports = {
  createInteractionsRouter,
  createNotification,
  publicNotification,
};
