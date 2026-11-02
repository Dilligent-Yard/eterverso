'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  BINDINGS_FORMAT,
  PLAN_FORMAT,
  SUMMARY,
  compileRevisionPlan,
  main,
  parseArgs,
} = require('../../scripts/wiki-authoring-revision-plan');
const { digestJson } = require('../../server/wiki-transfers');

const UUID = Object.freeze({
  workspace: '10101010-1010-4010-8010-101010101010',
  sourcePage1: '11111111-1111-4111-8111-111111111111',
  sourceRevision1: '12121212-1212-4212-8212-121212121212',
  sourcePage2: '13131313-1313-4313-8313-131313131313',
  sourceRevision2: '14141414-1414-4414-8414-141414141414',
  section1: '15151515-1515-4515-8515-151515151515',
  section2: '16161616-1616-4616-8616-161616161616',
  section3: '17171717-1717-4717-8717-171717171717',
  source1: '18181818-1818-4818-8818-181818181818',
  source2: '19191919-1919-4919-8919-191919191919',
  target1: '20202020-2020-4020-8020-202020202020',
  target2: '21212121-2121-4121-8121-212121212121',
  targetSource1: '30303030-3030-4030-8030-303030303030',
  targetSource2: '31313131-3131-4131-8131-313131313131',
  targetSourceUnused: '32323232-3232-4232-8232-323232323232',
});

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function temporaryDirectory(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'eterverso-wiki-revision-plan-'));
  try { return callback(directory); } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

function source({ id, sourceId, path: relativePath, content, archiveSha256 }) {
  const archive = archiveSha256 || 'a'.repeat(64);
  return {
    sourceId,
    archiveSha256: archive,
    relativePath,
    fileSha256: sha256(content),
    family: 'Synthetic source family',
    language: 'pt-BR',
    declaredVersion: 'v1',
    declaredDate: '2026-01-01',
    bindingId: id,
    content,
  };
}

function snapshot({ title, slug, sections }) {
  return {
    schemaVersion: 1,
    title,
    slug,
    aliases: [],
    type: 'concept',
    summary: 'Resumo sintético usado somente no teste.',
    categories: ['Demonstração'],
    accessLevel: 'public',
    audience: 'reader',
    body: {
      format: 'richtext-v1',
      infobox: [{ label: 'Estado', value: 'Exemplo' }],
      sections: sections.map(({ id, heading, html }) => ({
        id,
        heading,
        html,
        blocks: [],
        authority: [],
        knowledgeLayer: 'unspecified',
      })),
    },
  };
}

function makeBundle() {
  const sources = [
    source({
      id: UUID.targetSource1,
      sourceId: UUID.source1,
      path: 'reference/one.md',
      content: 'Private synthetic source one marker.\n',
    }),
    source({
      id: UUID.targetSource2,
      sourceId: UUID.source2,
      path: 'reference/two.md',
      content: 'Private synthetic source two marker.\n',
      archiveSha256: 'b'.repeat(64),
    }),
  ].map(({ bindingId: _bindingId, ...entry }) => entry);
  const pages = [
    {
      sourcePageId: UUID.sourcePage1,
      sourceRevisionId: UUID.sourceRevision1,
      snapshot: snapshot({
        title: 'Página sintética um',
        slug: 'pagina-sintetica-um',
        sections: [
          { id: UUID.section1, heading: 'Seção original', html: '<p>Texto sintético original.</p>' },
          { id: UUID.section2, heading: 'Seção revisada', html: '<p>Texto sintético revisado.</p>' },
        ],
      }),
      citations: [
        { sectionId: UUID.section1, sourceId: UUID.source1, locator: 'section 1, lines 1-2' },
        { sectionId: UUID.section2, sourceId: UUID.source2, locator: 'section 2, lines 3-4' },
      ],
    },
    {
      sourcePageId: UUID.sourcePage2,
      sourceRevisionId: UUID.sourceRevision2,
      snapshot: snapshot({
        title: 'Página sintética dois',
        slug: 'pagina-sintetica-dois',
        sections: [{ id: UUID.section3, heading: 'Visão geral', html: '<p>Mais texto sintético.</p>' }],
      }),
      citations: [{ sectionId: UUID.section3, sourceId: UUID.source1, locator: 'overview, lines 1-2' }],
    },
  ];
  const bundle = {
    format: 'AetherverseWikiBundleV1',
    manifest: {
      version: 1,
      createdAt: '1970-01-01T00:00:00.000Z',
      pageCount: pages.length,
      sourceCount: sources.length,
      bundleSha256: '',
    },
    origin: { instanceId: UUID.workspace, siteName: 'aetherverse vault' },
    pages,
    sources,
  };
  bundle.manifest.bundleSha256 = digestJson({
    format: bundle.format,
    manifest: {
      version: bundle.manifest.version,
      createdAt: bundle.manifest.createdAt,
      pageCount: bundle.manifest.pageCount,
      sourceCount: bundle.manifest.sourceCount,
    },
    origin: bundle.origin,
    pages: bundle.pages,
    sources: bundle.sources,
  });
  return bundle;
}

