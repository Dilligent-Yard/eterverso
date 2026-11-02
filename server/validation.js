'use strict';

const MAX_POSTGRES_INTEGER = 2_147_483_647;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A safe request validation failure that the HTTP error handler can serialize. */
class ValidationError extends TypeError {
  constructor(message, options = {}) {
    super(message);
    this.name = 'ValidationError';
    this.status = options.status || 400;
    this.code = options.code || 'INVALID_REQUEST';
    if (options.field) this.field = options.field;
    if (options.details) this.details = options.details;
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertKeyList(value, name) {
  if (!Array.isArray(value) || value.some((key) => typeof key !== 'string')) {
    throw new TypeError(`${name} must be an array of strings.`);
  }
}

/**
 * Require a plain request object with only the declared own properties.
 * Required properties must be present and not undefined. Returns the original
 * object so callers can validate fields without creating an implicit copy.
 */
function assertObjectShape(value, options = {}) {
  const allowedKeys = options.allowedKeys || [];
  const requiredKeys = options.requiredKeys || [];
  assertKeyList(allowedKeys, 'allowedKeys');
  assertKeyList(requiredKeys, 'requiredKeys');

  if (!isPlainObject(value)) {
    throw new ValidationError('O formato da solicitação é inválido.', {
      code: 'INVALID_SHAPE',
      field: options.field,
    });
  }

  const allowed = new Set(allowedKeys);
  const missingKeys = requiredKeys.filter((key) => !Object.hasOwn(value, key) || value[key] === undefined);
  const unknownKeys = Object.keys(value).filter((key) => !allowed.has(key));
  if (missingKeys.length || unknownKeys.length) {
    throw new ValidationError('A solicitação contém campos ausentes ou não permitidos.', {
      code: 'INVALID_SHAPE',
      field: options.field,
      details: {
        ...(missingKeys.length ? { missingKeys } : {}),
        ...(unknownKeys.length ? { unknownKeys } : {}),
      },
    });
  }
  return value;
}

/** Validate a canonical UUID string, returning lowercase for stable handling. */
function validateUuid(value, field = 'id') {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw new ValidationError('O identificador deve ser um UUID válido.', {
      code: 'INVALID_UUID',
      field,
    });
  }
  return value.toLowerCase();
}

/** Validate a positive PostgreSQL integer used as a resource version. */
function validatePositiveVersion(value, field = 'expectedVersion') {
  if (!Number.isInteger(value) || value < 1 || value > MAX_POSTGRES_INTEGER) {
    throw new ValidationError('A versão deve ser um inteiro positivo válido.', {
      code: 'INVALID_VERSION',
      field,
    });
  }
  return value;
}

/** Validate a write precondition, using HTTP 428 when it was omitted. */
function expectedVersion(value, field = 'expectedVersion') {
  if (value === undefined) {
    throw new ValidationError('A versão esperada é obrigatória.', {
      status: 428,
      code: 'PRECONDITION_REQUIRED',
      field,
    });
  }
  return validatePositiveVersion(value, field);
}

/**
 * Trim and validate a user-provided string without coercion or truncation.
 * Length is measured in Unicode code points, matching PostgreSQL character
 * limits more closely than JavaScript's UTF-16 code-unit length. No Unicode
 * compatibility normalization is applied to preserve the supplied text.
 */
function normalizeString(value, options = {}) {
  const field = options.field || 'value';
  const min = options.min === undefined ? 1 : options.min;
  const max = options.max === undefined ? Number.MAX_SAFE_INTEGER : options.max;
  const trim = options.trim !== false;
  if (!Number.isInteger(min) || min < 0 || !Number.isInteger(max) || max < min) {
    throw new TypeError('String bounds must be non-negative integer limits with max >= min.');
  }
  if (typeof value !== 'string') {
    throw new ValidationError('O campo deve ser um texto válido.', {
      code: 'INVALID_VALUE',
      field,
    });
  }
  const normalized = trim ? value.trim() : value;
  const length = Array.from(normalized).length;
  if (length < min || length > max) {
    throw new ValidationError('O texto está fora do limite permitido.', {
      code: 'INVALID_LENGTH',
      field,
      details: { min, max },
    });
  }
  return normalized;
}

/** A2 limits for fields whose lengths can be checked before content parsing. */
const STRING_LIMITS = Object.freeze({
  forumTitle: Object.freeze({ min: 1, max: 200 }),
  categoryName: Object.freeze({ min: 1, max: 100 }),
  description: Object.freeze({ min: 0, max: 1_000 }),
  postHtml: Object.freeze({ min: 1, max: 250_000 }),
  moderationSummary: Object.freeze({ min: 1, max: 1_000 }),
});

function parseQueryInteger(value, field, fallback, min, max) {
  if (value === undefined) return fallback;
  let parsed;
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    parsed = value;
  } else if (typeof value === 'string' && /^(?:0|[1-9]\d*)$/.test(value)) {
    parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) parsed = NaN;
  }
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new ValidationError('Os parâmetros de paginação são inválidos.', {
      code: 'INVALID_PAGINATION',
      field,
    });
  }
  return parsed;
}

/**
 * Parse offset pagination from an Express query object. Other route-specific
 * filters may coexist in the query; returned values are always bounded ints.
 * List SQL should order by its natural key plus UUID/ID before applying them.
 */
function paginationParams(query = {}) {
  if (!isPlainObject(query)) {
    throw new ValidationError('Os parâmetros de paginação são inválidos.', {
      code: 'INVALID_PAGINATION',
    });
  }
  return {
    limit: parseQueryInteger(query.limit, 'limit', 20, 1, 100),
    offset: parseQueryInteger(query.offset, 'offset', 0, 0, MAX_POSTGRES_INTEGER),
  };
}

module.exports = {
  MAX_POSTGRES_INTEGER,
  STRING_LIMITS,
  ValidationError,
  assertObjectShape,
  expectedVersion,
  isPlainObject,
  normalizeString,
  paginationParams,
  validatePositiveVersion,
  validateUuid,
};
