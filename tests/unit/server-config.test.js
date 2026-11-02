'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readConfig } = require('../../server');

function baseEnv(overrides = {}) {
  return {
    DATABASE_URL: 'postgres://localhost/eterverso',
    SESSION_SECRET: 'unit-test-secret',
    ...overrides,
  };
}

test('development config has a stable local origin and insecure local cookie setting', () => {
  assert.deepEqual(readConfig(baseEnv()), {
    databaseUrl: 'postgres://localhost/eterverso',
    sessionSecret: 'unit-test-secret',
    secureCookies: false,
    production: false,
    publicOrigin: 'http://localhost:3000',
    port: 3000,
  });
});

test('production requires an explicit clean HTTP(S) origin and secures cookies', () => {
  assert.throws(() => readConfig(baseEnv({ NODE_ENV: 'production' })), /APP_ORIGIN must be explicitly configured/);
  assert.deepEqual(readConfig(baseEnv({ NODE_ENV: 'production', APP_ORIGIN: 'https://vault.example.test' })), {
    databaseUrl: 'postgres://localhost/eterverso',
    sessionSecret: 'unit-test-secret',
    secureCookies: true,
    production: true,
    publicOrigin: 'https://vault.example.test',
    port: 3000,
  });
  assert.throws(() => readConfig(baseEnv({ APP_ORIGIN: 'https://vault.example.test/path' })), /HTTP\(S\) origin/);
});
