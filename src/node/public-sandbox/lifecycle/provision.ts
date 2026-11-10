import type {
  GeneratedCredentials,
  ParsedCliOptions,
  ProvisionResult,
  SandboxDependencies,
  StatusResult,
  StopResult,
} from './contracts.js';
import {
  SANDBOX,
  assertNoInheritedDatabaseUrl,
  inspectContainer,
  publicError,
  readCredentials,
  readServiceRecord,
} from '../target.js';
import {
  generateCredentials,
  stateExists,
  statePaths,
  writeInitialState,
} from './state.js';
import {
  assertExistingVolumeOwnership,
  resolveTargetForOperation,
  verifyTargetConnection,
} from './orchestration.js';

function assertDatabasePortFree(
  dependencies: SandboxDependencies,
): Promise<boolean> {
  return dependencies.portChecker(SANDBOX.DB_PORT, SANDBOX.HOST);
}

function assertExistingState(
  dependencies: SandboxDependencies,
): void {
  const record = readServiceRecord({
    root: dependencies.root,
    fsImpl: dependencies.fsImpl,
  });
  readCredentials({
    root: dependencies.root,
    fsImpl: dependencies.fsImpl,
    record,
  });
}

export async function provision(
  options: ParsedCliOptions,
  dependencies: SandboxDependencies,
): Promise<ProvisionResult> {
  const {
    root,
    fsImpl,
    execFileSyncImpl,
    environment,
  } = dependencies;
  assertNoInheritedDatabaseUrl(environment);
  const paths = statePaths(root);
  const hasState = fsImpl.existsSync(paths.directory) ? stateExists(paths, fsImpl) : false;
  if (hasState) assertExistingState(dependencies);
  const container = inspectContainer({ execFileSyncImpl });
  if (container) {
    const target = await resolveTargetForOperation({
      root,
      fsImpl,
      execFileSyncImpl,
      environment,
      requireRunning: false,
    });
    if (target.running) {
      // The permissive pass above distinguishes stopped from running. A
      // running container must still prove its runtime port binding before it
      // is reused or reported ready.
      const runningTarget = await resolveTargetForOperation({
        root,
        fsImpl,
        execFileSyncImpl,
        environment,
        requireRunning: true,
      });
      if (options.dryRun) {
        process.stdout.write(`Would reuse the owned ${runningTarget.project} sandbox at ${runningTarget.host}:${runningTarget.port}/${runningTarget.database}.\n`);
        return { dryRun: true, reused: true, target: runningTarget };
      }
      await verifyTargetConnection(dependencies.sqlFactory, runningTarget);
      process.stdout.write(`Owned sandbox already exists at ${runningTarget.host}:${runningTarget.port}/${runningTarget.database}; no credentials were regenerated.\n`);
      return { dryRun: false, reused: true, target: runningTarget };
    }
    if (options.dryRun) {
      if (!(await assertDatabasePortFree(dependencies))) {
        throw publicError(`The sandbox database port ${SANDBOX.DB_PORT} is already in use; refusing to occupy an unknown service.`);
      }
      process.stdout.write(`Would start the existing owned ${target.project} sandbox at ${target.host}:${target.port}/${target.database} without regenerating credentials.\n`);
      return { dryRun: true, reused: true, restarted: true, target };
    }
    if (!(await assertDatabasePortFree(dependencies))) {
      throw publicError(`The sandbox database port ${SANDBOX.DB_PORT} is already in use; refusing to occupy an unknown service.`);
    }
    process.stdout.write(`Starting the existing owned ${target.project} sandbox; credentials and volume are preserved.\n`);
    dependencies.composeRunner(root, paths, ['up', '-d', '--wait'], execFileSyncImpl);
    const started = await resolveTargetForOperation({
      root,
      fsImpl,
      execFileSyncImpl,
      environment,
    });
    await verifyTargetConnection(dependencies.sqlFactory, started);
    process.stdout.write(`Public sandbox database ready: ${started.database} at ${started.host}:${started.port} (project ${started.project}, instance ${started.instanceId}, volume ${started.volume}).\n`);
    return { dryRun: false, reused: true, restarted: true, target: started };
  }

  // A first provision has no volume yet; Docker will create it with the Compose
  // purpose label. If the named volume already exists, prove its label before
  // writing private state or starting a container on it.
  assertExistingVolumeOwnership(execFileSyncImpl);

  if (options.dryRun) {
    if (!(await assertDatabasePortFree(dependencies))) {
      throw publicError(`The sandbox database port ${SANDBOX.DB_PORT} is already in use; refusing to occupy an unknown service.`);
    }
    process.stdout.write(`Would provision ${SANDBOX.PROJECT} on ${SANDBOX.HOST}:${SANDBOX.DB_PORT}/${SANDBOX.DATABASE} with volume ${SANDBOX.VOLUME}.\n`);
    process.stdout.write('No service, credentials, instance record, DDL, accounts, or content would be written.\n');
    return { dryRun: true, reused: false };
  }

  if (!(await assertDatabasePortFree(dependencies))) {
    throw publicError(`The sandbox database port ${SANDBOX.DB_PORT} is already in use; refusing to occupy an unknown service.`);
  }
  let generated: GeneratedCredentials | undefined;
  if (hasState) {
    assertExistingState(dependencies);
  } else {
    generated = generateCredentials(dependencies.randomBytes, dependencies.now);
    writeInitialState(root, generated, fsImpl);
  }
  process.stdout.write(`Provisioning ${SANDBOX.PROJECT} on ${SANDBOX.HOST}:${SANDBOX.DB_PORT}/${SANDBOX.DATABASE}.\n`);
  dependencies.composeRunner(root, paths, ['up', '-d', '--wait'], execFileSyncImpl);
  const target = await resolveTargetForOperation({
    root,
    fsImpl,
    execFileSyncImpl,
    environment,
  });
  await verifyTargetConnection(dependencies.sqlFactory, target);
  process.stdout.write(`Public sandbox database ready: ${target.database} at ${target.host}:${target.port} (project ${target.project}, instance ${target.instanceId}, volume ${target.volume}).\n`);
  return { dryRun: false, reused: false, target };
}

