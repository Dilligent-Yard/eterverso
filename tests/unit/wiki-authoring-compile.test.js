'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  compileAuthoring,
  main,
  parseArgs,
} = require('../../scripts/wiki-authoring-compile');
const { readPrivateStagedSources } = require('../../scripts/wiki-source-import');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function temporaryDirectory(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'eterverso-wiki-authoring-'));
  try { return callback(directory); } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

function privateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
}

function stageSet(stagingRoot, entries = [{ path: 'reference/source.md', content: '# Synthetic source\n' }], archiveBytes = 'synthetic archive') {
  const archiveSha256 = sha256(archiveBytes);
  const archiveDirectory = path.join(stagingRoot, archiveSha256);
  const filesRoot = path.join(archiveDirectory, 'files');
  privateDirectory(stagingRoot);
  privateDirectory(archiveDirectory);
  privateDirectory(filesRoot);
  const files = entries.map(({ path: relativePath, content }) => {
    const bytes = Buffer.from(content, 'utf8');
    const filePath = path.join(filesRoot, ...relativePath.split('/'));
    privateDirectory(path.dirname(filePath));
    fs.writeFileSync(filePath, bytes, { mode: 0o600 });
    fs.chmodSync(filePath, 0o600);
    return {
      relativePath,
      sizeBytes: bytes.length,
      sha256: sha256(bytes),
      family: 'Synthetic source set',
      language: 'pt-BR',
      declaredVersion: 'v1',
      declaredDate: '2026-01-01',
      role: /^readme(?:\.(?:md|txt))?$/iu.test(path.posix.basename(relativePath)) ? 'context' : 'source',
      mediaType: path.posix.extname(relativePath).toLowerCase() === '.md' ? 'text/markdown' : 'text/plain',
    };
  });
  const manifest = {
    format: 'eterverso-wiki-source-stage-v1',
    archiveSha256,
    archiveSizeBytes: Buffer.byteLength(archiveBytes),
    totalUncompressedBytes: files.reduce((total, file) => total + file.sizeBytes, 0),
    fileCount: files.length,
    files,
  };
  const manifestPath = path.join(archiveDirectory, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest), { mode: 0o600 });
  fs.chmodSync(manifestPath, 0o600);
  return { manifestPath, archiveSha256, filesRoot };
}

function authoring(overrides = {}) {
  return {
    format: 'AetherverseWikiAuthoringV1',
    workspace: 'synthetic-authoring-demo',
    sources: [{ key: 'source-one', set: 'original', path: 'reference/source.md' }],
    pages: [{
      key: 'synthetic-page',
      title: 'Página sintética',
      slug: 'pagina-sintetica',
      aliases: [],
      type: 'concept',
      summary: 'Resumo sintético usado só no teste.',
      categories: ['Demonstração'],
      audience: 'reader',
      infobox: [{ label: 'Estado', value: 'Exemplo' }],
      sections: [{
        key: 'overview',
        heading: 'Visão geral',
        html: '<p>Conteúdo sintético <strong>formatado</strong>.</p>',
        authority: [],
        knowledgeLayer: 'unspecified',
        citations: [{ source: 'source-one', locator: 'lines 1-2' }],
      }],
    }],
    ...overrides,
  };
}

function sourceSetsFor(staged) {
  return new Map([['original', readPrivateStagedSources({ manifestPath: staged.manifestPath })]]);
}

function compileArgs(inputPath, manifestPath, outputPath) {
  return ['--input', inputPath, '--source-set', `original=${manifestPath}`, '--output', outputPath];
}

function captureStream() {
  return { value: '', write(chunk) { this.value += chunk; } };
}

test('authoring compilation is deterministic and emits stable page, section, source and revision identities', () => {
  temporaryDirectory((directory) => {
    const staged = stageSet(path.join(directory, 'staged'));
    const verified = sourceSetsFor(staged);
    const first = compileAuthoring(authoring(), verified);
    const second = compileAuthoring(authoring(), verified);

    assert.deepEqual(first.outputBytes, second.outputBytes);
    assert.equal(first.bundle.manifest.createdAt, '1970-01-01T00:00:00.000Z');
    assert.equal(first.counts.pages, 1);
    assert.equal(first.counts.sources, 1);
    assert.equal(first.counts.citations, 1);
    assert.equal(first.bundle.pages[0].snapshot.accessLevel, 'staff');
    assert.deepEqual(first.bundle.pages[0].snapshot.body.sections[0].blocks, []);
    assert.match(first.bundle.pages[0].sourcePageId, /^[0-9a-f-]{36}$/u);
    assert.match(first.bundle.pages[0].snapshot.body.sections[0].id, /^[0-9a-f-]{36}$/u);

    const changed = authoring();
    changed.pages[0].sections[0].html = '<p>Texto sintético alterado.</p>';
    const changedBundle = compileAuthoring(changed, verified).bundle;
    assert.equal(changedBundle.pages[0].sourcePageId, first.bundle.pages[0].sourcePageId);
    assert.equal(changedBundle.pages[0].snapshot.body.sections[0].id, first.bundle.pages[0].snapshot.body.sections[0].id);
    assert.notEqual(changedBundle.pages[0].sourceRevisionId, first.bundle.pages[0].sourceRevisionId);
  });
});

