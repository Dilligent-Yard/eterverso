# Architecture and ownership

This document describes the current source shape at this revision. It is
descriptive guidance for contributors and reviewers; it is not a substitute for
reading the code. Verify exact commands in `package.json` and the current
implementation before relying on an old note.

## Runtime at a glance

The browser loads a plain HTML shell, root JavaScript files and one generated
classic-script bundle. Express serves the shell, a static allowlist and the JSON
API. PostgreSQL is the shared source of truth.

- `index.html` is the page shell and loads `/generated/vault.js` before the
  root browser scripts.
- `app.js` remains the browser composition, rendering and navigation owner. It
  calls selected helpers on the generated `VaultModules` global.
- `client/api.js` is a small adapter: it creates the API/session/CSRF client
  from `VaultModules.api` and exposes it as `Aetherverse`.
- `editor.js` implements the rich-text editor; `style.css` defines the
  appearance.
- `server.js` is the canonical Node startup. It loads `.env`, reads runtime
  configuration, verifies migration history and required columns, creates the
  Express app and listens. It does not run DDL.
- `server/app.js` creates the Express app, applies shared middleware, serves the
  static allowlist and mounts the feature routers.
- `db/schema.ts`, `db/relations.ts` and versioned SQL in `drizzle/` define the
  schema. Runtime queries use an injected `postgres` client; `db/index.ts` is
  not the runtime query path.

## Ownership by responsibility

| Responsibility | Current owner | Boundary and effects | Transitional note |
| --- | --- | --- | --- |
| HTTP bootstrap and runtime configuration | `server.js`; `src/node/runtime/config.ts` emitted to `.generated/node/runtime/config.js` | Loads `.env`, validates `DATABASE_URL`, `SESSION_SECRET`, port and production origin, verifies readiness, starts Express, installs shutdown | Readiness constants are currently maintained in `server.js` |
| Express composition, static allowlist, shared auth/profile/character/scene routes | `server/app.js`, `server/auth.js`, `server/avatar.js`, `server/dto.js`, `server/validation.js`, `server/errors.js`, `server/content.js` | Mounts routers, creates sessions and CSRF protection, enforces fresh identity and roles, validates requests, sanitizes HTML/blocks, maps public errors | Large JS composition surface remains by design |
| Forum topics, replies and moderation | `server/forum.js`; browser rendering in `app.js` | Server-backed categories, topics, posts, versions, locking, idempotency and recoverable moderation | Browser draft and pending-reply lifecycle still live in `app.js` |
| Accounts, roles, categories and administrative audit | `server/admin.js` | Admin-only account/role/category operations, final-admin protection, transactions and audit events | Administrative UI remains in `app.js` |
| Reference wiki core | `server/wiki.js` | Pages, immutable revisions, names/redirects, publication snapshots, history, citations and derived indexes | Citation shape validation is split across wiki, article-file and transfer code; proposal acceptance retains the base publication's citations for sections that remain |
| Member proposals | `server/proposals.js` | Private proposals, staff review, version/base checks and accepted draft creation | Accepted proposals retain the base publication's citations for retained sections; proposals do not accept citation edits |
| Restricted sources | `server/sources.js` | Private source records, hashes, metadata and staff-only access | Source text must never become a public/static asset |
| Portable wiki transfers | `server/wiki-transfers.js` | `AetherverseWikiBundleV1` validation, preview, refresh, mapping and transactional import | Creates unpublished staff drafts and private sources |
| Staff article files | `server/wiki-article-files.js` | AuthoringV1/BundleV1 import, signed preview, explicit commit and latest-revision export | Uses the same citation and source validation as the wiki |
| Wiki section structure | `server/wiki-sections.js` | Public section tree and distinct public page counts | Editing UI for the taxonomy is not implemented |
| Legacy import and scene-turn normalization | `server/legacy-import.js`, `server/scene-turn-normalizer.js`, `scripts/normalize-scene-turns.js` | Synthetic/import validation, raw-turn preservation, idempotent normalization and reconciliation reports | Real browser exports and author mapping remain separate decisions |
| Interactions, notifications and turn likes | `src/node/interactions/` emitted and loaded by `server/interactions.js` | Notification and like routes, turn-target resolution and public notification DTOs | Typed island already owns this route family |
| Timeline and audit | `src/node/timeline/` emitted and loaded by `server/timeline.js` | Public timeline reads, staff writes, expected-timestamp checks, audit events and explicit empty-timeline seed | Timeline schema/seed ownership remains split with scripts and readiness |
| Browser API, session and CSRF | `src/browser/api/client.ts` emitted into `VaultModules.api`; `client/api.js` adapter | Same-origin requests, CSRF token lifecycle, session cache, error mapping and logout behavior | Shell receives a narrow API surface rather than server internals |
| Browser routes, post records and participant rows | `src/browser/navigation/`, `src/browser/forum/post-records.ts`, `src/browser/records/validation.ts`, `src/browser/scenes/participants.ts` | Pure route mapping/parsing, post version selection and merge, imported-record validation, participant-row helpers | `app.js` remains the renderer and caller |
| Public capture, import and sandbox | `src/node/public-snapshot/`, `src/node/public-sandbox/`; adapters under `scripts/` | Anonymous read-only capture, private capture output, target ownership checks, separate sandbox lifecycle/import | Operational tooling; not part of ordinary app startup |
| Schema and migrations | `db/schema.ts`, `db/relations.ts`, `drizzle/`, `scripts/db-migrate.js` | Versioned Drizzle SQL, preflight/report classification, target checks and guarded migration wrapper | Schema expectations are duplicated between readiness and preflight |
| Legacy recovery | `legacy-recovery.html`, `legacy-recovery.js` | Reads and downloads the old browser storage value without loading `app.js`; separate content recovery workflow | Retained for recovery; never merge recovered samples into canonical lists |
| Tests and test environment | `tests/unit/`, `tests/integration/`, `tests/browser/`, `scripts/test-env.js`, `scripts/test-runner.js` | Unit, isolated PostgreSQL/HTTP and Playwright coverage; private test configuration and development sentinel checks | Test counts belong to a tested commit |

