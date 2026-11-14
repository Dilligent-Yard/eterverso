'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SOURCE_SCRIPT = path.join(REPO_ROOT, 'scripts', 'test-isolation.js');
const SOURCE_COMPOSE = path.join(REPO_ROOT, 'compose.test.yaml');
const DEVTOOLS = path.join(REPO_ROOT, '.generated', 'node', 'devtools', 'verification', 'index.js');

const FAKE_DOCKER = `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_DOCKER_LOG"
if [ "$1" = "volume" ] && [ "$2" = "inspect" ]; then
  echo "Error: No such volume: $3" >&2
  exit 1
fi
if [ "$1" = "network" ] && [ "$2" = "inspect" ]; then
  echo "Error: No such network: $3" >&2
  exit 1
fi
if [ "$1" = "inspect" ]; then
  echo "Error: No such object: $2" >&2
  exit 1
fi
exit 0
`;

function fixture() {
  assert.ok(fs.existsSync(DEVTOOLS), 'Verification devtools must be built before this test runs.');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eterverso-isolation-state-'));
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.copyFileSync(SOURCE_SCRIPT, path.join(root, 'scripts', 'test-isolation.js'));
  fs.copyFileSync(SOURCE_COMPOSE, path.join(root, 'compose.test.yaml'));
  fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(root, 'node_modules'), 'dir');
  fs.mkdirSync(path.join(root, '.generated', 'node', 'devtools'), { recursive: true });
  fs.symlinkSync(
    path.join(REPO_ROOT, '.generated', 'node', 'devtools', 'verification'),
    path.join(root, '.generated', 'node', 'devtools', 'verification'),
    'dir',
  );
  const docker = path.join(root, 'bin', 'docker');
  fs.writeFileSync(docker, FAKE_DOCKER, { mode: 0o755 });
  const log = path.join(root, 'docker.log');
  fs.writeFileSync(log, '');
  return { root, log };
}

function runIsolation(root, log, args) {
  return spawnSync(process.execPath, [path.join(root, 'scripts', 'test-isolation.js'), ...args], {
    cwd: root,
    encoding: 'utf8',
    env: {
      PATH: `${path.join(root, 'bin')}:${process.env.PATH}`,
      HOME: process.env.HOME,
      FAKE_DOCKER_LOG: log,
    },
  });
}

function dockerCalls(log) {
  return fs.readFileSync(log, 'utf8').split('\n').filter(Boolean);
}

test('a pre-Compose private-state failure removes only the directory created by that invocation', () => {
  const { root, log } = fixture();
  const runId = 'state-regression';
  const runDirectory = path.join(root, '.local', 'test', 'runs', runId);
  try {
    const failed = runIsolation(root, log, ['up', `--run=${runId}`, '--force-failure-before-compose']);
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /Injected setup failure before the second private state write and before Compose/u);
    assert.equal(fs.existsSync(runDirectory), false, 'the failed invocation left its private run directory behind');
    const calls = dockerCalls(log);
    assert.ok(calls.some((call) => /^inspect /u.test(call)), 'the guard should have inspected for preexisting resources');
    assert.equal(calls.some((call) => /^compose /u.test(call)), false, 'Compose was invoked before the injected failure');

    const recovered = runIsolation(root, log, ['down', `--run=${runId}`]);
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.match(recovered.stdout, new RegExp(`run ${runId} is already clean`, 'u'));
    assert.equal(dockerCalls(log).some((call) => /^compose /u.test(call)), false);
    assert.equal(fs.existsSync(runDirectory), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('down refuses and preserves a manifest-only hard-kill partial state', () => {
  const { root, log } = fixture();
  const runId = 'hard-window';
  const runDirectory = path.join(root, '.local', 'test', 'runs', runId);
  const manifestFile = path.join(runDirectory, 'manifest.json');
  try {
    const { buildRunManifest } = require(path.join(REPO_ROOT, '.generated', 'node', 'devtools', 'verification', 'index.js'));
    fs.mkdirSync(runDirectory, { recursive: true, mode: 0o700 });
    fs.chmodSync(runDirectory, 0o700);
    fs.writeFileSync(manifestFile, `${JSON.stringify(buildRunManifest({ runId, root, port: 56001 }), null, 2)}\n`, { mode: 0o600 });
    const result = runIsolation(root, log, ['down', `--run=${runId}`]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /compose\.env/u);
    assert.equal(fs.existsSync(runDirectory), true, 'partial state was deleted without complete recovery proof');
    assert.equal(fs.existsSync(manifestFile), true);
    assert.equal(dockerCalls(log).length, 0, 'down touched Docker before validating complete private state');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('preexisting run state and a run-named symlink are never deleted', () => {
  const { root, log } = fixture();
  const runsRoot = path.join(root, '.local', 'test', 'runs');
  const preexisting = path.join(runsRoot, 'preexisting-run');
  const protectedDirectory = path.join(root, 'protected-target');
  const symlinkRun = path.join(runsRoot, 'symlink-run');
  try {
    fs.mkdirSync(preexisting, { recursive: true });
    fs.writeFileSync(path.join(preexisting, 'keep.txt'), 'keep\n');
    fs.mkdirSync(protectedDirectory);
    fs.writeFileSync(path.join(protectedDirectory, 'keep.txt'), 'keep\n');
    fs.symlinkSync(protectedDirectory, symlinkRun, 'dir');

    const preexistingResult = runIsolation(root, log, ['up', '--run=preexisting-run', '--force-failure-before-compose']);
    assert.equal(preexistingResult.status, 1);
    assert.match(preexistingResult.stderr, /already has private state/u);
    assert.equal(fs.readFileSync(path.join(preexisting, 'keep.txt'), 'utf8'), 'keep\n');

    const symlinkResult = runIsolation(root, log, ['up', '--run=symlink-run', '--force-failure-before-compose']);
    assert.equal(symlinkResult.status, 1);
    assert.match(symlinkResult.stderr, /already has private state/u);
    assert.equal(fs.lstatSync(symlinkRun).isSymbolicLink(), true);
    assert.equal(fs.readFileSync(path.join(protectedDirectory, 'keep.txt'), 'utf8'), 'keep\n');
    assert.equal(dockerCalls(log).some((call) => /^compose /u.test(call)), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the pre-Compose failure hook is accepted only for setup and only once', () => {
  const { parseIsolationArguments } = require('../../scripts/test-isolation');
  assert.equal(
    parseIsolationArguments(['up', '--run=run1', '--force-failure-before-compose']).forceFailureBeforeCompose,
    true,
  );
  assert.throws(
    () => parseIsolationArguments(['up', '--run=run1', '--force-failure-before-compose', '--force-failure-after-up']),
    /only one injected setup failure/u,
  );
  assert.throws(
    () => parseIsolationArguments(['down', '--run=run1', '--force-failure-before-compose']),
    /only available for setup/u,
  );
});
