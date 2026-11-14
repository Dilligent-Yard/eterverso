'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SOURCE_RUNNER = path.join(REPO_ROOT, 'scripts', 'test-runner.js');

// A synthetic DSN only: no Docker, database, port, Chromium, .env or network is
// used by this fixture. The copied runner is exercised against a fake guard and
// a fake Playwright CLI so its isolated orchestration is observed end to end.
const FAKE_PORT = 56001;
const SYNTHETIC_DSN = `postgres://eterverso_test:synthetic-secret@127.0.0.1:${FAKE_PORT}/eterverso_test`;
const DEVELOPMENT_DSN = 'postgres://eterverso:development-secret@127.0.0.1:55432/eterverso';
const STALE_ENVIRONMENT = {
  DATABASE_URL: DEVELOPMENT_DSN,
  DEV_DATABASE_URL: DEVELOPMENT_DSN,
  ETERVERSO_TEST_DATABASE_URL: 'postgres://eterverso_test:stale@127.0.0.1:55999/eterverso_test',
  ETERVERSO_VERIFY_PROFILE: 'isolated',
  ETERVERSO_VERIFY_RUN_ID: 'stale-run',
  ETERVERSO_TEST_DB_PORT: '55999',
};

const FAKE_GUARD = String.raw`'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const command = args[0];
const runArgument = args.find((argument) => argument.startsWith('--run='));
const runId = runArgument ? runArgument.slice('--run='.length) : null;

fs.appendFileSync(path.join(ROOT, 'mock-guard.log'), JSON.stringify({ command, runId }) + '\n');

if (command === 'assert') {
  if (process.env.MOCK_GUARD_FAIL === '1') {
    process.stderr.write('Mock guard refused the isolated run.\n');
    process.exit(1);
  }
  const port = Number(process.env.MOCK_GUARD_PORT || '56001');
  process.stdout.write(JSON.stringify({
    runId,
    project: 'eterverso-wm-' + runId,
    container: '/eterverso-wm-' + runId + '-db-1',
    volume: 'eterverso-wm-' + runId + '-test-data',
    network: 'eterverso-wm-' + runId + '_default',
    host: '127.0.0.1',
    port,
    database: 'eterverso_test',
    sentinelDatabase: 'eterverso_test_sentinel',
  }, null, 2) + '\n');
  process.exit(0);
}

if (command === 'fingerprint') {
  const mode = process.env.MOCK_SENTINEL_MODE || 'stable';
  if (mode === 'changed') {
    const counterFile = path.join(ROOT, 'mock-fingerprint-count');
    const count = fs.existsSync(counterFile) ? Number(fs.readFileSync(counterFile, 'utf8')) : 0;
    fs.writeFileSync(counterFile, String(count + 1));
    process.stdout.write(JSON.stringify({ digest: count === 0 ? 'digest-before' : 'digest-after' }) + '\n');
    process.exit(0);
  }
  process.stdout.write(JSON.stringify({ digest: 'digest-stable' }) + '\n');
  process.exit(0);
}

process.stderr.write('Unexpected mock guard command.\n');
process.exit(1);
`;

const FAKE_PLAYWRIGHT = String.raw`'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

fs.appendFileSync(path.join(ROOT, 'suite-order.log'), 'browser\n');
fs.writeFileSync(path.join(ROOT, 'observed-browser.json'), JSON.stringify({
  argv: process.argv.slice(2),
  databaseUrl: process.env.ETERVERSO_TEST_DATABASE_URL,
  profile: process.env.ETERVERSO_VERIFY_PROFILE,
  runId: process.env.ETERVERSO_VERIFY_RUN_ID,
  port: process.env.ETERVERSO_TEST_DB_PORT,
  developmentUrl: process.env.DATABASE_URL,
  legacyDevelopmentUrl: process.env.DEV_DATABASE_URL,
}, null, 2) + '\n');
process.exit(0);
`;

