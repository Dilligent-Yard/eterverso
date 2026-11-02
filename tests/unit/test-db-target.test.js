'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assertSafeTestTarget } = require('../../scripts/test-db-target');

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

test('ENV-01 accepts only the owned loopback PostgreSQL test service', () => {
  assert.deepEqual(assertSafeTestTarget(base), {
    database: 'eterverso_test',
    host: '127.0.0.1',
    port: 55433,
    project: 'eterverso-test',
    service: 'db',
  });
});

test('ENV-01 refuses missing and development DSNs before a runner receives a target', () => {
  assert.throws(() => assertSafeTestTarget({ ...base, testDatabaseUrl: undefined }), /required/);
  assert.throws(() => assertSafeTestTarget({
    ...base,
    testDatabaseUrl: base.devDatabaseUrl,
    devDatabaseUrl: 'postgres://other:secret@127.0.0.1:55432/other',
    expectedPort: 55432,
  }), /database name/);
  assert.throws(() => assertSafeTestTarget({ ...base, devDatabaseUrl: base.testDatabaseUrl }), /identical/);
});

test('ENV-01 refuses wrong host, port, database marker, container or service ownership', () => {
  assert.throws(() => assertSafeTestTarget({
    ...base,
    testDatabaseUrl: 'postgres://eterverso_test:secret@localhost:55433/eterverso_test',
  }), /127.0.0.1/);
  assert.throws(() => assertSafeTestTarget({
    ...base,
    testDatabaseUrl: 'postgres://eterverso_test:secret@127.0.0.1:55434/eterverso_test',
  }), /port/);
  assert.throws(() => assertSafeTestTarget({
    ...base,
    testDatabaseUrl: 'postgres://eterverso_test:secret@127.0.0.1:55433/eterverso',
  }), /database name/);
  assert.throws(() => assertSafeTestTarget({
    ...base,
    service: { ...base.service, Config: { Labels: {} } },
  }), /ownership labels/);
  assert.throws(() => assertSafeTestTarget({
    ...base,
    service: { ...base.service, State: { Running: false } },
  }), /not running/);
});
