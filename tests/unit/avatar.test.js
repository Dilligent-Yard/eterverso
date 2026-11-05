'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const {
  MAX_AVATAR_BYTES,
  isOwnAvatarUrl,
  isUserAvatarPath,
  parseStoredAvatarData,
  userAvatarPath,
} = require('../../server/avatar');
const { sanitizeUrl } = require('../../server/content');
const { publicAuthor, selfUser } = require('../../server/dto');
const { createApp } = require('../../server/app');

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';

// Minimal valid magic-byte buffers (>= 12 bytes) for each supported format.
const SAMPLE_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);
const SAMPLE_JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
  0x49, 0x46, 0x00, 0x01,
]);
const SAMPLE_GIF = Buffer.from('GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\x3b', 'binary');
const SAMPLE_WEBP = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.from([0x10, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP', 'ascii'),
  Buffer.from('VP8 ', 'ascii'),
]);

test('parseStoredAvatarData accepts valid PNG, JPEG, GIF, and WebP data URLs', () => {
  for (const [mimeType, sample] of [
    ['image/png', SAMPLE_PNG],
    ['image/jpeg', SAMPLE_JPEG],
    ['image/gif', SAMPLE_GIF],
    ['image/webp', SAMPLE_WEBP],
  ]) {
    const dataUrl = `data:${mimeType};base64,${sample.toString('base64')}`;
    const parsed = parseStoredAvatarData(dataUrl);
    assert.ok(parsed, `Expected ${mimeType} to parse`);
    assert.equal(parsed.mimeType, mimeType);
    assert.deepEqual(parsed.buffer, sample);
    assert.equal(parsed.dataUrl, dataUrl);
  }
});

test('parseStoredAvatarData rejects SVG, HTML, spoofed magic bytes, non-canonical base64, and oversized blobs', () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>', 'utf8');
  assert.equal(parseStoredAvatarData(`data:image/svg+xml;base64,${svg.toString('base64')}`), null);

  const html = Buffer.from('<!doctype html><script>alert(1)</script>', 'utf8');
  assert.equal(parseStoredAvatarData(`data:text/html;base64,${html.toString('base64')}`), null);
  assert.equal(parseStoredAvatarData(`data:image/png;base64,${html.toString('base64')}`), null);
  assert.equal(parseStoredAvatarData(`data:image/png;base64,${SAMPLE_JPEG.toString('base64')}`), null);
  assert.equal(parseStoredAvatarData('data:image/png;base64,not valid base64!'), null);

  const oversized = Buffer.concat([SAMPLE_PNG, Buffer.alloc(MAX_AVATAR_BYTES)]);
  assert.equal(parseStoredAvatarData(`data:image/png;base64,${oversized.toString('base64')}`), null);
});

test('userAvatarPath, isUserAvatarPath, and isOwnAvatarUrl validate canonical avatar endpoints', () => {
  assert.equal(userAvatarPath(USER_ID.toUpperCase(), 4), `/api/users/${USER_ID}/avatar?v=4`);
  assert.equal(userAvatarPath(USER_ID, 0), `/api/users/${USER_ID}/avatar`);
  assert.equal(userAvatarPath('not-a-uuid', 1), '');

  assert.equal(isUserAvatarPath(`/api/users/${USER_ID}/avatar`, ''), true);
  assert.equal(isUserAvatarPath(`/api/users/${USER_ID}/avatar`, '?v=12'), true);
  assert.equal(isUserAvatarPath(`/api/users/${USER_ID}/avatar`, '?v=0'), false);
  assert.equal(isUserAvatarPath(`/api/users/${USER_ID}/avatar`, '?evil=1'), false);
  assert.equal(isUserAvatarPath('/api/users/../admin/avatar', ''), false);

  assert.equal(isOwnAvatarUrl(`/api/users/${USER_ID}/avatar?v=2`, USER_ID), true);
  assert.equal(isOwnAvatarUrl(`/api/users/${OTHER_ID}/avatar?v=2`, USER_ID), false);
  assert.equal(isOwnAvatarUrl(`https://evil.test/api/users/${USER_ID}/avatar`, USER_ID), false);
  assert.equal(isOwnAvatarUrl(`/api/users/${USER_ID}/avatar#frag`, USER_ID), false);
});

