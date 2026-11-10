'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createNotification } = require('../../server/interactions');

const RECIPIENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACTOR_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const REFERENCE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function notificationParams(overrides = {}) {
  return {
    recipientId: RECIPIENT_ID,
    actorId: ACTOR_ID,
    type: 'like_turn',
    referenceId: REFERENCE_ID,
    referenceType: 'wiki_post',
    title: 'Alguém curtiu seu turno',
    message: 'Um turno recebeu uma curtida.',
    ...overrides,
  };
}

async function withSilencedWarning(callback) {
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    return await callback();
  } finally {
    console.warn = originalWarn;
  }
}

test('falha na notificação usa savepoint e não propaga para o chamador', async () => {
  let savepointCalls = 0;
  let insertAttempted = false;

  const executor = async (strings) => {
    const query = strings.join(' ');
    if (query.includes('pg_advisory_xact_lock')) return [];
    if (query.includes('SELECT id FROM notifications')) return [];
    if (query.includes('INSERT INTO notifications')) {
      insertAttempted = true;
      throw new Error('falha simulada na notificação');
    }
    return [];
  };
  executor.savepoint = async (callback) => {
    savepointCalls += 1;
    return callback(executor);
  };

  const result = await withSilencedWarning(() => createNotification(executor, notificationParams()));

  assert.equal(result, null);
  assert.equal(savepointCalls, 1, 'o trabalho deve ser isolado por savepoint');
  assert.equal(insertAttempted, true);
});

test('executor sem savepoint degrada sem propagar a falha', async () => {
  let insertAttempted = false;
  const executor = async (strings) => {
    const query = strings.join(' ');
    if (query.includes('pg_advisory_xact_lock')) return [];
    if (query.includes('SELECT id FROM notifications')) return [];
    if (query.includes('INSERT INTO notifications')) {
      insertAttempted = true;
      throw new Error('falha simulada sem savepoint');
    }
    return [];
  };

  const result = await withSilencedWarning(() => createNotification(executor, notificationParams()));

  assert.equal(result, null);
  assert.equal(insertAttempted, true);
});

test('duas criações logicamente concorrentes não duplicam a notificação', async () => {
  const rows = [];
  const locks = new Map();
  let sequence = 0;
  let lockQueries = 0;

  function acquireLock(key) {
    const previous = locks.get(key) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    locks.set(key, previous.then(() => current));
    return previous.then(() => release);
  }

  function createTransaction() {
    const state = { release: null };
    const tx = async (strings, ...values) => {
      const query = strings.join(' ');

      if (query.includes('pg_advisory_xact_lock')) {
        lockQueries += 1;
        state.release = await acquireLock(values[0]);
        return [{ locked: true }];
      }

      if (query.includes('SELECT id FROM notifications')) {
        const [recipient, actor, type, referenceId] = values;
        const existing = rows.find((row) => row.user_id === recipient
          && row.actor_id === actor
          && row.type === type
          && row.reference_id === referenceId
          && row.read === false);
        return existing ? [{ id: existing.id }] : [];
      }

      if (query.includes('UPDATE notifications')) {
        const [title, message, id] = values;
        const row = rows.find((item) => item.id === id);
        if (!row) return [];
        row.title = title;
        row.message = message;
        row.created_at = new Date();
        return [{ ...row }];
      }

      if (query.includes('INSERT INTO notifications')) {
        const [userId, actorId, type, referenceId, referenceType, title, message] = values;
        const row = {
          id: `notification-${++sequence}`,
          user_id: userId,
          actor_id: actorId,
          type,
          reference_id: referenceId,
          reference_type: referenceType,
          title,
          message,
          read: false,
          created_at: new Date(),
        };
        rows.push(row);
        return [{ ...row }];
      }

      return [];
    };

    tx.savepoint = async (callback) => {
      try {
        return await callback(tx);
      } finally {
        if (state.release) {
          state.release();
          state.release = null;
        }
      }
    };
    return tx;
  }

  const firstTransaction = createTransaction();
  const secondTransaction = createTransaction();
  const results = await withSilencedWarning(() => Promise.all([
    createNotification(firstTransaction, notificationParams()),
    createNotification(secondTransaction, notificationParams()),
  ]));

  assert.equal(lockQueries, 2, 'cada criação deve adquirir o lock consultivo');
  assert.equal(rows.length, 1, 'o dedup concorrente deve manter uma única linha');
  assert.equal(results[0].id, results[1].id);
});

test('auto-notificação continua suprimida sem executar SQL', async () => {
  let executed = false;
  const executor = async () => {
    executed = true;
    return [];
  };

  const result = await createNotification(executor, notificationParams({
    recipientId: ACTOR_ID,
    actorId: ACTOR_ID,
  }));

  assert.equal(result, null);
  assert.equal(executed, false);
});

test('a chave do advisory lock não contém byte NUL', async () => {
  let lockArgument = null;
  const executor = async (strings, ...args) => {
    const query = strings.join(' ');
    if (query.includes('pg_advisory_xact_lock')) {
      lockArgument = args[0];
      return [];
    }
    if (query.includes('SELECT id FROM notifications')) return [];
    if (query.includes('INSERT INTO notifications')) {
      return [{
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        type: 'like_turn',
        reference_id: REFERENCE_ID,
        reference_type: 'wiki_post',
        title: 'Alguém curtiu seu turno',
        message: 'Um turno recebeu uma curtida.',
        read: false,
        created_at: new Date('2026-01-01T00:00:00Z'),
        actor_id: ACTOR_ID,
      }];
    }
    return [];
  };

  const result = await createNotification(executor, notificationParams());

  assert.equal(typeof lockArgument, 'string');
  assert.equal(lockArgument.includes('\u0000'), false, 'PostgreSQL rejects NUL in text parameters');
  assert.ok(result && result.id, 'a notificação deve ser criada quando o lock é válido');
});
