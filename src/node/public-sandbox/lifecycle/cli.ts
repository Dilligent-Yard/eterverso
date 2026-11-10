import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import {
  SANDBOX,
  publicError,
} from '../target.js';
import type {
  CliOptions,
  ImportResult,
  MigrateResult,
  ParsedCliOptions,
  ProvisionResult,
  SandboxDependencies,
  SandboxDependencyOverrides,
  StartResult,
  StatusResult,
  StopResult,
} from './contracts.js';
import {
  defaultComposeRunner,
  defaultExecFileSync,
  defaultPortChecker,
  defaultRunNode,
  defaultSqlFactory,
} from './orchestration.js';
import { loadLegacyApp, loadLegacyServer } from './legacy.js';
import { defaultHttpGet, importCapture, migrate, startSandbox } from './run.js';
import { provision, statusSandbox, stopSandbox } from './provision.js';

const COMMANDS = new Set(['provision', 'migrate', 'import', 'start', 'stop', 'status', 'reset']);

export const USAGE = [
  'Usage: node scripts/public-sandbox.js <provision|migrate|import|start|stop|status> [options]',
  '  --capture DIR     private AetherversePublicCaptureV1 directory (import only)',
  '  --dry-run         validate and report without service, DDL, account, or content writes',
  '  --confirm NAME    explicit destructive reset confirmation (reset is not implemented)',
].join('\n');

function assertArgvArray(value: unknown): void {
  if (!Array.isArray(value)) throw new TypeError('argv must be an array.');
}

export function parseCliArgs(argv: readonly string[]): CliOptions {
  assertArgvArray(argv);
  if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) return { help: true };
  const command = argv[0];
  if (!command || !COMMANDS.has(command)) {
    throw publicError(`Unknown sandbox command. ${USAGE}`);
  }
  const options: ParsedCliOptions = { command, capture: null, dryRun: false, confirm: null, help: false };
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--dry-run') {
      if (options.dryRun) throw publicError('--dry-run was supplied more than once.');
      if (!['provision', 'migrate', 'import'].includes(command)) {
        throw publicError(`--dry-run is not meaningful for ${command}.`);
      }
      options.dryRun = true;
      continue;
    }
    if (argument === '--capture' || argument === '--confirm') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw publicError(`${argument} requires an explicit value.`);
      index += 1;
      if (argument === '--capture') {
        if (command !== 'import') throw publicError('--capture is valid only for import.');
        if (options.capture !== null) throw publicError('--capture was supplied more than once.');
        options.capture = value;
      } else {
        if (command !== 'reset') throw publicError('--confirm is valid only for the explicit destructive reset command.');
        if (options.confirm !== null) throw publicError('--confirm was supplied more than once.');
        options.confirm = value;
      }
      continue;
    }
    throw publicError(`Unknown sandbox option ${argument}. ${USAGE}`);
  }
  if (command === 'import' && !options.capture) throw publicError('import requires --capture <directory>.');
  if (command === 'reset') {
    if (options.confirm !== SANDBOX.DATABASE) {
      throw publicError(`Reset requires --confirm ${SANDBOX.DATABASE}; no sandbox was changed.`);
    }
    throw publicError('Reset is not implemented. The sandbox is never dropped or reset implicitly.');
  }
  return options;
}

export function defaultDependencies(
  repoRoot: string,
  overrides: SandboxDependencyOverrides = {},
): SandboxDependencies {
  if (typeof repoRoot !== 'string' || !repoRoot) {
    throw new TypeError('defaultDependencies requires an explicit repository root.');
  }
  const root = overrides.root || repoRoot;
  const environment = overrides.environment || process.env;
  let verifySchemaReadiness = overrides.verifySchemaReadiness;
  let readConfig = overrides.readConfig;
  let createAppFactory = overrides.createAppFactory;
  if (!verifySchemaReadiness || !readConfig) {
    const legacy = loadLegacyServer(repoRoot);
    verifySchemaReadiness ||= legacy.verifySchemaReadiness;
    readConfig ||= legacy.readConfig;
  }
  if (!createAppFactory) {
    createAppFactory = loadLegacyApp(repoRoot).createAppFactory;
  }
  return {
    root,
    fsImpl: overrides.fsImpl || fs,
    execFileSyncImpl: overrides.execFileSyncImpl || defaultExecFileSync,
    sqlFactory: overrides.sqlFactory || defaultSqlFactory,
    portChecker: overrides.portChecker || defaultPortChecker,
    composeRunner: overrides.composeRunner || defaultComposeRunner,
    runNode: overrides.runNode || defaultRunNode,
    randomBytes: overrides.randomBytes || ((size) => crypto.randomBytes(size)),
    now: overrides.now || (() => new Date()),
    passwordHasher: overrides.passwordHasher,
    environment,
    verifySchemaReadiness,
    readConfig,
    createAppFactory,
    httpGet: overrides.httpGet || defaultHttpGet,
    installSignalHandlers: overrides.installSignalHandlers !== false,
  };
}

export type MainResult =
  | ProvisionResult
  | MigrateResult
  | ImportResult
  | StartResult
  | StopResult
  | StatusResult
  | null;

export async function main(
  repoRoot: string,
  argv: readonly string[] = process.argv.slice(2),
  overrides: SandboxDependencyOverrides = {},
): Promise<MainResult> {
  const options = parseCliArgs(argv);
  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return null;
  }
  if (Number(process.versions.node.split('.')[0]) !== 24) {
    throw publicError('The public sandbox lifecycle requires Node.js 24.');
  }
  const dependencies = defaultDependencies(repoRoot, overrides);
  if (options.command === 'provision') return provision(options, dependencies);
  if (options.command === 'migrate') return migrate(options, dependencies);
  if (options.command === 'import') return importCapture(options, dependencies);
  if (options.command === 'start') return startSandbox(options, dependencies);
  if (options.command === 'stop') return stopSandbox(options, dependencies);
  if (options.command === 'status') return statusSandbox(options, dependencies);
  throw publicError('Unsupported sandbox command.');
}
