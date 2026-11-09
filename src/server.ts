/**
 * Aetherverse Vault — Servidor backend principal (TypeScript)
 *
 * Express + PostgreSQL (via `postgres` com prepare: false) + Drizzle schema
 * Integração robusta com a arquitetura modular:
 *  - Suporte completo a notificações (anti-spam, leitura, exclusão)
 *  - Sistema de curtidas (personagem, cena, turno com suporte a UUID e legacyId)
 *  - Validação estrita de tipos (postgres.Sql sem 'any')
 *  - Inicialização resiliente e encerramento gracioso (SIGINT/SIGTERM)
 */

import 'dotenv/config';
import path from 'path';
import postgres, { Sql } from 'postgres';
import { createApp } from '../server/app';
import { ensureTimelineSchema } from '../server/timeline';
import type { ServerConfig } from './types';

export * from './types';

const ROOT = path.resolve(__dirname, '..');

/**
 * Garante idempotentemente a criação das tabelas e índices de interações (notificações e curtidas).
 */
export async function ensureInteractionsSchema(sql: Sql): Promise<void> {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS "notifications" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "actor_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
        "type" varchar(40) NOT NULL,
        "reference_id" varchar(200),
        "reference_type" varchar(40),
        "title" varchar(200) NOT NULL,
        "message" text DEFAULT '',
        "read" boolean DEFAULT false NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
      )`;

    await sql`CREATE INDEX IF NOT EXISTS "idx_notifications_user_id" ON "notifications" ("user_id")`;
    await sql`CREATE INDEX IF NOT EXISTS "idx_notifications_user_read" ON "notifications" ("user_id", "read")`;

    await sql`
      CREATE TABLE IF NOT EXISTS "likes" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "target_type" varchar(40) NOT NULL,
        "target_id" varchar(200) NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        CONSTRAINT "likes_unique" UNIQUE ("user_id", "target_type", "target_id")
      )`;

    await sql`CREATE INDEX IF NOT EXISTS "idx_likes_target" ON "likes" ("target_type", "target_id")`;
  } catch (err) {
    console.warn('Aviso ao verificar schema de interações:', (err as Error).message);
  }
}

/**
 * Lê e valida as configurações de ambiente de forma segura e amigável.
 */
export function readServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL não definida. Configure o arquivo .env com a string de conexão PostgreSQL.');
  }
  if (!env.SESSION_SECRET) {
    throw new Error('SESSION_SECRET não definida. Configure o arquivo .env com uma chave de sessão segura.');
  }

  let databaseUrl: URL;
  try {
    databaseUrl = new URL(env.DATABASE_URL);
  } catch {
    throw new Error('DATABASE_URL inválida. Configure uma URL PostgreSQL válida antes de iniciar.');
  }

  if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) {
    throw new Error('DATABASE_URL deve usar o protocolo postgres: ou postgresql:.');
  }

  const port = env.PORT === undefined || env.PORT === '' ? 3000 : Number(env.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT deve ser um número inteiro entre 1 e 65535.');
  }

  const production = env.NODE_ENV === 'production' || !!env.RENDER;
  const configuredOrigin = env.APP_ORIGIN || '';
  let publicOrigin = configuredOrigin || `http://localhost:${port}`;
  try {
    const parsedOrigin = new URL(publicOrigin);
    publicOrigin = parsedOrigin.origin;
  } catch {
    throw new Error('APP_ORIGIN deve ser uma origem HTTP(S) válida sem credenciais ou caminho.');
  }

  return {
    databaseUrl: env.DATABASE_URL,
    sessionSecret: env.SESSION_SECRET,
    secureCookies: production,
    production,
    publicOrigin,
    port,
  };
}

export interface ServerInstance {
  app: any;
  server: any;
  sql: Sql;
  config: ServerConfig;
}

/**
 * Inicializa o backend TypeScript do Eterverso.
 */
export async function startServer(options: { rootDirectory?: string; env?: NodeJS.ProcessEnv } = {}): Promise<ServerInstance> {
  const rootDirectory = options.rootDirectory || ROOT;
  const config = readServerConfig(options.env || process.env);

  // prepare: false é obrigatório para compatibilidade com o Transaction Pooler do Supabase
  const sql: Sql = postgres(config.databaseUrl, {
    prepare: false,
    connection: { timezone: 'UTC' },
  });

  await ensureInteractionsSchema(sql);
  await ensureTimelineSchema(sql);

  const app = createApp({
    sql,
    config: {
      sessionSecret: config.sessionSecret,
      secureCookies: config.secureCookies,
      production: config.production,
      publicOrigin: config.publicOrigin,
      staticRoot: rootDirectory,
    },
  });

  const server = app.listen(config.port);
  await new Promise<void>((resolve, reject) => {
    server.once('listening', () => resolve());
    server.once('error', (err: Error) => reject(err));
  });

  console.log(`Eterverso Vault online na porta ${config.port} (TypeScript / Node.js)`);

  const shutdown = async (signal: string) => {
    console.log(`Encerrando Eterverso (${signal})...`);
    await new Promise((res) => server.close(res));
    await sql.end({ timeout: 5 }).catch(() => {});
    process.exit(0);
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  return { app, server, sql, config };
}

// Se executado diretamente como script
if (require.main === module) {
  startServer().catch((err: Error) => {
    console.error('Falha ao iniciar o servidor:', err.message);
    process.exit(1);
  });
}
