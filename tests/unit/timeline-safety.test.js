'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { ApiError, sendError } = require('../../server/errors');
const {
  createTimelineRouter,
  ensureTimelineSchema,
  seedTimelineIfEmpty,
} = require('../../server/timeline');
// The audit label fallback is not part of the `server/timeline` bridge, so the
// helper is exercised from the generated module that the bridge already loads.
const { writeTimelineAudit } = require('../../.generated/node/timeline/index.js');

const EVENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACTOR_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ORIGINAL_UPDATED_AT = '2026-11-09T12:00:00.000Z';
const ACTOR_LOCK_QUERY = 'SELECT id, username, role, disabled_at, auth_version FROM users WHERE id = $1 FOR UPDATE';

function sameMilliseconds(actual, expected) {
  const actualMs = new Date(actual).getTime();
  const expectedMs = Date.parse(expected);
  return Number.isFinite(actualMs) && Number.isFinite(expectedMs) && actualMs === expectedMs;
}

function timelineRow(overrides = {}) {
  return {
    id: EVENT_ID,
    internal_id: 'EV1',
    title: 'Evento original',
    short_title: 'Original',
    summary: 'Resumo original',
    color: 'Green',
    era: 'Before Daare',
    start_date: 'Before Daare 10',
    end_date: '',
    order_index: 1,
    tags: '',
    story_arc: '',
    characters: '',
    character_group: '',
    location: '',
    created_at: new Date('2026-11-01T00:00:00.000Z'),
    updated_at: new Date(ORIGINAL_UPDATED_AT),
    ...overrides,
  };
}

function createTimelineDb(initialRows = []) {
  const rows = initialRows.map((row) => ({ ...row }));
  const audits = [];
  const queries = [];
  let transactionCount = 0;
  let transactionDepth = 0;
  let sequence = 0;

  async function db(strings, ...values) {
    const query = strings.join(' ');
    queries.push({ query, values, txDepth: transactionDepth });

    if (query.includes('INSERT INTO audit_events')) {
      if (db.failAudit) throw new Error('Falha de auditoria injetada pelo teste.');
      const [actorId, actorLabel, action, targetType, targetId, reason, before, after] = values;
      audits.push({
        actorId,
        actorLabel,
        action,
        targetType,
        targetId,
        reason,
        before: JSON.parse(before),
        after: JSON.parse(after),
      });
      return [];
    }

    if (query.includes('INSERT INTO timeline_events')) {
      const row = {
        id: `cccccccc-cccc-4ccc-8ccc-${String(++sequence).padStart(12, '0')}`,
        internal_id: values[0],
        title: values[1],
        short_title: values[2],
        summary: values[3],
        color: values[4],
        era: values[5],
        start_date: values[6],
        end_date: values[7],
        order_index: values[8],
        tags: values[9],
        story_arc: values[10],
        characters: values[11],
        character_group: values[12],
        location: values[13],
        created_at: new Date(),
        updated_at: new Date(),
      };
      rows.push(row);
      return [{ ...row }];
    }

    if (query.includes('UPDATE timeline_events')) {
      const rowId = values.find((value) => typeof value === 'string'
        && rows.some((row) => row.id === value));
      const index = rows.findIndex((row) => row.id === rowId);
      if (index === -1) return [];
      if (query.includes("date_trunc('milliseconds'") && query.includes('UPDATE timeline_events')) {
        const expected = values[values.length - 1];
        if (!sameMilliseconds(rows[index].updated_at, expected)) return [];
      }
      const updated = {
        ...rows[index],
        title: values[0],
        short_title: values[1],
        summary: values[2],
        color: values[3],
        era: values[4],
        start_date: values[5],
        end_date: values[6],
        order_index: values[7],
        tags: values[8],
        story_arc: values[9],
        characters: values[10],
        character_group: values[11],
        location: values[12],
        updated_at: new Date(new Date(rows[index].updated_at).getTime() + 1000),
      };
      rows[index] = updated;
      return [{ ...updated }];
    }

    if (query.includes('DELETE FROM timeline_events')) {
      const rowId = values.find((value) => typeof value === 'string'
        && rows.some((row) => row.id === value));
      const index = rows.findIndex((row) => row.id === rowId);
      if (index === -1) return [];
      if (query.includes("date_trunc('milliseconds'")) {
        const expected = values[values.length - 1];
        if (!sameMilliseconds(rows[index].updated_at, expected)) return [];
      }
      const [deleted] = rows.splice(index, 1);
      return [{ id: deleted.id, title: deleted.title }];
    }

    if (query.includes('FROM timeline_events WHERE id =')) {
      return rows.filter((row) => row.id === values[0]).map((row) => ({ ...row }));
    }

    if (query.includes('SELECT internal_id FROM timeline_events')) return [];
    if (query.includes('COALESCE(MAX(order_index)')) return [{ max_o: 0 }];
    if (query.includes('FROM timeline_events')) return rows.map((row) => ({ ...row }));

    return [];
  }

  db.begin = async (callback) => {
    transactionCount += 1;
    transactionDepth += 1;
    const rowsBefore = rows.map((row) => ({ ...row }));
    const auditCountBefore = audits.length;
    try {
      return await callback(db);
    } catch (error) {
      rows.splice(0, rows.length, ...rowsBefore);
      audits.splice(auditCountBefore);
      throw error;
    } finally {
      transactionDepth -= 1;
    }
  };
  db.json = (value) => JSON.stringify(value);
  db.rows = rows;
  db.audits = audits;
  db.queries = queries;
  db.transactionCount = () => transactionCount;
  db.transactionDepth = () => transactionDepth;
  db.failAudit = false;
  return db;
}

