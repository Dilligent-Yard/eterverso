'use strict';

const fs = require('node:fs');
const {
  MAX_BUNDLE_BYTES,
  normalizeLocator,
  readInputFile,
  writePrivateOutput,
} = require('./wiki-authoring-compile');
const { archiveRelativePath, hash: validateHash } = require('../server/sources');
const { validatePositiveVersion, validateUuid } = require('../server/validation');
const { validateBundle } = require('../server/wiki-transfers');
const { validateWikiSnapshot } = require('../server/wiki');

const BINDINGS_FORMAT = 'AetherverseWikiRevisionBindingsV1';
const PLAN_FORMAT = 'AetherverseWikiRevisionPlanV1';
const MAX_OPERATIONS = 100;
const MAX_BINDINGS_BYTES = 16 * 1024 * 1024;
const SUMMARY = 'Revisão de lote editorial da wiki.';

function safeError(message) {
  const error = new Error(message);
  error.safeToPrint = true;
  return error;
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw safeError(`${label} must be an object.`);
  }
}

function assertExactKeys(value, keys, label) {
  assertObject(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw safeError(`${label} has missing or unsupported fields.`);
  }
}

function boundedText(value, label, maximum, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || value.length === 0
      || Array.from(value).length > maximum
      || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw safeError(`${label} is invalid.`);
  }
  return value;
}

function optionalText(value, label, maximum) {
  if (value === null) return null;
  if (typeof value !== 'string' || Array.from(value).length > maximum
      || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw safeError(`${label} is invalid.`);
  }
  return value;
}

function archivePath(value) {
  try { return archiveRelativePath(value); } catch (_error) {
    throw safeError('A source binding path is invalid.');
  }
}

function uuid(value, label) {
  try { return validateUuid(value, label); } catch (_error) {
    throw safeError(`${label} is invalid.`);
  }
}

function hash(value, label) {
  try { return validateHash(value); } catch (_error) {
    throw safeError(`${label} is invalid.`);
  }
}

function version(value) {
  try { return validatePositiveVersion(value, 'expectedVersion'); } catch (_error) {
    throw safeError('A target version must be a positive PostgreSQL integer.');
  }
}

function sourceIdentity(source) {
  return `${source.archiveSha256}\0${source.relativePath}`;
}

function validateSourceBinding(value) {
  assertExactKeys(value, [
    'id', 'archiveSha256', 'relativePath', 'fileSha256', 'family', 'language', 'declaredVersion', 'declaredDate',
  ], 'Source binding');
  return {
    id: uuid(value.id, 'Source ID'),
    archiveSha256: hash(value.archiveSha256, 'Archive hash'),
    relativePath: archivePath(value.relativePath),
    fileSha256: hash(value.fileSha256, 'File hash'),
    family: boundedText(value.family, 'Source family', 80),
    language: boundedText(value.language, 'Source language', 20),
    declaredVersion: optionalText(value.declaredVersion, 'Declared source version', 120),
    declaredDate: optionalText(value.declaredDate, 'Declared source date', 40),
  };
}

