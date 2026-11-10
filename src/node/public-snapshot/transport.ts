import * as http from 'node:http';
import * as https from 'node:https';
import { URL } from 'node:url';
import type { IncomingHttpHeaders } from 'node:http';
import {
  CaptureHttpError,
  CaptureUsageError,
  FORUM_POSTS_PATH_RE,
  FORUM_THREAD_PATH_RE,
  PAGE_SIZE,
  UUID_PATH_RE,
} from './contracts.js';

export const PUBLIC_HEADERS = Object.freeze({
  accept: 'application/json',
  'user-agent': 'AetherversePublicCapture/1 (anonymous read-only; +https://eterverso.onrender.com)',
});

export type EndpointFamily =
  | 'characters'
  | 'scenes'
  | 'sceneDetail'
  | 'wikiPageDetail'
  | 'wikiPages'
  | 'wikiSections'
  | 'wikiCategories'
  | 'forumCategories'
  | 'forumThreadDetail'
  | 'forumPosts';

export interface EndpointDetails {
  family?: string;
  endpoint?: string;
}

export interface HttpExchangeParams {
  url: URL;
  connectTimeoutMs: number;
  readTimeoutMs: number;
  maxBodyBytes: number;
}

export interface HttpExchangeResult {
  url: string;
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
  json: unknown;
}

export function isLoopbackHostname(hostname: unknown): boolean {
  const value = typeof hostname === 'string' ? hostname.toLowerCase() : '';
  return value === 'localhost' || value === '::1' || value === '[::1]'
    || /^127(?:\.\d{1,3}){3}$/.test(value);
}

/**
 * Validate an origin. HTTPS is mandatory except for an explicit loopback test
 * origin, which must be a bare loopback host (no path, query, credentials).
 */
export function normalizeOrigin(
  raw: unknown,
  options: { allowLoopbackHttp?: boolean } = {},
): string {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new CaptureUsageError('An origin is required.');
  }
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new CaptureUsageError(`Invalid origin: ${raw}`);
  }
  if (url.username || url.password) throw new CaptureUsageError('Origins must not contain credentials.');
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new CaptureUsageError('The origin must not include a path, query, or fragment.');
  }
  if (url.protocol === 'https:') return url.origin;
  if (url.protocol === 'http:' && options.allowLoopbackHttp === true && isLoopbackHostname(url.hostname)) {
    return url.origin;
  }
  if (url.protocol === 'http:') {
    throw new CaptureUsageError('Only HTTPS origins are allowed (loopback HTTP requires explicit test mode).');
  }
  throw new CaptureUsageError(`Unsupported origin protocol: ${url.protocol}`);
}

export function classifyEndpoint(url: URL): EndpointFamily | null {
  if (url.hash) return null;
  const pathname = url.pathname;
  const keys = [...new Set(url.searchParams.keys())];
  const onlyPagination = keys.every((key) => key === 'limit' || key === 'offset');
  if (keys.length !== [...url.searchParams.keys()].length) return null;
  if (keys.length && !onlyPagination) return null;
  for (const key of keys) {
    const values = url.searchParams.getAll(key);
    const firstValue = values[0];
    if (values.length !== 1 || firstValue === undefined || firstValue === '') return null;
    const number = Number(firstValue);
    if (!Number.isInteger(number) || number < 0) return null;
    if (key === 'limit' && (number < 1 || number > PAGE_SIZE)) return null;
  }

  if (pathname === '/api/personagens') return keys.length ? null : 'characters';
  if (pathname === '/api/wiki-posts') return keys.length ? null : 'scenes';
  if (UUID_PATH_RE.test(pathname)) {
    return keys.length ? null : (pathname.startsWith('/api/wiki-posts/') ? 'sceneDetail' : 'wikiPageDetail');
  }
  if (pathname === '/api/wiki/pages') return onlyPagination ? 'wikiPages' : null;
  if (pathname === '/api/wiki/sections') return keys.length ? null : 'wikiSections';
  if (pathname === '/api/wiki/categories') return onlyPagination ? 'wikiCategories' : null;
  if (pathname === '/api/forum/categories') return onlyPagination ? 'forumCategories' : null;
  if (FORUM_THREAD_PATH_RE.test(pathname)) return keys.length ? null : 'forumThreadDetail';
  if (FORUM_POSTS_PATH_RE.test(pathname)) return onlyPagination ? 'forumPosts' : null;
  return null;
}

