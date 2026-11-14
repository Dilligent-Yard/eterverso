import { randomBytes } from 'node:crypto';
import path from 'node:path';
import {
  SENTINEL_DATABASE,
  SENTINEL_TABLE,
  TEST_DATABASE,
  TEST_HOST,
  TEST_PROFILE,
  TEST_SERVICE,
  TEST_USER,
  deriveRunIdentity,
  parsePostgresUrl,
  sameEndpoint,
  validateRunId,
  withDatabase,
  type EndpointIdentity,
} from './identity';

export const RUN_MANIFEST_VERSION = 1;
export const RUN_PHASES = ['creating', 'ready'] as const;

export type RunPhase = (typeof RUN_PHASES)[number];

export interface RunManifest {
  version: typeof RUN_MANIFEST_VERSION;
  mode: 'isolated';
  runId: string;
  root: string;
  profile: typeof TEST_PROFILE;
  project: string;
  service: typeof TEST_SERVICE;
  container: string;
  volume: string;
  image: string;
  host: typeof TEST_HOST;
  port: number;
  database: typeof TEST_DATABASE;
  user: typeof TEST_USER;
  sentinelDatabase: typeof SENTINEL_DATABASE;
  sentinelTable: typeof SENTINEL_TABLE;
  sentinelMarker: string;
  phase: RunPhase;
  createdAt: string;
}

export interface ComposeEnvironment {
  ETERVERSO_TEST_DB_PASSWORD: string;
  ETERVERSO_TEST_DB_PORT: string;
  ETERVERSO_TEST_VOLUME: string;
  ETERVERSO_TEST_PROFILE: typeof TEST_PROFILE;
  ETERVERSO_TEST_RUN_ID: string;
}

export interface ProtectedInputs {
  root: string;
  env: Record<string, string | undefined>;
}

const PROHIBITED_ENVIRONMENT_NAMES = Object.freeze([
  'DATABASE_URL',
  'DEV_DATABASE_URL',
  'ETERVERSO_TEST_DATABASE_URL',
  'ETERVERSO_TEST_DB_PORT',
  'ETERVERSO_TEST_DB_PASSWORD',
  'PGHOST',
  'PGPORT',
  'PGUSER',
  'PGPASSWORD',
  'PGDATABASE',
  'COMPOSE_PROJECT_NAME',
  'COMPOSE_FILE',
]);

const COMPOSE_ENVIRONMENT_KEYS = Object.freeze([
  'ETERVERSO_TEST_DB_PASSWORD',
  'ETERVERSO_TEST_DB_PORT',
  'ETERVERSO_TEST_VOLUME',
  'ETERVERSO_TEST_PROFILE',
  'ETERVERSO_TEST_RUN_ID',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== 'string' || !value) throw new Error(`${label} is missing or malformed.`);
  return value;
}

function readNumber(record: Record<string, unknown>, key: string, label: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error(`${label} is missing or malformed.`);
  return value;
}

export function assertNoProhibitedInputs(
  { root, env }: ProtectedInputs,
  exists: (file: string) => boolean,
  names: readonly string[] = PROHIBITED_ENVIRONMENT_NAMES,
): void {
  if (exists(path.join(root, '.env'))) {
    throw new Error('The isolated profile refuses a root .env file; no test resource was created.');
  }
  const present = names.filter((name) => {
    const value = env[name];
    return typeof value === 'string' && value.length > 0;
  });
  if (present.length > 0) {
    throw new Error(`The isolated profile refuses inherited local database environment: ${present.join(', ')}. No test resource was created.`);
  }
}

