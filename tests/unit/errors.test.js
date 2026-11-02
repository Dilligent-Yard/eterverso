'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ApiError, apiError, errorMiddleware, publicError, safeFieldDetails } = require('../../server/errors');
const { ValidationError } = require('../../server/validation');
const { ContentValidationError } = require('../../server/content');

function response() {
  return {
    statusCode: undefined,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('public API errors preserve the Portuguese message, code, and safe field details', () => {
  const error = apiError(409, 'STALE_VERSION', 'Este conteúdo mudou. Recarregue antes de salvar.', {
    expectedVersion: 'A versão informada não é mais atual.',
    ignored: { raw: 'nested values are not safe field errors' },
    'bad field name!': 'ignored',
  });
  assert.deepEqual(publicError(error), {
    status: 409,
    body: {
      error: 'Este conteúdo mudou. Recarregue antes de salvar.',
      code: 'STALE_VERSION',
      details: { expectedVersion: 'A versão informada não é mais atual.' },
    },
  });
});

test('database and parser errors map to safe client responses without internal text', () => {
  const databaseError = new Error('select password_hash from users; connection secret');
  databaseError.code = '23505';
  const mappedDatabase = publicError(databaseError);
  assert.equal(mappedDatabase.status, 409);
  assert.equal(mappedDatabase.body.code, 'RESOURCE_CONFLICT');
  assert.doesNotMatch(JSON.stringify(mappedDatabase), /password_hash|connection secret|select/i);

  const unknown = publicError(new Error('SQL failed at secret table; stack details'));
  assert.deepEqual(unknown, {
    status: 500,
    body: { error: 'Erro interno.', code: 'INTERNAL_ERROR' },
  });

  assert.equal(publicError({ type: 'entity.too.large', message: 'private parser detail' }).status, 413);
  assert.deepEqual(publicError({ type: 'entity.parse.failed', body: 'secret body' }).body, {
    error: 'O JSON enviado é inválido.',
    code: 'INVALID_JSON',
  });
});

test('ValidationError keeps its public status and code while filtering unsafe field details', () => {
  const error = new ValidationError('A versão esperada é obrigatória.', {
    status: 428,
    code: 'PRECONDITION_REQUIRED',
    field: 'expectedVersion',
    details: {
      min: 1,
      max: 2_147_483_647,
      unknownKeys: ['authorId', 'person@example.invalid', 'private lore passage'],
    },
  });
  assert.deepEqual(publicError(error), {
    status: 428,
    body: {
      error: 'A versão esperada é obrigatória.',
      code: 'PRECONDITION_REQUIRED',
      details: {
        min: 1,
        max: 2_147_483_647,
        unknownKeys: ['authorId'],
        field: 'expectedVersion',
      },
    },
  });

  const internalText = publicError(new ValidationError('SELECT password_hash FROM users'));
  assert.deepEqual(internalText.body, {
    error: 'A solicitação contém um valor inválido.',
    code: 'INVALID_REQUEST',
  });
});

test('content validation failures are client errors without exposing parser details', () => {
  const error = new ContentValidationError('Unknown field at blocks[0].content', 'blocks[0].content');
  assert.deepEqual(publicError(error), {
    status: 400,
    body: { error: 'O conteúdo enviado possui um formato inválido.', code: 'INVALID_CONTENT' },
  });
});

test('error middleware emits only mapped JSON and forwards after headers are sent', () => {
  const res = response();
  errorMiddleware(Object.assign(new Error('deadlock SQL detail'), { code: '40P01' }), {}, res, () => {
    assert.fail('handled errors should not be forwarded');
  });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'RETRY_CONFLICT');
  assert.doesNotMatch(JSON.stringify(res.body), /deadlock|SQL detail/i);

  let forwarded;
  errorMiddleware(new Error('stream error'), {}, { headersSent: true }, (error) => { forwarded = error; });
  assert.equal(forwarded.message, 'stream error');
});

test('invalid public error definitions and unsafe detail structures are rejected or omitted', () => {
  assert.throws(() => new ApiError(418, 'TEAPOT', 'No.'), TypeError);
  assert.throws(() => new ApiError(403, 'INVALID CODE', 'No.'), TypeError);
  assert.throws(() => new ApiError(403, 'FORBIDDEN', 'SQL\npassword_hash'), TypeError);
  assert.deepEqual(safeFieldDetails({
    field: ['safe', { raw: 'nested' }, 'also safe'],
    veryLong: 'x'.repeat(201),
  }), { field: ['safe'] });
});
