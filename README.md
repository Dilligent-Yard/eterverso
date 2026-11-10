# Eterverso / aetherverse vault

The aetherverse vault is a Portuguese-language forum, character wiki, reference
wiki, and collaborative text RPG. The browser app uses plain JavaScript, HTML,
and CSS. Express serves the app and API, and PostgreSQL stores shared accounts,
forum content, characters, scenes, scene turns, and reference wiki data.

## Local development

Use Node.js 24 from `.nvmrc`, npm, and Docker Compose. Select Node 24, install
the locked dependencies, and compile the typed islands and browser bundle:

```sh
nvm use
npm ci
npm run build
```

`npm run build` runs the typechecks, emits the Node entry points under
`.generated/node/`, and bundles `generated/client/vault.js`. `npm start` and
`npm run dev` do not compile; their `prestart`/`predev` hooks run
`node scripts/check-build.js`, which lists every missing generated file and the
`npm run build` command. Rebuild after changing TypeScript sources.

Check for an existing `.env` before creating one. If none exists, copy the
template; otherwise preserve the existing file and edit it deliberately:

```sh
if [ ! -e .env ]; then
  cp .env-example .env
fi
```

Set a fresh local `POSTGRES_PASSWORD`, use the same value in `DATABASE_URL`,
and set an independent random `SESSION_SECRET`. For example, generate a
URL-safe random value in your terminal with:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Keep `.env` and all generated credentials private; `.env` is ignored by Git.
The example configuration points to the development database on
`127.0.0.1:55432`.

Start PostgreSQL and inspect the target before applying migrations:

```sh
docker compose up -d --wait
npm run db:preflight -- --target=development
```

Preflight reads the database schema and migration history and saves a private
report under `.local/test/reports/`. Automatic migrations support an empty
database or a precisely recognized schema state. An unknown or divergent
database is refused for operator review. Before a development migration, the
wrapper also requires a restricted baseline dump. Create it once, before the
migration, without replacing an existing dump:

```sh
umask 077
mkdir -p .local
if [ ! -e .local/development-baseline.dump ]; then
  docker compose exec -T db pg_dump -U eterverso -d eterverso -Fc > .local/development-baseline.dump
fi
chmod 600 .local/development-baseline.dump
npm run db:migrate -- --target=development
npm run db:preflight -- --target=development
```

The migration wrapper checks that the dump is a private, non-empty PostgreSQL
custom archive and asks PostgreSQL to verify its table of contents names the
`eterverso` database before running migrations. If the dump already exists,
confirm that it belongs to this local database before relying on it. Do not
replay migration SQL directly or try to repair an unsupported schema by editing
its migration history. See
[`docs/planning/verification-and-recovery.md`](docs/planning/verification-and-recovery.md)
for supported migration paths and recovery steps.

Start the app after preflight confirms the required schema:

```sh
npm start
```

`npm start` and `npm run dev` both run `node server.js`. Open
<http://localhost:3000>. Startup loads the existing `.env` and checks
schema readiness; it does not create or alter database structures. Stop the
app with Ctrl+C. `docker compose down` stops PostgreSQL and preserves its named
development volume. Do not remove that volume as routine cleanup.

### Local administrator

Register your own account in the running local app. Find its UUID in the local
database, replacing the sample username:

```sh
docker compose exec db psql -U eterverso -d eterverso \
  -c "SELECT id, username FROM users WHERE username = 'your-local-username';"
```

Use that UUID to bootstrap the first local administrator. Confirm `.env`
points to the local development database before running this command:

```sh
env -u DATABASE_URL node scripts/bootstrap-admin.js \
  --user-id 'UUID-from-the-query' \
  --operator 'local setup' \
  --reason 'first local administrator' \
  --database-name eterverso \
  --env-file .env
```

The command records the operator and reason, and refuses if an active
administrator already exists. Sign out and back in after bootstrap. Manage
later account roles through the authenticated admin interface.


### TypeScript islands and build

The contribution adds typed implementation islands under `src/browser/` and
`src/node/`. Legacy entry points and global browser handlers remain small
adapters so existing URLs, scripts and callers keep working.

```sh
npm run typecheck     # legacy schema/server entry + Node and browser islands
npm run lint:typed    # strict rules for the typed islands
npm run build         # typecheck, emit Node islands, bundle the browser facade
npm start             # node server.js; prestart validates generated files
```

