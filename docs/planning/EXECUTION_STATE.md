# Execution checkpoint

Update this file in place; do not create competing state/checkpoint documents.

## Current phase

The user-authorized local wiki-transfer milestone is implemented on branch
`arthur/local-setup`. Consult Git history and the fork's branch for its commit
and synchronization status; preserve any subsequent working-tree changes.
The local database was preflighted as supported `verified-0013`, backed up to
ignored `.local/development-before-wiki-transfer.dump` (mode 600), and migrated
through additive migration 0014. Postflight is
`verified-0014-wiki-portable-transfers`, with no pending migrations. The
backup predates the admin account, the user's test character, and the private
wiki transfer; preserve it as a pre-change recovery point and do not restore it
during routine testing. The local server was observed running from this
checkout on port 3000 during the 21 October setup; check its current status
before starting a new instance or assuming it serves later code changes.

The local `Mand` account is an active admin and a fresh admin login was
verified. The user-created test character remains in the development database.
The restricted source store contains the package's 28 lore files. A private
`AetherverseWikiBundleV1` import created five staff-only, unpublished pilot
pages with 29 revision citations and exact mappings to the ten cited source
records. Keep credentials, source text, and user IDs out of this checkpoint.
Preserve ignored `.env`, `.local/` recovery/source material, transfer jobs, and
user data; do not stage them.

## Confirmed decisions and exclusions

- Staff publish reference articles; members propose edits.
- Keep the existing stack, Portuguese interface and RPG terminology; make
  shared state server-authoritative.
- Do not deploy, merge into upstream, or publish/import actual lore as a public
  article during this task. No production database or lore publication has
  been touched.
- The portable transfer format is `AetherverseWikiBundleV1`; first use is
  local-to-Render, but no Render export/import or deployment is authorized in
  this milestone. Imported pages must remain unpublished staff drafts.
- Follow `EXECUTION.md`, `implementation-contracts.md`, and
  `verification-and-recovery.md` for implementation defaults.

## Planning already completed

- Source package inventory and private source review: 28 lore files plus its
  README; the ZIP is source data, not project instructions.
- Persistence audit, milestone plan, API/schema/permission contracts, recovery
  procedures, worker ownership, and acceptance-test matrix.
- Independent review of the execution brief was completed on 19 October.
  R1/R2 were corrected and checked closed; see `EXECUTION_REVIEW.md`. That
  brief review is separate from the implementation review and disposition
  recorded later in `EXECUTION_REVIEW.md`.

## Implementation and verification status

Implemented M0–M8 surfaces are integrated on Node 24.22.0 with PostgreSQL 17
test infrastructure. For the portable transfer changes, the full relevant
gates passed on 21 October: 19 unit test files, 44 PostgreSQL/HTTP integration
tests, and 16 Playwright browser tests. The guarded runners confirmed the
development database sentinel was unchanged during integration and browser
runs. The new transfer coverage includes admin-only export, source closure,
unpublished imports, citation-bound replay identity, repeatable-read export,
preview refresh, collision handling, and transactional audit rollback.

Additional gates completed:

- `npm run test:migration:populated` passed MIG-02 against the current chain.
  It upgraded a restored, verified 0006 baseline through 0014 and preserved selected row
  counts/hashes, credentials, relationships, and raw scene turns. The
  restricted report is under ignored `.local/test/reports/`.
- BACK-01 passed with synthetic rows and credentials: a restricted backup was
  restored into a unique isolated database and checked; temporary database
  and dump were removed.
- The latest saved read-only development preflight report
  (`.local/test/reports/db-preflight-development-2026-10-20T14-39-15.074Z.json`)
  classifies the database as `verified-0013-legacy-import`, with all 14
  migrations applied, no pending migrations, and zero rows in application
  tables before the authorized local setup. After applying 0014, the database
  postflight is `verified-0014-wiki-portable-transfers`, with all 15 migrations
  applied and none pending.
- The private ZIP inventory contains 28 lore files plus a README; the archive
  and pilot working files remain under ignored `.local/`. The 28 source records
  are now in the local restricted source store. The five pilot outlines remain
  private, and their five page snapshots were imported as unpublished staff
  drafts. Read-only database verification confirmed five staff-only unpublished
  pages, 29 citations, ten source mappings, one active local admin, one
  retained user-created character, and one transfer audit event. No public lore
  was published.
