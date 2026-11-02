'use strict';

const { randomBytes, timingSafeEqual } = require('node:crypto');
const { ApiError, sendError } = require('./errors');
const { adminUser, publicAuthor, selfUser } = require('./dto');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CSRF_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const MAX_PG_INTEGER = 2147483647;
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * `createAuth({ sql, config })` returns `csrfProtection`, `csrfTokenForSession`,
 * `issueSession`, `clearSession`, `readFreshIdentity`, `requireIdentity`,
 * `requireRole`, and `withActorTransaction`. Protected reads use
 * `requireIdentity`; each privileged write must use `withActorTransaction`
 * and check the callback's freshly locked actor before mutating. Pass
 * `{ beforeActorLock }` for a required transaction lock that precedes the
 * actor row, such as the admin-set advisory lock in contract B2.
 *
 * Cookie payload keys are limited to `userId`, `authVersion`, and `csrfToken`.
 * `config.publicOrigin` is explicit; it is required when `production` is true.
 */
function positiveVersion(value) {
  return Number.isInteger(value) && value > 0 && value <= MAX_PG_INTEGER;
}

function validUserId(value) {
  return typeof value === 'string' && UUID.test(value);
}

function newCsrfToken() {
  return randomBytes(32).toString('base64url');
}

function createCookieSessionOptions(config = {}) {
  if (typeof config.sessionSecret !== 'string' || !config.sessionSecret) {
    throw new TypeError('A session secret is required.');
  }
  return {
    name: 'eterverso_session',
    keys: [config.sessionSecret],
    maxAge: 30 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax',
    secure: config.secureCookies === true,
  };
}

function unauthorized() {
  return new ApiError(401, 'UNAUTHENTICATED', 'Sua sessão expirou. Faça login novamente.');
}

