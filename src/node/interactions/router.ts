import express from 'express';
import { ApiError, sendError } from '../../../server/errors.js';
import { validateUuid } from '../../../server/validation.js';
import type {
  CharacterLikeRow,
  CountRow,
  IdRow,
  InteractionsAuth,
  LikeStatusResult,
  LikeToggleResult,
  NotificationRow,
  QueryExecutor,
  SceneLikeRow,
} from './contract.js';
import { coerceText, countValue, queryParam, sessionUserId } from './contract.js';
import { createNotification, publicNotification } from './notifications.js';
import { resolveTurnLikeTarget, sceneScopedTurnKey, validateTurnId } from './turns.js';

export interface InteractionsDependencies {
  sql: QueryExecutor;
  auth: InteractionsAuth;
}

export function createInteractionsRouter({ sql, auth }: InteractionsDependencies) {
  const router = express.Router();

  // ==================== NOTIFICAÇÕES ====================

  router.get('/api/notifications', auth.requireIdentity, async function (req, res) {
    try {
      const userId = sessionUserId(req);
      const onlyUnread = queryParam(req.query, 'unread') === '1';
      const limitParsed = Number.parseInt(String(queryParam(req.query, 'limit')), 10);
      const limit = Number.isInteger(limitParsed) && limitParsed > 0 && limitParsed <= 100 ? limitParsed : 50;

      const rows = onlyUnread
        ? await sql<NotificationRow>`
            SELECT * FROM notifications
            WHERE user_id = ${userId} AND read = false
            ORDER BY created_at DESC
            LIMIT ${limit}`
        : await sql<NotificationRow>`
            SELECT * FROM notifications
            WHERE user_id = ${userId}
            ORDER BY created_at DESC
            LIMIT ${limit}`;

      const unreadCountRows = await sql<CountRow>`
        SELECT COUNT(*)::integer AS cnt FROM notifications
        WHERE user_id = ${userId} AND read = false`;

      res.json({
        notifications: rows.map(publicNotification),
        unread: countValue(unreadCountRows),
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/api/notifications/:id/read', auth.requireIdentity, async function (req, res) {
    try {
      const id = validateUuid(req.params.id);
      const rows = await sql<IdRow>`
        UPDATE notifications SET read = true
        WHERE id = ${id} AND user_id = ${sessionUserId(req)}
        RETURNING id`;
      if (rows.length === 0) throw new ApiError(404, 'NOT_FOUND', 'Notificação não encontrada.');
      res.json({ ok: true });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/api/notifications/read-all', auth.requireIdentity, async function (req, res) {
    try {
      await sql`
        UPDATE notifications SET read = true
        WHERE user_id = ${sessionUserId(req)} AND read = false`;
      res.json({ ok: true });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.delete('/api/notifications/:id', auth.requireIdentity, async function (req, res) {
    try {
      const id = validateUuid(req.params.id);
      const rows = await sql<IdRow>`
        DELETE FROM notifications
        WHERE id = ${id} AND user_id = ${sessionUserId(req)}
        RETURNING id`;
      if (rows.length === 0) throw new ApiError(404, 'NOT_FOUND', 'Notificação não encontrada.');
      res.json({ ok: true });
    } catch (error) {
      sendError(res, error);
    }
  });

  // ==================== CURTIDAS (LIKES) ====================

  // Curtir / descurtir personagem (ficha)
  router.post('/api/personagens/:id/like', auth.requireIdentity, async function (req, res) {
    try {
      const id = validateUuid(req.params.id);
      const result: LikeToggleResult = await auth.withActorTransaction(req, async (tx, user) => {
        const rows = await tx<CharacterLikeRow>`SELECT id, author_id, nome FROM personagens WHERE id = ${id} AND hidden_at IS NULL LIMIT 1`;
        const personagem = rows[0];
        if (!personagem) throw new ApiError(404, 'NOT_FOUND', 'Personagem não encontrado.');

        const existing = await tx<IdRow>`
          SELECT id FROM likes
          WHERE user_id = ${user.id} AND target_type = 'personagem' AND target_id = ${id}
          LIMIT 1`;

        let liked = false;
        const existingRow = existing[0];
        if (existingRow) {
          await tx`DELETE FROM likes WHERE id = ${existingRow.id}`;
          liked = false;
        } else {
          await tx`
            INSERT INTO likes (user_id, target_type, target_id)
            VALUES (${user.id}, 'personagem', ${id})
            ON CONFLICT (user_id, target_type, target_id) DO NOTHING`;
          liked = true;

          if (personagem.author_id && String(personagem.author_id) !== String(user.id)) {
            await createNotification(tx, {
              recipientId: personagem.author_id,
              actorId: user.id,
              type: 'like_personagem',
              referenceId: id,
              referenceType: 'personagem',
              title: 'Alguém curtiu sua ficha',
              message: `${coerceText(user.username)} curtiu a ficha do personagem "${personagem.nome || 'Personagem'}".`,
            });
          }
        }

        const countRows = await tx<CountRow>`
          SELECT COUNT(*)::integer AS cnt FROM likes
          WHERE target_type = 'personagem' AND target_id = ${id}`;
        return { liked, likeCount: countValue(countRows) };
      });

      res.json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  // Contagem de curtidas para personagem
  router.get('/api/personagens/:id/likes', async function (req, res) {
    try {
      const id = validateUuid(req.params.id);
      const countRows = await sql<CountRow>`
        SELECT COUNT(*)::integer AS cnt FROM likes
        WHERE target_type = 'personagem' AND target_id = ${id}`;
      let userLiked = false;
      const viewerId = sessionUserId(req);
      if (viewerId) {
        const me = await sql<IdRow>`
          SELECT id FROM likes
          WHERE user_id = ${viewerId} AND target_type = 'personagem' AND target_id = ${id}
          LIMIT 1`;
        userLiked = me.length > 0;
      }
      const status: LikeStatusResult = { likeCount: countValue(countRows), userLiked };
      res.json(status);
    } catch (error) {
      sendError(res, error);
    }
  });

  // Curtir / descurtir cena / post da wikia
  router.post('/api/wiki-posts/:id/like', auth.requireIdentity, async function (req, res) {
    try {
      const id = validateUuid(req.params.id);
      const result: LikeToggleResult = await auth.withActorTransaction(req, async (tx, user) => {
        const rows = await tx<SceneLikeRow>`SELECT id, author_id, titulo FROM wiki_posts WHERE id = ${id} AND hidden_at IS NULL LIMIT 1`;
        const post = rows[0];
        if (!post) throw new ApiError(404, 'NOT_FOUND', 'Cena não encontrada.');

        const existing = await tx<IdRow>`
          SELECT id FROM likes
          WHERE user_id = ${user.id} AND target_type = 'wiki_post' AND target_id = ${id}
          LIMIT 1`;

        let liked = false;
        const existingRow = existing[0];
        if (existingRow) {
          await tx`DELETE FROM likes WHERE id = ${existingRow.id}`;
          liked = false;
        } else {
          await tx`
            INSERT INTO likes (user_id, target_type, target_id)
            VALUES (${user.id}, 'wiki_post', ${id})
            ON CONFLICT (user_id, target_type, target_id) DO NOTHING`;
          liked = true;

          if (post.author_id && String(post.author_id) !== String(user.id)) {
            await createNotification(tx, {
              recipientId: post.author_id,
              actorId: user.id,
              type: 'like_wiki_post',
              referenceId: id,
              referenceType: 'wiki_post',
              title: 'Alguém curtiu sua cena',
              message: `${coerceText(user.username)} curtiu a cena "${post.titulo || 'Cena'}".`,
            });
          }
        }

        const countRows = await tx<CountRow>`
          SELECT COUNT(*)::integer AS cnt FROM likes
          WHERE target_type = 'wiki_post' AND target_id = ${id}`;
        return { liked, likeCount: countValue(countRows) };
      });

      res.json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  // Contagem de curtidas para cena
  router.get('/api/wiki-posts/:id/likes', async function (req, res) {
    try {
      const id = validateUuid(req.params.id);
      const countRows = await sql<CountRow>`
        SELECT COUNT(*)::integer AS cnt FROM likes
        WHERE target_type = 'wiki_post' AND target_id = ${id}`;
      let userLiked = false;
      const viewerId = sessionUserId(req);
      if (viewerId) {
        const me = await sql<IdRow>`
          SELECT id FROM likes
          WHERE user_id = ${viewerId} AND target_type = 'wiki_post' AND target_id = ${id}
          LIMIT 1`;
        userLiked = me.length > 0;
      }
      const status: LikeStatusResult = { likeCount: countValue(countRows), userLiked };
      res.json(status);
    } catch (error) {
      sendError(res, error);
    }
  });

  // Curtir / descurtir turno de uma cena
  router.post('/api/wiki-posts/:id/turns/:turnId/like', auth.requireIdentity, async function (req, res) {
    try {
      const sceneId = validateUuid(req.params.id);
      const rawTurnId = validateTurnId(req.params.turnId);

      const result: LikeToggleResult = await auth.withActorTransaction(req, async (tx, user) => {
        const sceneRows = await tx<SceneLikeRow>`SELECT id, author_id, titulo, turns FROM wiki_posts WHERE id = ${sceneId} AND hidden_at IS NULL LIMIT 1`;
        const scene = sceneRows[0];
        if (!scene) throw new ApiError(404, 'NOT_FOUND', 'Cena não encontrada.');

        const target = await resolveTurnLikeTarget(tx, sceneId, rawTurnId, scene);
        if (!target) throw new ApiError(404, 'NOT_FOUND', 'Turno não encontrado.');
        const likeKey = target.key;
        const turnAuthorId = target.turnAuthorId;

        const existing = await tx<IdRow>`
          SELECT id FROM likes
          WHERE user_id = ${user.id} AND target_type = 'turn' AND target_id = ${likeKey}
          LIMIT 1`;

        let liked = false;
        const existingRow = existing[0];
        if (existingRow) {
          await tx`DELETE FROM likes WHERE id = ${existingRow.id}`;
          liked = false;
        } else {
          await tx`
            INSERT INTO likes (user_id, target_type, target_id)
            VALUES (${user.id}, 'turn', ${likeKey})
            ON CONFLICT (user_id, target_type, target_id) DO NOTHING`;
          liked = true;

          if (turnAuthorId && coerceText(turnAuthorId) !== coerceText(user.id)) {
            await createNotification(tx, {
              recipientId: turnAuthorId,
              actorId: user.id,
              type: 'like_turn',
              referenceId: sceneId,
              referenceType: 'wiki_post',
              title: 'Alguém curtiu seu turno',
              message: `${coerceText(user.username)} curtiu seu turno na cena "${scene.titulo || 'Cena'}".`,
            });
          }
        }

        const countRows = await tx<CountRow>`
          SELECT COUNT(*)::integer AS cnt FROM likes
          WHERE target_type = 'turn' AND target_id = ${likeKey}`;
        return { liked, likeCount: countValue(countRows) };
      });

      res.json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  // Contagem de curtidas para turno
  router.get('/api/wiki-posts/:id/turns/:turnId/likes', async function (req, res) {
    try {
      const sceneId = validateUuid(req.params.id);
      const rawTurnId = validateTurnId(req.params.turnId);
      const target = await resolveTurnLikeTarget(sql, sceneId, rawTurnId);
      const likeKey = target ? target.key : sceneScopedTurnKey(sceneId, rawTurnId);

      const countRows = await sql<CountRow>`
        SELECT COUNT(*)::integer AS cnt FROM likes
        WHERE target_type = 'turn' AND target_id = ${likeKey}`;
      let userLiked = false;
      const viewerId = sessionUserId(req);
      if (viewerId) {
        const me = await sql<IdRow>`
          SELECT id FROM likes
          WHERE user_id = ${viewerId} AND target_type = 'turn' AND target_id = ${likeKey}
          LIMIT 1`;
        userLiked = me.length > 0;
      }
      const status: LikeStatusResult = { likeCount: countValue(countRows), userLiked };
      res.json(status);
    } catch (error) {
      sendError(res, error);
    }
  });

  return router;
}
