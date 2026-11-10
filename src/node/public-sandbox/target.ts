import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import type { Stats } from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import dotenv from 'dotenv';

const ROOT = path.resolve(__dirname, '..', '..', '..');

export interface SandboxDefinition {
  readonly PROJECT: string;
  readonly SERVICE: string;
  readonly CONTAINER: string;
  readonly VOLUME: string;
  readonly DATABASE: string;
  readonly ROLE: string;
  readonly HOST: string;
  readonly DB_PORT: number;
  readonly CONTAINER_DB_PORT: number;
  readonly APP_PORT: number;
  readonly PURPOSE: string;
  readonly PURPOSE_LABEL: string;
  readonly IMAGE: string;
  readonly STATE_DIR: string;
  readonly COMPOSE_FILE: string;
  readonly CREDENTIALS_FILE: string;
  readonly SERVICE_FILE: string;
  readonly TESTERS_FILE: string;
  readonly REPORTS_DIR: string;
}

export const SANDBOX: SandboxDefinition = Object.freeze({
  PROJECT: 'eterverso-public-sandbox',
  SERVICE: 'db',
  CONTAINER: '/eterverso-public-sandbox-db-1',
  VOLUME: 'eterverso-public-sandbox-data',
  DATABASE: 'eterverso_public_sandbox',
  ROLE: 'eterverso_sandbox',
  HOST: '127.0.0.1',
  DB_PORT: 55434,
  CONTAINER_DB_PORT: 5432,
  APP_PORT: 3001,
  PURPOSE: 'public-sandbox',
  PURPOSE_LABEL: 'io.eterverso.purpose',
  IMAGE: 'postgres:17-alpine',
  STATE_DIR: path.join(ROOT, '.local', 'public-sandbox'),
  COMPOSE_FILE: path.join(ROOT, 'compose.sandbox.yaml'),
  CREDENTIALS_FILE: 'credentials.env',
  SERVICE_FILE: 'service.json',
  TESTERS_FILE: 'testers.env',
  REPORTS_DIR: 'reports',
});

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
export const HASH_RE = /^[a-f0-9]{64}$/u;
const MAX_PRIVATE_FILE_BYTES = 64 * 1024;

export type UnknownRecord = Record<string, unknown>;

export interface PublicError extends Error {
  safeToPrint: true;
}

export interface ServiceRecord {
  project: string;
  service: string;
  container: string;
  volume: string;
  database: string;
  role: string;
  host: string;
  port: number;
  appPort: number;
  purpose: string;
  instanceId: string;
  createdAt: string;
}

export interface SandboxCredentials {
  databaseUrl: string;
  password: string;
  sessionSecret: string;
}

export interface DsnIdentity {
  database: string;
  role: string;
  host: string;
  port: number;
  password: string;
}

export interface ContainerOwnership {
  container: string;
  volume: string;
  project: string;
  service: string;
}

export interface VolumeOwnership {
  volume: string;
}

export interface SandboxTarget {
  project: string;
  service: string;
  container: string;
  volume: string;
  database: string;
  role: string;
  host: string;
  port: number;
  containerPort: number;
  appPort: number;
  instanceId: string;
  databaseUrl: string;
  sessionSecret: string;
  ownership: ContainerOwnership & VolumeOwnership;
  containerAddresses: string[];
  running: boolean;
}

export interface ConnectedIdentityTarget {
  database: string;
  role: string;
  containerAddresses?: readonly unknown[];
}

export interface ConnectedIdentity {
  database: string;
  role: string;
  address: string;
  port: number;
  version: number;
}

/**
 * Minimal callable contract for the injected `postgres` client. Only the tagged
 * template query form used by the identity check is required.
 */
export interface SandboxSql {
  <Row extends Record<string, unknown> = UnknownRecord>(
    strings: TemplateStringsArray,
    ...values: readonly unknown[]
  ): Promise<Row[]>;
}

