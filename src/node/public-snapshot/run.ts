import type {
  CaptureOptionsInput,
  RunCaptureResult,
} from './contracts.js';
import {
  assertOutputPathAvailable,
  capturePlan,
  createOutputDirectory,
  normalizeCaptureOptions,
} from './policy.js';
import { CaptureSession } from './session.js';
import { captureAll } from './families.js';
import { recheckAll } from './recheck.js';

export async function runCaptureWithRoot(
  rawOptions: CaptureOptionsInput,
  privateCaptureRoot: string,
): Promise<RunCaptureResult> {
  const options = normalizeCaptureOptions(rawOptions, privateCaptureRoot);
  const plan = capturePlan(options, privateCaptureRoot);
  assertOutputPathAvailable(options.outputDir);
  if (rawOptions.dryRun === true) {
    return {
      dryRun: true,
      ok: true,
      exitCode: 0,
      plan,
      origin: options.origin,
      outputDir: options.outputDir,
    };
  }

  await createOutputDirectory(options.outputDir, privateCaptureRoot);
  const session = new CaptureSession(options);
  let fatal: unknown = null;

  try {
    await captureAll(session);
  } catch (error) {
    fatal = error;
    session.recordFatal(error);
  }

  if (fatal === null && options.skipRecheck !== true) {
    try {
      await recheckAll(session);
    } catch (error) {
      fatal = error;
      session.recordFatal(error);
    }
  }

  const { manifest, dataset } = await session.writeCapture();
  const complete = manifest.consistency.complete && fatal === null;
  return {
    dryRun: false,
    ok: complete,
    exitCode: complete ? 0 : 1,
    manifest,
    dataset,
    outputDir: options.outputDir,
    plan,
  };
}
