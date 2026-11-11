'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  ROOT,
  listJavaScriptFiles,
  checkJavaScript,
  assertJavaScriptSyntax,
} = require('../../scripts/check-js');

const SCRIPT = path.join(ROOT, 'scripts', 'check-js.js');
const EXCLUDED_FIXTURES = [
  'generated/client/vault.js',
  '.generated/node/runtime/config.js',
  'node_modules/example/index.js',
  '.local/private-helper.js',
  'dist/bundle.js',
  'build/output.mjs',
  'coverage/report.js',
  'out/compiled.cjs',
];

function tempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eterverso-check-js-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function writeFile(root, relative, contents) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
  return file;
}

test('STATIC-01 discovers repository JavaScript and skips generated, dependency and private trees', (t) => {
  const root = tempRoot(t);
  writeFile(root, 'server.js', "'use strict';\n");
  writeFile(root, 'client/module.mjs', 'export const value = 1;\n');
  writeFile(root, 'scripts/tool.cjs', 'module.exports = 1;\n');
  writeFile(root, 'tests/unit/example.test.js', '');
  writeFile(root, 'styles.css', 'body { color: red; }\n');
  for (const relative of EXCLUDED_FIXTURES) writeFile(root, relative, 'not syntax-checked\n');

  assert.deepEqual(listJavaScriptFiles(root), [
    'client/module.mjs',
    'scripts/tool.cjs',
    'server.js',
    'tests/unit/example.test.js',
  ]);
});

test('STATIC-02 current repository enumerates entry points and tooling but no build output', () => {
  const files = listJavaScriptFiles(ROOT);
  for (const expected of [
    'app.js',
    'editor.js',
    'eslint.config.mjs',
    'server.js',
    'scripts/check-js.js',
    'scripts/test-runner.js',
    'tests/unit/check-js.test.js',
  ]) {
    assert.ok(files.includes(expected), `scan omits ${expected}`);
  }
  for (const file of files) {
    assert.ok(!file.startsWith('generated/'), `scan includes generated output ${file}`);
    assert.ok(!file.startsWith('.generated/'), `scan includes generated output ${file}`);
    assert.ok(!file.startsWith('node_modules/'), `scan includes a dependency ${file}`);
  }
});

test('STATIC-03 reports the failing path and parses rather than executes checked files', (t) => {
  const root = tempRoot(t);
  const marker = path.join(root, 'executed.marker');
  writeFile(
    root,
    'valid.js',
    `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed');\n`,
  );
  writeFile(root, 'nested/broken.js', 'const broken = ;\n');

  const result = checkJavaScript({ root });
  assert.equal(result.checked, 2);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].file, 'nested/broken.js');
  assert.match(result.failures[0].output, /SyntaxError/);
  assert.equal(fs.existsSync(marker), false, 'syntax checking executed the JavaScript file');
  assert.throws(() => assertJavaScriptSyntax({ root }), /nested\/broken\.js/);
});

test('STATIC-04 command exits nonzero and prints the exact failing path', (t) => {
  const root = tempRoot(t);
  writeFile(root, 'nested/broken.mjs', 'export const = 1;\n');

  const result = spawnSync(process.execPath, [SCRIPT, `--root=${root}`], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /nested\/broken\.mjs/);
});

test('STATIC-05 an empty tree fails instead of silently passing', (t) => {
  const root = tempRoot(t);
  assert.throws(() => checkJavaScript({ root }), /No JavaScript source files/);

  const result = spawnSync(process.execPath, [SCRIPT, `--root=${root}`], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No JavaScript source files/);
});

test('STATIC-06 accepts valid CommonJS and ES module syntax', (t) => {
  const root = tempRoot(t);
  writeFile(root, 'common.cjs', "'use strict';\nmodule.exports = { ready: true };\n");
  writeFile(root, 'module.mjs', "import path from 'node:path';\nexport const root = path.sep;\n");

  const result = assertJavaScriptSyntax({ root });
  assert.equal(result.checked, 2);
  assert.deepEqual(result.failures, []);
});

test('STATIC-07 skips excluded directory names at every depth', (t) => {
  const root = tempRoot(t);
  writeFile(root, 'top.js', 'const ok = 1;\n');
  writeFile(root, 'src/out/hidden.js', 'const hidden = ;\n');
  writeFile(root, 'pkg/dist/hidden.mjs', 'export const = 1;\n');
  writeFile(root, 'tools/generated/hidden.cjs', 'module.exports = ;\n');

  assert.deepEqual(listJavaScriptFiles(root), ['top.js']);
  const result = checkJavaScript({ root });
  assert.equal(result.checked, 1);
  assert.deepEqual(result.failures, []);
});

test('STATIC-08 aggregates multiple syntax failures', (t) => {
  const root = tempRoot(t);
  writeFile(root, 'a.js', 'const a = ;\n');
  writeFile(root, 'nested/b.mjs', 'export const = 1;\n');

  const result = checkJavaScript({ root });
  assert.equal(result.checked, 2);
  assert.deepEqual(result.failures.map((failure) => failure.file).sort(), ['a.js', 'nested/b.mjs']);

  const cli = spawnSync(process.execPath, [SCRIPT, `--root=${root}`], { encoding: 'utf8' });
  assert.equal(cli.status, 1);
  assert.match(cli.stderr, /a\.js/);
  assert.match(cli.stderr, /nested\/b\.mjs/);
});

test('STATIC-09 handles paths containing spaces and shell metacharacters', (t) => {
  const root = tempRoot(t);
  writeFile(root, 'nested dir/weird $name [1].js', 'const ok = 1;\n');

  assert.deepEqual(listJavaScriptFiles(root), ['nested dir/weird $name [1].js']);
  const result = checkJavaScript({ root });
  assert.equal(result.checked, 1);
  assert.deepEqual(result.failures, []);
});

test('STATIC-10 rejects a missing root or missing --root value', (t) => {
  const root = tempRoot(t);
  const missing = path.join(root, 'missing');
  assert.throws(() => checkJavaScript({ root: missing }), /ENOENT/);

  const missingRoot = spawnSync(process.execPath, [SCRIPT, `--root=${missing}`], { encoding: 'utf8' });
  assert.equal(missingRoot.status, 1);
  assert.match(missingRoot.stderr, /ENOENT/);

  const missingValue = spawnSync(process.execPath, [SCRIPT, '--root'], { encoding: 'utf8' });
  assert.equal(missingValue.status, 1);
  assert.match(missingValue.stderr, /--root requires a directory/);
});