function createActor(overrides = {}) {
  return {
    id: ACTOR_ID,
    username: 'Staff',
    role: 'moderador',
    disabled_at: null,
    auth_version: 1,
    version: 1,
    ...overrides,
  };
}

/**
 * Test double for `server/auth.js`. `requireIdentity` stores the middleware
 * snapshot; `withActorTransaction` starts the injected transaction, reads the
 * mutable actor row again (as the real FOR UPDATE query would) and rejects a
 * revoked/disabled actor before invoking the route callback. `assertRole`
 * always checks the actor it receives, so a demotion committed after the
 * middleware snapshot is only visible to the in-transaction check.
 */
function createAuth(db, options = {}) {
  const state = {
    actor: createActor(options.actor),
    transactions: 0,
    actorReads: 0,
    beforeActorRead: null,
  };

  function unauthorized() {
    return new ApiError(401, 'UNAUTHENTICATED', 'Sua sessão expirou. Faça login novamente.');
  }

  function forbidden() {
    return new ApiError(403, 'FORBIDDEN', 'Você não tem permissão para esta ação.');
  }

  function assertRole(user, ...roles) {
    if (!user) throw unauthorized();
    if (!roles.length || !roles.includes(user.role)) throw forbidden();
    return user;
  }

  function requireIdentity(req, res, next) {
    if (options.authenticated === false) {
      req.session = null;
      return sendError(res, unauthorized());
    }
    const actor = state.actor;
    req.session = { userId: actor.id, authVersion: actor.auth_version };
    req.authUser = { ...actor };
    return next();
  }

  function requireRole(...roles) {
    return (req, res, next) => {
      if (!req.authUser) return sendError(res, unauthorized());
      try {
        assertRole(req.authUser, ...roles);
      } catch (error) {
        return sendError(res, error);
      }
      return next();
    };
  }

  async function withActorTransaction(req, callback) {
    const session = req.session && typeof req.session === 'object' ? req.session : null;
    if (!session || typeof session.userId !== 'string' || !Number.isInteger(session.authVersion)) {
      throw unauthorized();
    }

    state.transactions += 1;
    return db.begin(async (tx) => {
      const hook = state.beforeActorRead;
      state.beforeActorRead = null;
      if (hook) await hook();

      state.actorReads += 1;
      db.queries.push({
        query: ACTOR_LOCK_QUERY,
        values: [session.userId],
        txDepth: db.transactionDepth(),
      });

      const actor = state.actor;
      const active = actor.id === session.userId
        && actor.disabled_at === null
        && actor.auth_version === session.authVersion;
      if (!active) {
        req.session = null;
        throw unauthorized();
      }

      const freshActor = { ...actor };
      req.authUser = freshActor;
      return callback(tx, freshActor);
    });
  }

  return {
    state,
    assertRole,
    requireIdentity,
    requireRole,
    withActorTransaction,
    beforeNextActorRead(hook) {
      state.beforeActorRead = hook;
    },
  };
}

