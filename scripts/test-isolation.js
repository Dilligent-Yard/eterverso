'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const postgres = require('postgres');

const ROOT = fs.realpathSync(path.resolve(__dirname, '..'));
const RUNS_ROOT = path.join(ROOT, '.local', 'test', 'runs');
const COMPOSE_FILE = path.join(ROOT, 'compose.test.yaml');
const PORT_MIN = 56000;
const PORT_MAX = 56999;
const USAGE = 'Usage: node scripts/test-isolation.js <up|down|assert|fingerprint|sentinel-mutation-probe> --run=<id>';

function devtools() {
  try {
    return require('../.generated/node/devtools/verification/index.js');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND') {
      throw new Error('Verification devtools are not built; run npm run build:node before the isolated profile.');
    }
    throw error;
  }
}

function parseIsolationArguments(argv) {
  if (!Array.isArray(argv) || argv.length === 0) throw new Error(USAGE);
  const command = argv[0];
  if (!['up', 'down', 'assert', 'fingerprint', 'sentinel-mutation-probe'].includes(command)) {
    throw new Error(USAGE);
  }
  let runId;
  let forceFailureAfterUp = false;
  let forceFailureAfterStop = false;
  let forceFailureBeforeCompose = false;
  let json = false;
  for (const argument of argv.slice(1)) {
    if (argument.startsWith('--run=')) {
      if (runId !== undefined) throw new Error('Run identity was supplied twice.');
      runId = argument.slice('--run='.length);
    } else if (argument === '--force-failure-after-up') {
      if (command !== 'up') throw new Error('The injected failure hook is only available for setup.');
      forceFailureAfterUp = true;
    } else if (argument === '--force-failure-after-stop') {
      if (command !== 'up') throw new Error('The injected stopped-container failure hook is only available for setup.');
      forceFailureAfterStop = true;
    } else if (argument === '--force-failure-before-compose') {
      if (command !== 'up') throw new Error('The injected pre-Compose failure hook is only available for setup.');
      forceFailureBeforeCompose = true;
    } else if (argument === '--json') {
      if (command !== 'assert' && command !== 'fingerprint' && command !== 'sentinel-mutation-probe') {
        throw new Error('JSON output is only available for inspection commands.');
      }
      json = true;
    } else if (argument.startsWith('--sentinel=')) {
      if (argument !== '--sentinel=isolated') throw new Error('Only the isolated sentinel profile can be selected here.');
    } else {
      throw new Error(`Unknown isolated-profile argument: ${argument}`);
    }
  }
  if (!runId) throw new Error(`An explicit --run=<id> is required. ${USAGE}`);
  if ([forceFailureAfterUp, forceFailureAfterStop, forceFailureBeforeCompose].filter(Boolean).length > 1) {
    throw new Error('Choose only one injected setup failure mode.');
  }
  return {
    command,
    runId,
    forceFailureAfterUp,
    forceFailureAfterStop,
    forceFailureBeforeCompose,
    json,
  };
}

function runDirectory(runId) {
  const { validateRunId } = devtools();
  return path.join(RUNS_ROOT, validateRunId(runId));
}

function ensurePrivateDirectory(directory) {
  const stat = fs.lstatSync(directory, { throwIfNoEntry: false });
  if (stat) {
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`Private verification path ${directory} is not a real directory.`);
    }
    fs.chmodSync(directory, 0o700);
    return;
  }
  fs.mkdirSync(directory, { mode: 0o700 });
  fs.chmodSync(directory, 0o700);
}

function createOwnedRunDirectory(directory) {
  // Non-recursive mkdir is the exclusive claim: EEXIST (including a symlink or
  // a concurrent creator) propagates before this invocation owns anything.
  fs.mkdirSync(directory, { mode: 0o700 });
  const stat = fs.lstatSync(directory);
  const ownership = { directory, dev: stat.dev, ino: stat.ino };
  try {
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`Private run state ${directory} is not a real directory; refusing to use it.`);
    }
    fs.chmodSync(directory, 0o700);
    return ownership;
  } catch (error) {
    const cleanupErrors = removeOwnedRunDirectory(ownership);
    const suffix = cleanupErrors.length ? ` Cleanup also failed: ${cleanupErrors.join('; ')}.` : '';
    throw new Error(`${error.message}${suffix}`);
  }
}

