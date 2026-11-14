'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  SCRATCH_NAME_PATTERNS,
  assertIsolatedTarget,
  assertProhibitedEndpoint,
  assertGeneratedScratchDatabaseName,
  assertScratchDatabaseName,
  assertServiceIdentity,
  assertServiceOwnership,
  deriveRunIdentity,
  parsePostgresUrl,
  quoteIdentifier,
  sameEndpoint,
  sameTarget,
  scratchDatabaseName,
  validateRunId,
} = require('../../.generated/node/devtools/verification/index.js');

const target = {
  host: '127.0.0.1',
  port: 56001,
  database: 'eterverso_test',
  user: 'eterverso_test',
  sentinelDatabase: 'eterverso_test_sentinel',
  project: 'eterverso-wm-run1',
  service: 'db',
  runId: 'run1',
};

const service = {
  Name: '/eterverso-wm-run1-db-1',
  State: { Running: true },
  Config: {
    Image: 'postgres:17-alpine',
    Labels: {
      'com.docker.compose.project': 'eterverso-wm-run1',
      'com.docker.compose.service': 'db',
      'io.eterverso.purpose': 'isolated-test',
      'io.eterverso.profile': 'isolated',
      'io.eterverso.run': 'run1',
    },
  },
  NetworkSettings: { Ports: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '56001' }] } },
};

test('run IDs are bounded lowercase identities', () => {
  assert.equal(validateRunId('a'), 'a');
  assert.equal(validateRunId('run-01'), 'run-01');
  assert.equal(validateRunId('a'.repeat(32)), 'a'.repeat(32));
  for (const value of ['', 'A', 'run_01', '-run', 'run-', 'a'.repeat(33), '_', 7, null]) {
    assert.throws(() => validateRunId(value), /Run ID/u, String(value));
  }
  assert.deepEqual(deriveRunIdentity('run1'), {
    runId: 'run1',
    project: 'eterverso-wm-run1',
    service: 'db',
    container: '/eterverso-wm-run1-db-1',
    volume: 'eterverso-wm-run1-test-data',
    network: 'eterverso-wm-run1_default',
    profile: 'isolated',
  });
});

test('PostgreSQL URLs normalize spelling but keep endpoint and user identity', () => {
  const left = parsePostgresUrl('postgresql://eterverso_test:secret@localhost:56001/eterverso_test?sslmode=disable');
  const right = parsePostgresUrl('postgres://other:different@127.0.0.1:56001/eterverso_test');
  assert.equal(left.host, '127.0.0.1');
  assert.equal(left.port, 56001);
  assert.equal(left.database, 'eterverso_test');
  assert.equal(left.username, 'eterverso_test');
  assert.equal(sameEndpoint(left, right), true);
  assert.equal(sameTarget(left, right), false);
  assert.deepEqual(parsePostgresUrl('postgres://user@127.0.0.1/db').port, 5432);
  assert.equal(parsePostgresUrl('postgres://user:p%40ss@127.0.0.1/db').password, 'p@ss');
  assert.throws(() => parsePostgresUrl(undefined), /required/u);
  assert.throws(() => parsePostgresUrl('mysql://user@127.0.0.1/db'), /PostgreSQL/u);
  assert.throws(() => parsePostgresUrl('not a url'), /valid/u);
  assert.throws(() => parsePostgresUrl('postgres://user@127.0.0.1/'), /database/u);
});

test('endpoint comparison ignores credentials but refuses the development endpoint', () => {
  const dev = parsePostgresUrl('postgres://eterverso:dev-secret@localhost:55432/eterverso');
  const disguised = parsePostgresUrl('postgresql://eterverso_test:other@127.0.0.1:55432/eterverso?connect_timeout=1');
  assert.equal(sameEndpoint(dev, disguised), true);
  assert.throws(() => assertProhibitedEndpoint(disguised, [dev], 'the development database'), /development database/u);
  const isolated = parsePostgresUrl('postgres://eterverso_test:secret@127.0.0.1:56001/eterverso_test');
  assert.doesNotThrow(() => assertProhibitedEndpoint(isolated, [dev], 'the development database'));
});

