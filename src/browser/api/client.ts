export interface ApiRoot {
  location: { href: string };
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  dispatchEvent?: (event: Event) => boolean;
  CustomEvent?: typeof CustomEvent;
}

export interface ApiError extends Error {
  publicMessage?: string;
  status?: number;
  code?: string;
}

export interface ApiOptions {
  headers?: Record<string, string> | Headers;
}

export type ApiCallback = (error: string | null, data?: unknown) => void;

interface SessionUser {
  [key: string]: unknown;
  id?: string;
  username?: string;
  email?: string;
  avatar?: string;
  title?: string;
  bio?: string;
  role?: string;
  joinDate?: string;
  version?: number;
  posts?: number;
}

const UNSAFE_METHODS: Record<string, true> = { POST: true, PUT: true, PATCH: true, DELETE: true };
const SESSION_USER_FIELDS: Record<string, number> = {
  id: 64, username: 80, email: 254, avatar: 2048, title: 160,
  bio: 4000, role: 32, joinDate: 64, version: 0,
};
const NETWORK_ERROR = 'Não foi possível conectar ao servidor. Tente novamente.';
const INVALID_JSON_ERROR = 'Resposta inválida do servidor.';
const CSRF_ERROR = 'Não foi possível validar a sessão. Atualize a página e tente novamente.';
const REQUEST_ERROR = 'Não foi possível concluir a solicitação.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requestError(message: string, metadata?: { status?: number; code?: string }): ApiError {
  const error = new Error(message) as ApiError;
  error.publicMessage = message;
  if (metadata && Number.isInteger(metadata.status) && metadata.status !== undefined
      && metadata.status >= 400 && metadata.status <= 599) error.status = metadata.status;
  if (metadata && typeof metadata.code === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(metadata.code)) error.code = metadata.code;
  return error;
}

function safeErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'publicMessage' in error
      && typeof (error as ApiError).publicMessage === 'string') {
    return (error as ApiError).publicMessage as string;
  }
  return REQUEST_ERROR;
}

function normalizePublicMessage(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const message = value.trim();
  if (!message || message.length > 300 || /[\u0000-\u001f\u007f]/.test(message)) return null;
  if (/<\/?(?:html|script|pre|code)\b|\b(?:select|insert|update|delete|alter|drop)\s+.+\bfrom\b|\bpostgres(?:ql)?\b|\bsql\b|\bat\s+.+\.(?:js|ts)\b/i.test(message)) {
    return null;
  }
  return message;
}

function responseErrorMessage(data: unknown, status: number): string {
  const message = normalizePublicMessage(isRecord(data) ? data.error : undefined);
  if (message) return message;
  if (status === 401) return 'Sua sessão expirou. Faça login novamente.';
  if (status === 403) return 'Você não tem permissão para esta ação.';
  return REQUEST_ERROR;
}

function cloneSessionUser(user: unknown): SessionUser | null {
  if (!isRecord(user)) return null;
  const copy: SessionUser = {};
  for (const field of Object.keys(SESSION_USER_FIELDS)) {
    let value: unknown;
    try {
      value = user[field];
    } catch {
      continue;
    }
    const maximum = SESSION_USER_FIELDS[field];
    if (maximum === undefined) continue;
    if (typeof value === 'string' && value.length <= maximum) copy[field] = value;
    else if (field === 'version' && Number.isInteger(value) && typeof value === 'number' && value > 0 && value <= 2147483647) copy[field] = value;
  }
  if (typeof user.posts === 'number' && Number.isSafeInteger(user.posts) && user.posts >= 0) copy.posts = user.posts;
  if (typeof copy.role === 'string' && !['member', 'moderador', 'admin'].includes(copy.role)) delete copy.role;
  return Object.keys(copy).length ? copy : null;
}

