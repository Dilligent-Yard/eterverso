# Verification, migration and recovery runbook

These checks are requirements for the future implementation. They have not
been run by preparing this document. Tests use synthetic content and isolated
infrastructure. A test that is skipped or cannot reach its prerequisite remains
pending, even if another test runner exits successfully.

## 1. Isolation and test entry points

Use Node 24's built-in test runner for unit/integration tests. Add
`@playwright/test` as a development dependency for repeatable browser checks
with separate browser contexts. Verify current official APIs before writing
library-specific code. No unrelated test framework is necessary.

Create `compose.test.yaml` with its own project/service, PostgreSQL 17, a
separate loopback port (default 55433), and disposable test storage. It must
not mount the development database volume. Put generated test-only password,
DSN and process/port ownership under ignored `.local/test/`, mode restricted
to the user. Never copy production credentials into it. If the port is occupied,
select and record another test port rather than stopping an unknown service.

The principal provisions the test environment, runs migrations/tests and
tears it down. Worker tests cannot reset a shared database concurrently. Tests
must verify all of: explicit test DSN, test database name, known local test
service/port, and DSN different from the development connection before any
reset/fixture write. Missing configuration is a failure with instructions,
not an automatic switch to `DATABASE_URL`.

Create documented scripts during M0/M1:

| Command | Required meaning |
| --- | --- |
| `npm run test:env:up` | Start only the isolated test service and write restricted config |
| `npm run test:unit` | Pure helper tests, no DB or browser required |
| `npm run test:integration` | Real PostgreSQL/HTTP tests against explicit test target |
| `npm run test:browser` | Playwright test server on a recorded test port, fresh browser contexts |
| `npm test` | Unit plus integration checks; does not silently omit integration |
| `npm run test:all` | Unit, integration and browser gates; fail if any is unavailable |
| `npm run test:env:down` | Stop only the recorded test service; never `docker system prune` |
| `npm run db:preflight` | Read-only schema/history report for an explicit target |
| `npm run db:migrate` | Preflight-gated migration wrapper, no blind legacy replay |
| `npm run test:migration:populated` | Restore the restricted verified 0006 baseline into a generated test-only scratch DB, seed synthetic records, apply additive migrations, compare preserved data, and drop the scratch DB |

The app factory lets HTTP tests bind an ephemeral local port and close the
server/SQL pool in teardown. Test helpers acquire session/CSRF tokens through
normal HTTP. Role fixture creation is out of band in the test database only.
Keep test reset/provisioning helpers out of production routers. Test concurrency
is controlled: independent pure unit tests may parallelize; integration/browser
suites using the same database run serially unless fixtures are truly isolated.

Two browser tabs in one profile do not establish storage/session independence.
Use two fresh contexts with separate cookies, localStorage and sessionStorage.
Use synthetic account names and lore sentinels; never real ZIP excerpts.

## 2. Historical migration preflight

Do not run the current raw migration command against an unverified existing
database. The source chain includes 0002 dropping `users.password_hash`, 0004
recreating an empty hash column, and 0005 dropping `personagens.apex_tier`.
Already lost data cannot be recovered from a later empty-column default.

Preflight records environment name, database name/host without credentials,
applied migration identities/hashes, actual tables/columns/constraints, pending
migrations, row counts, and discrepancies. Reconcile using the installed
Drizzle version/tool format rather than guessed migration-ledger contents.
No writes or startup schema repair occur during this report.

Supported automated migration paths for this implementation:

1. An explicitly empty disposable database: historical chain, then new
   migrations. Confirm no populated unjournaled application tables exist.
2. A backed-up clone of the verified current 0006-era baseline: only pending
   new additive migrations. Preserve existing hashes/content and constraints.

An older/unknown populated schema, missing/divergent ledger, pending destructive
history, or incompatible live structure must refuse automatic migration. Save
the report and request a specific operator-reviewed upgrade path. Continue
implementing/testing the supported paths. Do not fake completion by labeling
old SQL "applied," rewriting history, silently deleting values, or adding
default passwords. This is a deployment/recovery decision, not a reason to
halt unrelated local feature work.

For supported existing upgrades: create a restricted dump and restore it into
a second isolated database first. Record pre/post users/character/scene/turn
counts, credential hashes and representative content hashes. Preserve actual
server timestamps and old character fields in the recovery copy; do not infer
their timezone or canon meaning. Backfill new fields before enforcing new
constraints. Review generated SQL for unexpected DROP/ALTER operations.

Reconcile Drizzle schema, migration SQL, journal and missing 0006 snapshot with
the intended baseline, using a disposable introspected database and installed
tooling where appropriate. Verify the next generated diff contains only the
intended new changes. Do not copy an unrelated snapshot and pretend its IDs or
constraints match. Startup must verify required migration/schema readiness
and fail clearly if absent; the application no longer executes `ensureSchema()`.

