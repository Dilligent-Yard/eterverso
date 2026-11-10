'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseArguments,
  readSeedItems,
  assertTimelineEmpty,
  resolveConnection,
} = require('../../scripts/seed-timeline');

test('SEED-01 requires explicit confirmation and a known target', () => {
  assert.deepEqual(parseArguments(['--confirm-empty', '--target=development']), {
    confirmEmpty: true,
    target: 'development',
  });
  assert.deepEqual(parseArguments(['--confirm-empty']), { confirmEmpty: true, target: undefined });

  assert.throws(() => parseArguments([]), /--confirm-empty/);
  assert.throws(() => parseArguments(['--target=development']), /--confirm-empty/);
  assert.throws(() => parseArguments(['--confirm-empty', '--target=production']), /--target=development/);
  assert.throws(() => parseArguments(['--confirm-empty', '--confirm-empty']), /only once/);
  assert.throws(() => parseArguments(['--confirm-empty', '--target=test', '--target=sandbox']), /only once/);
  assert.throws(() => parseArguments(['--confirm-empty', '--unknown']), /Unknown timeline seed argument/);
});

test('SEED-02 refuses a timeline that already has rows', () => {
  assert.doesNotThrow(() => assertTimelineEmpty(0));
  assert.throws(() => assertTimelineEmpty(1), /already contains 1 event/);
  assert.throws(() => assertTimelineEmpty(-1), /Invalid timeline row count/);
  assert.throws(() => assertTimelineEmpty(1.5), /Invalid timeline row count/);
});

test('SEED-03 requires exactly one explicit connection source', async () => {
  await assert.rejects(
    resolveConnection({ confirmEmpty: true }, {}),
    /DATABASE_URL or --target/,
  );
  await assert.rejects(
    resolveConnection(
      { confirmEmpty: true, target: 'development' },
      { DATABASE_URL: 'postgres://user:secret@127.0.0.1:5432/example' },
    ),
    /not both/,
  );

  const connection = await resolveConnection(
    { confirmEmpty: true },
    { DATABASE_URL: 'postgres://user:secret@127.0.0.1:5432/example' },
  );
  assert.equal(connection.database, 'example');
  assert.equal(connection.label, 'DATABASE_URL');
  assert.equal(connection.guard, null);

  await assert.rejects(
    resolveConnection({ confirmEmpty: true }, { DATABASE_URL: 'mysql://127.0.0.1/example' }),
    /postgres or postgresql/,
  );
});

test('SEED-04 committed seed is a non-empty array with unique internal ids', () => {
  const items = readSeedItems();
  assert.ok(items.length > 0);
  assert.equal(new Set(items.map((item) => item.internalId)).size, items.length);
  for (const item of items) {
    assert.equal(typeof item.internalId, 'string');
    assert.equal(typeof item.title, 'string');
    assert.equal(typeof item.startDate, 'string');
  }
});
