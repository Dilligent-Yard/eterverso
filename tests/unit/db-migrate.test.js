'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  BASELINE_COLUMNS,
  BASELINE_CONSTRAINTS,
  ACCOUNT_SECURITY_COLUMNS,
  ACCOUNT_SECURITY_CONSTRAINTS,
  FORUM_COLUMNS,
  FORUM_CONSTRAINTS,
  FORUM_TIMESTAMP_COLUMNS,
  SCENE_COLUMNS,
  SCENE_CONSTRAINTS,
  WIKI_COLUMNS,
  WIKI_CONSTRAINTS,
  IMPORT_COLUMNS,
  IMPORT_CONSTRAINTS,
  TRANSFER_COLUMNS,
  TRANSFER_CONSTRAINTS,
  SECTION_COLUMNS,
  SECTION_TYPES,
  SECTION_CONSTRAINTS,
  CHARACTER_MW_COLUMNS,
  CHARACTER_MW_CONSTRAINTS,
  classifySchema,
  assertPrivateBackupFile,
  archiveListBelongsToDevelopment,
  validateDevelopmentBackup,
} = require('../../scripts/db-migrate');

function fixture() {
  const history = Array.from({ length: 17 }, (_entry, index) => ({ id: index + 1, hash: `hash-${index + 1}` }));
  return {
    history,
    report: {
      publicTables: Object.keys(BASELINE_COLUMNS).sort(),
      columns: Object.fromEntries(Object.entries(BASELINE_COLUMNS).map(([name, columns]) => [name, [...columns]])),
      constraints: [...BASELINE_CONSTRAINTS],
      ledger: history.slice(0, 7).map((entry) => ({ ...entry })),
    },
  };
}

