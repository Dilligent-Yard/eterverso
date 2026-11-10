import * as path from 'node:path';
import {
  CaptureFatalError,
  CaptureHttpError,
  CaptureUsageError,
  DEFAULT_MAX_REQUESTS,
  DEFAULT_ORIGIN,
  SCHEMA_VERSION,
  makeCaptureId,
} from './contracts.js';
import type {
  CaptureOptions,
  CaptureOptionsInput,
  CapturePlan,
  RunCaptureResult,
} from './contracts.js';
import { classifyEndpoint, normalizeOrigin, parseRetryAfter } from './transport.js';
import {
  findSensitiveKey,
  validateCaptureDirectory,
  validateDataset,
  validateManifest,
} from './validation.js';
import { capturePlan as planCapture, normalizeCaptureOptions as normalizeOptions } from './policy.js';
import { runCaptureWithRoot } from './run.js';
import { createMain, parseArgs } from './cli.js';
import type { MainFunction } from './cli.js';

export {
  CaptureFatalError,
  CaptureHttpError,
  CaptureUsageError,
  DEFAULT_MAX_REQUESTS,
  DEFAULT_ORIGIN,
  SCHEMA_VERSION,
  makeCaptureId,
};
export { classifyEndpoint, normalizeOrigin, parseRetryAfter };
export { findSensitiveKey, validateCaptureDirectory, validateDataset, validateManifest };
export { parseArgs };
export type {
  CaptureCounts,
  CaptureDataset,
  CaptureErrorDetails,
  CaptureGap,
  CaptureManifest,
  CaptureOptions,
  CaptureOptionsInput,
  CapturePlan,
  CaptureRecord,
  CaptureRequestRecord,
  CompletedCaptureResult,
  DryRunResult,
  RunCaptureResult,
  SleepFunction,
  UnresolvedChange,
} from './contracts.js';
export type { MainDependencies, MainFunction, ParsedArgs } from './cli.js';

export interface PublicSnapshotOptions {
  repoRoot: string;
}

export interface PublicSnapshotApi {
  DEFAULT_ORIGIN: typeof DEFAULT_ORIGIN;
  DEFAULT_MAX_REQUESTS: typeof DEFAULT_MAX_REQUESTS;
  PRIVATE_CAPTURE_ROOT: string;
  SCHEMA_VERSION: typeof SCHEMA_VERSION;
  CaptureFatalError: typeof CaptureFatalError;
  CaptureHttpError: typeof CaptureHttpError;
  CaptureUsageError: typeof CaptureUsageError;
  capturePlan: (options: CaptureOptions) => CapturePlan;
  classifyEndpoint: typeof classifyEndpoint;
  findSensitiveKey: typeof findSensitiveKey;
  main: MainFunction;
  makeCaptureId: typeof makeCaptureId;
  normalizeCaptureOptions: (raw?: CaptureOptionsInput) => CaptureOptions;
  normalizeOrigin: typeof normalizeOrigin;
  parseArgs: typeof parseArgs;
  parseRetryAfter: typeof parseRetryAfter;
  runCapture: (raw?: CaptureOptionsInput) => Promise<RunCaptureResult>;
  validateCaptureDirectory: typeof validateCaptureDirectory;
  validateDataset: typeof validateDataset;
  validateManifest: typeof validateManifest;
}

/**
 * Build the public capture API for one explicit repository root. The legacy
 * CommonJS adapter owns the root calculation so emitted files never infer it
 * from their `.generated` location.
 */
export function createPublicSnapshot({ repoRoot }: PublicSnapshotOptions): PublicSnapshotApi {
  if (typeof repoRoot !== 'string' || !repoRoot.trim()) {
    throw new CaptureUsageError('A repository root is required.');
  }
  const resolvedRoot = path.resolve(repoRoot.trim());
  const privateCaptureRoot = path.join(resolvedRoot, '.local', 'public-snapshots');
  const normalizeCaptureOptions = (raw: CaptureOptionsInput = {}): CaptureOptions => (
    normalizeOptions(raw, privateCaptureRoot)
  );
  const capturePlan = (options: CaptureOptions): CapturePlan => (
    planCapture(options, privateCaptureRoot)
  );
  const runCapture = (raw: CaptureOptionsInput = {}): Promise<RunCaptureResult> => (
    runCaptureWithRoot(raw, privateCaptureRoot)
  );
  const main = createMain({ privateCaptureRoot, runCapture });
  return {
    DEFAULT_ORIGIN,
    DEFAULT_MAX_REQUESTS,
    PRIVATE_CAPTURE_ROOT: privateCaptureRoot,
    SCHEMA_VERSION,
    CaptureFatalError,
    CaptureHttpError,
    CaptureUsageError,
    capturePlan,
    classifyEndpoint,
    findSensitiveKey,
    main,
    makeCaptureId,
    normalizeCaptureOptions,
    normalizeOrigin,
    parseArgs,
    parseRetryAfter,
    runCapture,
    validateCaptureDirectory,
    validateDataset,
    validateManifest,
  };
}
