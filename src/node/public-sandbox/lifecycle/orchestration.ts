import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import postgres from 'postgres';
import {
  SANDBOX,
  assertOwnedVolume,
  canListen,
  inspectVolume,
  resolveSandboxTarget,
  verifyConnectedIdentity,
} from '../target.js';
import type { PrivateFs, SandboxTarget } from '../target.js';
import type {
  ChildProcessOptions,
  SandboxExecFileOptions,
  SandboxExecFileSync,
  SandboxPostgresOptions,
  SandboxSqlClient,
  SandboxStatePaths,
  SqlFactory,
} from './contracts.js';

// postgres.js parses `timestamp without time zone` through `new Date(value)`,
// which interprets the stored wall clock in the host timezone. The site's
// timezone-less columns store UTC wall time, so compare/read them as UTC.
export const SANDBOX_POSTGRES_TYPES = {
  utcTimestamp: {
    to: 1184,
    from: [1082, 1114, 1184],
    serialize: (value: unknown): string => (
      value instanceof Date ? value : new Date(value as string | number)
    ).toISOString(),
    parse: (value: unknown): unknown => {
      if (typeof value !== 'string') return value;
      if (/[zZ]$|[+-]\d{2}(?::?\d{2})?$/u.test(value)) return new Date(value);
      return new Date(`${value.replace(' ', 'T')}Z`);
    },
  },
} satisfies Record<string, postgres.PostgresType>;

/**
 * Return the concrete `postgres` client unchanged. The start command passes it
 * to the legacy Express app, which also uses `sql.unsafe` and transaction
 * helpers; the narrow lifecycle port must not remove or shadow those methods.
 * The assertion only narrows the surface this island itself consumes.
 */
export function defaultSqlFactory(
  databaseUrl: string,
  options?: SandboxPostgresOptions,
): SandboxSqlClient {
  return postgres(databaseUrl, options) as SandboxSqlClient;
}

export function sandboxPostgres(
  sqlFactory: SqlFactory,
  databaseUrl: string,
  options?: SandboxPostgresOptions,
): SandboxSqlClient {
  return sqlFactory(databaseUrl, Object.assign({
    prepare: false,
    connection: { timezone: 'UTC' },
    types: SANDBOX_POSTGRES_TYPES,
  }, options));
}

export function defaultExecFileSync(
  file: string,
  args: readonly string[],
  options: SandboxExecFileOptions,
): string {
  return execFileSync(file, args, options);
}

export function defaultComposeRunner(
  root: string,
  paths: Pick<SandboxStatePaths, 'credentials'>,
  args: readonly string[],
  execFileSyncImpl: SandboxExecFileSync = defaultExecFileSync,
): string {
  return execFileSyncImpl('docker', composeArgs(root, paths, args), {
    cwd: root,
    encoding: 'utf8',
    stdio: 'inherit',
  });
}

export function defaultRunNode(
  file: string,
  args: readonly string[],
  options: ChildProcessOptions,
): unknown {
  return execFileSync(file, args, options);
}

export function composeArgs(
  root: string,
  paths: Pick<SandboxStatePaths, 'credentials'>,
  args: readonly string[],
): string[] {
  return [
    'compose',
    '--project-name', SANDBOX.PROJECT,
    '-f', path.join(root, 'compose.sandbox.yaml'),
    '--env-file', paths.credentials,
    ...args,
  ];
}

export function defaultPortChecker(port: number, host: string): Promise<boolean> {
  return canListen({ port, host });
}

export interface ResolveTargetForOperationOptions {
  root: string;
  fsImpl: PrivateFs;
  execFileSyncImpl: SandboxExecFileSync;
  environment: NodeJS.ProcessEnv;
  requireRunning?: boolean;
}

export function resolveTargetForOperation({
  root,
  fsImpl,
  execFileSyncImpl,
  environment,
  requireRunning = true,
}: ResolveTargetForOperationOptions): Promise<SandboxTarget> {
  return Promise.resolve(resolveSandboxTarget({
    root,
    fsImpl,
    execFileSyncImpl,
    environment,
    requireRunning,
  }));
}

export async function verifyTargetConnection(
  sqlFactory: SqlFactory,
  target: SandboxTarget,
): Promise<void> {
  const sql = sqlFactory(target.databaseUrl, {
    prepare: false,
    max: 1,
    connect_timeout: 5,
    idle_timeout: 5,
    connection: { timezone: 'UTC' },
  });
  try {
    await verifyConnectedIdentity(sql, target);
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

export function assertExistingVolumeOwnership(
  execFileSyncImpl: SandboxExecFileSync,
): unknown {
  const volume = inspectVolume({ execFileSyncImpl, allowMissing: true });
  if (volume) assertOwnedVolume(volume, SANDBOX);
  return volume;
}
