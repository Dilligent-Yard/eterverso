'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const postgres = require('postgres');

test('ENV-01 integration connection reaches only the isolated test database', async (context) => {
  const url = process.env.ETERVERSO_TEST_DATABASE_URL;
  assert.ok(url, 'the guarded runner must provide the explicit test DSN');
  const parsed = new URL(url);
  assert.equal(parsed.hostname, '127.0.0.1');
  assert.equal(Number(parsed.port), Number(process.env.ETERVERSO_TEST_DB_PORT || parsed.port));
  assert.equal(parsed.pathname, '/eterverso_test');

  const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 5, idle_timeout: 1, connection: { timezone: 'UTC' } });
  context.after(async () => sql.end({ timeout: 5 }));

  const identity = await sql`SELECT current_database() AS database`;
  assert.equal(identity[0].database, 'eterverso_test');
  const ledger = await sql`SELECT id, hash FROM drizzle.__drizzle_migrations ORDER BY id`;
  assert.equal(ledger.length, 18);
  assert.equal(ledger[17].id, 18);
  const tableNames = (await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`
  ).map((row) => row.table_name);
  assert.ok(tableNames.includes('users'));
  assert.ok(tableNames.includes('wiki_posts'));
  assert.ok(tableNames.includes('wiki_pages'));
  assert.ok(tableNames.includes('wiki_sections'));
  assert.ok(tableNames.includes('legacy_imports'));
  assert.ok(tableNames.includes('notifications'));
  assert.ok(tableNames.includes('likes'));
  assert.ok(tableNames.includes('timeline_events'));
});