test('sanitizeUrl allows local /api/users/:id/avatar image URLs while blocking arbitrary local image paths', () => {
  assert.equal(
    sanitizeUrl(`/api/users/${USER_ID.toUpperCase()}/avatar?v=5`, { image: true }),
    `/api/users/${USER_ID}/avatar?v=5`,
  );
  assert.equal(sanitizeUrl(`/api/users/${USER_ID}/avatar#hash`, { image: true }), null);
  assert.equal(sanitizeUrl('/assets/not-allowlisted.png', { image: true }), null);
});

test('selfUser and publicAuthor map stored data:image avatars to /api/users/:id/avatar?v=<version>', () => {
  const pngDataUrl = `data:image/png;base64,${SAMPLE_PNG.toString('base64')}`;
  const rawUser = {
    id: USER_ID,
    username: 'Cronista',
    email: 'cronista@example.invalid',
    avatar: pngDataUrl,
    title: 'Viajante',
    bio: 'Bio.',
    role: 'member',
    posts_count: 3,
    join_date: '2026-01-10',
    version: 9,
  };

  assert.equal(selfUser(rawUser).avatar, `/api/users/${USER_ID}/avatar?v=9`);
  assert.equal(publicAuthor(rawUser).avatar, `/api/users/${USER_ID}/avatar?v=9`);
});

test('GET /api/users/:id/avatar serves binary image with ETag/304 and hides disabled or external-only users', async () => {
  const pngDataUrl = `data:image/png;base64,${SAMPLE_PNG.toString('base64')}`;
  const rowsById = new Map([
    [USER_ID, { id: USER_ID, avatar: pngDataUrl, version: 3, disabled_at: null }],
    [OTHER_ID, { id: OTHER_ID, avatar: 'https://example.test/external.png', version: 1, disabled_at: null }],
  ]);

  const mockSql = (strings, ...values) => {
    const query = strings.join('?');
    if (query.includes('FROM users WHERE id =')) {
      const row = rowsById.get(String(values[0]).toLowerCase());
      return Promise.resolve(row ? [row] : []);
    }
    return Promise.resolve([]);
  };
  mockSql.begin = async (fn) => fn(mockSql);
  mockSql.json = (value) => value;

  const server = http.createServer(createApp({
    sql: mockSql,
    config: {
      sessionSecret: `avatar-unit-${randomUUID()}`,
      secureCookies: false,
      production: false,
      publicOrigin: 'http://127.0.0.1',
    },
  }));
  server.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const okRes = await fetch(`${baseUrl}/api/users/${USER_ID}/avatar?v=3`);
    assert.equal(okRes.status, 200);
    assert.equal(okRes.headers.get('content-type'), 'image/png');
    assert.equal(okRes.headers.get('x-content-type-options'), 'nosniff');
    const etag = okRes.headers.get('etag');
    assert.ok(etag);
    const bodyBytes = Buffer.from(await okRes.arrayBuffer());
    assert.deepEqual(bodyBytes, SAMPLE_PNG);

    const cachedRes = await fetch(`${baseUrl}/api/users/${USER_ID}/avatar?v=3`, {
      headers: { 'If-None-Match': etag },
    });
    assert.equal(cachedRes.status, 304);

    const externalOnlyRes = await fetch(`${baseUrl}/api/users/${OTHER_ID}/avatar`);
    assert.equal(externalOnlyRes.status, 404);

    rowsById.set(USER_ID, { id: USER_ID, avatar: pngDataUrl, version: 4, disabled_at: new Date().toISOString() });
    const disabledRes = await fetch(`${baseUrl}/api/users/${USER_ID}/avatar`);
    assert.equal(disabledRes.status, 404);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
});