export function buildRunManifest(input: {
  runId: string;
  root: string;
  port: number;
  image?: string;
  createdAt?: string;
  sentinelMarker?: string;
}): RunManifest {
  const identity = deriveRunIdentity(input.runId);
  if (!Number.isInteger(input.port) || input.port < 1024 || input.port > 65535) {
    throw new Error('The isolated run port must be an unprivileged loopback port.');
  }
  return {
    version: RUN_MANIFEST_VERSION,
    mode: 'isolated',
    runId: identity.runId,
    root: path.resolve(input.root),
    profile: identity.profile,
    project: identity.project,
    service: identity.service,
    container: identity.container,
    volume: identity.volume,
    image: input.image ?? 'postgres:17-alpine',
    host: TEST_HOST,
    port: input.port,
    database: TEST_DATABASE,
    user: TEST_USER,
    sentinelDatabase: SENTINEL_DATABASE,
    sentinelTable: SENTINEL_TABLE,
    sentinelMarker: input.sentinelMarker ?? randomBytes(16).toString('hex'),
    phase: 'creating',
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

export function validateRunManifest(
  value: unknown,
  expected: { root: string; runId?: string; phase?: RunPhase },
): RunManifest {
  if (!isRecord(value)) throw new Error('Run manifest is missing or malformed; refusing to use partial state.');
  const version = readNumber(value, 'version', 'Run manifest version');
  if (version !== RUN_MANIFEST_VERSION) throw new Error('Run manifest version is not supported.');
  if (value.mode !== 'isolated') throw new Error('Run manifest does not describe the isolated profile.');
  const runId = validateRunId(readString(value, 'runId', 'Run manifest run ID'));
  if (expected.runId !== undefined && runId !== validateRunId(expected.runId)) {
    throw new Error('Run manifest belongs to a different run identity; refusing cross-run use.');
  }
  const identity = deriveRunIdentity(runId);
  const root = readString(value, 'root', 'Run manifest root');
  if (path.resolve(root) !== path.resolve(expected.root)) {
    throw new Error('Run manifest belongs to a different worktree or artifact; refusing cross-root use.');
  }
  if (value.profile !== identity.profile || value.project !== identity.project
      || value.service !== identity.service || value.container !== identity.container
      || value.volume !== identity.volume) {
    throw new Error('Run manifest Compose identity does not match its run ID.');
  }
  const host = readString(value, 'host', 'Run manifest host');
  if (host !== TEST_HOST) throw new Error('Run manifest host must be 127.0.0.1.');
  const port = readNumber(value, 'port', 'Run manifest port');
  if (port < 1024 || port > 65535) throw new Error('Run manifest port is outside the allowed range.');
  if (value.database !== TEST_DATABASE || value.user !== TEST_USER) {
    throw new Error('Run manifest database or user marker is not the exact isolated test identity.');
  }
  if (value.sentinelDatabase !== SENTINEL_DATABASE) {
    throw new Error('Run manifest sentinel database must be distinct and exact.');
  }
  if (value.sentinelTable !== SENTINEL_TABLE) throw new Error('Run manifest sentinel table marker is unexpected.');
  const marker = readString(value, 'sentinelMarker', 'Run manifest sentinel marker');
  if (!/^[a-f0-9]{32}$/u.test(marker)) throw new Error('Run manifest sentinel marker is malformed.');
  const phase = readString(value, 'phase', 'Run manifest phase');
  if (!RUN_PHASES.includes(phase as RunPhase)) throw new Error('Run manifest phase is malformed.');
  if (expected.phase !== undefined && phase !== expected.phase) {
    throw new Error(`Run manifest phase must be ${expected.phase}; refusing partially written state.`);
  }
  const createdAt = readString(value, 'createdAt', 'Run manifest creation time');
  if (Number.isNaN(Date.parse(createdAt))) throw new Error('Run manifest creation time is malformed.');
  const image = readString(value, 'image', 'Run manifest image');
  if (!image.startsWith('postgres:17')) throw new Error('Run manifest image is not PostgreSQL 17.');
  return {
    version: RUN_MANIFEST_VERSION,
    mode: 'isolated',
    runId,
    root: path.resolve(root),
    profile: identity.profile,
    project: identity.project,
    service: identity.service,
    container: identity.container,
    volume: identity.volume,
    image,
    host: TEST_HOST,
    port,
    database: TEST_DATABASE,
    user: TEST_USER,
    sentinelDatabase: SENTINEL_DATABASE,
    sentinelTable: SENTINEL_TABLE,
    sentinelMarker: marker,
    phase: phase as RunPhase,
    createdAt,
  };
}

function parseKeyValueFile(text: string, label: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.replace(/\r\n/gu, '\n').split('\n')) {
    if (!line.trim()) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) throw new Error(`${label} contains a malformed line.`);
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (!/^[A-Z0-9_]+$/u.test(key)) throw new Error(`${label} contains an unexpected key.`);
    if (key in result) throw new Error(`${label} repeats a key.`);
    result[key] = value;
  }
  return result;
}