## Data authority and browser state

PostgreSQL is authoritative for shared records. The shell may keep in-memory
view caches for rendering, such as loaded forum pages, notifications and the
current session. Those caches are not a second database.

Browser storage is limited to account-scoped drafts, preferences and the
separate legacy recovery workflow. Draft keys are versioned and include the
account identity. A failed request must keep or discard a draft according to its
documented behavior; it must never turn a failed shared write into a local
success. The legacy `DB` object in `app.js` is sample/scaffolding state, not
shared persistence, and shared screens load API data.

Server authorization, session freshness, CSRF, validation, sanitization,
transactions, row locks and version checks remain runtime responsibilities.
Types and DTOs describe shapes; they do not enforce those guarantees.

## TypeScript and build boundaries

- Typed browser code lives under `src/browser/` and is bundled by esbuild as an
  IIFE exposing `VaultModules`. The output `generated/client/vault.js` is
  ignored by Git.
- Typed Node code lives under `src/node/` and compiles as CommonJS into
  `.generated/node/` via `tsconfig.node-build.json`. The output is ignored by
  Git and loaded by small CommonJS adapters or scripts.
- `npm run build` runs `typecheck`, `build:node` and `build:client`.
  `npm run typecheck` covers the legacy schema/server entry plus Node and
  browser islands. `npm run lint:typed` applies strict typed rules to the
  typed islands.
- `src/server.ts` is an optional TypeScript entry that delegates to the
  canonical `server.js` startup; `npm start` remains the default.
- Installation runs `npm run build` through the `postinstall` hook. The hook
  needs development dependencies (TypeScript and esbuild), so a
  production-only install cannot build it. Install with development tools,
  build, then prune for a runtime artifact.
- Startup does not compile TypeScript, apply DDL, run migrations or seed
  content. `scripts/check-build.js` only checks that required generated files
  exist; it does not prove they are fresh.
- The server serves an explicit static allowlist from the repository root. The
  build does not relocate root SQL, assets, `.env` or seed material.
- Typecheck, typed lint and build are separate gates. A successful compiler or
  bundle does not prove runtime behavior.

## Shell and adapter rules

- The browser shell owns rendering, navigation, composition and compatibility
  wiring. Policy state machines should have a named owner rather than living in
  event handlers by accident.
