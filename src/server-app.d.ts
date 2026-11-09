import type { Express } from 'express';
import type { Sql } from 'postgres';

declare module '../server/app' {
  export interface CreateAppOptions {
    sql: Sql;
    config: {
      sessionSecret: string;
      secureCookies?: boolean;
      production?: boolean;
      publicOrigin?: string;
      staticRoot?: string;
    };
  }

  export function createApp(options: CreateAppOptions): Express;
}