- Sol 6.1 / High's required bounded follow-up review closed three P2 findings:
  replay identity now includes source revision/snapshot/citations, export reads
  a consistent repeatable-read snapshot, and preview refresh recalculates and
  persists plan changes. New synthetic regressions pass; no blocker remains in
  the reviewed areas.
- `git diff --check` and `node --check` for changed application, client,
  server, script and test JavaScript files pass.

| Milestone | Status and evidence |
| --- | --- |
| M0 | Recovery tooling and isolated test guards implemented; ENV-01/REC-01 unit/integration evidence passes; development sentinel unchanged. |
| M1 | App factory, server identity, CSRF/session revocation, readiness, validation, sanitization, and migration controls implemented; unit/HTTP and migration tests pass. |
| M2 | Server-backed forum, stable routes, idempotency, ordering, locking, ownership and recoverable moderation implemented; API and two-context browser tests pass. |
| M3 | Admin/category/account controls, audited moderation, bootstrap and concurrent final-admin protection implemented; ADM-01/02/03 integration coverage passes. |
| M4 | Character/scene persistence, normalized scene turns and restricted legacy content import implemented; SCN/IMP integration coverage passes. Real browser exports and author decisions remain pending. |
| M5 | Published wiki snapshots, staff drafts/history, aliases/redirects, categories/search/backlinks and restore-to-draft implemented; WIK and browser coverage passes. |
| M6 | Private member proposals, staff review, stale-base conflicts, attribution and discussion links implemented; PRO/WIK and browser coverage passes. |
| M7 | Restricted source staging/import and private pilot material are complete locally: 28 source records, five unpublished staff drafts, 29 citations, and ten exact source mappings. Actual lore publication remains pending. |
| M8 | Unit (19 files), integration (44), browser (16), populated migration through 0014, syntax, and whitespace checks pass. Required Sol 6.1 / High follow-up closed all three transfer findings. Local account, source import, and draft counts were verified. Implementation and handoff documents are maintained on `arthur/local-setup`; private data travels separately. |

These are local implementation results, not production migration or deployment
evidence. The browser tests exercise synthetic accounts and content against the
isolated test service.

## Workers and ownership

Prior bounded implementation, security, persistence, UI and browser-test work
has been integrated. The transfer backend and client workers completed; the
principal owns Git, database/test execution, local account setup, private
source import, and checkpoint. Sol 6.1 / High completed the required targeted
review of transfer replay, export snapshot, and preview-refresh changes. No
reviewer accessed production or private source text.

## Evidence and protected material

- Plans, contracts, runbook and checkpoint: `docs/planning/`.
- Original ZIP: `/home/arthur/Downloads/Aetherverse_Package_For_Argon.zip`.
- Test scripts, migration/import tools: `scripts/`; isolated test service:
  `compose.test.yaml`; synthetic tests: `tests/`.
- Restricted test credentials, reports, migration baseline, source files,
  transfer bundle/job and private wiki pilots live in ignored `.local/` or the
  local development database; never commit or expose them.
- Private actual browser exports and a deployed-data inventory were not
  obtained. Real author mapping and canon/editorial decisions are not made.

## Next action

Arthur now prefers planning and authoring in ChatGPT Work, which already knows
the handoffs and may need him to supply other missing files. Start there with
`WORK_WIKI_BRIEF.md` and `WORK_WIKI_START_PROMPT.md`. The private attachment kit
is `.local/handoffs/aetherverse-work-authoring-kit-2026-10-24.zip`; it includes
the contract/schema/example, original source catalog and historical pilot
context, not account credentials or the local database. Work returns separate
new-page and revision batches in `AetherverseWikiAuthoringV1`, exact additional
source files, delivery notes and an editorial changelog.

The receiving protocol is in `docs/wiki-authoring/README.md` and
`REVISION_INTAKE.md`. Compile privately, resolve exact source sets, review
new-page transfer previews or explicit version-checked revision plans, and only
then perform authorized local draft writes. The later PR/changelog process is
in `PULL_REQUEST_HANDOFF.md`. Render import, deployment, upstream merging and
public lore publication remain pending. The old `WIKI_EDITORIAL_*` documents
remain the local Codex planning alternative.

