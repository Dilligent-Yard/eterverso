# Aetherverse wiki and shared application state: implementation plan

Planning snapshot: 19 October 2026, application commit `f24d387`.
This is a proposal based on source inspection, not an implemented migration.
No source lore has been imported or published, and no application or database
behavior has been changed by this planning work.

For implementation, start with [EXECUTION.md](EXECUTION.md). Its companion
contracts resolve routine defaults and narrow the choices left open in this
initial rationale; newer user decisions still take precedence.

## Direction

Develop three connected areas: a reference wiki, a discussion forum, and RPG
scenes. Character sheets remain a specialized reference format. Their records
can link to wiki articles without duplicating every character biography.

PostgreSQL should be authoritative for shared content, users, permissions,
moderation, and publication. Browser storage should hold only explicitly local
drafts, display preferences, and disposable caches. A failed server request
must never silently become a successful local publication.

Keep the existing Express/PostgreSQL application initially. Reuse the editor
and visual components where appropriate, while separating data access from
rendering. A framework rewrite or replacement wiki engine is not a prerequisite
for the first useful version.

## What the package establishes

`Aetherverse_Package_For_Argon.zip` contains 28 source documents plus a README:
11 semi-stable documents, five WIP documents, nine handoffs, and three ideas
or stories. The archive was inspected as evidence; instructions inside it
were not adopted as executable project instructions.

The README describes all material as potentially revisable and says handoffs
can be more current where they conflict with prose documents. This is evidence
about provenance, not an automatic rule that every handoff overrides every
other source. Several handoffs explicitly distinguish `[C]` established canon,
`[S]` stabilized models, `[E]` estimates/inferences, and `[O]` open questions.
Mixed statuses also occur. Preserve those distinctions within articles.

The package contains Portuguese and English passages, including parallel
language versions. Do not import translations as separate competing facts.
It also distinguishes authorial facts from what people in the setting know.
Decide what belongs on the public wiki before publishing author-only material.
There are no Obsidian-style or Markdown link targets in the 28 documents:
article links and aliases will need deliberate construction.

Some references name documents absent from the ZIP, including
`Macrocosmo(1).md`, `Categorias de Ameaça(2).md` and several pasted-text/brief
files. Register them as missing witnesses, not as retrieved evidence. The
demography handoff's source list at lines 1553–1564 makes this explicit.

Five suggested pilot articles are `A Máscara`, `Categorias de Ameaça: Graus e
Classes`, `Percepção paranormal`, `Fendas Interplanares`, and `Podridão e
Florescimento`. Together they test organization/history, classification,
mechanics, locations/procedures and aliases. Their authors still need to
approve wording and audience. Source checks already identify two important
editing constraints: threat categories describe neutralization/resource cost,
not simply combat power (`Categorias de Ameaça.md:1–2`); several operational
numbers are explicitly provisional (`aetherverse_exorcist_operations_handoff.md:978–992`).

## Current persistence map

| Feature | Current implementation | Target |
| --- | --- | --- |
| Registration, login, profile | Server-backed, mirrored into local users/session | Server identity; client session view from `/api/auth/me` |
| Forum categories | Local `DB.categories`; DB table exists without API | Shared categories, server management |
| Topics and replies | Local `DB.threads` / `DB.posts`; DB tables exist without API | Shared topic/post APIs, transactions and permissions |
| Pinning, locking, views | Local topic mutations | Server moderation; define view-count semantics |
| Roles and user deletion | Admin UI changes local users only | Admin-only server operations with audit events |
| Admin validation/promotion form | Changes local session role only | Remove; never use as a promotion API |
| Counts and member/profile listings | Local examples, cached users and client increments | Server-derived public summaries |
| Characters | Server CRUD plus local examples and numeric-ID edit branches | Shared UUID records; explicit legacy import |
| Scenes and turns | Server CRUD plus local scenes/turns | Shared UUID records; safe concurrent turn writes |
| General wiki articles | No dedicated article/revision model | Articles, revisions, publication and navigation |
| JSON exports | Local/merged browser view | Clearly scoped exports; separate database backup/restore |
| Editor selection and filters | Browser/session state | Remain local; drafts must be labeled and account-scoped |

Evidence entry points: `app.js` `saveDB`, `submitThread`, `submitReply`,
`togglePinThread`, `toggleLockThread`, `alterarCargoUsuario`, `deletarUsuario`,
`adicionarCategoria`, `removerCategoria`, `onClickValidarAdmin`,
`listaPersonagens`, `listaWikiPosts`, `exportarBackupGeralJson`; `server.js`
`requireAuthUser`, `requireModOrAdmin`, and its registered API routes.