test('MIG-03 recognizes only empty and exact supported migration/schema states', () => {
  const { history, report } = fixture();
  assert.deepEqual(classifySchema({ publicTables: [], ledger: [] }, history), { state: 'empty', supported: true });
  assert.deepEqual(classifySchema(report, history), { state: 'verified-0006-baseline', supported: true });

  const security = structuredClone(report);
  security.columns = Object.fromEntries(Object.entries(ACCOUNT_SECURITY_COLUMNS).map(([name, columns]) => [name, [...columns]]));
  security.constraints = [...ACCOUNT_SECURITY_CONSTRAINTS];
  security.ledger = history.slice(0, 8).map((entry) => ({ ...entry }));
  assert.deepEqual(classifySchema(security, history), { state: 'verified-0007-account-security', supported: true });

  const forum = structuredClone(security);
  forum.publicTables = Object.keys(FORUM_COLUMNS).sort();
  forum.columns = Object.fromEntries(Object.entries(FORUM_COLUMNS).map(([name, columns]) => [name, [...columns]]));
  forum.constraints = [...FORUM_CONSTRAINTS];
  forum.ledger = history.slice(0, 9).map((entry) => ({ ...entry }));
  assert.deepEqual(classifySchema(forum, history), { state: 'verified-0008-forum', supported: true });

  const indexed = structuredClone(forum);
  indexed.ledger = history.slice(0, 10).map((entry) => ({ ...entry }));
  indexed.indexes = [{ table: 'users', name: 'users_username_lower_key', definition: 'CREATE UNIQUE INDEX users_username_lower_key ON public.users USING btree (lower(username))' }];
  assert.deepEqual(classifySchema(indexed, history), { state: 'verified-0009-forum-integrity', supported: true });

  const zoned = structuredClone(indexed);
  zoned.ledger = history.slice(0, 11).map((entry) => ({ ...entry }));
  zoned.columnTypes = {};
  for (const entry of FORUM_TIMESTAMP_COLUMNS) {
    const [table, column] = entry.split('.');
    (zoned.columnTypes[table] ||= {})[column] = 'timestamp with time zone';
  }
  assert.deepEqual(classifySchema(zoned, history), { state: 'verified-0010-forum-timestamps', supported: true });

  const incompleteIndex = structuredClone(indexed);
  incompleteIndex.indexes[0].definition = 'CREATE INDEX users_username_lower_key ON public.users USING btree (lower(username))';
  assert.equal(classifySchema(incompleteIndex, history).supported, false);

  const incompleteTimezone = structuredClone(zoned);
  incompleteTimezone.columnTypes.threads.created_at = 'timestamp without time zone';
  assert.equal(classifySchema(incompleteTimezone, history).supported, false);

  const scene = structuredClone(zoned);
  scene.publicTables = Object.keys(SCENE_COLUMNS).sort();
  scene.columns = Object.fromEntries(Object.entries(SCENE_COLUMNS).map(([name, columns]) => [name, [...columns]]));
  scene.constraints = [...SCENE_CONSTRAINTS];
  scene.ledger = history.slice(0, 12).map((entry) => ({ ...entry }));
  scene.indexes = [
    { table: 'users', name: 'users_username_lower_key', definition: 'CREATE UNIQUE INDEX users_username_lower_key ON public.users USING btree (lower(username))' },
    { table: 'scene_turns', name: 'scene_turns_scene_legacy_id_key', definition: 'CREATE UNIQUE INDEX scene_turns_scene_legacy_id_key ON public.scene_turns USING btree (scene_id, legacy_id) WHERE (legacy_id IS NOT NULL)' },
    { table: 'scene_turns', name: 'idx_scene_turns_author_id', definition: 'CREATE INDEX idx_scene_turns_author_id ON public.scene_turns USING btree (author_id)' },
  ];
  assert.deepEqual(classifySchema(scene, history), { state: 'verified-0011-scene-turns', supported: true });

  const wiki = structuredClone(scene);
  wiki.publicTables = Object.keys(WIKI_COLUMNS).sort();
  wiki.columns = Object.fromEntries(Object.entries(WIKI_COLUMNS).map(([name, columns]) => [name, [...columns]]));
  wiki.constraints = [...WIKI_CONSTRAINTS];
  wiki.ledger = history.slice(0, 13).map((entry) => ({ ...entry }));
  wiki.indexes = [...scene.indexes, {
    table: 'wiki_names', name: 'wiki_names_one_canonical_per_page_key',
    definition: "CREATE UNIQUE INDEX wiki_names_one_canonical_per_page_key ON public.wiki_names USING btree (page_id) WHERE ((kind)::text = 'canonical'::text)",
  }];
  wiki.triggers = [{
    table: 'wiki_revisions', name: 'wiki_revisions_immutable', functionName: 'prevent_wiki_revision_mutation',
    definition: 'CREATE TRIGGER wiki_revisions_immutable BEFORE UPDATE OR DELETE ON public.wiki_revisions FOR EACH ROW EXECUTE FUNCTION prevent_wiki_revision_mutation()',
  }];
  assert.deepEqual(classifySchema(wiki, history), { state: 'verified-0012-wiki-core', supported: true });
  wiki.triggers = [];
  assert.equal(classifySchema(wiki, history).supported, false, 'wiki schema requires its immutable revision trigger');

  const imported = structuredClone(wiki);
  imported.publicTables = Object.keys(IMPORT_COLUMNS).sort();
  imported.columns = Object.fromEntries(Object.entries(IMPORT_COLUMNS).map(([name, columns]) => [name, [...columns]]));
  imported.constraints = [...IMPORT_CONSTRAINTS];
  imported.ledger = history.slice(0, 14).map((entry) => ({ ...entry }));
  imported.triggers = [...wiki.triggers, {
    table: 'wiki_revisions', name: 'wiki_revisions_immutable', functionName: 'prevent_wiki_revision_mutation',
    definition: 'CREATE TRIGGER wiki_revisions_immutable BEFORE UPDATE OR DELETE ON public.wiki_revisions FOR EACH ROW EXECUTE FUNCTION prevent_wiki_revision_mutation()',
  }];
  assert.deepEqual(classifySchema(imported, history), { state: 'verified-0013-legacy-import', supported: true });
  imported.constraints.pop();
  assert.equal(classifySchema(imported, history).supported, false, 'legacy import schema requires its full constraint set');

  const transfers = structuredClone(imported);
  transfers.publicTables = Object.keys(TRANSFER_COLUMNS).sort();
  transfers.columns = Object.fromEntries(Object.entries(TRANSFER_COLUMNS).map(([name, columns]) => [name, [...columns]]));
  transfers.constraints = [...TRANSFER_CONSTRAINTS];
  transfers.ledger = history.slice(0, 15).map((entry) => ({ ...entry }));
  assert.deepEqual(classifySchema(transfers, history), { state: 'verified-0014-wiki-portable-transfers', supported: true });
  transfers.constraints.pop();
  assert.equal(classifySchema(transfers, history).supported, false, 'transfer schema requires its full constraint set');

  const sections = structuredClone(transfers);
  sections.publicTables = Object.keys(SECTION_COLUMNS).sort();
  sections.columns = Object.fromEntries(Object.entries(SECTION_COLUMNS).map(([name, columns]) => [name, [...columns]]));
  sections.columnTypes.wiki_sections = { ...SECTION_TYPES };
  sections.constraints = [...SECTION_CONSTRAINTS];
  sections.ledger = history.slice(0, 16).map((entry) => ({ ...entry }));
  sections.indexes = [...scene.indexes, ...wiki.indexes.slice(scene.indexes.length), {
    table: 'wiki_sections', name: 'wiki_sections_parent_order_idx',
    definition: 'CREATE INDEX wiki_sections_parent_order_idx ON public.wiki_sections USING btree (parent_key, sort_order, key)',
  }];
  assert.deepEqual(classifySchema(sections, history), { state: 'verified-0015-wiki-sections', supported: true });
  sections.indexes = sections.indexes.filter((index) => index.name !== 'wiki_sections_parent_order_idx');
  assert.equal(classifySchema(sections, history).supported, false, 'section schema requires its parent-order index');
  sections.indexes.push({
    table: 'wiki_sections', name: 'wiki_sections_parent_order_idx',
    definition: 'CREATE INDEX wiki_sections_parent_order_idx ON public.wiki_sections USING btree (parent_key, sort_order, key)',
  });
  sections.columnTypes.wiki_sections.sort_order = 'smallint';
  assert.equal(classifySchema(sections, history).supported, false, 'section schema requires its exact column types');
  sections.columnTypes.wiki_sections.sort_order = 'integer';

  const characterMw = structuredClone(sections);
  characterMw.publicTables = Object.keys(CHARACTER_MW_COLUMNS).sort();
  characterMw.columns = Object.fromEntries(Object.entries(CHARACTER_MW_COLUMNS).map(([name, columns]) => [name, [...columns]]));
  characterMw.constraints = [...CHARACTER_MW_CONSTRAINTS];
  characterMw.ledger = history.map((entry) => ({ ...entry }));
  characterMw.indexes.push({
    table: 'character_mw_resources', name: 'idx_character_mw_resources_kind_key',
    definition: 'CREATE INDEX idx_character_mw_resources_kind_key ON public.character_mw_resources USING btree (kind, name_key)',
  });
  assert.deepEqual(classifySchema(characterMw, history), { state: 'verified-0016-character-mediawiki', supported: true });
  characterMw.indexes = characterMw.indexes.filter((index) => index.name !== 'idx_character_mw_resources_kind_key');
  assert.equal(classifySchema(characterMw, history).supported, false, 'character mediawiki schema requires its kind/name index');

  const inconsistentLedger = structuredClone(report);
  inconsistentLedger.ledger = history.slice(0, 8).map((entry) => ({ ...entry }));
  assert.equal(classifySchema(inconsistentLedger, history).supported, false);
});

