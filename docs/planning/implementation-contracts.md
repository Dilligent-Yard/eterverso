# Implementation contracts

Read with [EXECUTION.md](EXECUTION.md). These are selected v1 defaults, not
claims that the current application already behaves this way. Do not widen
scope to fill every possible future feature. The principal may refine a
technical detail when original code/testing proves it necessary, recording
the reason and preserving the stated behavior and privacy guarantees.

## A. Modules and cross-cutting behavior

### A1. Application structure

- Root `server.js`: load/validate config, create SQL connection, verify schema
  readiness, call `createApp`, listen, handle shutdown. No startup DDL.
- `server/app.js`: CommonJS `createApp({ sql, config })`, returning an Express
  app without listening or reading `.env` at import time. Tests inject their
  own SQL/config. It registers feature routers and a final JSON error handler.
- `server/auth.js`, `errors.js`, `validation.js`, `content.js`, `dto.js`:
  shared helpers. Feature routes/services get these helpers plus injected SQL;
  they must not open their own connections or read a different database URL.
- Feature modules: `server/forum.js`, `admin.js`, `wiki.js`, `proposals.js`,
  `legacy-import.js`. Extract existing character/scene routes incrementally.
- Browser modules can be classic scripts under `client/`, using one namespace
  such as `window.Aetherverse`. Specify exported methods before assigning a
  dependent worker. No bundler is needed. Explicitly allowlist served assets;
  never replace the static allowlist with a repository-root static mount.
- Keep existing `/api/auth/*`, `/api/personagens`, `/api/wiki-posts` response
  wrappers while adapting internals. Add `version` fields where needed; update
  every caller/test together. Old `wiki-posts` continues to mean scenes.

### A2. HTTP conventions

- JSON keys for new APIs are camelCase; SQL columns snake_case. IDs are UUID
  strings, timestamps UTC ISO-8601 from server, never formatted date strings.
- New single-resource response: `{ "data": <dto> }`. New collections:
  `{ "data": [], "page": { "limit": 20, "offset": 0, "hasMore": false } }`.
  Offset pagination is sufficient initially: limit 1–100, default 20, stable
  ordering with an ID tie-breaker. Do not implement an elaborate cursor system.
- Preserve `{ "error": "Portuguese message", "code": "MACHINE_CODE" }` on
  errors so old callbacks remain usable. `details` may contain safe field
  errors; never SQL, stack traces, source text, emails or another user's data.
- Status: 400 invalid shape/value; 401 missing/expired/disabled identity;
  403 recognized but insufficient capability; 404 absent or inaccessible wiki
  object; 409 stale version/state/name/idempotency conflict; 413 size limit;
  428 missing required write version. Writes return 200, creates 201. Archive,
  hide and disable are explicit state changes, not HTTP DELETE operations.
- Edits/moderation carry integer `expectedVersion` in JSON. Compare inside
  the mutation transaction after locks; mismatch makes no partial change.
  Do not trust a timestamp as a conflict token. Wiki public version differs
  from its staff work version, as described below.
- Version/order values must fit positive PostgreSQL integer range; reject
  strings, fractions and overflow rather than relying on JavaScript coercion.
  Detect increment exhaustion as an explicit conflict; never wrap or emit
  JavaScript BigInt values in JSON.
- Reject unknown writable properties rather than mass-assigning request bodies.
  In particular, never accept ordinary client author IDs, roles, counters,
  server timestamps, publication pointers, or audit actors.
- Create topic/reply/page/proposal requests carry an `Idempotency-Key` UUID.
  Persist actor + operation + key + normalized request hash + created resource
  IDs in a unique table inside the same transaction. Same key/payload replays
  references without a second create; changed payload returns 409. Check current
  authorization/visibility on replay. Do not replay a cached private response
  after its resource has become inaccessible. Browser retries reuse the key;
  a deliberately new action gets a new key.