function validateBindings(value, bundle) {
  assertExactKeys(value, ['format', 'targets', 'sources'], 'Revision bindings');
  if (value.format !== BINDINGS_FORMAT) throw safeError('The revision bindings format is unsupported.');
  if (!Array.isArray(value.targets) || value.targets.length !== bundle.pages.length
      || value.targets.length > MAX_OPERATIONS) {
    throw safeError('Revision bindings must select exactly one target for every bundle page.');
  }
  if (!Array.isArray(value.sources)) throw safeError('The source binding list is invalid.');

  const bundlePageIds = new Set(bundle.pages.map((page) => page.sourcePageId));
  const targetsBySourcePage = new Map();
  const targetIds = new Set();
  for (const target of value.targets) {
    const hasSections = Object.hasOwn(target, 'sectionBindings');
    assertExactKeys(target, ['sourcePageId', 'targetPageId', 'expectedVersion', ...(hasSections ? ['sectionBindings'] : [])], 'Target binding');
    const sourcePageId = uuid(target.sourcePageId, 'Source page ID');
    const targetPageId = uuid(target.targetPageId, 'Target page ID');
    const expectedVersion = version(target.expectedVersion);
    if (!bundlePageIds.has(sourcePageId)) throw safeError('A target binding references an unknown bundle page.');
    if (targetsBySourcePage.has(sourcePageId)) throw safeError('Target bindings contain a duplicate source page.');
    if (targetIds.has(targetPageId)) throw safeError('Target bindings contain a duplicate target page.');
    const sectionMap = new Map();
    const destinationIds = new Set();
    const page = bundle.pages.find((item) => item.sourcePageId === sourcePageId);
    const sectionIds = new Set(page.snapshot.body.sections.map((section) => section.id));
    if (hasSections) {
      if (!Array.isArray(target.sectionBindings) || target.sectionBindings.length > sectionIds.size) {
        throw safeError('Section bindings must be an array within the page section limit.');
      }
      for (const binding of target.sectionBindings) {
        assertExactKeys(binding, ['sourceSectionId', 'targetSectionId'], 'Section binding');
        const from = uuid(binding.sourceSectionId, 'Source section ID');
        const to = uuid(binding.targetSectionId, 'Target section ID');
        if (!sectionIds.has(from)) throw safeError('A section binding references a section outside its source page.');
        if (sectionMap.has(from) || destinationIds.has(to)) throw safeError('Section bindings contain duplicate identities.');
        sectionMap.set(from, to);
        destinationIds.add(to);
      }
      const finalIds = page.snapshot.body.sections.map((section) => sectionMap.get(section.id) || section.id);
      if (new Set(finalIds).size !== finalIds.length) throw safeError('Section bindings collide with an unmapped section.');
    }
    targetsBySourcePage.set(sourcePageId, { targetPageId, expectedVersion, sectionMap });
    targetIds.add(targetPageId);
  }
  if (targetsBySourcePage.size !== bundlePageIds.size) {
    throw safeError('Revision bindings must select exactly one target for every bundle page.');
  }

  const sourceBindings = value.sources.map(validateSourceBinding);
  const sourceIds = new Set();
  const sourceIdentities = new Map();
  for (const source of sourceBindings) {
    if (sourceIds.has(source.id)) throw safeError('Source bindings contain a duplicate source ID.');
    sourceIds.add(source.id);
    const identity = sourceIdentity(source);
    if (sourceIdentities.has(identity)) throw safeError('Source bindings contain a duplicate source identity.');
    sourceIdentities.set(identity, source);
  }

  const actualSourceIds = new Map();
  for (const bundleSource of bundle.sources) {
    const binding = sourceIdentities.get(sourceIdentity(bundleSource));
    if (!binding) throw safeError('A bundle source is missing from the local source catalog.');
    const metadataMatches = binding.fileSha256 === bundleSource.fileSha256
      && binding.family === bundleSource.family
      && binding.language === bundleSource.language
      && binding.declaredVersion === bundleSource.declaredVersion
      && binding.declaredDate === bundleSource.declaredDate;
    if (!metadataMatches) throw safeError('A bundle source does not exactly match its local source record.');
    actualSourceIds.set(bundleSource.sourceId, binding.id);
  }

  return { targetsBySourcePage, actualSourceIds };
}