function suiteFixture(label, failureGuard) {
  return String.raw`'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');

function record(identity) {
  fs.appendFileSync(path.join(ROOT, 'suite-order.log'), identity + '\n');
  fs.writeFileSync(path.join(ROOT, 'observed-' + identity + '.json'), JSON.stringify({
    databaseUrl: process.env.ETERVERSO_TEST_DATABASE_URL,
    profile: process.env.ETERVERSO_VERIFY_PROFILE,
    runId: process.env.ETERVERSO_VERIFY_RUN_ID,
    port: process.env.ETERVERSO_TEST_DB_PORT,
    developmentUrl: process.env.DATABASE_URL,
    legacyDevelopmentUrl: process.env.DEV_DATABASE_URL,
  }, null, 2) + '\n');
}

test('fixture ${label} suite', () => {
  record('${label}');
  ${failureGuard}
});
`;
}

const UNIT_SUITE = suiteFixture('unit', '');
const INTEGRATION_SUITE = suiteFixture(
  'integration',
  "if (process.env.MOCK_SUITE_FAIL === '1') assert.fail('injected fixture integration failure');",
);

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eterverso-runner-orchestration-'));
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.copyFileSync(SOURCE_RUNNER, path.join(root, 'scripts', 'test-runner.js'));
  fs.writeFileSync(path.join(root, 'scripts', 'test-isolation.js'), FAKE_GUARD, { mode: 0o755 });
  fs.mkdirSync(path.join(root, 'tests', 'unit'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tests', 'integration'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tests', 'browser'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tests', 'unit', 'fixture.test.js'), UNIT_SUITE);
  fs.writeFileSync(path.join(root, 'tests', 'integration', 'fixture.test.js'), INTEGRATION_SUITE);
  fs.writeFileSync(path.join(root, 'tests', 'browser', 'fixture.spec.js'), '// Run by the fake Playwright CLI.\n');
  fs.writeFileSync(path.join(root, 'tests', 'browser', 'playwright.config.js'), 'module.exports = {};\n');
  fs.mkdirSync(path.join(root, 'node_modules', '@playwright', 'test'), { recursive: true });
  fs.writeFileSync(path.join(root, 'node_modules', '@playwright', 'test', 'cli.js'), FAKE_PLAYWRIGHT);
  fs.symlinkSync(path.join(REPO_ROOT, 'node_modules', 'dotenv'), path.join(root, 'node_modules', 'dotenv'), 'dir');
  fs.symlinkSync(path.join(REPO_ROOT, 'node_modules', 'postgres'), path.join(root, 'node_modules', 'postgres'), 'dir');
  return root;
}

function writeConnection(root, runId, contents = `ETERVERSO_TEST_DATABASE_URL=${SYNTHETIC_DSN}\n`) {
  const directory = path.join(root, '.local', 'test', 'runs', runId);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(directory, 'connection.env'), contents, { mode: 0o600 });
}

function runRunner(root, args, extraEnvironment = {}) {
  return spawnSync(process.execPath, [path.join(root, 'scripts', 'test-runner.js'), ...args], {
    cwd: root,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      ...extraEnvironment,
    },
  });
}

function lines(root, file) {
  const target = path.join(root, file);
  if (!fs.existsSync(target)) return [];
  return fs.readFileSync(target, 'utf8').split('\n').filter(Boolean);
}

function guardCommands(root) {
  return lines(root, 'mock-guard.log').map((line) => {
    const parsed = JSON.parse(line);
    assert.equal(typeof parsed.runId, 'string');
    return parsed.command;
  });
}

function observed(root, identity) {
  return JSON.parse(fs.readFileSync(path.join(root, 'observed-' + identity + '.json'), 'utf8'));
}