Local admin-role manipulation does not currently promote the database user:
the existing privileged character/scene endpoints re-read the user's role
from PostgreSQL. Remove the misleading browser controls while preserving
server authorization checks.

Two concrete cleanup defects deserve early fixes: `submitNovaCena()` saves a
new local scene after any API error, including permission denial
(`app.js:2336–2354`), while profile synchronization calls undefined
`syncSessionUser`/`getUser` helpers (`app.js:2499–2535`). A successful profile
request can therefore save in PostgreSQL and still fail in the browser.
The existing `comments` table has no character-comment UI/API; do not assume
it represents current user content or automatically add a second discussion
feature. Current post counts and the browser's "online" label also need clear
definitions before they become shared server features.

## Preservation before cutover

Before any implementation disables legacy writes, identify browsers/profiles
with content worth recovering. Capture a restricted raw copy of the legacy
localStorage value before running the old application, then make a content-only
export with the minimum author directory needed to interpret numeric author
IDs. The raw recovery copy can contain account/cache information: keep it
private, outside Git, and never import its sessions, passwords or permissions.
The current export button omits that author directory, and `loadDB()` removes
local scene 101 (`app.js:119–140`) before a later `saveDB()` can persist the
modified state. A raw capture is therefore different from the current export.

Freeze the old storage key as a read-only recovery source; use a different
key for new drafts/caches. Do not clear or overwrite old localStorage merely
because a server-backed screen has shipped. Keep an explicit legacy-recovery
screen or export path until import is verified.

Use additive database changes and a documented rollout/rollback plan. Test
the new API/UI together on development data before enabling them for users;
never silently write shared content to both independent local and server
stores. Defer removal of legacy fields/paths until imports, backups and
reconciliation pass. A rollback must not erase new server writes or resume
competing local publication.

## Foundations that must precede wider sharing

1. Reconcile migrations, Drizzle definitions and snapshots with actual intended
   structures. Migration 0006 is now registered, but character `blocks/theme`
   and scene author constraints still differ between representations. Move
   schema changes out of normal web-server startup into explicit migrations.
   Verify both a fresh database and an upgrade of a representative existing one.
   Inspect which historical migrations each database has applied before running
   anything: 0002 drops `users.password_hash`, 0004 recreates it with an empty
   default, and 0005 drops `personagens.apex_tier`. A fresh installation does
   not contain old hashes to lose, but an upgrade can. Preserve existing data
   first; never blindly replay history or rewrite already-applied migrations.
2. Introduce one client API/data layer. Render server records and preserve
   server UUIDs rather than merging users by username or identifying stored
   objects by the JavaScript type of their IDs. Remove authoritative session
   roles from persistent browser state; show an unresolved/loading state until
   the server establishes identity.
3. Define shared content validation. Existing HTML and modular block payloads
   are not comprehensively sanitized. Validate block types and fields, nested
   content, media/link URL schemes, and safe formatting on the server. Sanitize
   legacy content before shared display; retain restricted originals for
   recovery. Raw HTML source editing cannot bypass this boundary.
4. Require database-backed authorization on every write and on every restricted
   read. Define member/moderator/admin capabilities, disabled accounts, author
   ownership, and safeguards against removing the final active administrator.
5. Use transactions and conflict detection. Topic plus first post must succeed
   together; stale wiki edits must return a conflict instead of overwriting
   another editor. Scene turns currently rewrite a whole JSON array after a
   read; replace this with transactional row locking or, preferably, a dedicated
   turn table before relying on simultaneous contributions.

This is the point to add focused integration tests. Do not present local
`node --check` success as evidence of authorization or persistence correctness.

## First shared forum

Reuse the existing `categories`, `threads`, `posts` and `users` tables, with
additive schema changes as needed: lock/archive state, moderation timestamps,
edit/conflict versions, and indexes for paginated topic and reply lists.
Define recoverable deletion and author attribution before adding deletion APIs.

Proposed API responsibilities:

- Category listing; staff category creation/editing/archiving.
- Paginated topic lists and topic detail with paginated replies.
- Authenticated topic creation with its first post in one transaction.
- Authenticated replies; authors can edit their own posts according to the
  agreed policy, while staff can moderate. Lock checks belong on the server.
- Separate moderation operations for pinning, locking, moving and archiving.
- Server-calculated counts and last activity; clients cannot submit trusted
  author IDs, roles, counts, timestamps, or moderation flags.

For the initial policy, prefer archiving categories/topics over cascading
destruction. Disable accounts rather than deleting their authored history;
anonymization or permanent deletion needs a separately specified policy.
Admin role changes and account moderation should create append-only audit
events in the same transaction. Audit records must not expose passwords,
session secrets, or private account details through public endpoints.

