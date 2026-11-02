'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const express = require('express');
const cookieSession = require('cookie-session');
const postgres = require('postgres');
const { createAuth, createCookieSessionOptions } = require('../../server/auth');
const { errorMiddleware } = require('../../server/errors');
const { createProposalRouter } = require('../../server/proposals');
const { createWikiRouter } = require('../../server/wiki');

const ROOT = path.resolve(__dirname, '../..');
const testDatabaseUrl = process.env.ETERVERSO_TEST_DATABASE_URL;

let sql;
let server;
let baseUrl;
let auth;

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

  const config = { sessionSecret: `proposal-tests-${randomUUID()}`, secureCookies: false };
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
  app.use('/api', createWikiRouter({ sql, auth }));
  app.use('/api', createProposalRouter({ sql, auth }));
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

test('PRO-01 proposal is idempotent and private; staff acceptance creates a credited unpublished draft', async (t) => {
  const fixture = await makeFixture(t, ['admin', 'member', 'member', 'moderador']);
  const page = await createPublishedPage(fixture, fixture.users.admin, 'Public proposal fixture');
  const proposerSession = await sessionFor(fixture.users.member1.id);
  const otherSession = await sessionFor(fixture.users.member2.id);
  const moderatorSession = await sessionFor(fixture.users.moderador.id);
  const candidate = snapshot('Synthetic proposal draft', 'synthetic-proposal-draft', '<p>Candidate text <script>unsafe()</script>.</p>');
  const body = {
    snapshot: candidate,
    basePublishedRevisionId: page.revisionId,
    summary: 'Synthetic contributor correction',
  };
  const key = randomUUID();

  const [created, concurrentRetry] = await Promise.all([
    request(proposerSession, `/wiki/pages/${page.id}/proposals`, { method: 'POST', body, key }),
    request(proposerSession, `/wiki/pages/${page.id}/proposals`, { method: 'POST', body, key }),
  ]);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(concurrentRetry.status, 201, JSON.stringify(concurrentRetry.body));
  const proposal = created.body.data;
  fixture.proposalIds.push(proposal.id);
  assert.equal(concurrentRetry.body.data.id, proposal.id);
  assert.equal(proposal.state, 'submitted');
  assert.equal(proposal.version, 1);
  assert.equal(proposal.proposer.id, fixture.users.member1.id);
  assert.equal(proposal.basePublishedRevisionId, page.revisionId);
  assert.equal(proposal.stale, false);
  assert.doesNotMatch(proposal.snapshot.body.sections[0].html, /script|unsafe\(\)/i);

  const replay = await request(proposerSession, `/wiki/pages/${page.id}/proposals`, {
    method: 'POST', body, key,
  });
  assert.equal(replay.status, 201, JSON.stringify(replay.body));
  assert.equal(replay.body.data.id, proposal.id);
  const keyConflict = await request(proposerSession, `/wiki/pages/${page.id}/proposals`, {
    method: 'POST', body: { ...body, summary: 'Changed synthetic request' }, key,
  });
  assert.equal(keyConflict.status, 409);
  assert.equal(keyConflict.body.code, 'IDEMPOTENCY_CONFLICT');

  const ownList = await request(proposerSession, '/wiki/proposals');
  assert.equal(ownList.status, 200);
  assert.equal(ownList.body.data.length, 1);
  assert.equal(ownList.body.data[0].id, proposal.id);
  const otherList = await request(otherSession, '/wiki/proposals');
  assert.equal(otherList.status, 200);
  assert.equal(otherList.body.data.length, 0);
  const otherRead = await request(otherSession, `/wiki/proposals/${proposal.id}`);
  assert.equal(otherRead.status, 404);
  assert.equal(otherRead.body.code, 'NOT_FOUND');
  const otherWithdraw = await request(otherSession, `/wiki/proposals/${proposal.id}/withdraw`, {
    method: 'POST', body: { expectedVersion: 1 },
  });
  assert.equal(otherWithdraw.status, 404);

  const staffQueue = await request(moderatorSession, '/staff/wiki/proposals');
  assert.equal(staffQueue.status, 200);
  assert.equal(staffQueue.body.data.length, 1);
  assert.equal(staffQueue.body.data[0].baseSnapshot.title, page.snapshot.title);
  assert.equal(staffQueue.body.data[0].proposer.id, fixture.users.member1.id);
  const forbiddenQueue = await request(otherSession, '/staff/wiki/proposals');
  assert.equal(forbiddenQueue.status, 403);

  const accepted = await request(moderatorSession, `/staff/wiki/proposals/${proposal.id}/accept`, {
    method: 'POST',
    body: {
      expectedVersion: 1,
      expectedWorkVersion: 1,
      expectedPublishedRevisionId: page.revisionId,
    },
  });
  assert.equal(accepted.status, 201, JSON.stringify(accepted.body));
  assert.equal(accepted.body.data.proposal.state, 'accepted');
  assert.equal(accepted.body.data.proposal.version, 2);
  assert.equal(accepted.body.data.revision.actor.id, fixture.users.moderador.id);
  assert.equal(accepted.body.data.revision.proposer.id, fixture.users.member1.id);
  assert.equal(accepted.body.data.revision.acceptedProposalId, proposal.id);
  assert.equal(accepted.body.data.revision.parentRevisionId, page.revisionId);
  assert.equal(accepted.body.data.page.publishedRevisionId, page.revisionId);
  assert.equal(accepted.body.data.page.workVersion, 2);
  assert.equal(accepted.body.data.page.publicVersion, 1);

  const storedPage = await sql`
    SELECT head_revision_id, published_revision_id, work_version, public_version
    FROM wiki_pages WHERE id = ${page.id}`;
  assert.equal(storedPage[0].head_revision_id, accepted.body.data.revision.id);
  assert.equal(storedPage[0].published_revision_id, page.revisionId);
  assert.equal(Number(storedPage[0].work_version), 2);
  assert.equal(Number(storedPage[0].public_version), 1);
  const storedRevision = await sql`
    SELECT actor_id, accepted_proposal_id, snapshot FROM wiki_revisions
    WHERE id = ${accepted.body.data.revision.id} AND page_id = ${page.id}`;
  fixture.revisionIds.push(accepted.body.data.revision.id);
  assert.equal(storedRevision[0].actor_id, fixture.users.moderador.id);
  assert.equal(storedRevision[0].accepted_proposal_id, proposal.id);
  assert.deepEqual(storedRevision[0].snapshot, proposal.snapshot);
  const publicPage = await request(null, `/wiki/pages/${page.id}`);
  assert.equal(publicPage.status, 200);
  assert.equal(publicPage.body.data.title, page.snapshot.title);
  assert.doesNotMatch(JSON.stringify(publicPage.body), /Candidate text|Synthetic proposal draft/);

  const audit = await sql`
    SELECT action FROM audit_events WHERE target_id = ${proposal.id} ORDER BY action`;
  assert.deepEqual(audit.map((row) => row.action), ['wiki.proposal.accept', 'wiki.proposal.submit']);
});

