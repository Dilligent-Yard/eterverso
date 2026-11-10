/**
 * Public entry point for the public-sandbox lifecycle island.
 *
 * `scripts/public-sandbox.js` is a tiny CommonJS adapter that creates this
 * object with an explicit `repoRoot`. No emitted module infers the repository
 * from `__dirname`, because the build output lives under `.generated/node`.
 */
import * as path from 'node:path';
import type {
  CliOptions,
  GeneratedCredentials,
  ImportResult,
  MigrateResult,
  ParsedCliOptions,
  ProvisionResult,
  SandboxDependencies,
  SandboxDependencyOverrides,
  SandboxSqlClient,
  SandboxStatePaths,
  StartResult,
  StatusResult,
  StopResult,
} from './contracts.js';
import type { ApplyResult, ImportPlan } from '../import/contracts.js';
import type { PrivateFs, SandboxTarget } from '../target.js';
import type { ServerConfig } from '../../runtime/config.js';
import type { MainResult } from './cli.js';
import {
  USAGE,
  defaultDependencies,
  main as runMain,
  parseCliArgs,
} from './cli.js';
import {
  SANDBOX_POSTGRES_TYPES,
  composeArgs,
  sandboxPostgres,
} from './orchestration.js';
import {
  credentialsFileContents,
  existingTesterPasswords,
  generateCredentials,
  generateTesterPasswords,
  serviceRecord,
  statePaths,
} from './state.js';
import { importCapture, migrate, startSandbox } from './run.js';
import { provision, statusSandbox, stopSandbox } from './provision.js';

export interface PublicSandboxLifecycle {
  USAGE: string;
  SANDBOX_POSTGRES_TYPES: typeof SANDBOX_POSTGRES_TYPES;
  composeArgs: typeof composeArgs;
  credentialsFileContents: typeof credentialsFileContents;
  defaultDependencies: (
    overrides?: SandboxDependencyOverrides,
  ) => SandboxDependencies;
  existingTesterPasswords: typeof existingTesterPasswords;
  generateCredentials: typeof generateCredentials;
  generateTesterPasswords: typeof generateTesterPasswords;
  importCapture: (
    options: ParsedCliOptions,
    dependencies: SandboxDependencies,
  ) => Promise<ImportResult>;
  main: (
    argv?: readonly string[],
    overrides?: SandboxDependencyOverrides,
  ) => Promise<MainResult>;
  migrate: (
    options: ParsedCliOptions,
    dependencies: SandboxDependencies,
  ) => Promise<MigrateResult>;
  parseCliArgs: typeof parseCliArgs;
  provision: (
    options: ParsedCliOptions,
    dependencies: SandboxDependencies,
  ) => Promise<ProvisionResult>;
  sandboxPostgres: typeof sandboxPostgres;
  serviceRecord: typeof serviceRecord;
  startSandbox: (
    options: ParsedCliOptions,
    dependencies: SandboxDependencies,
  ) => Promise<StartResult>;
  statePaths: (root?: string) => SandboxStatePaths;
  statusSandbox: (
    options: ParsedCliOptions,
    dependencies: SandboxDependencies,
  ) => Promise<StatusResult>;
  stopSandbox: (
    options: ParsedCliOptions,
    dependencies: SandboxDependencies,
  ) => Promise<StopResult>;
}

export interface PublicSandboxLifecycleOptions {
  repoRoot: string;
}

/**
 * Bind every repository-root-dependent CLI export to one explicit root. The
 * legacy adapter supplies `scripts/..`; tests and programmatic callers may pass
 * an arbitrary checkout or fixture directory.
 */
export function createPublicSandboxLifecycle({
  repoRoot,
}: PublicSandboxLifecycleOptions): PublicSandboxLifecycle {
  if (typeof repoRoot !== 'string' || !repoRoot.trim()) {
    throw new TypeError('createPublicSandboxLifecycle requires an explicit repoRoot.');
  }
  const root = path.resolve(repoRoot.trim());
  return {
    USAGE,
    SANDBOX_POSTGRES_TYPES,
    composeArgs,
    credentialsFileContents,
    defaultDependencies: (overrides = {}) => defaultDependencies(root, overrides),
    existingTesterPasswords,
    generateCredentials,
    generateTesterPasswords,
    importCapture,
    main: (argv = process.argv.slice(2), overrides = {}) => (
      runMain(root, argv, overrides)
    ),
    migrate,
    parseCliArgs,
    provision,
    sandboxPostgres,
    serviceRecord,
    startSandbox,
    statePaths: (targetRoot: string = root) => statePaths(targetRoot),
    statusSandbox,
    stopSandbox,
  };
}

// Root-independent helpers remain directly importable from the emitted island.
export {
  SANDBOX_POSTGRES_TYPES,
  USAGE,
  composeArgs,
  credentialsFileContents,
  defaultDependencies,
  existingTesterPasswords,
  generateCredentials,
  generateTesterPasswords,
  importCapture,
  migrate,
  parseCliArgs,
  provision,
  sandboxPostgres,
  serviceRecord,
  startSandbox,
  statePaths,
  statusSandbox,
  stopSandbox,
};
export { defaultHttpGet, summarizePlan } from './run.js';
export { defaultComposeRunner, defaultExecFileSync, defaultSqlFactory } from './orchestration.js';

export type {
  CliOptions,
  GeneratedCredentials,
  ImportResult,
  MigrateResult,
  ParsedCliOptions,
  ProvisionResult,
  SandboxDependencies,
  SandboxDependencyOverrides,
  SandboxStatePaths,
  StartResult,
  StatusResult,
  StopResult,
};
export type {
  ApplyResult,
  ImportPlan,
  PrivateFs,
  SandboxSqlClient,
  SandboxTarget,
  ServerConfig,
};