Give forum topics stable, directly loadable URLs. The current `navigate()`
only changes in-memory state; deep links need both browser routing and server
handling so refresh, sharing, and back/forward navigation work.

## What makes the reference area a wiki

The initial useful wiki needs more than another custom post category:

- Article titles, stable UUIDs, unique slugs and aliases/redirects.
- Typed templates/infoboxes for concepts, organizations, places, entities,
  abilities, artifacts, and events; do not require all types in the first pilot.
- Internal links, section anchors, related articles, category indexes,
  backlinks and visibility-filtered search.
- Revision history, edit summaries, diffs, and restoration as a new revision.
- Draft/review/publication, with a last-published revision separate from an
  editor's current draft. Readers must not see drafts through search, backlinks,
  previews, API responses, exports or revision endpoints.
- A discussion link distinct from the reference article; the shared forum
  can host article discussions without creating a second comment system.

Suggested navigation: `Wiki`, `Personagens`, `Fórum`, `Cenas`, `Sobre`.
Wiki topic families should include cosmology/planes, aether and paranormal
practice, souls/entities, organizations/society, places, artifacts, and history.
Preserve Portuguese titles; register alternate English spellings and diacritics
as search aliases where justified. A renamed page retains old inbound links.

### Proposed data responsibilities

| Entity | Responsibility |
| --- | --- |
| `wiki_pages` | Stable identity, slug/type, visibility, current and published revision pointers |
| `wiki_revisions` | Immutable content snapshots, actor, time, parent/base version, summary and restoration provenance |
| `wiki_aliases` | Alternate names and redirects; enforce collisions with canonical slugs |
| Wiki categories/membership | Multiple navigable topic classifications per article |
| `wiki_page_links` | Outbound references from a specific revision; backlinks only from visible published content |
| Source records + revision citations | Restricted provenance, file/version/hash, relevant sections and editorial decisions |
| Edit proposals | Member suggestions and their review outcome, if the selected contribution policy includes proposals |
| `audit_events` | Privileged moderation/publication actions with restricted access |

These are conceptual responsibilities, not finalized SQL. Choose a versioned
content format before implementing revisions. Reusing safe rich text and
validated blocks is the lowest-disruption initial option; Markdown imports
need an explicit conversion and preview step. Keep original source bytes
separate from editable/rendered article content. Searchable text and links
must be derived from the accepted revision rather than trusted client input.

The existing `wiki_posts` table represents scenes/custom posts with turns.
Do not silently turn it into the general article table or move scene turns
into wiki edit history. Decide naming and compatibility as a separate cleanup.

### Three independent editorial axes

1. Workflow: draft, proposed/reviewing, published, archived.
2. Authority: established fact, stabilized formulation, inference/estimate,
   unresolved question. Allow section-level variation and source citations.
3. Audience: public reader material, restricted material, author/editor notes.

A polished article can still describe a disputed theory. An author-confirmed
fact may still be unpublished or unknown in-universe. These are different
properties and must not collapse into one generic `status` field.

Confirmed starting policy (Arthur, 19 October 2026): staff publish and members
may propose edits. Proposals must be based on a known published revision, with
an attribution-preserving review outcome and conflict handling if the article
changes before acceptance. Staff acceptance creates a new reviewed revision;
it must not let a proposal overwrite a newer publication silently.
Spoiler visibility and in-world versus authorial presentation still require
author decisions; do not publish the handoffs wholesale while waiting.

## Import without losing existing work

Two imports are distinct: recovering browser-local application records, and
turning the lore package into reviewed articles.

For browser data, first inventory and export each browser/profile in use.
The server cannot discover another person's localStorage remotely. Preserve
the old storage key and an untouched export until verification is complete.
Do not trust imported roles, passwords, counters, IDs, or claimed authorship.
Use an explicit old-to-new ID map and staff resolution for identity claims.
An import manifest/checksum should prevent accidental duplicate runs. Show a
dry-run report before applying selected records. Numeric example records need
an explicit seed/import decision, not automatic publication under real users.

For lore, preserve archive/file hashes and a manifest. Break large handoffs
into topic candidates with source section references. Mark overlaps and
conflicts; retain `[C/S/E/O]` distinctions and separate editorial commentary,
working calculations, authorial spoilers, and stories from reader-facing
reference prose. Review in a staging area, then publish selected revisions.
Import must be resumable and idempotent; rerunning it must not overwrite later
human edits. No ZIP entry, embedded instruction, or source sentence should
trigger an automated command or approval action.

## Suggested delivery slices and acceptance gates