export async function stopSandbox(
  _options: ParsedCliOptions,
  dependencies: SandboxDependencies,
): Promise<StopResult> {
  const paths = statePaths(dependencies.root);
  readServiceRecord({ root: dependencies.root, fsImpl: dependencies.fsImpl });
  const container = inspectContainer({ execFileSyncImpl: dependencies.execFileSyncImpl });
  if (!container) {
    process.stdout.write('No owned public sandbox container is present; the named volume was not touched.\n');
    return { stopped: false };
  }
  const target = await resolveTargetForOperation({
    root: dependencies.root,
    fsImpl: dependencies.fsImpl,
    execFileSyncImpl: dependencies.execFileSyncImpl,
    environment: {},
    requireRunning: false,
  });
  process.stdout.write(`Stopping only ${target.project} (${target.container}); the named volume ${target.volume} is preserved.\n`);
  dependencies.composeRunner(dependencies.root, paths, ['down'], dependencies.execFileSyncImpl);
  return { stopped: true, target };
}

export async function statusSandbox(
  _options: ParsedCliOptions,
  dependencies: SandboxDependencies,
): Promise<StatusResult> {
  const paths = statePaths(dependencies.root);
  const hasState = dependencies.fsImpl.existsSync(paths.directory)
    ? stateExists(paths, dependencies.fsImpl)
    : false;
  if (!hasState) {
    process.stdout.write('Public sandbox is not provisioned.\n');
    return { provisioned: false };
  }
  const record = readServiceRecord({
    root: dependencies.root,
    fsImpl: dependencies.fsImpl,
  });
  readCredentials({
    root: dependencies.root,
    fsImpl: dependencies.fsImpl,
    record,
  });
  const container = inspectContainer({ execFileSyncImpl: dependencies.execFileSyncImpl });
  if (!container) {
    process.stdout.write(`Public sandbox ${record.project} is provisioned but its owned container is not running; volume ${record.volume} remains.\n`);
    return { provisioned: true, running: false, record };
  }
  const target = await resolveTargetForOperation({
    root: dependencies.root,
    fsImpl: dependencies.fsImpl,
    execFileSyncImpl: dependencies.execFileSyncImpl,
    environment: {},
    requireRunning: false,
  });
  if (!target.running) {
    process.stdout.write(`Public sandbox ${target.project} is provisioned but its owned container is stopped; volume ${target.volume} remains.\n`);
    return { provisioned: true, running: false, target };
  }
  // A running container must pass the strict runtime-port guard before status
  // reports it as running; requireRunning:false is only for stopped targets.
  const runningTarget = await resolveTargetForOperation({
    root: dependencies.root,
    fsImpl: dependencies.fsImpl,
    execFileSyncImpl: dependencies.execFileSyncImpl,
    environment: {},
    requireRunning: true,
  });
  const appPortFree = await dependencies.portChecker(runningTarget.appPort, SANDBOX.HOST);
  process.stdout.write(`Public sandbox ${runningTarget.project} is running: database ${runningTarget.database} at ${runningTarget.host}:${runningTarget.port}, instance ${runningTarget.instanceId}, volume ${runningTarget.volume}, app port ${runningTarget.appPort} (${appPortFree ? 'free' : 'in use'}).\n`);
  return { provisioned: true, running: true, target: runningTarget, appPortFree };
}
