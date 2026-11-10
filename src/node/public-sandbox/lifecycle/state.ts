import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  TESTER_SPECS,
  parseTesterCredentials,
} from '../import/index.js';
import type { TesterPasswords } from '../import/contracts.js';
import {
  SANDBOX,
  assertPrivateDirectory,
  publicError,
  readPrivateFile,
  writePrivateFile,
  writePrivateJson,
} from '../target.js';
import type { PrivateFs, ServiceRecord } from '../target.js';
import type {
  GeneratedCredentials,
  RandomBytes,
  SandboxStatePaths,
} from './contracts.js';

const TESTER_FILE_MAX_BYTES = 16 * 1024;

export function statePaths(root: string): SandboxStatePaths {
  if (typeof root !== 'string' || !root) {
    throw new TypeError('statePaths requires an explicit repository root.');
  }
  const directory = path.join(root, '.local', 'public-sandbox');
  return {
    directory,
    credentials: path.join(directory, SANDBOX.CREDENTIALS_FILE),
    record: path.join(directory, SANDBOX.SERVICE_FILE),
    testers: path.join(directory, SANDBOX.TESTERS_FILE),
    reports: path.join(directory, SANDBOX.REPORTS_DIR),
  };
}

export function stateExists(
  paths: SandboxStatePaths,
  fsImpl: PrivateFs = fs,
): boolean {
  const credentials = fsImpl.existsSync(paths.credentials);
  const record = fsImpl.existsSync(paths.record);
  if (credentials !== record) {
    throw publicError('Private sandbox state is incomplete; inspect .local/public-sandbox without replacing it.');
  }
  return credentials;
}

export function generateCredentials(
  randomBytes: RandomBytes = (size) => crypto.randomBytes(size),
  now: () => Date = () => new Date(),
): GeneratedCredentials {
  const password = randomBytes(32).toString('hex');
  const sessionSecret = randomBytes(32).toString('base64url');
  return {
    password,
    sessionSecret,
    instanceId: crypto.randomUUID(),
    createdAt: now().toISOString(),
  };
}

export function credentialsFileContents(generated: GeneratedCredentials): string {
  return [
    `ETERVERSO_SANDBOX_DB_PASSWORD=${generated.password}`,
    `ETERVERSO_SANDBOX_DATABASE_URL=postgres://${SANDBOX.ROLE}:${generated.password}@${SANDBOX.HOST}:${SANDBOX.DB_PORT}/${SANDBOX.DATABASE}`,
    `ETERVERSO_SANDBOX_SESSION_SECRET=${generated.sessionSecret}`,
    '',
  ].join('\n');
}

export function serviceRecord(generated: GeneratedCredentials): ServiceRecord {
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
    instanceId: generated.instanceId,
    createdAt: generated.createdAt,
  };
}

export function ensurePrivateStateDirectory(
  root: string,
  fsImpl: PrivateFs = fs,
): SandboxStatePaths {
  const paths = statePaths(root);
  fsImpl.mkdirSync(paths.directory, { recursive: true, mode: 0o700 });
  fsImpl.chmodSync(paths.directory, 0o700);
  assertPrivateDirectory(paths.directory, fsImpl);
  return paths;
}

export function writeInitialState(
  root: string,
  generated: GeneratedCredentials,
  fsImpl: PrivateFs = fs,
): SandboxStatePaths {
  const paths = ensurePrivateStateDirectory(root, fsImpl);
  writePrivateFile(paths.credentials, credentialsFileContents(generated), fsImpl);
  writePrivateJson(paths.record, serviceRecord(generated), fsImpl);
  return paths;
}

export function existingTesterPasswords(
  paths: SandboxStatePaths,
  fsImpl: PrivateFs = fs,
): TesterPasswords | null {
  if (!fsImpl.existsSync(paths.testers)) return null;
  const bytes = readPrivateFile(
    paths.testers,
    fsImpl,
    'private tester credential file',
    TESTER_FILE_MAX_BYTES,
  );
  let contents: string;
  try {
    contents = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw publicError('The private tester credential file is not valid UTF-8.');
  }
  return parseTesterCredentials(contents);
}

export function generateTesterPasswords(
  randomBytes: RandomBytes = (size) => crypto.randomBytes(size),
): Record<string, string> {
  return Object.fromEntries(TESTER_SPECS.map((spec) => [
    spec.key,
    randomBytes(24).toString('base64url'),
  ]));
}