- Validate lengths before expensive parsing: retain 5 MB total JSON limit;
  forum title 1–200, category name 1–100, description 0–1000, post HTML 1–250000,
  edit/moderation summary 1–1000. Reject a post empty after safe-text/media
  inspection, including `<br>`-only content. Do not silently truncate user prose.

### A3. Identity, privileges and CSRF

- Add `users.disabled_at timestamptz NULL`, `auth_version integer NOT NULL
  DEFAULT 1`, and `version integer NOT NULL DEFAULT 1`. Keep role enum spellings.
- A signed cookie stores user UUID, auth version and CSRF token, not trusted
  roles. Re-read user/disabled/version for authenticated access. Old cookies
  without a matching auth version require login; cached local users cannot
  replace it. Staff capability is `role IN ('moderador','admin')` only.
- Every privileged mutation runs in a transaction; lock/revalidate the acting
  user there before writing so a concurrent disable/demotion has defined order.
  A write serialized before revocation may finish; a later write must fail.
- Password change increments auth_version and refreshes only the requesting
  session to the new version; other sessions expire. Role/disable changes
  increment target auth_version; the target logs in again if still enabled.
  Disable rejects future login. Never include hash/token in any DTO/audit row.
- Separate `selfUser` (own email allowed), `publicAuthor` (UUID, username,
  avatar, title, real role only), and `adminUser` (restricted account fields).
  Never reuse the current `publicUser` function for a public member directory.
- Add `GET /api/auth/csrf` returning a session-bound random token; browser
  request helper obtains it before unsafe requests and sends `X-CSRF-Token`.
  Validate token on all POST/PUT/PATCH operations, including login/signup/logout,
  plus same-origin `Origin`/Fetch-Metadata checks when provided. No permissive
  credentialed CORS. Production origin is explicit config, not an arbitrary
  Host header. Test helpers acquire a cookie/token normally. Logout invalidates
  the session, then the client gets a fresh anonymous token as needed.
- Explicitly validate profile DTOs; call the real session response updater on
  success, preserve draft/report error on failure. Remove `getUser` and
  `syncSessionUser` calls that reference missing functions. Password fields are
  cleared after successful change and never cached in drafts/localStorage.

### A4. Safe content and renderer contract

Use a maintained server sanitizer, selected here as npm `sanitize-html`.
Consult its current official documentation before pinning an actual version;
the old GitHub repository redirects to the maintained monorepo (references
below). Add it through npm and commit the lockfile. No regex-only sanitizer.

- Allow intended text formatting: paragraphs, headings h2–h6, emphasis,
  underline/strike, lists, blockquotes, pre/code, spans/divs, simple tables,
  horizontal rules, line breaks and images. No script/style elements, SVG,
  MathML, iframe, embedded objects, forms, event attributes or `srcdoc`.
- Explicit link schemes: http/https and permitted local/fragment paths; images
  https or allowlisted local assets. Reject protocol-relative, javascript,
  data, file and encoded/control-character variants. No server media fetching.
  External new-window links receive safe rel attributes. Validate URLs again
  in structured blocks, avatars, banners, infoboxes and theme music fields.
- Permit only enumerated fonts and safe color/alignment/font-size properties
  needed by existing fixtures; no arbitrary CSS classes, IDs or style strings,
  no url(), positioning, animation or imported CSS. Transform legacy `<font>`
  formatting deliberately if supported; show staff a formatting-loss preview.
- Validate each block's own schema and nested HTML, not just `b.type`. Existing
  types are section, tabs, gallery, cards, quote, stats, accordion, timeline,
  datalist. Limit 40 blocks; at most 30 nested items per block, finite numeric
  ranges, and the existing safe text/URL limits. Reject unknown types/keys and
  nested block recursion. Safe colors are parsed hex values, not CSS expressions.
- New writes store accepted safe content. Existing database/legacy content is
  sanitized on reads/previews until a reviewed conversion has completed. Keep
  untouched private originals/backups; never "clean" them destructively first.
- User content is inserted only into documented sanitized HTML sinks; all
  other text uses textContent/escaping. The source-mode editor is not exempt.
  A preview calls the authenticated server validation path and returns safe
  content; do not execute raw editor HTML while waiting for publication.