## 3. Browser recovery and content import

The old client reads `forum-antigo-db-v22`, removes scene 101, and later saves
the object. Opening it is not a read-only recovery step. Capture raw data first.
Do not visit production or alter someone else's browser as part of local coding.

Provide a dedicated recovery page which does not load `app.js`. It can download
the exact raw value from the current origin plus an origin/export label and
digest. Preserve this private raw snapshot unchanged. A separate converter
produces content-only JSON and minimal author associations. The old admin
"backup" is a supplementary content view, not a full recovery snapshot.

For actual other devices/origins, the user supplies restricted snapshots when
ready. A different localhost origin cannot access them. Do not claim the
server inventoried remote localStorage. Implement and test the workflow on
synthetic snapshots while actual exports are pending.

Preview conversion/recovery must show counts, missing parents, unsupported
fields, format/URL changes, legacy dates, sample records, unmapped authors and
candidate duplicates. Keep exact raw attribution/date labels in restricted
recovery data. Only confirmed account mapping can set author UUID; otherwise
retain explicit legacy attribution. Do not grant permissions from a cached
`serverId`, name, role or `authorRole`.

Default limits: 5 MB per JSON request and 20 MB canonical content per import
job. For larger snapshots, split dependency-complete batches with a manifest;
do not raise limits or silently truncate. Server recomputes canonical hashes
(sorted object keys, preserved array order) over the exact contentDigest fields
defined in contract C2. Export/source/job IDs, digest fields, generated times,
transport chunking and review decisions do not belong in that digest. A new
export UUID or different batching of identical source content is an exact
content replay, not a new import. Preview and commit must use the
same server-verified plan hash. A job/version/payload change invalidates approval.

Keep source-key/target-UUID mappings and item hashes globally unique across
importing admins. Replay returns mappings; changed items conflict; no automatic
name/title merge or overwrite of later human edits. Fail a selected dependency
batch atomically. A report must distinguish imported, already imported,
excluded, unresolved and failed—not merely return one success count.

Do not clear old storage, snapshots or JSONB turns after tests pass. Keep a
read-only recovery view until affected owners accept their recovery. Stop
writing the legacy key in the new app; new drafts use another versioned,
account-scoped key. Missing real exports block only actual-data import/cutover.

## 4. Required behavioral tests

Assign these IDs to real tests and record their output at milestone boundaries.
Helpers can share setup; tests must assert observable outcomes, not reproduce
the code's implementation as an expected result.

