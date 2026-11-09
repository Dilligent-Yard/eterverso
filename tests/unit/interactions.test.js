'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createInteractionsRouter, createNotification, publicNotification } = require('../../server/interactions');

test('publicNotification formata os campos públicos de forma segura', () => {
  const row = {
    id: 'a0000000-0000-0000-0000-000000000001',
    user_id: 'b0000000-0000-0000-0000-000000000002',
    actor_id: 'c0000000-0000-0000-0000-000000000003',
    type: 'turn_replied',
    reference_id: 'd0000000-0000-0000-0000-000000000004',
    reference_type: 'wiki_post',
    title: 'Novo turno na sua cena',
    message: 'Shin postou um turno.',
    read: false,
    created_at: '2026-11-09T12:00:00.000Z',
  };

  const formatted = publicNotification(row);
  assert.equal(formatted.id, row.id);
  assert.equal(formatted.type, 'turn_replied');
  assert.equal(formatted.referenceId, row.reference_id);
  assert.equal(formatted.referenceType, 'wiki_post');
  assert.equal(formatted.title, 'Novo turno na sua cena');
  assert.equal(formatted.message, 'Shin postou um turno.');
  assert.equal(formatted.read, false);
  assert.equal(formatted.actorId, row.actor_id);
  assert.equal(formatted.createdAt, row.created_at);
});

test('createNotification ignora auto-notificação quando actorId é igual ao recipientId', async () => {
  let executed = false;
  const mockSql = async () => {
    executed = true;
    return [];
  };

  const result = await createNotification(mockSql, {
    recipientId: 'a0000000-0000-0000-0000-000000000001',
    actorId: 'a0000000-0000-0000-0000-000000000001',
    type: 'like_personagem',
    title: 'Teste',
  });

  assert.equal(result, null);
  assert.equal(executed, false, 'Não deve abrir consulta quando o ator for o próprio destinatário');
});

test('createNotification aplica dedup e atualiza notificação não lida recente existente', async () => {
  const existingId = 'e0000000-0000-0000-0000-000000000005';
  let updateCalled = false;

  const mockSql = async (strings, ...values) => {
    const query = strings.join(' ');
    if (query.includes('SELECT id FROM notifications')) {
      // Simula que já existe notificação recente não lida
      return [{ id: existingId }];
    }
    if (query.includes('UPDATE notifications')) {
      updateCalled = true;
      return [{
        id: existingId,
        user_id: 'a0000000-0000-0000-0000-000000000001',
        actor_id: 'b0000000-0000-0000-0000-000000000002',
        type: 'like_personagem',
        reference_id: 'c0000000-0000-0000-0000-000000000003',
        reference_type: 'personagem',
        title: 'Atualizado',
        message: 'Novo like',
        read: false,
        created_at: new Date().toISOString(),
      }];
    }
    return [];
  };

  const res = await createNotification(mockSql, {
    recipientId: 'a0000000-0000-0000-0000-000000000001',
    actorId: 'b0000000-0000-0000-0000-000000000002',
    type: 'like_personagem',
    referenceId: 'c0000000-0000-0000-0000-000000000003',
    referenceType: 'personagem',
    title: 'Atualizado',
    message: 'Novo like',
  });

  assert.equal(updateCalled, true, 'Deve atualizar a notificação existente em vez de duplicar');
  assert.ok(res);
  assert.equal(res.id, existingId);
});

test('createInteractionsRouter expõe endpoints de notificações e curtidas', () => {
  const mockSql = () => Promise.resolve([]);
  mockSql.json = (v) => v;
  const mockAuth = {
    requireIdentity: (_req, _res, next) => next(),
    withActorTransaction: async (_req, cb) => cb(mockSql, { id: '00000000-0000-0000-0000-000000000001', username: 'TestUser' }),
  };

  const router = createInteractionsRouter({ sql: mockSql, auth: mockAuth });
  const app = express();
  app.use(router);

  const routes = router.stack
    .filter((layer) => layer.route)
    .map((layer) => `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`);

  assert.ok(routes.includes('GET /api/notifications'));
  assert.ok(routes.includes('POST /api/notifications/:id/read'));
  assert.ok(routes.includes('POST /api/notifications/read-all'));
  assert.ok(routes.includes('DELETE /api/notifications/:id'));
  assert.ok(routes.includes('POST /api/personagens/:id/like'));
  assert.ok(routes.includes('GET /api/personagens/:id/likes'));
  assert.ok(routes.includes('POST /api/wiki-posts/:id/like'));
  assert.ok(routes.includes('GET /api/wiki-posts/:id/likes'));
  assert.ok(routes.includes('POST /api/wiki-posts/:id/turns/:turnId/like'));
  assert.ok(routes.includes('GET /api/wiki-posts/:id/turns/:turnId/likes'));
});