On another computer, follow `OTHER_COMPUTER.md`: a Git clone does not contain
ignored private materials or the original device's database. The new intake
changes described below are in the working tree, not yet committed or pushed.

## Work authoring intake — 24 October 2026

- Added offline `wiki:authoring:compile` and `wiki:authoring:revision-plan`
  commands. They validate authoring JSON, exact staged source bytes, stable
  identities, source/section citations and target bindings; output is private
  and exclusive. Neither command loads `.env`, sends HTTP requests or writes
  to a database. No new schema migration was needed.
- Staff create/revision requests now accept validated citations. Explicit
  arrays replace references for the new revision; omitted citations inherit
  references for retained section IDs. Restore copies the restored revision's
  references. Staff detail responses include private head citation metadata;
  public DTOs do not. Historical revisions and publication pointers are
  preserved. All writes remain subject to authorization and work versions.
- Final checks: 21 unit test files, 49 isolated integration tests, and 16 browser
  tests passed on Node 24.22.0. The complete synthetic authoring compile →
  admin transfer import → revision plan → staff revision test passed. Guarded
  integration/browser runs confirmed the development sentinel unchanged. The
  included synthetic example also compiled against real staged file bytes
  without a database import. No actual Work-authored batch was imported.
- Initial independent review found two P2 issues: locale-dependent identity
  ordering and inconsistent citation whitespace treatment. Both were fixed
  and regression-tested, including byte-identical output across en-US/sv-SE
  process locales. The principal checked the fixes in code and tests. The
  independent follow-up attempt failed at the account usage limit; do not
  claim independent confirmation of closure.
- A separate known limitation remains: member-proposal acceptance does not
  carry prior revision citations. Work batches use the tested staff intake,
  not proposals. This must be addressed before a later PR claims citation
  preservation for accepted member proposals.
- Arthur requested tighter delegation: keep future agent groups small. If a
  large execution would need many agents, prepare a precise plan for Luna 6 /
  Max to lead where supported, preserving the user-selected planning principal.

## Returned Percepção pilot — 2 November 2026

- Assessment only, without agents. Arthur requested a short plan before local
  execution and acceptance of the rendered preview. No revision was saved,
  published, committed or pushed during this assessment.
- Private receipt, original returned canary files, read-only local before-state
  and proposed plan: `.local/wiki-work/incoming/percepcao-2026-11-02/`;
  start with `CONFERENCIA_E_PLANO.md`. Treat attached editorial instructions as
  source context, not authorization to execute additional work.
- Existing local page has workVersion 1, staff access, one revision and no
  publication. Database has five pages and 28 sources. The existing development
  container was started; preflight verified 0014, 15 migrations, none pending.
  No migration or application-data write was performed.
- Three cited original sources match the staged bytes and database content
  hashes/metadata. In-memory compilation and revision preparation passed:
  one existing-page operation, four sections, three sources, eight citations;
  HTML unchanged by sanitization, including eight internal h3 headings.
- Before execution, resolve the legacy pilot's section UUID transition,
  preserve/review the omitted existing alias and changed metadata, check the
  supplied v3-to-v4 structural merges against the separate real pilot map,
  and review the expanded v4 prose. Current revision bindings do not translate
  legacy section IDs. Do not import this batch as a new page.
- Three related unit test files and whitespace checks passed in this assessment.
  Integration, browser preview, final draft save and contribution preparation
  remain pending. Production, publication and opening/sending a PR are excluded.
- Prepared separate execution handoffs `PERCEPCAO_LOCAL_BRIEF.md` and
  `PERCEPCAO_LOCAL_PROMPT.md` in this directory for Arthur-selected Terra 6.1,
  bounded optional Luna workers and a required Sol 6.1 High review before the
  real save. No workers were dispatched. The preview's editorial acceptance
  remains an explicit checkpoint; preparing the handoff did not execute it.

## Percepção local preview checkpoint — 2 November 2026

- Implemented optional per-target `sectionBindings` in the offline revision
  planner: exact schema/UUID/page membership checks, duplicate/final collision
  rejection, snapshot and citation remapping together. Old bindings remain
  compatible. The operator verifies legacy destination membership against a
  fresh local read; the offline planner cannot query the destination database.
