'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assertNoProhibitedInputs,
  assertPrivateMode,
  buildComposeEnvironment,
  buildRunManifest,
  parseComposeEnvironment,
  parseConnectionEnvironment,
  sentinelUrlFor,
  serializeComposeEnvironment,
  serializeConnectionEnvironment,
  validateRunManifest,
} = require('../../.generated/node/devtools/verification/index.js');

const ROOT = '/tmp/eterverso-verification-root';
const PASSWORD = 'a'.repeat(64);

function manifest(overrides = {}) {
  return { ...buildRunManifest({ runId: 'run1', root: ROOT, port: 56001 }), ...overrides };
}

test('run manifests bind mode, run, root, Compose identity and sentinel state', () => {
  const value = manifest();
  assert.equal(value.phase, 'creating');
  assert.equal(value.project, 'eterverso-wm-run1');
  assert.equal(value.container, '/eterverso-wm-run1-db-1');
  assert.equal(value.volume, 'eterverso-wm-run1-test-data');
  const validated = validateRunManifest(value, { root: ROOT, runId: 'run1' });
  assert.equal(validated.sentinelMarker, value.sentinelMarker);
  assert.equal(validated.sentinelDatabase, 'eterverso_test_sentinel');
  assert.equal(validateRunManifest({ ...value, phase: 'ready' }, { root: ROOT, runId: 'run1', phase: 'ready' }).phase, 'ready');
});

test('run manifest validation refuses cross-run, cross-root and partial state', () => {
  const value = manifest();
  assert.throws(() => validateRunManifest(value, { root: ROOT, runId: 'run2' }), /different run/u);
  assert.throws(() => validateRunManifest(value, { root: '/tmp/other-root', runId: 'run1' }), /different worktree/u);
  assert.throws(() => validateRunManifest({ ...value, project: 'eterverso-test' }, { root: ROOT }), /Compose identity/u);
  assert.throws(() => validateRunManifest({ ...value, container: '/eterverso-test-db-1' }, { root: ROOT }), /Compose identity/u);
  assert.throws(() => validateRunManifest({ ...value, volume: 'eterverso-test-data' }, { root: ROOT }), /Compose identity/u);
  assert.throws(() => validateRunManifest({ ...value, host: '0.0.0.0' }, { root: ROOT }), /127\.0\.0\.1/u);
  assert.throws(() => validateRunManifest({ ...value, port: 80 }, { root: ROOT }), /allowed range/u);
  assert.throws(() => validateRunManifest({ ...value, database: 'eterverso' }, { root: ROOT }), /database or user/u);
  assert.throws(() => validateRunManifest({ ...value, user: 'postgres' }, { root: ROOT }), /database or user/u);
  assert.throws(() => validateRunManifest({ ...value, sentinelDatabase: 'eterverso_test' }, { root: ROOT }), /sentinel/u);
  assert.throws(() => validateRunManifest({ ...value, sentinelTable: 'other' }, { root: ROOT }), /sentinel table/u);
  assert.throws(() => validateRunManifest({ ...value, sentinelMarker: 'x' }, { root: ROOT }), /marker/u);
  assert.throws(() => validateRunManifest({ ...value, phase: 'half' }, { root: ROOT }), /phase/u);
  assert.throws(() => validateRunManifest({ ...value, phase: 'creating' }, { root: ROOT, phase: 'ready' }), /partially written/u);
  assert.throws(() => validateRunManifest({ ...value, version: 2 }, { root: ROOT }), /version/u);
  assert.throws(() => validateRunManifest({ ...value, mode: 'development' }, { root: ROOT }), /isolated/u);
  assert.throws(() => validateRunManifest({ ...value, image: 'postgres:16' }, { root: ROOT }), /PostgreSQL 17/u);
  assert.throws(() => validateRunManifest(null, { root: ROOT }), /missing or malformed/u);
});

