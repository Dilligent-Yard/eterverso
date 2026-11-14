'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { assertSafeTestTarget } = require('../../scripts/test-db-target');
const { parseIsolationArguments } = require('../../scripts/test-isolation');
const { parseRunnerArguments, testChildEnvironment } = require('../../scripts/test-runner');

const base = {
  testDatabaseUrl: 'postgres://eterverso_test:secret@127.0.0.1:55433/eterverso_test',
  devDatabaseUrl: 'postgres://eterverso:secret@127.0.0.1:55432/eterverso',
  expectedPort: 55433,
  service: {
    Name: '/eterverso-test-db-1',
    State: { Running: true },
    Config: { Labels: {
      'com.docker.compose.project': 'eterverso-test',
      'com.docker.compose.service': 'db',
      'io.eterverso.purpose': 'isolated-test',
    } },
    NetworkSettings: { Ports: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '55433' }] } },
  },
};

test('default local target protection remains unchanged', () => {
  assert.deepEqual(assertSafeTestTarget(base), {
    database: 'eterverso_test',
    host: '127.0.0.1',
    port: 55433,
    project: 'eterverso-test',
    service: 'db',
  });
  assert.throws(() => assertSafeTestTarget({
    ...base,
    testDatabaseUrl: 'postgresql://eterverso_test:different@127.0.0.1:55432/eterverso?sslmode=disable',
    expectedPort: 55432,
  }), /database name/u);
  assert.throws(() => assertSafeTestTarget({ ...base, devDatabaseUrl: base.testDatabaseUrl }), /identical/u);
  assert.throws(() => assertSafeTestTarget({ ...base, service: { ...base.service, Config: { Labels: {} } } }), /ownership labels/u);
});

test('isolated arguments require an explicit bounded run and isolate failures to setup', () => {
  assert.deepEqual(parseIsolationArguments(['up', '--run=run1', '--sentinel=isolated']), {
    command: 'up', runId: 'run1', forceFailureAfterUp: false, forceFailureAfterStop: false, forceFailureBeforeCompose: false, json: false,
  });
  assert.deepEqual(parseIsolationArguments(['assert', '--run=run1', '--json']), {
    command: 'assert', runId: 'run1', forceFailureAfterUp: false, forceFailureAfterStop: false, forceFailureBeforeCompose: false, json: true,
  });
  assert.equal(parseIsolationArguments(['up', '--run=run1', '--force-failure-after-stop']).forceFailureAfterStop, true);
  assert.equal(parseIsolationArguments(['up', '--run=run1', '--force-failure-before-compose']).forceFailureBeforeCompose, true);
  assert.throws(() => parseIsolationArguments([
    'up', '--run=run1', '--force-failure-after-up', '--force-failure-after-stop',
  ]), /only one injected setup failure/u);
  assert.equal(parseIsolationArguments(['down', '--run=run1']).command, 'down');
  assert.equal(parseIsolationArguments(['fingerprint', '--run=run1']).command, 'fingerprint');
  assert.equal(parseIsolationArguments(['sentinel-mutation-probe', '--run=run1']).command, 'sentinel-mutation-probe');
  assert.throws(() => parseIsolationArguments([]), /Usage/u);
  assert.throws(() => parseIsolationArguments(['up']), /explicit --run/u);
  assert.throws(() => parseIsolationArguments(['up', '--run=run1', '--sentinel=development']), /isolated/u);
  assert.throws(() => parseIsolationArguments(['down', '--run=run1', '--force-failure-after-up']), /only available for setup/u);
  assert.throws(() => parseIsolationArguments(['assert', '--run=run1', '--unknown']), /Unknown/u);
});

test('runner arguments keep development as the default and require a run for isolation', () => {
  assert.deepEqual(parseRunnerArguments(['integration']), {
    command: 'integration', sentinel: 'development', runId: undefined,
  });
  assert.deepEqual(parseRunnerArguments(['browser', '--sentinel=isolated', '--run=run1']), {
    command: 'browser', sentinel: 'isolated', runId: 'run1',
  });
  assert.throws(() => parseRunnerArguments(['integration', '--sentinel=isolated']), /requires an explicit/u);
  assert.throws(() => parseRunnerArguments(['integration', '--run=run1']), /only accepted/u);
  assert.throws(() => parseRunnerArguments(['integration', '--sentinel=other']), /Choose/u);
  assert.throws(() => parseRunnerArguments(['other']), /Usage/u);
});

test('child environments strip development targets and pass only the explicit run', () => {
  const original = { ...process.env };
  try {
    process.env.DATABASE_URL = 'postgres://dev';
    process.env.DEV_DATABASE_URL = 'postgres://dev2';
    process.env.ETERVERSO_VERIFY_PROFILE = 'isolated';
    process.env.ETERVERSO_VERIFY_RUN_ID = 'stale';
    const isolated = testChildEnvironment('postgres://test', { runId: 'run1', port: 56001 });
    assert.equal(isolated.DATABASE_URL, undefined);
    assert.equal(isolated.DEV_DATABASE_URL, undefined);
    assert.equal(isolated.ETERVERSO_TEST_DATABASE_URL, 'postgres://test');
    assert.equal(isolated.ETERVERSO_VERIFY_PROFILE, 'isolated');
    assert.equal(isolated.ETERVERSO_VERIFY_RUN_ID, 'run1');
    assert.equal(isolated.ETERVERSO_TEST_DB_PORT, '56001');
    const development = testChildEnvironment('postgres://test');
    assert.equal(development.ETERVERSO_VERIFY_PROFILE, undefined);
    assert.equal(development.ETERVERSO_VERIFY_RUN_ID, undefined);
    assert.equal(development.ETERVERSO_TEST_DB_PORT, undefined);
  } finally {
    for (const key of ['DATABASE_URL', 'DEV_DATABASE_URL', 'ETERVERSO_VERIFY_PROFILE', 'ETERVERSO_VERIFY_RUN_ID', 'ETERVERSO_TEST_DATABASE_URL', 'ETERVERSO_TEST_DB_PORT']) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
});