- Derive plain text and internal links by parsing accepted content, not trusting
  client-supplied search text/link lists. If needed, explicitly declare a parser
  dependency rather than importing an undeclared transitive dependency.

## B. Forum and administration

### B1. Tables and invariants

Keep existing relational tables. Add fields deliberately, with matching Drizzle
schema/snapshots and SQL migrations:

- categories: `archived_at`, `version`. Archive is read-only; direct historical
  reads remain available. Do not cascade-delete descendants through the UI.
- threads: `locked boolean default false`, `archived_at`, `version`,
  `last_activity_at`, `next_post_no integer default 2`. Identify the opening
  post by `post_no=1`; do not add an unnecessary circular opening-post FK.
- posts: `deleted_at`, `version`, nullable `author_id` for unmapped legacy
  attributions, `author_label` for legacy display, and optional legacy reference.
  Threads need the same legacy attribution support. Normal writes always set a
  real actor FK; the importer alone may create labeled legacy attribution.
- posts also have positive integer `post_no` unique within the topic. Allocate
  replies from `next_post_no` under its topic lock. Backfill server posts in
  existing `(created_at,id)` order and imported posts from preserved source
  order, reporting ambiguity. Verify every topic has exactly one opening post;
  quarantine an inconsistent existing topic rather than invent its content.
- edits: `post_revisions` stores old safe content, actor, summary and time for
  author/staff audit, not public access to hidden content. Keep hiding as a
  tombstone with original body retained privately. No hard-delete API.
- `request_keys` supports create replay; `audit_events` records privileged
  operations; import tracking is described separately. All author/user FKs use
  non-destructive behavior. Accounts are disabled, so ordinary deletion never
  needs to break those FKs.

For topic creation insert thread + first post numbered 1 + request key
in one transaction. For edits/replies, lock acting user, category, then topic,
then relevant post, in that order; category/topic moderation uses compatible
locks. A reply racing a lock either commits before it or is rejected after it.
Never read `locked` before a transaction and assume it remains unchanged.
For moves, lock all affected category rows in sorted UUID order before the
topic row. Parent IDs discovered before locking are hints: after locking,
revalidate relationships and restart/report a conflict if a concurrent move
changed them. Do not acquire a new parent lock in reverse order mid-mutation.

Lists order topics by pinned descending, last activity descending, UUID
tie-breaker; posts by post_no ascending. A tombstone stays
in order but its body is omitted from normal DTOs. Page totals and post counts
exclude hidden bodies; last activity uses accepted non-hidden contributions.
Use SQL-derived counts initially; stop trusting/mutating `users.posts_count`
and browser `bumpPosts()` as the source of truth. Avoid N+1 queries.

Reply appends change last activity/counts and next_post_no, but do not increment
the topic metadata/moderation version. Two concurrent replies must both succeed
without an artificial stale-metadata conflict. Topic/category state checks
still run under locks. Category names remain globally reserved, including
archived categories; return a name conflict instead of merging or reusing them.
Replace physical cascading product FKs with non-destructive restrictions where
needed. Do not modify the unused comments feature beyond required consistency.

Locked/archived topic or category blocks ordinary body/title/tag edits and new
posts for every role. Staff must explicitly unlock/unarchive to rewrite content.
Audited staff moderation (hide/restore a reply, pin, move, lock or archive state
changes) remains available to handle harmful historical content; an author's
own hide/edit is subject to writability. This is the precise read-only policy,
not an implicit staff bypass. Archive records remain readable historical data.

### B2. Endpoint responsibilities

