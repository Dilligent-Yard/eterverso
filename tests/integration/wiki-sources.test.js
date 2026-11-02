'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const cookieSession = require('cookie-session');
const postgres = require('postgres');
const { createApp } = require('../../server/app');
const { createAuth, createCookieSessionOptions } = require('../../server/auth');

const ROOT = path.resolve(__dirname, '../..');
const IMPORT_SCRIPT = path.join(ROOT, 'scripts/wiki-source-import.js');
const TEST_DATABASE_URL = process.env.ETERVERSO_TEST_DATABASE_URL;
const ORIGINAL_CONTENT = 'Synthetic source text: ação ✨.\nSecond line.';
const ORIGINAL_PATH = 'lore/z-synthetic-source.txt';
const REPEAT_CREATED_AT = '2001-02-03T04:05:06.000Z';

let sql;
let apiServer;
let sessionServer;
let apiBaseUrl;
let sessionBaseUrl;
let sourceAuth;

test.before(async () => {
  assert.ok(TEST_DATABASE_URL, 'Run npm run test:env:up, then npm run test:integration.');
  assert.equal(process.env.DATABASE_URL, undefined, 'The integration test must not inherit the development DSN.');
  assert.equal(process.env.DEV_DATABASE_URL, undefined, 'The integration test must not inherit the development DSN.');

  const verified = JSON.parse(execFileSync(process.execPath, [path.join(ROOT, 'scripts/test-env.js'), 'assert'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }));
  const target = new URL(TEST_DATABASE_URL);
  assert.equal(target.hostname, '127.0.0.1');
  assert.equal(decodeURIComponent(target.pathname.slice(1)), 'eterverso_test');
  assert.equal(decodeURIComponent(target.username), 'eterverso_test');
  assert.equal(Number(target.port), verified.port);

  sql = postgres(TEST_DATABASE_URL, {
    prepare: false,
    max: 10,
    connect_timeout: 5,
    idle_timeout: 2,
    connection: { timezone: 'UTC' },
  });
  const identity = await sql`SELECT current_database() AS database, current_user AS username`;
  assert.equal(identity[0].database, 'eterverso_test');
  assert.equal(identity[0].username, 'eterverso_test');

  const config = { sessionSecret: `wiki-sources-${randomUUID()}`, secureCookies: false };
  sourceAuth = createAuth({ sql, config });
  const app = createApp({ sql, config });
  apiServer = app.listen(0, '127.0.0.1');
  await waitForListening(apiServer);
  apiBaseUrl = `http://127.0.0.1:${apiServer.address().port}`;

  const sessionApp = express();
  sessionApp.use(cookieSession(createCookieSessionOptions(config)));
  sessionApp.get('/__fixture/session/:id', async (req, res, next) => {
    try {
      const users = await sql`
        SELECT id, auth_version FROM users
        WHERE id = ${req.params.id} AND disabled_at IS NULL LIMIT 1`;
      if (!users.length) return res.status(404).json({ error: 'Fixture account not found.' });
      return res.json({ csrfToken: sourceAuth.issueSession(req, users[0]) });
    } catch (error) {
      return next(error);
    }
  });
  sessionServer = sessionApp.listen(0, '127.0.0.1');
  await waitForListening(sessionServer);
  sessionBaseUrl = `http://127.0.0.1:${sessionServer.address().port}`;
});

test.after(async () => {
  if (sessionServer) await closeServer(sessionServer);
  if (apiServer) await closeServer(apiServer);
  if (sql) await sql.end({ timeout: 5 });
});

