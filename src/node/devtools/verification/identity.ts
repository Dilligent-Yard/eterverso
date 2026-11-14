import { randomBytes } from 'node:crypto';

export const TEST_DATABASE = 'eterverso_test';
export const TEST_USER = 'eterverso_test';
export const SENTINEL_DATABASE = 'eterverso_test_sentinel';
export const SENTINEL_TABLE = 'verification_sentinel';
export const TEST_SERVICE = 'db';
export const TEST_PROFILE = 'isolated';
export const TEST_PURPOSE = 'isolated-test';
export const TEST_HOST = '127.0.0.1';

const RUN_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/u;

export interface RunIdentity {
  runId: string;
  project: string;
  service: typeof TEST_SERVICE;
  container: string;
  volume: string;
  network: string;
  profile: typeof TEST_PROFILE;
}

export interface EndpointIdentity {
  protocol: 'postgres:';
  host: string;
  port: number;
  database: string;
  username: string;
  password: string | null;
}

export interface ServicePortBinding {
  HostIp?: string;
  HostPort?: string;
}

export interface ServiceInspection {
  Name?: unknown;
  State?: unknown;
  Config?: unknown;
  NetworkSettings?: unknown;
}

export interface ServiceExpectation {
  container: string;
  project: string;
  runId: string;
  port: number;
  imagePrefix?: string;
}

export interface TargetExpectation {
  host: string;
  port: number;
  database: string;
  user: string;
  sentinelDatabase: string;
  project?: string;
  service?: string;
  runId?: string;
}

export interface TargetRecord {
  host: string;
  port: number;
  database: string;
  user: string;
  project: string;
  service: string;
  runId: string;
  sentinelDatabase: string;
}

export interface ScratchNameKind {
  readonly readiness: RegExp;
  readonly migration: RegExp;
  readonly refusal: RegExp;
  readonly rollback: RegExp;
  readonly restore: RegExp;
}

export const SCRATCH_NAME_PATTERNS: ScratchNameKind = Object.freeze({
  readiness: /^eterverso_test_ready_[a-f0-9]{16}$/u,
  migration: /^eterverso_test_mig02s_[a-f0-9]{16}$/u,
  refusal: /^eterverso_test_mig03_[a-f0-9]{16}$/u,
  rollback: /^eterverso_test_rollback_[a-f0-9]{16}$/u,
  restore: /^eterverso_test_restore_[a-f0-9]{16}$/u,
});

export type ScratchKind = keyof ScratchNameKind;

export function validateRunId(value: unknown): string {
  if (typeof value !== 'string' || !RUN_ID_PATTERN.test(value)) {
    throw new Error('Run ID must be 1-32 lowercase alphanumeric or hyphen characters, starting and ending with an alphanumeric character.');
  }
  return value;
}

export function deriveRunIdentity(runId: string): RunIdentity {
  const id = validateRunId(runId);
  const project = `eterverso-wm-${id}`;
  return {
    runId: id,
    project,
    service: TEST_SERVICE,
    container: `/${project}-${TEST_SERVICE}-1`,
    volume: `${project}-test-data`,
    network: `${project}_default`,
    profile: TEST_PROFILE,
  };
}

function normalizeHost(hostname: string): string {
  const normalized = hostname.toLowerCase();
  if (normalized === 'localhost' || normalized === '[::1]' || normalized === '::1') return TEST_HOST;
  return normalized;
}

function decodeUrlPart(value: string, label: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error(`${label} contains invalid URL escaping.`);
  }
}

export function parsePostgresUrl(value: unknown, label = 'database URL'): EndpointIdentity {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is required; refusing to use an implicit database default.`);
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid PostgreSQL URL.`);
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error(`${label} must use the PostgreSQL protocol.`);
  }
  if (!parsed.hostname) throw new Error(`${label} must name a host.`);
  const port = parsed.port ? Number(parsed.port) : 5432;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${label} has an invalid port.`);
  }
  const database = decodeUrlPart(parsed.pathname.slice(1), label);
  const username = decodeUrlPart(parsed.username, label);
  const password = parsed.password ? decodeUrlPart(parsed.password, label) : null;
  if (!database) throw new Error(`${label} must name a database.`);
  if (!username) throw new Error(`${label} must name a user.`);
  return {
    protocol: 'postgres:',
    host: normalizeHost(parsed.hostname),
    port,
    database,
    username,
    password,
  };
}

export function withDatabase(url: string, database: string): string {
  if (typeof database !== 'string' || !/^[a-z][a-z0-9_]{0,62}$/u.test(database)) {
    throw new Error('Refusing to build a URL for an unvalidated database name.');
  }
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

export function sameEndpoint(left: EndpointIdentity, right: EndpointIdentity): boolean {
  return left.host === right.host && left.port === right.port && left.database === right.database;
}

export function sameTarget(left: EndpointIdentity, right: EndpointIdentity): boolean {
  return sameEndpoint(left, right) && left.username === right.username;
}

export function assertProhibitedEndpoint(
  target: EndpointIdentity,
  prohibited: readonly EndpointIdentity[],
  label: string,
): void {
  for (const candidate of prohibited) {
    if (sameEndpoint(target, candidate)) {
      throw new Error(`The selected database endpoint resolves to ${label}; credentials or URL spelling do not make it a separate target.`);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} is missing or malformed.`);
  return value;
}

function readString(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== 'string' || !value) throw new Error(`${label} is missing or malformed.`);
  return value;
}