export interface PrivateFsConstants {
  O_NOFOLLOW?: number;
  O_RDONLY?: number;
}

export interface PrivateFs {
  constants?: PrivateFsConstants;
  lstatSync(filePath: string): Stats;
  openSync(filePath: string, flags: number): number;
  fstatSync(descriptor: number): Stats;
  readFileSync(descriptor: number): Buffer;
  closeSync(descriptor: number): void;
  existsSync(filePath: string): boolean;
  mkdirSync(directory: string, options: { recursive: true; mode: number }): string | undefined;
  chmodSync(filePath: string, mode: number): void;
  writeFileSync(
    filePath: string,
    contents: string | Uint8Array,
    options: { mode: number; flag: string },
  ): void;
  renameSync(oldPath: string, newPath: string): void;
}

export interface ExecFileOptions {
  encoding: 'utf8';
  stdio: ('ignore' | 'pipe')[];
}

export type ExecFileSyncImpl = (
  file: string,
  args: readonly string[],
  options: ExecFileOptions,
) => string;

export interface InspectContainerOptions {
  execFileSyncImpl?: ExecFileSyncImpl;
}

export interface InspectVolumeOptions {
  execFileSyncImpl?: ExecFileSyncImpl;
  volume?: string;
  allowMissing?: boolean;
}

export interface ReadServiceRecordOptions {
  root?: string;
  fsImpl?: PrivateFs;
}

export interface ReadCredentialsOptions {
  root?: string;
  fsImpl?: PrivateFs;
  record?: ServiceRecord | null;
}

export interface AssertOwnedContainerOptions {
  requireRunning?: boolean;
}

export interface ResolveSandboxTargetOptions {
  root?: string;
  fsImpl?: PrivateFs;
  execFileSyncImpl?: ExecFileSyncImpl;
  environment?: Record<string, string | undefined> | null;
  requireRunning?: boolean;
}

export interface CanListenOptions {
  port: number;
  host?: string;
  netImpl?: Pick<typeof net, 'createServer'>;
}

export interface AssertPortAvailableOptions extends CanListenOptions {
  label?: string;
}

/**
 * The original JavaScript defaulted the identity target to `SANDBOX`, which has
 * no lowercase `database`/`role` fields. Omitting the target therefore rejected
 * every populated identity row. Preserve that sentinel default; real callers
 * always pass a resolved target.
 */
const DEFAULT_IDENTITY_TARGET = SANDBOX as unknown as ConnectedIdentityTarget;

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isArrayOfUnknown(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function field(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function diagnosticText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Uint8Array) return Buffer.from(value).toString('utf8');
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return '';
}

export function publicError(message: string): PublicError {
  return Object.assign(new Error(message), { safeToPrint: true as const });
}

export function assertPrivateDirectory(
  directory: string,
  fsImpl: PrivateFs = fs,
  label = 'private sandbox state directory',
): Stats {
  let stat: Stats;
  try {
    stat = fsImpl.lstatSync(directory);
  } catch {
    throw publicError(`The ${label} is missing.`);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw publicError(`The ${label} must be a real directory.`);
  }
  if ((stat.mode & 0o077) !== 0) {
    throw publicError(`The ${label} must be readable and writable only by its owner.`);
  }
  return stat;
}

