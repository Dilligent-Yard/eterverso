/**
 * Public entry point for the public-sandbox import island.
 *
 * The CommonJS adapter at `scripts/public-sandbox-import.js` re-exports this
 * module, so every name below must remain available with the same call shape:
 * capture reader, plan/mapping, repository, transactional apply, and synthetic
 * tester credentials.
 */
export {
  CAPTURE_SCHEMA,
  RECONSTRUCTION_ID,
  RECONSTRUCTION_USERNAME,
  TESTER_SPECS,
} from './contracts.js';
export { readCapture } from './capture.js';
export { buildAuthorIndex, buildImportPlan } from './plan.js';
export { createPostgresRepository } from './repository.js';
export { applyImportPlan, applyPlanWithRepository } from './apply.js';
export {
  inspectExistingTesters,
  parseTesterCredentials,
  testerCredentialsContents,
} from './credentials.js';
export {
  canonicalJson,
  deterministicUuid,
  legacyDigest,
  publicError,
} from './primitives.js';