export function buildComposeEnvironment(manifest: RunManifest, password: string): ComposeEnvironment {
  if (!/^[a-f0-9]{64}$/u.test(password)) throw new Error('Generated test password is malformed.');
  return {
    ETERVERSO_TEST_DB_PASSWORD: password,
    ETERVERSO_TEST_DB_PORT: String(manifest.port),
    ETERVERSO_TEST_VOLUME: manifest.volume,
    ETERVERSO_TEST_PROFILE: manifest.profile,
    ETERVERSO_TEST_RUN_ID: manifest.runId,
  };
}

export function serializeComposeEnvironment(environment: ComposeEnvironment): string {
  return `${COMPOSE_ENVIRONMENT_KEYS.map((key) => `${key}=${environment[key as keyof ComposeEnvironment]}`).join('\n')}\n`;
}

export function parseComposeEnvironment(text: string, manifest: RunManifest): ComposeEnvironment {
  const parsed = parseKeyValueFile(text, 'Compose environment');
  const keys = Object.keys(parsed).sort();
  const expectedKeys = [...COMPOSE_ENVIRONMENT_KEYS].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) {
    throw new Error('Compose environment has missing or unexpected keys; refusing partial state.');
  }
  const password = parsed.ETERVERSO_TEST_DB_PASSWORD;
  if (typeof password !== 'string' || !/^[a-f0-9]{64}$/u.test(password)) {
    throw new Error('Compose environment password is malformed.');
  }
  if (Number(parsed.ETERVERSO_TEST_DB_PORT) !== manifest.port) {
    throw new Error('Compose environment port does not match the run manifest.');
  }
  if (parsed.ETERVERSO_TEST_VOLUME !== manifest.volume
      || parsed.ETERVERSO_TEST_PROFILE !== manifest.profile
      || parsed.ETERVERSO_TEST_RUN_ID !== manifest.runId) {
    throw new Error('Compose environment identity does not match the run manifest.');
  }
  return {
    ETERVERSO_TEST_DB_PASSWORD: password,
    ETERVERSO_TEST_DB_PORT: String(manifest.port),
    ETERVERSO_TEST_VOLUME: manifest.volume,
    ETERVERSO_TEST_PROFILE: TEST_PROFILE,
    ETERVERSO_TEST_RUN_ID: manifest.runId,
  };
}

export function serializeConnectionEnvironment(databaseUrl: string): string {
  return `ETERVERSO_TEST_DATABASE_URL=${databaseUrl}\n`;
}

export function parseConnectionEnvironment(text: string, manifest: RunManifest): EndpointIdentity {
  const parsed = parseKeyValueFile(text, 'Connection environment');
  const keys = Object.keys(parsed);
  if (keys.length !== 1 || keys[0] !== 'ETERVERSO_TEST_DATABASE_URL') {
    throw new Error('Connection environment has missing or unexpected keys; refusing partial state.');
  }
  const endpoint = parsePostgresUrl(parsed.ETERVERSO_TEST_DATABASE_URL, 'Recorded isolated test URL');
  if (endpoint.host !== manifest.host || endpoint.port !== manifest.port
      || endpoint.database !== manifest.database || endpoint.username !== manifest.user) {
    throw new Error('Recorded connection identity does not match the run manifest.');
  }
  const connectedDatabase: string = endpoint.database;
  if (connectedDatabase === manifest.sentinelDatabase) {
    throw new Error('Recorded test connection points at the sentinel database.');
  }
  return endpoint;
}

export function sentinelUrlFor(databaseUrl: string, manifest: RunManifest): string {
  const endpoint = parsePostgresUrl(databaseUrl, 'Isolated test database URL');
  if (endpoint.database !== manifest.database) {
    throw new Error('Cannot derive the sentinel URL from a non-application test target.');
  }
  const sentinel = withDatabase(databaseUrl, manifest.sentinelDatabase);
  const sentinelEndpoint = parsePostgresUrl(sentinel, 'Isolated sentinel URL');
  if (sameEndpoint(endpoint, sentinelEndpoint)) {
    throw new Error('The sentinel database must not resolve to the application test database.');
  }
  return sentinel;
}

export function assertPrivateMode(mode: number, label: string): void {
  if ((mode & 0o077) !== 0) {
    throw new Error(`${label} permissions are too broad; refusing to use potentially exposed state.`);
  }
}