| Method/path | Caller | Request / result |
| --- | --- | --- |
| GET `/api/forum/categories` | Public | Categories with server topic/post totals; normal listing excludes archived categories |
| GET `/api/forum/categories/:id/threads` | Public | Pagination and optional tag/search filters; explicit archived view allowed |
| GET `/api/forum/threads/:id` | Public | Thread/public author/category metadata and version |
| GET `/api/forum/threads/:id/posts` | Public | Ordered paginated safe posts/tombstones |
| POST `/api/forum/threads` | Member+ | `{categoryId,title,tag,content}` plus idempotency key; creates opening post atomically |
| POST `/api/forum/threads/:id/posts` | Member+ | `{content}` plus key; rejects locked/archived topic/category |
| PATCH `/api/forum/threads/:id` | Owner or staff | `{title,tag,expectedVersion}`; owner must have writable topic/category |
| PATCH `/api/forum/posts/:id` | Owner or staff | `{content,summary,expectedVersion}`; owner subject to lock/archive |
| POST `/api/forum/posts/:id/hide` | Owner or staff | `{reason,expectedVersion}`; author cannot hide opening post; staff may tombstone it |
| POST `/api/forum/posts/:id/restore` | Staff | `{reason,expectedVersion}`; restores retained content safely |
| POST `/api/forum/threads/:id/moderate` | Staff | Exactly one action pin/unpin, lock/unlock, archive/unarchive or move; move requires targetCategoryId; reason/version mandatory |
| GET `/api/users/:id` | Public | Safe profile/derived forum count; no email/account controls |
| GET `/api/admin/users` | Admin | Paginated restricted accounts; no hashes/tokens |
| PATCH `/api/admin/users/:id` | Admin | Exactly role change or disable/enable, plus reason and expectedVersion |
| POST/PATCH `/api/admin/categories[/:id]` | Admin | Create/edit category; no author/category object supplied by client |
| POST `/api/admin/categories/:id/archive` or `/restore` | Admin | Versioned state change and reason; never descendant deletion |
| GET `/api/admin/audit-events` | Admin | Paginated operation records; no raw content, credentials or unbounded export |

For an edit example, request `{content:"<p>Texto revisto.</p>",summary:"Correção",
expectedVersion:3}` returns `{data:{id:"<uuid>",version:4,...}}`. A simultaneous
request still expecting 3 gets 409 `STALE_VERSION`; the database remains at 4.

Admin role/disable operations take one fixed transaction-scoped advisory lock
for the application's admin membership set, then lock affected users in sorted
UUID order. Acquire this admin-set lock before any actor-user lock in these
operations; do not call the normal actor-locking mutation wrapper first.
All such operations use it, including bootstrap. Recheck actor
privilege and active-admin count under that lock. Do not weaken the invariant
to "cannot demote yourself": the essential invariant is at least one active
admin remains, including concurrent actions by different admins. Audit insert
and mutation commit together. SQL constraints/errors map to safe API codes.

An admin may change their own account only if the final-active-admin invariant
holds. A successful self-disable/demotion expires that browser session too.
Record bootstrap as an explicit operator event, not an invented authenticated
user. Keep old `adm_tentativa_usada` data inert; never give it role semantics.

### B3. Client cutover and routing

New canonical routes: `/forum`, `/forum/categorias/:uuid`,
`/forum/topicos/:uuid`, `/wiki`, `/wiki/:slug`, `/personagens/:uuid`,
`/cenas/:uuid`, plus staff/editor routes keyed by UUID. Route parsing must
distinguish API/static/HTML paths. Register actual paths, not an Express 4
wildcard assumed to work on Express 5. Unknown APIs return JSON 404; unknown
pages show a real not-found view. Back/forward and deep-link reload preserve
the selected resource. Do not redirect every unknown request to the home page.

Session state lives in memory, initially unresolved; `/api/auth/me` establishes
it. On failed identity verification show a signed-out/error state, not a cached
admin. Client mutation responses update/refetch canonical state. Server errors
do not invoke a callback twice or become publication success. Disable duplicate
submit buttons while sending and reuse create keys for retries.

Draft storage keys include current server user UUID or explicit anonymous
scope plus resource and schema version. Never store passwords/tokens. Sign-out
clears in-memory sensitive drafts and does not show account A's draft to B.
Legacy data has a separate recovery UI and is never a GET failure fallback.