function compileRevisionPlan(bundleValue, bindingsValue) {
  let bundle;
  try {
    bundle = validateBundle(bundleValue).bundle;
  } catch (_error) {
    throw safeError('The compiled transfer bundle is invalid.');
  }
  if (bundle.pages.length > MAX_OPERATIONS) throw safeError('The bundle exceeds the revision operation limit.');
  const bindings = validateBindings(bindingsValue, bundle);
  const operations = bundle.pages.map((page) => {
    const target = bindings.targetsBySourcePage.get(page.sourcePageId);
    if (!target) throw safeError('A bundle page has no local revision target.');
    let snapshot;
    try {
      snapshot = validateWikiSnapshot({ ...page.snapshot, accessLevel: 'staff', body: {
        ...page.snapshot.body,
        sections: page.snapshot.body.sections.map((section) => ({
          ...section, id: target.sectionMap.get(section.id) || section.id,
        })),
      } });
    } catch (_error) {
      throw safeError('A page snapshot failed staff revision validation.');
    }
    const citations = page.citations.map((citation) => {
      const sourceId = bindings.actualSourceIds.get(citation.sourceId);
      if (!sourceId) throw safeError('A bundle citation has no local source mapping.');
      return { sectionId: target.sectionMap.get(citation.sectionId) || citation.sectionId, sourceId, locator: normalizeLocator(citation.locator) };
    });
    const citationKeys = new Set();
    for (const citation of citations) {
      const key = `${citation.sectionId}\0${citation.sourceId}\0${citation.locator}`;
      if (citationKeys.has(key)) throw safeError('Citation locators collide after normalization.');
      citationKeys.add(key);
    }
    const citedSections = new Set(citations.map((citation) => citation.sectionId));
    if (snapshot.body.sections.some((section) => !citedSections.has(section.id))) {
      throw safeError('Each section in a revision must have at least one source citation.');
    }
    return {
      pageId: target.targetPageId,
      method: 'POST',
      path: `/api/staff/wiki/pages/${target.targetPageId}/revisions`,
      body: {
        snapshot,
        summary: SUMMARY,
        expectedVersion: target.expectedVersion,
        citations,
      },
    };
  });
  return {
    plan: {
      format: PLAN_FORMAT,
      bundleSha256: bundle.manifest.bundleSha256,
      operations,
    },
    counts: {
      operations: operations.length,
      citations: operations.reduce((total, operation) => total + operation.body.citations.length, 0),
    },
  };
}

function parseArgs(args) {
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) return { help: true };
  const fields = new Map([
    ['--bundle', 'bundlePath'],
    ['--bindings', 'bindingsPath'],
    ['--output', 'outputPath'],
  ]);
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    const key = fields.get(flag);
    if (!key || !value || value.startsWith('--') || values[key]) {
      throw safeError('Usage: npm run wiki:authoring:revision-plan -- --bundle BUNDLE.json --bindings BINDINGS.json --output PLAN.json');
    }
    values[key] = value;
  }
  if (!values.bundlePath || !values.bindingsPath || !values.outputPath) {
    throw safeError('Usage: npm run wiki:authoring:revision-plan -- --bundle BUNDLE.json --bindings BINDINGS.json --output PLAN.json');
  }
  return { ...values, help: false };
}

function helpText() {
  return 'Usage: npm run wiki:authoring:revision-plan -- --bundle BUNDLE.json --bindings BINDINGS.json --output PLAN.json\n';
}

function main(args = process.argv.slice(2), dependencies = {}) {
  const options = parseArgs(args);
  const stdout = dependencies.stdout || process.stdout;
  if (options.help) {
    stdout.write(helpText());
    return null;
  }
  if (Number(process.versions.node.split('.')[0]) !== 24) {
    throw safeError('Wiki revision-plan preparation requires Node.js 24.');
  }
  const fsImpl = dependencies.fsImpl || fs;
  let bundle;
  let bindings;
  try { bundle = readInputFile(options.bundlePath, fsImpl, MAX_BUNDLE_BYTES); } catch (_error) {
    throw safeError('The compiled bundle input is missing, invalid or unsafe to read.');
  }
  try { bindings = readInputFile(options.bindingsPath, fsImpl, MAX_BINDINGS_BYTES); } catch (_error) {
    throw safeError('The local revision bindings are missing, invalid or unsafe to read.');
  }
  const compiled = compileRevisionPlan(bundle, bindings);
  const outputBytes = Buffer.from(`${JSON.stringify(compiled.plan, null, 2)}\n`, 'utf8');
  try { writePrivateOutput(options.outputPath, outputBytes, fsImpl); } catch (error) {
    if (error && error.safeToPrint && /already exists/iu.test(error.message)) {
      throw safeError('The revision plan output already exists; refusing to overwrite it.');
    }
    throw safeError('The private revision plan could not be written safely.');
  }
  stdout.write(`Prepared ${compiled.counts.operations} revision operation(s), ${compiled.counts.citations} citation(s).\n`);
  return compiled.counts;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error && error.safeToPrint
      ? error.message
      : 'Wiki revision-plan preparation failed; article text, source text, filesystem details and credentials are withheld.'}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  BINDINGS_FORMAT,
  PLAN_FORMAT,
  SUMMARY,
  compileRevisionPlan,
  main,
  parseArgs,
  validateBindings,
};