test('isolated target validation requires the exact endpoint, database and user', () => {
  assert.deepEqual(assertIsolatedTarget({
    databaseUrl: 'postgresql://eterverso_test:secret@127.0.0.1:56001/eterverso_test',
    expected: target,
    service,
  }), {
    host: '127.0.0.1',
    port: 56001,
    database: 'eterverso_test',
    user: 'eterverso_test',
    project: 'eterverso-wm-run1',
    service: 'db',
    runId: 'run1',
    sentinelDatabase: 'eterverso_test_sentinel',
  });
  assert.throws(() => assertIsolatedTarget({ databaseUrl: undefined, expected: target }), /required/u);
  assert.throws(() => assertIsolatedTarget({
    databaseUrl: 'postgres://eterverso_test:secret@192.0.2.10:56001/eterverso_test', expected: target,
  }), /127\.0\.0\.1/u);
  assert.throws(() => assertIsolatedTarget({
    databaseUrl: 'postgres://eterverso_test:secret@127.0.0.1:56002/eterverso_test', expected: target,
  }), /port/u);
  assert.throws(() => assertIsolatedTarget({
    databaseUrl: 'postgres://eterverso_test:secret@127.0.0.1:56001/eterverso', expected: target,
  }), /database name/u);
  assert.throws(() => assertIsolatedTarget({
    databaseUrl: 'postgres://root:secret@127.0.0.1:56001/eterverso_test', expected: target,
  }), /user/u);
  assert.throws(() => assertIsolatedTarget({
    databaseUrl: 'postgres://eterverso_test:secret@127.0.0.1:56001/eterverso_test',
    expected: { ...target, sentinelDatabase: 'eterverso_test' },
  }), /sentinel/u);
  assert.throws(() => assertIsolatedTarget({
    databaseUrl: 'postgres://eterverso_test:secret@127.0.0.1:56001/eterverso_test',
    expected: target,
    prohibitedUrls: [{ url: parsePostgresUrl('postgres://dev:different@localhost:56001/eterverso_test'), label: 'the development database' }],
  }), /development database/u);
});

test('service identity separates ownership from running-state readiness', () => {
  assert.doesNotThrow(() => assertServiceIdentity(service, {
    container: '/eterverso-wm-run1-db-1', project: 'eterverso-wm-run1', runId: 'run1', port: 56001,
  }));
  const stopped = { ...service, State: { Running: false } };
  assert.doesNotThrow(() => assertServiceOwnership(stopped, {
    container: '/eterverso-wm-run1-db-1', project: 'eterverso-wm-run1', runId: 'run1', port: 56001,
  }));
  assert.throws(() => assertServiceIdentity(stopped, {
    container: '/eterverso-wm-run1-db-1', project: 'eterverso-wm-run1', runId: 'run1', port: 56001,
  }), /not running/u);
  assert.throws(() => assertServiceOwnership({
    ...stopped,
    Config: { ...stopped.Config, Labels: { ...stopped.Config.Labels, 'io.eterverso.run': 'other' } },
  }, {
    container: '/eterverso-wm-run1-db-1', project: 'eterverso-wm-run1', runId: 'run1', port: 56001,
  }), /ownership label/u);
  const variants = [
    [{ ...service, Name: '/eterverso-test-db-1' }, /Container name/u],
    [{ ...service, State: { Running: false } }, /not running/u],
    [{ ...service, Config: { ...service.Config, Image: 'postgres:16-alpine' } }, /PostgreSQL 17/u],
    [{ ...service, Config: { ...service.Config, Labels: { ...service.Config.Labels, 'io.eterverso.run': 'other' } } }, /ownership label/u],
    [{ ...service, Config: { ...service.Config, Labels: { ...service.Config.Labels, 'io.eterverso.purpose': 'historical-sandbox' } } }, /ownership label/u],
    [{ ...service, NetworkSettings: { Ports: { '5432/tcp': [{ HostIp: '0.0.0.0', HostPort: '56001' }] } } }, /loopback/u],
    [{ ...service, NetworkSettings: { Ports: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '56002' }] } } }, /loopback/u],
  ];
  for (const [variant, pattern] of variants) {
    assert.throws(() => assertServiceIdentity(variant, {
      container: '/eterverso-wm-run1-db-1', project: 'eterverso-wm-run1', runId: 'run1', port: 56001,
    }), pattern);
  }
});

test('scratch database names are generated only within their guarded patterns', () => {
  for (const kind of Object.keys(SCRATCH_NAME_PATTERNS)) {
    const name = scratchDatabaseName(kind, '0123456789abcdef');
    assert.match(name, SCRATCH_NAME_PATTERNS[kind]);
    assert.equal(assertScratchDatabaseName(kind, name), name);
    assert.throws(() => assertScratchDatabaseName(kind, 'eterverso_test'), /scratch-name/u);
    assert.throws(() => assertScratchDatabaseName(kind, `eterverso_test_${kind}; DROP DATABASE`), /scratch-name/u);
  }
  assert.equal(assertGeneratedScratchDatabaseName('eterverso_test_mig03_0123456789abcdef'), 'eterverso_test_mig03_0123456789abcdef');
  assert.throws(() => assertGeneratedScratchDatabaseName('eterverso_test'), /scratch-name patterns/u);
  assert.throws(() => assertGeneratedScratchDatabaseName('eterverso_test_sentinel'), /scratch-name patterns/u);
  assert.throws(() => assertGeneratedScratchDatabaseName('other_0123456789abcdef'), /scratch-name patterns/u);
  assert.equal(quoteIdentifier('safe_name'), '"safe_name"');
  assert.equal(quoteIdentifier('has"quote'), '"has""quote"');
});
