'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  compareSentinel,
  sentinelFingerprint,
  validateSentinelSnapshot,
} = require('../../.generated/node/devtools/verification/index.js');

const expected = {
  database: 'eterverso_test_sentinel',
  user: 'eterverso_test',
  table: 'verification_sentinel',
  marker: '0123456789abcdef0123456789abcdef',
};

function snapshot(marker = expected.marker) {
  return {
    database: expected.database,
    user: expected.user,
    table: expected.table,
    marker: expected.marker,
    rows: [{ id: 1, marker }],
  };
}

test('sentinel snapshots are validated against the recorded marker', () => {
  assert.deepEqual(validateSentinelSnapshot(snapshot(), expected), snapshot());
  assert.throws(() => validateSentinelSnapshot({ ...snapshot(), database: 'eterverso_test' }, expected), /unexpected database/u);
  assert.throws(() => validateSentinelSnapshot({ ...snapshot(), user: 'postgres' }, expected), /unexpected database user/u);
  assert.throws(() => validateSentinelSnapshot({ ...snapshot(), table: 'other' }, expected), /table marker/u);
  assert.throws(() => validateSentinelSnapshot({ ...snapshot(), marker: 'other' }, expected), /recorded run state/u);
  assert.throws(() => validateSentinelSnapshot({ ...snapshot(), rows: [] }, expected), /exactly one/u);
  assert.throws(() => validateSentinelSnapshot({ ...snapshot('tampered') }, expected), /missing or was altered/u);
});

test('sentinel fingerprints detect mutation and restoration', () => {
  const before = snapshot();
  const after = snapshot();
  assert.equal(sentinelFingerprint(before), sentinelFingerprint(after));
  assert.deepEqual(compareSentinel(before, after), {
    unchanged: true,
    beforeDigest: sentinelFingerprint(before),
    afterDigest: sentinelFingerprint(after),
  });
  const mutated = compareSentinel(before, snapshot('tampered'));
  assert.equal(mutated.unchanged, false);
  assert.notEqual(mutated.beforeDigest, mutated.afterDigest);
  const restored = compareSentinel(before, snapshot());
  assert.equal(restored.unchanged, true);
});