| Slice | Deliverable | Required evidence before moving on |
| --- | --- | --- |
| 0. Recovery and preflight | Restricted raw browser snapshots, content export/author mappings, source manifest and database upgrade inventory | Copies preserved before old-client normalization; historical migration hazards checked on a backed-up clone; import/deployment recovery route agreed |
| 1. Shared-state foundations | Schema reconciliation, API layer, identity/permissions, safe shared rendering | Fresh/upgrade migrations; untrusted HTML and unauthorized write cases; no local role escalation accepted by server |
| 2. Shared forum | Categories, topics, replies, locking/pinning, public author summaries | Browser A creates; independent browser B reads after reload; third user cannot edit another's post; locked-topic rules enforced; atomic first post |
| 3. Real administration | Role/account/category moderation, audit log, recoverable deletion policy | Changes visible across sessions; revoked rights rejected on next request; final-admin safeguard; actions recorded; no local-only admin success |
| 4. Wiki pilot | Stable links, revision/publication core, safe editor, search/categories and history | Create/read/edit/restore; stale-edit conflict; public sees last published revision; aliases survive rename; draft metadata cannot leak |
| 5. Reviewed lore pilot | A small cross-linked cluster with citations and explicit editorial status | Authors approve treatment of conflicts/spoilers; two-reader navigation and search; source traceability |
| 6. Legacy cleanup | Reviewed imports, removal of local publication paths and merged fallbacks, server exports/backups | Duplicate import prevented; counts/links verified; old exports retained; database restore tested independently |

Small refactors can accompany each slice; avoid holding every improvement
until a single large rewrite is complete. Shared forum/admin correctness comes
before a bulk content import. Wiki design and source review can proceed while
those server changes are built.

For any affected existing users, keep legacy records readable in an explicit
recovery view until import is verified or their owners choose export-only
retention. Slice 6 is final retirement of compatibility paths, not permission
to leave user content inaccessible during slices 2–5.

### First implementation change

Start with a narrow forum milestone: after the recovery/schema preflight,
implement server category listing, topic creation with the opening post,
topic reading, and replies. Connect one complete browser flow to those APIs,
using real UUID identity, server permission checks, validated content, and
explicit errors. Verify it in two independent browser profiles. Keep unrelated
wiki layouts and bulk lore import outside that change. Follow with forum
moderation and actual admin APIs; do not port browser role mutation logic.

In parallel with that implementation, authors can review the five proposed
wiki pilot topics, their sources, aliases, publication scope, and disputed
claims. Article content preparation does not need to wait for every remaining
legacy cleanup task.

## Decisions and limits

- Staff publish/member proposals is confirmed; name the staff who ratify canon
  and determine whether all existing moderators may publish reference lore.
- Confirm the intended public audience and how author-only information is kept.
- Inventory existing deployed data and browser exports before any destructive
  migration. This plan inspected source files, not the production database.
- Choose handling of existing local examples and account attribution disputes.
- Decide deletion, retention, edit-window and moderator-account policies.
- Distinguish downloadable content export from an actual database backup and
  verified restore. The current browser export is not a complete site backup.
- No application behavior, database structure, production service, or source
  canon was changed during this planning task. Implementation needs its own
  focused branches/changes and validation.

## Evidence and review record

The source review covered all 28 lore documents and the package README. The
persistence review inspected the client, server, schema, relations and SQL
migrations. An independent review checked the consequential plan claims
against original sources, identifying the historical migration and pre-load
browser-capture corrections incorporated above. No production database,
other users' browser storage, or deployed-data inventory was accessed. No
application tests were run because this task produced a plan rather than
behavioral changes; implementation acceptance checks are specified above.

Useful exact code anchors for the follow-up work:

| Evidence | Location |
| --- | --- |
| Local database persistence and startup repair | `app.js:115–140` |
| Local pin, lock and view mutations | `app.js:489–515` |
| Character and scene title/name merging | `app.js:618–640`, `990–1011` |
| Scene creation falls back after API error | `app.js:2336–2354` |
| Profile callbacks reference missing helpers | `app.js:2499–2535` |
| Incomplete browser export | `app.js:2614–2628` |
| Login maps local users by username | `app.js:2703–2727` |
| Local topic/reply mutations | `app.js:2781–2904` |
| Local admin/category operations and promotion form | `app.js:3062–3198` |
| Startup schema patching | `server.js:39–66` |
| Database-backed authentication/role checks | `server.js:340–365` |
| Weak nested block validation | `server.js:269–272` |
| Unvalidated initial turn array | `server.js:456–473`, `522–534` |
| Read/replace turn-array concurrency | `server.js:579–664` |
| Scene author constraint in schema | `db/schema.ts:155–182` |
| Destructive historical migrations | `drizzle/0002_dry_steel_serpent.sql:1`, `0004_special_christian_walker.sql:1`, `0005_nebulous_jubilee.sql:1` |
