import type { Response } from 'express';

/**
 * Narrow declaration for the untouched legacy error module. The implementation
 * remains `server/errors.js`; only the symbols used by typed callers are
 * declared here.
 */
export interface PublicErrorDetails {
  [field: string]: string | number | string[];
}

export declare class ApiError extends Error {
  constructor(status: number, code: string, message: string, details?: unknown);
  readonly status: number;
  readonly publicCode: string;
  readonly publicMessage: string;
  readonly details?: PublicErrorDetails;
}

export declare function sendError(res: Response, error: unknown): Response;
