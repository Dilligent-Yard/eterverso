'use strict';

const { ValidationError } = require('./validation');
const { ContentValidationError } = require('./content');

const HTTP_STATUSES = new Set([400, 401, 403, 404, 409, 413, 428]);
const MACHINE_CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
const FIELD_NAME = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

/**
 * Public error helpers: `apiError` creates a trusted Portuguese response;
 * `publicError` maps internal/PostgreSQL/parser failures without exposing their
 * messages; `sendError` and `errorMiddleware` serialize that safe mapping.
 * Keep `ApiError` messages static and never interpolate request content.
 */
class ApiError extends Error {
  constructor(status, code, message, details) {
    if (!HTTP_STATUSES.has(status)) throw new TypeError('Unsupported public API status.');
    if (typeof code !== 'string' || !MACHINE_CODE.test(code)) throw new TypeError('Invalid public API error code.');
    if (typeof message !== 'string' || !message.trim() || message.length > 240 || /[\r\n]/.test(message)) {
      throw new TypeError('Invalid public API error message.');
    }
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.publicCode = code;
    this.publicMessage = message;
    this.details = safeFieldDetails(details);
  }
}

function safeFieldDetails(details) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return undefined;
  const output = {};
  for (const [field, value] of Object.entries(details).slice(0, 30)) {
    if (!FIELD_NAME.test(field)) continue;
    if (typeof value === 'string' && value.length <= 200 && !isUnsafePublicText(value)) {
      output[field] = value;
    } else if ((field === 'min' || field === 'max')
        && Number.isSafeInteger(value) && value >= 0 && value <= 2_147_483_647) {
      output[field] = value;
    } else if (Array.isArray(value)) {
      const messages = value.filter((item) => (
        typeof item === 'string' && FIELD_NAME.test(item)
      )).slice(0, 5);
      if (messages.length) output[field] = messages;
    }
  }
  return Object.keys(output).length ? output : undefined;
}

function apiError(status, code, message, details) {
  return new ApiError(status, code, message, details);
}

function mapDatabaseError(error) {
  switch (error && error.code) {
    case '23505':
      return new ApiError(409, 'RESOURCE_CONFLICT', 'Este registro já existe.');
    case '23503':
      return new ApiError(409, 'REFERENCE_CONFLICT', 'Uma referência necessária não está disponível.');
    case '23502':
    case '23514':
    case '22P02':
    case '22001':
      return new ApiError(400, 'INVALID_VALUE', 'Um dos valores enviados é inválido.');
    case '40001':
    case '40P01':
      return new ApiError(409, 'RETRY_CONFLICT', 'Houve um conflito ao salvar. Tente novamente.');
    default:
      return null;
  }
}

function isUnsafePublicText(value) {
  return /[\r\n]/.test(value)
    || /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/.test(value)
    || /\b(?:SELECT|INSERT|UPDATE|DELETE|DROP|ALTER)\b|password_hash|postgres(?:ql)?:\/\//i.test(value);
}

function mapValidationError(error) {
  if (!(error instanceof ValidationError)) return null;
  const status = HTTP_STATUSES.has(error.status) ? error.status : 400;
  const code = typeof error.code === 'string' && MACHINE_CODE.test(error.code)
    ? error.code
    : 'INVALID_REQUEST';
  const message = typeof error.message === 'string'
      && error.message.trim()
      && error.message.length <= 240
      && !isUnsafePublicText(error.message)
    ? error.message
    : 'A solicitação contém um valor inválido.';
  const details = { ...(safeFieldDetails(error.details) || {}) };
  if (typeof error.field === 'string' && FIELD_NAME.test(error.field)) details.field = error.field;
  return new ApiError(status, code, message, details);
}

function publicError(error) {
  if (error instanceof ApiError) {
    const body = { error: error.publicMessage, code: error.publicCode };
    if (error.details) body.details = error.details;
    return { status: error.status, body };
  }

  if (error && error.type === 'entity.too.large') {
    return { status: 413, body: { error: 'O conteúdo enviado excede o limite permitido.', code: 'REQUEST_TOO_LARGE' } };
  }
  if (error && error.type === 'entity.parse.failed') {
    return { status: 400, body: { error: 'O JSON enviado é inválido.', code: 'INVALID_JSON' } };
  }

  const validationError = mapValidationError(error);
  if (validationError) return publicError(validationError);

  if (error instanceof ContentValidationError) {
    return {
      status: 400,
      body: { error: 'O conteúdo enviado possui um formato inválido.', code: 'INVALID_CONTENT' },
    };
  }

  const databaseError = mapDatabaseError(error);
  if (databaseError) return publicError(databaseError);
  return { status: 500, body: { error: 'Erro interno.', code: 'INTERNAL_ERROR' } };
}

function sendError(res, error) {
  const mapped = publicError(error);
  return res.status(mapped.status).json(mapped.body);
}

function errorMiddleware(error, req, res, next) {
  if (res.headersSent) return next(error);
  return sendError(res, error);
}

module.exports = { ApiError, apiError, errorMiddleware, publicError, safeFieldDetails, sendError };
