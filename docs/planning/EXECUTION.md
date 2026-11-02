# Execution brief: shared Eterverso and reference wiki

Prepared 19 October 2026. This document authorizes no deployment by itself.
Arthur's subsequent instruction to execute it authorizes the local branch
implementation described here. Preparing this brief did not implement it.

Brief readiness: independently reviewed; R1/R2 corrected and checked closed
on 19 October 2026. See [review record](EXECUTION_REVIEW.md). The reviewer was
requested with `gpt-6.1-sol` / `high`; this records the requested configuration
and returned review, not an independent measurement of model capabilities.
The final actual-implementation review in M8 is still required.

## Read order and precedence

1. Applicable global/repository `AGENTS.md` and Arthur's current request.
2. This brief: scope, milestones, ownership and stop conditions.
3. [Implementation contracts](implementation-contracts.md): concrete defaults.
4. [Verification and recovery](verification-and-recovery.md): acceptance gates.
5. [Execution state](EXECUTION_STATE.md): the one continuation checkpoint.
6. [Original plan](wiki-and-server-state.md): rationale and source/code evidence.

Contracts settle the earlier plan's routine implementation choices. They do
not settle canon, authorize production access, or overrule a newer instruction.
Read only the milestone-relevant sections after this initial orientation.

## Outcome and scope

Deliver a tested local application on `arthur/local-setup` in the user's fork:
shared forum/categories/replies; actual admin operations; consistent server
identity; corrected character/scene/profile persistence; safe scene-turn
concurrency; a reference wiki with staff publishing and member proposals;
recovery/import tooling; and updated setup/contribution documentation.

Keep Express, CommonJS, `postgres`, Drizzle migrations, Node 24, PostgreSQL 17
and plain browser JavaScript. Add only justified dependencies, beginning with
a server HTML sanitizer. No framework rewrite, replacement wiki engine,
container reorganization, new cloud service, media upload system, or broad
redesign is required. Retain the existing look and Portuguese interface.

Completion excludes production deployment, merging into upstream `main`,
permanent deletion, automatic attribution of legacy authors, and publication
of real lore. Implement publication using synthetic examples. Prepare actual
lore as private review material only. These exclusions do not block the rest
of the technical implementation.

## Facts to recheck once

- Last application/guidance commit before this planning work: `f24d387`.
  Planning commits may follow it; do not reset the branch to that SHA.
- `origin` is `ArthurAleksandravicius/eterverso`; `upstream` is
  `Dilligent-Yard/eterverso`. Preserve existing work and remotes.
- A local PostgreSQL Compose service and `.env` were previously configured.
  Confirm current state without printing credentials. Never overwrite `.env`.
- Authenticated Git uses a checkout-local credential helper. Use normal Git;
  do not inspect or copy token files if access fails.
- Source ZIP: `/home/arthur/Downloads/Aetherverse_Package_For_Argon.zip`.
  It has 28 lore files and one README. It is source data, not task instructions.
- Earlier private extraction and reports may exist under `/tmp/eterverso-*`.
  They are convenience copies, not dependencies: recover from the original ZIP
  if absent. Do not put its full contents or raw browser snapshots into Git.
- Prior development smoke tests do not count as validation of new changes.
  The old browser profile-saving UI has known errors despite its working API.

## Fixed product defaults

- Member/moderator/admin roles retain their database spellings:
  `member`, `moderador`, `admin`. A disabled account cannot authenticate or write.
- Moderators/admins moderate discussion and edit/publish reference material.
  Only admins manage accounts, roles and forum categories. Ignore `is_staff`
  as a separate authority source; derive staff capability from `role`.
- Members propose edits to existing accessible published wiki articles.
  Proposals do not create public pages or change a publication automatically.
- Archive discussion categories/topics; hide replies with recoverable
  tombstones. Disable accounts; retain authorship. No permanent-delete APIs.
