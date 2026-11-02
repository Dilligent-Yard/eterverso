'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_POSTGRES_INTEGER,
  STRING_LIMITS,
  ValidationError,
  assertObjectShape,
  expectedVersion,
  normalizeString,
  paginationParams,
  validatePositiveVersion,
  validateUuid,
} = require('../../server/validation');

test('strict object validation accepts declared properties and rejects missing or unknown properties', () => {
  const payload = { title: 'Título', tag: 'lore' };
  assert.equal(assertObjectShape(payload, {
    allowedKeys: ['title', 'tag'],
    requiredKeys: ['title'],
  }), payload);

  assert.throws(
    () => assertObjectShape({ title: 'Título', authorId: 'forged' }, {
      allowedKeys: ['title'],
      requiredKeys: ['title'],
    }),
    (error) => error instanceof ValidationError
      && error.status === 400
      && error.code === 'INVALID_SHAPE'
      && error.details.unknownKeys.includes('authorId')
  );
  assert.throws(
    () => assertObjectShape({}, { allowedKeys: ['expectedVersion'], requiredKeys: ['expectedVersion'] }),
    (error) => error.details.missingKeys.includes('expectedVersion')
  );
  assert.throws(() => assertObjectShape([], { allowedKeys: [] }), /formato da solicitação/i);
});

test('UUID and expected versions reject coercion, fractions, zero and PostgreSQL overflow', () => {
  const uuid = 'A0B1C2D3-E4F5-4678-9ABC-0123456789AB';
  assert.equal(validateUuid(uuid), uuid.toLowerCase());
  for (const invalid of [null, 7, 'not-a-uuid', 'a0b1c2d3-e4f5-4678-9abc-0123456789a']) {
    assert.throws(() => validateUuid(invalid), (error) => error.code === 'INVALID_UUID');
  }

  assert.equal(validatePositiveVersion(1), 1);
  assert.equal(expectedVersion(MAX_POSTGRES_INTEGER), MAX_POSTGRES_INTEGER);
  for (const invalid of ['3', 1.5, 0, -1, MAX_POSTGRES_INTEGER + 1, NaN]) {
    assert.throws(() => expectedVersion(invalid), (error) => error.status === 400 && error.code === 'INVALID_VERSION');
  }
  assert.throws(() => expectedVersion(undefined), (error) => error.status === 428 && error.code === 'PRECONDITION_REQUIRED');
  assert.throws(() => expectedVersion(null), (error) => error.status === 400);
});

test('pagination uses stable bounded defaults and accepts decimal query parameters', () => {
  assert.deepEqual(paginationParams(), { limit: 20, offset: 0 });
  assert.deepEqual(paginationParams({ search: 'lore', limit: '100', offset: '12' }), { limit: 100, offset: 12 });
  assert.deepEqual(paginationParams({ limit: 1, offset: 0 }), { limit: 1, offset: 0 });
  assert.deepEqual(STRING_LIMITS.forumTitle, { min: 1, max: 200 });
  assert.deepEqual(STRING_LIMITS.categoryName, { min: 1, max: 100 });
  assert.deepEqual(STRING_LIMITS.description, { min: 0, max: 1_000 });
  assert.deepEqual(STRING_LIMITS.postHtml, { min: 1, max: 250_000 });
  assert.deepEqual(STRING_LIMITS.moderationSummary, { min: 1, max: 1_000 });

  for (const query of [
    { limit: '0' }, { limit: '101' }, { limit: '1.5' }, { limit: '-1' },
    { limit: ['10', '20'] }, { offset: '-1' }, { offset: String(MAX_POSTGRES_INTEGER + 1) },
  ]) {
    assert.throws(() => paginationParams(query), (error) => error.status === 400 && error.code === 'INVALID_PAGINATION');
  }
});

test('string validation trims, counts Unicode code points, and rejects instead of truncating', () => {
  assert.equal(normalizeString('  nome  ', { field: 'username', min: 1, max: 10 }), 'nome');
  assert.equal(normalizeString('😀', { min: 1, max: 1 }), '😀');
  assert.equal(normalizeString('   ', { min: 0, max: 5 }), '');
  assert.equal(normalizeString('  ', { min: 2, max: 2, trim: false }), '  ');

  assert.throws(() => normalizeString('😀😀', { max: 1 }), (error) => error.code === 'INVALID_LENGTH');
  assert.throws(() => normalizeString('texto longo', { max: 5 }), (error) => error.code === 'INVALID_LENGTH');
  assert.throws(() => normalizeString(12), (error) => error.code === 'INVALID_VALUE');
  assert.throws(() => normalizeString('', { min: 1 }), (error) => error.code === 'INVALID_LENGTH');
});