export function createApi(root: ApiRoot) {
  let csrfToken: string | null = null;
  let csrfPromise: Promise<string> | null = null;
  let csrfGeneration = 0;
  let authGeneration = 0;
  let sessionUser: SessionUser | null = null;

  function setSessionUser(user: unknown): SessionUser | null {
    authGeneration += 1;
    sessionUser = cloneSessionUser(user);
    return getSessionUser();
  }

  function clearSessionUser(): void {
    authGeneration += 1;
    sessionUser = null;
    invalidateCsrf();
  }

  function getSessionUser(): SessionUser | null {
    return sessionUser ? { ...sessionUser } : null;
  }

  function invalidateCsrf(): void {
    csrfGeneration += 1;
    csrfToken = null;
    csrfPromise = null;
  }

  function resolveSameOriginUrl(url: string): URL {
    const href = root.location && root.location.href;
    if (typeof href !== 'string' || !href) throw requestError('Endereço de solicitação inválido.');
    let parsed: URL;
    try {
      parsed = new URL(String(url), href);
    } catch {
      throw requestError('Endereço de solicitação inválido.');
    }
    const page = new URL(href);
    if (parsed.origin !== page.origin) throw requestError('Endereço de solicitação inválido.');
    return parsed;
  }

  function parseJson(response: Response): Promise<unknown> {
    if (!response || typeof response.json !== 'function') {
      return Promise.reject(requestError(INVALID_JSON_ERROR));
    }
    return Promise.resolve().then(() => response.json() as unknown).catch(() => {
      throw requestError(INVALID_JSON_ERROR);
    });
  }

  function getCsrfToken(): Promise<string> {
    if (csrfToken) return Promise.resolve(csrfToken);
    if (csrfPromise) return csrfPromise;
    const generation = csrfGeneration;
    const pending = Promise.resolve().then(() => root.fetch('/api/auth/csrf', {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })).catch(() => {
      throw requestError(NETWORK_ERROR);
    }).then((response) => parseJson(response).then((data) => {
      if (!response.ok) throw requestError(responseErrorMessage(data, response.status), { status: response.status, code: isRecord(data) && typeof data.code === 'string' ? data.code : undefined });
      const value = isRecord(data) && (data.csrfToken || (isRecord(data.data) ? data.data.csrfToken : undefined));
      if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) throw requestError(CSRF_ERROR);
      if (generation === csrfGeneration) csrfToken = value;
      return value;
    }));
    csrfPromise = pending.then((value) => {
      if (generation === csrfGeneration) csrfPromise = null;
      return value;
    }, (error: unknown) => {
      if (generation === csrfGeneration) csrfPromise = null;
      throw error;
    });
    return csrfPromise;
  }

  function addExtraHeaders(headers: Record<string, string>, extraHeaders: ApiOptions['headers']): void {
    if (!extraHeaders) return;
    if (typeof (extraHeaders as Headers).forEach === 'function') {
      (extraHeaders as Headers).forEach((value, name) => {
        if (name.toLowerCase() !== 'x-csrf-token') headers[name] = value;
      });
      return;
    }
    const plainHeaders = extraHeaders as Record<string, string>;
    for (const [name, value] of Object.entries(plainHeaders)) {
      if (name.toLowerCase() !== 'x-csrf-token') headers[name] = value;
    }
  }

  function authEndpoint(method: string, path: string): boolean {
    return method === 'POST'
      && (path === '/api/auth/login' || path === '/api/auth/signup' || path === '/api/auth/logout');
  }

  function performRequest(method: string, url: string, body: unknown, options?: ApiOptions): Promise<unknown> {
    const verb = typeof method === 'string' ? method.toUpperCase() : '';
    if (!verb) return Promise.reject(requestError('Solicitação inválida.'));
    const requestAuthGeneration = authGeneration;
    let parsedUrl: URL;
    try {
      parsedUrl = resolveSameOriginUrl(url);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : requestError(String(error)));
    }
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    addExtraHeaders(headers, options?.headers);
    const csrf = UNSAFE_METHODS[verb] ? getCsrfToken() : Promise.resolve<string | null>(null);
    return csrf.then((token) => {
      if (token) headers['X-CSRF-Token'] = token;
      let serializedBody: string | undefined;
      try {
        serializedBody = body === undefined ? undefined : JSON.stringify(body);
      } catch {
        throw requestError('Não foi possível preparar a solicitação.');
      }
      return root.fetch(String(url), {
        method: verb,
        credentials: 'same-origin',
        headers,
        body: serializedBody,
      });
    }).catch((error: unknown) => {
      if (error && typeof error === 'object' && 'publicMessage' in error) throw error;
      throw requestError(NETWORK_ERROR);
    }).then((response) => parseJson(response).then((data) => {
      if (!response.ok) {
        if (requestAuthGeneration === authGeneration) {
          const code = isRecord(data) && typeof data.code === 'string' ? data.code : undefined;
          if (response.status === 401 || code === 'CSRF_INVALID') invalidateCsrf();
          if (response.status === 401) {
            clearSessionUser();
            if (root.dispatchEvent && typeof root.CustomEvent === 'function') {
              root.dispatchEvent(new root.CustomEvent('aetherverse:session-expired'));
            }
          }
        }
        throw requestError(responseErrorMessage(data, response.status), {
          status: response.status,
          code: isRecord(data) && typeof data.code === 'string' ? data.code : undefined,
        });
      }
      if (requestAuthGeneration === authGeneration && authEndpoint(verb, parsedUrl.pathname)) {
        invalidateCsrf();
        if (verb === 'POST' && parsedUrl.pathname === '/api/auth/logout') clearSessionUser();
        else if (isRecord(data) && data.user) setSessionUser(data.user);
      }
      if (requestAuthGeneration === authGeneration && verb === 'PUT'
          && parsedUrl.pathname === '/api/auth/profile' && isRecord(data) && data.csrfToken) {
        invalidateCsrf();
      }
      return data;
    }));
  }

  function apiRequest(method: string, url: string, body?: unknown, callback?: ApiCallback, options?: ApiOptions): Promise<unknown> {
    const promise = performRequest(method, url, body, options);
    if (typeof callback !== 'function') {
      return promise.catch((error: unknown) => {
        throw requestError(safeErrorMessage(error), error as { status?: number; code?: string });
      });
    }
    const notifyCallback: ApiCallback = callback;
    let callbackCalled = false;
    function notify(error: string | null, data?: unknown): void {
      if (callbackCalled) return;
      callbackCalled = true;
      notifyCallback(error, data);
    }
    return promise.then((data) => {
      notify(null, data);
      return data;
    }, (error: unknown) => {
      const message = safeErrorMessage(error);
      notify(message, undefined);
      throw requestError(message, error as { status?: number; code?: string });
    });
  }

  return {
    apiRequest,
    setSessionUser,
    clearSessionUser,
    getSessionUser,
  };
}