test('Compose environment round-trips and refuses mismatched or partial records', () => {
  const value = manifest();
  const environment = buildComposeEnvironment(value, PASSWORD);
  const text = serializeComposeEnvironment(environment);
  assert.deepEqual(parseComposeEnvironment(text, value), environment);
  assert.throws(() => parseComposeEnvironment(text.replace('ETERVERSO_TEST_DB_PORT=56001', 'ETERVERSO_TEST_DB_PORT=56002'), value), /port/u);
  assert.throws(() => parseComposeEnvironment(text.replace('ETERVERSO_TEST_RUN_ID=run1', 'ETERVERSO_TEST_RUN_ID=run2'), value), /identity/u);
  assert.throws(() => parseComposeEnvironment(text.replace('ETERVERSO_TEST_DB_PASSWORD', 'DATABASE_URL'), value), /missing or unexpected/u);
  assert.throws(() => parseComposeEnvironment(`${text}EXTRA=value\n`, value), /missing or unexpected/u);
  assert.throws(() => parseComposeEnvironment(text.replace(PASSWORD, 'short'), value), /password/u);
  assert.throws(() => buildComposeEnvironment(value, 'not-a-password'), /password/u);
});

test('connection records must match the manifest and never point at the sentinel', () => {
  const value = manifest();
  const url = 'postgresql://eterverso_test:secret@127.0.0.1:56001/eterverso_test';
  const parsed = parseConnectionEnvironment(serializeConnectionEnvironment(url), value);
  assert.equal(parsed.database, 'eterverso_test');
  assert.equal(parsed.port, 56001);
  assert.throws(() => parseConnectionEnvironment(
    serializeConnectionEnvironment('postgres://eterverso_test:secret@127.0.0.1:56002/eterverso_test'), value,
  ), /identity/u);
  assert.throws(() => parseConnectionEnvironment(
    serializeConnectionEnvironment('postgres://eterverso_test:secret@127.0.0.1:56001/eterverso_test_sentinel'), value,
  ), /identity/u);
  assert.throws(() => parseConnectionEnvironment(`EXTRA=1\n${serializeConnectionEnvironment(url)}`, value), /unexpected keys/u);
  const sentinel = sentinelUrlFor(url, value);
  assert.equal(new URL(sentinel).pathname, '/eterverso_test_sentinel');
  assert.throws(() => sentinelUrlFor('postgres://eterverso_test:secret@127.0.0.1:56001/other', value), /non-application/u);
});

test('prohibited inputs are refused before any resource is created', () => {
  const exists = (file) => file === `${ROOT}/.env`;
  assert.throws(() => assertNoProhibitedInputs({ root: ROOT, env: {} }, exists), /root \.env/u);
  assert.throws(() => assertNoProhibitedInputs({
    root: ROOT,
    env: { DATABASE_URL: 'postgres://dev', COMPOSE_PROJECT_NAME: 'eterverso-test' },
  }, () => false), /DATABASE_URL, COMPOSE_PROJECT_NAME/u);
  assert.throws(() => assertNoProhibitedInputs({
    root: ROOT,
    env: { ETERVERSO_TEST_DATABASE_URL: 'postgres://test' },
  }, () => false), /ETERVERSO_TEST_DATABASE_URL/u);
  assert.doesNotThrow(() => assertNoProhibitedInputs({
    root: ROOT,
    env: { ETERVERSO_TEST_DATABASE_URL: 'postgres://test' },
  }, () => false, ['DATABASE_URL', 'DEV_DATABASE_URL']));
  assert.doesNotThrow(() => assertNoProhibitedInputs({ root: ROOT, env: { PATH: '/bin' } }, () => false));
});

test('private state modes reject group and world access', () => {
  assert.doesNotThrow(() => assertPrivateMode(0o600, 'file'));
  assert.doesNotThrow(() => assertPrivateMode(0o700, 'directory'));
  assert.throws(() => assertPrivateMode(0o640, 'file'), /too broad/u);
  assert.throws(() => assertPrivateMode(0o701, 'directory'), /too broad/u);
});