async function withTimelineApp(db, auth, callback) {
  const app = express();
  app.use(express.json());
  app.use('/api/timeline', createTimelineRouter({ sql: db, auth }));

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    return await callback(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const body = await response.json();
  return { response, body };
}

function queryIndex(db, predicate) {
  return db.queries.findIndex(predicate);
}

test('ensureTimelineSchema não executa seed automático e mantém o seed exportado', async () => {
  const statements = [];
  const sql = async (strings) => {
    statements.push(strings.join(' '));
    return [];
  };

  await ensureTimelineSchema(sql);

  assert.ok(statements.some((query) => query.includes('CREATE TABLE IF NOT EXISTS "timeline_events"')));
  assert.equal(
    statements.some((query) => query.includes('SELECT count(*)::int AS total')),
    false,
    'ensureTimelineSchema não deve consultar a contagem para popular a timeline'
  );
  assert.equal(
    statements.some((query) => query.includes('INSERT INTO timeline_events')),
    false,
    'ensureTimelineSchema não deve inserir eventos de seed'
  );
  assert.equal(typeof seedTimelineIfEmpty, 'function');
});

test('writeTimelineAudit mantém o rótulo neutro quando a sessão não tem userId', async () => {
  const db = createTimelineDb();

  await writeTimelineAudit(db, { session: {} }, {
    action: 'timeline.create',
    targetId: EVENT_ID,
    reason: 'Teste do rótulo neutro.',
    before: {},
    after: {},
  });

  assert.equal(db.audits.length, 1);
  assert.equal(db.audits[0].actorId, null);
  assert.equal(db.audits[0].actorLabel, 'timeline');
});

test('POST da timeline grava auditoria na mesma transação de ator', async () => {
  const db = createTimelineDb();
  const auth = createAuth(db);

  await withTimelineApp(db, auth, async (baseUrl) => {
    const { response, body } = await requestJson(`${baseUrl}/api/timeline`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        internalId: 'EV9',
        orderIndex: 9,
        title: 'Evento novo',
        startDate: 'Depois de Daare 1',
        summary: 'Criado pelo teste.',
      }),
    });

    assert.equal(response.status, 201);
    assert.equal(body.event.title, 'Evento novo');
    assert.equal(db.transactionCount(), 1);
    assert.equal(auth.state.transactions, 1);
    assert.equal(auth.state.actorReads, 1);
    assert.equal(db.audits.length, 1);

    const audit = db.audits[0];
    assert.equal(audit.actorId, ACTOR_ID);
    assert.equal(audit.actorLabel, null);
    assert.equal(audit.action, 'timeline.create');
    assert.equal(audit.targetType, 'timeline_event');
    assert.equal(audit.targetId, body.event.id);
    assert.deepEqual(audit.before, {});
    assert.equal(audit.after.title, 'Evento novo');
    assert.equal(audit.after.internal_id, 'EV9');

    const actorLockIndex = queryIndex(db, (item) => item.query === ACTOR_LOCK_QUERY);
    const insertIndex = queryIndex(db, (item) => item.query.includes('INSERT INTO timeline_events'));
    const auditIndex = queryIndex(db, (item) => item.query.includes('INSERT INTO audit_events'));
    assert.ok(actorLockIndex >= 0 && insertIndex > actorLockIndex && auditIndex > insertIndex);
    assert.equal(db.queries[actorLockIndex].txDepth, 1);
    assert.equal(db.queries[insertIndex].txDepth, 1);
    assert.equal(db.queries[auditIndex].txDepth, 1);
  });
});

