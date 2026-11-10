'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

// Every generated entry point loaded by canonical startup, an HTTP adapter or
// a supported operator CLI. Keep this list aligned with the actual `require`
// calls rather than with every file emitted by `tsc`.
const BUILD_OUTPUTS = Object.freeze([
  Object.freeze({
    id: 'runtimeConfig',
    file: '.generated/node/runtime/config.js',
    usedBy: 'server.js canonical startup',
  }),
  Object.freeze({
    id: 'interactions',
    file: '.generated/node/interactions/index.js',
    usedBy: 'server/interactions.js',
  }),
  Object.freeze({
    id: 'timeline',
    file: '.generated/node/timeline/index.js',
    usedBy: 'server/timeline.js',
  }),
  Object.freeze({
    id: 'publicSandboxLifecycle',
    file: '.generated/node/public-sandbox/lifecycle/index.js',
    usedBy: 'scripts/public-sandbox.js',
  }),
  Object.freeze({
    id: 'publicSandboxTarget',
    file: '.generated/node/public-sandbox/target.js',
    usedBy: 'scripts/public-sandbox-target.js and sandbox database targets',
  }),
  Object.freeze({
    id: 'publicSandboxImport',
    file: '.generated/node/public-sandbox/import/index.js',
    usedBy: 'scripts/public-sandbox-import.js',
  }),
  Object.freeze({
    id: 'publicSnapshot',
    file: '.generated/node/public-snapshot/index.js',
    usedBy: 'scripts/lib/public-snapshot.js',
  }),
  Object.freeze({
    id: 'browserBundle',
    file: 'generated/client/vault.js',
    usedBy: 'index.html browser bundle',
  }),
]);

const STARTUP_OUTPUTS = Object.freeze(['runtimeConfig', 'interactions', 'timeline']);

function resolveOutputs(required) {
  if (required === undefined) return BUILD_OUTPUTS;
  if (!Array.isArray(required) || required.length === 0) {
    throw new Error('Build output selection must be a non-empty array of output ids.');
  }
  const byId = new Map(BUILD_OUTPUTS.map((entry) => [entry.id, entry]));
  return required.map((id) => {
    const entry = byId.get(id);
    if (!entry) throw new Error(`Unknown build output "${id}".`);
    return entry;
  });
}

function missingBuildOutputs({ root = ROOT, required } = {}) {
  return resolveOutputs(required).filter((entry) => !fs.existsSync(path.join(root, entry.file)));
}

function buildMissingMessage(missing) {
  return [
    'TypeScript build output is missing:',
    ...missing.map((entry) => `  - ${entry.file} (used by ${entry.usedBy})`),
    'Run "npm run build" before starting the app or using a CLI/adapter.',
  ].join('\n');
}

function assertBuildOutput(options = {}) {
  const missing = missingBuildOutputs(options);
  if (missing.length === 0) return;
  const error = new Error(buildMissingMessage(missing));
  error.code = 'BUILD_OUTPUT_MISSING';
  error.publicMessage = error.message;
  error.missing = missing.map((entry) => entry.file);
  throw error;
}

if (require.main === module) {
  try {
    assertBuildOutput();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  BUILD_OUTPUTS,
  STARTUP_OUTPUTS,
  assertBuildOutput,
  buildMissingMessage,
  missingBuildOutputs,
};