## C. Scenes and legacy import

### C1. Scene turns

Retain scene table/route names initially. Add `scene_turns`: UUID PK, scene FK,
nullable verified author FK, legacy author label, sanitized content/presentation
fields, created_at/updated_at, version, deleted_at, original ordinal and a
scoped legacy ID. Stable order uses an explicit ordinal under parent-row lock,
not equal timestamps. New turns derive author from session.

Characters, scenes, own profiles and turns all receive integer version tokens
for edits/hide/restore. Convert their existing destructive delete handlers to
recoverable hide operations and update the UI; retain an explicitly documented
compatibility alias only if needed, never a hard delete. Add staff recovery
routes. Public reads omit hidden characters/scenes and hidden turn bodies.

Migration stages: back up original `wiki_posts.turns`; validate/map each row;
insert child rows and mapping; reconcile counts/order/content; only then mark
that scene normalized. Preserve the old JSONB column as recovery data, not a
second write target. Keep existing response `wikiPost.turns` assembled from
child rows so callers continue working. Old scoped turn IDs resolve through
the mapping without being accepted as another scene's ID.

Malformed duplicate IDs, unknown author mappings or unsafe values are reported
with original ordinal and preserved raw data. They are not overwritten or
silently attributed. Unresolved real scenes can remain read-only in recovery;
do not make every unrelated milestone depend on guessing their history.

### C2. Import contract

- Raw snapshot/export occurs before loading legacy app code. Recovery tooling
  reads the exact `forum-antigo-db-v22` string; never invokes `loadDB()`.
- Define identifiers separately: `sourceId` is a UUID carried forward from the
  recovery export (a continuity label, not proof of origin); `rawSnapshotSha256`
  fingerprints the untouched private snapshot; `contentDigest` fingerprints
  canonical converted content before sanitization/author assignment. Compute
  contentDigest over formatVersion, original ordered content arrays and minimal
  legacy attribution records, with sorted object keys, UTF-8 strings preserved
  without Unicode normalization, and legacy identifiers represented as strings.
  Exclude export UUID, sourceId, job/batch transport identifiers, exportedAt,
  origin/display labels, counters, raw snapshot digest, selection/mapping-review
  decisions, sessions, roles and other volatile/cache metadata. Do not use the client hash
  as authority: recompute on the server after validating all staged batches.
  A verified canonical import has globally unique contentDigest across admins;
  sourceId is provenance/continuity, not a deduplication authority. Different
  export UUIDs, source labels or chunking of identical assembled content must
  return the same verified import/mappings. A staging job that verifies equal
  to an existing import becomes an explicit replay reference, not a second
  commit. Retain its additional provenance labels privately. Changed raw cache
  metadata must not duplicate otherwise identical imports.
- A content-only conversion has `formatVersion`, export UUID, source digest,
  legacy origin label, categories, users as attribution labels/mappings only,
  topics/posts, characters, scenes/turns and source-relative IDs. It rejects
  imported sessions, hashes, passwords and role grants; ignores no security
  fields silently. Legacy dates retain original text if interpretation is
  ambiguous; an approved timezone mapping must be explicit.
- `POST /api/admin/legacy-imports` starts or returns an existing restricted
  staging job with export/source identifiers and a declared batch manifest.
  `PUT /api/admin/legacy-imports/:id/batches/:number` uploads an immutable batch
  under 4 MB. The server recomputes its canonical hash; identical retry is a
  replay, changed bytes at that number are 409. The assembled job is at most
  20 MB, with all declared batches present before preview.
- `POST /api/admin/legacy-imports/:id/preview` takes expected job version,
  proposed selections and explicit author-mapping decisions. It recomputes
  the assembled canonical source hash, validates shape/references/sizes, and
  returns a plan with duplicates, unresolved authors, formatting changes and
  deterministic resource mappings. Preview writes only job/plan/mapping-review
  records, never live content. Changing selections/attribution requires another
  preview and a new plan hash/version.