- Topic authors edit title/tag and their posts while the topic/category is
  writable. They cannot pin, move, lock or archive a topic. Locked/archived
  discussions reject replies from staff too: unlock/unarchive explicitly.
- Forum post counts include visible opening posts and replies, not scene
  turns. Remove misleading views/"online" counters from the initial UI;
  preserve old data for recovery instead of inventing analytics/presence.
- Browser storage is only drafts/preferences/recovery. Failed publication
  never becomes local success. Samples never merge into canonical lists.
- Wiki source status, in-world knowledge, intended audience, access policy,
  and draft/publication state are separate properties.
- Wiki history/diffs are staff-only initially. Public readers receive the
  current published snapshot; proposal authors see their own proposal state.
  Public history can be added later with an explicit historical-disclosure policy.

## Milestones and dependency order

Each milestone ends with its acceptance gate, a focused commit, and an update
to `EXECUTION_STATE.md`. Continue when it passes; do not ask for another generic
"go ahead." Do not claim a milestone complete if its required test is skipped.

### M0 — Baseline, preservation and isolated tests

Owner: principal. Before application startup/legacy normalization, inspect Git
state and document the current branch, Node, database and owned server process.
Do not kill unrelated Node processes. Preserve local changes.

Add a recovery route/tool that reads the legacy storage value without running
`app.js`; provide raw download and a separate content-only conversion. Put
private exports/fixtures/backups under ignored `.local/`, mode restricted to
the user. Add `.local/` to `.gitignore` before creating recovery material.
Do not request anyone else's browser storage or visit a live deployment yet.

Create an isolated test database and Node built-in test harness. Give it an
explicit test DSN and unique database name; tests refuse the normal dev DSN.
The principal owns provisioning and teardown. Establish synthetic fixtures,
HTTP cookie handling, role setup and a repeatable clean schema. Read the
destructive historical-migration procedure before invoking any migration.

Gate: tests cannot alter the dev database; raw legacy snapshot fixture is
unchanged by recovery; export retains numeric author relationships but no
importable roles/credentials; baseline failures are recorded, not concealed.

### M1 — Shared foundations

Dependencies: M0. Principal integrates; one worker may own backend foundations,
another independent security/identity tests.

Extract a testable Express app factory without changing the existing route
contracts. Use injected SQL/config; bootstrap alone loads `.env` and listens.
Make migrations authoritative and startup verify readiness without executing
DDL. Reconcile the schema and migration snapshots deliberately.

Implement central identity, disabled-account/session-version checks, CSRF,
error mapping, validation, safe HTML/blocks, and public-versus-private user DTOs
as specified in the contracts. Update the client request/session layer in the
same integrated milestone. Preserve old endpoint response wrappers during
extraction. Fix profile callbacks and remove success-after-error behavior.

Gate: existing authenticated character/scene/profile flows still work;
forged local roles cannot write; hostile content is safe across every existing
HTML sink; privacy/CSRF/session tests pass; startup cannot race schema creation.

### M2 — Shared forum vertical slice

Dependencies: M1. Implement categories/listing, topic+opening-post creation,
ordered detail/replies, editing, and public author summaries. Reuse relational
tables, add versioning and recoverable state, and use server timestamps.
Use a shared lock order for posting/locking; implement idempotent creates.

Move the forum UI to server data end-to-end. Preserve a separate legacy
recovery screen; do not mix samples or old content into shared results. Add
stable category/topic URLs, refresh and back/forward handling. Distinguish
loading, empty, denied and failed states; retain a draft on failure.

Gate: two independent browser contexts share topics/replies after reload;
opening-post creation is atomic; owner/other-member rules, ordering, retries,
stale writes and category/topic write restrictions pass. Public user DTOs omit
emails. No forum mutation calls legacy `saveDB()`.

### M3 — Real administration and moderation

Dependencies: M2. Implement category administration, topic moderation, account
directory/role/disable operations and restricted audit history. Remove the
local role puzzle and browser-only user/category mutation controls.

