(function (root) {
  'use strict';

  var api = root.Aetherverse || {};
  var csrfToken = null;
  var csrfPromise = null;
  var csrfGeneration = 0;
  var sessionUser = null;
  var UNSAFE_METHODS = { POST: true, PUT: true, PATCH: true, DELETE: true };
  var SESSION_USER_FIELDS = {
    id: 64,
    username: 80,
    email: 254,
    avatar: 2048,
    title: 160,
    bio: 4000,
    role: 32,
    joinDate: 64,
    version: 0
  };

  var NETWORK_ERROR = 'Não foi possível conectar ao servidor. Tente novamente.';
  var INVALID_JSON_ERROR = 'Resposta inválida do servidor.';
  var CSRF_ERROR = 'Não foi possível validar a sessão. Atualize a página e tente novamente.';
  var REQUEST_ERROR = 'Não foi possível concluir a solicitação.';

  function requestError(message, metadata) {
    var error = new Error(message);
    error.publicMessage = message;
    if (metadata && Number.isInteger(metadata.status) && metadata.status >= 400 && metadata.status <= 599) error.status = metadata.status;
    if (metadata && typeof metadata.code === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(metadata.code)) error.code = metadata.code;
    return error;
  }

  function safeErrorMessage(error) {
    return error && typeof error.publicMessage === 'string'
      ? error.publicMessage
      : REQUEST_ERROR;
  }

  function normalizePublicMessage(value) {
    if (typeof value !== 'string') return null;
    var message = value.trim();
    if (!message || message.length > 300 || /[\u0000-\u001f\u007f]/.test(message)) return null;
    if (/<\/?(?:html|script|pre|code)\b|\b(?:select|insert|update|delete|alter|drop)\s+.+\bfrom\b|\bpostgres(?:ql)?\b|\bsql\b|\bat\s+.+\.(?:js|ts)\b/i.test(message)) {
      return null;
    }
    return message;
  }

  function responseErrorMessage(data, status) {
    var message = data && normalizePublicMessage(data.error);
    if (message) return message;
    if (status === 401) return 'Sua sessão expirou. Faça login novamente.';
    if (status === 403) return 'Você não tem permissão para esta ação.';
    return REQUEST_ERROR;
  }

  function cloneSessionUser(user) {
    if (!user || typeof user !== 'object' || Array.isArray(user)) return null;
    var copy = {};
    Object.keys(SESSION_USER_FIELDS).forEach(function (field) {
      var value;
      try {
        value = user[field];
      } catch (_) {
        return;
      }
      var maximum = SESSION_USER_FIELDS[field];
      if (typeof value === 'string' && value.length <= maximum) copy[field] = value;
      else if (field === 'version' && Number.isInteger(value) && value > 0 && value <= 2147483647) copy[field] = value;
    });
    if (typeof user.posts === 'number' && Number.isSafeInteger(user.posts) && user.posts >= 0) {
      copy.posts = user.posts;
    }
    if (copy.role && ['member', 'moderador', 'admin'].indexOf(copy.role) === -1) {
      delete copy.role;
    }
    return Object.keys(copy).length ? copy : null;
  }

  function setSessionUser(user) {
    sessionUser = cloneSessionUser(user);
    return getSessionUser();
  }

  function clearSessionUser() {
    sessionUser = null;
    invalidateCsrf();
  }

  function getSessionUser() {
    return sessionUser ? Object.assign({}, sessionUser) : null;
  }

  function invalidateCsrf() {
    csrfGeneration += 1;
    csrfToken = null;
    csrfPromise = null;
  }

  function resolveSameOriginUrl(url) {
    var href = root.location && root.location.href;
    if (typeof href !== 'string' || !href) throw requestError('Endereço de solicitação inválido.');
    var parsed;
    try {
      parsed = new URL(String(url), href);
    } catch (_) {
      throw requestError('Endereço de solicitação inválido.');
    }
    var page = new URL(href);
    if (parsed.origin !== page.origin) throw requestError('Endereço de solicitação inválido.');
    return parsed;
  }

  function parseJson(response) {
    if (!response || typeof response.json !== 'function') {
      return Promise.reject(requestError(INVALID_JSON_ERROR));
    }
    return Promise.resolve().then(function () {
      return response.json();
    }).catch(function () {
      throw requestError(INVALID_JSON_ERROR);
    });
  }

  function getCsrfToken() {
    if (csrfToken) return Promise.resolve(csrfToken);
    if (csrfPromise) return csrfPromise;

    var generation = csrfGeneration;
    var pending = Promise.resolve().then(function () {
      return root.fetch('/api/auth/csrf', {
        method: 'GET',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      });
    }).catch(function () {
      throw requestError(NETWORK_ERROR);
    }).then(function (response) {
      return parseJson(response).then(function (data) {
        if (!response.ok) throw requestError(responseErrorMessage(data, response.status), { status: response.status, code: data && data.code });
        var value = data && (data.csrfToken || (data.data && data.data.csrfToken));
        if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) {
          throw requestError(CSRF_ERROR);
        }
        if (generation === csrfGeneration) csrfToken = value;
        return value;
      });
    });

    csrfPromise = pending.then(function (value) {
      if (generation === csrfGeneration) csrfPromise = null;
      return value;
    }, function (error) {
      if (generation === csrfGeneration) csrfPromise = null;
      throw error;
    });
    return csrfPromise;
  }

  function addExtraHeaders(headers, extraHeaders) {
    if (!extraHeaders || typeof extraHeaders !== 'object') return;
    if (typeof extraHeaders.forEach === 'function') {
      extraHeaders.forEach(function (value, name) {
        if (String(name).toLowerCase() !== 'x-csrf-token') headers[name] = value;
      });
      return;
    }
    Object.keys(extraHeaders).forEach(function (name) {
      if (name.toLowerCase() !== 'x-csrf-token') headers[name] = extraHeaders[name];
    });
  }

  function authEndpoint(method, path) {
    return method === 'POST'
      && (path === '/api/auth/login' || path === '/api/auth/signup' || path === '/api/auth/logout');
  }

  function performRequest(method, url, body, options) {
    var verb = typeof method === 'string' ? method.toUpperCase() : '';
    if (!verb) return Promise.reject(requestError('Solicitação inválida.'));

    var parsedUrl;
    try {
      parsedUrl = resolveSameOriginUrl(url);
    } catch (error) {
      return Promise.reject(error);
    }

    var headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    addExtraHeaders(headers, options && options.headers);

    var csrf = UNSAFE_METHODS[verb] ? getCsrfToken() : Promise.resolve(null);
    return csrf.then(function (token) {
      if (token) headers['X-CSRF-Token'] = token;
      var serializedBody;
      try {
        serializedBody = body === undefined ? undefined : JSON.stringify(body);
      } catch (_) {
        throw requestError('Não foi possível preparar a solicitação.');
      }
      return root.fetch(String(url), {
        method: verb,
        credentials: 'same-origin',
        headers: headers,
        body: serializedBody
      });
    }).catch(function (error) {
      if (error && error.publicMessage) throw error;
      throw requestError(NETWORK_ERROR);
    }).then(function (response) {
      return parseJson(response).then(function (data) {
        if (!response.ok) throw requestError(responseErrorMessage(data, response.status), { status: response.status, code: data && data.code });
        if (authEndpoint(verb, parsedUrl.pathname)) {
          invalidateCsrf();
          if (verb === 'POST' && parsedUrl.pathname === '/api/auth/logout') clearSessionUser();
          else if (data && data.user) setSessionUser(data.user);
        }
        // Password changes rotate the session cookie and its matching CSRF token.
        if (verb === 'PUT' && parsedUrl.pathname === '/api/auth/profile' && data && data.csrfToken) {
          invalidateCsrf();
        }
        return data;
      });
    });
  }

  function apiRequest(method, url, body, callback, options) {
    var promise = performRequest(method, url, body, options);
    if (typeof callback !== 'function') {
      return promise.catch(function (error) {
        throw requestError(safeErrorMessage(error), error);
      });
    }

    var callbackCalled = false;
    function notify(error, data) {
      if (callbackCalled) return;
      callbackCalled = true;
      callback(error, data);
    }

    return promise.then(function (data) {
      notify(null, data);
      return data;
    }, function (error) {
      var message = safeErrorMessage(error);
      notify(message, undefined);
      throw requestError(message, error);
    });
  }

  api.apiRequest = apiRequest;
  api.setSessionUser = setSessionUser;
  api.clearSessionUser = clearSessionUser;
  api.getSessionUser = getSessionUser;
  root.Aetherverse = api;
})(window);