test('SRC-01/SRC-02 import synthetic source data idempotently and expose it only to staff', async (t) => {
  const fixture = {
    archiveSha256: sha256(Buffer.from(`synthetic archive identity ${randomUUID()}`, 'utf8')),
    users: [],
    tempDirectories: [],
  };
  t.after(async () => cleanFixture(fixture));

  const staff = await createUser(fixture, 'moderador');
  const secondStaff = await createUser(fixture, 'admin');
  const member = await createUser(fixture, 'member');
  const initialManifest = stageFixture(fixture, [{
    relativePath: ORIGINAL_PATH,
    content: ORIGINAL_CONTENT,
  }]);

  const firstImport = importSources(initialManifest, staff.id);
  assert.equal(firstImport.status, 0, firstImport.stderr);
  assert.match(firstImport.stdout, /Imported 1 source record\(s\); reused 0/);
  assert.doesNotMatch(firstImport.stdout, /Synthetic source text/);

  const originalRows = await sql`
    SELECT id, archive_sha256, relative_path, file_sha256, family, language,
           declared_version, declared_date, content, imported_by, created_at
    FROM wiki_sources
    WHERE archive_sha256 = ${fixture.archiveSha256} AND relative_path = ${ORIGINAL_PATH}`;
  assert.equal(originalRows.length, 1);
  const original = originalRows[0];
  const originalHash = sha256(Buffer.from(ORIGINAL_CONTENT, 'utf8'));
  assert.match(original.id, /^[0-9a-f-]{36}$/i);
  assert.equal(original.file_sha256, originalHash);
  assert.equal(original.content, ORIGINAL_CONTENT);
  assert.equal(original.imported_by, staff.id);

  // A repeat must be a no-op for the row, including its creation timestamp.
  await sql`UPDATE wiki_sources SET created_at = ${REPEAT_CREATED_AT} WHERE id = ${original.id}`;
  const repeatedImport = importSources(initialManifest, staff.id);
  assert.equal(repeatedImport.status, 0, repeatedImport.stderr);
  assert.match(repeatedImport.stdout, /Imported 0 source record\(s\); reused 1/);
  assert.doesNotMatch(repeatedImport.stdout, /Synthetic source text/);

  const repeatedRows = await sql`
    SELECT id, file_sha256, family, language, declared_version, declared_date,
           content, imported_by, created_at
    FROM wiki_sources WHERE archive_sha256 = ${fixture.archiveSha256}
      AND relative_path = ${ORIGINAL_PATH}`;
  assert.equal(repeatedRows.length, 1);
  assert.equal(repeatedRows[0].id, original.id);
  assert.equal(repeatedRows[0].file_sha256, originalHash);
  assert.equal(repeatedRows[0].content, ORIGINAL_CONTENT);
  assert.equal(repeatedRows[0].imported_by, staff.id);
  assert.equal(new Date(repeatedRows[0].created_at).toISOString(), REPEAT_CREATED_AT);

  // Importer identity is provenance, not source content: another active staff
  // member can replay the same bytes without replacing the original importer.
  const repeatedByOtherStaff = importSources(initialManifest, secondStaff.id);
  assert.equal(repeatedByOtherStaff.status, 0, repeatedByOtherStaff.stderr);
  assert.match(repeatedByOtherStaff.stdout, /Imported 0 source record\(s\); reused 1/);
  await assertOriginalSourceUnchanged(fixture.archiveSha256, original.id, originalHash, staff.id);

  const changedBytesContent = 'Synthetic changed source bytes.';
  const changedBytesManifest = stageFixture(fixture, [
    { relativePath: 'lore/a-rollback-bytes.txt', content: 'Synthetic transaction rollback bytes.' },
    { relativePath: ORIGINAL_PATH, content: changedBytesContent },
  ]);
  const changedBytesImport = importSources(changedBytesManifest, staff.id);
  assert.equal(changedBytesImport.status, 1);
  assert.match(changedBytesImport.stderr, /conflicts with an existing database record/);
  assert.doesNotMatch(`${changedBytesImport.stdout}${changedBytesImport.stderr}`, /Synthetic source text|changed source bytes/);
  assert.equal(await countSource(fixture.archiveSha256, 'lore/a-rollback-bytes.txt'), 0,
    'the source inserted before the conflict must roll back');
  await assertOriginalSourceUnchanged(fixture.archiveSha256, original.id, originalHash, staff.id);

  const changedMetadataManifest = stageFixture(fixture, [
    { relativePath: 'lore/a-rollback-metadata.txt', content: 'Synthetic transaction rollback metadata.' },
    { relativePath: ORIGINAL_PATH, content: ORIGINAL_CONTENT, family: 'Synthetic changed family' },
  ]);
  const changedMetadataImport = importSources(changedMetadataManifest, staff.id);
  assert.equal(changedMetadataImport.status, 1);
  assert.match(changedMetadataImport.stderr, /conflicts with an existing database record/);
  assert.doesNotMatch(`${changedMetadataImport.stdout}${changedMetadataImport.stderr}`, /Synthetic source text|changed family/);
  assert.equal(await countSource(fixture.archiveSha256, 'lore/a-rollback-metadata.txt'), 0,
    'the source inserted before the metadata conflict must roll back');
  await assertOriginalSourceUnchanged(fixture.archiveSha256, original.id, originalHash, staff.id);

  const staffSession = await sessionFor(staff.id);
  const memberSession = await sessionFor(member.id);
  const staffPaths = [
    '/api/staff/wiki/sources',
    `/api/staff/wiki/sources/${original.id}`,
    `/api/staff/wiki/sources/${original.id}/locators`,
  ];
  for (const endpoint of staffPaths) {
    const anonymous = await apiRequest(null, endpoint);
    assert.equal(anonymous.status, 401, endpoint);
    const deniedMember = await apiRequest(memberSession, endpoint);
    assert.equal(deniedMember.status, 403, endpoint);
  }

  const manifestResponse = await apiRequest(staffSession, staffPaths[0]);
  assert.equal(manifestResponse.status, 200, JSON.stringify(manifestResponse.body));
  const manifestItem = manifestResponse.body.data.find((item) => item.id === original.id);
  assert.ok(manifestItem);
  assert.equal(manifestItem.fileSha256, originalHash);
  assert.equal(Object.hasOwn(manifestItem, 'content'), false);
  assert.equal(JSON.stringify(manifestResponse.body).includes(ORIGINAL_CONTENT), false);

  const sourceResponse = await apiRequest(staffSession, staffPaths[1]);
  assert.equal(sourceResponse.status, 200, JSON.stringify(sourceResponse.body));
  assert.equal(sourceResponse.body.data.content, ORIGINAL_CONTENT);
  assert.equal(sourceResponse.body.data.fileSha256, originalHash);
  assert.equal(sha256(Buffer.from(sourceResponse.body.data.content, 'utf8')), originalHash,
    'the staff response must hash back to the exact staged UTF-8 bytes');

  const locatorsResponse = await apiRequest(staffSession, staffPaths[2]);
  assert.equal(locatorsResponse.status, 200, JSON.stringify(locatorsResponse.body));
  assert.deepEqual(locatorsResponse.body.data, []);

  for (const publicPath of ['/api/wiki/sources', `/api/wiki/sources/${original.id}`]) {
    const response = await apiRequest(null, publicPath);
    assert.equal(response.status, 404, publicPath);
    assert.doesNotMatch(JSON.stringify(response.body), /Synthetic source text|z-synthetic-source/);
  }
});