test('proposer withdrawal and staff rejection are versioned terminal decisions', async (t) => {
  const fixture = await makeFixture(t, ['admin', 'member', 'member', 'moderador']);
  const page = await createPublishedPage(fixture, fixture.users.admin, 'Terminal-state fixture');
  const proposerSession = await sessionFor(fixture.users.member1.id);
  const otherSession = await sessionFor(fixture.users.member2.id);
  const moderatorSession = await sessionFor(fixture.users.moderador.id);

  const first = await submitProposal(fixture, page, proposerSession, snapshot('Withdrawn candidate', 'withdrawn-candidate', '<p>Withdraw fixture.</p>'));
  const missingVersion = await request(proposerSession, `/wiki/proposals/${first.id}/withdraw`, { method: 'POST', body: {} });
  assert.equal(missingVersion.status, 428);
  assert.equal(missingVersion.body.code, 'PRECONDITION_REQUIRED');
  const withdrawn = await request(proposerSession, `/wiki/proposals/${first.id}/withdraw`, {
    method: 'POST', body: { expectedVersion: 1 },
  });
  assert.equal(withdrawn.status, 200);
  assert.equal(withdrawn.body.data.state, 'withdrawn');
  assert.equal(withdrawn.body.data.version, 2);

  const revised = await submitProposal(fixture, page, proposerSession, snapshot('Revised candidate', 'revised-candidate', '<p>Revised fixture.</p>'), {
    previousProposalId: first.id,
  });
  assert.equal(revised.previousProposalId, first.id);
  const rejectedMissingVersion = await request(moderatorSession, `/staff/wiki/proposals/${revised.id}/reject`, {
    method: 'POST', body: { reason: 'Synthetic reason' },
  });
  assert.equal(rejectedMissingVersion.status, 428);
  const rejected = await request(moderatorSession, `/staff/wiki/proposals/${revised.id}/reject`, {
    method: 'POST', body: { expectedVersion: 1, reason: 'Synthetic editorial reason.' },
  });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.body.data.state, 'rejected');
  assert.equal(rejected.body.data.version, 2);
  assert.equal(rejected.body.data.reviewReason, 'Synthetic editorial reason.');

  for (const [proposalId, version] of [[first.id, 2], [revised.id, 2]]) {
    const terminalAccept = await request(moderatorSession, `/staff/wiki/proposals/${proposalId}/accept`, {
      method: 'POST', body: {
        expectedVersion: version,
        expectedWorkVersion: 1,
        expectedPublishedRevisionId: page.revisionId,
      },
    });
    assert.equal(terminalAccept.status, 409);
    assert.equal(terminalAccept.body.code, 'PROPOSAL_NOT_SUBMITTED');
  }

  const memberReject = await request(otherSession, `/staff/wiki/proposals/${revised.id}/reject`, {
    method: 'POST', body: { expectedVersion: 1, reason: 'Should be forbidden' },
  });
  assert.equal(memberReject.status, 403);
  const ownerDetails = await request(proposerSession, `/wiki/proposals/${revised.id}`);
  assert.equal(ownerDetails.status, 200);
  assert.equal(ownerDetails.body.data.reviewReason, 'Synthetic editorial reason.');

  await sql`UPDATE wiki_pages SET archived_at = now(), access_level = 'staff' WHERE id = ${page.id}`;
  const inaccessibleList = await request(proposerSession, '/wiki/proposals');
  assert.equal(inaccessibleList.status, 200);
  assert.equal(inaccessibleList.body.data.length, 0);
  const inaccessibleRead = await request(proposerSession, `/wiki/proposals/${revised.id}`);
  assert.equal(inaccessibleRead.status, 404);
  const staffRead = await request(moderatorSession, `/staff/wiki/proposals/${revised.id}`);
  assert.equal(staffRead.status, 200);
});

