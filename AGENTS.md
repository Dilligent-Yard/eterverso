# Working on aetherverse vault (Eterverso)

## Start here

- Read `README.md` for setup, build and local operation.
- Read `docs/development/architecture.md` for current ownership, dependency and
  build boundaries.
- Read `docs/development/verification.md` for the command/risk matrix and test
  prerequisites.
- Read `CONTRIBUTING.md` for contribution and review expectations.
- Inspect the current code and `package.json` before relying on an older chat,
  issue or document. Dated task records under `docs/planning/` are historical
  evidence, not current contributor guidance, except where a current document
  explicitly links one; the recovery runbook and Work authoring guidance remain
  current until moved.

The site is **aetherverse vault**, a Portuguese-language forum, character
collection, reference wiki and collaborative RPG. Preserve the Portuguese
interface and existing RPG terminology unless the task explicitly asks to
change them.

## Standing invariants

- Server authority. Accounts, forum content, characters, scenes, scene turns,
  wiki pages/revisions/proposals/sources, timeline events, notifications and
  likes are persisted in PostgreSQL. Browser storage is only for account-scoped
  drafts, preferences and the separate legacy recovery workflow. Never present
  a browser-only or cached write as shared persistence, and never merge old
  samples into canonical server lists.
- Runtime authorization and validation. Enforce shared-data permissions on the
  server; browser role checks only shape the interface. Keep CSRF, session
  revocation, input validation, HTML sanitization, error redaction and
  transactional/version checks. TypeScript types do not replace runtime
  validation of unknown input.
- No startup schema or content changes. `server.js` loads configuration,
  verifies migration history and required schema, then starts the app. It must
  not execute DDL, migrations or seed data. Migrations and timeline seeding are
  explicit operator steps against an intended target.
- Intended database targets. Development is the local Compose PostgreSQL 17 on
  `127.0.0.1:55432`; tests use the separate `compose.test.yaml` service and a
  generated loopback port from 55433. Preflight and migration commands require
  an explicit target; timeline seeding requires an explicit target or explicit
  DSN; the administrator bootstrap requires an explicit database name and an
  explicitly selected environment file or explicit `DATABASE_URL`; the
  documented local procedure uses `--env-file .env` with inherited
  `DATABASE_URL` unset. Never point tests or ad hoc commands at the development
  database.
- Preserve data and recovery material. Do not remove the development volume,
  reset the development database, overwrite `.env`, or discard private
  recovery/source files. Existing dumps and `.local/` material are recovery
  evidence.
- Private data stays private. `.env`, credentials, dumps, browser exports,
  private source archives, generated test secrets and `.local/` content must
  not be committed, logged or pasted into documentation. Do not publish lore or
  private source text.
- One authoritative owner per state machine or policy. Distinguish server
  authority, browser cache and unsaved drafts. When ownership moves, remove the
  old authoritative implementation and writable mirror; an adapter may only
  delegate.
- TypeScript direction. Substantial new production implementation belongs in
  the strict typed islands under `src/browser/` and `src/node/` when that is
  where the responsibility fits. Focused fixes to existing JavaScript and
  minimal bootstrap/entry adapters are acceptable with a reason. Do not convert
  every touched file, add line quotas, or use `any`, non-null assertions and
  suppressions as substitutes for modeling and validation.
- Focused changes. Keep intentional behavior changes, moves and type work
  distinguishable. Avoid unrelated rewrites, framework migrations, dependency
  upgrades, broad formatting sweeps and gratuitous abstractions.
- Preserve user work. Inspect `git status` and the current branch before
  editing. Do not discard, overwrite or stage changes you did not make.

## Runtime and repository map

- `server.js` is the canonical startup: load `.env`, read configuration, verify
  readiness, create the app and listen. It must not run DDL.
- `server/app.js` creates the Express app, serves the static allowlist, mounts
  feature routers and owns shared auth/profile/character/scene routes. Feature
  routers live in `server/`. The typed interactions and timeline routers are
  emitted from `src/node/` and loaded through `server/interactions.js` and
  `server/timeline.js` adapters.