test('isolated arguments, guard refusal and incomplete private state stop before any child suite', () => {
  const root = createFixture();
  try {
    for (const command of ['integration', 'browser', 'default', 'all']) {
      const missingRun = runRunner(root, [command, '--sentinel=isolated']);
      assert.equal(missingRun.status, 1, `${command} accepted an isolated run without an identity`);
      assert.match(missingRun.stderr, /requires an explicit --run/u);
    }
    const runWithoutProfile = runRunner(root, ['integration', '--run=isolated-run']);
    assert.equal(runWithoutProfile.status, 1);
    assert.match(runWithoutProfile.stderr, /only accepted with --sentinel=isolated/u);
    const unknownProfile = runRunner(root, ['integration', '--sentinel=other']);
    assert.equal(unknownProfile.status, 1);
    assert.match(unknownProfile.stderr, /Choose/u);

    const refusedGuard = runRunner(root, ['integration', '--sentinel=isolated', '--run=guard-refused'], {
      MOCK_GUARD_FAIL: '1',
    });
    assert.equal(refusedGuard.status, 1);
    assert.match(refusedGuard.stderr, /Mock guard refused the isolated run/u);
    assert.deepEqual(guardCommands(root), ['assert']);

    const missingState = runRunner(root, ['integration', '--sentinel=isolated', '--run=missing-state']);
    assert.equal(missingState.status, 1);
    assert.match(missingState.stderr, /record is missing after its guard passed/u);

    writeConnection(root, 'incomplete-state', 'UNRELATED_SETTING=value\n');
    const incompleteState = runRunner(root, ['integration', '--sentinel=isolated', '--run=incomplete-state']);
    assert.equal(incompleteState.status, 1);
    assert.match(incompleteState.stderr, /connection record is incomplete/u);

    assert.deepEqual(lines(root, 'suite-order.log'), [], 'a child suite ran before the guard and state checks passed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  const unitRoot = createFixture();
  try {
    const unit = runRunner(unitRoot, ['unit', '--sentinel=isolated', '--run=unit-only'], STALE_ENVIRONMENT);
    assert.equal(unit.status, 0, unit.stderr);
    assert.deepEqual(guardCommands(unitRoot), [], 'isolated unit asked the guard for a run it does not need');
    assert.deepEqual(lines(unitRoot, 'suite-order.log'), ['unit']);
    const unitEnvironment = observed(unitRoot, 'unit');
    assert.equal(unitEnvironment.profile, undefined, 'a stale isolated profile leaked into the unit child');
    assert.equal(unitEnvironment.runId, undefined, 'a stale isolated run leaked into the unit child');
    assert.equal(unitEnvironment.port, undefined, 'a stale isolated port leaked into the unit child');
    assert.equal(unitEnvironment.developmentUrl, undefined);
    assert.equal(unitEnvironment.legacyDevelopmentUrl, undefined);
  } finally {
    fs.rmSync(unitRoot, { recursive: true, force: true });
  }
});

test('integration opens one guard window and passes only the explicit run identity', () => {
  const root = createFixture();
  try {
    writeConnection(root, 'run-integration');
    const result = runRunner(root, ['integration', '--sentinel=isolated', '--run=run-integration'], STALE_ENVIRONMENT);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Isolated sentinel unchanged\./u);
    assert.deepEqual(guardCommands(root), ['assert', 'fingerprint', 'fingerprint']);

    const environment = observed(root, 'integration');
    assert.equal(environment.databaseUrl, SYNTHETIC_DSN);
    assert.equal(environment.profile, 'isolated');
    assert.equal(environment.runId, 'run-integration');
    assert.equal(environment.port, String(FAKE_PORT));
    assert.equal(environment.developmentUrl, undefined, 'the development DSN reached the isolated child');
    assert.equal(environment.legacyDevelopmentUrl, undefined, 'the legacy development DSN reached the isolated child');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('browser invokes the repository Playwright config with the isolated environment', () => {
  const root = createFixture();
  try {
    writeConnection(root, 'run-browser');
    const result = runRunner(root, ['browser', '--sentinel=isolated', '--run=run-browser'], STALE_ENVIRONMENT);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Isolated sentinel unchanged\./u);
    assert.deepEqual(guardCommands(root), ['assert', 'fingerprint', 'fingerprint']);

    const browser = observed(root, 'browser');
    assert.ok(browser.argv.includes('test'), 'the fake Playwright CLI did not receive its test command');
    assert.ok(
      browser.argv.includes(`--config=${path.join(root, 'tests', 'browser', 'playwright.config.js')}`),
      'the fake Playwright CLI did not receive the fixture config path',
    );
    assert.ok(browser.argv.includes(path.join('tests', 'browser', 'fixture.spec.js')));
    assert.equal(browser.databaseUrl, SYNTHETIC_DSN);
    assert.equal(browser.profile, 'isolated');
    assert.equal(browser.runId, 'run-browser');
    assert.equal(browser.port, String(FAKE_PORT));
    assert.equal(browser.developmentUrl, undefined);
    assert.equal(browser.legacyDevelopmentUrl, undefined);
    assert.deepEqual(lines(root, 'suite-order.log'), ['browser']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('default and all preserve suite order inside one sentinel window', () => {
  for (const [command, expectedOrder] of [
    ['default', ['unit', 'integration']],
    ['all', ['unit', 'integration', 'browser']],
  ]) {
    const runId = `run-${command}`;
    const root = createFixture();
    try {
      writeConnection(root, runId);
      const result = runRunner(root, [command, '--sentinel=isolated', `--run=${runId}`], STALE_ENVIRONMENT);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Isolated sentinel unchanged\./u);
      assert.deepEqual(lines(root, 'suite-order.log'), expectedOrder);
      assert.deepEqual(guardCommands(root), ['assert', 'fingerprint', 'fingerprint']);

      const unitEnvironment = observed(root, 'unit');
      assert.equal(unitEnvironment.profile, undefined, 'an isolated profile leaked into the unit child');
      assert.equal(unitEnvironment.runId, undefined, 'an isolated run leaked into the unit child');
      assert.equal(unitEnvironment.port, undefined, 'an isolated port leaked into the unit child');

      const integrationEnvironment = observed(root, 'integration');
      assert.equal(integrationEnvironment.databaseUrl, SYNTHETIC_DSN);
      assert.equal(integrationEnvironment.profile, 'isolated');
      assert.equal(integrationEnvironment.runId, runId);
      assert.equal(integrationEnvironment.port, String(FAKE_PORT));
      assert.equal(integrationEnvironment.developmentUrl, undefined);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('sentinel mismatch and suite failure still complete the final comparison', () => {
  const changedRoot = createFixture();
  try {
    writeConnection(changedRoot, 'run-changed');
    const changed = runRunner(
      changedRoot,
      ['integration', '--sentinel=isolated', '--run=run-changed'],
      { ...STALE_ENVIRONMENT, MOCK_SENTINEL_MODE: 'changed' },
    );
    assert.equal(changed.status, 1);
    assert.match(changed.stderr, /Isolated sentinel changed while tests ran/u);
    assert.doesNotMatch(changed.stdout, /Isolated sentinel unchanged/u);
    assert.deepEqual(guardCommands(changedRoot), ['assert', 'fingerprint', 'fingerprint']);
  } finally {
    fs.rmSync(changedRoot, { recursive: true, force: true });
  }

  const failingRoot = createFixture();
  try {
    writeConnection(failingRoot, 'run-failing');
    const failing = runRunner(
      failingRoot,
      ['integration', '--sentinel=isolated', '--run=run-failing'],
      { ...STALE_ENVIRONMENT, MOCK_SUITE_FAIL: '1' },
    );
    assert.equal(failing.status, 1);
    assert.match(failing.stderr, /Test command exited with status 1/u);
    assert.deepEqual(lines(failingRoot, 'suite-order.log'), ['integration']);
    assert.deepEqual(
      guardCommands(failingRoot),
      ['assert', 'fingerprint', 'fingerprint'],
      'the final fingerprint comparison did not run after the suite failure',
    );
    assert.doesNotMatch(failing.stdout, /Isolated sentinel unchanged/u);
  } finally {
    fs.rmSync(failingRoot, { recursive: true, force: true });
  }

  const combinedRoot = createFixture();
  try {
    writeConnection(combinedRoot, 'run-combined');
    const combined = runRunner(
      combinedRoot,
      ['integration', '--sentinel=isolated', '--run=run-combined'],
      { ...STALE_ENVIRONMENT, MOCK_SUITE_FAIL: '1', MOCK_SENTINEL_MODE: 'changed' },
    );
    assert.equal(combined.status, 1);
    assert.match(combined.stderr, /Isolated sentinel changed while tests ran/u);
    assert.deepEqual(lines(combinedRoot, 'suite-order.log'), ['integration']);
    assert.deepEqual(guardCommands(combinedRoot), ['assert', 'fingerprint', 'fingerprint']);
    assert.doesNotMatch(combined.stdout, /Isolated sentinel unchanged/u);
  } finally {
    fs.rmSync(combinedRoot, { recursive: true, force: true });
  }
});
