export interface ServerConfig {
  databaseUrl: string;
  sessionSecret: string;
  secureCookies: boolean;
  production: boolean;
  publicOrigin: string;
  port: number;
}

export function readConfig(env: NodeJS.ProcessEnv): ServerConfig {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL não definida. Configure o .env antes de iniciar.');
  if (!env.SESSION_SECRET) throw new Error('SESSION_SECRET não definida. Configure o .env antes de iniciar.');
  let databaseUrl: URL;
  try {
    databaseUrl = new URL(env.DATABASE_URL);
  } catch {
    throw new Error('DATABASE_URL inválida. Configure uma URL PostgreSQL antes de iniciar.');
  }
  if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) {
    throw new Error('DATABASE_URL deve usar PostgreSQL.');
  }
  const port = env.PORT === undefined || env.PORT === '' ? 3000 : Number(env.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT deve ser um número entre 1 e 65535.');
  }
  const production = env.NODE_ENV === 'production' || Boolean(env.RENDER);
  const configuredOrigin = env.APP_ORIGIN || '';
  if (production && !configuredOrigin) {
    throw new Error('APP_ORIGIN must be explicitly configured in production.');
  }
  let publicOrigin = configuredOrigin || `http://localhost:${port}`;
  try {
    const parsedOrigin = new URL(publicOrigin);
    if (!['http:', 'https:'].includes(parsedOrigin.protocol)
        || parsedOrigin.origin === 'null'
        || parsedOrigin.pathname !== '/'
        || parsedOrigin.search
        || parsedOrigin.hash
        || parsedOrigin.username
        || parsedOrigin.password) {
      throw new Error('invalid origin');
    }
    publicOrigin = parsedOrigin.origin;
  } catch {
    throw new Error('APP_ORIGIN must be an HTTP(S) origin without a path or credentials.');
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