function makeBindings() {
  const bundle = makeBundle();
  return {
    format: BINDINGS_FORMAT,
    targets: [
      { sourcePageId: UUID.sourcePage1, targetPageId: UUID.target1, expectedVersion: 7 },
      { sourcePageId: UUID.sourcePage2, targetPageId: UUID.target2, expectedVersion: 2_147_483_647 },
    ],
    sources: [
      ...bundle.sources.map((entry) => ({
        id: entry.sourceId === UUID.source1 ? UUID.targetSource1 : UUID.targetSource2,
        archiveSha256: entry.archiveSha256,
        relativePath: entry.relativePath,
        fileSha256: entry.fileSha256,
        family: entry.family,
        language: entry.language,
        declaredVersion: entry.declaredVersion,
        declaredDate: entry.declaredDate,
      })),
      {
        id: UUID.targetSourceUnused,
        archiveSha256: 'c'.repeat(64),
        relativePath: 'catalog/unused.md',
        fileSha256: 'd'.repeat(64),
        family: 'Unused synthetic source',
        language: 'en',
        declaredVersion: null,
        declaredDate: null,
      },
    ],
  };
}

function writePrivateJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(filePath), 0o700);
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(filePath, 0o600);
}

function cliArgs(bundlePath, bindingsPath, outputPath) {
  return ['--bundle', bundlePath, '--bindings', bindingsPath, '--output', outputPath];
}

function captureStream() {
  return { value: '', write(chunk) { this.value += chunk; } };
}

test('revision plan maps every target and source and preserves section citations in staff snapshots', () => {
  const bundle = makeBundle();
  const bindings = makeBindings();
  const { plan, counts } = compileRevisionPlan(bundle, bindings);

  assert.equal(plan.format, PLAN_FORMAT);
  assert.equal(plan.bundleSha256, bundle.manifest.bundleSha256);
  assert.deepEqual(counts, { operations: 2, citations: 3 });
  assert.deepEqual(plan.operations.map((operation) => operation.pageId), [UUID.target1, UUID.target2]);
  assert.deepEqual(plan.operations.map((operation) => operation.path), [
    `/api/staff/wiki/pages/${UUID.target1}/revisions`,
    `/api/staff/wiki/pages/${UUID.target2}/revisions`,
  ]);
  assert.ok(plan.operations.every((operation) => operation.method === 'POST'));
  assert.equal(plan.operations[0].body.summary, SUMMARY);
  assert.equal(plan.operations[0].body.expectedVersion, 7);
  assert.equal(plan.operations[1].body.expectedVersion, 2_147_483_647);
  assert.equal(plan.operations[0].body.snapshot.accessLevel, 'staff');
  assert.deepEqual(plan.operations[0].body.citations, [
    { sectionId: UUID.section1, sourceId: UUID.targetSource1, locator: 'section 1, lines 1-2' },
    { sectionId: UUID.section2, sourceId: UUID.targetSource2, locator: 'section 2, lines 3-4' },
  ]);
  assert.deepEqual(plan.operations[1].body.citations, [
    { sectionId: UUID.section3, sourceId: UUID.targetSource1, locator: 'overview, lines 1-2' },
  ]);
  assert.equal(JSON.stringify(plan).includes('Private synthetic source'), false);
  assert.ok(plan.operations.every((operation) => !('sourceId' in operation) && !('sourceRevisionId' in operation)));
});

test('bundle validation precedes binding resolution and malformed schemas are rejected', () => {
  const invalidBundle = makeBundle();
  invalidBundle.pages[0].snapshot.title = 'Edited without updating the bundle hash.';
  const invalidBindings = makeBindings();
  invalidBindings.unexpected = 'private marker';
  assert.throws(() => compileRevisionPlan(invalidBundle, invalidBindings), /transfer bundle is invalid/);

  const bindings = makeBindings();
  bindings.unknown = true;
  assert.throws(() => compileRevisionPlan(makeBundle(), bindings), /missing or unsupported fields/);

  const malformedTarget = makeBindings();
  malformedTarget.targets[0].localAccountId = UUID.target1;
  assert.throws(() => compileRevisionPlan(makeBundle(), malformedTarget), /missing or unsupported fields/);
});

