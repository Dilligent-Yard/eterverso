'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const path = require('node:path');
const express = require('express');
const cookieSession = require('cookie-session');
const postgres = require('postgres');
const { createAuth, createCookieSessionOptions } = require('../../server/auth');
const { errorMiddleware } = require('../../server/errors');
const { createWikiRouter } = require('../../server/wiki');

const ROOT = path.resolve(__dirname, '../..');
const testDatabaseUrl = process.env.ETERVERSO_TEST_DATABASE_URL;

let sql;
let server;
let baseUrl;
let auth;
const requestBarriers = new Map();

test.before(async () => {
  assert.ok(testDatabaseUrl, 'Run npm run test:env:up, then npm run test:integration.');
  assert.equal(process.env.DATABASE_URL, undefined, 'The integration test process must not inherit the development DSN.');
  assert.equal(process.env.DEV_DATABASE_URL, undefined, 'The integration test process must not inherit the development DSN.');
  const verified = JSON.parse(execFileSync(process.execPath, [path.join(ROOT, 'scripts/test-env.js'), 'assert'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }));
  const target = new URL(testDatabaseUrl);
  assert.equal(target.hostname, '127.0.0.1');
  assert.equal(decodeURIComponent(target.pathname.slice(1)), 'eterverso_test');
  assert.equal(decodeURIComponent(target.username), 'eterverso_test');
  assert.equal(Number(target.port), verified.port);

  sql = postgres(testDatabaseUrl, { prepare: false, max: 10, connect_timeout: 5, idle_timeout: 2, connection: { timezone: 'UTC' } });
  const identity = await sql`SELECT current_database() AS database, current_user AS username`;
  assert.equal(identity[0].database, 'eterverso_test');
  assert.equal(identity[0].username, 'eterverso_test');

  const config = { sessionSecret: `wiki-tests-${randomUUID()}`, secureCookies: false };
  auth = createAuth({ sql, config });
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use(cookieSession(createCookieSessionOptions(config)));
  app.use(auth.csrfProtection);
  app.get('/__fixture/session/:id', async (req, res, next) => {
    try {
      const rows = await sql`
        SELECT id, auth_version FROM users
        WHERE id = ${req.params.id} AND disabled_at IS NULL LIMIT 1`;
      if (!rows.length) return res.status(404).json({ error: 'Fixture account not found.' });
      return res.json({ csrfToken: auth.issueSession(req, rows[0]) });
    } catch (error) {
      return next(error);
    }
  });
  app.use('/api', (req, res, next) => {
    const key = req.get('X-Test-Wiki-Barrier');
    if (!key) return next();
    const barrier = requestBarriers.get(key);
    if (!barrier) return res.status(500).json({ error: 'Unknown wiki test barrier.' });
    barrier.waiters.push(next);
    barrier.arrived += 1;
    if (barrier.arrived === barrier.parties) {
      requestBarriers.delete(key);
      for (const resume of barrier.waiters) resume();
    }
  });
  app.use('/api', createWikiRouter({ sql, auth }));
  app.use(errorMiddleware);
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (sql) await sql.end({ timeout: 5 });
});

test('WIK-01 a staff draft leaves every public surface on the published snapshot until publication', async (t) => {
  const fixture = await makeFixture(t);
  const staff = await sessionFor(fixture.users.moderador.id);
  const suffix = token();
  const original = snapshot({
    title: `WIK01-Public-title-${suffix}`,
    slug: `wik01-public-${suffix}`,
    aliases: [`wik01-old-alias-${suffix}`],
    summary: `WIK01-Public-summary-${suffix}`,
    categories: [`WIK01 Public Category ${suffix}`],
    html: `<p>WIK01-Public-body-${suffix}</p>`,
  });
  const page = await createPublishedPage(fixture, staff, original);
  const initialPublic = await request(null, `/wiki/pages/${page.id}`);
  assert.equal(initialPublic.status, 200, JSON.stringify(initialPublic.body));
  const initialEtag = initialPublic.etag;
  assert.ok(initialEtag);

  const draft = snapshot({
    ...original,
    title: `WIK01-Draft-title-${suffix}`,
    slug: `wik01-draft-${suffix}`,
    aliases: [`wik01-draft-alias-${suffix}`],
    summary: `WIK01-Draft-summary-${suffix}`,
    categories: [`WIK01 Draft Category ${suffix}`],
    html: `<p>WIK01-Draft-body-${suffix}</p>`,
  });
  const saved = await saveRevision(fixture, staff, page, draft, page.workVersion);

  const publicRead = await request(null, `/wiki/pages/${page.id}`);
  assert.equal(publicRead.status, 200, JSON.stringify(publicRead.body));
  assert.equal(publicRead.etag, initialEtag);
  assert.equal(publicRead.body.data.title, original.title);
  assert.equal(publicRead.body.data.slug, original.slug);
  assert.equal(publicRead.body.data.aliases[0], original.aliases[0]);
  assert.equal(publicRead.body.data.summary, original.summary);
  assert.equal(publicRead.body.data.body.sections[0].html, original.body.sections[0].html);
  assert.equal(publicRead.body.data.publicVersion, 1);
  assertAbsent(publicRead.body, [draft.title, draft.aliases[0], draft.summary, `WIK01-Draft-body-${suffix}`]);

  const publicList = await request(null, `/wiki/pages?search=${encodeURIComponent(original.title)}`);
  assert.equal(publicList.status, 200);
  assert.ok(publicList.body.data.some((item) => item.id === page.id && item.title === original.title));
  for (const sentinel of [draft.title, draft.aliases[0], draft.summary, `WIK01-Draft-body-${suffix}`]) {
    const draftSearch = await request(null, `/wiki/pages?search=${encodeURIComponent(sentinel)}`);
    assert.equal(draftSearch.status, 200);
    assert.equal(draftSearch.body.data.length, 0, sentinel);
  }
  const draftCategory = await request(null, `/wiki/pages?category=wik01-draft-category-${suffix}`);
  assert.equal(draftCategory.status, 200);
  assert.equal(draftCategory.body.data.length, 0);
  const categories = await request(null, '/wiki/categories');
  assert.ok(categories.body.data.some((item) => item.name === original.categories[0]));
  assert.ok(!categories.body.data.some((item) => item.name === draft.categories[0]));

  const oldSlug = await request(null, `/wiki/resolve/${original.slug}`);
  const oldAlias = await request(null, `/wiki/resolve/${original.aliases[0]}`);
  assert.equal(oldSlug.status, 200);
  assert.equal(oldSlug.body.data.slug, original.slug);
  assert.equal(oldAlias.status, 200);
  assert.equal(oldAlias.body.data.slug, original.slug);
  assert.equal((await request(null, `/wiki/resolve/${draft.slug}`)).status, 404);
  assert.equal((await request(null, `/wiki/resolve/${draft.aliases[0]}`)).status, 404);

  const published = await publishRevision(fixture, staff, saved, saved.headRevisionId, saved.workVersion, page.publishedRevisionId);
  const afterPublish = await request(null, `/wiki/pages/${page.id}`);
  assert.equal(afterPublish.status, 200);
  assert.notEqual(afterPublish.etag, initialEtag);
  assert.equal(afterPublish.body.data.title, draft.title);
  assert.equal(afterPublish.body.data.slug, draft.slug);
  assert.equal(afterPublish.body.data.summary, draft.summary);
  assert.equal(afterPublish.body.data.body.sections[0].html, draft.body.sections[0].html);
  assert.equal(afterPublish.body.data.publicVersion, 2);
  assert.equal(published.publishedRevisionId, saved.headRevisionId);
  assert.equal((await request(null, `/wiki/resolve/${draft.aliases[0]}`)).body.data.slug, draft.slug);
  assert.ok((await request(null, `/wiki/pages?search=${encodeURIComponent(`WIK01-Draft-body-${suffix}`)}`)).body.data.some((item) => item.id === page.id));
  const publishedCategories = await request(null, '/wiki/categories');
  assert.ok(publishedCategories.body.data.some((item) => item.name === draft.categories[0]));
  assert.ok(!publishedCategories.body.data.some((item) => item.name === original.categories[0]));
});