function removeOwnedRunDirectory(ownership) {
  if (!ownership) return ['refusing to remove private run state without an ownership identity'];
  const stat = fs.lstatSync(ownership.directory, { throwIfNoEntry: false });
  if (!stat) return [];
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    return [`refusing to remove ${ownership.directory}: it is not the real directory created or loaded by this invocation`];
  }
  if (stat.dev !== ownership.dev || stat.ino !== ownership.ino) {
    return [`refusing to remove ${ownership.directory}: the directory was replaced during setup`];
  }
  try {
    fs.rmSync(ownership.directory, { recursive: true, force: false });
    return [];
  } catch (error) {
    return [`could not remove private run state: ${error.message}`];
  }
}

function writePrivate(file, value) {
  const { assertPrivateMode } = devtools();
  ensurePrivateDirectory(path.dirname(file));
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  const descriptor = fs.openSync(temporary, 'wx', 0o600);
  try {
    fs.writeFileSync(descriptor, value);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temporary, file);
  fs.chmodSync(file, 0o600);
  assertPrivateMode(fs.statSync(file).mode, 'Private verification state file');
  const directoryDescriptor = fs.openSync(path.dirname(file), 'r');
  try {
    fs.fsyncSync(directoryDescriptor);
  } finally {
    fs.closeSync(directoryDescriptor);
  }
}

function writeJsonPrivate(file, value) {
  writePrivate(file, `${JSON.stringify(value, null, 2)}\n`);
}

function readPrivateFile(file) {
  const { assertPrivateMode } = devtools();
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`Private verification state ${file} is not a regular file.`);
  }
  assertPrivateMode(stat.mode, 'Private verification state file');
  return fs.readFileSync(file, 'utf8');
}

function readJsonPrivate(file) {
  const text = readPrivateFile(file);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Private verification state ${file} is not valid JSON; refusing partial state.`);
  }
}

function assertRunDirectory(runId) {
  const { validateRunId, assertPrivateMode } = devtools();
  const id = validateRunId(runId);
  const directory = path.join(RUNS_ROOT, id);
  const stat = fs.lstatSync(directory, { throwIfNoEntry: false });
  if (!stat) throw new Error(`Run ${id} has no recorded private state; run setup first.`);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Run ${id} state is not a real directory; refusing cross-run use.`);
  }
  assertPrivateMode(stat.mode, `Run ${id} state directory`);
  return {
    runId: id,
    directory,
    ownership: { directory, dev: stat.dev, ino: stat.ino },
  };
}

function loadRun(runId, options = {}) {
  const verification = devtools();
  const { directory, ownership } = assertRunDirectory(runId);
  const manifestValue = readJsonPrivate(path.join(directory, 'manifest.json'));
  const manifest = verification.validateRunManifest(manifestValue, {
    root: ROOT,
    runId,
    ...(options.phase ? { phase: options.phase } : {}),
  });
  const composeEnvironment = verification.parseComposeEnvironment(
    readPrivateFile(path.join(directory, 'compose.env')),
    manifest,
  );
  const result = { directory, ownership, manifest, composeEnvironment, databaseUrl: null, target: null };
  const connectionFile = path.join(directory, 'connection.env');
  if (fs.existsSync(connectionFile)) {
    const endpoint = verification.parseConnectionEnvironment(readPrivateFile(connectionFile), manifest);
    result.databaseUrl = endpointToUrl(endpoint);
    result.sentinelUrl = verification.sentinelUrlFor(result.databaseUrl, manifest);
  } else if (options.phase === 'ready') {
    throw new Error('Run state is incomplete: the isolated connection record is missing.');
  }
  result.target = {
    runId: manifest.runId,
    project: manifest.project,
    service: manifest.service,
    container: manifest.container,
    volume: manifest.volume,
    network: manifest.project + '_default',
    host: manifest.host,
    port: manifest.port,
    database: manifest.database,
    sentinelDatabase: manifest.sentinelDatabase,
  };
  return result;
}

function endpointToUrl(endpoint) {
  const url = new URL('postgres://127.0.0.1');
  url.username = endpoint.username;
  if (endpoint.password) url.password = endpoint.password;
  url.port = String(endpoint.port);
  url.pathname = `/${endpoint.database}`;
  return url.toString();
}