test('acceptance rejects stale publication bases, existing staff drafts, and stale work versions', async (t) => {
  const fixture = await makeFixture(t, ['admin', 'member', 'moderador']);
  const stalePage = await createPublishedPage(fixture, fixture.users.admin, 'Stale-base fixture');
  const draftPage = await createPublishedPage(fixture, fixture.users.admin, 'Staff-draft fixture');
  const versionPage = await createPublishedPage(fixture, fixture.users.admin, 'Work-version fixture');
  const memberSession = await sessionFor(fixture.users.member1.id);
  const moderatorSession = await sessionFor(fixture.users.moderador.id);

  const staleProposal = await submitProposal(fixture, stalePage, memberSession, snapshot('Stale proposal', 'stale-proposal', '<p>Stale base content.</p>'));
  const newerPublished = await addRevision(fixture, stalePage, fixture.users.admin, snapshot('New publication', 'new-publication', '<p>New published content.</p>'), {
    publish: true,
  });
  const staleAccepted = await request(moderatorSession, `/staff/wiki/proposals/${staleProposal.id}/accept`, {
    method: 'POST', body: {
      expectedVersion: 1,
      expectedWorkVersion: 2,
      expectedPublishedRevisionId: newerPublished.id,
    },
  });
  assert.equal(staleAccepted.status, 409);
  assert.equal(staleAccepted.body.code, 'STALE_PROPOSAL_BASE');

  const draftProposal = await submitProposal(fixture, draftPage, memberSession, snapshot('Manual merge needed', 'manual-merge-needed', '<p>Staff draft conflict.</p>'));
  await addRevision(fixture, draftPage, fixture.users.admin, snapshot('Existing team draft', 'existing-team-draft', '<p>Existing work.</p>'), {
    publish: false,
  });
  const draftAccepted = await request(moderatorSession, `/staff/wiki/proposals/${draftProposal.id}/accept`, {
    method: 'POST', body: {
      expectedVersion: 1,
      expectedWorkVersion: 2,
      expectedPublishedRevisionId: draftPage.revisionId,
    },
  });
  assert.equal(draftAccepted.status, 409);
  assert.equal(draftAccepted.body.code, 'STAFF_DRAFT_EXISTS');

  const versionProposal = await submitProposal(fixture, versionPage, memberSession, snapshot('Version conflict', 'version-conflict', '<p>Version fixture.</p>'));
  await sql`UPDATE wiki_pages SET work_version = 2 WHERE id = ${versionPage.id}`;
  const versionConflict = await request(moderatorSession, `/staff/wiki/proposals/${versionProposal.id}/accept`, {
    method: 'POST', body: {
      expectedVersion: 1,
      expectedWorkVersion: 1,
      expectedPublishedRevisionId: versionPage.revisionId,
    },
  });
  assert.equal(versionConflict.status, 409);
  assert.equal(versionConflict.body.code, 'STALE_VERSION');

  const unchanged = await sql`
    SELECT state, version FROM wiki_proposals WHERE id = ${versionProposal.id}`;
  assert.equal(unchanged[0].state, 'submitted');
  assert.equal(Number(unchanged[0].version), 1);
});