test('citation locators are trimmed before revision identity and duplicate checks', () => {
  temporaryDirectory((directory) => {
    const staged = stageSet(path.join(directory, 'staged'));
    const sources = sourceSetsFor(staged);
    const padded = authoring();
    padded.pages[0].sections[0].citations[0].locator = '  lines 1-2  ';
    const canonical = authoring();
    canonical.pages[0].sections[0].citations[0].locator = 'lines 1-2';

    const paddedBundle = compileAuthoring(padded, sources).bundle;
    const canonicalBundle = compileAuthoring(canonical, sources).bundle;
    assert.equal(paddedBundle.pages[0].sourceRevisionId, canonicalBundle.pages[0].sourceRevisionId);
    assert.equal(paddedBundle.manifest.bundleSha256, canonicalBundle.manifest.bundleSha256);
    assert.equal(paddedBundle.pages[0].citations[0].locator, 'lines 1-2');

    const duplicate = authoring();
    duplicate.pages[0].sections[0].citations.push({ source: 'source-one', locator: ' lines 1-2 ' });
    assert.throws(() => compileAuthoring(duplicate, sources), /Duplicate citations/);

    for (const locator of ['', '   ', '\tlines 1-2', 'x'.repeat(501)]) {
      const invalid = authoring();
      invalid.pages[0].sections[0].citations[0].locator = locator;
      assert.throws(() => compileAuthoring(invalid, sources), /Citation locator/);
    }
  });
});

test('citation and bundle ordering is independent of the process locale', () => {
  temporaryDirectory((directory) => {
    const staged = stageSet(path.join(directory, 'staged'));
    const inputPath = path.join(directory, 'locale-authoring.json');
    const input = authoring();
    input.pages[0].sections[0].citations = [
      { source: 'source-one', locator: 'ä' },
      { source: 'source-one', locator: 'z' },
    ];
    fs.writeFileSync(inputPath, JSON.stringify(input), { mode: 0o600 });
    const compilerPath = path.resolve(__dirname, '../../scripts/wiki-authoring-compile.js');
    const outputPaths = ['en-US', 'sv-SE'].map((locale) => path.join(directory, `${locale}.bundle.json`));
    const locales = ['en_US.UTF-8', 'sv_SE.UTF-8'];

    for (let index = 0; index < locales.length; index += 1) {
      const result = spawnSync(process.execPath, [
        compilerPath,
        ...compileArgs(inputPath, staged.manifestPath, outputPaths[index]),
      ], {
        cwd: path.resolve(__dirname, '../..'),
        encoding: 'utf8',
        env: { PATH: process.env.PATH, LANG: locales[index], LC_ALL: locales[index] },
      });
      assert.equal(result.status, 0, result.stderr);
    }

    const enBytes = fs.readFileSync(outputPaths[0]);
    const svBytes = fs.readFileSync(outputPaths[1]);
    assert.deepEqual(enBytes, svBytes);
    const bundle = JSON.parse(enBytes);
    assert.deepEqual(bundle.pages[0].citations.map((citation) => citation.locator), ['z', 'ä']);
  });
});

test('staged source identity follows archive, exact path and verified content hash', () => {
  temporaryDirectory((directory) => {
    const original = stageSet(path.join(directory, 'first'));
    const changed = stageSet(path.join(directory, 'second'), [
      { path: 'reference/source.md', content: '# Revised synthetic source\n' },
    ], 'revised synthetic archive');
    const originalBundle = compileAuthoring(authoring(), sourceSetsFor(original)).bundle;
    const changedBundle = compileAuthoring(authoring(), sourceSetsFor(changed)).bundle;
    assert.notEqual(changedBundle.sources[0].sourceId, originalBundle.sources[0].sourceId);
    assert.notEqual(changedBundle.pages[0].sourceRevisionId, originalBundle.pages[0].sourceRevisionId);
  });
});