test('WIK-02 staff-only and unpublished sentinels stay out of public resolution, search, categories and backlinks', async (t) => {
  const fixture = await makeFixture(t);
  const staff = await sessionFor(fixture.users.moderador.id);
  const suffix = token();
  const target = await createPublishedPage(fixture, staff, snapshot({
    title: `WIK02-Public-target-${suffix}`,
    slug: `wik02-target-${suffix}`,
    html: '<p>Public backlink target.</p>',
  }));

  const staffOnly = snapshot({
    title: `WIK02-Staff-title-${suffix}`,
    slug: `wik02-staff-${suffix}`,
    aliases: [`wik02-staff-alias-${suffix}`],
    summary: `WIK02-Staff-summary-${suffix}`,
    categories: [`WIK02 Staff Category ${suffix}`],
    accessLevel: 'staff',
    html: `<p>WIK02-Staff-body-${suffix}</p><a href="/wiki/${target.head.snapshot.slug}">Public target</a>`,
  });
  const privatePage = await createDraftPage(fixture, staff, staffOnly);
  await createHistoricalStaffPublication(privatePage, staffOnly);

  const unpublished = snapshot({
    title: `WIK02-Unpublished-title-${suffix}`,
    slug: `wik02-unpublished-${suffix}`,
    aliases: [`wik02-unpublished-alias-${suffix}`],
    summary: `WIK02-Unpublished-summary-${suffix}`,
    categories: [`WIK02 Unpublished Category ${suffix}`],
    html: `<p>WIK02-Unpublished-body-${suffix}</p><a href="/wiki/${target.head.snapshot.slug}">Public target</a>`,
  });
  const draftPage = await createDraftPage(fixture, staff, unpublished);

  const publicList = await request(null, '/wiki/pages');
  const listJson = JSON.stringify(publicList.body);
  assert.equal(publicList.status, 200);
  assert.ok(!publicList.body.data.some((item) => item.id === privatePage.id || item.id === draftPage.id));
  const privateSentinels = [
    staffOnly.title, staffOnly.slug, staffOnly.aliases[0], staffOnly.summary, `WIK02-Staff-body-${suffix}`,
    unpublished.title, unpublished.slug, unpublished.aliases[0], unpublished.summary, `WIK02-Unpublished-body-${suffix}`,
  ];
  assertAbsent(publicList.body, privateSentinels);
  for (const sentinel of privateSentinels) {
    const search = await request(null, `/wiki/pages?search=${encodeURIComponent(sentinel)}`);
    assert.equal(search.status, 200);
    assert.equal(search.body.data.length, 0, sentinel);
  }

  const categories = await request(null, '/wiki/categories');
  assert.doesNotMatch(JSON.stringify(categories.body), /WIK02 (?:Staff|Unpublished) Category/);
  for (const key of [staffOnly.slug, staffOnly.aliases[0], unpublished.slug, unpublished.aliases[0]]) {
    const resolution = await request(null, `/wiki/resolve/${key}`);
    assert.equal(resolution.status, 404, key);
  }
  assert.equal((await request(null, `/wiki/pages/${privatePage.id}`)).status, 404);
  assert.equal((await request(null, `/wiki/pages/${draftPage.id}`)).status, 404);

  const backlinks = await request(null, `/wiki/pages/${target.id}/backlinks`);
  assert.equal(backlinks.status, 200);
  assert.ok(!backlinks.body.data.some((item) => item.id === privatePage.id || item.id === draftPage.id));
  assertAbsent(backlinks.body, privateSentinels);
  assert.equal((await request(null, `/wiki/pages/${privatePage.id}/backlinks`)).status, 404);
});