- `db/schema.ts`, `db/relations.ts` and `drizzle/` define the schema and
  migrations. Runtime queries use the injected `postgres` client, not
  `db/index.ts`. Inspect generated SQL and migration diffs carefully; do not
  apply unrelated generated changes.
- `index.html`, `app.js`, `editor.js`, `client/api.js` and `style.css` are the
  browser shell. `src/browser/` contains typed helpers compiled into the
  ignored `generated/client/vault.js` bundle (`VaultModules`). `app.js` remains
  the rendering, navigation and composition owner.
- `src/node/` contains typed Node islands for interactions, timeline, runtime
  configuration and the public capture/sandbox tooling. The build emits them
  under ignored `.generated/node/`; CommonJS adapters and scripts load the
  emitted files.
- `scripts/` contains migration preflight, bootstrap, recovery/import and test
  tooling. `tests/unit`, `tests/integration` and `tests/browser` hold the three
  test families.

See `docs/development/architecture.md` for the responsibility and
transitional-seam map.

## Development environment

- Use Node.js 24 from `.nvmrc` and the committed lockfile. Run `nvm use` before
  npm commands if your shell uses nvm.
- Check for an existing `.env` before creating one. If none exists, copy
  `.env-example`; otherwise preserve the existing file and edit it
  deliberately. Never overwrite working credentials.
- `npm ci` installs locked dependencies and runs the `postinstall` build. The
  build needs development dependencies (TypeScript and esbuild); a
  production-only install cannot run it.
- `npm run build` runs the typechecks, emits `.generated/node/` and bundles
  `generated/client/vault.js`. Rebuild after changing TypeScript sources.
  `npm start` and `npm run dev` do not compile; their pre-hooks check that the
  required generated files exist.
- Development PostgreSQL starts with `docker compose up -d --wait` on
  `127.0.0.1:55432`. Run `npm run db:preflight -- --target=development` before a
  migration. Follow `docs/development/verification.md` and
  `docs/planning/verification-and-recovery.md` for the guarded procedure.
- The app listens on `http://localhost:3000` by default. Check whether a server
  is already running before starting another instance on that port.
- Do not remove the Compose volume as routine setup or cleanup.

## Verification

- Follow the risk-triggered matrix in `docs/development/verification.md`. A
  skipped, blocked or unrun check is not a pass.
- The default static gate is `npm run verify:static`: typecheck, Node/browser
  build, typed lint, JavaScript syntax and unit tests. It needs no database or
  private inputs.
- Integration and browser suites require the isolated test database: run
  `npm run test:env:up`, test-target preflight and test-target migration first.
  The guarded runners compare a read-only development sentinel before and after.
  `npm run test:migration:populated` uses synthetic records and a disposable test
  database; it does not migrate real data.
- For TypeScript/runtime changes, run the affected static gate plus unit tests.
  For JavaScript changes, also run `node --check` on the changed files.
- For API, permission, persistence or concurrency changes, run the relevant
  isolated integration tests and verify fresh reads, permission failures and
  rollback behavior.
- For UI/browser-state changes, use the actual generated bundle, run the
  affected browser tests and inspect the affected screen in a browser.
- For migration changes, exercise isolated empty, populated and refusal paths.
  Do not migrate real data or test recovery against the development database.
- Run `git diff --check` for whitespace errors and resolve affected local
  Markdown links.
- Report the commands run, exits, skipped suites and remaining limitations
  rather than claiming unrun evidence.

## Git and contributions

- Work on a feature branch; do not commit directly to `main`.
- The original project is `Dilligent-Yard/eterverso`. In a typical fork,
  `origin` is your fork and `upstream` is `Dilligent-Yard/eterverso`; pull
  requests target `Dilligent-Yard/eterverso:main`. Verify the remotes in your
  checkout rather than assuming a personal fork.
- Keep commits focused. Describe the concrete behavior, ownership/removal,
  compatibility and validation in the pull request; use
  `.github/pull_request_template.md`.
- Do not push, open a pull request, merge or deploy unless the task explicitly
  authorizes it.
- Keep durable project facts in versioned documentation. Do not assume another
  session has read this chat.
