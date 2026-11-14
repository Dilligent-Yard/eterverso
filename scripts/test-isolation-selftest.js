'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const PROTECTED_CONTAINER = 'eterverso-test-db-1';
const PROTECTED_VOLUMES = ['eterverso-test-data', 'eterverso-dev_postgres-data', 'eterverso-public-sandbox-data'];

function requireNode24() {
  if (Number(process.versions.node.split('.')[0]) !== 24) {
    throw new Error('The isolation self-test requires Node.js 24.');
  }
}

function run(args, options = {}) {
  const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts/test-isolation.js'), ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: process.env,
    stdio: options.expectFailure ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
  });
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error,
  };
}

function mustRun(label, args) {
  const result = run(args);
  if (result.error || result.status !== 0) {
    throw new Error(`${label} failed: ${result.stderr.trim() || result.error?.message || `exit ${result.status}`}`);
  }
  return result;
}

function mustFail(label, args) {
  const result = run(args, { expectFailure: true });
  if (!result.error && result.status === 0) throw new Error(`${label} unexpectedly succeeded.`);
  return result;
}

function dockerInspect(kind, name) {
  const args = kind === 'volume'
    ? ['volume', 'inspect', name]
    : kind === 'network'
      ? ['network', 'inspect', name]
      : ['inspect', name];
  const result = spawnSync('docker', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) return null;
  const parsed = JSON.parse(result.stdout);
  return Array.isArray(parsed) ? parsed[0] : null;
}

function protectedSnapshot() {
  const container = dockerInspect('container', PROTECTED_CONTAINER);
  return {
    containerId: container?.Id ?? null,
    volumes: Object.fromEntries(PROTECTED_VOLUMES.map((name) => [name, dockerInspect('volume', name)?.Name ?? null])),
  };
}

function assertProtectedUnchanged(before) {
  const after = protectedSnapshot();
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error('A protected test/development/sandbox resource changed during the isolation self-test.');
  }
}

function parseTarget(result) {
  const parsed = JSON.parse(result.stdout);
  if (!parsed || !parsed.runId || !parsed.project || !parsed.volume || !parsed.network || !Number.isInteger(parsed.port)) {
    throw new Error('Isolation assertion did not return a complete safe target.');
  }
  return parsed;
}

function newRunId(label) {
  return `${label}-${crypto.randomBytes(4).toString('hex')}`;
}

