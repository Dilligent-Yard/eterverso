import { createHash } from 'node:crypto';

import type { PublicError, UnknownRecord } from './contracts.js';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
export const HASH_RE = /^[a-f0-9]{64}$/u;
export const CAPTURE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u;
export const NAME_KEY_RE = /^[a-z0-9][a-z0-9-]{0,99}$/u;
export const SENSITIVE_KEY_RE = /^(password|passwordhash|passwd|email|session|cookie|authorization|token|secret)$/iu;

export function publicError(message: string): PublicError {
  return Object.assign(new Error(message), { safeToPrint: true as const });
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function deterministicUuid(namespace: string, value: string): string {
  const digest = createHash('sha256').update(`${namespace}\0${value}`, 'utf8').digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return `${JSON.stringify(value)}`;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('JSON number is not finite.');
    return `${JSON.stringify(value)}`;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!value || typeof value !== 'object') {
    throw new TypeError('Value is not a plain JSON object.');
  }
  const record = value as UnknownRecord;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

export function legacyDigest(turns: readonly unknown[]): string {
  return sha256(Buffer.from(canonicalJson(turns), 'utf8'));
}

export function isPlainObject(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function field(value: unknown, key: string): unknown {
  return isPlainObject(value) ? value[key] : undefined;
}

export function assertPlainObject(value: unknown, label: string): UnknownRecord {
  if (!isPlainObject(value)) throw publicError(`The capture ${label} is invalid.`);
  return value;
}

export function assertExactKeys(
  value: UnknownRecord,
  keys: readonly string[],
  label: string,
): UnknownRecord {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw publicError(`The capture ${label} has unsupported or missing fields.`);
  }
  return value;
}

export function assertAllowedKeys(
  value: UnknownRecord,
  allowed: readonly string[],
  label: string,
): UnknownRecord {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw publicError(`The capture ${label} has unsupported fields.`);
  }
  return value;
}

export interface TextOptions {
  min?: number;
  max?: number;
  trim?: boolean;
}

export function text(
  value: unknown,
  label: string,
  { min = 0, max = Number.MAX_SAFE_INTEGER, trim = true }: TextOptions = {},
): string {
  if (typeof value !== 'string') throw publicError(`The capture ${label} must be text.`);
  const normalized = trim ? value.trim() : value;
  const length = Array.from(normalized).length;
  if (length < min || length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(normalized)) {
    throw publicError(`The capture ${label} has an invalid length or characters.`);
  }
  return normalized;
}

export function optionalText(
  value: unknown,
  label: string,
  options?: TextOptions,
): string {
  if (value === undefined || value === null) return '';
  return text(value, label, options);
}

export interface IntegerOptions {
  min?: number;
  max?: number;
}

export function integer(
  value: unknown,
  label: string,
  { min = 0, max = Number.MAX_SAFE_INTEGER }: IntegerOptions = {},
): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw publicError(`The capture ${label} is not a valid integer.`);
  }
  return value;
}

export function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw publicError(`The capture ${label} is not a valid boolean.`);
  return value;
}

export function uuid(value: unknown, label: string): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw publicError(`The capture ${label} is not a valid UUID.`);
  }
  return value.toLowerCase();
}

export function nullableUuid(value: unknown, label: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  return uuid(value, label);
}

export interface TimestampOptions {
  nullable?: boolean;
}

export function timestamp(value: unknown, label: string): string;
export function timestamp(
  value: unknown,
  label: string,
  options: { nullable: true },
): string | null;
export function timestamp(
  value: unknown,
  label: string,
  { nullable = false }: TimestampOptions = {},
): string | null {
  if (value === null || value === undefined || value === '') {
    if (nullable) return null;
    throw publicError(`The capture ${label} is missing.`);
  }
  if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime())) {
    throw publicError(`The capture ${label} is not a valid timestamp.`);
  }
  return value;
}

export function nullableTimestamp(value: unknown, label: string): string | null {
  return timestamp(value, label, { nullable: true });
}

export function hash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !HASH_RE.test(value)) {
    throw publicError(`The capture ${label} is not a valid SHA-256 hash.`);
  }
  return value;
}

export function assertNoSensitiveKeys(value: unknown, location = 'dataset'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSensitiveKeys(item, `${location}[${index}]`));
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEY_RE.test(key)) {
      throw publicError(`The capture contains an unexpected sensitive account field at ${location}.`);
    }
    assertNoSensitiveKeys(item, `${location}.${key}`);
  }
}