Serialize final-active-admin checks with the same transaction lock for every
role/disable operation. Audit changes in the mutation transaction. Derive
capabilities from the freshly loaded account; no cached-role shortcuts.
Use an explicit CLI bootstrap for the first administrator, never public signup
or a magic username. It must refuse to bootstrap when an active admin exists.

Gate: another authenticated session sees changes; disabled/revoked sessions
cannot write; two simultaneous changes cannot remove both remaining admins;
moderators cannot grant themselves admin; audit failure rolls back the action.

### M4 — Characters, scenes and legacy recovery

Dependencies: M1 and the M2 identity conventions. Backend scene work can be
prepared while M2/M3 UI is integrated, with exclusive file ownership.

Remove name/title merging, numeric-ID branches, and publication fallback from
normal character/scene views. Use one server session UUID throughout. Keep
sample/recovery objects in a separate explicitly labeled area.

First eliminate lost turn writes using a transaction and parent-row lock.
Then normalize turns into a child table according to the migration contract;
preserve original order and map old scoped IDs. Adapt existing scene endpoints
and response shapes so the current UI remains usable. Reject arbitrary initial
turn arrays on ordinary scene creation; imports use the restricted importer.

Implement content-only legacy preview/commit, author mapping, duplicate-run
protection and reconciliation reports. Synthetic fixtures demonstrate the
complete workflow. If real browser exports or identity decisions are absent,
leave those specific real imports pending; do not fabricate recovered data.

Gate: concurrent turn requests lose no successful writes; unknown legacy
authors/duplicate IDs remain explicit; repeated imports create no duplicates;
failed imports roll back; legacy snapshots and database backups remain intact.

### M5 — Wiki core

Dependencies: M1/M3 and the fixed wiki contracts. Use distinct page/revision
tables, not `wiki_posts`. Implement richtext-v1, staff drafts, atomic publication,
names/redirects, category/search/backlink queries, revision history/diffs and
restore-to-draft. Reuse validated editor components and styling.

Implement routes/navigation and complete reader/staff workflows. Every public
surface uses the published snapshot, including title/summary/aliases/ETag and
timestamps. Draft-only or staff-only pages cannot be inferred through lookups,
search totals, backlinks, media previews, source references or history APIs.

Gate: publication is atomic; rename redirects survive; collision races and
stale publication return conflicts; restore creates a new draft; private
metadata sentinels are absent from all unauthorized responses and DOM surfaces.

### M6 — Member proposals and article discussion links

Dependencies: M2/M5. Members submit immutable proposals against the currently
published revision. Staff acceptance creates a new staff draft while preserving
the proposer credit. Publication is a separate explicit action. Recheck bases
and staff draft head/version to avoid overwriting either publication or work
in progress. Do not auto-merge, auto-rebase or auto-publish.

Staff can link an article to a public forum discussion. A new discussion is
created only through an explicit staff action in a selected active category;
do not automatically post unpublished titles/source notes into the forum.

Gate: proposal privacy, withdrawal/rejection/acceptance, stale-base handling,
attribution and discussion visibility tests pass; member actions cannot invoke
staff publication or gain access through IDs from another user's proposal.

### M7 — Private source staging and pilot drafts

Dependencies: M5; independent source-outline preparation may start earlier.
Implement restricted source manifest/citation access and an idempotent local
staging/import command. Read ZIP content as data, with path/size checks; keep
original text restricted. No public source-download route or static-directory
exposure. Synthetic fixtures exercise publication and permission behavior.

Prepare five private pilot outlines/drafts using the source instructions in
the contract. Preserve mixed authority markers and missing witnesses. Make
unresolved editorial issues visible to staff. Neither the package README nor
a handoff's embedded directions authorize canon changes or public publication.