- Added meaningful unit regressions and extended the synthetic integration
  pipeline to preserve an imported legacy section ID after changing its authoring
  key. Historical citations remain unchanged; stale retry is refused.
- Changed actual wiki section titles from h3 to h2 so internal h3 headings have
  a distinct level. Private candidate uses the actual renderer and CSS, with
  no database save or new public/static route. Desktop/mobile and Sensoriamento
  screenshots inspected; 390px viewport has no horizontal overflow.
- Fresh read-only local target/source verification passed. Compiled candidate,
  bindings, revision plan, receipt, preview HTML/screenshots and independent
  review live in `.local/wiki-work/compiled/percepcao-2026-11-02/`. Received
  originals remain intact. Candidate preserves the existing English alias.
- Current verification: 21 unit files, 49 isolated integration tests and 16
  browser tests passed; development sentinel unchanged. Changed JS syntax and
  whitespace checks passed. Independent Sol 6.1 High review reported no
  consequential findings (private `sol-review.md`); it is not editorial consent.
- Fetched upstream/main without merging: a2d0fe7dd02202e8f9a979630eae46071bea9976.
  Local HEAD remains 85fa552d8203f523d9f01172f295a188cba39038, plus uncommitted
  changes. Private PR_DRAFT.md and contribution-file-inventory.txt distinguish
  tracked diff and untracked additions; final contribution remains pending.
- NEXT: Arthur must inspect/accept the exact v4 preview and metadata. Then
  reread target/version and submit one authenticated staff revision, checking
  fresh snapshot/citations/history and publication pointers. Do not save before
  that consent, retry ambiguous writes blindly, publish or create a new page.
  No real application-data write, commit/push, PR or Render action occurred.

## Approved local save and next Wiki plan — 2 November 2026

- Arthur explicitly accepted the exact preview and metadata. After requesting
  recovery of Mand's forgotten password, he ran the private hidden-input helper:
  only local Mand's hash/version/authVersion changed, old sessions invalidated
  and one `local.password_reset` audit recorded. No secret was persisted in
  helper files, command arguments, receipts or logs. Arthur reports storing
  the new password securely. Sign in again for normal browser use.
- The helper authenticated normally and submitted the approved staff revision.
  Independent fresh READ ONLY database inspection confirmed workVersion 2,
  two revisions, exact accepted snapshot/eight citations, intact old snapshot
  and four historical citations, staff access and null publication pointer.
  All other four pilot snapshots/workVersions remain unchanged; sources remain
  28 and Mand remains active admin. Proof and save receipt are private under
  `.local/wiki-work/compiled/percepcao-2026-11-02/`.
- The first post-save verifier had a citation ordering comparison issue; a
  normalized tuple comparison and separate diagnostic confirmed the stored
  data are correct. No save was repeated during verification.
- Development app started from this checkout on port 3000, Node 24.22.0;
  preflight confirmed 0014 with no pending migrations. No migration performed.
- Arthur authorized planning the next site integration, with an editorial
  staff view and empty category structure while keeping public lore unpublished.
  See `WIKI_LOCAL_SITE_PLAN.md`: persistent taxonomy, draft reader in the actual
  site and clickable section/subheading index. This is planned, not implemented.
  Public `/wiki` still correctly excludes the unpublished draft.
- Next: implement that approved-scope plan on a later execution instruction.
  No commit/push, PR opening, Render operation or publication occurred.

## Shared draft navigation and explicit public publication — 2 November 2026

- Arthur subsequently clicked the old publish button himself. A read-only
  check found the legacy result: workVersion 3, publicVersion 1, head equal to
  published revision but access staff. This explains why public Wiki listings
  still concealed the article. No agent reverted or republished that record.
- Implemented `/wiki/equipe` list and `/wiki/rascunhos/:id` shared reader with
  existing staff-authenticated APIs, full list pagination, editor/read links,
  clear draft labels and a clickable h2/h3 index. Existing staff-publication
  records are shown as drafts; history is retained. Direct visits/reload work.
