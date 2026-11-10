import * as http from 'node:http';
import * as path from 'node:path';
import {
  TESTER_SPECS,
  applyImportPlan,
  buildImportPlan,
  inspectExistingTesters,
  readCapture,
  testerCredentialsContents,
} from '../import/index.js';
import type { ImportPlan } from '../import/contracts.js';
import {
  SANDBOX,
  publicError,
  verifyConnectedIdentity,
  writePrivateFile,
} from '../target.js';
import type {
  ImportResult,
  MigrateResult,
  ParsedCliOptions,
  SandboxDependencies,
  SandboxHttpServer,
  StartResult,
} from './contracts.js';
import {
  existingTesterPasswords,
  generateTesterPasswords,
  statePaths,
} from './state.js';
import {
  resolveTargetForOperation,
  sandboxPostgres,
  verifyTargetConnection,
} from './orchestration.js';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function runNodeScript(
  root: string,
  script: string,
  args: readonly string[],
  dependencies: SandboxDependencies,
): unknown {
  const environment = { ...dependencies.environment };
  delete environment.DATABASE_URL;
  return dependencies.runNode(
    process.execPath,
    [path.join(root, script), ...args],
    { cwd: root, env: environment, stdio: 'inherit' },
  );
}

export async function migrate(
  options: ParsedCliOptions,
  dependencies: SandboxDependencies,
): Promise<MigrateResult> {
  const target = await resolveTargetForOperation(dependencies);
  if (options.dryRun) {
    process.stdout.write(`Would migrate the owned public sandbox ${target.database} (instance ${target.instanceId}) at ${target.host}:${target.port} using the committed drizzle journal.\n`);
    process.stdout.write('No service, DDL, accounts, or content would be written.\n');
    return { dryRun: true, target };
  }
  await verifyTargetConnection(dependencies.sqlFactory, target);
  process.stdout.write(`Migrating the owned public sandbox ${target.database} (instance ${target.instanceId}) at ${target.host}:${target.port}; development and test targets are not used.\n`);
  runNodeScript(dependencies.root, 'scripts/db-migrate.js', ['migrate', '--target=sandbox'], dependencies);
  runNodeScript(dependencies.root, 'scripts/db-migrate.js', ['preflight', '--target=sandbox'], dependencies);
  await verifyTargetConnection(dependencies.sqlFactory, target);
  process.stdout.write('Sandbox migration completed and readiness preflight passed.\n');
  return { dryRun: false, target };
}