test('WIK-03 normalized aliases and retained rename redirects resolve; name collisions conflict', async (t) => {
  const fixture = await makeFixture(t);
  const staff = await sessionFor(fixture.users.moderador.id);
  const suffix = token();
  const original = snapshot({
    title: `WIK03-Original-${suffix}`,
    slug: `wik03-original-${suffix}`,
    aliases: [`wik03-first-alias-${suffix}`],
  });
  const page = await createPublishedPage(fixture, staff, original);
  const renamed = snapshot({
    ...original,
    title: `WIK03-Renamed-${suffix}`,
    slug: `Órbita Nova ${suffix}`,
    aliases: [`Árvore Azul ${suffix}`],
  });
  const renamedDraft = await saveRevision(fixture, staff, page, renamed, page.workVersion);
  assert.equal(renamedDraft.head.snapshot.slug, `orbita-nova-${suffix}`);
  assert.equal(renamedDraft.head.snapshot.aliases[0], `arvore-azul-${suffix}`);
  assert.equal((await request(null, `/wiki/resolve/${renamedDraft.head.snapshot.slug}`)).status, 404);
  const renamedPage = await publishRevision(fixture, staff, renamedDraft, renamedDraft.headRevisionId, renamedDraft.workVersion, page.publishedRevisionId);

  for (const retained of [original.slug, original.aliases[0]]) {
    const resolution = await request(null, `/wiki/resolve/${retained}`);
    assert.equal(resolution.status, 200);
    assert.equal(resolution.body.data.id, page.id);
    assert.equal(resolution.body.data.slug, `orbita-nova-${suffix}`);
    assert.equal(resolution.body.data.redirect, true);
  }
  const normalizedAlias = await request(null, `/wiki/resolve/${encodeURIComponent(`Árvore Azul ${suffix}`)}`);
  assert.equal(normalizedAlias.status, 200);
  assert.equal(normalizedAlias.body.data.id, page.id);
  assert.equal(normalizedAlias.body.data.slug, `orbita-nova-${suffix}`);
  assert.equal(normalizedAlias.body.data.redirect, true);
  assert.equal(renamedPage.publishedRevisionId, renamedDraft.headRevisionId);
  const nameKinds = await sql`SELECT name_key, kind FROM wiki_names WHERE page_id = ${page.id} ORDER BY name_key`;
  const kinds = Object.fromEntries(nameKinds.map((row) => [row.name_key, row.kind]));
  assert.equal(kinds[original.slug], 'historical');
  assert.equal(kinds[original.aliases[0]], 'historical');
  assert.equal(kinds[`orbita-nova-${suffix}`], 'canonical');
  assert.equal(kinds[`arvore-azul-${suffix}`], 'alias');

  const ownerSnapshot = snapshot({ title: `WIK03-Name-owner-${suffix}`, slug: `wik03-reserved-${suffix}` });
  const owner = await createPublishedPage(fixture, staff, ownerSnapshot);
  const contenderSnapshot = snapshot({
    title: `WIK03-Name-contender-${suffix}`,
    slug: `wik03-contender-${suffix}`,
    aliases: [ownerSnapshot.slug],
  });
  const contender = await createDraftPage(fixture, staff, contenderSnapshot);
  const conflict = await request(staff, `/staff/wiki/pages/${contender.id}/publish`, {
    method: 'POST',
    body: {
      revisionId: contender.headRevisionId,
      expectedVersion: contender.workVersion,
      expectedPublishedRevisionId: null,
      summary: 'Synthetic collision attempt',
    },
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, 'WIKI_NAME_CONFLICT');
  assert.doesNotMatch(JSON.stringify(conflict.body), new RegExp(ownerSnapshot.title));
  const unchangedContender = await request(staff, `/staff/wiki/pages/${contender.id}`);
  assert.equal(unchangedContender.body.data.publishedRevisionId, null);
  const ownerResolution = await request(null, `/wiki/resolve/${ownerSnapshot.slug}`);
  assert.equal(ownerResolution.body.data.id, owner.id);

  const racingAlias = `wik03-racing-alias-${suffix}`;
  const racers = await Promise.all([
    createDraftPage(fixture, staff, snapshot({ title: `WIK03-Racer-A-${suffix}`, slug: `wik03-racer-a-${suffix}`, aliases: [racingAlias] })),
    createDraftPage(fixture, staff, snapshot({ title: `WIK03-Racer-B-${suffix}`, slug: `wik03-racer-b-${suffix}`, aliases: [racingAlias] })),
  ]);
  const barrier = createRequestBarrier(2);
  const attempts = await Promise.all(racers.map((racer) => request(staff, `/staff/wiki/pages/${racer.id}/publish`, {
    method: 'POST',
    barrier: barrier.key,
    body: {
      revisionId: racer.headRevisionId,
      expectedVersion: racer.workVersion,
      expectedPublishedRevisionId: null,
      summary: 'Synthetic simultaneous name claim',
    },
  })));
  assert.deepEqual(attempts.map((item) => item.status).sort(), [200, 409]);
  const rejected = attempts.find((item) => item.status === 409);
  assert.equal(rejected.body.code, 'WIKI_NAME_CONFLICT');
  const winner = attempts.find((item) => item.status === 200);
  const winnerId = racers[attempts.indexOf(winner)].id;
  assert.equal((await request(null, `/wiki/resolve/${racingAlias}`)).body.data.id, winnerId);
});

test('WIK-06 staff drafts require explicit public publication and create a cited public revision atomically', async (t) => {
  const fixture = await makeFixture(t);
  const moderator = await sessionFor(fixture.users.moderador.id);
  const admin = await sessionFor(fixture.users.admin.id);
  const member = await sessionFor(fixture.users.member.id);
  const suffix = token();
  for (const reservedSlug of ['equipe', 'rascunhos']) {
    const rejectedSlug = await request(moderator, '/staff/wiki/pages', {
      method: 'POST',
      key: randomUUID(),
      body: {
        snapshot: snapshot({ title: `WIK06-Reserved-${suffix}`, slug: reservedSlug }),
        summary: 'Synthetic reserved route slug',
      },
    });
    assert.equal(rejectedSlug.status, 400);
    assert.equal(rejectedSlug.body.code, 'INVALID_WIKI_SNAPSHOT');
  }
  const target = await createPublishedPage(fixture, moderator, snapshot({
    title: `WIK06-Public-target-${suffix}`,
    slug: `wik06-target-${suffix}`,
  }));

  const publicEdit = await saveRevision(fixture, moderator, target, snapshot({
    ...target.head.snapshot,
    title: `WIK06-Public-revision-${suffix}`,
  }), target.workVersion);
  const publicRevisionCountBeforePublish = await revisionCount(target.id);
  const publicRepublished = await publishRevision(
    fixture, moderator, publicEdit, publicEdit.headRevisionId, publicEdit.workVersion, target.publishedRevisionId,
  );
  assert.equal(publicRepublished.publishedRevisionId, publicEdit.headRevisionId);
  assert.equal(publicRepublished.workVersion, publicEdit.workVersion + 1);
  assert.equal(publicRepublished.publicVersion, target.publicVersion + 1);
  assert.equal(await revisionCount(target.id), publicRevisionCountBeforePublish);

  const sourceContent = `WIK06-Private-source-${suffix}`;
  const source = await makeWikiSource(fixture, fixture.users.moderador.id, sourceContent);
  const targetSectionId = target.head.snapshot.body.sections[0].id;
  const staffSnapshot = snapshot({
    title: `WIK06-Staff-draft-${suffix}`,
    slug: `wik06-staff-${suffix}`,
    aliases: [`wik06-private-alias-${suffix}`],
    categories: [`WIK06 Staff Category ${suffix}`],
    accessLevel: 'staff',
    html: `<p>WIK06 staff text.</p><a href="/wiki/${target.head.snapshot.slug}#${targetSectionId}">Public target</a>`,
  });
  const sectionId = staffSnapshot.body.sections[0].id;
  const citations = [
    { sectionId, sourceId: source.id, locator: 'synthetic line 1' },
    { sectionId, sourceId: source.id, locator: 'synthetic line 2' },
  ];
  const draft = await createDraftPage(fixture, moderator, staffSnapshot, citations);
  const initialRevisionCount = await revisionCount(draft.id);

  const sharedDraft = await request(admin, `/staff/wiki/pages/${draft.id}`);
  assert.equal(sharedDraft.status, 200, JSON.stringify(sharedDraft.body));
  assert.equal(sharedDraft.body.data.headRevisionId, draft.headRevisionId);
  assert.deepEqual(sharedDraft.body.data.head.citations, citations);

  const publishBody = {
    revisionId: draft.headRevisionId,
    expectedVersion: draft.workVersion,
    expectedPublishedRevisionId: null,
    summary: 'Synthetic public release',
  };
  const memberDenied = await request(member, `/staff/wiki/pages/${draft.id}/publish`, {
    method: 'POST', body: { ...publishBody, makePublic: true },
  });
  assert.equal(memberDenied.status, 403);

  const implicitPublish = await request(admin, `/staff/wiki/pages/${draft.id}/publish`, {
    method: 'POST', body: publishBody,
  });
  assert.equal(implicitPublish.status, 409);
  assert.equal(implicitPublish.body.code, 'DRAFT_NOT_PUBLIC');
  const rejectedState = await request(admin, `/staff/wiki/pages/${draft.id}`);
  assert.equal(rejectedState.body.data.headRevisionId, draft.headRevisionId);
  assert.equal(rejectedState.body.data.publishedRevisionId, null);
  assert.equal(rejectedState.body.data.workVersion, draft.workVersion);
  assert.equal(await revisionCount(draft.id), initialRevisionCount);
  assert.equal((await request(null, `/wiki/pages/${draft.id}`)).status, 404);

  const staffEditSnapshot = snapshot({
    ...staffSnapshot,
    title: `WIK06-Staff-revision-${suffix}`,
    slug: `wik06-staff-revision-${suffix}`,
  });
  const savedStaff = await saveRevision(fixture, moderator, draft, staffEditSnapshot, draft.workVersion);
  assert.deepEqual(savedStaff.head.citations, citations);
  const countBeforeStalePublish = await revisionCount(draft.id);
  const stalePublish = await request(admin, `/staff/wiki/pages/${draft.id}/publish`, {
    method: 'POST',
    body: {
      ...publishBody,
      revisionId: savedStaff.headRevisionId,
      makePublic: true,
    },
  });
  assert.equal(stalePublish.status, 409);
  assert.equal(stalePublish.body.code, 'STALE_VERSION');
  assert.equal(await revisionCount(draft.id), countBeforeStalePublish);

  const publicSummary = 'Synthetic explicit public conversion';
  const published = await publishRevision(
    fixture, admin, savedStaff, savedStaff.headRevisionId, savedStaff.workVersion, null,
    { makePublic: true, summary: publicSummary },
  );
  assert.notEqual(published.headRevisionId, savedStaff.headRevisionId);
  assert.equal(published.publishedRevisionId, published.headRevisionId);
  assert.equal(published.workVersion, savedStaff.workVersion + 1);
  assert.equal(published.publicVersion, savedStaff.publicVersion + 1);
  assert.equal(published.head.sequence, savedStaff.head.sequence + 1);
  assert.deepEqual(published.head.snapshot, { ...savedStaff.head.snapshot, accessLevel: 'public' });
  assert.deepEqual(published.head.citations, citations);
  assert.equal(await revisionCount(draft.id), countBeforeStalePublish + 1);
  const publishAudit = await sql`
    SELECT reason, after_state FROM audit_events
    WHERE target_id = ${draft.id} AND action = 'wiki.page.publish'
    ORDER BY created_at DESC LIMIT 1`;
  assert.equal(publishAudit.length, 1);
  assert.equal(publishAudit[0].reason, publicSummary);
  assert.equal(publishAudit[0].after_state.publishedRevisionId, published.publishedRevisionId);
  assert.equal(publishAudit[0].after_state.accessLevel, 'public');
  assert.equal(publishAudit[0].after_state.publicVersion, published.publicVersion);

  const oldRevision = await sql`SELECT snapshot FROM wiki_revisions WHERE id = ${savedStaff.headRevisionId}`;
  assert.equal(oldRevision.length, 1);
  assert.deepEqual(oldRevision[0].snapshot, savedStaff.head.snapshot);
  assert.equal(oldRevision[0].snapshot.accessLevel, 'staff');
  assert.deepEqual(await readCitationRows(published.headRevisionId), await readCitationRows(savedStaff.headRevisionId));
  assert.deepEqual(
    await categoryRows(published.headRevisionId),
    await categoryRows(savedStaff.headRevisionId),
  );
  assert.deepEqual(
    await linkRows(published.headRevisionId),
    [{ target_name_key: target.head.snapshot.slug, target_anchor: targetSectionId }],
  );

  const publicRead = await request(null, `/wiki/pages/${draft.id}`);
  assert.equal(publicRead.status, 200, JSON.stringify(publicRead.body));
  assert.equal(publicRead.body.data.title, staffEditSnapshot.title);
  assert.equal(publicRead.body.data.accessLevel, 'public');
  assertAbsent(publicRead.body, [sourceContent, source.id, 'synthetic line 1', 'synthetic line 2']);

  const collisionSnapshot = snapshot({
    title: `WIK06-Collision-draft-${suffix}`,
    slug: `wik06-collision-${suffix}`,
    aliases: [target.head.snapshot.slug],
    categories: [`WIK06 Collision Category ${suffix}`],
    accessLevel: 'staff',
    html: `<p>WIK06 collision draft.</p><a href="/wiki/${target.head.snapshot.slug}#${targetSectionId}">Public target</a>`,
  });
  const collisionSectionId = collisionSnapshot.body.sections[0].id;
  const collisionDraft = await createDraftPage(fixture, moderator, collisionSnapshot, [
    { sectionId: collisionSectionId, sourceId: source.id, locator: 'synthetic collision source' },
  ]);
  const collisionRevisionCount = await revisionCount(collisionDraft.id);
  const collision = await request(admin, `/staff/wiki/pages/${collisionDraft.id}/publish`, {
    method: 'POST',
    body: {
      revisionId: collisionDraft.headRevisionId,
      expectedVersion: collisionDraft.workVersion,
      expectedPublishedRevisionId: null,
      summary: 'Synthetic public name collision',
      makePublic: true,
    },
  });
  assert.equal(collision.status, 409);
  assert.equal(collision.body.code, 'WIKI_NAME_CONFLICT');
  assert.doesNotMatch(JSON.stringify(collision.body), new RegExp(target.head.snapshot.title));
  const unchangedCollision = await request(admin, `/staff/wiki/pages/${collisionDraft.id}`);
  assert.equal(unchangedCollision.body.data.headRevisionId, collisionDraft.headRevisionId);
  assert.equal(unchangedCollision.body.data.publishedRevisionId, null);
  assert.equal(unchangedCollision.body.data.workVersion, collisionDraft.workVersion);
  assert.equal(unchangedCollision.body.data.publicVersion, collisionDraft.publicVersion);
  assert.equal(await revisionCount(collisionDraft.id), collisionRevisionCount);
  assert.equal((await categoryRows(collisionDraft.headRevisionId)).length, 1);
  assert.equal((await linkRows(collisionDraft.headRevisionId)).length, 1);
  assert.equal((await readCitationRows(collisionDraft.headRevisionId)).length, 1);
  assert.equal((await sql`SELECT 1 FROM wiki_names WHERE name_key = ${collisionSnapshot.slug}`).length, 0);
});

test('WIK-04 stale writes conflict, revisions stay immutable, and restore creates a private draft', async (t) => {
  const fixture = await makeFixture(t);
  const staff = await sessionFor(fixture.users.moderador.id);
  const suffix = token();
  const original = snapshot({
    title: `WIK04-Published-A-${suffix}`,
    slug: `wik04-a-${suffix}`,
    summary: `WIK04-Published-summary-A-${suffix}`,
    html: `<p>WIK04-Published-body-A-${suffix}</p>`,
  });
  const page = await createPublishedPage(fixture, staff, original);
  const revisionB = snapshot({
    ...original,
    title: `WIK04-Draft-B-${suffix}`,
    slug: `wik04-b-${suffix}`,
    summary: `WIK04-Draft-summary-B-${suffix}`,
    html: `<p>WIK04-Draft-body-B-${suffix}</p>`,
  });
  const saved = await saveRevision(fixture, staff, page, revisionB, page.workVersion);

  const staleWrite = await request(staff, `/staff/wiki/pages/${page.id}/revisions`, {
    method: 'POST',
    body: { snapshot: snapshot({ ...revisionB, title: `WIK04-Stale-${suffix}` }), summary: 'Stale synthetic edit', expectedVersion: page.workVersion },
  });
  assert.equal(staleWrite.status, 409);
  assert.equal(staleWrite.body.code, 'STALE_VERSION');

  const stalePublish = await request(staff, `/staff/wiki/pages/${page.id}/publish`, {
    method: 'POST',
    body: {
      revisionId: saved.headRevisionId,
      expectedVersion: saved.workVersion,
      expectedPublishedRevisionId: null,
      summary: 'Stale synthetic publication',
    },
  });
  assert.equal(stalePublish.status, 409);
  assert.equal(stalePublish.body.code, 'STALE_PUBLICATION');

  const revisionBefore = await sql`SELECT snapshot FROM wiki_revisions WHERE id = ${saved.headRevisionId}`;
  assert.equal(revisionBefore.length, 1);
  const altered = { ...revisionBefore[0].snapshot, title: `WIK04-Illegal-change-${suffix}` };
  await assert.rejects(
    sql`UPDATE wiki_revisions SET snapshot = ${sql.json(altered)} WHERE id = ${saved.headRevisionId}`,
    (error) => error.code === '55000',
  );
  const revisionAfter = await sql`SELECT snapshot FROM wiki_revisions WHERE id = ${saved.headRevisionId}`;
  assert.deepEqual(revisionAfter[0].snapshot, revisionBefore[0].snapshot);

  const restored = await request(staff, `/staff/wiki/pages/${page.id}/restore-revision`, {
    method: 'POST',
    body: {
      oldRevisionId: page.publishedRevisionId,
      expectedVersion: saved.workVersion,
      summary: 'Synthetic restoration from published revision A',
    },
  });
  assert.equal(restored.status, 200, JSON.stringify(restored.body));
  assert.notEqual(restored.body.data.headRevisionId, page.publishedRevisionId);
  assert.notEqual(restored.body.data.headRevisionId, saved.headRevisionId);
  assert.equal(restored.body.data.head.restoresId, page.publishedRevisionId);
  assert.deepEqual(restored.body.data.head.snapshot, original);
  assert.equal(restored.body.data.publishedRevisionId, page.publishedRevisionId);
  assert.equal(restored.body.data.publicVersion, page.publicVersion);
  const publicAfterRestore = await request(null, `/wiki/pages/${page.id}`);
  assert.equal(publicAfterRestore.status, 200);
  assert.equal(publicAfterRestore.body.data.title, original.title);
  assert.equal(publicAfterRestore.body.data.body.sections[0].html, original.body.sections[0].html);
});

test('WIK-05 backlinks and search follow visible published revisions and conceal restricted targets', async (t) => {
  const fixture = await makeFixture(t);
  const staff = await sessionFor(fixture.users.moderador.id);
  const suffix = token();
  const target = await createPublishedPage(fixture, staff, snapshot({
    title: `WIK05-Public-target-${suffix}`,
    slug: `wik05-public-target-${suffix}`,
  }));

  const visibleSourceSnapshot = snapshot({
    title: `WIK05-Visible-source-${suffix}`,
    slug: `wik05-visible-source-${suffix}`,
    summary: `WIK05-Published-search-${suffix}`,
    html: `<p>WIK05-Published-body-${suffix}</p><a href="/wiki/${target.head.snapshot.slug}">Public target</a>`,
  });
  const visibleSource = await createPublishedPage(fixture, staff, visibleSourceSnapshot);
  const visibleHeadDraft = snapshot({
    ...visibleSourceSnapshot,
    title: `WIK05-Head-draft-${suffix}`,
    slug: `wik05-visible-source-draft-${suffix}`,
    summary: `WIK05-Head-search-${suffix}`,
    html: `<p>WIK05-Head-body-${suffix}</p>`,
  });
  await saveRevision(fixture, staff, visibleSource, visibleHeadDraft, visibleSource.workVersion);

  const draftOnlySourceSnapshot = snapshot({
    title: `WIK05-Draft-only-source-${suffix}`,
    slug: `wik05-draft-only-source-${suffix}`,
    html: '<p>No published link to the public target.</p>',
  });
  const draftOnlySource = await createPublishedPage(fixture, staff, draftOnlySourceSnapshot);
  const draftOnlyHead = snapshot({
    ...draftOnlySourceSnapshot,
    title: `WIK05-Draft-only-head-${suffix}`,
    slug: `wik05-draft-only-head-${suffix}`,
    html: `<p>Draft-only backlink.</p><a href="/wiki/${target.head.snapshot.slug}">Public target</a>`,
  });
  await saveRevision(fixture, staff, draftOnlySource, draftOnlyHead, draftOnlySource.workVersion);

  const staffSourceSnapshot = snapshot({
    title: `WIK05-Staff-source-${suffix}`,
    slug: `wik05-staff-source-${suffix}`,
    accessLevel: 'staff',
    html: `<p>Private published source.</p><a href="/wiki/${target.head.snapshot.slug}">Public target</a>`,
  });
  const staffSource = await createDraftPage(fixture, staff, staffSourceSnapshot);
  await createHistoricalStaffPublication(staffSource, staffSourceSnapshot);
  const unpublishedSource = await createDraftPage(fixture, staff, snapshot({
    title: `WIK05-Unpublished-source-${suffix}`,
    slug: `wik05-unpublished-source-${suffix}`,
    html: `<p>Private unpublished source.</p><a href="/wiki/${target.head.snapshot.slug}">Public target</a>`,
  }));

  const backlinks = await request(null, `/wiki/pages/${target.id}/backlinks`);
  assert.equal(backlinks.status, 200);
  const backlinkIds = backlinks.body.data.map((item) => item.id);
  assert.ok(backlinkIds.includes(visibleSource.id));
  assert.ok(!backlinkIds.includes(draftOnlySource.id));
  assert.ok(!backlinkIds.includes(staffSource.id));
  assert.ok(!backlinkIds.includes(unpublishedSource.id));

  const publishedSearch = await request(null, `/wiki/pages?search=${encodeURIComponent(`WIK05-Published-search-${suffix}`)}`);
  assert.ok(publishedSearch.body.data.some((item) => item.id === visibleSource.id));
  const headTitleSearch = await request(null, `/wiki/pages?search=${encodeURIComponent(visibleHeadDraft.title)}`);
  assert.equal(headTitleSearch.body.data.length, 0);
  const headSearch = await request(null, `/wiki/pages?search=${encodeURIComponent(`WIK05-Head-search-${suffix}`)}`);
  assert.equal(headSearch.body.data.length, 0);
  const headBodySearch = await request(null, `/wiki/pages?search=${encodeURIComponent(`WIK05-Head-body-${suffix}`)}`);
  assert.equal(headBodySearch.body.data.length, 0);

  const privateTargetSnapshot = snapshot({
    title: `WIK05-Restricted-target-${suffix}`,
    slug: `wik05-restricted-target-${suffix}`,
    aliases: [`wik05-restricted-alias-${suffix}`],
    accessLevel: 'staff',
    html: `<p>WIK05-Restricted-body-${suffix}</p>`,
  });
  const privateTarget = await createDraftPage(fixture, staff, privateTargetSnapshot);
  await createHistoricalStaffPublication(privateTarget, privateTargetSnapshot);
  await createPublishedPage(fixture, staff, snapshot({
    title: `WIK05-Visible-link-to-private-${suffix}`,
    slug: `wik05-visible-private-link-${suffix}`,
    html: `<p>A synthetic unresolved reference.</p><a href="/wiki/${privateTargetSnapshot.slug}">Restricted destination</a>`,
  }));

  const restrictedResolve = await request(null, `/wiki/resolve/${privateTargetSnapshot.slug}`);
  const missingResolve = await request(null, `/wiki/resolve/wik05-absent-${suffix}`);
  assert.equal(restrictedResolve.status, 404);
  assert.equal(missingResolve.status, 404);
  assert.equal(restrictedResolve.body.code, missingResolve.body.code);
  assert.doesNotMatch(JSON.stringify(restrictedResolve.body), new RegExp(privateTargetSnapshot.title));
  const privateBacklinks = await request(null, `/wiki/pages/${privateTarget.id}/backlinks`);
  const absentBacklinks = await request(null, `/wiki/pages/${randomUUID()}/backlinks`);
  assert.equal(privateBacklinks.status, 404);
  assert.equal(absentBacklinks.status, 404);
  assert.equal(privateBacklinks.body.code, absentBacklinks.body.code);
});

test('M6 staff can link a public discussion while members and quarantined discussions remain denied', async (t) => {
  const fixture = await makeFixture(t);
  const staff = await sessionFor(fixture.users.moderador.id);
  const member = await sessionFor(fixture.users.member.id);
  const page = await createPublishedPage(fixture, staff, snapshot({
    title: `M6-Discussion-${token()}`,
    slug: `m6-discussion-${token()}`,
  }));
  const publicThreadId = await createForumThread(fixture, fixture.users.member.id, 'M6 public discussion');
  const quarantinedThreadId = await createForumThread(fixture, fixture.users.member.id, 'M6 quarantined discussion', true);

  const initial = await request(null, `/wiki/pages/${page.id}`);
  assert.equal(initial.status, 200);
  assert.equal(initial.body.data.discussionThreadId, null);
  assert.ok(initial.etag);

  const denied = await request(member, `/staff/wiki/pages/${page.id}/discussion`, {
    method: 'PATCH', body: { threadId: publicThreadId, expectedVersion: page.workVersion },
  });
  assert.equal(denied.status, 403);

  const missing = await request(staff, `/staff/wiki/pages/${page.id}/discussion`, {
    method: 'PATCH', body: { threadId: randomUUID(), expectedVersion: page.workVersion },
  });
  assert.equal(missing.status, 404);
  const quarantined = await request(staff, `/staff/wiki/pages/${page.id}/discussion`, {
    method: 'PATCH', body: { threadId: quarantinedThreadId, expectedVersion: page.workVersion },
  });
  assert.equal(quarantined.status, 404);

  const linked = await request(staff, `/staff/wiki/pages/${page.id}/discussion`, {
    method: 'PATCH', body: { threadId: publicThreadId, expectedVersion: page.workVersion },
  });
  assert.equal(linked.status, 200, JSON.stringify(linked.body));
  assert.equal(linked.body.data.discussionThreadId, publicThreadId);
  assert.equal(linked.body.data.workVersion, page.workVersion + 1);
  assert.notEqual(linked.body.data.publicVersion, initial.body.data.publicVersion);
  const publicRead = await request(null, `/wiki/pages/${page.id}`, { ifNoneMatch: initial.etag });
  assert.equal(publicRead.status, 200);
  assert.equal(publicRead.body.data.discussionThreadId, publicThreadId);
  assert.notEqual(publicRead.etag, initial.etag);
  const freshRead = await request(null, `/wiki/pages/${page.id}`, { ifNoneMatch: publicRead.etag });
  assert.equal(freshRead.status, 304);

  const unlinked = await request(staff, `/staff/wiki/pages/${page.id}/discussion`, {
    method: 'PATCH', body: { threadId: null, expectedVersion: linked.body.data.workVersion },
  });
  assert.equal(unlinked.status, 200, JSON.stringify(unlinked.body));
  assert.equal(unlinked.body.data.discussionThreadId, null);
  assert.notEqual(unlinked.body.data.publicVersion, linked.body.data.publicVersion);
  const unlinkedRead = await request(null, `/wiki/pages/${page.id}`, { ifNoneMatch: publicRead.etag });
  assert.equal(unlinkedRead.status, 200);
  assert.equal(unlinkedRead.body.data.discussionThreadId, null);
  assert.notEqual(unlinkedRead.etag, publicRead.etag);
});

async function makeFixture(t) {
  const fixture = { users: {}, pageIds: [], sourceIds: [], forumThreadIds: [], forumCategoryIds: [] };
  t.after(async () => cleanFixture(fixture));
  const suffix = token();
  for (const role of ['admin', 'moderador', 'member']) {
    const username = `wiki-${role}-${suffix}`;
    const rows = await sql`
      INSERT INTO users (username, email, password_hash, role)
      VALUES (${username}, ${`${username}@example.test`}, 'test-only-hash', ${role})
      RETURNING id`;
    fixture.users[role] = { id: rows[0].id, role, username };
  }
  return fixture;
}

async function createForumThread(fixture, authorId, title, quarantined = false) {
  const suffix = token();
  const categoryRows = await sql`
    INSERT INTO categories (name, description)
    VALUES (${`M6 test ${suffix}`}, 'Synthetic integration fixture')
    RETURNING id`;
  const categoryId = categoryRows[0].id;
  fixture.forumCategoryIds.push(categoryId);
  const threadRows = await sql`
    INSERT INTO threads (category_id, author_id, title, quarantined_at, quarantine_reason)
    VALUES (${categoryId}, ${authorId}, ${`${title} ${suffix}`}, ${quarantined ? sql`now()` : null}, ${quarantined ? 'test-quarantine' : null})
    RETURNING id`;
  const threadId = threadRows[0].id;
  fixture.forumThreadIds.push(threadId);
  await sql`
    INSERT INTO posts (thread_id, author_id, content, post_no)
    VALUES (${threadId}, ${authorId}, 'Synthetic discussion opener.', 1)`;
  return threadId;
}

async function makeWikiSource(fixture, importedBy, content) {
  const archiveSha256 = createHash('sha256').update(`archive-${randomUUID()}`).digest('hex');
  const fileSha256 = createHash('sha256').update(content).digest('hex');
  const rows = await sql`
    INSERT INTO wiki_sources
      (archive_sha256, relative_path, file_sha256, family, language, content, imported_by)
    VALUES (${archiveSha256}, ${`synthetic/${randomUUID()}.txt`}, ${fileSha256},
      'Synthetic citation fixture', 'en', ${content}, ${importedBy})
    RETURNING id`;
  const id = String(rows[0].id).toLowerCase();
  fixture.sourceIds.push(id);
  return { id };
}

async function createDraftPage(fixture, session, value, citations) {
  const body = { snapshot: value, summary: 'Synthetic integration fixture draft' };
  if (citations !== undefined) body.citations = citations;
  const response = await request(session, '/staff/wiki/pages', {
    method: 'POST', body,
    key: randomUUID(),
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  const page = response.body.data;
  fixture.pageIds.push(page.id);
  return page;
}

async function createHistoricalStaffPublication(page, value) {
  await sql.begin(async (tx) => {
    await tx`
      UPDATE wiki_pages SET published_revision_id = head_revision_id, access_level = 'staff',
        published_at = now(), public_version = 1
      WHERE id = ${page.id}`;
    const names = [
      { name_key: value.slug, kind: 'canonical' },
      ...value.aliases.map((name_key) => ({ name_key, kind: 'alias' })),
    ];
    if (names.length) {
      await tx`
        INSERT INTO wiki_names (name_key, page_id, kind)
        VALUES ${tx(names.map((name) => [name.name_key, page.id, name.kind]))}`;
    }
  });
}

async function createPublishedPage(fixture, session, value) {
  const draft = await createDraftPage(fixture, session, value);
  return publishRevision(fixture, session, draft, draft.headRevisionId, draft.workVersion, null);
}

async function saveRevision(fixture, session, page, value, expectedVersion) {
  const response = await request(session, `/staff/wiki/pages/${page.id}/revisions`, {
    method: 'POST',
    body: { snapshot: value, summary: 'Synthetic integration fixture revision', expectedVersion },
  });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body.data;
}

async function publishRevision(_fixture, session, page, revisionId, expectedVersion, expectedPublishedRevisionId, options = {}) {
  const response = await request(session, `/staff/wiki/pages/${page.id}/publish`, {
    method: 'POST',
    body: {
      revisionId,
      expectedVersion,
      expectedPublishedRevisionId,
      summary: 'Synthetic integration fixture publication',
      ...options,
    },
  });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body.data;
}

function snapshot({
  title = `Synthetic title ${token()}`,
  slug = `synthetic-${token()}`,
  aliases = [],
  summary = 'Synthetic integration summary.',
  categories = [],
  accessLevel = 'public',
  body: previousBody,
  html = previousBody?.sections?.[0]?.html || '<p>Synthetic integration body.</p>',
} = {}) {
  const previousSection = previousBody?.sections?.[0];
  return {
    schemaVersion: 1,
    title,
    slug,
    aliases,
    type: 'concept',
    summary,
    categories,
    accessLevel,
    audience: 'reader',
    body: {
      format: 'richtext-v1',
      infobox: previousBody?.infobox || [],
      sections: [{
        id: previousSection?.id || randomUUID(),
        heading: previousSection?.heading || 'Synthetic section',
        html,
        blocks: [],
        authority: [],
        knowledgeLayer: 'unspecified',
      }],
    },
  };
}

function token() {
  return randomUUID().replaceAll('-', '').slice(0, 12).toLowerCase();
}

function assertAbsent(value, sentinels) {
  const text = JSON.stringify(value);
  for (const sentinel of sentinels) assert.ok(!text.includes(sentinel), `Unexpected public sentinel: ${sentinel}`);
}

async function revisionCount(pageId) {
  return Number((await sql`SELECT count(*)::integer AS count FROM wiki_revisions WHERE page_id = ${pageId}`)[0].count);
}

async function readCitationRows(revisionId) {
  const rows = await sql`
    SELECT section_id, source_id, locator FROM wiki_revision_citations
    WHERE revision_id = ${revisionId}
    ORDER BY section_id ASC, source_id ASC, locator ASC`;
  return rows.map((row) => ({
    section_id: String(row.section_id).toLowerCase(),
    source_id: String(row.source_id).toLowerCase(),
    locator: row.locator,
  }));
}

async function categoryRows(revisionId) {
  return Array.from(await sql`
    SELECT category, category_key FROM wiki_revision_categories
    WHERE revision_id = ${revisionId} ORDER BY category_key`);
}

async function linkRows(revisionId) {
  return Array.from(await sql`
    SELECT target_name_key, target_anchor FROM wiki_revision_links
    WHERE revision_id = ${revisionId} ORDER BY target_name_key, target_anchor`);
}

function createRequestBarrier(parties) {
  const key = randomUUID();
  requestBarriers.set(key, { parties, arrived: 0, waiters: [] });
  return { key };
}

async function cleanFixture(fixture) {
  await sql.begin(async (tx) => {
    await tx`ALTER TABLE wiki_revisions DISABLE TRIGGER wiki_revisions_immutable`;
    for (const user of Object.values(fixture.users)) {
      await tx`DELETE FROM request_keys WHERE actor_id = ${user.id}`;
      await tx`DELETE FROM audit_events WHERE actor_id = ${user.id}`;
    }
    for (const pageId of fixture.pageIds) {
      await tx`DELETE FROM audit_events WHERE target_id = ${pageId}`;
      await tx`DELETE FROM wiki_revision_categories WHERE revision_id IN (SELECT id FROM wiki_revisions WHERE page_id = ${pageId})`;
      await tx`DELETE FROM wiki_revision_links WHERE revision_id IN (SELECT id FROM wiki_revisions WHERE page_id = ${pageId})`;
      await tx`DELETE FROM wiki_revision_citations WHERE revision_id IN (SELECT id FROM wiki_revisions WHERE page_id = ${pageId})`;
      await tx`UPDATE wiki_pages SET head_revision_id = NULL, published_revision_id = NULL WHERE id = ${pageId}`;
      const revisions = await tx`SELECT id FROM wiki_revisions WHERE page_id = ${pageId} ORDER BY sequence DESC`;
      for (const revision of revisions) await tx`DELETE FROM wiki_revisions WHERE id = ${revision.id}`;
      await tx`DELETE FROM wiki_names WHERE page_id = ${pageId}`;
      await tx`DELETE FROM wiki_pages WHERE id = ${pageId}`;
    }
    if (fixture.sourceIds.length) await tx`DELETE FROM wiki_sources WHERE id = ANY(${tx.array(fixture.sourceIds, 2950)})`;
    await tx`ALTER TABLE wiki_revisions ENABLE TRIGGER wiki_revisions_immutable`;
    if (fixture.forumThreadIds.length) {
      await tx`UPDATE wiki_pages SET discussion_thread_id = NULL WHERE discussion_thread_id = ANY(${fixture.forumThreadIds}::uuid[])`;
      await tx`DELETE FROM posts WHERE thread_id = ANY(${fixture.forumThreadIds}::uuid[])`;
      await tx`DELETE FROM threads WHERE id = ANY(${fixture.forumThreadIds}::uuid[])`;
    }
    if (fixture.forumCategoryIds.length) {
      await tx`DELETE FROM categories WHERE id = ANY(${fixture.forumCategoryIds}::uuid[])`;
    }
    for (const user of Object.values(fixture.users)) await tx`DELETE FROM users WHERE id = ${user.id}`;
  });
}

async function sessionFor(userId) {
  const response = await fetch(`${baseUrl}/__fixture/session/${userId}`);
  assert.equal(response.status, 200);
  const cookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie') || ''];
  return {
    cookie: cookies.map((value) => value.split(';', 1)[0]).filter(Boolean).join('; '),
    csrfToken: (await response.json()).csrfToken,
  };
}

async function request(session, route, { method = 'GET', body, key, barrier, ifNoneMatch } = {}) {
  const headers = {};
  if (session) {
    headers.cookie = session.cookie;
    headers['x-csrf-token'] = session.csrfToken;
  }
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (key) headers['idempotency-key'] = key;
  if (barrier) headers['x-test-wiki-barrier'] = barrier;
  if (ifNoneMatch) headers['if-none-match'] = ifNoneMatch;
  const response = await fetch(`${baseUrl}/api${route}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: response.status === 304 ? null : await response.json(), etag: response.headers.get('etag') };
}


test('WIK-07 an existing legacy staff publication can become public without mutating its snapshot', async (t) => {
  const fixture = await makeFixture(t);
  const staff = await sessionFor(fixture.users.admin.id);
  const value = snapshot({ title: 'Legacy staff ' + token(), slug: 'legacy-staff-' + token(), accessLevel: 'staff' });
  const draft = await createDraftPage(fixture, staff, value);
  await createHistoricalStaffPublication(draft, value);
  const current = (await request(staff, `/staff/wiki/pages/${draft.id}`)).body.data;
  assert.equal(current.publishedRevisionId, current.headRevisionId);
  const result = await publishRevision(fixture, staff, current, current.headRevisionId, current.workVersion, current.publishedRevisionId, { makePublic: true });
  assert.equal(result.accessLevel, 'public');
  assert.notEqual(result.publishedRevisionId, current.publishedRevisionId);
  const [old] = await sql`SELECT snapshot FROM wiki_revisions WHERE id = ${current.headRevisionId}`;
  assert.equal(old.snapshot.accessLevel, 'staff');
  assert.equal((await request(null, `/wiki/pages/${draft.id}`)).status, 200);
});