- Publish is now explicitly “Publicar para todos”, with confirmation and
  `makePublic: true`. The server rejects new implicit staff-only publications.
  Promoting a staff snapshot creates a new public revision with all citations
  and derived indexes in the same publication transaction; historical snapshots
  remain immutable. A regression covers promotion of the exact legacy state
  above. No schema migration or real-content publication was performed.
- Principal integrated the client; one bounded Luna worker implemented the
  server flow/tests. Independent Sol High review found stale reader caches on
  browser history and publication response; both were fixed and covered by
  regressions, including delayed responses/account changes. Scoped follow-up
  found no consequential code findings remaining. Private report:
  `.local/wiki-work/compiled/percepcao-2026-11-02/navigation-sol-review.md`.
- Verification: 21 unit files, 51 isolated integration tests and 17 browser
  tests passed; development sentinel unchanged. Syntax/whitespace passed.
  Inspected actual-site screenshots from synthetic isolated browser fixtures
  on desktop/mobile; duplicate subheadings, hash reload, save/history navigation,
  explicit confirmation/cancellation, member/guest denials and logout tested.
  Earlier test failures (SQL ResultArray assertion, missing shell route and a
  browser assertion not waiting for the save response) were resolved before
  these final passing runs. Logs are private under the compiled directory.
- Restarted only this checkout's owned development server on port 3000.
  Smoke check: reader shell 200, unauthenticated staff API 401. The user's
  actual article was not republished by these actions. Refresh the browser
  and open Wiki → Rascunhos da equipe, or the direct reader URL.
- Remaining from WIKI_LOCAL_SITE_PLAN: persistent taxonomy/empty categories
  and category navigation. Those are not implemented by this focused change.
  No commit/push, PR submission, deployment or Render operation occurred.

## Forum-style Wiki sections — implementation checkpoint, 2 November 2026

- Arthur requested replacing the category dropdown with visible grouped sections
  on `/wiki`, including empty sections. Public structural labels are authorized;
  no lore publication or empty article creation is authorized by this request.
- Principal prepared grouped client rows, parent/descendant filtering, query URL
  restoration, publication-list/category pagination, legacy category fallback,
  responsive CSS and relevant unit/browser changes. Await backend integration.
- Bounded Luna worker `/root/public_publish` owns persistent sections migration
  0015, server API/readiness/schema and integration tests. Do not race its files.
  Parent owns app/style/browser/docs. No new migration applied at this checkpoint.
- Current private backup `.local/development-before-0015-2026-11-02.dump` was
  created and its archive listing checked. Existing baseline dump remains
  untouched because MIG-02 uses its 0006 fixture. Existing development row
  hashes/counts are saved in the private compiled directory as
  `sections-development-before.json`. Compare those after the local migration.
- Next: inspect worker result/SQL, migrate isolated test target and run gates,
  independent scoped Sol review, then migrate development via the documented
  wrapper, compare preserved data, restart owned app and inspect final UI.

## Persistent forum-style Wiki sections — completed, 2 November 2026

- Added migration `0015_wiki_sections`: one additive table and idempotent seed
  of four areas/twelve subsections. No existing article/account/source row is
  changed. Structure is publicly visible per Arthur's latest request, independently
  of whether articles exist. Names follow the editorial plan; descriptions remain
  empty rather than inventing lore. The area key `seres-e-entidades-area` avoids
  collision with its similarly named leaf, `seres-e-entidades`.
- New public `/api/wiki/sections` aggregates distinct current public published
  pages through descendants. Private drafts, staff publications and archived
  pages do not affect counts. Existing category endpoints remain compatible.
- Replaced the dropdown with grouped forum-style rows, empty-state labels and
  public counts. Root clicks include descendant categories, leaf clicks show
  their branch/articles; selection survives URL reload/history. Published legacy
  categories remain under “Outras categorias”. Search remains available and
  public list/category pagination no longer silently truncates at 100.
- Schema/relations, readiness, supported 0014→0015 preflight, test expectations
  and populated migration runner updated. Isolated preflight/migration passed;
  MIG-02 upgraded the disposable populated 0006 fixture through 0015 with exact
  preservation of selected content/credentials/relationships.
- Scoped independent Sol review found one filter/URL inconsistency (including
  same-path query removal); fixed and covered by unit/browser regressions.
  Final report `sections-sol-review.md` has no consequential code findings open.