test('MIG-03 refuses changed migration history, columns, constraints and unknown populated schemas', () => {
  const { history, report } = fixture();
  const changedLedger = structuredClone(report);
  changedLedger.ledger[1].hash = 'different';
  assert.equal(classifySchema(changedLedger, history).supported, false);

  const changedColumns = structuredClone(report);
  changedColumns.columns.users.push('unexpected_column');
  assert.equal(classifySchema(changedColumns, history).supported, false);

  const changedConstraints = structuredClone(report);
  changedConstraints.constraints.pop();
  assert.equal(classifySchema(changedConstraints, history).supported, false);

  const unknown = { publicTables: ['users'], ledger: [] };
  assert.equal(classifySchema(unknown, history).supported, false);
});

test('MIG-02 requires a private readable custom-format backup for development migrations', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'eterverso-migrate-backup-'));
  fs.chmodSync(directory, 0o700);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const good = path.join(directory, 'verified.dump');
  fs.writeFileSync(good, Buffer.from('PGDMPsynthetic archive fixture'), { mode: 0o600 });
  fs.chmodSync(good, 0o600);
  assert.doesNotThrow(() => assertPrivateBackupFile(good));
  let archiveChecks = 0;
  await validateDevelopmentBackup(good, async (file) => {
    assert.equal(file, good);
    archiveChecks += 1;
  });
  assert.equal(archiveChecks, 1);
  await assert.rejects(validateDevelopmentBackup(good, async () => {
    throw new Error('invalid archive');
  }), /invalid archive/);

  const empty = path.join(directory, 'empty.dump');
  fs.writeFileSync(empty, '', { mode: 0o600 });
  assert.throws(() => assertPrivateBackupFile(empty), /empty|custom-format/);

  const invalidHeader = path.join(directory, 'invalid.dump');
  fs.writeFileSync(invalidHeader, 'not an archive', { mode: 0o600 });
  assert.throws(() => assertPrivateBackupFile(invalidHeader), /custom-format/);

  const exposed = path.join(directory, 'exposed.dump');
  fs.writeFileSync(exposed, 'PGDMPsynthetic', { mode: 0o644 });
  fs.chmodSync(exposed, 0o644);
  assert.throws(() => assertPrivateBackupFile(exposed), /owner/);

  const linked = path.join(directory, 'linked.dump');
  fs.symlinkSync(good, linked);
  assert.throws(() => assertPrivateBackupFile(linked), /regular file/);

  assert.equal(archiveListBelongsToDevelopment(';\n;     dbname: eterverso\n;     Format: CUSTOM\n'), true);
  assert.equal(archiveListBelongsToDevelopment(';\n;     dbname: other_database\n;     Format: CUSTOM\n'), false);
  assert.equal(archiveListBelongsToDevelopment(''), false);
});