function createAuth(options = {}) {
  const sql = options.sql;
  const config = options.config || {};
  if (typeof sql !== 'function' || typeof sql.begin !== 'function') {
    throw new TypeError('createAuth requires an injected postgres client with transaction support.');
  }
  const allowedOrigin = normalizeOrigin(config.publicOrigin);
  if (config.production === true && !allowedOrigin) {
    throw new TypeError('Production authentication requires an explicit publicOrigin.');
  }

  function canonicalizeSession(req) {
    const current = req.session && typeof req.session === 'object' && !Array.isArray(req.session)
      ? req.session
      : {};
    const session = {};
    if (validUserId(current.userId) && positiveVersion(current.authVersion)) {
      session.userId = current.userId.toLowerCase();
      session.authVersion = current.authVersion;
    }
    if (typeof current.csrfToken === 'string' && CSRF_TOKEN.test(current.csrfToken)) {
      session.csrfToken = current.csrfToken;
    }
    const currentKeys = Object.keys(current).sort();
    const sessionKeys = Object.keys(session).sort();
    if (currentKeys.length !== sessionKeys.length
        || currentKeys.some((key, index) => key !== sessionKeys[index])) {
      req.session = session;
    }
    return req.session && typeof req.session === 'object' ? req.session : session;
  }

  function csrfTokenForSession(req) {
    const session = canonicalizeSession(req);
    if (session.csrfToken) return session.csrfToken;
    const csrfToken = newCsrfToken();
    req.session = { ...session, csrfToken };
    return csrfToken;
  }

  function issueSession(req, user) {
    if (!user || !validUserId(String(user.id || '')) || !positiveVersion(user.auth_version)) {
      throw new TypeError('Cannot create a session without a UUID and positive auth_version.');
    }
    const csrfToken = newCsrfToken();
    req.session = {
      userId: String(user.id).toLowerCase(),
      authVersion: user.auth_version,
      csrfToken,
    };
    return csrfToken;
  }

  function clearSession(req) {
    req.session = null;
    delete req.authUser;
  }

  function sessionIdentity(req) {
    const session = canonicalizeSession(req);
    if (!validUserId(session.userId) || !positiveVersion(session.authVersion)) return null;
    return { userId: session.userId, authVersion: session.authVersion };
  }

  function validActiveUser(user, identity) {
    return !!user
      && validUserId(String(user.id || ''))
      && String(user.id).toLowerCase() === identity.userId
      && Object.prototype.hasOwnProperty.call(user, 'disabled_at')
      && user.disabled_at === null
      && positiveVersion(user.auth_version)
      && user.auth_version === identity.authVersion;
  }

  async function readFreshIdentity(req) {
    const identity = sessionIdentity(req);
    if (!identity) return null;
    const rows = await sql`
      SELECT id, username, email, avatar, title, bio, role, posts_count,
             (SELECT count(*)::integer FROM posts p WHERE p.author_id = users.id AND p.deleted_at IS NULL) AS forum_posts_count,
             join_date,
             disabled_at, auth_version, version
      FROM users WHERE id = ${identity.userId} LIMIT 1`;
    const user = rows[0];
    if (!validActiveUser(user, identity)) {
      clearSession(req);
      return null;
    }
    req.authUser = user;
    return user;
  }

  async function requireIdentity(req, res, next) {
    try {
      const user = await readFreshIdentity(req);
      if (!user) return sendError(res, unauthorized());
      return next();
    } catch (error) {
      return next(error);
    }
  }

  function requireRole(...roles) {
    if (!roles.length || roles.some((role) => typeof role !== 'string')) {
      throw new TypeError('requireRole needs one or more role names.');
    }
    return function (req, res, next) {
      if (!req.authUser) return sendError(res, unauthorized());
      try { assertRole(req.authUser, ...roles); } catch (error) { return sendError(res, error); }
      return next();
    };
  }

  function assertRole(user, ...roles) {
    if (!user) throw unauthorized();
    if (!roles.length || !roles.includes(user.role)) {
      throw new ApiError(403, 'FORBIDDEN', 'Você não tem permissão para esta ação.');
    }
    return user;
  }

  function csrfProtection(req, res, next) {
    if (!UNSAFE_METHODS.has(String(req.method || '').toUpperCase())) return next();

    const origin = requestHeader(req, 'origin');
    const fetchSite = requestHeader(req, 'sec-fetch-site');
    if (origin !== undefined) {
      if (!allowedOrigin || !sameOrigin(origin, allowedOrigin)) {
        return sendError(res, new ApiError(403, 'ORIGIN_FORBIDDEN', 'A origem desta solicitação não é permitida.'));
      }
    }
    if (fetchSite !== undefined && String(fetchSite).toLowerCase() !== 'same-origin') {
      return sendError(res, new ApiError(403, 'ORIGIN_FORBIDDEN', 'A origem desta solicitação não é permitida.'));
    }

    const session = canonicalizeSession(req);
    const expected = session.csrfToken;
    const supplied = requestHeader(req, 'x-csrf-token');
    if (!validCsrfPair(expected, supplied)) {
      return sendError(res, new ApiError(403, 'CSRF_INVALID', 'Atualize a sessão e tente novamente.'));
    }
    return next();
  }

  async function withActorTransaction(req, callback, transactionOptions = {}) {
    if (typeof callback !== 'function') throw new TypeError('A transaction callback is required.');
    if (transactionOptions.beforeActorLock !== undefined
        && typeof transactionOptions.beforeActorLock !== 'function') {
      throw new TypeError('beforeActorLock must be a transaction callback.');
    }
    const identity = sessionIdentity(req);
    if (!identity) throw unauthorized();
    return sql.begin(async (tx) => {
      if (transactionOptions.beforeActorLock) await transactionOptions.beforeActorLock(tx);
      const rows = await tx`
        SELECT id, username, role, disabled_at, auth_version, version
        FROM users WHERE id = ${identity.userId} FOR UPDATE`;
      const actor = rows[0];
      if (!validActiveUser(actor, identity)) {
        clearSession(req);
        throw unauthorized();
      }
      req.authUser = actor;
      return callback(tx, actor);
    });
  }

  return {
    clearSession,
    assertRole,
    csrfProtection,
    csrfTokenForSession,
    issueSession,
    readFreshIdentity,
    requireIdentity,
    requireRole,
    withActorTransaction,
  };
}

function normalizeOrigin(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new TypeError('publicOrigin must be an origin URL.');
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError('publicOrigin must be an origin URL.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin === 'null') {
    throw new TypeError('publicOrigin must use HTTP or HTTPS.');
  }
  return parsed.origin;
}

function sameOrigin(requestOrigin, allowedOrigin) {
  if (typeof requestOrigin !== 'string' || requestOrigin === 'null') return false;
  try {
    const parsed = new URL(requestOrigin);
    return parsed.origin === allowedOrigin
      && parsed.pathname === '/'
      && parsed.search === ''
      && parsed.hash === ''
      && !parsed.username
      && !parsed.password;
  } catch {
    return false;
  }
}

function requestHeader(req, name) {
  if (typeof req.get === 'function') {
    const value = req.get(name);
    if (value !== undefined) return value;
  }
  const headers = req.headers || {};
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : headers[key];
}

function validCsrfPair(expected, supplied) {
  if (typeof expected !== 'string' || !CSRF_TOKEN.test(expected)
      || typeof supplied !== 'string' || !CSRF_TOKEN.test(supplied)) return false;
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

module.exports = {
  adminUser,
  createAuth,
  createCookieSessionOptions,
  publicAuthor,
  selfUser,
};