export function summarizePlan(plan: ImportPlan): string {
  const lines = [
    `Capture ${plan.capture.captureId} from ${plan.capture.origin} (${plan.capture.complete ? 'complete' : 'partial'}; ${plan.gaps.length} gap(s)).`,
    `Plan: ${plan.counts.characters} character(s), ${plan.counts.scenes} scene(s), ${plan.counts.sceneTurns} scene turn(s), ${plan.counts.wikiPages} wiki page(s), ${plan.counts.wikiSections} section(s), ${plan.counts.forumThreads} forum thread(s), ${plan.counts.forumPosts} post(s).`,
    `Local identities: ${plan.counts.publicAuthorPlaceholders} public author placeholder(s), ${plan.counts.missingAuthorFallbacks} missing-author fallback(s), ${TESTER_SPECS.length} synthetic tester(s), 1 reconstruction actor. Citations available from public DTOs: ${plan.counts.citations}.`,
  ];
  if (plan.gaps.length) {
    for (const gap of plan.gaps) {
      lines.push(`Gap: ${gap.family} ${gap.endpoint} returned ${gap.status}: ${gap.reason}.`);
    }
  }
  if (plan.normalizations.length) {
    lines.push('Normalizations:');
    for (const item of plan.normalizations) {
      const field = item.field ? ` field=${item.field}` : '';
      const authorId = item.authorId ? ` authorId=${item.authorId}` : '';
      const pageId = item.pageId ? ` pageId=${item.pageId}` : '';
      lines.push(`  - ${item.kind}${field}${authorId}${pageId}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

export async function importCapture(
  options: ParsedCliOptions,
  dependencies: SandboxDependencies,
): Promise<ImportResult> {
  const capture = readCapture({
    captureDirectory: options.capture,
    fsImpl: dependencies.fsImpl,
  });
  const paths = statePaths(dependencies.root);
  const existingPasswords = existingTesterPasswords(paths, dependencies.fsImpl);
  let plan = buildImportPlan({
    capture,
    testerPasswords: existingPasswords,
    passwordHasher: dependencies.passwordHasher,
  });
  if (options.dryRun) {
    process.stdout.write(summarizePlan(plan));
    process.stdout.write('Dry-run validated the complete capture and manifest hashes; no database connection or content write was performed.\n');
    return { dryRun: true, plan };
  }

  const target = await resolveTargetForOperation({
    root: dependencies.root,
    fsImpl: dependencies.fsImpl,
    execFileSyncImpl: dependencies.execFileSyncImpl,
    environment: dependencies.environment,
  });
  const sql = sandboxPostgres(dependencies.sqlFactory, target.databaseUrl, {
    max: 1,
    connect_timeout: 5,
    idle_timeout: 5,
  });
  let generatedPasswords: Record<string, string> | null = null;
  try {
    await verifyConnectedIdentity(sql, target);
    const existingTesters = await inspectExistingTesters(sql, plan);
    if (existingTesters.length && !existingPasswords) {
      throw publicError('Synthetic tester accounts already exist but their private credential file is missing; refusing to generate replacement passwords.');
    }
    if (!existingPasswords) {
      generatedPasswords = generateTesterPasswords(dependencies.randomBytes);
      plan = buildImportPlan({
        capture,
        testerPasswords: generatedPasswords,
        passwordHasher: dependencies.passwordHasher,
      });
    }
    process.stdout.write(summarizePlan(plan));
    let wroteTesterFile = false;
    if (generatedPasswords) {
      if (dependencies.fsImpl.existsSync(paths.testers)) {
        existingTesterPasswords(paths, dependencies.fsImpl);
        process.stdout.write('An existing private tester credential file appeared during import; it was preserved and not overwritten.\n');
      } else {
        writePrivateFile(paths.testers, testerCredentialsContents(generatedPasswords), dependencies.fsImpl);
        wroteTesterFile = true;
      }
    }
    const result = await applyImportPlan({
      plan,
      sql,
      verifyIdentity: async (transaction) => {
        await verifyConnectedIdentity(transaction, target);
      },
    });
    await verifyConnectedIdentity(sql, target);
    process.stdout.write(
      `Sandbox import complete: ${result.inserted} record(s) inserted, ${result.unchanged} unchanged, noop=${result.noop}. `
      + 'The local reconstruction actor is labelled; public roles were not imported as authority.\n',
    );
    if (wroteTesterFile) {
      process.stdout.write(`Synthetic tester credentials were written privately to ${path.relative(dependencies.root, paths.testers)} (mode 600).\n`);
    }
    return { dryRun: false, plan, result, target };
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

function waitForListening(server: SandboxHttpServer): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
}

export function defaultHttpGet(url: string, timeoutMs = 5_000): Promise<number | undefined> {
  return new Promise<number | undefined>((resolve, reject) => {
    const request = http.get(url, { timeout: timeoutMs }, (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    request.once('timeout', () => request.destroy(new Error('Sandbox readiness request timed out.')));
    request.once('error', reject);
  });
}

export async function startSandbox(
  _options: ParsedCliOptions,
  dependencies: SandboxDependencies,
): Promise<StartResult> {
  const target = await resolveTargetForOperation(dependencies);
  if (!(await dependencies.portChecker(target.appPort, SANDBOX.HOST))) {
    throw publicError(`The sandbox app port ${target.appPort} is already in use; refusing to occupy an unknown service.`);
  }
  const config = dependencies.readConfig({
    DATABASE_URL: target.databaseUrl,
    SESSION_SECRET: target.sessionSecret,
    PORT: String(target.appPort),
    APP_ORIGIN: `http://${SANDBOX.HOST}:${target.appPort}`,
  });
  const sql = sandboxPostgres(dependencies.sqlFactory, config.databaseUrl);
  let server: SandboxHttpServer | undefined;
  try {
    try {
      await verifyConnectedIdentity(sql, target);
    } catch (error) {
      await sql.end({ timeout: 5 }).catch(() => {});
      throw publicError(`Sandbox identity check failed: ${errorMessage(error)}`);
    }
    try {
      await dependencies.verifySchemaReadiness(sql, { rootDirectory: dependencies.root });
    } catch (error) {
      await sql.end({ timeout: 5 }).catch(() => {});
      throw publicError(`Sandbox schema readiness failed: ${errorMessage(error)}`);
    }
    const app = dependencies.createAppFactory({
      sql,
      config: {
        sessionSecret: config.sessionSecret,
        secureCookies: config.secureCookies,
        production: config.production,
        publicOrigin: config.publicOrigin,
        staticRoot: dependencies.root,
      },
    });
    server = app.listen(target.appPort, SANDBOX.HOST);
    await waitForListening(server);
    const status = await dependencies.httpGet(`http://${SANDBOX.HOST}:${target.appPort}/api/wiki-posts`);
    if (status !== 200) throw publicError(`The sandbox readiness check returned HTTP ${status}.`);
  } catch (error) {
    if (server) {
      const activeServer = server;
      await new Promise<void>((resolve) => activeServer.close(() => resolve())).catch(() => {});
    }
    await sql.end({ timeout: 5 }).catch(() => {});
    throw error;
  }

  process.stdout.write(`aetherverse vault public sandbox listening on http://${SANDBOX.HOST}:${target.appPort}.\n`);
  process.stdout.write(`Database ${target.database} (${target.project}, instance ${target.instanceId}, volume ${target.volume}); independent local session secret; writes stay on this loopback origin.\n`);
  if (dependencies.installSignalHandlers !== false) {
    const shutdown = (signal: string): void => {
      process.stdout.write(`Stopping the owned public sandbox app (${signal}).\n`);
      server.close(() => {
        void sql.end({ timeout: 10 }).catch(() => {});
      });
    };
    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));
  }
  return { target, server, sql };
}
