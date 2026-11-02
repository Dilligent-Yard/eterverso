# Working on Eterverso

## Start here

- Read `README.md` for setup, the code map, and current limitations. Inspect
  the current code before relying on an old chat or announcement.
- For the wiki/shared-state implementation, start with
  `docs/planning/EXECUTION.md` and its linked contracts/runbook. Continue from
  `docs/planning/EXECUTION_STATE.md`; planning review is not evidence that
  implementation milestones or their tests have passed.
- The site is called **aetherverse vault**. It supports a shared fictional
  universe through a forum, character profiles, and collaborative RPG scenes.
- The user is new to this project. Explain unfamiliar concepts in plain
  language and describe how they can verify a change. Keep updates concise.
- Preserve the Portuguese interface and existing RPG terminology unless the
  task explicitly requests changes to them.
- Make focused changes that fit the existing implementation. Avoid bundling
  unrelated rewrites, framework migrations, or dependency upgrades.

## Architecture and persistence

- `index.html` is the page shell; `app.js` renders screens and manages
  navigation. `client/api.js` handles browser API/session requests,
  `editor.js` implements the rich-text editor, and `style.css` defines the
  appearance.
- `server.js` loads configuration, checks schema readiness, and starts the
  app. It must not perform schema changes. `server/app.js` builds the Express
  app; feature routers in `server/` implement shared forum, administration,
  wiki, proposal, source, character, scene, and recovery/import behavior using
  injected SQL and the `postgres` client.
- Accounts, forum topics/replies, administrative changes, characters, scenes,
  scene turns, wiki revisions, and proposals are server-backed in PostgreSQL.
  Browser storage is for account-scoped drafts, preferences, and the separate
  legacy recovery workflow; never present a browser-only write as shared
  persistence or merge old samples into canonical server lists.
- `db/schema.ts`, `db/relations.ts`, and versioned SQL under `drizzle/` define
  the schema and migrations. Runtime queries use `postgres` directly, not
  `db/index.ts`. Inspect generated SQL and migration diffs carefully; do not
  apply unrelated generated changes.
- Enforce shared-data permissions on the server. Browser role checks control
  the interface but cannot substitute for server authorization.

## Development environment

- Use Node.js 24, selected by `.nvmrc`, and the committed npm lockfile.
- Run `nvm use` before npm commands. If nvm is not loaded in a shell, load the
  user's existing nvm installation or use an available Node 24 executable.
- Install dependencies with `npm ci`.
- Check for an existing `.env` before creating one. Never overwrite working
  credentials or include secrets in output, commits, or documentation.
- The development Compose configuration uses PostgreSQL 17 on
  `127.0.0.1:55432` with a persistent named volume. The separate
  `compose.test.yaml` service is for isolated tests.
- Start development PostgreSQL with `docker compose up -d --wait`; inspect it
  with `npm run db:preflight -- --target=development` before any migration.
  Apply only the migration procedure documented in
  `docs/planning/verification-and-recovery.md`, then run `npm run dev`.
- The default site address is `http://localhost:3000`. Check whether a server
  is already running before launching another instance on that port.
- Server startup checks the applied migration history and required schema but
  does not run DDL. Database preflight/migration commands are writes and must
  target the intended database explicitly.
- Do not remove the database volume as routine setup or cleanup.

## Verification

- `npm run test:unit`, `npm run test:integration`, `npm run test:browser`, and
  `npm run test:all` are available. Integration and browser suites require the
  isolated test database; use `npm run test:env:up`, test-target preflight,
  and test-target migration as documented in the README. The guarded runners
  compare a read-only development database sentinel before and after.
- `npm run test:migration:populated` exercises a synthetic populated baseline
  in a disposable test-only database. It does not migrate real user data.
- For JavaScript changes, run `node --check` on the changed JavaScript files.
  Run `git diff --check` for whitespace errors.
- Run the relevant unit, integration, and browser suites for changed behavior;
  do not report a skipped suite as passed. See `docs/planning/EXECUTION.md`
  and `docs/planning/EXECUTION_STATE.md` for the current acceptance gates and
  evidence.
- Verify affected user flows. For UI changes, inspect the actual screen in a
  browser. For API or persistence changes, check request responses, permission
  failures, and that saved data survives a fresh read or page reload.
- Useful smoke checks include registration, login/logout, profile updates,
  and character, scene, and turn creation/editing/deletion as applicable.
  Use temporary records in the local development database and clean them up.
- Add meaningful automated tests when the change warrants them; do not create
  tests that merely repeat the implementation or test static documentation.
- Report what was checked and any remaining limitations or blockers.

## Git and contributions

- Inspect `git status` and the current branch before editing. Preserve changes
  made by the user or other work in progress.
- Work on a feature branch rather than `main`.
- `origin` is the user's fork, `ArthurAleksandravicius/eterverso`.
  `upstream` is the original project, `Dilligent-Yard/eterverso`.
- Publish contribution branches to `origin`. Pull requests for the original
  project should target `Dilligent-Yard/eterverso:main`.
- Keep commits focused. Describe the concrete behavior changed and the
  relevant validation in pull requests.
- Keep durable project facts in versioned documentation. Do not assume that
  another chat has read the transcript of this conversation.