function containerName(target) {
  return target.container.replace(/^\//u, '');
}

function docker(args) {
  const result = spawnSync('docker', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.error || result.status !== 0) {
    throw new Error(`docker ${args.join(' ')} failed: ${(result.stderr || '').trim()}`);
  }
}

function assertRunRemoved(runId, target) {
  if (dockerInspect('container', containerName(target))
      || dockerInspect('volume', target.volume)
      || dockerInspect('network', target.network)) {
    throw new Error(`Run ${runId} resources remain after cleanup.`);
  }
  if (fs.existsSync(path.join(ROOT, '.local/test/runs', runId))) {
    throw new Error(`Run ${runId} private state remains after cleanup.`);
  }
}

function main() {
  requireNode24();
  if (fs.existsSync(path.join(ROOT, '.env'))) {
    throw new Error('The isolation self-test refuses a root .env; run it in the clean verification worktree.');
  }
  const protectedBefore = protectedSnapshot();
  const runA = newRunId('selftest-a');
  const runB = newRunId('selftest-b');
  const runC = newRunId('selftest-c');
  const runD = newRunId('selftest-d');
  const runE = newRunId('selftest-e');
  const runF = newRunId('selftest-f');
  const runG = newRunId('selftest-g');
  let aCreated = false;
  let bCreated = false;
  let dCreated = false;
  let eCreated = false;
  try {
    mustRun('setup run A', ['up', `--run=${runA}`]);
    aCreated = true;
    mustRun('setup run B', ['up', `--run=${runB}`]);
    bCreated = true;

    const targetA = parseTarget(mustRun('assert run A', ['assert', `--run=${runA}`]));
    const targetB = parseTarget(mustRun('assert run B', ['assert', `--run=${runB}`]));
    if (targetA.runId !== runA || targetB.runId !== runB) throw new Error('Assertions returned the wrong run identity.');
    if (targetA.port === targetB.port || targetA.volume === targetB.volume || targetA.project === targetB.project) {
      throw new Error('Two run identities did not receive distinct ports, volumes and projects.');
    }

    mustRun('sentinel mutation probe on run A', ['sentinel-mutation-probe', `--run=${runA}`]);
    mustRun('cleanup run B only', ['down', `--run=${runB}`]);
    bCreated = false;
    if (!dockerInspect('container', targetA.container.replace(/^\//u, ''))) {
      throw new Error('Cleaning run B removed run A\'s container.');
    }
    if (!dockerInspect('volume', targetA.volume)) throw new Error('Cleaning run B removed run A\'s volume.');
    if (dockerInspect('container', targetB.container.replace(/^\//u, '')) || dockerInspect('volume', targetB.volume)) {
      throw new Error('Run B resources remain after its cleanup.');
    }
    mustRun('assert run A after run B cleanup', ['assert', `--run=${runA}`]);
    mustFail('assert missing run B', ['assert', `--run=${runB}`]);
    mustFail('assert a run ID that was never created', ['assert', '--run=selftest-never-created']);

    mustRun('cleanup run A', ['down', `--run=${runA}`]);
    aCreated = false;
    mustRun('idempotent cleanup of run A', ['down', `--run=${runA}`]);
    if (dockerInspect('container', targetA.container.replace(/^\//u, '')) || dockerInspect('volume', targetA.volume)) {
      throw new Error('Run A resources remain after cleanup.');
    }

    const failed = mustFail('injected setup failure run C', ['up', `--run=${runC}`, '--force-failure-after-up']);
    if (!/Injected setup failure/u.test(failed.stderr)) {
      throw new Error('The injected setup failure did not report its expected cause.');
    }
    if (dockerInspect('container', `eterverso-wm-${runC}-db-1`) || dockerInspect('volume', `eterverso-wm-${runC}-test-data`)) {
      throw new Error('Failed setup left run C resources behind.');
    }
    if (fs.existsSync(path.join(ROOT, '.local/test/runs', runC))) {
      throw new Error('Failed setup left run C private state behind.');
    }

    mustRun('setup run D', ['up', `--run=${runD}`]);
    dCreated = true;
    const targetD = parseTarget(mustRun('assert run D', ['assert', `--run=${runD}`]));
    docker(['stop', containerName(targetD)]);
    mustRun('cleanup stopped owned run D', ['down', `--run=${runD}`]);
    dCreated = false;
    assertRunRemoved(runD, targetD);

    mustRun('setup run E', ['up', `--run=${runE}`]);
    eCreated = true;
    const targetE = parseTarget(mustRun('assert run E', ['assert', `--run=${runE}`]));
    docker(['rm', '-f', containerName(targetE)]);
    if (!dockerInspect('network', targetE.network)) {
      throw new Error('The partial-removal regression did not leave the run-owned network behind.');
    }
    mustRun('cleanup partially removed run E', ['down', `--run=${runE}`]);
    eCreated = false;
    assertRunRemoved(runE, targetE);

    const stoppedFailure = mustFail('stopped-container setup failure run F', ['up', `--run=${runF}`, '--force-failure-after-stop']);
    if (!/Injected setup failure after stopping the owned container/u.test(stoppedFailure.stderr)) {
      throw new Error('The stopped-container setup failure did not report its expected cause.');
    }
    if (dockerInspect('container', `eterverso-wm-${runF}-db-1`) || dockerInspect('volume', `eterverso-wm-${runF}-test-data`)) {
      throw new Error('Stopped-container setup failure left run F resources behind.');
    }
    if (fs.existsSync(path.join(ROOT, '.local/test/runs', runF))) {
      throw new Error('Stopped-container setup failure left run F private state behind.');
    }

    const preComposeFailure = mustFail('pre-Compose state failure run G', ['up', `--run=${runG}`, '--force-failure-before-compose']);
    if (!/Injected setup failure before the second private state write/u.test(preComposeFailure.stderr)) {
      throw new Error('The pre-Compose state failure did not report its expected cause.');
    }
    if (dockerInspect('container', `eterverso-wm-${runG}-db-1`)
        || dockerInspect('volume', `eterverso-wm-${runG}-test-data`)
        || dockerInspect('network', `eterverso-wm-${runG}_default`)) {
      throw new Error('Pre-Compose state failure created or left run G resources behind.');
    }
    if (fs.existsSync(path.join(ROOT, '.local/test/runs', runG))) {
      throw new Error('Pre-Compose state failure left run G private state behind.');
    }

    assertProtectedUnchanged(protectedBefore);
    process.stdout.write(JSON.stringify({
      gate: 'ENV-02',
      runA,
      runB,
      runC,
      runD,
      runE,
      runF,
      runG,
      distinctResources: true,
      crossRunAssertRefused: true,
      crossRunCleanupIsolated: true,
      sentinelMutationDetected: true,
      failedSetupCleanedUp: true,
      stoppedOwnedCleanup: true,
      partialRemoveCleanup: true,
      partialRemoveNetworkCleanup: true,
      stoppedSetupFailureCleanup: true,
      preComposeFailureCleanedUp: true,
      protectedResourcesUnchanged: true,
    }, null, 2) + '\n');
    process.stdout.write('ENV-02 isolation self-test passed: distinct run identities could not claim or clean each other\'s resources; stopped and partially removed owned resources were cleaned.\n');
  } finally {
    if (eCreated) run(['down', `--run=${runE}`]);
    if (dCreated) run(['down', `--run=${runD}`]);
    if (bCreated) run(['down', `--run=${runB}`]);
    if (aCreated) run(['down', `--run=${runA}`]);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error && error.message || 'Isolation self-test failed.'}\n`);
    process.exitCode = 1;
  }
}

module.exports = { main, protectedSnapshot };