| ID | Acceptance |
| --- | --- |
| ENV-01 | Runner refuses missing DSN, dev DSN, unknown host/service, wrong database marker/name; dev sentinel is unchanged after tests |
| MIG-01 | Empty DB migrates; repeated run is a no-op; intended constraints/schema agree; normal app startup performs no DDL |
| MIG-02 | Verified populated baseline upgrade preserves credential hashes, users, characters, scenes, raw turn arrays, and relationships |
| MIG-03 | Older/unknown/pending-destructive fixture is refused without changing its ledger, hashes or old character field |
| REC-01 | Recovery reads a fixture containing scene 101 and numeric authors without modifying/removing anything; raw and content-only exports differ intentionally |
| AUTH-01 | Login/me/profile/logout work with DB identity; password change invalidates other sessions; no missing profile callback or local-success fallback |
| AUTH-02 | Member with forged local role/admin flags is still denied staff/admin requests; disabled/demoted/old-version cookies fail after revocation |
| AUTH-03 | All unsafe routes reject missing/wrong CSRF and inappropriate origins; valid same-origin/token requests work, including login/signup/logout |
| PRIV-01 | Public profiles/authors/forum responses omit emails, hashes, tokens and account controls; restricted endpoints deny non-admin access |
| HTML-01 | Script/event/SVG/iframe/URL/CSS payloads cannot execute in posts, characters, scenes, turns, wiki sections, blocks or previews |
| HTML-02 | Existing supported tables, lists, images, quotes, colors and safe font formatting survive or produce explicit staff conversion warnings |
| FOR-01 | Topic plus opening post commits together, or neither exists; exact request retry returns same IDs; changed-key payload conflicts |
| FOR-02 | Separate browser contexts share topics/replies after reload; category/post totals and user counts come from DB and exclude turns/hidden posts |
| FOR-03 | Reply-vs-lock/category-archive barriers yield valid ordered outcomes; two concurrent replies both persist with unique post order |
| FOR-04 | Owner edit works when writable; another member gets 403; stale/missing versions get 409/428; forbidden body fields cannot set actor/role/moderation |
| FOR-05 | Archived/locked discussions reject new posts and ordinary title/body edits for all roles; audited staff hide/restore/state moderation still works; historical reads and opening-post rules hold |
| ADM-01 | Moderator cannot manage users/roles/categories; real admin changes are visible across sessions and recorded atomically |
| ADM-02 | Two concurrent final-admin demotion/disable requests cannot leave zero active admins; audit failure rolls back mutation |
| ADM-03 | No default/magic admin login or client promotion exists; bootstrap refuses when an active admin exists and records an operator event |
| SCN-01 | Concurrent append/edit/hide does not lose a successful turn; all parent/author/version rules are rechecked and initial forged turns are rejected |
| SCN-02 | Turn migration preserves original order/IDs/date labels, source mapping and raw originals; rerun is idempotent; malformed items are reported |
| IMP-01 | Same canonical content with new export/source UUIDs or chunking reuses mappings across admins; volatile metadata changes do not duplicate; changed item/plan/batch conflicts; failed dependency batch rolls back |
| IMP-02 | Unknown/numeric/sample authors are not silently assigned to importing admin; original labels retained; imported roles never affect privileges |
| WIK-01 | Save draft B after publication A: every public metadata/body/search/category/alias/ETag surface still shows A; explicit publish switches atomically |
| WIK-02 | Unique draft/proposal/source sentinels absent from unauthorized direct reads, lists, totals, search, backlinks, HTML/DOM, history, diffs, exports and static URLs |
| WIK-03 | Slug/alias normalization, cross-page collision races and retained rename redirects work; private drafts never reserve a public resolving route |
| WIK-04 | Revision immutable; stale save/publication conflicts; restore creates a fresh draft with old provenance and leaves publication unchanged |
| WIK-05 | Backlinks/search use only visible published source/target revisions; unresolved links do not reveal restricted target existence |
| PRO-01 | Member proposal is private to proposer/staff; other members cannot enumerate/read it; staff accept creates credited draft, not publication |
| PRO-02 | Base publication change or existing staff draft blocks acceptance; reject/withdraw terminal states cannot be accepted; no automatic rebase/merge |
| SRC-01 | Source manifests match staged bytes, missing witnesses stay missing, repeat import cannot overwrite human drafts, source text never becomes static/public |
| SRC-02 | C/S/E/O/mixed/unstated and knowledge/audience/access distinctions survive; pilot lore remains staff-only; no real story/source text in committed tests |
| UI-01 | Forum/wiki/character/scene deep links reload correctly, back/forward works, actual 404 pages and JSON API errors remain distinct |
| UI-02 | 401/403/409/500/offline during each form preserves an account-scoped draft and reports failure; no success toast or canonical local mutation |
| UI-03 | Portuguese responsive layouts remain usable; reader, proposer, moderator and admin controls match tested server capabilities |
| BACK-01 | Restricted backup restores to an isolated DB and reproduces selected counts/hashes; downloadable content export is not labeled a complete site backup |

Concurrency tests use barriers/transactions rather than hoping two requests
happen to overlap. Assert allowed serialization outcomes and row counts. Do
not fix concurrency failures by adding test-only sleeps or disabling tests.
Do not wait at an in-lock barrier for another request that needs the held lock;
coordinate before acquisition or observe blocking from a separate connection.
HTML tests include browser-observed execution sentinels and positive-formatting
cases, not only comparisons of sanitizer output strings.

## 5. Final review packet and completion

Give Sol 6.1 / High: original request/brief/contracts, actual diff against the
pre-implementation branch, schema/SQL and migration reports, test IDs/output,
known original defects, relevant private source passages when source fidelity
is reviewed, and unresolved cases. The reviewer needs original evidence, not
just an implementer's reassuring summary. Do not send private evidence to Git.

Review questions: data loss, authorization/session/CSRF, draft/source privacy,
version/idempotency semantics, concurrency/locks, sanitization across old/new
sinks, compatibility/recovery, and whether required flows actually work.

For each finding record disposition and evidence. Fix material defects and
rerun affected tests. If no material change remains, finish; do not commission
an arbitrary second broad audit. A substantive unresolved design conflict can
use higher review effort as Arthur's instructions permit.

Final user report: implemented milestones, branch/commits, precise verification,
remaining real-data/editorial/deployment gates, any unavailable tool/model and
known limitations. Distinguish requested configuration from observed actions.
Never report synthetic recovery tests as migration of real users' data.

## 6. External implementation references

- [Node test runner](https://nodejs.org/docs/latest-v24.x/api/test.html).
- [Playwright context isolation](https://playwright.dev/docs/browser-contexts).
- [PostgreSQL lock semantics](https://www.postgresql.org/docs/17/explicit-locking.html).
- [sanitize-html official maintained package](https://github.com/apostrophecms/apostrophe/tree/main/packages/sanitize-html).

These docs were consulted while preparing the brief. Dependency versions and
specific API calls still require verification when installation/code is written.