function docker(args, options = {}) {
  const result = spawnSync('docker', args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
    env: options.env ?? process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim();
    const error = new Error(`Docker command failed: docker ${args.join(' ')}${stderr ? `: ${stderr}` : ''}`);
    error.status = result.status;
    throw error;
  }
  return (result.stdout || '').trim();
}

function inspectContainer(name) {
  const result = spawnSync('docker', ['inspect', name], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (/no such (?:object|container)/iu.test(result.stderr || '')) return null;
    throw new Error('Could not inspect the isolated test container.');
  }
  const parsed = JSON.parse(result.stdout);
  return Array.isArray(parsed) ? parsed[0] : null;
}

function inspectVolume(name) {
  const result = spawnSync('docker', ['volume', 'inspect', name], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (/no such volume/iu.test(result.stderr || '')) return null;
    throw new Error('Could not inspect the isolated test volume.');
  }
  const parsed = JSON.parse(result.stdout);
  return Array.isArray(parsed) ? parsed[0] : null;
}

function volumeIdentity(volume) {
  if (!volume || typeof volume !== 'object') return null;
  const labels = volume.Labels && typeof volume.Labels === 'object' ? volume.Labels : {};
  return {
    name: typeof volume.Name === 'string' ? volume.Name : '',
    purpose: labels['io.eterverso.purpose'],
    profile: labels['io.eterverso.profile'],
    run: labels['io.eterverso.run'],
  };
}

function inspectNetwork(name) {
  const result = spawnSync('docker', ['network', 'inspect', name], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (/no such network|network .* not found/iu.test(result.stderr || '')) return null;
    throw new Error('Could not inspect the isolated test network.');
  }
  const parsed = JSON.parse(result.stdout);
  return Array.isArray(parsed) ? parsed[0] : null;
}

function networkIdentity(network) {
  if (!network || typeof network !== 'object') return null;
  const labels = network.Labels && typeof network.Labels === 'object' ? network.Labels : {};
  return {
    name: typeof network.Name === 'string' ? network.Name : '',
    project: labels['com.docker.compose.project'],
    composeNetwork: labels['com.docker.compose.network'],
    containers: network.Containers && typeof network.Containers === 'object'
      ? Object.keys(network.Containers).length
      : 0,
  };
}

function assertVolumesAbsent(identity) {
  const existing = inspectVolume(identity.volume);
  if (existing) {
    throw new Error(`Volume ${identity.volume} already exists; refusing to adopt an unowned volume.`);
  }
}

function assertContainerAbsent(identity) {
  const existing = inspectContainer(identity.container);
  if (existing) {
    throw new Error(`Container ${identity.container} already exists; refusing to adopt an unowned service.`);
  }
}

function assertNetworkAbsent(identity) {
  const existing = inspectNetwork(identity.network);
  if (existing) {
    throw new Error(`Network ${identity.network} already exists; refusing to adopt an unowned network.`);
  }
}

function composeEnvironmentFor(manifest, composeEnvironment) {
  return {
    ...process.env,
    DATABASE_URL: undefined,
    DEV_DATABASE_URL: undefined,
    ETERVERSO_TEST_DATABASE_URL: undefined,
    ETERVERSO_TEST_DB_PASSWORD: composeEnvironment.ETERVERSO_TEST_DB_PASSWORD,
    ETERVERSO_TEST_DB_PORT: composeEnvironment.ETERVERSO_TEST_DB_PORT,
    ETERVERSO_TEST_VOLUME: composeEnvironment.ETERVERSO_TEST_VOLUME,
    ETERVERSO_TEST_PROFILE: composeEnvironment.ETERVERSO_TEST_PROFILE,
    ETERVERSO_TEST_RUN_ID: composeEnvironment.ETERVERSO_TEST_RUN_ID,
    COMPOSE_PROJECT_NAME: manifest.project,
  };
}

function compose(manifest, composeEnvironment, args, options = {}) {
  return docker([
    'compose',
    '--project-name', manifest.project,
    '-f', COMPOSE_FILE,
    '--env-file', path.join(options.runDirectory, 'compose.env'),
    ...args,
  ], {
    stdio: options.stdio ?? 'inherit',
    env: composeEnvironmentFor(manifest, composeEnvironment),
  });
}