test('POST sem sessão autenticada é recusado antes de qualquer transação ou auditoria', async () => {
  const db = createTimelineDb();
  const auth = createAuth(db, { authenticated: false });

  await withTimelineApp(db, auth, async (baseUrl) => {
    const { response, body } = await requestJson(`${baseUrl}/api/timeline`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        internalId: 'EV10',
        orderIndex: 10,
        title: 'Sem sessão',
        startDate: 'Indefinido',
      }),
    });

    assert.equal(response.status, 401);
    assert.equal(body.code, 'UNAUTHENTICATED');
    assert.equal(db.transactionCount(), 0);
    assert.equal(auth.state.transactions, 0);
    assert.equal(db.rows.length, 0);
    assert.equal(db.audits.length, 0);
  });
});

test('POST recusa moderador rebaixado dentro da transação antes de inserir ou auditar', async () => {
  const db = createTimelineDb();
  const auth = createAuth(db);
  auth.beforeNextActorRead(() => {
    auth.state.actor.role = 'membro';
  });

  await withTimelineApp(db, auth, async (baseUrl) => {
    const { response, body } = await requestJson(`${baseUrl}/api/timeline`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        internalId: 'EV11',
        orderIndex: 11,
        title: 'Não deve criar',
        startDate: 'Indefinido',
      }),
    });

    assert.equal(response.status, 403);
    assert.equal(body.code, 'FORBIDDEN');
    assert.equal(db.transactionCount(), 1);
    assert.equal(auth.state.transactions, 1);
    assert.equal(auth.state.actorReads, 1);
    assert.equal(db.rows.length, 0);
    assert.equal(db.audits.length, 0);
    assert.equal(queryIndex(db, (item) => item.query.includes('INSERT INTO timeline_events')), -1);
    assert.equal(queryIndex(db, (item) => item.query.includes('INSERT INTO audit_events')), -1);
    assert.equal(db.queries[0].query, ACTOR_LOCK_QUERY);
    assert.equal(db.queries[0].txDepth, 1);
  });
});