- Typed browser modules receive explicit inputs and return values. They must not
  reach back into unintended shell globals. Expose only the fields a caller
  needs; prefer returning new values over mutating caller-owned records.
- Server DTOs keep private fields out of public responses. Browser code receives
  a narrow API surface, not server internals or unrestricted database rows.
- Node islands receive the injected SQL client, auth object, configuration and
  repository root. Adapters may delegate and translate call shapes; they must
  not preserve a second implementation.
- Async results need request/generation/version identity appropriate to the
  operation so a stale response cannot repopulate a newer screen or account.
- A new module or function abstraction must remove or isolate real coupling.
  Generic layers, dependency-injection frameworks and file-per-type rules are
  not goals.

## Transitional seams and retirement map

The list below records known seams, not authorization to rewrite them. Each
change should transfer one responsibility, keep runtime safeguards, and remove
the old authoritative path rather than adding a parallel one.

| Seam | Current state | Why it remains | Risk | Retirement condition or trigger |
| --- | --- | --- | --- | --- |
| Pending-reply controller | `app.js` globals `pendingReplyKey`, `pendingReplyPayload`, `pendingReplyThreadId`, `pendingReplyAccountId`, `serverForumPendingReply*` and their helper functions | Keeps a submitted reply visible across a failed/retried page load while the server confirms it | Duplicate pending/server records, account bleed or stale version display | Move idempotency and pending visibility to one typed forum record owner with account-scoped identity and tests |
| Forum draft lifecycle | `app.js` `aetherverse:forum-draft:*` read/write/restore/clear helpers and pending idempotency keys | Preserves unsaved topic/reply text across reloads and account changes | Draft remains local while a server write succeeded; stale draft restoration | Retire when a typed draft owner covers forum editor state and submission identity, with account isolation and failure-path tests |
| Generic resource form apply/rollback | `app.js` `captureResourceFormDraft`, `applyResourceFormDraft`, `restoreResourceFormDraft`, plus scene/character capture and restore helpers | Protects character/scene/profile forms from lost input on error or navigation | Partial application, stale form state, divergent validation between shell and server | Transfer one form family at a time to a typed model/controller; require before/after owner tests and removal of the old apply path |
| Citation persistence | `server/wiki.js` revision citation read/write and inheritance; `server/proposals.js` acceptance path; shared validation in article files/transfers | Wiki revisions, proposals and imports share citation shapes but not one policy owner | Citation behavior can drift between paths | Define one citation owner/policy for staff revisions, proposal acceptance and imports; keep retained-section inheritance covered by acceptance-regression tests |
| Migration/readiness ownership | `server.js` required migration/columns; `scripts/db-migrate.js` expected schema/classification; `drizzle/meta/_journal.json` | Startup must reject an unready schema; preflight must classify supported states | The two expectations can drift after a schema change | Generate or share one typed schema contract/manifest used by readiness and preflight; trigger on the next migration or verification-gate change |
| Remaining JS routers and renderers | `server/forum.js`, `server/admin.js`, `server/wiki.js`, `server/proposals.js`, `server/sources.js`, `server/wiki-transfers.js`, `server/wiki-article-files.js`, `server/wiki-sections.js` and `app.js` rendering/forms | These routes and screens are integrated and behavior-tested; extraction has not been justified per responsibility | Large mixed surfaces hide ownership and invite duplicate policy | Extract per feature only when a bounded owner transfer removes real duplication and keeps route/UI behavior covered; do not perform a wholesale rewrite |
| Legacy recovery/import | `legacy-recovery.html/js` and `server/legacy-import.js` | Old browser snapshots and real-data recovery remain a separate supported workflow | Accidentally treating recovered samples as canonical shared data | Retain until real recovery decisions are complete; remove only with an explicit data-retirement decision |

## Machine-enforced boundaries

No architecture checker or machine-readable boundary configuration exists at
this revision. Any future architecture checker would own the exact file baseline
and import/cycle rules; this document explains rationale and should link to that
configuration once one exists. Until then, these boundaries are review
guidance, not a passing gate.

Known limits of any file-list or import policy: existing-file policy growth,
dynamic indirection and semantic duplicate ownership still require human
review. A clean checker result would not prove that a state machine has one
authoritative owner or that runtime authorization is correct.
