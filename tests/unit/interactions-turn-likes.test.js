'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { createInteractionsRouter } = require('../../server/interactions');

const SCENE_A = '11111111-1111-4111-8111-111111111111';
const SCENE_B = '22222222-2222-4222-8222-222222222222';
const TURN_UUID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';
const AUTHOR_ID = '55555555-5555-4555-8555-555555555555';

function createTurnDb({ scenes, sceneTurns = [] }) {
  const sceneRows = scenes.map((scene) => ({ ...scene }));
  const turnRows = sceneTurns.map((turn) => ({ ...turn }));
  const likes = [];
  const queries = [];
  let likeSequence = 0;

  async function db(strings, ...values) {
    const query = strings.join(' ');
    queries.push({ query, values });

    if (query.includes('FROM scene_turns')) {
      const sceneId = values[0];
      if (query.includes('(id =')) {
        const byId = values[1];
        const byLegacy = values[2];
        return turnRows.filter((turn) => turn.scene_id === sceneId
          && !turn.deleted_at
          && (turn.id === byId || turn.legacy_id === byLegacy));
      }
      const legacyId = values[1];
      return turnRows.filter((turn) => turn.scene_id === sceneId
        && !turn.deleted_at
        && turn.legacy_id === legacyId);
    }

    if (query.includes('FROM wiki_posts')) {
      const scene = sceneRows.find((item) => item.id === values[0]);
      return scene ? [scene] : [];
    }

    if (query.includes('SELECT id FROM likes')) {
      const userId = values[0];
      const key = values[1];
      return likes.filter((like) => like.user_id === userId
        && like.target_type === 'turn'
        && like.target_id === key);
    }

    if (query.includes('COUNT(*)') && query.includes('FROM likes')) {
      const key = values[0];
      return [{
        cnt: likes.filter((like) => like.target_type === 'turn' && like.target_id === key).length,
      }];
    }

    if (query.includes('INSERT INTO likes')) {
      const [userId, key] = values;
      if (!likes.some((like) => like.user_id === userId
        && like.target_type === 'turn'
        && like.target_id === key)) {
        likes.push({
          id: `like-${++likeSequence}`,
          user_id: userId,
          target_type: 'turn',
          target_id: key,
        });
      }
      return [];
    }

    if (query.includes('DELETE FROM likes')) {
      const index = likes.findIndex((like) => like.id === values[0]);
      if (index >= 0) likes.splice(index, 1);
      return [];
    }

    return [];
  }

  db.likes = likes;
  db.queries = queries;
  db.scenes = sceneRows;
  db.sceneTurns = turnRows;
  return db;
}

function createAuth(sql, user) {
  return {
    requireIdentity(req, _res, next) {
      req.session = { userId: user.id };
      req.authUser = user;
      next();
    },
    withActorTransaction(req, callback) {
      req.session = req.session || { userId: user.id };
      req.authUser = user;
      return callback(sql, user);
    },
  };
}

async function withApp(router, session, callback) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (session) req.session = session;
    next();
  });
  app.use(router);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    return await callback(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('UUID canônico e legacy_id do mesmo scene_turn compartilham a mesma chave de curtida', async () => {
  const db = createTurnDb({
    scenes: [{ id: SCENE_A, author_id: AUTHOR_ID, titulo: 'Cena A', turns: [] }],
    sceneTurns: [{
      id: TURN_UUID,
      scene_id: SCENE_A,
      legacy_id: 'legacy-1',
      author_id: AUTHOR_ID,
      deleted_at: null,
    }],
  });
  const user = { id: USER_ID, username: 'Leitor' };
  const router = createInteractionsRouter({ sql: db, auth: createAuth(db, user) });

  await withApp(router, { userId: USER_ID }, async (baseUrl) => {
    const legacyLike = await fetch(`${baseUrl}/api/wiki-posts/${SCENE_A}/turns/legacy-1/like`, {
      method: 'POST',
    });
    assert.equal(legacyLike.status, 200);
    assert.deepEqual(await legacyLike.json(), { liked: true, likeCount: 1 });
    assert.equal(db.likes.length, 1);
    assert.equal(db.likes[0].target_id, TURN_UUID, 'a curtida deve ser gravada no UUID canônico');

    for (const alias of ['legacy-1', TURN_UUID]) {
      const countResponse = await fetch(
        `${baseUrl}/api/wiki-posts/${SCENE_A}/turns/${alias}/likes`
      );
      assert.equal(countResponse.status, 200);
      assert.deepEqual(await countResponse.json(), { likeCount: 1, userLiked: true });
    }

    const canonicalUnlike = await fetch(
      `${baseUrl}/api/wiki-posts/${SCENE_A}/turns/${TURN_UUID}/like`,
      { method: 'POST' }
    );
    assert.equal(canonicalUnlike.status, 200);
    assert.deepEqual(await canonicalUnlike.json(), { liked: false, likeCount: 0 });
    assert.equal(db.likes.length, 0);
  });
});

test('o mesmo id legado em cenas diferentes resolve para chaves diferentes', async () => {
  const db = createTurnDb({
    scenes: [
      {
        id: SCENE_A,
        author_id: AUTHOR_ID,
        titulo: 'Cena A',
        turns: [{ id: 'json-9', authorId: null }],
      },
      {
        id: SCENE_B,
        author_id: AUTHOR_ID,
        titulo: 'Cena B',
        turns: [{ id: 'json-9', authorId: null }],
      },
    ],
  });
  const user = { id: USER_ID, username: 'Leitor' };
  const router = createInteractionsRouter({ sql: db, auth: createAuth(db, user) });

  await withApp(router, { userId: USER_ID }, async (baseUrl) => {
    for (const sceneId of [SCENE_A, SCENE_B]) {
      const response = await fetch(`${baseUrl}/api/wiki-posts/${sceneId}/turns/json-9/like`, {
        method: 'POST',
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { liked: true, likeCount: 1 });
    }

    assert.equal(db.likes.length, 2);
    assert.equal(db.likes[0].target_id, `${SCENE_A}:json-9`);
    assert.equal(db.likes[1].target_id, `${SCENE_B}:json-9`);
    assert.notEqual(db.likes[0].target_id, db.likes[1].target_id);

    for (const sceneId of [SCENE_A, SCENE_B]) {
      const countResponse = await fetch(
        `${baseUrl}/api/wiki-posts/${sceneId}/turns/json-9/likes`
      );
      assert.deepEqual(await countResponse.json(), { likeCount: 1, userLiked: true });
    }
  });
});

test('GET de turno JSON inexistente não inventa curtidas e usa chave limitada à cena', async () => {
  const db = createTurnDb({
    scenes: [{ id: SCENE_A, author_id: AUTHOR_ID, titulo: 'Cena A', turns: [] }],
  });
  const router = createInteractionsRouter({
    sql: db,
    auth: createAuth(db, { id: USER_ID, username: 'Leitor' }),
  });

  await withApp(router, { userId: USER_ID }, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/wiki-posts/${SCENE_A}/turns/ausente/likes`
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { likeCount: 0, userLiked: false });
  });
});