function databaseUrl(manifest, composeEnvironment, database) {
  const url = new URL('postgres://127.0.0.1');
  url.username = manifest.user;
  url.password = composeEnvironment.ETERVERSO_TEST_DB_PASSWORD;
  url.port = String(manifest.port);
  url.pathname = `/${database}`;
  return url.toString();
}

async function connect(databaseUrlValue) {
  return postgres(databaseUrlValue, {
    prepare: false,
    max: 1,
    connect_timeout: 5,
    idle_timeout: 2,
    connection: { timezone: 'UTC' },
  });
}

async function assertDatabaseIdentity(databaseUrlValue, expectedDatabase, expectedUser) {
  const sql = await connect(databaseUrlValue);
  try {
    const rows = await sql`SELECT current_database() AS database, current_user AS username,
      current_setting('server_version_num') AS version, inet_server_port() AS server_port`;
    const row = rows[0];
    if (!row || row.database !== expectedDatabase || row.username !== expectedUser) {
      throw new Error('The isolated PostgreSQL connection identity does not match the recorded target.');
    }
    if (Math.floor(Number(row.version) / 10000) !== 17 || Number(row.server_port) !== 5432) {
      throw new Error('The isolated service is not PostgreSQL 17 on its recorded container port.');
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function readSentinelSnapshot(run) {
  const verification = devtools();
  const sql = await connect(run.sentinelUrl);
  try {
    const identity = await sql`SELECT current_database() AS database, current_user AS username`;
    const rows = await sql`SELECT id, marker FROM public.verification_sentinel ORDER BY id`;
    const snapshot = verification.validateSentinelSnapshot({
      database: identity[0]?.database,
      user: identity[0]?.username,
      table: run.manifest.sentinelTable,
      marker: run.manifest.sentinelMarker,
      rows: rows.map((row) => ({ id: Number(row.id), marker: String(row.marker) })),
    }, {
      database: run.manifest.sentinelDatabase,
      user: run.manifest.user,
      table: run.manifest.sentinelTable,
      marker: run.manifest.sentinelMarker,
    });
    return {
      ...snapshot,
      digest: verification.sentinelFingerprint(snapshot),
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function ensureSentinel(run) {
  const controlUrl = databaseUrl(run.manifest, run.composeEnvironment, 'postgres');
  const control = await connect(controlUrl);
  try {
    const exists = await control`SELECT 1 FROM pg_database WHERE datname = ${run.manifest.sentinelDatabase}`;
    if (exists.length === 0) {
      const verification = devtools();
      await control.unsafe(`CREATE DATABASE ${verification.quoteIdentifier(run.manifest.sentinelDatabase)} WITH TEMPLATE template0`);
    }
  } finally {
    await control.end({ timeout: 5 });
  }

  const sentinel = await connect(run.sentinelUrl);
  try {
    await sentinel`CREATE TABLE IF NOT EXISTS public.verification_sentinel (
      id integer PRIMARY KEY,
      marker text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`;
    const current = await sentinel`SELECT id, marker FROM public.verification_sentinel WHERE id = 1`;
    if (current.length === 0) {
      await sentinel`INSERT INTO public.verification_sentinel (id, marker) VALUES (1, ${run.manifest.sentinelMarker})`;
    } else if (current[0].marker !== run.manifest.sentinelMarker) {
      throw new Error('The owned sentinel database contains a marker from another run; refusing to adopt it.');
    }
  } finally {
    await sentinel.end({ timeout: 5 });
  }
}

async function ensureApplicationDatabase(run) {
  const mainUrl = databaseUrl(run.manifest, run.composeEnvironment, run.manifest.database);
  await assertDatabaseIdentity(mainUrl, run.manifest.database, run.manifest.user);
}

function serviceExpectation(manifest) {
  return {
    container: manifest.container,
    project: manifest.project,
    runId: manifest.runId,
    port: manifest.port,
    imagePrefix: 'postgres:17',
  };
}

function assertManifestOwnership(manifest, container) {
  const verification = devtools();
  verification.assertServiceOwnership(container, serviceExpectation(manifest));
}

function assertManifestMatchesInspection(manifest, container) {
  const verification = devtools();
  verification.assertServiceIdentity(container, serviceExpectation(manifest));
}

function ownedVolumeMatches(manifest, volume) {
  const identity = volumeIdentity(volume);
  return identity
    && identity.name === manifest.volume
    && identity.purpose === 'isolated-test'
    && identity.profile === manifest.profile
    && identity.run === manifest.runId;
}

function ownedNetworkMatches(manifest, network) {
  const identity = networkIdentity(network);
  return identity
    && identity.name === `${manifest.project}_default`
    && identity.project === manifest.project
    && identity.composeNetwork === 'default'
    && identity.containers === 0;
}

async function cleanupOwned(manifest, composeEnvironment, runDirectoryValue, ownership) {
  const errors = [];
  const container = inspectContainer(manifest.container);
  if (container) {
    try {
      // Cleanup accepts a stopped but fully identified run-owned container.
      // Running-state and loopback-port validation remain mandatory for
      // assert/test execution before a run is used.
      assertManifestOwnership(manifest, container);
      compose(manifest, composeEnvironment, ['down'], { runDirectory: runDirectoryValue });
    } catch (error) {
      errors.push(`could not stop the run-owned container: ${error.message}`);
    }
  }
  const remainingContainer = inspectContainer(manifest.container);
  if (remainingContainer) {
    errors.push('run-owned container still exists after cleanup');
  } else {
    const volume = inspectVolume(manifest.volume);
    if (volume) {
      if (!ownedVolumeMatches(manifest, volume)) {
        errors.push('run-owned volume labels do not match the manifest; refusing to remove it');
      } else {
        try {
          docker(['volume', 'rm', manifest.volume], { stdio: ['ignore', 'pipe', 'pipe'] });
        } catch (error) {
          errors.push(`could not remove the run-owned volume: ${error.message}`);
        }
      }
    }
    const networkNameValue = `${manifest.project}_default`;
    const network = inspectNetwork(networkNameValue);
    if (network) {
      if (!ownedNetworkMatches(manifest, network)) {
        errors.push('run-owned network identity or project labels do not match the manifest; refusing to remove it');
      } else {
        try {
          docker(['network', 'rm', networkNameValue], { stdio: ['ignore', 'pipe', 'pipe'] });
        } catch (error) {
          errors.push(`could not remove the run-owned network: ${error.message}`);
        }
      }
    }
  }
  if (errors.length === 0) {
    if (!ownership) errors.push('refusing to remove private run state without an ownership identity');
    else errors.push(...removeOwnedRunDirectory(ownership));
  }
  return errors;
}

async function portIsFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

async function choosePort() {
  for (let port = PORT_MIN; port <= PORT_MAX; port += 1) {
    if (await portIsFree(port)) return port;
  }
  throw new Error(`No free loopback port was found in ${PORT_MIN}-${PORT_MAX} for the isolated verification service.`);
}

function safeTarget(run) {
  return {
    ...run.target,
    host: run.manifest.host,
    mode: run.manifest.mode,
  };
}

async function up(runId, options = {}) {
  const verification = devtools();
  verification.assertNoProhibitedInputs({ root: ROOT, env: process.env }, fs.existsSync);
  const id = verification.validateRunId(runId);
  const identity = verification.deriveRunIdentity(id);
  const directory = path.join(RUNS_ROOT, id);
  const existing = fs.lstatSync(directory, { throwIfNoEntry: false });
  if (existing) {
    throw new Error(`Run ${id} already has private state; use assert or down instead of overwriting it.`);
  }
  assertContainerAbsent(identity);
  assertVolumesAbsent(identity);
  assertNetworkAbsent(identity);
  const port = await choosePort();
  const manifest = verification.buildRunManifest({ runId: id, root: ROOT, port });
  const password = crypto.randomBytes(32).toString('hex');
  const composeEnvironment = verification.buildComposeEnvironment(manifest, password);

  let ownership = null;
  let composeAttempted = false;
  try {
    ensurePrivateDirectory(path.join(ROOT, '.local'));
    ensurePrivateDirectory(path.join(ROOT, '.local', 'test'));
    ensurePrivateDirectory(RUNS_ROOT);
    // Every private write for this run happens after the exclusive directory
    // claim and inside the guarded path. A failure before Compose removes only
    // this invocation's newly created directory, never preexisting state.
    ownership = createOwnedRunDirectory(directory);
    writeJsonPrivate(path.join(directory, 'manifest.json'), manifest);
    if (options.forceFailureBeforeCompose) {
      throw new Error('Injected setup failure before the second private state write and before Compose (test hook).');
    }
    writePrivate(path.join(directory, 'compose.env'), verification.serializeComposeEnvironment(composeEnvironment));

    composeAttempted = true;
    compose(manifest, composeEnvironment, ['up', '-d', '--wait'], { runDirectory: directory });
    const container = inspectContainer(manifest.container);
    if (!container) throw new Error('Compose did not create the recorded isolated PostgreSQL container.');
    assertManifestMatchesInspection(manifest, container);
    await ensureApplicationDatabase({ manifest, composeEnvironment });
    const run = {
      manifest,
      composeEnvironment,
      sentinelUrl: verification.sentinelUrlFor(
        databaseUrl(manifest, composeEnvironment, manifest.database),
        manifest,
      ),
    };
    await ensureSentinel(run);
    await assertDatabaseIdentity(run.sentinelUrl, manifest.sentinelDatabase, manifest.user);
    if (options.forceFailureAfterStop) {
      docker(['stop', manifest.container], { stdio: ['ignore', 'pipe', 'pipe'] });
      throw new Error('Injected setup failure after stopping the owned container (test hook).');
    }
    const readyManifest = { ...manifest, phase: 'ready' };
    writeJsonPrivate(path.join(directory, 'manifest.json'), readyManifest);
    writePrivate(
      path.join(directory, 'connection.env'),
      verification.serializeConnectionEnvironment(databaseUrl(manifest, composeEnvironment, manifest.database)),
    );
    if (options.forceFailureAfterUp) {
      throw new Error('Injected setup failure after resources were created (test hook).');
    }
    process.stdout.write(`${JSON.stringify({
      runId: manifest.runId,
      project: manifest.project,
      container: manifest.container,
      volume: manifest.volume,
      network: `${manifest.project}_default`,
      host: manifest.host,
      port: manifest.port,
      database: manifest.database,
      sentinelDatabase: manifest.sentinelDatabase,
    }, null, 2)}\n`);
    process.stdout.write(`Isolated verification run ${manifest.runId} is ready at ${manifest.host}:${manifest.port}/${manifest.database}.\n`);
  } catch (error) {
    const cleanupErrors = composeAttempted
      ? await cleanupOwned(manifest, composeEnvironment, directory, ownership)
      : removeOwnedRunDirectory(ownership);
    const suffix = cleanupErrors.length ? ` Cleanup also failed: ${cleanupErrors.join('; ')}.` : '';
    throw new Error(`${error.message}${suffix}`);
  }
}

async function down(runId) {
  const verification = devtools();
  const id = verification.validateRunId(runId);
  const identity = verification.deriveRunIdentity(id);
  const directory = path.join(RUNS_ROOT, id);
  const exists = fs.lstatSync(directory, { throwIfNoEntry: false });
  if (!exists) {
    if (inspectContainer(identity.container) || inspectVolume(identity.volume) || inspectNetwork(identity.network)) {
      throw new Error(`Run ${id} has no manifest but its derived resources exist; refusing to remove unverified resources.`);
    }
    process.stdout.write(`Isolated verification run ${id} is already clean.\n`);
    return;
  }
  const run = loadRun(id);
  const errors = await cleanupOwned(run.manifest, run.composeEnvironment, directory, run.ownership);
  if (errors.length) throw new Error(`Cleanup failed: ${errors.join('; ')}.`);
  process.stdout.write(`Removed only run ${id} resources; protected development/test/sandbox resources were not touched.\n`);
}

async function resolveScratchTarget(runId, databaseName) {
  const verification = devtools();
  const database = verification.assertGeneratedScratchDatabaseName(databaseName);
  const run = await assertRun(runId, { quiet: true });
  if (database === run.manifest.database || database === run.manifest.sentinelDatabase) {
    throw new Error('Refusing to use an application or sentinel database as an isolated scratch target.');
  }
  const url = verification.withDatabase(run.databaseUrl, database);
  await assertDatabaseIdentity(url, database, run.manifest.user);
  return {
    databaseUrl: url,
    label: 'isolated-scratch',
    host: run.manifest.host,
    port: run.manifest.port,
    database,
    runId: run.manifest.runId,
    project: run.manifest.project,
    service: run.manifest.service,
  };
}

async function assertRun(runId, options = {}) {
  const verification = devtools();
  verification.assertNoProhibitedInputs(
    { root: ROOT, env: process.env },
    fs.existsSync,
    ['DATABASE_URL', 'DEV_DATABASE_URL'],
  );
  const run = loadRun(runId, { phase: 'ready' });
  const container = inspectContainer(run.manifest.container);
  if (!container) throw new Error('The recorded isolated PostgreSQL container is missing; run setup again.');
  assertManifestMatchesInspection(run.manifest, container);
  await assertDatabaseIdentity(run.databaseUrl, run.manifest.database, run.manifest.user);
  await assertDatabaseIdentity(run.sentinelUrl, run.manifest.sentinelDatabase, run.manifest.user);
  const sentinel = await readSentinelSnapshot(run);
  if (!options.quiet) {
    process.stdout.write(`${JSON.stringify({ ...safeTarget(run), sentinelDigest: sentinel.digest }, null, 2)}\n`);
  }
  return { ...run, target: safeTarget(run), sentinel };
}

async function fingerprint(runId) {
  const run = await assertRun(runId, { quiet: true });
  const snapshot = await readSentinelSnapshot(run);
  process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
}

async function sentinelMutationProbe(runId) {
  const verification = devtools();
  const run = await assertRun(runId, { quiet: true });
  const before = await readSentinelSnapshot(run);
  const sql = await connect(run.sentinelUrl);
  try {
    await sql`UPDATE public.verification_sentinel SET marker = 'tampered-by-owned-sentinel-probe' WHERE id = 1`;
  } finally {
    await sql.end({ timeout: 5 });
  }
  const mutated = await readSentinelSnapshotFromRaw(run);
  const comparison = verification.compareSentinel(
    { ...before, rows: before.rows },
    { ...mutated, rows: mutated.rows },
  );
  const restore = await connect(run.sentinelUrl);
  try {
    await restore`UPDATE public.verification_sentinel SET marker = ${run.manifest.sentinelMarker} WHERE id = 1`;
  } finally {
    await restore.end({ timeout: 5 });
  }
  const restored = await readSentinelSnapshot(run);
  if (comparison.unchanged) throw new Error('Sentinel mutation was not detected.');
  if (restored.digest !== before.digest) throw new Error('Sentinel restoration did not reproduce the original fingerprint.');
  process.stdout.write(`${JSON.stringify({
    before: before.digest,
    mutated: comparison.afterDigest,
    restored: restored.digest,
    mutationDetected: true,
  }, null, 2)}\n`);
}

async function readSentinelSnapshotFromRaw(run) {
  const sql = await connect(run.sentinelUrl);
  try {
    const identity = await sql`SELECT current_database() AS database, current_user AS username`;
    const rows = await sql`SELECT id, marker FROM public.verification_sentinel ORDER BY id`;
    return {
      database: identity[0]?.database,
      user: identity[0]?.username,
      table: run.manifest.sentinelTable,
      marker: run.manifest.sentinelMarker,
      rows: rows.map((row) => ({ id: Number(row.id), marker: String(row.marker) })),
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function main(argv = process.argv.slice(2)) {
  const args = parseIsolationArguments(argv);
  if (args.command === 'up') {
    return up(args.runId, {
      forceFailureAfterUp: args.forceFailureAfterUp,
      forceFailureAfterStop: args.forceFailureAfterStop,
      forceFailureBeforeCompose: args.forceFailureBeforeCompose,
    });
  }
  if (args.command === 'down') return down(args.runId);
  if (args.command === 'assert') return assertRun(args.runId, { quiet: false });
  if (args.command === 'fingerprint') return fingerprint(args.runId);
  if (args.command === 'sentinel-mutation-probe') return sentinelMutationProbe(args.runId);
  throw new Error(USAGE);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error && error.message || 'Isolated verification command failed.'}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  ROOT,
  RUNS_ROOT,
  assertRun,
  choosePort,
  loadRun,
  main,
  parseIsolationArguments,
  readSentinelSnapshot,
  resolveScratchTarget,
  runDirectory,
};