test('PUT com expectedUpdatedAt correspondente aceita e audita antes/depois', async () => {
  const db = createTimelineDb([timelineRow()]);
  const auth = createAuth(db);

  await withTimelineApp(db, auth, async (baseUrl) => {
    const { response, body } = await requestJson(`${baseUrl}/api/timeline/${EVENT_ID}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Evento editado',
        expectedUpdatedAt: ORIGINAL_UPDATED_AT,
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(body.event.title, 'Evento editado');
    assert.equal(db.transactionCount(), 1);
    assert.equal(auth.state.transactions, 1);
    assert.equal(auth.state.actorReads, 1);
    assert.equal(db.audits.length, 1);

    const actorLockIndex = queryIndex(db, (item) => item.query === ACTOR_LOCK_QUERY);
    const eventLockIndex = queryIndex(db, (item) => item.query.includes('FROM timeline_events WHERE id =')
      && item.query.includes('FOR UPDATE'));
    const updateIndex = queryIndex(db, (item) => item.query.includes('UPDATE timeline_events'));
    const auditIndex = queryIndex(db, (item) => item.query.includes('INSERT INTO audit_events'));
    assert.ok(actorLockIndex >= 0 && eventLockIndex > actorLockIndex);
    assert.ok(updateIndex > eventLockIndex && auditIndex > updateIndex);
    for (const index of [actorLockIndex, eventLockIndex, updateIndex, auditIndex]) {
      assert.equal(db.queries[index].txDepth, 1, 'toda a escrita deve ocorrer na transação de ator');
    }

    const audit = db.audits[0];
    assert.equal(audit.action, 'timeline.update');
    assert.equal(audit.targetType, 'timeline_event');
    assert.equal(audit.targetId, EVENT_ID);
    assert.equal(audit.before.title, 'Evento original');
    assert.equal(audit.after.title, 'Evento editado');
  });
});

test('PUT recusa ator revogado dentro da transação e não altera o evento', async () => {
  const db = createTimelineDb([timelineRow()]);
  const auth = createAuth(db);
  auth.beforeNextActorRead(() => {
    auth.state.actor.disabled_at = new Date('2026-11-10T12:00:00.000Z');
    auth.state.actor.auth_version += 1;
  });

  await withTimelineApp(db, auth, async (baseUrl) => {
    const { response, body } = await requestJson(`${baseUrl}/api/timeline/${EVENT_ID}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Não deve salvar',
        expectedUpdatedAt: ORIGINAL_UPDATED_AT,
      }),
    });

    assert.equal(response.status, 401);
    assert.equal(body.code, 'UNAUTHENTICATED');
    assert.equal(db.transactionCount(), 1);
    assert.equal(auth.state.transactions, 1);
    assert.equal(auth.state.actorReads, 1);
    assert.equal(db.rows.length, 1);
    assert.equal(db.rows[0].title, 'Evento original');
    assert.equal(db.audits.length, 0);
    assert.equal(queryIndex(db, (item) => item.query.includes('FOR UPDATE')
      && item.query.includes('FROM timeline_events WHERE id =')), -1);
    assert.equal(queryIndex(db, (item) => item.query.includes('UPDATE timeline_events')), -1);
  });
});

test('PUT com expectedUpdatedAt obsoleto retorna conflito e não grava auditoria', async () => {
  const db = createTimelineDb([timelineRow()]);
  const auth = createAuth(db);

  await withTimelineApp(db, auth, async (baseUrl) => {
    const { response, body } = await requestJson(`${baseUrl}/api/timeline/${EVENT_ID}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Não deve salvar',
        expectedUpdatedAt: '2026-11-09T11:59:59.000Z',
      }),
    });

    assert.equal(response.status, 409);
    assert.equal(body.code, 'STALE_UPDATE');
    assert.equal(db.rows[0].title, 'Evento original');
    assert.equal(db.audits.length, 0);
  });
});

test('PUT sem expectedUpdatedAt preserva o comportamento anterior', async () => {
  const db = createTimelineDb([timelineRow()]);
  const auth = createAuth(db);

  await withTimelineApp(db, auth, async (baseUrl) => {
    const { response } = await requestJson(`${baseUrl}/api/timeline/${EVENT_ID}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Sem precondição' }),
    });

    assert.equal(response.status, 200);
    assert.equal(db.rows[0].title, 'Sem precondição');
    assert.equal(db.audits.length, 1);
    assert.equal(db.audits[0].action, 'timeline.update');
  });
});

test('PUT com expectedUpdatedAt inválido retorna 400 antes de tocar o evento', async () => {
  const db = createTimelineDb([timelineRow()]);
  const auth = createAuth(db);

  await withTimelineApp(db, auth, async (baseUrl) => {
    const { response, body } = await requestJson(`${baseUrl}/api/timeline/${EVENT_ID}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Não deve salvar',
        expectedUpdatedAt: 'ontem à tarde',
      }),
    });

    assert.equal(response.status, 400);
    assert.equal(body.code, 'INVALID_TIMESTAMP');
    assert.equal(db.rows[0].title, 'Evento original');
    assert.equal(db.audits.length, 0);
    assert.equal(db.transactionCount(), 0);
  });
});

test('PUT de evento inexistente retorna 404 sem auditoria', async () => {
  const db = createTimelineDb();
  const auth = createAuth(db);

  await withTimelineApp(db, auth, async (baseUrl) => {
    const { response, body } = await requestJson(`${baseUrl}/api/timeline/${EVENT_ID}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Fantasma' }),
    });

    assert.equal(response.status, 404);
    assert.equal(body.code, 'NOT_FOUND');
    assert.equal(db.transactionCount(), 1);
    assert.equal(auth.state.actorReads, 1);
    assert.equal(db.audits.length, 0);
  });
});

