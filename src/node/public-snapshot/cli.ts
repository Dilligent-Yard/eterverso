import {
  CaptureUsageError,
  DEFAULT_MAX_REQUESTS,
  DEFAULT_ORIGIN,
} from './contracts.js';
import type {
  CaptureOptionsInput,
  CapturePlan,
  RunCaptureResult,
} from './contracts.js';

export interface CliWriter {
  write(chunk: string): unknown;
}

export interface CliIo {
  stdout: CliWriter;
  stderr: CliWriter;
}

export interface ParsedArgs {
  origin: string | undefined;
  output: string | undefined;
  maxRequests: string | undefined;
  dryRun: boolean;
  help: boolean;
  allowLoopbackHttp: boolean;
  allowTestOutput: boolean;
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const options: ParsedArgs = {
    origin: undefined,
    output: undefined,
    maxRequests: undefined,
    dryRun: false,
    help: false,
    allowLoopbackHttp: false,
    allowTestOutput: false,
  };
  const seen = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const rawToken = argv[index];
    if (rawToken === undefined) continue;
    let token = rawToken;
    if (!token.startsWith('--')) {
      throw new CaptureUsageError(`Unexpected argument: ${token}`);
    }
    let value: string | undefined;
    const equals = token.indexOf('=');
    if (equals !== -1) {
      value = token.slice(equals + 1);
      token = token.slice(0, equals);
    }
    if (seen.has(token)) throw new CaptureUsageError(`Duplicate option: ${token}`);
    seen.add(token);

    if (token === '--help') {
      options.help = true;
      if (value !== undefined) throw new CaptureUsageError('--help does not take a value.');
      continue;
    }
    if (token === '--dry-run') {
      options.dryRun = true;
      if (value !== undefined) throw new CaptureUsageError('--dry-run does not take a value.');
      continue;
    }
    if (token === '--allow-loopback-http') {
      options.allowLoopbackHttp = true;
      if (value !== undefined) throw new CaptureUsageError('--allow-loopback-http does not take a value.');
      continue;
    }
    if (token === '--allow-test-output') {
      options.allowTestOutput = true;
      if (value !== undefined) throw new CaptureUsageError('--allow-test-output does not take a value.');
      continue;
    }
    if (!['--origin', '--output', '--max-requests'].includes(token)) {
      throw new CaptureUsageError(`Unknown option: ${token}`);
    }
    if (value === undefined) {
      index += 1;
      value = argv[index];
    }
    if (value === undefined || value === '') {
      throw new CaptureUsageError(`${token} requires a value.`);
    }
    if (value.startsWith('--')) {
      throw new CaptureUsageError(`${token} requires a value.`);
    }
    if (token === '--origin') options.origin = value;
    else if (token === '--output') options.output = value;
    else options.maxRequests = value;
  }
  return options;
}

function createUsage(privateCaptureRoot: string): string {
  return `Usage: node scripts/public-snapshot-fetch.js --output <new-directory> [options]

Anonymous, read-only capture of the Aetherverse public API.

Options:
  --origin <url>              Capture origin (default: ${DEFAULT_ORIGIN})
  --output <directory>        New capture directory under ${privateCaptureRoot} (required)
  --max-requests <count>      Total HTTP attempt budget (default: ${DEFAULT_MAX_REQUESTS})
  --dry-run                   Validate arguments and print the plan; no network, no files
  --allow-loopback-http       Test-only: allow http:// on a loopback host
  --allow-test-output         Test-only: allow an output path outside the private root;
                              refuses non-loopback origins
  --help                      Show this help

A normal capture must be created inside the private, Git-ignored
.local/public-snapshots directory. The test-only output override exists for
loopback fake-server tests and must not be used for a real capture.

The capture uses serial anonymous GET requests at least one second apart. It
never sends cookies or credentials, never follows off-origin redirects, and
records visibility gaps instead of treating them as empty success.
`;
}

export function printPlan(plan: CapturePlan, stream: CliWriter): void {
  stream.write('AetherversePublicCaptureV1 plan\n');
  stream.write(`origin: ${plan.origin}\n`);
  stream.write(`output: ${plan.outputDir}\n`);
  stream.write(`maxRequests: ${plan.requestPolicy.maxRequests}\n`);
  stream.write('requests: anonymous GET only, serial, at least 1000 ms apart\n');
  stream.write('families:\n');
  for (const family of plan.families) stream.write(`  - ${family}\n`);
  stream.write('No network request was made and no output directory was created.\n');
}

export interface MainDependencies {
  privateCaptureRoot: string;
  runCapture: (rawOptions?: CaptureOptionsInput) => Promise<RunCaptureResult>;
}

export type MainFunction = (argv: readonly string[], io?: CliIo) => Promise<number>;

export function createMain({ privateCaptureRoot, runCapture }: MainDependencies): MainFunction {
  const usage = createUsage(privateCaptureRoot);
  return async function main(argv: readonly string[], io: CliIo = process): Promise<number> {
    try {
      const parsed = parseArgs(argv);
      if (parsed.help) {
        io.stdout.write(usage);
        return 0;
      }
      if (!parsed.output) throw new CaptureUsageError('--output is required.');
      const result = await runCapture({
        origin: parsed.origin,
        outputDir: parsed.output,
        maxRequests: parsed.maxRequests,
        dryRun: parsed.dryRun,
        allowLoopbackHttp: parsed.allowLoopbackHttp,
        allowTestOutput: parsed.allowTestOutput,
      });
      if (result.dryRun) {
        printPlan(result.plan, io.stdout);
        return 0;
      }
      const counts = result.manifest.counts;
      io.stdout.write(`capture: ${result.manifest.captureId}\n`);
      io.stdout.write(`output: ${result.outputDir}\n`);
      io.stdout.write(`counts: characters=${counts.characters} scenes=${counts.scenes} sceneTurns=${counts.sceneTurns} wikiPages=${counts.wikiPages} wikiSections=${counts.wikiSections} wikiCategories=${counts.wikiCategories} forumThreads=${counts.forumThreads} forumPosts=${counts.forumPosts}\n`);
      io.stdout.write(`gaps: ${result.manifest.gaps.length}; unresolvedChanges: ${result.manifest.consistency.unresolvedChanges.length}; complete: ${result.manifest.consistency.complete}\n`);
      if (!result.ok) io.stderr.write('capture is incomplete; inspect manifest.json gaps and consistency.unresolvedChanges.\n');
      return result.exitCode;
    } catch (error) {
      const code = error instanceof CaptureUsageError ? 2 : 1;
      const message = error instanceof Error ? error.message : String(error);
      io.stderr.write(`public-snapshot-fetch: ${message}\n`);
      return code;
    }
  };
}