test('source tampering, missing source paths and traversal paths fail safely', () => {
  temporaryDirectory((directory) => {
    const staged = stageSet(path.join(directory, 'staged'));
    const sourcePath = path.join(staged.filesRoot, 'reference', 'source.md');
    fs.writeFileSync(sourcePath, '# Synthetix source\n', { mode: 0o600 });
    assert.throws(() => readPrivateStagedSources({ manifestPath: staged.manifestPath }), /hash does not match/);

    const intact = stageSet(path.join(directory, 'intact'));
    const missing = authoring();
    missing.sources[0].path = 'reference/missing.md';
    assert.throws(() => compileAuthoring(missing, sourceSetsFor(intact)), /missing or is context/);

    const traversal = authoring();
    traversal.sources[0].path = '../private.md';
    assert.throws(() => compileAuthoring(traversal, sourceSetsFor(intact)), /source path is invalid/);
  });
});

test('strict shapes, invalid keys, unsafe HTML and Markdown-like markup are rejected', () => {
  temporaryDirectory((directory) => {
    const staged = stageSet(path.join(directory, 'staged'));
    const sources = sourceSetsFor(staged);

    const extra = authoring();
    extra.pages[0].internalNote = 'private synthetic note';
    assert.throws(() => compileAuthoring(extra, sources), /missing or unsupported fields/);

    const badKey = authoring();
    badKey.pages[0].key = 'Bad Key';
    assert.throws(() => compileAuthoring(badKey, sources), /stable ASCII key/);

    const duplicatePageKey = authoring();
    duplicatePageKey.pages.push(structuredClone(duplicatePageKey.pages[0]));
    assert.throws(() => compileAuthoring(duplicatePageKey, sources), /Page keys must be unique/);

    const duplicateSectionKey = authoring();
    duplicateSectionKey.pages[0].sections.push(structuredClone(duplicateSectionKey.pages[0].sections[0]));
    assert.throws(() => compileAuthoring(duplicateSectionKey, sources), /Section keys must be unique/);

    for (const html of [
      '<p onclick="alert(1)">unsafe synthetic text</p>',
      '<p class="custom">unsafe synthetic text</p>',
      '<script>synthetic-secret()</script>',
      '<p>**markdown**</p>',
      '<p>*markdown*</p>',
      '<p>[synthetic](https://example.invalid)</p>',
      '<p><a href="/wiki/target#section-anchor">section link</a></p>',
    ]) {
      const invalid = authoring();
      invalid.pages[0].sections[0].html = html;
      assert.throws(() => compileAuthoring(invalid, sources));
    }
  });
});

test('citation resolution enforces section citations, uniqueness and source closure', () => {
  temporaryDirectory((directory) => {
    const staged = stageSet(path.join(directory, 'staged'), [
      { path: 'reference/source.md', content: '# Source one\n' },
      { path: 'reference/other.md', content: '# Source two\n' },
    ]);
    const verified = sourceSetsFor(staged);

    const unknown = authoring();
    unknown.pages[0].sections[0].citations[0].source = 'missing-source';
    assert.throws(() => compileAuthoring(unknown, verified), /unknown source key/);

    const duplicate = authoring();
    duplicate.pages[0].sections[0].citations.push({ source: 'source-one', locator: 'lines 1-2' });
    assert.throws(() => compileAuthoring(duplicate, verified), /Duplicate citations/);

    const duplicateSource = authoring({
      sources: [
        { key: 'source-one', set: 'original', path: 'reference/source.md' },
        { key: 'source-two', set: 'original', path: 'reference/source.md' },
      ],
    });
    assert.throws(() => compileAuthoring(duplicateSource, verified), /must not duplicate the same staged document/);

    const unused = authoring({
      sources: [
        { key: 'source-one', set: 'original', path: 'reference/source.md' },
        { key: 'source-two', set: 'original', path: 'reference/other.md' },
      ],
    });
    assert.throws(() => compileAuthoring(unused, verified), /Every declared source must be cited/);

    const noCitation = authoring();
    noCitation.pages[0].sections[0].citations = [];
    assert.throws(() => compileAuthoring(noCitation, verified), /at least one citation/);
  });
});

test('normalized slug and alias collisions across pages are rejected', () => {
  temporaryDirectory((directory) => {
    const staged = stageSet(path.join(directory, 'staged'));
    const duplicate = authoring();
    duplicate.pages.push({
      ...structuredClone(duplicate.pages[0]),
      key: 'second-page',
      title: 'Segunda página sintética',
      slug: 'second-page',
      aliases: ['pagina-sintetica'],
      sections: [{
        ...structuredClone(duplicate.pages[0].sections[0]),
        key: 'overview-two',
      }],
    });
    assert.throws(() => compileAuthoring(duplicate, sourceSetsFor(staged)), /unique across the batch/);
  });
});

