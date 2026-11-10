'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const {
  SANDBOX,
  assertConnectedIdentityRow,
  assertOwnedContainer,
  assertPortAvailable,
  resolveSandboxTarget,
  verifyConnectedIdentity,
} = require('../../scripts/public-sandbox-target');
const {
  composeArgs,
  main,
  parseCliArgs,
  statePaths,
  SANDBOX_POSTGRES_TYPES,
} = require('../../scripts/public-sandbox');

const ROOT = path.resolve(__dirname, '..', '..');
const PASSWORD = 'a'.repeat(64);
const SESSION_SECRET = 's'.repeat(43);
const INSTANCE_ID = '11111111-2222-4333-8444-555555555555';
const DSN = `postgres://eterverso_sandbox:${PASSWORD}@127.0.0.1:55434/eterverso_public_sandbox`;
const CONTAINER_IP = '172.21.0.2';

function tempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eterverso-sandbox-target-'));
  fs.chmodSync(root, 0o700);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function writePrivate(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(file), 0o700);
  fs.writeFileSync(file, contents, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

function sandboxState(t, overrides = {}) {
  const root = tempRoot(t);
  const paths = statePaths(root);
  fs.mkdirSync(paths.directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(paths.directory, 0o700);
  const credentials = {
    ETERVERSO_SANDBOX_DB_PASSWORD: PASSWORD,
    ETERVERSO_SANDBOX_DATABASE_URL: DSN,
    ETERVERSO_SANDBOX_SESSION_SECRET: SESSION_SECRET,
    ...overrides.credentials,
  };
  const record = {
    project: SANDBOX.PROJECT,
    service: SANDBOX.SERVICE,
    container: SANDBOX.CONTAINER,
    volume: SANDBOX.VOLUME,
    database: SANDBOX.DATABASE,
    role: SANDBOX.ROLE,
    host: SANDBOX.HOST,
    port: SANDBOX.DB_PORT,
    appPort: SANDBOX.APP_PORT,
    purpose: SANDBOX.PURPOSE,
    instanceId: INSTANCE_ID,
    createdAt: '2026-11-08T12:00:00.000Z',
    ...overrides.record,
  };
  writePrivate(paths.credentials, Object.entries(credentials).map(([key, value]) => `${key}=${value}`).join('\n') + '\n');
  writePrivate(paths.record, `${JSON.stringify(record, null, 2)}\n`);
  return { root, paths, record, credentials };
}

function defaultLabels() {
  return {
    'com.docker.compose.project': SANDBOX.PROJECT,
    'com.docker.compose.service': SANDBOX.SERVICE,
    'io.eterverso.purpose': SANDBOX.PURPOSE,
  };
}

function loopbackBindings(host = SANDBOX.HOST, port = SANDBOX.DB_PORT) {
  return [{ HostIp: host, HostPort: String(port) }];
}

function fakeContainer({
  running = true,
  name = SANDBOX.CONTAINER,
  image = SANDBOX.IMAGE,
  labels = defaultLabels(),
  volumeName = SANDBOX.VOLUME,
  hostBindings = { '5432/tcp': loopbackBindings() },
  runtimePorts,
  networkAddress = CONTAINER_IP,
} = {}) {
  const published = hostBindings || {};
  // Docker clears NetworkSettings.Ports for a stopped container while
  // HostConfig.PortBindings keeps the published mapping.
  const ports = runtimePorts !== undefined
    ? runtimePorts
    : (running
      ? Object.fromEntries(Object.entries(published).map(([key, bindings]) => [
        key, bindings.map((binding) => ({ ...binding })),
      ]))
      : {});
  return {
    Name: name,
    State: { Running: running },
    Config: { Image: image, Labels: labels },
    HostConfig: { PortBindings: published },
    Mounts: [{ Type: 'volume', Name: volumeName, Destination: '/var/lib/postgresql/data' }],
    NetworkSettings: {
      IPAddress: running ? networkAddress : '',
      GlobalIPv6Address: '',
      Ports: ports,
      Networks: {
        'eterverso-public-sandbox_default': {
          IPAddress: running ? networkAddress : '',
          GlobalIPv6Address: '',
        },
      },
    },
  };
}

function fakeVolume({ name = SANDBOX.VOLUME, labels } = {}) {
  return {
    Name: name,
    Driver: 'local',
    Scope: 'local',
    Labels: labels || {
      'com.docker.compose.project': SANDBOX.PROJECT,
      'com.docker.compose.volume': 'sandbox-data',
      'io.eterverso.purpose': SANDBOX.PURPOSE,
    },
  };
}

function dockerInspect(container = fakeContainer(), volume = fakeVolume()) {
  const calls = [];
  const inspect = (command, args) => {
    assert.equal(command, 'docker');
    calls.push([...args]);
    if (args[0] === 'inspect') {
      assert.deepEqual(args, ['inspect', SANDBOX.CONTAINER]);
      if (!container) throw new Error('missing');
      return JSON.stringify([container]);
    }
    if (args[0] === 'volume' && args[1] === 'inspect') {
      assert.deepEqual(args, ['volume', 'inspect', SANDBOX.VOLUME]);
      if (!volume) throw new Error('missing');
      return JSON.stringify([volume]);
    }
    throw new Error(`unexpected docker arguments: ${args.join(' ')}`);
  };
  inspect.calls = calls;
  return inspect;
}

function fakeSql(row) {
  const calls = [];
  function sql(strings, ...values) {
    const text = strings.join('?');
    calls.push({ text, values });
    if (/^\s*(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)\b/iu.test(text)) {
      throw new Error('unexpected mutation');
    }
    return Promise.resolve([row]);
  }
  sql.calls = calls;
  sql.mutations = () => calls.filter((call) => (
    /^\s*(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)\b/iu.test(call.text)
  ));
  return sql;
}

function validIdentity(overrides = {}) {
  return {
    database: SANDBOX.DATABASE,
    role: SANDBOX.ROLE,
    address: `${CONTAINER_IP}/32`,
    port: SANDBOX.CONTAINER_DB_PORT,
    version: '170011',
    ...overrides,
  };
}

function identityTarget(overrides = {}) {
  return {
    database: SANDBOX.DATABASE,
    role: SANDBOX.ROLE,
    host: SANDBOX.HOST,
    port: SANDBOX.DB_PORT,
    containerPort: SANDBOX.CONTAINER_DB_PORT,
    containerAddresses: [CONTAINER_IP],
    ...overrides,
  };
}

test('compose.sandbox.yaml declares only the owned PostgreSQL 17 public sandbox', () => {
  const compose = fs.readFileSync(path.join(ROOT, 'compose.sandbox.yaml'), 'utf8');
  assert.match(compose, /^name: eterverso-public-sandbox$/mu);
  assert.match(compose, /^  db:$/mu);
  assert.match(compose, /image: postgres:17-alpine/u);
  assert.match(compose, /container_name: eterverso-public-sandbox-db-1/u);
  assert.match(compose, /POSTGRES_DB: eterverso_public_sandbox/u);
  assert.match(compose, /POSTGRES_USER: eterverso_sandbox/u);
  assert.match(compose, /"127\.0\.0\.1:55434:5432"/u);
  assert.match(compose, /name: eterverso-public-sandbox-data/u);
  assert.match(compose, /io\.eterverso\.purpose: public-sandbox/u);
  assert.doesNotMatch(compose, /^\s*restart:/mu);
  assert.doesNotMatch(compose, /postgres-data|eterverso-test-data|eterversoSandbox/u);
  assert.deepEqual(composeArgs('/repo', { credentials: '/repo/.local/public-sandbox/credentials.env' }, ['up', '-d']), [
    'compose', '--project-name', SANDBOX.PROJECT,
    '-f', '/repo/compose.sandbox.yaml',
    '--env-file', '/repo/.local/public-sandbox/credentials.env',
    'up', '-d',
  ]);
});

test('sandbox target accepts only the owned loopback service, record, credentials and volume', (t) => {
  const { root } = sandboxState(t);
  const docker = dockerInspect();
  const target = resolveSandboxTarget({
    root,
    execFileSyncImpl: docker,
    environment: {},
  });
  assert.equal(target.database, SANDBOX.DATABASE);
  assert.equal(target.role, SANDBOX.ROLE);
  assert.equal(target.host, '127.0.0.1');
  assert.equal(target.port, 55434);
  assert.equal(target.containerPort, 5432);
  assert.equal(target.volume, SANDBOX.VOLUME);
  assert.equal(target.instanceId, INSTANCE_ID);
  assert.equal(target.running, true);
  assert.deepEqual(target.containerAddresses, [CONTAINER_IP]);
  assert.equal(target.ownership.volume, SANDBOX.VOLUME);
  assert.deepEqual(docker.calls, [
    ['inspect', SANDBOX.CONTAINER],
    ['volume', 'inspect', SANDBOX.VOLUME],
  ]);
});

test('sandbox target refuses remote, development and test DSNs before a connector can write', (t) => {
  for (const [label, dsn, pattern] of [
    ['remote', 'postgres://eterverso_sandbox:secret@db.example.invalid:55434/eterverso_public_sandbox', /127\.0\.0\.1/u],
    ['development', 'postgres://eterverso_sandbox:secret@127.0.0.1:55432/eterverso_public_sandbox', /port must be 55434/u],
    ['test', 'postgres://eterverso_sandbox:secret@127.0.0.1:55433/eterverso_public_sandbox', /port must be 55434/u],
    ['wrong database', 'postgres://eterverso_sandbox:secret@127.0.0.1:55434/eterverso', /database name/u],
    ['wrong role', 'postgres://eterverso:secret@127.0.0.1:55434/eterverso_public_sandbox', /role must be/u],
  ]) {
    const { root } = sandboxState(t);
    const paths = statePaths(root);
    writePrivate(paths.credentials, [
      `ETERVERSO_SANDBOX_DB_PASSWORD=${PASSWORD}`,
      `ETERVERSO_SANDBOX_DATABASE_URL=${dsn}`,
      `ETERVERSO_SANDBOX_SESSION_SECRET=${SESSION_SECRET}`,
      '',
    ].join('\n'));
    const connector = fakeSql(validIdentity());
    assert.throws(() => resolveSandboxTarget({
      root,
      execFileSyncImpl: dockerInspect(fakeContainer()),
      environment: {},
    }), pattern, label);
    assert.equal(connector.mutations().length, 0);
    assert.equal(connector.calls.length, 0);
  }
});

test('sandbox target refuses inherited DATABASE_URL, wrong ownership, wrong record and unrelated volume', (t) => {
  {
    const { root } = sandboxState(t);
    assert.throws(() => resolveSandboxTarget({
      root,
      execFileSyncImpl: dockerInspect(fakeContainer()),
      environment: { DATABASE_URL: 'postgres://inherited.example/db' },
    }), /inherited/u);
  }
  {
    const { root } = sandboxState(t);
    const labels = defaultLabels();
    labels['com.docker.compose.project'] = 'someone-else';
    assert.throws(() => resolveSandboxTarget({
      root, execFileSyncImpl: dockerInspect(fakeContainer({ labels })), environment: {},
    }), /ownership labels/u);
  }
  {
    const { root } = sandboxState(t, { record: { project: 'someone-else' } });
    assert.throws(() => resolveSandboxTarget({
      root, execFileSyncImpl: dockerInspect(fakeContainer()), environment: {},
    }), /service record/u);
  }
  {
    const { root } = sandboxState(t, { record: { instanceId: 'not-a-uuid' } });
    assert.throws(() => resolveSandboxTarget({
      root, execFileSyncImpl: dockerInspect(fakeContainer()), environment: {},
    }), /instance marker/u);
  }
  {
    const { root } = sandboxState(t);
    assert.throws(() => resolveSandboxTarget({
      root,
      execFileSyncImpl: dockerInspect(fakeContainer({ volumeName: 'unrelated-volume' })),
      environment: {},
    }), /unrelated volume/u);
  }
  {
    const { root } = sandboxState(t);
    assert.throws(() => resolveSandboxTarget({
      root,
      execFileSyncImpl: dockerInspect(fakeContainer(), fakeVolume({ name: 'unrelated-volume' })),
      environment: {},
    }), /not the owned public sandbox volume/u);
  }
  {
    const { root } = sandboxState(t);
    assert.throws(() => resolveSandboxTarget({
      root,
      execFileSyncImpl: dockerInspect(fakeContainer(), fakeVolume({
        labels: { 'com.docker.compose.project': SANDBOX.PROJECT },
      })),
      environment: {},
    }), /purpose label/u);
  }
  {
    const { root } = sandboxState(t);
    assert.throws(() => resolveSandboxTarget({
      root,
      execFileSyncImpl: dockerInspect(fakeContainer(), null),
      environment: {},
    }), /could not be inspected/u);
  }
  {
    const { root } = sandboxState(t);
    assert.throws(() => assertOwnedContainer(fakeContainer({ name: '/other-db-1' })), /container name/u);
  }
});

test('stopped containers are validated from HostConfig while running containers require runtime ports', () => {
  const stopped = fakeContainer({ running: false });
  assert.deepEqual(stopped.NetworkSettings.Ports, {});
  assert.deepEqual(stopped.HostConfig.PortBindings['5432/tcp'], [{
    HostIp: SANDBOX.HOST,
    HostPort: String(SANDBOX.DB_PORT),
  }]);
  assert.doesNotThrow(() => assertOwnedContainer(stopped, SANDBOX, { requireRunning: false }));
  assert.throws(
    () => assertOwnedContainer(stopped, SANDBOX, { requireRunning: true }),
    /not running/u,
  );

  const runningWithoutRuntimePorts = fakeContainer({ runtimePorts: {} });
  assert.throws(
    () => assertOwnedContainer(runningWithoutRuntimePorts),
    /running container does not publish/u,
  );

  const runningWithWrongRuntimePort = fakeContainer({
    runtimePorts: { '5432/tcp': loopbackBindings(SANDBOX.HOST, 55435) },
  });
  assert.throws(
    () => assertOwnedContainer(runningWithWrongRuntimePort),
    /running container port binding does not match/u,
  );

  const runningWithWrongHostBinding = fakeContainer({
    hostBindings: { '5432/tcp': loopbackBindings('0.0.0.0') },
  });
  assert.throws(
    () => assertOwnedContainer(runningWithWrongHostBinding),
    /container host port binding does not match/u,
  );
});

test('stopped containers with wrong or unrelated host bindings are refused', () => {
  for (const [label, container, pattern] of [
    ['all interfaces', fakeContainer({ running: false, hostBindings: { '5432/tcp': loopbackBindings('0.0.0.0') } }), /port binding does not match/u],
    ['wrong host port', fakeContainer({ running: false, hostBindings: { '5432/tcp': loopbackBindings(SANDBOX.HOST, 55435) } }), /port binding does not match/u],
    ['empty binding list', fakeContainer({ running: false, hostBindings: { '5432/tcp': [] } }), /does not publish/u],
    ['missing binding', fakeContainer({ running: false, hostBindings: {} }), /host port bindings do not match/u],
    ['extra published port', fakeContainer({
      running: false,
      hostBindings: {
        '5432/tcp': loopbackBindings(),
        '5433/tcp': loopbackBindings(SANDBOX.HOST, 55435),
      },
    }), /host port bindings do not match/u],
  ]) {
    assert.throws(
      () => assertOwnedContainer(container, SANDBOX, { requireRunning: false }),
      pattern,
      label,
    );
  }
  assert.throws(() => assertOwnedContainer(
    fakeContainer({ running: false, volumeName: 'unrelated-volume' }),
    SANDBOX,
    { requireRunning: false },
  ), /unrelated volume/u);
});

test('connected identity accepts a real container-network address and internal port', async () => {
  const target = identityTarget();
  const good = fakeSql(validIdentity());
  assert.deepEqual(await verifyConnectedIdentity(good, target), {
    database: SANDBOX.DATABASE,
    role: SANDBOX.ROLE,
    address: CONTAINER_IP,
    port: SANDBOX.CONTAINER_DB_PORT,
    version: 170011,
  });
  assert.equal(good.calls.length, 1);
  assert.match(good.calls[0].text, /SELECT current_database/u);
  assert.equal(good.mutations().length, 0);

  const fallbackTarget = identityTarget();
  delete fallbackTarget.containerAddresses;
  const fallback = fakeSql(validIdentity({ address: '10.42.0.7/32' }));
  assert.equal((await verifyConnectedIdentity(fallback, fallbackTarget)).address, '10.42.0.7');
});

test('connected identity accepts loopback, RFC1918 and link-local space but rejects public addresses', async () => {
  const target = identityTarget();
  delete target.containerAddresses;
  for (const address of [
    '127.0.0.1/32',
    '10.1.2.3/32',
    '172.16.0.1/32',
    '172.31.255.255/32',
    '192.168.1.5/32',
    '169.254.1.2/32',
    '::1',
    'fd00::1',
    'fe80::1',
  ]) {
    const sql = fakeSql(validIdentity({ address }));
    assert.equal((await verifyConnectedIdentity(sql, target)).address, address.split('/')[0], address);
  }
  for (const address of ['8.8.8.8', '172.32.0.1', '2001:db8::1', '0.0.0.0']) {
    const sql = fakeSql(validIdentity({ address }));
    await assert.rejects(
      () => verifyConnectedIdentity(sql, target),
      /private or container-network address/u,
      address,
    );
  }
});

test('connected identity rejects wrong database, role, version, remote address and published port', async () => {
  const target = identityTarget();
  for (const [label, row, pattern] of [
    ['database', validIdentity({ database: 'eterverso' }), /connected database/u],
    ['role', validIdentity({ role: 'eterverso' }), /connected database role/u],
    ['public address', validIdentity({ address: '203.0.113.10/32' }), /private or container-network address/u],
    ['remote address', validIdentity({ address: '8.8.8.8' }), /private or container-network address/u],
    ['unowned container address', validIdentity({ address: '172.21.0.9/32' }), /owned sandbox container network/u],
    ['missing address', validIdentity({ address: null }), /address could not be verified/u],
    ['published host port', validIdentity({ port: SANDBOX.DB_PORT }), /sandbox container port 5432/u],
    ['wrong container port', validIdentity({ port: 5433 }), /sandbox container port 5432/u],
    ['version', validIdentity({ version: '160000' }), /PostgreSQL 17/u],
  ]) {
    const bad = fakeSql(row);
    await assert.rejects(() => verifyConnectedIdentity(bad, target), pattern, label);
    assert.equal(bad.mutations().length, 0);
    assert.equal(bad.calls.length, 1);
  }
  assert.throws(() => assertConnectedIdentityRow(null, target), /could not be read/u);
});

test('resolved container addresses are used to reject a different container network', async (t) => {
  const { root } = sandboxState(t);
  const target = resolveSandboxTarget({
    root,
    execFileSyncImpl: dockerInspect(fakeContainer({ networkAddress: '172.21.0.3' })),
    environment: {},
  });
  assert.deepEqual(target.containerAddresses, ['172.21.0.3']);
  const sql = fakeSql(validIdentity({ address: '172.21.0.2/32' }));
  await assert.rejects(
    () => verifyConnectedIdentity(sql, target),
    /owned sandbox container network/u,
  );
  assert.equal(sql.calls.length, 1);
  assert.equal(sql.mutations().length, 0);
});

test('sandbox port guard refuses an occupied port before any service call', async () => {
  const netImpl = {
    createServer() {
      const handlers = {};
      return {
        once(event, callback) { handlers[event] = callback; },
        listen() { handlers.error?.(new Error('EADDRINUSE')); },
        close() {},
      };
    },
  };
  await assert.rejects(() => assertPortAvailable({ port: 55434, netImpl }), /already in use/u);
});

test('CLI argument parsing accepts only documented sandbox operations', () => {
  assert.deepEqual(parseCliArgs(['status']), {
    command: 'status', capture: null, dryRun: false, confirm: null, help: false,
  });
  assert.deepEqual(parseCliArgs(['import', '--capture', '/tmp/capture', '--dry-run']), {
    command: 'import', capture: '/tmp/capture', dryRun: true, confirm: null, help: false,
  });
  assert.deepEqual(parseCliArgs(['--help']), { help: true });
  assert.throws(() => parseCliArgs(['import']), /requires --capture/u);
  assert.throws(() => parseCliArgs(['start', '--dry-run']), /not meaningful/u);
  assert.throws(() => parseCliArgs(['provision', '--confirm', SANDBOX.DATABASE]), /only for the explicit destructive reset/u);
  assert.throws(() => parseCliArgs(['reset', '--confirm', 'wrong']), /Reset requires/u);
  assert.throws(() => parseCliArgs(['reset', '--confirm', SANDBOX.DATABASE]), /not implemented/u);
  assert.throws(() => parseCliArgs(['status', '--capture', 'x']), /only for import/u);
  assert.throws(() => parseCliArgs(['unknown']), /Unknown sandbox command/u);
});

function cliDependencies(root, overrides = {}) {
  const commands = [];
  const dependencies = {
    root,
    environment: {},
    portChecker: async () => true,
    execFileSyncImpl: dockerInspect(null),
    composeRunner: (commandRoot, paths, args) => {
      commands.push(args);
      return '';
    },
    randomBytes: (size) => Buffer.alloc(size, 7),
    now: () => new Date('2026-11-08T12:00:00.000Z'),
    sqlFactory: () => {
      const sql = fakeSql(validIdentity());
      sql.end = async () => {};
      return sql;
    },
    runNode: () => {
      throw new Error('runNode should not be called in this test');
    },
    ...overrides,
  };
  return { dependencies, commands };
}

test('provision --dry-run writes no state and makes no service call', async (t) => {
  const root = tempRoot(t);
  const { dependencies, commands } = cliDependencies(root);
  const result = await main(['provision', '--dry-run'], dependencies);
  assert.equal(result.dryRun, true);
  assert.equal(commands.length, 0);
  assert.equal(fs.existsSync(statePaths(root).directory), false);
  assert.equal(fs.existsSync(statePaths(root).credentials), false);
  assert.equal(fs.existsSync(statePaths(root).record), false);
});

test('provision refuses an existing unlabeled volume before writing state or composing', async (t) => {
  const root = tempRoot(t);
  const { dependencies, commands } = cliDependencies(root, {
    execFileSyncImpl: dockerInspect(null, fakeVolume({
      labels: { 'com.docker.compose.project': SANDBOX.PROJECT },
    })),
  });
  await assert.rejects(() => main(['provision'], dependencies), /purpose label/u);
  assert.equal(commands.length, 0);
  assert.equal(fs.existsSync(statePaths(root).directory), false);
});

test('provision refuses to assume an uninspectable volume is absent', async (t) => {
  const root = tempRoot(t);
  const docker = (command, args) => {
    assert.equal(command, 'docker');
    if (args[0] === 'inspect') throw new Error('missing');
    assert.deepEqual(args, ['volume', 'inspect', SANDBOX.VOLUME]);
    const error = new Error('daemon unavailable');
    error.stderr = Buffer.from('Cannot connect to the Docker daemon at unix:///var/run/docker.sock.');
    throw error;
  };
  const { dependencies, commands } = cliDependencies(root, { execFileSyncImpl: docker });
  await assert.rejects(
    () => main(['provision'], dependencies),
    /could not be inspected/u,
  );
  assert.equal(commands.length, 0);
  assert.equal(fs.existsSync(statePaths(root).credentials), false);
});

test('provision refuses inherited DATABASE_URL and an occupied port before writing state', async (t) => {
  const root = tempRoot(t);
  const inherited = cliDependencies(root, { environment: { DATABASE_URL: 'postgres://elsewhere/db' } });
  await assert.rejects(() => main(['provision'], inherited.dependencies), /inherited/u);
  assert.equal(inherited.commands.length, 0);
  assert.equal(fs.existsSync(statePaths(root).directory), false);

  const occupied = cliDependencies(root, { portChecker: async () => false });
  await assert.rejects(() => main(['provision'], occupied.dependencies), /already in use/u);
  assert.equal(occupied.commands.length, 0);
  assert.equal(fs.existsSync(statePaths(root).directory), false);
});

test('provision creates private independent state, never overwrites it, and starts only the owned compose project', async (t) => {
  const root = tempRoot(t);
  let container = null;
  let volumeCreated = false;
  const missingVolume = () => {
    const error = new Error('missing');
    error.stderr = Buffer.from('Error response from daemon: get "http://localhost/v1.45/volumes/eterverso-public-sandbox-data": no such volume');
    return error;
  };
  const docker = (command, args) => {
    assert.equal(command, 'docker');
    if (args[0] === 'volume') {
      assert.deepEqual(args, ['volume', 'inspect', SANDBOX.VOLUME]);
      if (!volumeCreated) throw missingVolume();
      return JSON.stringify([fakeVolume()]);
    }
    assert.deepEqual(args, ['inspect', SANDBOX.CONTAINER]);
    if (!container) throw new Error('missing');
    return JSON.stringify([container]);
  };
  const { dependencies, commands } = cliDependencies(root, {
    execFileSyncImpl: docker,
    composeRunner: (commandRoot, paths, args) => {
      commands.push(args);
      container = fakeContainer();
      volumeCreated = true;
      return '';
    },
  });
  const first = await main(['provision'], dependencies);
  assert.equal(first.reused, false);
  assert.equal(first.target.running, true);
  assert.equal(commands.length, 1);
  assert.deepEqual(commands[0], ['up', '-d', '--wait']);
  const paths = statePaths(root);
  assert.equal(fs.statSync(paths.directory).mode & 0o777, 0o700);
  assert.equal(fs.statSync(paths.credentials).mode & 0o777, 0o600);
  assert.equal(fs.statSync(paths.record).mode & 0o777, 0o600);
  const credentialsBefore = fs.readFileSync(paths.credentials, 'utf8');
  const recordBefore = fs.readFileSync(paths.record, 'utf8');
  assert.match(credentialsBefore, /ETERVERSO_SANDBOX_DB_PASSWORD=[a-f0-9]{64}/u);
  assert.match(credentialsBefore, /ETERVERSO_SANDBOX_SESSION_SECRET=/u);
  assert.doesNotMatch(credentialsBefore, /^DATABASE_URL=/mu);

  const second = await main(['provision'], dependencies);
  assert.equal(second.reused, true);
  assert.equal(second.target.running, true);
  assert.deepEqual(second.target.containerAddresses, [CONTAINER_IP]);
  assert.equal(commands.length, 1);
  assert.equal(fs.readFileSync(paths.credentials, 'utf8'), credentialsBefore);
  assert.equal(fs.readFileSync(paths.record, 'utf8'), recordBefore);
});

test('provision resumes an owned stopped container from HostConfig and rechecks running runtime identity', async (t) => {
  const { root, paths } = sandboxState(t);
  let running = false;
  const commands = [];
  const inspectShapes = [];
  const docker = (command, args) => {
    assert.equal(command, 'docker');
    if (args[0] === 'volume') {
      assert.deepEqual(args, ['volume', 'inspect', SANDBOX.VOLUME]);
      return JSON.stringify([fakeVolume()]);
    }
    assert.deepEqual(args, ['inspect', SANDBOX.CONTAINER]);
    const container = fakeContainer({ running });
    inspectShapes.push(container);
    return JSON.stringify([container]);
  };
  const dependencies = cliDependencies(root, {
    execFileSyncImpl: docker,
    composeRunner: (commandRoot, state, args) => { commands.push(args); running = true; return ''; },
  }).dependencies;
  const credentialsBefore = fs.readFileSync(paths.credentials, 'utf8');
  const result = await main(['provision'], dependencies);
  assert.equal(result.restarted, true);
  assert.equal(result.target.running, true);
  assert.deepEqual(commands, [['up', '-d', '--wait']]);
  assert.equal(fs.readFileSync(paths.credentials, 'utf8'), credentialsBefore);
  // Initial presence check, pre-start resolution, and post-compose resolution.
  assert.equal(inspectShapes.length, 3);
  assert.deepEqual(inspectShapes[0].NetworkSettings.Ports, {});
  assert.deepEqual(inspectShapes[1].NetworkSettings.Ports, {});
  assert.deepEqual(
    inspectShapes[2].NetworkSettings.Ports['5432/tcp'],
    [{ HostIp: SANDBOX.HOST, HostPort: String(SANDBOX.DB_PORT) }],
  );
});

test('provision refuses a running container that lost its runtime port binding after compose up', async (t) => {
  const root = tempRoot(t);
  let container = null;
  const docker = (command, args) => {
    assert.equal(command, 'docker');
    if (args[0] === 'volume') return JSON.stringify([fakeVolume()]);
    assert.deepEqual(args, ['inspect', SANDBOX.CONTAINER]);
    if (!container) throw new Error('missing');
    return JSON.stringify([container]);
  };
  const { dependencies } = cliDependencies(root, {
    execFileSyncImpl: docker,
    composeRunner: () => { container = fakeContainer({ runtimePorts: {} }); return ''; },
  });
  await assert.rejects(() => main(['provision'], dependencies), /running container does not publish/u);
});

test('provision refuses an already-running container without a valid runtime port binding', async (t) => {
  for (const [label, runtimePorts, pattern] of [
    ['empty runtime ports', {}, /running container does not publish/u],
    ['wrong runtime port', { '5432/tcp': loopbackBindings(SANDBOX.HOST, 55435) }, /running container port binding does not match/u],
  ]) {
    for (const args of [['provision'], ['provision', '--dry-run']]) {
      const { root } = sandboxState(t);
      const { dependencies, commands } = cliDependencies(root, {
        execFileSyncImpl: dockerInspect(fakeContainer({ runtimePorts })),
      });
      await assert.rejects(
        () => main(args, dependencies),
        pattern,
        `${label} (${args.join(' ')})`,
      );
      assert.equal(commands.length, 0, label);
    }
  }
});

test('stop only invokes compose down for the owned project and preserves the volume', async (t) => {
  const { root } = sandboxState(t);
  const commands = [];
  const dependencies = cliDependencies(root, {
    execFileSyncImpl: dockerInspect(fakeContainer({ running: false })),
    composeRunner: (commandRoot, paths, args) => { commands.push(args); return ''; },
  }).dependencies;
  const result = await main(['stop'], dependencies);
  assert.equal(result.stopped, true);
  assert.deepEqual(commands, [['down']]);
});

test('status inspects a stopped owned container whose runtime ports are empty', async (t) => {
  const { root } = sandboxState(t);
  const dependencies = cliDependencies(root, {
    execFileSyncImpl: dockerInspect(fakeContainer({ running: false })),
  }).dependencies;
  const result = await main(['status'], dependencies);
  assert.equal(result.provisioned, true);
  assert.equal(result.running, false);
  assert.deepEqual(result.target.containerAddresses, []);
});

test('status refuses a running container without a valid runtime port binding', async (t) => {
  for (const [label, runtimePorts, pattern] of [
    ['empty runtime ports', {}, /running container does not publish/u],
    ['wrong runtime port', { '5432/tcp': loopbackBindings(SANDBOX.HOST, 55435) }, /running container port binding does not match/u],
  ]) {
    const { root } = sandboxState(t);
    const dependencies = cliDependencies(root, {
      execFileSyncImpl: dockerInspect(fakeContainer({ runtimePorts })),
    }).dependencies;
    await assert.rejects(() => main(['status'], dependencies), pattern, label);
  }
});

test('status reports a correctly running owned container', async (t) => {
  const { root } = sandboxState(t);
  const dependencies = cliDependencies(root, {
    execFileSyncImpl: dockerInspect(fakeContainer()),
  }).dependencies;
  const result = await main(['status'], dependencies);
  assert.equal(result.provisioned, true);
  assert.equal(result.running, true);
  assert.equal(result.appPortFree, true);
  assert.deepEqual(result.target.containerAddresses, [CONTAINER_IP]);
});

test('status refuses a stopped container whose volume purpose label is missing', async (t) => {
  const { root } = sandboxState(t);
  const dependencies = cliDependencies(root, {
    execFileSyncImpl: dockerInspect(
      fakeContainer({ running: false }),
      fakeVolume({ labels: { 'com.docker.compose.project': SANDBOX.PROJECT } }),
    ),
  }).dependencies;
  await assert.rejects(() => main(['status'], dependencies), /purpose label/u);
});

test('start binds the app to loopback 3001 with the private session secret and readiness check', async (t) => {
  const { root } = sandboxState(t);
  const listenCalls = [];
  const readinessUrls = [];
  let receivedConfig = null;
  const server = new EventEmitter();
  server.close = (callback) => { if (callback) callback(); };
  const dependencies = cliDependencies(root, {
    execFileSyncImpl: dockerInspect(fakeContainer()),
    installSignalHandlers: false,
    createAppFactory: ({ config }) => {
      receivedConfig = config;
      return {
        listen: (port, host) => {
          listenCalls.push([port, host]);
          setImmediate(() => server.emit('listening'));
          return server;
        },
      };
    },
    verifySchemaReadiness: async () => ({ verifiedColumns: 1 }),
    readConfig: (environment) => {
      assert.equal(environment.DATABASE_URL, DSN);
      assert.equal(environment.SESSION_SECRET, SESSION_SECRET);
      return {
        databaseUrl: environment.DATABASE_URL,
        sessionSecret: environment.SESSION_SECRET,
        secureCookies: false,
        production: false,
        publicOrigin: 'http://127.0.0.1:3001',
        port: 3001,
      };
    },
    httpGet: async (url) => { readinessUrls.push(url); return 200; },
  }).dependencies;
  const result = await main(['start'], dependencies);
  assert.deepEqual(listenCalls, [[3001, '127.0.0.1']]);
  assert.deepEqual(readinessUrls, ['http://127.0.0.1:3001/api/wiki-posts']);
  assert.equal(receivedConfig.sessionSecret, SESSION_SECRET);
  assert.equal(receivedConfig.secureCookies, false);
  await result.sql.end();
  await new Promise((resolve) => result.server.close(resolve));
});

test('migrate --dry-run resolves the owned target without DDL or child migration', async (t) => {
  const { root } = sandboxState(t);
  const { dependencies } = cliDependencies(root, {
    execFileSyncImpl: dockerInspect(fakeContainer()),
  });
  const result = await main(['migrate', '--dry-run'], dependencies);
  assert.equal(result.dryRun, true);
  assert.equal(result.target.database, SANDBOX.DATABASE);
});

test('sandbox timestamp parsing treats timezone-less columns as UTC', () => {
  const parse = SANDBOX_POSTGRES_TYPES.utcTimestamp.parse;
  assert.equal(parse('2026-07-05 16:12:02.826').toISOString(), '2026-07-05T16:12:02.826Z');
  assert.equal(parse('2026-07-05T19:12:02.826+03:00').toISOString(), '2026-07-05T16:12:02.826Z');
  assert.equal(parse('2026-11-09').toISOString(), '2026-11-09T00:00:00.000Z');
  assert.equal(
    SANDBOX_POSTGRES_TYPES.utcTimestamp.serialize('2026-07-05T16:12:02.826Z'),
    '2026-07-05T16:12:02.826Z'
  );
});