`npm run build:client` writes the generated classic-script bundle to
`generated/client/vault.js`; `npm run build:node` writes the Node islands under
`.generated/node/`. Both are ignored by Git and must be built before running
the app or a direct CLI that consumes an adapter. `node scripts/check-build.js`
checks the complete set used by canonical startup and its adapters; direct
`db-migrate` and `bootstrap-admin` invocations also fail early with the same
build guidance when their generated modules are absent. The default
`npm start` serves repository-root assets and Drizzle migrations; the build
does not relocate `.env`, SQL, static files or the timeline seed. Hosting
provider build/start settings are not verified by this repository.

## Deployment

The service runs with Node.js 24 and a production dependency set. Build and
apply schema changes while development dependencies are available, then prune
them for the runtime artifact:

```sh
npm ci
npm run build
# Apply the reviewed migrations through 0017_timeline_events.
# Optionally seed an empty timeline as described below.
npm prune --omit=dev
npm start
```

`npm start` runs `node server.js`; it does not compile TypeScript or install
tooling. `prestart` runs `node scripts/check-build.js` and refuses to start if
any required generated file is missing. Do not run `npm run build` after
pruning: the TypeScript compiler and esbuild are development dependencies.
If the platform installs production dependencies only, perform the build in a
separate build step before that install.

Startup verifies the applied migration history and required columns through
`0017_timeline_events` and refuses an older, partial or divergent schema; it
never runs DDL. The deployment database must therefore receive the reviewed
migrations before the service starts. Migration tooling remains an explicit,
reviewed operator step rather than something startup performs.

Timeline seed material is a content decision and is never loaded at startup.
After migrating a database whose timeline is still empty, load the committed
seed explicitly:

```sh
DATABASE_URL='postgres://...' node scripts/seed-timeline.js --confirm-empty
npm run db:seed:timeline -- --confirm-empty --target=development
```

The command requires `--confirm-empty`, accepts one explicitly supplied
`DATABASE_URL` or one guarded `--target`, refuses if any timeline row exists,
prints the seed and row counts, and performs no DDL. The `DATABASE_URL` form
does not read `.env` implicitly.

These are the repository build/start expectations. Any hosting dashboard
settings, including a Render service, remain unverified here; configure the
platform to use Node 24, run this build and migration procedure, and start with
`npm start`.

## Tests

Tests use a separate PostgreSQL 17 service and database. The test setup reads
the existing `.env` but does not create or replace it. It stores generated
test-only credentials under ignored `.local/test/`, chooses a free loopback
port starting at `55433`, and checks that test runners target that isolated
service. Unit tests need no database; integration and browser tests need the
isolated service and schema, plus the local development database for a
read-only sentinel check. These runs compare that sentinel before and after.

```sh
npm run test:env:up
npm run db:preflight -- --target=test
npm run db:migrate -- --target=test
npm run test:unit
npm run test:integration
npm run test:browser
```

The supported entry points are:

| Command | Runs |
| --- | --- |
| `npm run test:env:up` | Starts the isolated test database and prepares private test configuration |
| `npm run test:unit` | Unit tests; no database or browser required |
| `npm run test:integration` | PostgreSQL and HTTP integration tests on the isolated test database |
| `npm run test:browser` | Playwright browser tests on the isolated test database |
| `npm run test:migration:populated` | Synthetic populated-baseline migration check in a disposable test-only database |
| `npm test` | Unit and integration suites |
| `npm run test:all` | Unit, integration, and browser suites |
| `npm run test:env:down` | Stops the test service and keeps its test-only named volume |

If Playwright reports that Chromium is missing, install it with
`npx playwright install chromium`. Do not point tests at the development
database or remove its volume.

To check a populated schema upgrade, `npm run test:migration:populated`
restores the private verified 0006 baseline into a uniquely named disposable
test database, adds synthetic records, applies migrations, and compares the
preserved content before dropping the temporary database. It never targets
the development database. The execution checkpoint records the latest test
counts and acceptance-gate status; do not infer a gate passed from a command
that was not run.

### Private wiki sources

Source archives can be staged without publishing their text:

```sh
npm run wiki:sources:stage -- --archive /path/to/source-package.zip
```

The script writes private files and a hash manifest under ignored
`.local/wiki-sources/`. If an entry already exists, it preserves existing
edits and reports that condition. Importing a staged manifest stores source
records in an explicitly named loopback database and requires an active
moderator UUID:

```sh
npm run wiki:sources:import -- \
  --manifest .local/wiki-sources/YOUR_ARCHIVE_SHA256/manifest.json \
  --database-name eterverso \
  --imported-by YOUR_MODERATOR_UUID \
  --env-file .env
```

Imported sources are private research material. They do not create or publish
wiki articles; real lore publication still requires an editorial review.

