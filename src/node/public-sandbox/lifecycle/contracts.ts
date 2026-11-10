/**
 * Shared contracts for the public-sandbox lifecycle CLI.
 *
 * Every dependency below is a narrow port over the concrete runtime object the
 * adapter injects. Filesystem, Docker CLI, database and legacy server modules
 * are still validated by their own guards; these types only describe the shapes
 * the CLI itself consumes.
 */

import type { StdioOptions } from 'node:child_process';
import type postgres from 'postgres';
import type {
  ApplyResult,
  ImportPlan,
  PasswordHasher,
} from '../import/contracts.js';
import type {
  PrivateFs,
  SandboxTarget,
  ServiceRecord,
  UnknownRecord,
} from '../target.js';
import type { ServerConfig } from '../../runtime/config.js';

export interface SandboxStatePaths {
  directory: string;
  credentials: string;
  record: string;
  testers: string;
  reports: string;
}

export interface GeneratedCredentials {
  password: string;
  sessionSecret: string;
  instanceId: string;
  createdAt: string;
}

export interface ParsedCliOptions {
  command: string;
  capture: string | null;
  dryRun: boolean;
  confirm: string | null;
  help: false;
}

export interface HelpOptions {
  help: true;
}

export type CliOptions = ParsedCliOptions | HelpOptions;

export interface SandboxExecFileOptions {
  encoding: 'utf8';
  stdio: StdioOptions;
  cwd?: string;
}

export type SandboxExecFileSync = (
  file: string,
  args: readonly string[],
  options: SandboxExecFileOptions,
) => string;

export interface ChildProcessOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdio: 'inherit';
}

export type ChildProcessRunner = (
  file: string,
  args: readonly string[],
  options: ChildProcessOptions,
) => unknown;

export type PortChecker = (port: number, host: string) => Promise<boolean>;

export type ComposeRunner = (
  root: string,
  paths: Pick<SandboxStatePaths, 'credentials'>,
  args: readonly string[],
  execFileSyncImpl: SandboxExecFileSync,
) => unknown;

export type RandomBytes = (size: number) => Buffer;

export type Now = () => Date;

export type HttpGet = (url: string, timeoutMs?: number) => Promise<number | undefined>;

/**
 * Callable tagged-template query plus the helpers the import writer and
 * identity probe require from a `postgres` client. The concrete default is a
 * thin adapter around `postgres`; injected test clients only need to provide
 * the methods their command path actually uses.
 */
export interface SandboxTransactionSql {
  <Row extends object = UnknownRecord>(
    strings: TemplateStringsArray,
    ...values: readonly unknown[]
  ): Promise<Row[]>;
  json(value: unknown): unknown;
}

export interface SandboxSqlClient extends SandboxTransactionSql {
  array(values: readonly unknown[], oid: number): unknown;
  begin<Result>(
    callback: (transaction: SandboxTransactionSql) => Promise<Result>,
  ): Promise<Result>;
  end(options?: { timeout?: number }): Promise<void>;
}

export type SandboxPostgresType = postgres.PostgresType;
export type SandboxPostgresOptions = postgres.Options<
  Record<string, postgres.PostgresType>
>;

export type SqlFactory = (
  databaseUrl: string,
  options?: SandboxPostgresOptions,
) => SandboxSqlClient;

export interface SchemaReadinessResult {
  migration: string;
  verifiedColumns: number;
}

export type VerifySchemaReadiness = (
  sql: SandboxSqlClient,
  options?: { rootDirectory?: string },
) => Promise<SchemaReadinessResult>;

export type ReadConfig = (environment: NodeJS.ProcessEnv) => ServerConfig;

export interface CreateAppConfig {
  sessionSecret: string;
  secureCookies?: boolean;
  production?: boolean;
  publicOrigin?: string;
  staticRoot?: string;
}

export interface SandboxHttpServer {
  once(event: 'listening', listener: () => void): unknown;
  once(event: 'error', listener: (error: Error) => void): unknown;
  close(callback?: (error?: Error) => void): unknown;
}

export interface SandboxApp {
  listen(port: number, host: string): SandboxHttpServer;
}

export type CreateAppFactory = (options: {
  sql: SandboxSqlClient;
  config: CreateAppConfig;
}) => SandboxApp;

export interface SandboxDependencies {
  root: string;
  fsImpl: PrivateFs;
  execFileSyncImpl: SandboxExecFileSync;
  sqlFactory: SqlFactory;
  portChecker: PortChecker;
  composeRunner: ComposeRunner;
  runNode: ChildProcessRunner;
  randomBytes: RandomBytes;
  now: Now;
  passwordHasher: PasswordHasher | undefined;
  environment: NodeJS.ProcessEnv;
  verifySchemaReadiness: VerifySchemaReadiness;
  readConfig: ReadConfig;
  createAppFactory: CreateAppFactory;
  httpGet: HttpGet;
  installSignalHandlers: boolean;
}

export interface SandboxDependencyOverrides {
  root?: string;
  fsImpl?: PrivateFs;
  execFileSyncImpl?: SandboxExecFileSync;
  sqlFactory?: SqlFactory;
  portChecker?: PortChecker;
  composeRunner?: ComposeRunner;
  runNode?: ChildProcessRunner;
  randomBytes?: RandomBytes;
  now?: Now;
  passwordHasher?: PasswordHasher;
  environment?: NodeJS.ProcessEnv;
  verifySchemaReadiness?: VerifySchemaReadiness;
  readConfig?: ReadConfig;
  createAppFactory?: CreateAppFactory;
  httpGet?: HttpGet;
  installSignalHandlers?: boolean;
}

export interface ProvisionResult {
  dryRun: boolean;
  reused: boolean;
  restarted?: boolean;
  target?: SandboxTarget;
}

export interface MigrateResult {
  dryRun: boolean;
  target: SandboxTarget;
}

export interface ImportDryRunResult {
  dryRun: true;
  plan: ImportPlan;
}

export interface ImportAppliedResult {
  dryRun: false;
  plan: ImportPlan;
  result: ApplyResult;
  target: SandboxTarget;
}

export type ImportResult = ImportDryRunResult | ImportAppliedResult;

export interface StartResult {
  target: SandboxTarget;
  server: SandboxHttpServer;
  sql: SandboxSqlClient;
}

export interface StopResult {
  stopped: boolean;
  target?: SandboxTarget;
}

export interface StatusNotProvisioned {
  provisioned: false;
}

export interface StatusProvisionedStopped {
  provisioned: true;
  running: false;
  record?: ServiceRecord;
  target?: SandboxTarget;
}

export interface StatusProvisionedRunning {
  provisioned: true;
  running: true;
  target: SandboxTarget;
  appPortFree: boolean;
}

export type StatusResult =
  | StatusNotProvisioned
  | StatusProvisionedStopped
  | StatusProvisionedRunning;