async function createUser(fixture, role) {
  const username = `wiki-source-${role}-${randomUUID().slice(0, 8)}`;
  const rows = await sql`
    INSERT INTO users (username, email, password_hash, role)
    VALUES (${username}, ${`${username}@example.test`}, 'test-only-hash', ${role})
    RETURNING id`;
  const user = { id: rows[0].id, role, username };
  fixture.users.push(user);
  return user;
}

function stageFixture(fixture, sources) {
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'eterverso-wiki-source-'));
  fixture.tempDirectories.push(stagingRoot);
  fs.chmodSync(stagingRoot, 0o700);

  const archiveDirectory = path.join(stagingRoot, fixture.archiveSha256);
  const filesRoot = path.join(archiveDirectory, 'files');
  fs.mkdirSync(filesRoot, { recursive: true, mode: 0o700 });
  fs.chmodSync(archiveDirectory, 0o700);
  fs.chmodSync(filesRoot, 0o700);

  const entries = sources.map((source) => {
    const bytes = Buffer.from(source.content, 'utf8');
    const segments = source.relativePath.split('/');
    const filePath = path.join(filesRoot, ...segments);
    const parent = path.dirname(filePath);
    fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
    chmodTreeDirectories(filesRoot, parent);
    fs.writeFileSync(filePath, bytes, { flag: 'wx', mode: 0o600 });
    fs.chmodSync(filePath, 0o600);

    return {
      relativePath: source.relativePath,
      sizeBytes: bytes.length,
      sha256: sha256(bytes),
      family: source.family || 'Synthetic reference family',
      language: source.language || 'pt-BR',
      declaredVersion: source.declaredVersion || 'synthetic-v1',
      declaredDate: source.declaredDate || '2026-10-20',
      role: 'source',
      mediaType: path.posix.extname(source.relativePath).toLowerCase() === '.md'
        ? 'text/markdown'
        : 'text/plain',
    };
  });

  const manifest = {
    format: 'eterverso-wiki-source-stage-v1',
    archiveSha256: fixture.archiveSha256,
    archiveSizeBytes: 256,
    totalUncompressedBytes: entries.reduce((total, entry) => total + entry.sizeBytes, 0),
    fileCount: entries.length,
    files: entries,
  };
  const manifestPath = path.join(archiveDirectory, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest), { flag: 'wx', mode: 0o600 });
  fs.chmodSync(manifestPath, 0o600);
  return manifestPath;
}

