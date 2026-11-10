/**
 * Optional TypeScript entry point.
 *
 * The canonical configuration and startup contract lives in `server.js`.
 * This entry delegates to it so the optional path cannot diverge on
 * production origin checks, schema readiness or shutdown behavior.
 */

import 'dotenv/config';
import type { Server as HttpServer } from 'node:http';
import type { Express } from 'express';
import type { Sql } from 'postgres';
import { readConfig, startServer as startCanonicalServer } from '../server.js';
import type { ServerConfig } from './types';

export * from './types';

export type { ServerConfig } from './types';

export function readServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return readConfig(env) as ServerConfig;
}

export interface ServerInstance {
  app: Express;
  server: HttpServer;
  sql: Sql;
  /** Canonical startup returns only the runtime listener fields, not secrets or the database URL. */
  config: Pick<ServerConfig, 'port' | 'secureCookies'>;
}

export async function startServer(options: { rootDirectory?: string; env?: NodeJS.ProcessEnv } = {}): Promise<ServerInstance> {
  const instance = await startCanonicalServer(options) as ServerInstance;
  const shutdown = async (signal: string) => {
    console.log(`Encerrando Eterverso (${signal})...`);
    await new Promise<void>((resolve) => instance.server.close(() => resolve()));
    await instance.sql.end({ timeout: 5 }).catch(() => {});
    process.exit(0);
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  return instance;
}

if (require.main === module) {
  startServer().catch((error: Error) => {
    console.error('Falha ao iniciar o servidor:', error.message);
    process.exitCode = 1;
  });
}