test('DELETE com expectedUpdatedAt correspondente exclui e audita a linha completa', async () => {
  const db = createTimelineDb([timelineRow()]);
  const auth = createAuth(db);

  await withTimelineApp(db, auth, async (baseUrl) => {
    const { response, body } = await requestJson(`${baseUrl}/api/timeline/${EVENT_ID}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedUpdatedAt: ORIGINAL_UPDATED_AT }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(body, { success: true, deletedId: EVENT_ID });
    assert.equal(db.rows.length, 0);
    assert.equal(db.transactionCount(), 1);
    assert.equal(auth.state.transactions, 1);
    assert.equal(auth.state.actorReads, 1);
    assert.equal(db.audits.length, 1);

    const audit = db.audits[0];
    assert.equal(audit.action, 'timeline.delete');
    assert.equal(audit.targetId, EVENT_ID);
    assert.equal(audit.before.internal_id, 'EV1');
    assert.equal(audit.before.title, 'Evento original');
    assert.equal(audit.before.summary, 'Resumo original');
    assert.deepEqual(audit.after, {});

    const actorLockIndex = queryIndex(db, (item) => item.query === ACTOR_LOCK_QUERY);
    const eventLockIndex = queryIndex(db, (item) => item.query.includes('FROM timeline_events WHERE id =')
      && item.query.includes('FOR UPDATE'));
    const auditIndex = queryIndex(db, (item) => item.query.includes('INSERT INTO audit_events'));
    const deleteIndex = queryIndex(db, (item) => item.query.includes('DELETE FROM timeline_events'));
    assert.ok(actorLockIndex >= 0 && eventLockIndex > actorLockIndex);
    assert.ok(auditIndex > eventLockIndex && deleteIndex > auditIndex, 'a auditoria deve ser gravada antes do DELETE');
    for (const index of [actorLockIndex, eventLockIndex, auditIndex, deleteIndex]) {
      assert.equal(db.queries[index].txDepth, 1, 'toda a escrita deve ocorrer na transação de ator');
    }
  });
});

test('DELETE recusa moderador rebaixado dentro da transação e mantém o evento', async () => {
  const db = createTimelineDb([timelineRow()]);
  const auth = createAuth(db);
  auth.beforeNextActorRead(() => {
    auth.state.actor.role = 'membro';
  });

  await withTimelineApp(db, auth, async (baseUrl) => {
    const { response, body } = await requestJson(`${baseUrl}/api/timeline/${EVENT_ID}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedUpdatedAt: ORIGINAL_UPDATED_AT }),
    });

    assert.equal(response.status, 403);
    assert.equal(body.code, 'FORBIDDEN');
    assert.equal(db.transactionCount(), 1);
    assert.equal(auth.state.transactions, 1);
    assert.equal(auth.state.actorReads, 1);
    assert.equal(db.rows.length, 1);
    assert.equal(db.rows[0].title, 'Evento original');
    assert.equal(db.audits.length, 0);
    assert.equal(queryIndex(db, (item) => item.query.includes('DELETE FROM timeline_events')), -1);
    assert.equal(queryIndex(db, (item) => item.query.includes('INSERT INTO audit_events')), -1);
  });
});