test('targets require a complete one-to-one page mapping and valid unique IDs and versions', () => {
  const missing = makeBindings();
  missing.targets.pop();
  assert.throws(() => compileRevisionPlan(makeBundle(), missing), /exactly one target/);

  const repeatedSourcePage = makeBindings();
  repeatedSourcePage.targets[1].sourcePageId = UUID.sourcePage1;
  assert.throws(() => compileRevisionPlan(makeBundle(), repeatedSourcePage), /duplicate source page/);

  const repeatedTarget = makeBindings();
  repeatedTarget.targets[1].targetPageId = UUID.target1;
  assert.throws(() => compileRevisionPlan(makeBundle(), repeatedTarget), /duplicate target page/);

  for (const expectedVersion of [0, -1, 1.5, 2_147_483_648, '7']) {
    const invalidVersion = makeBindings();
    invalidVersion.targets[0].expectedVersion = expectedVersion;
    assert.throws(() => compileRevisionPlan(makeBundle(), invalidVersion), /positive PostgreSQL integer/);
  }

  const invalidTargetId = makeBindings();
  invalidTargetId.targets[0].targetPageId = 'not-a-uuid';
  assert.throws(() => compileRevisionPlan(makeBundle(), invalidTargetId), /Target page ID is invalid/);
});

test('source catalog matching uses exact metadata, rejects duplicate identity, and permits unused records', () => {
  const bundle = makeBundle();
  const validBindings = makeBindings();
  assert.equal(compileRevisionPlan(bundle, validBindings).plan.operations.length, 2);

  const missing = makeBindings();
  missing.sources = missing.sources.filter((source) => source.id !== UUID.targetSource2);
  assert.throws(() => compileRevisionPlan(bundle, missing), /missing from the local source catalog/);

  for (const field of ['fileSha256', 'family', 'language', 'declaredVersion', 'declaredDate']) {
    const mismatch = makeBindings();
    const target = mismatch.sources.find((item) => item.id === UUID.targetSource1);
    target[field] = field === 'fileSha256' ? 'e'.repeat(64) : `Changed ${field}`;
    assert.throws(() => compileRevisionPlan(bundle, mismatch), /does not exactly match/);
  }

  const duplicateId = makeBindings();
  duplicateId.sources[1].id = duplicateId.sources[0].id;
  assert.throws(() => compileRevisionPlan(bundle, duplicateId), /duplicate source ID/);

  const duplicateIdentity = makeBindings();
  duplicateIdentity.sources[1].relativePath = duplicateIdentity.sources[0].relativePath;
  duplicateIdentity.sources[1].archiveSha256 = duplicateIdentity.sources[0].archiveSha256;
  assert.throws(() => compileRevisionPlan(bundle, duplicateIdentity), /duplicate source identity/);

  const invalidSourceId = makeBindings();
  invalidSourceId.sources[0].id = 'invalid';
  assert.throws(() => compileRevisionPlan(bundle, invalidSourceId), /Source ID is invalid/);
});

test('every revision section must retain citations and all citations need a local source mapping', () => {
  const bundleWithoutSectionCitation = makeBundle();
  bundleWithoutSectionCitation.pages[0].citations = bundleWithoutSectionCitation.pages[0].citations
    .filter((citation) => citation.sectionId !== UUID.section2);
  bundleWithoutSectionCitation.pages[0].citations.push({
    sectionId: UUID.section1,
    sourceId: UUID.source2,
    locator: 'additional support for section one',
  });
  bundleWithoutSectionCitation.manifest.bundleSha256 = digestJson({
    format: bundleWithoutSectionCitation.format,
    manifest: {
      version: bundleWithoutSectionCitation.manifest.version,
      createdAt: bundleWithoutSectionCitation.manifest.createdAt,
      pageCount: bundleWithoutSectionCitation.manifest.pageCount,
      sourceCount: bundleWithoutSectionCitation.manifest.sourceCount,
    },
    origin: bundleWithoutSectionCitation.origin,
    pages: bundleWithoutSectionCitation.pages,
    sources: bundleWithoutSectionCitation.sources,
  });
  assert.throws(() => compileRevisionPlan(bundleWithoutSectionCitation, makeBindings()), /Each section .*citation/);

  const bindings = makeBindings();
  bindings.sources = bindings.sources.filter((source) => source.id !== UUID.targetSource2);
  assert.throws(() => compileRevisionPlan(makeBundle(), bindings), /missing from the local source catalog/);
});