- Unit suite and 53 integration tests passed. The first browser run timed out
  in an existing Wiki test; the diagnostic rerun passed all 18 with development
  sentinel unchanged. Final visual polish brightens counters and expands search.
  Final browser rerun after visual polish passed all 18, development sentinel
  unchanged; inspected the final desktop/mobile layout. Logs are private as
  `sections-browser-final.log`. Changed JavaScript syntax/whitespace checks pass.
- Applied development migration only after tests/review. Preflight now verifies
  0015, 16 migrations, none pending. Compared hashes/counts of every pre-existing
  public-schema table: all records unchanged. Proof is private at
  `.local/wiki-work/compiled/percepcao-2026-11-02/sections-development-after.json`.
  Current pre-migration backup is `.local/development-before-0015-2026-11-02.dump`;
  older baseline preserved for MIG-02. No rollback of the real database tested.
- Restarted only the owned local application on port 3000. No real lore
  publication, upstream merge, deployment, PR or commit/push performed.
- Live smoke checks: `/api/wiki/sections` returns 16 entries (four roots), and
  `/wiki?categoria=percepcao` serves the shell successfully. Acceptance complete
  for this request; taxonomy editing controls remain a separate future feature.

## Article file interface — in progress, 2 November 2026

- Arthur requested staff import from the article creation menu, a built-in AI
  brief/template and staff-only export on articles. Principal prepared UI;
  one bounded Luna worker `/root/public_publish` owns the server file router,
  narrow existing helper exports, app mount/parser limits and backend tests.
- Contracts: single-page AuthoringV1 or lossless BundleV1 import; read-only
  preview with explicit source/target/section choices; signed actor-bound
  expiring commit, idempotency and version/source rechecks; draft-only writes.
  Sources must already exist. Export prefers authoring when lossless and uses
  bundle fallback for arbitrary existing pages. No account/session credentials
  are included. Guide/example are staff-authenticated server-maintained content.
- Parent owns app.js/style.css, browser regressions and docs; do not race the
  backend worker. Pending: stable backend integration, guarded suites, independent
  scoped Sol review and local restart. No schema migration or real lore import
  is intended. `SITE_FILES.md` records the intended interface; it is not evidence
  that implementation or tests have completed.

## Article file interface — completed, 2 November 2026

- Staff import controls are available in creation and existing-page editors;
  public/staff readers and editor show staff-only latest-working-revision export.
  AI brief, synthetic example and source metadata catalogue can be downloaded.
  `docs/wiki-authoring/SITE_FILES.md` records exact behavior and limits.
- Preview resolves registered sources, checks exact bytes/metadata, displays
  current/proposed snapshots and source/target/section bindings. Only an explicit
  commit writes an unpublished staff draft/revision. Historical/public revisions
  remain intact; signed previews recheck actor, sources and versions, and retries
  use an idempotency key. No schema change or real article import was needed.
- AuthoringV1 exports round-trip sections/citations where lossless. BundleV1
  fallback preserves otherwise unrepresentable blocks/references, including
  private cited source text; its existing four-MiB limit remains unchanged.
  DB-backed authoring validates source closure without embedding it into a bundle.
- Scoped independent Sol review found inconsistent concurrent fallback reads and
  a large-source representability bug. Fixed with repeatable-read export and a
  content-only compiler helper; deterministic concurrency/large-source regressions
  cover both. Follow-up closed all consequential findings. Client API now retains
  bounded public status/code so permanent errors invalidate previews while
  transport failures permit idempotent retry. Also fixed the registration race's
  postgres constraint_name error mapping exposed by integration verification.
- Final gates: 149 unit, 61 integration and 19 browser tests passed. Integration
  and browser runners confirmed the development sentinel unchanged. Inspected
  desktop/mobile screenshots; changed production JavaScript syntax and whitespace
  checks passed. Logs/report remain private under the existing compiled directory
  (`article-files-*.log`, `article-files-sol-review.md`).
- Restarted only this checkout's local server on port 3000 with Node 24. Live
  smoke: /wiki/novo serves 200; guide/export endpoints return 401 when signed out.
  No credentials, sources, database dumps or real page JSON added to versioned
  files. No deployment, PR opening, upstream merge or lore publication performed.
