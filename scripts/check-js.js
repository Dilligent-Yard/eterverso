'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SOURCE_EXTENSIONS = new Set(['.js', '.cjs', '.mjs']);

// Build output, dependencies and restricted local material never contain
// intentional repository source. The names are excluded at every depth so a
// nested generated directory cannot silently enter the scan.
const EXCLUDED_DIRECTORIES = new Set([
  '.git',
  '.generated',
  '.local',
  '.next',
  'build',
  'coverage',
  'dist',
  'generated',
  'node_modules',
  'out',
]);

function requireNode24() {
  if (Number(process.versions.node.split('.')[0]) !== 24) {
    throw new Error(`This project uses Node 24 (.nvmrc); current runtime is ${process.version}. Run nvm use first.`);
  }
}

function listJavaScriptFiles(root = ROOT) {
  const found = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRECTORIES.has(entry.name)) pending.push(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      found.push(path.relative(root, absolute).split(path.sep).join('/'));
    }
  }
  return found.sort();
}

function syntaxCheckOutput(result) {
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
  if (result.error) return `${result.error.message}${output ? `\n${output}` : ''}`;
  return output || `node --check exited with status ${result.status === null ? 'unknown' : result.status}.`;
}

function checkJavaScript({ root = ROOT, files = listJavaScriptFiles(root) } = {}) {
  if (files.length === 0) {
    throw new Error('No JavaScript source files found; refusing to report a syntax check as passed.');
  }
  const failures = [];
  for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', path.join(root, file)], {
      encoding: 'utf8',
      cwd: root,
    });
    if (result.status !== 0) {
      failures.push({ file, output: syntaxCheckOutput(result) });
    }
  }
  return { checked: files.length, failures };
}

function assertJavaScriptSyntax(options) {
  const result = checkJavaScript(options);
  if (result.failures.length === 0) return result;
  const details = result.failures
    .map((failure) => `  ${failure.file}\n${failure.output.split('\n').map((line) => `    ${line}`).join('\n')}`)
    .join('\n');
  throw new Error(`${result.failures.length} JavaScript file(s) failed syntax check (files were parsed, not executed):\n${details}`);
}

function parseArguments(argv) {
  let root = ROOT;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--root') {
      index += 1;
      if (!argv[index]) throw new Error('--root requires a directory.');
      root = path.resolve(argv[index]);
    } else if (argument.startsWith('--root=')) {
      const value = argument.slice('--root='.length);
      if (!value) throw new Error('--root requires a directory.');
      root = path.resolve(value);
    } else {
      throw new Error(`Unknown argument "${argument}". Usage: node scripts/check-js.js [--root <directory>]`);
    }
  }
  return { root };
}

function main(argv = process.argv.slice(2)) {
  requireNode24();
  const { root } = parseArguments(argv);
  const result = assertJavaScriptSyntax({ root });
  console.log(`Syntax-checked ${result.checked} JavaScript files with Node ${process.version}.`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  ROOT,
  SOURCE_EXTENSIONS,
  EXCLUDED_DIRECTORIES,
  listJavaScriptFiles,
  checkJavaScript,
  assertJavaScriptSyntax,
};