test('revision requests trim legacy padded locators without changing the validated bundle hash', () => {
  const padded = makeBundle();
  const exactLocator = padded.pages[0].citations[0].locator;
  padded.pages[0].citations[0].locator = `  ${exactLocator}  `;
  padded.manifest.bundleSha256 = digestJson({
    format: padded.format,
    manifest: {
      version: padded.manifest.version,
      createdAt: padded.manifest.createdAt,
      pageCount: padded.manifest.pageCount,
      sourceCount: padded.manifest.sourceCount,
    },
    origin: padded.origin,
    pages: padded.pages,
    sources: padded.sources,
  });
  const transferHash = padded.manifest.bundleSha256;
  const paddedPlan = compileRevisionPlan(padded, makeBindings()).plan;
  assert.equal(paddedPlan.bundleSha256, transferHash);
  assert.equal(paddedPlan.operations[0].body.citations[0].locator, exactLocator);
  assert.equal(padded.pages[0].citations[0].locator, `  ${exactLocator}  `);

  const blank = makeBundle();
  blank.pages[0].citations[0].locator = ' \u00a0 ';
  blank.manifest.bundleSha256 = digestJson({
    format: blank.format,
    manifest: {
      version: blank.manifest.version,
      createdAt: blank.manifest.createdAt,
      pageCount: blank.manifest.pageCount,
      sourceCount: blank.manifest.sourceCount,
    },
    origin: blank.origin,
    pages: blank.pages,
    sources: blank.sources,
  });
  assert.throws(() => compileRevisionPlan(blank, makeBindings()), /transfer bundle is invalid/);

  const control = makeBundle();
  control.pages[0].citations[0].locator = 'section\n1';
  control.manifest.bundleSha256 = digestJson({
    format: control.format,
    manifest: {
      version: control.manifest.version,
      createdAt: control.manifest.createdAt,
      pageCount: control.manifest.pageCount,
      sourceCount: control.manifest.sourceCount,
    },
    origin: control.origin,
    pages: control.pages,
    sources: control.sources,
  });
  assert.throws(() => compileRevisionPlan(control, makeBindings()), /Citation locator is invalid/);

  const duplicateAfterNormalization = makeBundle();
  duplicateAfterNormalization.pages[0].citations.push({
    ...duplicateAfterNormalization.pages[0].citations[0],
    locator: ` ${duplicateAfterNormalization.pages[0].citations[0].locator} `,
  });
  duplicateAfterNormalization.manifest.bundleSha256 = digestJson({
    format: duplicateAfterNormalization.format,
    manifest: {
      version: duplicateAfterNormalization.manifest.version,
      createdAt: duplicateAfterNormalization.manifest.createdAt,
      pageCount: duplicateAfterNormalization.manifest.pageCount,
      sourceCount: duplicateAfterNormalization.manifest.sourceCount,
    },
    origin: duplicateAfterNormalization.origin,
    pages: duplicateAfterNormalization.pages,
    sources: duplicateAfterNormalization.sources,
  });
  assert.throws(() => compileRevisionPlan(duplicateAfterNormalization, makeBindings()), /collide after normalization/);
});

