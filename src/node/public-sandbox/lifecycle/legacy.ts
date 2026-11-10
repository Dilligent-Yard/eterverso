import { createRequire } from 'node:module';
import * as path from 'node:path';
import type {
  CreateAppFactory,
  ReadConfig,
  VerifySchemaReadiness,
} from './contracts.js';

export interface LegacyServerModule {
  verifySchemaReadiness: VerifySchemaReadiness;
  readConfig: ReadConfig;
}

export interface LegacyAppModule {
  createAppFactory: CreateAppFactory;
}

export interface LegacyModules extends LegacyServerModule, LegacyAppModule {}

type AnyFunction = (...args: never[]) => unknown;

function createRootRequire(repoRoot: string): NodeJS.Require {
  if (typeof repoRoot !== 'string' || !repoRoot) {
    throw new TypeError('Loading legacy server modules requires an explicit repository root.');
  }
  return createRequire(path.join(repoRoot, 'package.json'));
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} did not export a CommonJS object.`);
  }
  return value as Record<string, unknown>;
}

function requireFunction<T extends AnyFunction>(
  record: Record<string, unknown>,
  key: string,
  label: string,
): T {
  const candidate = record[key];
  if (typeof candidate !== 'function') {
    throw new TypeError(`${label} does not export ${key}.`);
  }
  return candidate as T;
}

/**
 * Load the canonical root-level server module from an explicitly supplied
 * repository root. The generated lifecycle module cannot use `__dirname` to
 * infer the repository, because it lives under `.generated/node`.
 */
export function loadLegacyServer(repoRoot: string): LegacyServerModule {
  const requireFromRoot = createRootRequire(repoRoot);
  const serverModule = asRecord(
    requireFromRoot(path.join(repoRoot, 'server.js')) as unknown,
    'server.js',
  );
  return {
    verifySchemaReadiness: requireFunction<VerifySchemaReadiness>(
      serverModule,
      'verifySchemaReadiness',
      'server.js',
    ),
    readConfig: requireFunction<ReadConfig>(serverModule, 'readConfig', 'server.js'),
  };
}

export function loadLegacyApp(repoRoot: string): LegacyAppModule {
  const requireFromRoot = createRootRequire(repoRoot);
  const appModule = asRecord(
    requireFromRoot(path.join(repoRoot, 'server', 'app.js')) as unknown,
    'server/app.js',
  );
  return {
    createAppFactory: requireFunction<CreateAppFactory>(
      appModule,
      'createApp',
      'server/app.js',
    ),
  };
}

export function loadLegacyModules(repoRoot: string): LegacyModules {
  return { ...loadLegacyServer(repoRoot), ...loadLegacyApp(repoRoot) };
}
