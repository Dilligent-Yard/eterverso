/**
 * Narrow declaration for the untouched legacy validation module. The
 * implementation remains `server/validation.js`; typed callers only use UUID
 * validation.
 */
export declare function validateUuid(value: unknown, field?: string): string;