async function makeFixture(t, roles) {
  const fixture = { users: {}, pageIds: [], proposalIds: [], revisionIds: [] };
  t.after(async () => cleanFixture(fixture));
  const suffix = randomUUID().slice(0, 8);
  for (const role of roles) {
    const key = role === 'member'
      ? `member${Object.keys(fixture.users).filter((name) => name.startsWith('member')).length + 1}`
      : role;
    const username = `proposal-${key}-${suffix}`;
    const rows = await sql`
      INSERT INTO users (username, email, password_hash, role)
      VALUES (${username}, ${`${username}@example.test`}, 'test-only-hash', ${role})
      RETURNING id`;
    fixture.users[key] = { id: rows[0].id, role, username };
  }
  return fixture;
}

async function createPublishedPage(fixture, creator, title) {
  const initial = snapshot(title, slugifyFixture(title), '<p>Original public text.</p>');
  const rows = await sql`
    INSERT INTO wiki_pages (created_by, access_level, work_version, public_version, published_at)
    VALUES (${creator.id}, 'public', 1, 1, now()) RETURNING id`;
  const page = { id: rows[0].id, snapshot: initial, revisionId: null };
  fixture.pageIds.push(page.id);
  const revision = await insertTestRevision(fixture, page, creator, initial, {
    sequence: 1, parentRevisionId: null, basePublishedRevisionId: null, summary: 'Synthetic initial publication',
  });
  await sql`
    UPDATE wiki_pages SET head_revision_id = ${revision.id}, published_revision_id = ${revision.id}
    WHERE id = ${page.id}`;
  page.revisionId = revision.id;
  await sql`
    INSERT INTO wiki_names (name_key, page_id, kind)
    VALUES (${initial.slug}, ${page.id}, 'canonical')`;
  return page;
}

async function addRevision(fixture, page, actor, value, { publish }) {
  const current = await sql`
    SELECT head_revision_id, published_revision_id, work_version, public_version
    FROM wiki_pages WHERE id = ${page.id}`;
  const max = await sql`
    SELECT COALESCE(max(sequence), 0)::integer AS sequence FROM wiki_revisions WHERE page_id = ${page.id}`;
  const baseRevisionId = current[0].published_revision_id;
  const revision = await insertTestRevision(fixture, page, actor, value, {
    sequence: Number(max[0].sequence) + 1,
    parentRevisionId: current[0].head_revision_id,
    basePublishedRevisionId: baseRevisionId,
    summary: 'Synthetic fixture revision',
  });
  if (publish) {
    await sql`
      UPDATE wiki_pages SET head_revision_id = ${revision.id}, published_revision_id = ${revision.id},
        work_version = work_version + 1, public_version = public_version + 1, published_at = now()
      WHERE id = ${page.id}`;
  } else {
    await sql`
      UPDATE wiki_pages SET head_revision_id = ${revision.id}, work_version = work_version + 1
      WHERE id = ${page.id}`;
  }
  return revision;
}