export function assertAllowedEndpoint(
  origin: string,
  target: URL,
  details: EndpointDetails = {},
): void {
  if (target.origin !== origin || target.username || target.password) {
    throw new CaptureHttpError('UNSAFE_REDIRECT', 'Refused a redirect or request outside the capture origin.', {
      retryable: false,
      family: details.family,
      endpoint: details.endpoint,
    });
  }
  if (!classifyEndpoint(target)) {
    throw new CaptureHttpError('UNSAFE_REDIRECT', 'Refused an unknown endpoint family.', {
      retryable: false,
      family: details.family,
      endpoint: details.endpoint,
    });
  }
}

export function parseRetryAfter(value: unknown, now = Date.now()): number | null {
  if (value === undefined || value === null) return null;
  const text = String(Array.isArray(value) ? value[0] : value).trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) return Math.min(60_000, Number(text) * 1000);
  const timestamp = Date.parse(text);
  if (Number.isNaN(timestamp)) return null;
  return Math.max(0, Math.min(60_000, timestamp - now));
}

export function httpExchange({
  url,
  connectTimeoutMs,
  readTimeoutMs,
  maxBodyBytes,
}: HttpExchangeParams): Promise<HttpExchangeResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let responseStarted = false;
    let connectTimer: NodeJS.Timeout | null = null;
    let readTimer: NodeJS.Timeout | null = null;

    const finish = (error: CaptureHttpError | null, value: HttpExchangeResult | null): void => {
      if (settled) return;
      settled = true;
      if (connectTimer) clearTimeout(connectTimer);
      if (readTimer) clearTimeout(readTimer);
      if (error) reject(error);
      else if (value) resolve(value);
    };

    const requestOptions = {
      method: 'GET',
      headers: { ...PUBLIC_HEADERS },
      agent: false,
      timeout: Math.min(connectTimeoutMs, readTimeoutMs),
    };

    const onResponse = (response: http.IncomingMessage): void => {
      responseStarted = true;
      if (connectTimer) {
        clearTimeout(connectTimer);
        connectTimer = null;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      readTimer = setTimeout(() => {
        finish(new CaptureHttpError('READ_TIMEOUT', 'Response body read timed out.', { retryable: true }), null);
        response.destroy();
        request.destroy();
      }, readTimeoutMs);
      response.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > maxBodyBytes) {
          finish(new CaptureHttpError('BODY_TOO_LARGE', 'Response body exceeded the configured limit.', { retryable: false }), null);
          response.destroy();
          request.destroy();
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        if (response.complete === false) {
          finish(new CaptureHttpError('PARTIAL_RESPONSE', 'Response was interrupted.', { retryable: true }), null);
          return;
        }
        finish(null, {
          url: url.toString(),
          status: response.statusCode || 0,
          headers: response.headers,
          body: Buffer.concat(chunks),
          json: null,
        });
      });
      response.on('aborted', () => {
        finish(new CaptureHttpError('PARTIAL_RESPONSE', 'Response was interrupted.', { retryable: true }), null);
      });
      response.on('error', () => {
        finish(new CaptureHttpError('READ_ERROR', 'Response stream failed.', { retryable: true }), null);
      });
    };

    const request = url.protocol === 'https:'
      ? https.request(url, requestOptions, onResponse)
      : http.request(url, requestOptions, onResponse);

    connectTimer = setTimeout(() => {
      finish(new CaptureHttpError('CONNECT_TIMEOUT', 'Connection timed out.', { retryable: true }), null);
      request.destroy();
    }, connectTimeoutMs);
    request.on('timeout', () => {
      finish(new CaptureHttpError('TIMEOUT', 'Socket timed out.', { retryable: true }), null);
      request.destroy();
    });
    request.on('error', () => {
      finish(new CaptureHttpError(
        responseStarted ? 'PARTIAL_RESPONSE' : 'NETWORK_ERROR',
        responseStarted ? 'Response was interrupted.' : 'Network request failed.',
        { retryable: true },
      ), null);
    });
    request.end();
  });
}