export function readPrivateFile(
  filePath: string,
  fsImpl: PrivateFs = fs,
  label = 'private sandbox file',
  maxBytes = MAX_PRIVATE_FILE_BYTES,
): Buffer {
  assertPrivateDirectory(path.dirname(filePath), fsImpl, `${label} parent directory`);
  let pathStat: Stats;
  try {
    pathStat = fsImpl.lstatSync(filePath);
  } catch {
    throw publicError(`The ${label} is missing.`);
  }
  if (pathStat.isSymbolicLink() || !pathStat.isFile()) {
    throw publicError(`The ${label} must be a regular file.`);
  }
  if ((pathStat.mode & 0o777) !== 0o600 || pathStat.size < 1 || pathStat.size > maxBytes) {
    throw publicError(`The ${label} must be a non-empty private file (mode 600).`);
  }

  const constants = fsImpl.constants || fs.constants;
  const noFollow = constants.O_NOFOLLOW;
  if (typeof noFollow !== 'number' || !Number.isInteger(noFollow)) {
    throw publicError('This runtime cannot safely read private sandbox state.');
  }
  let descriptor: number;
  try {
    descriptor = fsImpl.openSync(filePath, (constants.O_RDONLY ?? 0) | noFollow);
  } catch {
    throw publicError(`The ${label} could not be opened safely.`);
  }
  try {
    let openedStat: Stats;
    let bytes: Buffer;
    try {
      openedStat = fsImpl.fstatSync(descriptor);
      if (!openedStat.isFile() || (openedStat.mode & 0o777) !== 0o600
          || openedStat.size !== pathStat.size || openedStat.size > maxBytes
          || (pathStat.dev !== undefined && openedStat.dev !== pathStat.dev)
          || (pathStat.ino !== undefined && openedStat.ino !== pathStat.ino)) {
        throw publicError(`The ${label} changed while it was being read.`);
      }
      bytes = fsImpl.readFileSync(descriptor);
    } catch (error) {
      if (isRecord(error) && error.safeToPrint) throw error;
      throw publicError(`The ${label} could not be read safely.`);
    }
    if (bytes.length !== openedStat.size) {
      throw publicError(`The ${label} changed while it was being read.`);
    }
    return bytes;
  } finally {
    try { fsImpl.closeSync(descriptor); } catch { /* Preserve the read result. */ }
  }
}

function parseJsonFile(
  filePath: string,
  fsImpl: PrivateFs,
  label: string,
  maxBytes: number,
): UnknownRecord {
  const bytes = readPrivateFile(filePath, fsImpl, label, maxBytes);
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw publicError(`The ${label} is not valid UTF-8 JSON.`);
  }
  if (!isRecord(value)) {
    throw publicError(`The ${label} has an invalid shape.`);
  }
  return value;
}

function parseEnvFile(
  filePath: string,
  fsImpl: PrivateFs,
  label: string,
): Record<string, string> {
  const bytes = readPrivateFile(filePath, fsImpl, label, MAX_PRIVATE_FILE_BYTES);
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw publicError(`The ${label} is not valid UTF-8.`);
  }
  try {
    return dotenv.parse(text);
  } catch {
    throw publicError(`The ${label} is invalid.`);
  }
}

function assertExactKeys(
  value: UnknownRecord,
  keys: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw publicError(`The ${label} has an unsupported format.`);
  }
}

function assertTimestamp(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value || Number.isNaN(new Date(value).getTime())) {
    throw publicError(`The ${label} is invalid.`);
  }
  return value;
}

function assertServiceRecord(record: UnknownRecord): ServiceRecord {
  assertExactKeys(record, [
    'project', 'service', 'container', 'volume', 'database', 'role', 'host',
    'port', 'appPort', 'purpose', 'instanceId', 'createdAt',
  ], 'sandbox service record');
  if (record.project !== SANDBOX.PROJECT
      || record.service !== SANDBOX.SERVICE
      || record.container !== SANDBOX.CONTAINER
      || record.volume !== SANDBOX.VOLUME
      || record.database !== SANDBOX.DATABASE
      || record.role !== SANDBOX.ROLE
      || record.host !== SANDBOX.HOST
      || record.port !== SANDBOX.DB_PORT
      || record.appPort !== SANDBOX.APP_PORT
      || record.purpose !== SANDBOX.PURPOSE) {
    throw publicError('The private sandbox service record does not describe the owned public sandbox.');
  }
  const instanceId = record.instanceId;
  if (typeof instanceId !== 'string' || !UUID_RE.test(instanceId)) {
    throw publicError('The private sandbox instance marker is invalid.');
  }
  const createdAt = assertTimestamp(record.createdAt, 'private sandbox instance creation time');
  return {
    project: SANDBOX.PROJECT,
    service: SANDBOX.SERVICE,
    container: SANDBOX.CONTAINER,
    volume: SANDBOX.VOLUME,
    database: SANDBOX.DATABASE,
    role: SANDBOX.ROLE,
    host: SANDBOX.HOST,
    port: SANDBOX.DB_PORT,
    appPort: SANDBOX.APP_PORT,
    purpose: SANDBOX.PURPOSE,
    instanceId,
    createdAt,
  };
}

