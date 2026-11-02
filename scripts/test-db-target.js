'use strict';

const PROJECT = 'eterverso-test';
const SERVICE = 'db';
const DATABASE = 'eterverso_test';
const USER = 'eterverso_test';

function assertSafeTestTarget(input) {
  const {
    testDatabaseUrl,
    devDatabaseUrl,
    expectedPort,
    service,
  } = input || {};

  if (typeof testDatabaseUrl !== 'string' || !testDatabaseUrl.trim()) {
    throw new Error('TEST_DATABASE_URL is required; refusing to use the development default.');
  }
  if (typeof devDatabaseUrl !== 'string' || !devDatabaseUrl.trim()) {
    throw new Error('Could not establish the development DSN for a safe comparison.');
  }
  if (testDatabaseUrl === devDatabaseUrl) {
    throw new Error('Test and development database URLs are identical.');
  }

  let target;
  let development;
  try {
    target = new URL(testDatabaseUrl);
    development = new URL(devDatabaseUrl);
  } catch {
    throw new Error('Both test and development database URLs must be valid PostgreSQL URLs.');
  }

  if (!['postgres:', 'postgresql:'].includes(target.protocol)) {
    throw new Error('Test database URL must use PostgreSQL.');
  }
  if (target.hostname !== '127.0.0.1') {
    throw new Error('Test database must be bound to 127.0.0.1.');
  }
  if (!Number.isInteger(expectedPort) || expectedPort < 1 || Number(target.port) !== expectedPort) {
    throw new Error('Test database port does not match the private test environment record.');
  }
  if (decodeURIComponent(target.pathname.slice(1)) !== DATABASE) {
    throw new Error('Test database name does not match the isolated test marker.');
  }
  if (decodeURIComponent(target.username) !== USER) {
    throw new Error('Test database user does not match the isolated test marker.');
  }
  if (target.hostname === development.hostname
      && target.port === development.port
      && target.pathname === development.pathname
      && target.username === development.username) {
    throw new Error('Test database resolves to the development database.');
  }

  const expectedName = `/${PROJECT}-${SERVICE}-1`;
  if (!service || service.Name !== expectedName || service.State?.Running !== true) {
    throw new Error('Expected isolated test PostgreSQL container is not running.');
  }
  const labels = service.Config?.Labels || {};
  if (labels['com.docker.compose.project'] !== PROJECT
      || labels['com.docker.compose.service'] !== SERVICE
      || labels['io.eterverso.purpose'] !== 'isolated-test') {
    throw new Error('PostgreSQL container ownership labels do not match the test project.');
  }
  const bindings = service.NetworkSettings?.Ports?.['5432/tcp'];
  const matchesPort = Array.isArray(bindings) && bindings.some((binding) => (
    binding.HostIp === '127.0.0.1' && Number(binding.HostPort) === expectedPort
  ));
  if (!matchesPort) {
    throw new Error('PostgreSQL container port binding does not match the private test environment record.');
  }

  return {
    database: DATABASE,
    host: target.hostname,
    port: expectedPort,
    project: PROJECT,
    service: SERVICE,
  };
}

module.exports = { assertSafeTestTarget, DATABASE, PROJECT, SERVICE, USER };