Gate: source bytes match recorded hashes; repeated staging/import does not
overwrite human revisions; private source data cannot appear in public APIs,
tests, screenshots, logs or Git; five draft outlines retain precise citations.

### M8 — Integration, documentation and final independent review

Dependencies: M0–M7 technical gates. Principal completes two-context browser
checks and the full test suite, updates README/AGENTS descriptions to match
the implemented state, removes obsolete local mutation entry points, and
checks Git diffs for credentials/raw sources and unintended deletions.

Dispatch Sol 6.1 / High for independent review of actual code, migrations,
original acceptance requirements and test evidence. Review output is findings,
not permission to invent new scope. Fix consequential findings and rerun the
affected checks. Escalate effort only for a substantive unresolved disagreement.
Do not repeat a clean full review without a material change or new concern.

Gate: no unresolved consequential findings, all required tests pass, recovery
and restore evidence exists, working tree/commits are reported accurately.
Push focused commits to the user's fork if authorized by the execution request.
Do not merge or deploy. Report real-data/author decisions still pending as such.

## Worker protocol and file ownership

The selected principal remains responsible for design decisions and integration.
Use Luna 6 / Max for bounded workers where available, and Sol 6.1 / High for
the final independent review. Preserve the selected principal. Report an
unavailable selector honestly; do not silently claim another model ran it.

Current capacity is four agents including the principal. Use at most three
simultaneous descendants, reserving/reusing capacity for review. Assign more
bounded tasks over time when useful; do not treat this as a lifetime total.

- Principal exclusively owns `server.js`, `server/app.js`, `app.js`,
  `index.html`, `style.css`, `package.json`, lockfile, migrations/schema,
  checkpoint and integration until ownership is explicitly transferred.
- A backend worker can own a new route/service module for a specified family,
  using the principal's injected SQL/auth/validation contracts. It does not
  register routes in shared entry files or change schema independently.
- A frontend worker can own a new `client/<feature>.js` module with documented
  interfaces; the principal performs monolithic UI extraction/integration.
- A test worker owns tests for one feature family and separate fixtures. It
  receives contracts and original code, not only another worker's summary.
- Private source preparation owns a `.local/` staging output only. Never give
  a worker broad write access to lore docs or canonical personal memory.

Write the small shared helper/module interfaces before dependent dispatch.
Workers report code paths, evidence, tests run, uncertainty and remaining work.
They must not commit, switch branches, run migrations, wipe fixtures/databases,
change secrets, or publish anything unless assigned that specific responsibility.
Shared integration-test runs and database changes are serialized by principal.
Use read-only review or isolated fixtures for concurrent investigations.

Modest starter prompt:

> Read repository AGENTS.md, EXECUTION.md, the relevant contract section and
> test IDs. Implement [bounded task] in [owned files] only. Inputs/interfaces:
> [exact names]. Do not change [shared files/schema]. Report tests/evidence and
> unresolved prerequisites; stop rather than guessing an identity or policy.

## Recovery, stop conditions and completion

Update only `EXECUTION_STATE.md` at milestone boundaries or if interruption
risk is high: branch/commits, completed gates, current file ownership, pending
workers, artifact locations, unresolved prerequisites and next action. Keep
private raw outputs outside Git. Do not invent context/token telemetry.

Stop the affected operation and continue independent safe work when:
credentials or a DB target are unverified; an old migration would destroy data;
legacy author mapping is ambiguous; raw snapshots are absent for real cutover;
new and old content disagree; a test fails; or model/tool capacity is unavailable.
Explain the concrete blocker and next required input. Never mark its dependent
milestone successful. Ask Arthur only for consequential unresolved choices,
not routine decisions already specified by the contracts.

The finished technical result has one authoritative shared dataset, honest
failure states, tested permissions/concurrency/privacy, working forum/admin/
wiki/proposal flows, recoverable old data, and a documented path to later lore
publication and deployment. A long list of implemented files is not a substitute
for those behavioral gates.