export function readServiceRecord(
  { root = ROOT, fsImpl = fs }: ReadServiceRecordOptions = {},
): ServiceRecord {
  const stateDirectory = path.join(root, '.local', 'public-sandbox');
  assertPrivateDirectory(stateDirectory, fsImpl);
  return assertServiceRecord(parseJsonFile(
    path.join(stateDirectory, SANDBOX.SERVICE_FILE),
    fsImpl,
    'sandbox service record',
    MAX_PRIVATE_FILE_BYTES,
  ));
}

export function assertDsnTarget(
  databaseUrl: unknown,
  expected: Pick<SandboxDefinition, 'HOST' | 'DB_PORT' | 'DATABASE' | 'ROLE'> = SANDBOX,
): DsnIdentity {
  if (typeof databaseUrl !== 'string' || !databaseUrl.trim()) {
    throw publicError('The sandbox database URL is missing.');
  }
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw publicError('The sandbox database URL is invalid.');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw publicError('The sandbox database must use PostgreSQL.');
  }
  if (parsed.hostname !== expected.HOST) {
    throw publicError('The sandbox database must be bound to the loopback host 127.0.0.1.');
  }
  if (Number(parsed.port || 5432) !== expected.DB_PORT) {
    throw publicError(`The sandbox database port must be ${expected.DB_PORT}.`);
  }
  if (parsed.search || parsed.hash) {
    throw publicError('The sandbox database URL must not carry query parameters or fragments.');
  }
  let database: string;
  let role: string;
  try {
    database = decodeURIComponent(parsed.pathname.replace(/^\//u, ''));
    role = decodeURIComponent(parsed.username);
  } catch {
    throw publicError('The sandbox database URL identity is invalid.');
  }
  if (database !== expected.DATABASE) {
    throw publicError(`The sandbox database name must be ${expected.DATABASE}.`);
  }
  if (role !== expected.ROLE) {
    throw publicError(`The sandbox database role must be ${expected.ROLE}.`);
  }
  if (!parsed.password) throw publicError('The sandbox database URL must contain its generated password.');
  if (database === 'eterverso' || database === 'eterverso_test'
      || role === 'eterverso' || role === 'eterverso_test'
      || [55432, 55433].includes(Number(parsed.port || 5432))) {
    throw publicError('The sandbox database URL matches a development or test target.');
  }
  return {
    database,
    role,
    host: parsed.hostname,
    port: Number(parsed.port || 5432),
    password: decodeURIComponent(parsed.password),
  };
}

export function assertCredentials(
  credentials: UnknownRecord,
  record?: ServiceRecord | null,
  expected: Pick<SandboxDefinition, 'HOST' | 'DB_PORT' | 'DATABASE' | 'ROLE'> = SANDBOX,
): SandboxCredentials {
  assertExactKeys(credentials, [
    'ETERVERSO_SANDBOX_DB_PASSWORD',
    'ETERVERSO_SANDBOX_DATABASE_URL',
    'ETERVERSO_SANDBOX_SESSION_SECRET',
  ], 'sandbox credentials file');
  const password = credentials.ETERVERSO_SANDBOX_DB_PASSWORD;
  if (typeof password !== 'string' || !/^[a-f0-9]{64}$/u.test(password)) {
    throw publicError('The generated sandbox database password is invalid; refusing to use it.');
  }
  const databaseUrl = credentials.ETERVERSO_SANDBOX_DATABASE_URL;
  if (typeof databaseUrl !== 'string' || !databaseUrl.trim()) {
    throw publicError('The sandbox database URL is missing.');
  }
  const identity = assertDsnTarget(databaseUrl, expected);
  if (identity.password !== password) {
    throw publicError('The sandbox database URL does not match its generated password.');
  }
  const sessionSecret = credentials.ETERVERSO_SANDBOX_SESSION_SECRET;
  if (typeof sessionSecret !== 'string' || sessionSecret.length < 32
      || sessionSecret.length > 256 || !/^[A-Za-z0-9_-]+$/u.test(sessionSecret)) {
    throw publicError('The independent sandbox session secret is invalid.');
  }
  if (record && (record.database !== identity.database || record.role !== identity.role
      || record.port !== identity.port || record.host !== identity.host)) {
    throw publicError('The sandbox credentials do not match the private instance record.');
  }
  return {
    databaseUrl,
    password,
    sessionSecret,
  };
}

export function readCredentials(
  { root = ROOT, fsImpl = fs, record }: ReadCredentialsOptions = {},
): SandboxCredentials {
  const stateDirectory = path.join(root, '.local', 'public-sandbox');
  assertPrivateDirectory(stateDirectory, fsImpl);
  return assertCredentials(parseEnvFile(
    path.join(stateDirectory, SANDBOX.CREDENTIALS_FILE),
    fsImpl,
    'sandbox credentials file',
  ), record);
}

export function assertNoInheritedDatabaseUrl(
  environment: Record<string, string | undefined> | null | undefined = process.env,
): void {
  if (environment && Object.hasOwn(environment, 'DATABASE_URL')) {
    throw publicError('DATABASE_URL is inherited in the environment; the public sandbox refuses an ambient database target.');
  }
}

export function inspectContainer(
  { execFileSyncImpl = execFileSync }: InspectContainerOptions = {},
): unknown {
  try {
    const output = execFileSyncImpl('docker', ['inspect', SANDBOX.CONTAINER], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const parsed: unknown = JSON.parse(output);
    return isArrayOfUnknown(parsed) && parsed.length === 1 ? parsed[0] : null;
  } catch {
    return null;
  }
}

export function inspectVolume({
  execFileSyncImpl = execFileSync,
  volume = SANDBOX.VOLUME,
  allowMissing = false,
}: InspectVolumeOptions = {}): unknown {
  try {
    const output = execFileSyncImpl('docker', ['volume', 'inspect', volume], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const parsed: unknown = JSON.parse(output);
    return isArrayOfUnknown(parsed) && parsed.length === 1 ? parsed[0] : null;
  } catch (error) {
    if (allowMissing) {
      const stderr = diagnosticText(field(error, 'stderr'));
      const stdoutValue = field(error, 'stdout');
      const stdout = typeof stdoutValue === 'string' ? stdoutValue.trim() : '';
      if (stdout === '[]' || /no such volume/iu.test(stderr)) return null;
      throw publicError('The public sandbox volume could not be inspected; refusing to assume it is absent.');
    }
    return null;
  }
}

// Docker publishes 127.0.0.1:55434 -> container:5432. For a running container
// the runtime table reports the published mapping; for a stopped container
// Docker clears NetworkSettings.Ports and only HostConfig.PortBindings remains.
// The host binding proves the owned published address in both states, while the
// runtime table is an additional running-state check.
function assertOwnedPortBindings(
  bindings: unknown,
  expected: Pick<SandboxDefinition, 'HOST' | 'DB_PORT'>,
  source: 'runtime' | 'host',
): void {
  const label = source === 'runtime' ? 'running container' : 'container host';
  if (!isArrayOfUnknown(bindings) || bindings.length === 0) {
    throw publicError(`The ${label} does not publish the owned loopback sandbox port.`);
  }
  const ownsPort = bindings.every((binding) => (
    field(binding, 'HostIp') === expected.HOST
      && Number(field(binding, 'HostPort')) === expected.DB_PORT
  ));
  if (!ownsPort) {
    throw publicError(`The ${label} port binding does not match the owned loopback sandbox port ${expected.HOST}:${expected.DB_PORT}.`);
  }
}

function containerIsRunning(container: unknown): boolean {
  const state = field(container, 'State');
  return isRecord(state) && state.Running === true;
}

export function assertOwnedContainer(
  container: unknown,
  expected: SandboxDefinition = SANDBOX,
  { requireRunning = true }: AssertOwnedContainerOptions = {},
): ContainerOwnership {
  if (!container) {
    throw publicError('The owned public sandbox container is not present; run provision first.');
  }
  if (field(container, 'Name') !== expected.CONTAINER) {
    throw publicError('The public sandbox container name does not match the owned project.');
  }
  if (requireRunning && !containerIsRunning(container)) {
    throw publicError('The owned public sandbox container is not running.');
  }
  const config = field(container, 'Config');
  const labelsValue = field(config, 'Labels');
  const labels = isRecord(labelsValue) ? labelsValue : {};
  if (labels['com.docker.compose.project'] !== expected.PROJECT
      || labels['com.docker.compose.service'] !== expected.SERVICE
      || labels[expected.PURPOSE_LABEL] !== expected.PURPOSE) {
    throw publicError('The PostgreSQL container ownership labels do not match the public sandbox project.');
  }
  const image = field(config, 'Image');
  if (image !== expected.IMAGE && !diagnosticText(image).startsWith(`${expected.IMAGE}@`)) {
    throw publicError('The owned container does not use the expected PostgreSQL 17 image.');
  }
  const mountsValue = field(container, 'Mounts');
  const mounts = isArrayOfUnknown(mountsValue) ? mountsValue : [];
  const dataMount = mounts.find((mount) => field(mount, 'Destination') === '/var/lib/postgresql/data');
  if (!dataMount || field(dataMount, 'Type') !== 'volume' || field(dataMount, 'Name') !== expected.VOLUME) {
    throw publicError('The container does not mount the owned public sandbox volume; refusing an unrelated volume.');
  }
  const publishKey = `${expected.CONTAINER_DB_PORT}/tcp`;
  const hostConfig = field(container, 'HostConfig');
  const hostBindingsValue = field(hostConfig, 'PortBindings');
  const hostBindings = isRecord(hostBindingsValue) ? hostBindingsValue : {};
  const hostKeys = Object.keys(hostBindings);
  if (hostKeys.length !== 1 || hostKeys[0] !== publishKey) {
    throw publicError('The container host port bindings do not match the owned loopback sandbox port.');
  }
  assertOwnedPortBindings(hostBindings[publishKey], expected, 'host');
  if (requireRunning) {
    const networkSettings = field(container, 'NetworkSettings');
    const runtimePorts = field(networkSettings, 'Ports');
    const runtimeBindings = isRecord(runtimePorts) ? runtimePorts[publishKey] : undefined;
    assertOwnedPortBindings(runtimeBindings, expected, 'runtime');
  }
  return {
    container: expected.CONTAINER,
    volume: expected.VOLUME,
    project: expected.PROJECT,
    service: expected.SERVICE,
  };
}

// The volume mount name alone can be reused by an unrelated volume. Compose
// labels the owned volume with io.eterverso.purpose=public-sandbox; verify that
// read-only label when the runtime exposes it and refuse rather than assuming.
export function assertOwnedVolume(
  volume: unknown,
  expected: Pick<SandboxDefinition, 'VOLUME' | 'PURPOSE_LABEL' | 'PURPOSE'> = SANDBOX,
): VolumeOwnership {
  if (!volume) {
    throw publicError('The owned public sandbox volume could not be inspected; refusing to assume volume ownership.');
  }
  if (field(volume, 'Name') !== expected.VOLUME) {
    throw publicError('The inspected volume is not the owned public sandbox volume; refusing an unrelated volume.');
  }
  const labelsValue = field(volume, 'Labels');
  const labels = isRecord(labelsValue) ? labelsValue : {};
  if (labels[expected.PURPOSE_LABEL] !== expected.PURPOSE) {
    throw publicError('The owned public sandbox volume is missing its ownership purpose label; refusing an unrelated volume.');
  }
  return { volume: expected.VOLUME };
}

function normalizeServerAddress(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const addressPart = value.trim().split('/')[0] ?? '';
  const address = addressPart.split('%')[0] ?? '';
  return net.isIP(address) ? address : null;
}

// PostgreSQL reports the address of the socket that accepted the connection:
// for a published Compose port this is the container-network address, not the
// host's 127.0.0.1. Accept only loopback, RFC1918, link-local, and IPv6 ULA or
// link-local address space when inspecting the connected server.
function isPrivateServerAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) {
    const octets = address.split('.').map(Number);
    const first = octets[0] ?? -1;
    const second = octets[1] ?? -1;
    return first === 10
      || first === 127
      || (first === 172 && second >= 16 && second <= 31)
      || (first === 192 && second === 168)
      || (first === 169 && second === 254);
  }
  if (family === 6) {
    const lower = address.toLowerCase();
    if (lower === '::1') return true;
    if (lower.startsWith('::ffff:')) {
      const mapped = lower.slice('::ffff:'.length);
      return net.isIP(mapped) === 4 && isPrivateServerAddress(mapped);
    }
    const first = lower.split(':')[0];
    if (!first) return false;
    const hextet = Number.parseInt(first.padEnd(4, '0'), 16);
    return (hextet & 0xfe00) === 0xfc00 || (hextet & 0xffc0) === 0xfe80;
  }
  return false;
}

function containerNetworkAddresses(container: unknown): string[] {
  const addresses = new Set<string>();
  const add = (value: unknown): void => {
    const address = normalizeServerAddress(value);
    if (address) addresses.add(address);
  };
  const networkSettings = field(container, 'NetworkSettings');
  add(field(networkSettings, 'IPAddress'));
  add(field(networkSettings, 'GlobalIPv6Address'));
  const networks = field(networkSettings, 'Networks');
  if (networks !== null && typeof networks === 'object') {
    for (const network of Object.values(networks) as unknown[]) {
      add(field(network, 'IPAddress'));
      add(field(network, 'GlobalIPv6Address'));
    }
  }
  return [...addresses];
}

export function assertConnectedIdentityRow(
  row: unknown,
  target: ConnectedIdentityTarget = DEFAULT_IDENTITY_TARGET,
): ConnectedIdentity {
  if (!row || typeof row !== 'object') {
    throw publicError('The sandbox database identity could not be read.');
  }
  if (field(row, 'database') !== target.database) {
    throw publicError('The connected database does not match the owned public sandbox.');
  }
  if (field(row, 'role') !== target.role) {
    throw publicError('The connected database role does not match the owned public sandbox.');
  }
  const address = normalizeServerAddress(field(row, 'address'));
  if (!address) {
    throw publicError('The sandbox database server address could not be verified.');
  }
  if (!isPrivateServerAddress(address)) {
    throw publicError('The connected database server address is not a private or container-network address; refusing a remote target.');
  }
  const expectedAddresses = isArrayOfUnknown(target.containerAddresses)
    ? target.containerAddresses
      .map(normalizeServerAddress)
      .filter((value): value is string => value !== null)
    : [];
  if (expectedAddresses.length && !expectedAddresses.includes(address)) {
    throw publicError('The connected database server address does not match the owned sandbox container network.');
  }
  const expectedPort = SANDBOX.CONTAINER_DB_PORT;
  if (Number(field(row, 'port')) !== expectedPort) {
    throw publicError(`The connected database server port must be the sandbox container port ${expectedPort}, not the published host port.`);
  }
  const version = Number(field(row, 'version'));
  if (!Number.isInteger(version) || version < 170000 || version >= 180000) {
    throw publicError('The owned sandbox must run PostgreSQL 17.');
  }
  return {
    database: target.database,
    role: target.role,
    address,
    port: Number(field(row, 'port')),
    version,
  };
}

export async function verifyConnectedIdentity(
  sql: SandboxSql,
  target: ConnectedIdentityTarget,
): Promise<ConnectedIdentity> {
  if (typeof sql !== 'function') {
    throw new TypeError('verifyConnectedIdentity requires an injected postgres client.');
  }
  const rows = await sql`
    SELECT current_database() AS database,
           current_user AS role,
           inet_server_addr()::text AS address,
           inet_server_port() AS port,
           current_setting('server_version_num') AS version`;
  return assertConnectedIdentityRow(rows[0], target);
}

export function resolveSandboxTarget({
  root = ROOT,
  fsImpl = fs,
  execFileSyncImpl = execFileSync,
  environment = process.env,
  requireRunning = true,
}: ResolveSandboxTargetOptions = {}): SandboxTarget {
  assertNoInheritedDatabaseUrl(environment);
  const record = readServiceRecord({ root, fsImpl });
  const credentials = readCredentials({ root, fsImpl, record });
  const container = inspectContainer({ execFileSyncImpl });
  const containerOwnership = assertOwnedContainer(container, SANDBOX, { requireRunning });
  const volumeOwnership = assertOwnedVolume(inspectVolume({ execFileSyncImpl }), SANDBOX);
  const identity = assertDsnTarget(credentials.databaseUrl);
  return {
    project: record.project,
    service: record.service,
    container: record.container,
    volume: record.volume,
    database: identity.database,
    role: identity.role,
    host: identity.host,
    port: identity.port,
    containerPort: SANDBOX.CONTAINER_DB_PORT,
    appPort: record.appPort,
    instanceId: record.instanceId,
    databaseUrl: credentials.databaseUrl,
    sessionSecret: credentials.sessionSecret,
    ownership: { ...containerOwnership, ...volumeOwnership },
    containerAddresses: containerNetworkAddresses(container),
    running: containerIsRunning(container),
  };
}

export function canListen({
  port,
  host = SANDBOX.HOST,
  netImpl = net,
}: CanListenOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const server = netImpl.createServer();
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      try { server.close(); } catch { /* already closed */ }
      resolve(value);
    };
    server.once('error', () => finish(false));
    server.listen(port, host, () => finish(true));
  });
}