test('CLI output is exclusive, private, atomic on failure and never echoes article content', () => {
  temporaryDirectory((directory) => {
    const staged = stageSet(path.join(directory, 'staged'));
    const inputPath = path.join(directory, 'authoring.json');
    const outputPath = path.join(directory, 'private', 'wiki-work', 'output.bundle.json');
    privateDirectory(path.dirname(inputPath));
    fs.writeFileSync(inputPath, '{"format":"AetherverseWikiAuthoringV1","format":"AetherverseWikiAuthoringV1"}', { mode: 0o600 });
    assert.throws(() => main(compileArgs(inputPath, staged.manifestPath, outputPath), { stdout: captureStream() }), /duplicate object fields/);
    assert.equal(fs.existsSync(outputPath), false);

    const input = authoring();
    input.pages[0].sections[0].html = '<script>article-secret-marker()</script>';
    fs.writeFileSync(inputPath, JSON.stringify(input), { mode: 0o600 });

    const stdout = captureStream();
    assert.throws(() => main(compileArgs(inputPath, staged.manifestPath, outputPath), { stdout }), /unsupported HTML/);
    assert.equal(fs.existsSync(outputPath), false);
    assert.equal(stdout.value, '');

    input.pages[0].sections[0].html = '<p>Conteúdo sintético.</p>';
    fs.writeFileSync(inputPath, JSON.stringify(input), { mode: 0o600 });
    const successfulStdout = captureStream();
    const counts = main(compileArgs(inputPath, staged.manifestPath, outputPath), { stdout: successfulStdout });
    assert.deepEqual(counts, { pages: 1, sources: 1, citations: 1 });
    assert.match(successfulStdout.value, /Compiled 1 page\(s\), 1 source\(s\), 1 citation\(s\)/u);
    assert.equal(fs.statSync(outputPath).mode & 0o777, 0o600);
    const bytes = fs.readFileSync(outputPath);
    assert.equal(bytes.length < 4 * 1024 * 1024, true);
    assert.equal(JSON.parse(bytes).format, 'AetherverseWikiBundleV1');
    assert.throws(() => main(compileArgs(inputPath, staged.manifestPath, outputPath), { stdout: captureStream() }), /refusing to overwrite/);

    const badCliInputPath = path.join(directory, 'bad-authoring.json');
    const badCliInput = authoring();
    badCliInput.pages[0].sections[0].html = '<script>article-secret-marker()</script>';
    fs.writeFileSync(badCliInputPath, JSON.stringify(badCliInput), { mode: 0o600 });
    const cli = spawnSync(process.execPath, [
      path.resolve(__dirname, '../../scripts/wiki-authoring-compile.js'),
      ...compileArgs(badCliInputPath, staged.manifestPath, path.join(directory, 'cli-output.bundle.json')),
    ], { encoding: 'utf8', env: { PATH: process.env.PATH } });
    assert.notEqual(cli.status, 0);
    assert.doesNotMatch(cli.stderr, /article-secret-marker|Conteúdo sintético|reference\/source\.md/u);
    assert.equal(fs.existsSync(path.join(directory, 'cli-output.bundle.json')), false);
  });
});

test('CLI argument parsing accepts repeated source sets and rejects malformed arguments', () => {
  assert.deepEqual(parseArgs([
    '--input', 'articles.json', '--source-set', 'original=original/manifest.json',
    '--source-set', 'revised=revised/manifest.json', '--output', 'bundle.json',
  ]), {
    inputPath: 'articles.json',
    outputPath: 'bundle.json',
    sourceSets: new Map([
      ['original', 'original/manifest.json'],
      ['revised', 'revised/manifest.json'],
    ]),
    help: false,
  });
  assert.deepEqual(parseArgs(['--help']), { help: true });
  assert.throws(() => parseArgs([]), /Usage:/);
  assert.throws(() => parseArgs(['--input', 'only.json']), /Usage:/);
  assert.throws(() => parseArgs([
    '--input', 'one.json', '--input', 'two.json', '--source-set', 'original=manifest.json', '--output', 'bundle.json',
  ]), /only once/);
  assert.throws(() => parseArgs([
    '--input', 'one.json', '--source-set', 'original=one.json', '--source-set', 'original=two.json', '--output', 'bundle.json',
  ]), /only once/);
});
