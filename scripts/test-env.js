'use strict';

const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const dotenv = require('dotenv');
const { assertSafeTestTarget, PROJECT } = require('./test-db-target');

const ROOT = path.resolve(__dirname, '..');
const LOCAL = path.join(ROOT, '.local', 'test');
const SECRETS_FILE = path.join(LOCAL, 'postgres.env');
const CONNECTION_FILE = path.join(LOCAL, 'connection.env');
const RECORD_FILE = path.join(LOCAL, 'service.json');
const COMPOSE_FILE = path.join(ROOT, 'compose.test.yaml');
const CONTAINER_NAME = `/${PROJECT}-db-1`;
const DEFAULT_PORT = 55433;

function readEnvFile(file) {
  return fs.existsSync(file) ? dotenv.parse(fs.readFileSync(file)) : null;
}

function writePrivate(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(file), 0o700);
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, value, { mode: 0o600, flag: 'wx' });
  fs.renameSync(temporary, file);
  fs.chmodSync(file, 0o600);
}

async function portIsFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

async function choosePort() {
  for (let port = DEFAULT_PORT; port <= 55999; port += 1) {
    if (port === 55432) continue;
    if (await portIsFree(port)) return port;
  }
  throw new Error('No free loopback port was found in 55433–55999 for the test database.');
}

function loadDevDsn() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) {
    throw new Error('The existing .env file is missing; test setup will not create or replace it.');
  }
  const parsed = dotenv.parse(fs.readFileSync(envPath));
  if (!parsed.DATABASE_URL) throw new Error('.env does not define DATABASE_URL.');
  return parsed.DATABASE_URL;
}

function inspectContainer() {
  try {
    const output = execFileSync('docker', ['inspect', CONTAINER_NAME], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return JSON.parse(output)[0];
  } catch {
    return null;
  }
}

function assertContainerOwnership(container) {
  if (!container) return;
  const labels = container.Config?.Labels || {};
  if (container.Name !== CONTAINER_NAME
      || labels['com.docker.compose.project'] !== PROJECT
      || labels['com.docker.compose.service'] !== 'db'
      || labels['io.eterverso.purpose'] !== 'isolated-test') {
    throw new Error(`Container name ${CONTAINER_NAME} is occupied by a service this project does not own; refusing to alter it.`);
  }
}

function writeInitialCredentials() {
  const secretsExists = fs.existsSync(SECRETS_FILE);
  const connectionExists = fs.existsSync(CONNECTION_FILE);
  if (secretsExists || connectionExists) {
    if (!secretsExists || !connectionExists) {
      throw new Error('Private test configuration is incomplete; inspect .local/test without replacing existing credentials.');
    }
    fs.chmodSync(SECRETS_FILE, 0o600);
    fs.chmodSync(CONNECTION_FILE, 0o600);
    return;
  }

  const port = DEFAULT_PORT;
  const password = crypto.randomBytes(32).toString('hex');
  writePrivate(SECRETS_FILE, `ETERVERSO_TEST_DB_PASSWORD=${password}\nETERVERSO_TEST_DB_PORT=${port}\n`);
  writePrivate(CONNECTION_FILE, `ETERVERSO_TEST_DATABASE_URL=postgres://eterverso_test:${password}@127.0.0.1:${port}/eterverso_test\n`);
}

async function ensurePortAndConfig(existingContainer) {
  const secrets = readEnvFile(SECRETS_FILE);
  const connection = readEnvFile(CONNECTION_FILE);
  const password = secrets?.ETERVERSO_TEST_DB_PASSWORD;
  let port = Number(secrets?.ETERVERSO_TEST_DB_PORT);
  if (!password || !Number.isInteger(port) || !connection?.ETERVERSO_TEST_DATABASE_URL) {
    throw new Error('Private test database configuration is invalid; refusing to regenerate it.');
  }

  if (existingContainer) return;
  if (!(await portIsFree(port))) {
    port = await choosePort();
    const nextDsn = `postgres://eterverso_test:${password}@127.0.0.1:${port}/eterverso_test`;
    writePrivate(SECRETS_FILE, `ETERVERSO_TEST_DB_PASSWORD=${password}\nETERVERSO_TEST_DB_PORT=${port}\n`);
    writePrivate(CONNECTION_FILE, `ETERVERSO_TEST_DATABASE_URL=${nextDsn}\n`);
  }
}

function compose(args) {
  const env = path.relative(ROOT, SECRETS_FILE);
  return execFileSync('docker', [
    'compose', '--project-name', PROJECT, '-f', COMPOSE_FILE,
    '--env-file', env, ...args,
  ], { cwd: ROOT, encoding: 'utf8', stdio: 'inherit' });
}

function validateCurrentTarget({ requireRunning = true } = {}) {
  const secrets = readEnvFile(SECRETS_FILE);
  const connection = readEnvFile(CONNECTION_FILE);
  if (!secrets || !connection) throw new Error('Run npm run test:env:up to create the isolated test environment first.');
  const container = inspectContainer();
  assertContainerOwnership(container);
  const service = container && {
    Name: container.Name,
    State: container.State,
    Config: container.Config,
    NetworkSettings: container.NetworkSettings,
  };
  if (requireRunning && !container?.State?.Running) {
    throw new Error('Isolated test PostgreSQL is not running; run npm run test:env:up.');
  }
  const devDsn = loadDevDsn();
  return assertSafeTestTarget({
    testDatabaseUrl: connection.ETERVERSO_TEST_DATABASE_URL,
    devDatabaseUrl: devDsn,
    expectedPort: Number(secrets.ETERVERSO_TEST_DB_PORT),
    service,
  });
}

async function up() {
  fs.mkdirSync(LOCAL, { recursive: true, mode: 0o700 });
  fs.chmodSync(LOCAL, 0o700);
  writeInitialCredentials();
  const existing = inspectContainer();
  assertContainerOwnership(existing);
  await ensurePortAndConfig(existing);
  compose(['up', '-d', '--wait']);
  const target = validateCurrentTarget();
  writePrivate(RECORD_FILE, JSON.stringify({
    project: PROJECT,
    container: CONTAINER_NAME,
    host: target.host,
    port: target.port,
    database: target.database,
    createdAt: new Date().toISOString(),
  }, null, 2) + '\n');
  console.log(`Isolated test PostgreSQL is ready at ${target.host}:${target.port}/${target.database}.`);
}

function down() {
  const existing = inspectContainer();
  if (!existing) {
    console.log('No owned isolated test container is present.');
    return;
  }
  assertContainerOwnership(existing);
  compose(['down']);
  console.log('Stopped and removed the isolated test container; its test-only named volume remains.');
}

function assertTarget() {
  const target = validateCurrentTarget();
  process.stdout.write(JSON.stringify(target));
}

async function main() {
  const command = process.argv[2];
  if (command === 'up') return up();
  if (command === 'down') return down();
  if (command === 'assert') return assertTarget();
  throw new Error('Usage: node scripts/test-env.js <up|down|assert>');
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