test('DELETE com expectedUpdatedAt obsoleto retorna conflito e mantém a linha', async () => {
  const db = createTimelineDb([timelineRow()]);
  const auth = createAuth(db);

  await withTimelineApp(db, auth, async (baseUrl) => {
    const { response, body } = await requestJson(`${baseUrl}/api/timeline/${EVENT_ID}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedUpdatedAt: '2026-11-09T11:59:59.000Z' }),
    });

    assert.equal(response.status, 409);
    assert.equal(body.code, 'STALE_UPDATE');
    assert.equal(db.rows.length, 1);
    assert.equal(db.audits.length, 0);
  });
});

test('DELETE sem expectedUpdatedAt preserva a exclusão direta e registra a linha removida', async () => {
  const db = createTimelineDb([timelineRow()]);
  const auth = createAuth(db);

  await withTimelineApp(db, auth, async (baseUrl) => {
    const { response } = await requestJson(`${baseUrl}/api/timeline/${EVENT_ID}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    assert.equal(response.status, 200);
    assert.equal(db.rows.length, 0);
    assert.equal(db.audits.length, 1);
    assert.equal(db.audits[0].action, 'timeline.delete');
    assert.equal(db.audits[0].before.title, 'Evento original');
  });
});

test('DELETE de evento inexistente retorna 404 sem auditoria', async () => {
  const db = createTimelineDb();
  const auth = createAuth(db);

  await withTimelineApp(db, auth, async (baseUrl) => {
    const { response, body } = await requestJson(`${baseUrl}/api/timeline/${EVENT_ID}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    assert.equal(response.status, 404);
    assert.equal(body.code, 'NOT_FOUND');
    assert.equal(db.transactionCount(), 1);
    assert.equal(auth.state.actorReads, 1);
    assert.equal(db.audits.length, 0);
  });
});

test('POST, PUT e DELETE usam a mesma transação que revalida o ator', async () => {
  const db = createTimelineDb([timelineRow()]);
  const auth = createAuth(db);

  await withTimelineApp(db, auth, async (baseUrl) => {
    const created = await requestJson(`${baseUrl}/api/timeline`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        internalId: 'EV12',
        orderIndex: 12,
        title: 'Evento adicional',
        startDate: 'Depois de Daare 12',
      }),
    });
    assert.equal(created.response.status, 201);
    assert.equal(auth.state.transactions, 1);
    assert.equal(auth.state.actorReads, 1);
    assert.equal(db.transactionCount(), 1);

    const edited = await requestJson(`${baseUrl}/api/timeline/${EVENT_ID}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Evento editado na sequência' }),
    });
    assert.equal(edited.response.status, 200);
    assert.equal(auth.state.transactions, 2);
    assert.equal(auth.state.actorReads, 2);
    assert.equal(db.transactionCount(), 2);

    const removed = await requestJson(`${baseUrl}/api/timeline/${EVENT_ID}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(removed.response.status, 200);
    assert.equal(auth.state.transactions, 3);
    assert.equal(auth.state.actorReads, 3);
    assert.equal(db.transactionCount(), 3);
  });

  const actorLocks = db.queries.filter((item) => item.query === ACTOR_LOCK_QUERY);
  assert.equal(actorLocks.length, 3);
  assert.ok(actorLocks.every((item) => item.txDepth === 1));

  const writes = db.queries.filter((item) => /INSERT INTO timeline_events|UPDATE timeline_events|DELETE FROM timeline_events/.test(item.query));
  assert.equal(writes.length, 3);
  assert.ok(writes.every((item) => item.txDepth === 1));
});

test('falha de auditoria reverte a mutação de PUT e DELETE na transação de ator', async () => {
  for (const method of ['PUT', 'DELETE']) {
    const db = createTimelineDb([timelineRow()]);
    const auth = createAuth(db);
    db.failAudit = true;

    await withTimelineApp(db, auth, async (baseUrl) => {
      const { response, body } = await requestJson(`${baseUrl}/api/timeline/${EVENT_ID}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Não deve persistir' }),
      });

      assert.equal(response.status, 500);
      assert.equal(body.code, 'INTERNAL_ERROR');
      assert.equal(db.rows.length, 1);
      assert.equal(db.rows[0].title, 'Evento original');
      assert.equal(db.audits.length, 0);
      assert.equal(db.transactionCount(), 1);
      assert.equal(auth.state.actorReads, 1);
    });
  }
});