export function assertServiceOwnership(service: ServiceInspection, expected: ServiceExpectation): void {
  const name = service.Name;
  if (name !== expected.container) {
    throw new Error(`Container name must be ${expected.container}; refusing to claim an unexpected service.`);
  }
  const config = readRecord(service.Config, 'Container configuration');
  const labels = readRecord(config.Labels, 'Container labels');
  const expectedLabels: Record<string, string> = {
    'com.docker.compose.project': expected.project,
    'com.docker.compose.service': TEST_SERVICE,
    'io.eterverso.purpose': TEST_PURPOSE,
    'io.eterverso.profile': TEST_PROFILE,
    'io.eterverso.run': expected.runId,
  };
  for (const [key, value] of Object.entries(expectedLabels)) {
    if (labels[key] !== value) {
      throw new Error(`Container ownership label ${key} does not match this run; refusing to adopt it.`);
    }
  }
  const image = readString(config, 'Image', 'Container image');
  const imagePrefix = expected.imagePrefix ?? 'postgres:17';
  if (!image.startsWith(imagePrefix)) {
    throw new Error(`Container image must be PostgreSQL 17 (${imagePrefix}); found an unexpected image.`);
  }
}

export function assertServiceIdentity(service: ServiceInspection, expected: ServiceExpectation): void {
  assertServiceOwnership(service, expected);
  const state = readRecord(service.State, 'Container state');
  if (state.Running !== true) {
    throw new Error('The owned isolated PostgreSQL service is not running.');
  }
  const network = readRecord(service.NetworkSettings, 'Container network settings');
  const ports = readRecord(network.Ports, 'Container port bindings');
  const bindings = ports['5432/tcp'];
  if (!Array.isArray(bindings)) throw new Error('PostgreSQL container has no recorded port binding.');
  const matching = bindings.some((binding: unknown) => {
    if (!isRecord(binding)) return false;
    return binding.HostIp === TEST_HOST
      && typeof binding.HostPort === 'string'
      && Number(binding.HostPort) === expected.port;
  });
  if (!matching) {
    throw new Error('PostgreSQL container is not bound to the recorded loopback port.');
  }
}

export function assertIsolatedTarget(input: {
  databaseUrl: unknown;
  expected: TargetExpectation;
  prohibitedUrls?: readonly { url: EndpointIdentity; label: string }[];
  service?: ServiceInspection;
}): TargetRecord {
  const target = parsePostgresUrl(input.databaseUrl, 'Isolated test database URL');
  const expected = input.expected;
  if (target.host !== TEST_HOST) {
    throw new Error('The isolated test database must be reached through 127.0.0.1.');
  }
  if (target.port !== expected.port) {
    throw new Error('The isolated test database port does not match the recorded run state.');
  }
  if (target.database !== expected.database || expected.database !== TEST_DATABASE) {
    throw new Error('The isolated application test database name does not match its marker.');
  }
  if (target.username !== expected.user || expected.user !== TEST_USER) {
    throw new Error('The isolated test database user does not match its marker.');
  }
  if (expected.sentinelDatabase === expected.database || expected.sentinelDatabase !== SENTINEL_DATABASE) {
    throw new Error('The isolated sentinel database must be distinct from the application test database.');
  }
  for (const prohibited of input.prohibitedUrls ?? []) {
    assertProhibitedEndpoint(target, [prohibited.url], prohibited.label);
  }
  if (input.service) {
    if (!expected.project || !expected.runId || !expected.service) {
      throw new Error('Service validation requires a recorded project, service and run identity.');
    }
    assertServiceIdentity(input.service, {
      container: `/${expected.project}-${expected.service}-1`,
      project: expected.project,
      runId: expected.runId,
      port: expected.port,
      imagePrefix: 'postgres:17',
    });
  }
  return {
    host: target.host,
    port: target.port,
    database: target.database,
    user: target.username,
    project: expected.project ?? '',
    service: expected.service ?? '',
    runId: expected.runId ?? '',
    sentinelDatabase: expected.sentinelDatabase,
  };
}

export function scratchDatabaseName(kind: ScratchKind, suffix = randomBytes(8).toString('hex')): string {
  const pattern = SCRATCH_NAME_PATTERNS[kind];
  const prefix: Record<ScratchKind, string> = {
    readiness: 'eterverso_test_ready_',
    migration: 'eterverso_test_mig02s_',
    refusal: 'eterverso_test_mig03_',
    rollback: 'eterverso_test_rollback_',
    restore: 'eterverso_test_restore_',
  };
  if (!/^[a-f0-9]{16}$/u.test(suffix)) throw new Error('Invalid scratch database suffix.');
  const name = `${prefix[kind]}${suffix}`;
  if (!pattern.test(name)) throw new Error('Generated scratch database name failed its guard.');
  return name;
}

export function assertScratchDatabaseName(kind: ScratchKind, name: unknown): string {
  if (typeof name !== 'string' || !SCRATCH_NAME_PATTERNS[kind].test(name)) {
    throw new Error(`Refusing to use a database outside the generated ${kind} scratch-name pattern.`);
  }
  return name;
}

export function assertGeneratedScratchDatabaseName(name: unknown): string {
  if (typeof name !== 'string') {
    throw new Error('Refusing to use a non-string database name as an isolated scratch target.');
  }
  const matches = (Object.keys(SCRATCH_NAME_PATTERNS) as ScratchKind[])
    .some((kind) => SCRATCH_NAME_PATTERNS[kind].test(name));
  if (!matches) {
    throw new Error('Refusing to use a database outside the generated isolated scratch-name patterns.');
  }
  return name;
}

export function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}