export async function assertPortAvailable({
  port,
  host = SANDBOX.HOST,
  netImpl = net,
  label = 'sandbox port',
}: AssertPortAvailableOptions): Promise<number> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw publicError(`The ${label} is invalid.`);
  }
  if (!(await canListen({ port, host, netImpl }))) {
    throw publicError(`The ${label} ${port} is already in use; refusing to occupy an unknown service.`);
  }
  return port;
}

export function writePrivateFile(
  filePath: string,
  contents: string | Uint8Array,
  fsImpl: PrivateFs = fs,
): string {
  if (fsImpl.existsSync(filePath)) {
    throw publicError('Refusing to overwrite an existing private sandbox file.');
  }
  const directory = path.dirname(filePath);
  fsImpl.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fsImpl.chmodSync(directory, 0o700);
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fsImpl.writeFileSync(temporary, contents, { mode: 0o600, flag: 'wx' });
  fsImpl.chmodSync(temporary, 0o600);
  fsImpl.renameSync(temporary, filePath);
  fsImpl.chmodSync(filePath, 0o600);
  return filePath;
}

export function writePrivateJson(
  filePath: string,
  value: unknown,
  fsImpl: PrivateFs = fs,
): string {
  return writePrivateFile(filePath, `${JSON.stringify(value, null, 2)}\n`, fsImpl);
}