function chmodTreeDirectories(root, leaf) {
  let current = leaf;
  while (current !== root) {
    fs.chmodSync(current, 0o700);
    current = path.dirname(current);
  }
  fs.chmodSync(root, 0o700);
}

function importSources(manifestPath, importedBy) {
  const environment = { ...process.env };
  delete environment.DEV_DATABASE_URL;
  environment.DATABASE_URL = TEST_DATABASE_URL;
  return runImporter([
    '--manifest', manifestPath,
    '--database-name', 'eterverso_test',
    '--imported-by', importedBy,
  ], environment);
}

function runImporter(args, environment) {
  try {
    return {
      status: 0,
      stdout: execFileSync(process.execPath, [IMPORT_SCRIPT, ...args], {
        cwd: ROOT,
        env: environment,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 1024 * 1024,
      }),
      stderr: '',
    };
  } catch (error) {
    return {
      status: error.status,
      stdout: String(error.stdout || ''),
      stderr: String(error.stderr || ''),
    };
  }
}

async function assertOriginalSourceUnchanged(archiveSha256, sourceId, fileHash, importedBy) {
  const rows = await sql`
    SELECT id, file_sha256, family, language, declared_version, declared_date,
           content, imported_by, created_at
    FROM wiki_sources WHERE archive_sha256 = ${archiveSha256}
      AND relative_path = ${ORIGINAL_PATH}`;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, sourceId);
  assert.equal(rows[0].file_sha256, fileHash);
  assert.equal(rows[0].family, 'Synthetic reference family');
  assert.equal(rows[0].language, 'pt-BR');
  assert.equal(rows[0].declared_version, 'synthetic-v1');
  assert.equal(rows[0].declared_date, '2026-10-20');
  assert.equal(rows[0].content, ORIGINAL_CONTENT);
  assert.equal(rows[0].imported_by, importedBy);
  assert.equal(new Date(rows[0].created_at).toISOString(), REPEAT_CREATED_AT);
}

async function countSource(archiveSha256, relativePath) {
  const rows = await sql`
    SELECT count(*)::integer AS count FROM wiki_sources
    WHERE archive_sha256 = ${archiveSha256} AND relative_path = ${relativePath}`;
  return rows[0].count;
}

async function sessionFor(userId) {
  const response = await fetch(`${sessionBaseUrl}/__fixture/session/${userId}`);
  assert.equal(response.status, 200);
  const cookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie') || ''];
  return {
    cookie: cookies.map((value) => value.split(';', 1)[0]).filter(Boolean).join('; '),
    csrfToken: (await response.json()).csrfToken,
  };
}

async function apiRequest(session, route) {
  const headers = session ? { cookie: session.cookie, 'x-csrf-token': session.csrfToken } : {};
  const response = await fetch(`${apiBaseUrl}${route}`, { headers });
  const text = await response.text();
  let body = text;
  try { body = JSON.parse(text); } catch (_error) { /* Preserve non-JSON 404 bodies. */ }
  return { status: response.status, body };
}

async function cleanFixture(fixture) {
  try {
    await sql.begin(async (tx) => {
      await tx`DELETE FROM wiki_sources WHERE archive_sha256 = ${fixture.archiveSha256}`;
      for (const user of fixture.users) await tx`DELETE FROM users WHERE id = ${user.id}`;
    });
  } finally {
    for (const directory of fixture.tempDirectories) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function waitForListening(server) {
  return new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  });
}