test('CLI writes an exclusive private plan and failures do not leave output or leak source text', () => {
  temporaryDirectory((directory) => {
    const bundlePath = path.join(directory, 'bundle.json');
    const bindingsPath = path.join(directory, 'bindings.json');
    const outputPath = path.join(directory, 'private', 'wiki-work', 'revision-plan.json');
    const bundle = makeBundle();
    const bindings = makeBindings();
    writePrivateJson(bundlePath, bundle);
    writePrivateJson(bindingsPath, bindings);

    const stdout = captureStream();
    const counts = main(cliArgs(bundlePath, bindingsPath, outputPath), { stdout });
    assert.deepEqual(counts, { operations: 2, citations: 3 });
    assert.match(stdout.value, /Prepared 2 revision operation\(s\), 3 citation\(s\)/u);
    assert.equal(fs.statSync(outputPath).mode & 0o777, 0o600);
    const output = fs.readFileSync(outputPath, 'utf8');
    assert.equal(output.includes('Private synthetic source'), false);
    assert.equal(JSON.parse(output).format, PLAN_FORMAT);
    assert.throws(() => main(cliArgs(bundlePath, bindingsPath, outputPath), { stdout: captureStream() }), /refusing to overwrite/);

    const failingOutput = path.join(directory, 'private', 'failing-plan.json');
    const badBindingsPath = path.join(directory, 'bad-bindings.json');
    const badBindings = makeBindings();
    badBindings.sources[0].family = 'Mismatched private source marker';
    writePrivateJson(badBindingsPath, badBindings);
    assert.throws(() => main(cliArgs(bundlePath, badBindingsPath, failingOutput), { stdout: captureStream() }), /does not exactly match/);
    assert.equal(fs.existsSync(failingOutput), false);

    const badBundlePath = path.join(directory, 'bad-bundle.json');
    const badBundle = makeBundle();
    badBundle.sources[0].content = `Secret source text marker ${badBundle.sources[0].content}`;
    writePrivateJson(badBundlePath, badBundle);
    const cli = spawnSync(process.execPath, [
      path.resolve(__dirname, '../../scripts/wiki-authoring-revision-plan.js'),
      ...cliArgs(badBundlePath, bindingsPath, path.join(directory, 'cli-plan.json')),
    ], { encoding: 'utf8', env: { PATH: process.env.PATH } });
    assert.notEqual(cli.status, 0);
    assert.doesNotMatch(cli.stderr, /Secret source text marker|Private synthetic source|Mismatched private source marker/u);
    assert.equal(fs.existsSync(path.join(directory, 'cli-plan.json')), false);
  });
});

test('CLI arguments are exact and help does not prepare or send a plan', () => {
  assert.deepEqual(parseArgs(['--bundle', 'bundle.json', '--bindings', 'bindings.json', '--output', 'plan.json']), {
    bundlePath: 'bundle.json',
    bindingsPath: 'bindings.json',
    outputPath: 'plan.json',
    help: false,
  });
  assert.deepEqual(parseArgs(['--help']), { help: true });
  assert.throws(() => parseArgs([]), /Usage:/);
  assert.throws(() => parseArgs(['--bundle', 'one.json', '--bundle', 'two.json']), /Usage:/);
  assert.throws(() => parseArgs([
    '--bundle', 'bundle.json', '--bindings', 'bindings.json', '--output', 'plan.json', '--publish', 'true',
  ]), /Usage:/);
  const stdout = captureStream();
  assert.equal(main(['--help'], { stdout }), null);
  assert.match(stdout.value, /wiki:authoring:revision-plan/u);
});


test('explicit legacy section bindings remap snapshot and citations without mutating the bundle', () => {
  const bundle = makeBundle();
  const original = JSON.stringify(bundle);
  const bindings = makeBindings();
  bindings.targets[0].sectionBindings = [{ sourceSectionId: UUID.section1, targetSectionId: UUID.target1 }];
  const { plan } = compileRevisionPlan(bundle, bindings);
  assert.equal(plan.operations[0].body.snapshot.body.sections[0].id, UUID.target1);
  assert.equal(plan.operations[0].body.citations[0].sectionId, UUID.target1);
  assert.equal(plan.operations[0].body.snapshot.body.sections[1].id, UUID.section2);
  assert.equal(plan.bundleSha256, bundle.manifest.bundleSha256);
  assert.equal(JSON.stringify(bundle), original);
});

test('section bindings reject foreign origins, duplicate identities, invalid shapes and final collisions', () => {
  const cases = [
    null,
    [{ sourceSectionId: UUID.section3, targetSectionId: UUID.target1 }],
    [{ sourceSectionId: UUID.section1, targetSectionId: UUID.section2 }],
    [{ sourceSectionId: UUID.section1, targetSectionId: 'invalid' }],
    [{ sourceSectionId: UUID.section1, targetSectionId: UUID.target1, extra: true }],
    [{ sourceSectionId: UUID.section1, targetSectionId: UUID.target1 }, { sourceSectionId: UUID.section1, targetSectionId: UUID.target2 }],
    [{ sourceSectionId: UUID.section1, targetSectionId: UUID.target1 }, { sourceSectionId: UUID.section2, targetSectionId: UUID.target1 }],
  ];
  for (const sectionBindings of cases) {
    const bindings = makeBindings();
    bindings.targets[0].sectionBindings = sectionBindings;
    assert.throws(() => compileRevisionPlan(makeBundle(), bindings));
  }
  const bindings = makeBindings();
  bindings.targets[0].sectionBindings = [];
  assert.deepEqual(compileRevisionPlan(makeBundle(), bindings).plan, compileRevisionPlan(makeBundle(), makeBindings()).plan);
});