- `POST /api/admin/legacy-imports/:id/commit` requires expected job version,
  exact plan hash. Selections and verified attribution decisions are the ones
  frozen by that preview, not a second unreviewed payload at commit time.
  Commit is atomic per dependency-complete selected batch. Exclude unresolved
  records and their dependents visibly; do not partially succeed silently.
- Unique `(sourceId,resourceType,legacyId)` continuity mappings prevent repeat
  source items; canonical-run item mappings also link digest/type/legacy ID to
  targets. Exact-content replays with new export/source labels reuse existing
  targets rather than creating new continuity mappings with duplicate records.
  A retry returns its earlier mapping; a changed source becomes a new preview
  with cross-source duplicate candidates, not a name/title auto-merge.
- Only admins can assign a verified existing account. A username match alone
  is not proof. Unmapped authors use nullable FK + immutable legacy label and
  no staff badge. Sample profiles never become real user accounts automatically.
- Keep import job ownership, audit events and reconciliation reports restricted.
  An import cannot replace existing human-edited rows; conflicting targets
  require a new explicit resolution. Verify public imported content under the
  same sanitizer and permissions as ordinary content.
- Source ZIP lore staging is a different importer; never pass it through the
  forum migration endpoint or treat the authorial handoffs as user accounts.

## D. Wiki model, publication and proposals

### D1. Content snapshot and storage

New `wiki_pages` is distinct from scene `wiki_posts`. It holds stable UUID,
head_revision_id, published_revision_id, integer work_version, public_version,
live access_level (`public` or `staff` initially), archive state, timestamps,
and optional discussion_thread_id. `head` is the staff working revision.
An unpublished page has no public identity/lookup result.

`wiki_revisions` contains UUID, page FK, monotonic sequence, parent/base
published revision IDs, actor, created_at, edit summary, optional restores_id
and accepted_proposal_id, and an immutable snapshot. Composite FKs ensure
pointers reference a revision belonging to the same page. Assign sequences
under page lock. Do not UPDATE old snapshots to implement edits or restoration.

Snapshot shape (all values validated; IDs below are illustrative):

```json
{
  "schemaVersion": 1,
  "title": "Título de exemplo",
  "slug": "titulo-de-exemplo",
  "aliases": ["nome-alternativo"],
  "type": "concept",
  "summary": "Resumo em português.",
  "categories": ["cosmologia"],
  "accessLevel": "staff",
  "audience": "unspecified",
  "body": {
    "format": "richtext-v1",
    "infobox": [{"label":"Campo","value":"Valor"}],
    "sections": [{
      "id": "<stable-section-uuid>",
      "heading": "Visão geral",
      "html": "<p>Texto de exemplo.</p>",
      "blocks": [],
      "authority": [],
      "knowledgeLayer": "unspecified"
    }]
  }
}
```

Types: concept, organization, place, entity, technique, artifact, event,
character-reference. Audience: unspecified, reader, player, author. Knowledge:
unspecified, mundane, paranormal, authorial, mixed. Authority is an array of
source markers C/S/E/O; empty means not stated, and C/S stays a combination.
Do not generate a page-wide canon label from mixed sections. All sections share
the page access policy in v1: no client-side hidden "private" paragraphs in an
otherwise public snapshot. Private editor notes/citations live separately and
are excluded from public DTOs. Audience/knowledge labels never grant access.

Limits: title 1–200; slug 1–100; summary 0–1000; up to 30 aliases/categories;
up to 30 infobox fields with 80/300-character labels/values; up to 100 uniquely
identified sections; body at most 500000 characters serialized and total request
under the global limit. Retain stable section UUID anchors on later edits.
Private citations refer to section IDs, source UUID/hash and line/heading
locator, not a public filesystem URL. Reject unsupported content versions.