async function insertTestRevision(fixture, page, actor, value, fields) {
  const rows = await sql`
    INSERT INTO wiki_revisions (
      page_id, sequence, parent_revision_id, base_published_revision_id,
      actor_id, edit_summary, snapshot
    ) VALUES (
      ${page.id}, ${fields.sequence}, ${fields.parentRevisionId}, ${fields.basePublishedRevisionId},
      ${actor.id}, ${fields.summary}, ${sql.json(value)}
    ) RETURNING id`;
  fixture.revisionIds.push(rows[0].id);
  return { id: rows[0].id };
}

async function submitProposal(fixture, page, session, candidate, options = {}) {
  const body = {
    snapshot: candidate,
    basePublishedRevisionId: page.revisionId,
    summary: 'Synthetic proposal summary',
    ...(options.previousProposalId ? { previousProposalId: options.previousProposalId } : {}),
  };
  const response = await request(session, `/wiki/pages/${page.id}/proposals`, {
    method: 'POST', body, key: randomUUID(),
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  fixture.proposalIds.push(response.body.data.id);
  return response.body.data;
}

function snapshot(title, slug, html) {
  return {
    schemaVersion: 1,
    title,
    slug,
    aliases: [],
    type: 'concept',
    summary: 'Synthetic reference summary.',
    categories: [],
    accessLevel: 'public',
    audience: 'reader',
    body: {
      format: 'richtext-v1',
      infobox: [],
      sections: [{
        id: randomUUID(), heading: 'Synthetic overview', html,
        blocks: [], authority: [], knowledgeLayer: 'unspecified',
      }],
    },
  };
}

function slugifyFixture(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 90);
}

async function cleanFixture(fixture) {
  await sql.begin(async (tx) => {
    await tx`ALTER TABLE wiki_revisions DISABLE TRIGGER wiki_revisions_immutable`;
    for (const user of Object.values(fixture.users)) {
      await tx`DELETE FROM request_keys WHERE actor_id = ${user.id}`;
      await tx`DELETE FROM audit_events WHERE actor_id = ${user.id}`;
    }
    for (const proposalId of fixture.proposalIds) {
      await tx`DELETE FROM audit_events WHERE target_id = ${proposalId}`;
    }
    for (const pageId of fixture.pageIds) {
      await tx`DELETE FROM wiki_revision_categories WHERE revision_id IN (SELECT id FROM wiki_revisions WHERE page_id = ${pageId})`;
      await tx`DELETE FROM wiki_revision_links WHERE revision_id IN (SELECT id FROM wiki_revisions WHERE page_id = ${pageId})`;
      await tx`UPDATE wiki_revisions SET accepted_proposal_id = NULL WHERE page_id = ${pageId}`;
      await tx`UPDATE wiki_pages SET head_revision_id = NULL, published_revision_id = NULL WHERE id = ${pageId}`;
      for (const proposalId of [...fixture.proposalIds].reverse()) {
        await tx`DELETE FROM wiki_proposals WHERE id = ${proposalId} AND page_id = ${pageId}`;
      }
      const revisions = await tx`SELECT id FROM wiki_revisions WHERE page_id = ${pageId} ORDER BY sequence DESC`;
      for (const revision of revisions) await tx`DELETE FROM wiki_revisions WHERE id = ${revision.id}`;
      await tx`DELETE FROM wiki_names WHERE page_id = ${pageId}`;
      await tx`DELETE FROM wiki_pages WHERE id = ${pageId}`;
    }
    await tx`ALTER TABLE wiki_revisions ENABLE TRIGGER wiki_revisions_immutable`;
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

async function request(session, route, { method = 'GET', body, key } = {}) {
  const headers = {};
  if (session) {
    headers.cookie = session.cookie;
    headers['x-csrf-token'] = session.csrfToken;
  }
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (key) headers['idempotency-key'] = key;
  const response = await fetch(`${baseUrl}/api${route}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}
