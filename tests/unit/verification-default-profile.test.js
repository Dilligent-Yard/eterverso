'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DEFAULT_PROFILE,
  DEFAULT_RUN_ID,
  DEFAULT_VOLUME,
  assertContainerOwnership,
  defaultComposeEnvironment,
} = require('../../scripts/test-env');

const SECRETS = {
  ETERVERSO_TEST_DB_PASSWORD: 'a'.repeat(64),
  ETERVERSO_TEST_DB_PORT: '55433',
};

const DATA_MOUNT = Object.freeze({
  Type: 'volume',
  Name: DEFAULT_VOLUME,
  Source: `/var/lib/docker/volumes/${DEFAULT_VOLUME}/_data`,
  Destination: '/var/lib/postgresql/data',
  RW: true,
});

function defaultContainer(overrides = {}, mounts = [DATA_MOUNT]) {
  return {
    Name: '/eterverso-test-db-1',
    Config: {
      Labels: {
        'com.docker.compose.project': 'eterverso-test',
        'com.docker.compose.service': 'db',
        'io.eterverso.purpose': 'isolated-test',
        'io.eterverso.profile': DEFAULT_PROFILE,
        'io.eterverso.run': DEFAULT_RUN_ID,
        ...overrides,
      },
    },
    Mounts: mounts,
  };
}

function preLabelLegacyContainer() {
  const container = defaultContainer();
  delete container.Config.Labels['io.eterverso.profile'];
  delete container.Config.Labels['io.eterverso.run'];
  return container;
}

test('default Compose environment pins legacy volume/profile/run over ambient isolated values', () => {
  const environment = defaultComposeEnvironment({
    PATH: '/usr/bin',
    COMPOSE_PROJECT_NAME: 'eterverso-wm-someone',
    ETERVERSO_TEST_DB_PASSWORD: 'b'.repeat(64),
    ETERVERSO_TEST_DB_PORT: '59999',
    ETERVERSO_TEST_VOLUME: 'eterverso-wm-someone-test-data',
    ETERVERSO_TEST_PROFILE: 'isolated',
    ETERVERSO_TEST_RUN_ID: 'someone',
  }, SECRETS);

  assert.equal(environment.PATH, '/usr/bin');
  assert.equal(environment.COMPOSE_PROJECT_NAME, 'eterverso-test');
  assert.equal(environment.ETERVERSO_TEST_DB_PASSWORD, SECRETS.ETERVERSO_TEST_DB_PASSWORD);
  assert.equal(environment.ETERVERSO_TEST_DB_PORT, SECRETS.ETERVERSO_TEST_DB_PORT);
  assert.equal(environment.ETERVERSO_TEST_VOLUME, DEFAULT_VOLUME);
  assert.equal(environment.ETERVERSO_TEST_VOLUME, 'eterverso-test-data');
  assert.equal(environment.ETERVERSO_TEST_PROFILE, DEFAULT_PROFILE);
  assert.equal(environment.ETERVERSO_TEST_PROFILE, 'development');
  assert.equal(environment.ETERVERSO_TEST_RUN_ID, DEFAULT_RUN_ID);
  assert.equal(environment.ETERVERSO_TEST_RUN_ID, 'legacy');
});

test('default Compose environment refuses missing private credentials instead of interpolating', () => {
  assert.throws(() => defaultComposeEnvironment({}, null), /Private test configuration is missing/u);
  assert.throws(() => defaultComposeEnvironment({}, { ETERVERSO_TEST_DB_PORT: '55433' }), /Private test configuration is missing/u);
  assert.throws(() => defaultComposeEnvironment({}, { ETERVERSO_TEST_DB_PASSWORD: '' }), /Private test configuration is missing/u);
});

test('default ownership accepts the actual pre-label legacy container with its exact data volume', () => {
  assert.doesNotThrow(() => assertContainerOwnership(null));
  assert.doesNotThrow(() => assertContainerOwnership(defaultContainer()));
  const legacy = preLabelLegacyContainer();
  assert.equal(legacy.Config.Labels['io.eterverso.profile'], undefined);
  assert.equal(legacy.Config.Labels['io.eterverso.run'], undefined);
  assert.doesNotThrow(() => assertContainerOwnership(legacy));
});

test('default ownership rejects partial or foreign profile/run labels', () => {
  const profileOnly = preLabelLegacyContainer();
  profileOnly.Config.Labels['io.eterverso.profile'] = DEFAULT_PROFILE;
  assert.throws(() => assertContainerOwnership(profileOnly), /partial or foreign profile\/run labels/u);
  const runOnly = preLabelLegacyContainer();
  runOnly.Config.Labels['io.eterverso.run'] = DEFAULT_RUN_ID;
  assert.throws(() => assertContainerOwnership(runOnly), /partial or foreign profile\/run labels/u);
  assert.throws(
    () => assertContainerOwnership(defaultContainer({ 'io.eterverso.profile': 'isolated' })),
    /partial or foreign profile\/run labels/u,
  );
  assert.throws(
    () => assertContainerOwnership(defaultContainer({ 'io.eterverso.run': 'someone' })),
    /partial or foreign profile\/run labels/u,
  );
  assert.throws(
    () => assertContainerOwnership(defaultContainer({ 'io.eterverso.profile': 'development', 'io.eterverso.run': 'someone' })),
    /partial or foreign profile\/run labels/u,
  );
});

test('default ownership rejects foreign, bind, missing and ambiguous data mounts even with legacy labels', () => {
  const foreignVolume = [{
    ...DATA_MOUNT,
    Name: 'eterverso-wm-someone-test-data',
    Source: '/var/lib/docker/volumes/eterverso-wm-someone-test-data/_data',
  }];
  assert.throws(
    () => assertContainerOwnership(defaultContainer({}, foreignVolume)),
    /foreign or bind mount/u,
  );
  assert.throws(
    () => assertContainerOwnership(defaultContainer({}, [{
      Type: 'bind',
      Source: '/tmp/foreign-data',
      Destination: '/var/lib/postgresql/data',
      RW: true,
    }])),
    /foreign or bind mount/u,
  );
  assert.throws(
    () => assertContainerOwnership(defaultContainer({}, [])),
    /exactly one data mount/u,
  );
  const missingMounts = defaultContainer();
  delete missingMounts.Mounts;
  assert.throws(() => assertContainerOwnership(missingMounts), /exactly one data mount/u);
  assert.throws(
    () => assertContainerOwnership(defaultContainer({}, [
      DATA_MOUNT,
      { ...DATA_MOUNT, Name: 'eterverso-wm-someone-test-data' },
    ])),
    /exactly one data mount/u,
  );
  assert.throws(
    () => assertContainerOwnership(defaultContainer({}, [{
      ...DATA_MOUNT,
      Destination: '/var/lib/postgresql',
    }])),
    /exactly one data mount/u,
  );
});

test('default ownership still rejects a container that is not the fixed project service', () => {
  assert.throws(
    () => assertContainerOwnership({ ...preLabelLegacyContainer(), Name: '/foreign-db-1' }),
    /does not own/u,
  );
  assert.throws(
    () => assertContainerOwnership(defaultContainer({ 'com.docker.compose.project': 'eterverso-wm-someone' })),
    /does not own/u,
  );
  assert.throws(
    () => assertContainerOwnership(defaultContainer({ 'io.eterverso.purpose': 'other' })),
    /does not own/u,
  );
});