`wiki_names` maps a unique normalized slug key to page UUID. Normalize slug
input with Unicode NFKD, remove combining marks, lowercase, map separators
to hyphens, and permit only a–z/0–9/hyphen. Reject empty/oversize results; do
not invent transliterations or silently pick a conflicting title. Display
titles keep original diacritics. Canonical slug and aliases share one namespace.
Draft names are not registered publicly. On publication retain all historical
names for that same page; aliases resolve directly to its current canonical
slug, never through chains. Collision with another page returns generic 409
without revealing restricted page metadata. A DB uniqueness constraint is the
final protection against competing publications.

Derived search/category/link records are revision-scoped. For the small first
corpus, bounded server-side matching on normalized published title/aliases/
summary/plain body is sufficient; no external search engine or extension is
required. Apply visibility and publication filters before pagination/totals.
Link extraction accepts validated `/wiki/<slug>#<anchor>` links; unresolved
targets stay unresolved, never fabricated. Resolve through the live name
registry for backlinks; filter both source and target visibility. Section
anchors are based on stable section IDs, not untrusted arbitrary HTML IDs.

### D2. Lifecycle and APIs

| Method/path | Permission | Behavior |
| --- | --- | --- |
| GET `/api/wiki/pages` | Public | Published visible snapshots only, search/category/type filters |
| GET `/api/wiki/resolve/:slug` | Public | Visible published canonical result or alias redirect information; inaccessible is 404 |
| GET `/api/wiki/pages/:id` | Public | Published snapshot only; staff editing uses a different route |
| GET `/api/wiki/pages/:id/backlinks` | Public | Paginated visible published sources only |
| GET `/api/wiki/categories` | Public | Categories/counts from visible published snapshots only |
| GET `/api/staff/wiki/pages[/:id]` | Staff | Staff work head, published pointer, draft listing/work_version |
| POST `/api/staff/wiki/pages` | Staff | Create page + immutable private draft, idempotent |
| POST `/api/staff/wiki/pages/:id/revisions` | Staff | Save full candidate snapshot + summary + expectedVersion; move head only |
| POST `/api/staff/wiki/pages/:id/publish` | Staff | revisionId + expectedVersion + expectedPublishedRevisionId + summary |
| POST `/api/staff/wiki/pages/:id/archive` or `/restore` | Staff | Versioned page state, reason; archive removes public resolution but retains names/history |
| GET `/api/staff/wiki/pages/:id/revisions[/:revisionId]` | Staff | Full authorized history; diff can compare two revisions from that same page |
| POST `/api/staff/wiki/pages/:id/restore-revision` | Staff | oldRevisionId + expectedVersion + summary; copies into a new draft, never publishes |
| PATCH `/api/staff/wiki/pages/:id/discussion` | Staff | public forum thread ID + expectedVersion; validates visibility |
| POST `/api/wiki/pages/:id/proposals` | Member+ | Full candidate snapshot + current basePublishedRevisionId + summary, idempotent |
| GET `/api/wiki/proposals[/:id]` | Member+ | Own proposals only, and only for currently accessible pages; staff review uses staff routes |
| POST `/api/wiki/proposals/:id/withdraw` | Proposer | Submitted proposal + expectedVersion only |
| GET `/api/staff/wiki/proposals[/:id]` | Staff | Review queue and original proposal/base snapshot |
| POST `/api/staff/wiki/proposals/:id/reject` | Staff | expected proposal version + reason |
| POST `/api/staff/wiki/proposals/:id/accept` | Staff | expected proposal version + expected page work version + expected published ID; creates staff draft only |

A member proposal is immutable once submitted. Until submission the browser
holds a labeled local draft. To revise a submitted proposal, withdraw and
submit a new one linked to the earlier proposal; do not mutate review evidence.
States: submitted, accepted, rejected, withdrawn. Staleness is a computed
condition when its base publication no longer matches, not a destructive
rewrite of its submitted content. Reject with comments provides the initial
"request changes" flow; no larger workflow engine is required.

Acceptance locks/revalidates actor, page and proposal in that order. It checks
the proposal is submitted, the publication base still matches, the work version
matches the reviewer input, and the staff head equals the publication. If staff
already has unpublished work, return 409 `STAFF_DRAFT_EXISTS`; do not replace
it with the proposal. Staff can save a manually integrated revision with an
explicit proposal reference instead. Acceptance creates a new staff head with
proposer credit; accepting never changes public output.

