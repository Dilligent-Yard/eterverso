'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  BUILD_OUTPUTS,
  STARTUP_OUTPUTS,
  assertBuildOutput,
  buildMissingMessage,
  missingBuildOutputs,
} = require('../../scripts/check-build');

const EXPECTED_OUTPUTS = [
  '.generated/node/runtime/config.js',
  '.generated/node/interactions/index.js',
  '.generated/node/timeline/index.js',
  '.generated/node/public-sandbox/lifecycle/index.js',
  '.generated/node/public-sandbox/target.js',
  '.generated/node/public-sandbox/import/index.js',
  '.generated/node/public-snapshot/index.js',
  'generated/client/vault.js',
];

function tempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eterverso-check-build-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('BUILD-01 checks every canonical startup and adapter entry point', () => {
  assert.deepEqual(BUILD_OUTPUTS.map((entry) => entry.file), EXPECTED_OUTPUTS);
  assert.deepEqual(STARTUP_OUTPUTS, ['runtimeConfig', 'interactions', 'timeline']);
});

test('BUILD-02 current repository satisfies the complete check', () => {
  assert.deepEqual(missingBuildOutputs(), []);
  assert.doesNotThrow(() => assertBuildOutput());
});

test('BUILD-03 reports every missing file and the exact build command', (t) => {
  const root = tempRoot(t);
  const missing = missingBuildOutputs({ root });
  assert.deepEqual(missing.map((entry) => entry.file), EXPECTED_OUTPUTS);

  const message = buildMissingMessage(missing);
  for (const file of EXPECTED_OUTPUTS) assert.ok(message.includes(file), `message omits ${file}`);
  assert.match(message, /Run "npm run build"/);

  assert.throws(() => assertBuildOutput({ root }), (error) => {
    assert.equal(error.code, 'BUILD_OUTPUT_MISSING');
    assert.equal(error.publicMessage, error.message);
    assert.deepEqual(error.missing, EXPECTED_OUTPUTS);
    return true;
  });
});

test('BUILD-04 validates only a requested adapter subset', (t) => {
  const root = tempRoot(t);
  fs.mkdirSync(path.join(root, '.generated/node/runtime'), { recursive: true });
  fs.writeFileSync(path.join(root, '.generated/node/runtime/config.js'), '');

  assert.deepEqual(missingBuildOutputs({ root, required: ['runtimeConfig'] }), []);
  assert.doesNotThrow(() => assertBuildOutput({ root, required: ['runtimeConfig'] }));
  assert.throws(
    () => assertBuildOutput({ root, required: ['timeline'] }),
    /\.generated\/node\/timeline\/index\.js/,
  );
});
