'use strict';

const MAX_AVATAR_BYTES = 524_288;
const MAX_AVATAR_DATA_URL_LENGTH = 720_000;
const DATA_URL_RE = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USER_AVATAR_PATH_RE = /^\/api\/users\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/avatar$/i;
const USER_AVATAR_QUERY_RE = /^(?:\?v=[1-9]\d{0,9})?$/;

function hasExpectedMagicBytes(mimeType, buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) return false;
  if (mimeType === 'image/png') {
    return buffer[0] === 0x89
      && buffer[1] === 0x50
      && buffer[2] === 0x4e
      && buffer[3] === 0x47
      && buffer[4] === 0x0d
      && buffer[5] === 0x0a
      && buffer[6] === 0x1a
      && buffer[7] === 0x0a;
  }
  if (mimeType === 'image/jpeg') {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mimeType === 'image/gif') {
    const header = buffer.subarray(0, 6).toString('ascii');
    return header === 'GIF87a' || header === 'GIF89a';
  }
  if (mimeType === 'image/webp') {
    return buffer.length >= 12
      && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
      && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  }
  return false;
}

/**
 * Validate a base64-encoded raster avatar data URL (PNG, JPEG, WebP, or GIF)
 * and verify its binary magic bytes and maximum size (512 KiB).
 */
function parseStoredAvatarData(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_AVATAR_DATA_URL_LENGTH) {
    return null;
  }
  const match = DATA_URL_RE.exec(value);
  if (!match) return null;
  const mimeType = match[1];
  const base64 = match[2];
  if (base64.length % 4 !== 0) return null;
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length === 0 || buffer.length > MAX_AVATAR_BYTES) return null;
  if (buffer.toString('base64') !== base64) return null;
  if (!hasExpectedMagicBytes(mimeType, buffer)) return null;
  return {
    mimeType,
    buffer,
    dataUrl: `data:${mimeType};base64,${base64}`,
  };
}

function isUserAvatarPath(pathname, search = '') {
  return typeof pathname === 'string'
    && USER_AVATAR_PATH_RE.test(pathname)
    && typeof search === 'string'
    && USER_AVATAR_QUERY_RE.test(search);
}

function userAvatarPath(userId, version) {
  if (typeof userId !== 'string' || !UUID_RE.test(userId)) return '';
  const id = userId.toLowerCase();
  const parsedVersion = Number(version);
  if (Number.isInteger(parsedVersion) && parsedVersion > 0 && parsedVersion <= 2_147_483_647) {
    return `/api/users/${id}/avatar?v=${parsedVersion}`;
  }
  return `/api/users/${id}/avatar`;
}

function isOwnAvatarUrl(value, userId) {
  if (typeof value !== 'string' || typeof userId !== 'string' || !UUID_RE.test(userId)) return false;
  let parsed;
  try {
    parsed = new URL(value, 'https://aetherverse.invalid');
  } catch {
    return false;
  }
  if (parsed.origin !== 'https://aetherverse.invalid' || parsed.hash) return false;
  if (!isUserAvatarPath(parsed.pathname, parsed.search)) return false;
  const match = USER_AVATAR_PATH_RE.exec(parsed.pathname);
  return !!match && match[1].toLowerCase() === userId.toLowerCase();
}

module.exports = {
  MAX_AVATAR_BYTES,
  MAX_AVATAR_DATA_URL_LENGTH,
  isOwnAvatarUrl,
  isUserAvatarPath,
  parseStoredAvatarData,
  userAvatarPath,
};