Publication transaction: lock actor then page; validate head and supplied work
version/base; require revisionId equals current head; sanitize/validate snapshot;
reserve canonical/alias keys; set published pointer, live access, public_version
and publication time; refresh derived records and append audit event. All
commit together or roll back. A stale proposed revision cannot be published
after a newer publication, even if its slug remains available. Work_version
increments on staff changes; public_version increments only on publication or
public visibility/archive transitions. Public ETag/timestamps use the latter,
not staff draft activity. Draft title/alias/count data never enters public DTOs.

Restoration copies an old snapshot into a fresh head based on the current
publication. Staff edits/reviews and explicitly publishes it later. A prior
staff-only snapshot cannot be exposed through an anonymous history or diff URL.
Ordinary public responses, lists and previews never serialize hidden pointers,
source records, pending proposal counts or staff work versions.

### D3. Source staging and pilot content

Keep raw ZIP/text/citations under `.local/` or restricted database source tables,
outside Git and static assets. A local staging tool inventories archive-relative
paths, rejects path traversal/symlink entries and oversized/unexpected content,
checks total uncompressed size, and records archive/file SHA-256, family,
language and declared version/date (unknown if absent). Package expectation:
27 Markdown files + `soul.txt`; README is the 29th context file, not canon.

Source records have stable UUIDs and a unique archive-hash + relative-path
constraint. Staff-only source APIs return manifest/text/locators; public APIs
omit private filenames and text. No automatic external URL fetches. A second
import returns existing source IDs. Draft creation keyed to an import mapping
must skip/report a human-modified draft rather than overwrite it.

Use synthetic sources for committed tests. Private actual pilot work can use
the ZIP, with line-level citations and unresolved decision notes. If sources
are absent, build the tooling/tests and mark only actual pilot preparation
pending; do not reconstruct from model memory. Do not build an unreliable
"verbatim detector" or a new passage-approval engine: withholding actual lore
publication is an execution boundary, while later staff editorial publication
remains an ordinary authorized feature.

Private pilot tasks:

| Draft | Sources and constraints |
| --- | --- |
| A Máscara | Structure/history docs; demography handoff 110–137. Flag local/transnational governance wording; do not invent the resolution. |
| Categorias de Ameaça: Graus e Classes | Threat categories 1–22; specters 183–233; operations 56–64. Explain resource/neutralization cost; omit unratified frequency tables. |
| Percepção paranormal | Perception handoff 16–22; Builds 42–69. Separate the three senses; do not equate clairvoyance with precognition or invent ranges. |
| Fendas Interplanares | Rift document 16–79. Separate definition, types and procedures; untagged claims stay not-stated; narrative opening is not a rule. |
| Podridão e Florescimento | Rot/Lotus document 8–18,37–60; perception 309–317. Preserve recovery versus transformation; record current/legacy terminology as sourced aliases. |

Each draft: PT-BR title/lead, source-supported aliases, type/categories,
section-level authority and knowledge labels, safe outline/body and restricted
citations/questions. Do not silently reconcile missing or conflicting evidence.
Keep stories and author-only revelations out of publication. Preserve references
to absent source witnesses as unresolved rather than claiming they were read.

## E. Primary technical references

Read the relevant current official sections when writing library-specific code:

- [Node 24 test runner](https://nodejs.org/docs/latest-v24.x/api/test.html).
- [PostgreSQL 17 transaction and row locks](https://www.postgresql.org/docs/17/explicit-locking.html).
- [Maintained sanitize-html documentation](https://github.com/apostrophecms/apostrophe/tree/main/packages/sanitize-html).
- Existing locked Express/postgres/Drizzle versions and their official docs
  govern their specific APIs. Do not infer migration snapshot formats or
  transaction APIs from another version or hand-author hashes without checking.

Documentation links inform implementation. Their code examples do not replace
this application's authorization, content or recovery contracts.