### Reading and publishing wiki drafts

The public Wiki landing page groups its sections into forum-style areas and
subsections, including empty ones. Migration `0015_wiki_sections` stores the
initial four areas and twelve subsections independently of article revisions.
`GET /api/wiki/sections` returns the structural labels and distinct public
article counts; drafts, restricted publications and archived pages are excluded.
Clicking an area includes its descendants; `/wiki?categoria=KEY` restores the
selection on reload. Other published category names remain discoverable below
the main structure. No placeholder articles are created for empty sections.

Staff can open **Rascunhos da equipe** from Wiki, or visit `/wiki/equipe`.
The shared draft reader `/wiki/rascunhos/:id` shows the current work revision
with a clickable section/subheading index and a link to the editor. Members
and visitors cannot read these endpoints. Existing historical staff-only
publication records appear as drafts in this view; their history is retained.

Saving a draft stays separate from publication. **Publicar para todos** asks
for explicit confirmation. When a restricted draft becomes public, the server
creates a new public revision carrying its citations and publishes it atomically;
it does not rewrite the historical private snapshot. New staff-only publication
requests are refused. Public listings continue to use only public publications.

### Timeline, notifications and likes

The **Linha do Tempo** page is a separate, staff-managed public timeline. It is
not reference-wiki content: its events do not create page revisions, citations,
proposals or publication pointers. Migration `0017_timeline_events` creates the
empty timeline table. Committed seed material in `server/timeline-seed.json` is
not applied automatically at startup. An operator may load it only into an
empty timeline with `npm run db:seed:timeline -- --confirm-empty --target=...`
(or an explicit `DATABASE_URL`); see [Deployment](#deployment). Seeding is a
content decision, not an automatic publication.

Logged-in users can receive notifications for scene turns and likes, and can
like characters, RPG scenes and scene turns. Scene likes use the `wiki_posts`
records; they do not apply to reference `wiki_pages`. Notification text is
limited to the acting user's public identity and the scene/character title, and
is readable only by its recipient.

Timeline edits and deletes are staff-only and recorded in `audit_events`. The
current timeline editor uses an optional `expectedUpdatedAt` concurrency check
and deletes remain permanent but auditable. A versioned, restorable timeline
archive is not implemented; do not describe timeline editing as having the same
history guarantees as reference-wiki revisions.

### Portable wiki transfers

Administrators can export selected wiki pages from the Admin area as an
`AetherverseWikiBundleV1` JSON file. The bundle carries each selected page's
current revision snapshot and citations, plus only the source documents cited
by those revisions. Source records include archive/path identifiers and
content hashes so the receiving database can reuse an exact match or report a
collision. The format does not carry accounts, passwords, sessions, roles, or
local user IDs.

To transfer pages, download the bundle from the source site, then upload it in
the destination site's Wiki Transfers panel. Review the preview, resolve any
source or page conflicts, refresh the preview if the destination changed, and
explicitly commit the selected pages and their complete citation-source set.
An import creates private source records and unpublished staff drafts; it does
not overwrite an edited page or publish lore. Continue editing through the
normal wiki revision workflow, and publish only after the usual editorial
review.

Import jobs retain the validated bundle, including its cited source text, in
the database so previews and commits can be audited and retried. The job and
its bundle are available only through admin-authenticated transfer routes.
Treat downloaded bundles and database backups as private source material. No
transfer to Render has been performed as part of local development.

### Wiki articles authored in ChatGPT Work

Staff can import a single article JSON directly in **Novo artigo** or its editor,
under **Importar artigo JSON e modelo para IA**. Validate the preview, explicitly
select any existing target/source/section bindings, then save an unpublished
staff draft. Sources must already be registered on that server. The same panel
provides an AI brief, a synthetic JSON example and the available source-path
catalogue. Staff-only export buttons in article readers and the editor download
the latest working revision: AuthoringV1 when lossless, otherwise BundleV1.
See [the interface guide](docs/wiki-authoring/SITE_FILES.md) for limits and
privacy considerations. Importing never publishes or installs source documents.

Work can plan and write pt-BR articles from the sources available in its task,
then return `AetherverseWikiAuthoringV1` files. The format uses stable human
keys and exact source paths; Work does not invent UUIDs, hashes or local
account information. The offline command `npm run wiki:authoring:compile`
verifies staged source files and produces the existing portable transfer
bundle. It does not load `.env`, send requests, write to a database or publish.

Return new articles and edits to existing articles in separate JSON batches.
New pages use the admin transfer preview/commit. For edits, the offline
`npm run wiki:authoring:revision-plan` command resolves explicitly selected
local targets and exact source metadata into version-checked staff revision
requests, including citations. It prepares those requests without sending them.
Staff revision saves preserve retained-section citations when no replacement
is supplied; an explicit citation array replaces that revision's references.

See [`docs/wiki-authoring/README.md`](docs/wiki-authoring/README.md) for exact
commands, source-set mapping, the JSON contract/schema, and the complete
receipt/revision protocol. Start Work with the self-contained
[`brief`](docs/planning/WORK_WIKI_BRIEF.md) and
[`prompt`](docs/planning/WORK_WIKI_START_PROMPT.md). Keep returned files,
sources, plans and compiled bundles under ignored `.local/`. Technical
validation does not replace source checking, editorial approval or review of
the local rendered articles. The eventual PR/changelog process is recorded in
[`PULL_REQUEST_HANDOFF.md`](docs/planning/PULL_REQUEST_HANDOFF.md).

## Code map

| Path | Responsibility |
| --- | --- |
| `index.html`, `app.js`, `editor.js`, `style.css` | Page shell, screens, browser behavior, rich-text editor, and styling |
| `client/api.js` | Browser API requests, session, and CSRF handling |
| `server.js` | Loads configuration, checks database readiness, and starts Express |
| `server/app.js` | Express app factory and shared auth, profile, character, and scene routes |
| `server/forum.js`, `server/admin.js` | Shared forum and administrator routes |
| `server/interactions.js` | Notification and character/scene/turn like routes |
| `server/timeline.js` | Staff-managed public timeline and its audit/concurrency checks |
| `src/server.ts` | Optional TypeScript entry that reuses the canonical readiness/startup path; `npm start` remains the default |
| `server/wiki.js`, `server/proposals.js`, `server/sources.js` | Reference wiki, member proposals, and restricted source routes |
| `server/wiki-transfers.js` | Admin-only, versioned wiki bundle export, preview, refresh, and commit |
| `server/wiki-article-files.js` | Staff article-file preview/commit, latest-revision export and AI guide/template |
| `scripts/wiki-authoring-compile.js`, `scripts/wiki-authoring-revision-plan.js` | Offline conversion of Work authoring JSON and preparation of citation-aware staff revision requests |
| `server/legacy-import.js`, `server/scene-turn-normalizer.js` | Controlled legacy content import and scene-turn migration logic |
| `db/schema.ts`, `db/relations.ts`, `drizzle/` | Drizzle schema definitions and versioned PostgreSQL migrations |
| `scripts/`, `tests/`, `compose.test.yaml` | Migration preflight, bootstrap and recovery tools, source staging, test runners, and isolated test database |

Runtime queries use the `postgres` client directly; the server does not use
`db/index.ts` for runtime queries. The reference wiki has separate page and
revision tables. The existing `wiki_posts` records are used by the app for
collaborative RPG scenes and turns.

## Current status and limitations

Forum categories, topics, replies, moderation, and reference wiki pages are
server-backed. Accounts, profiles, characters, RPG scenes, scene turns,
notifications, likes, and timeline events also use PostgreSQL. Browser storage
remains for local drafts, preferences, and legacy recovery; it is not the shared
source of forum or wiki content.

The timeline, notifications and likes were integrated from upstream and adapted
to this project's migration/readiness and authorization rules. The reference
wiki keeps its separate revision, proposal, source and citation model; timeline
events are not reference articles. See the timeline section above for its
current history limitations.

Current test results, completed acceptance gates, and remaining limitations
are recorded in [`docs/planning/EXECUTION_STATE.md`](docs/planning/EXECUTION_STATE.md).
Legacy import uses controlled, reviewed procedures and synthetic tests; no real
browser export has been imported. Real-data attribution, source reconciliation,
production migration, upstream merging, deployment, and public lore publication
remain separate pending decisions. Do not treat the planning review as evidence
that implementation gates have passed.

## Contributing

Work on a feature branch. `origin` should point to your fork of
`ArthurAleksandravicius/eterverso`; `upstream` is the original
`Dilligent-Yard/eterverso` repository. Publish branches to your fork and open
pull requests against `Dilligent-Yard/eterverso:main`.

```sh
git switch -c your-name/short-change-description
# Make and check a focused change.
git add path/to/changed-file
git commit -m "Describe the change"
git push -u origin HEAD
```

Preserve the Portuguese interface and existing RPG terminology. For shared
state changes, enforce permissions in the server and verify persistence with
the isolated test database. Keep credentials, private recovery exports, and
private source material out of Git.
