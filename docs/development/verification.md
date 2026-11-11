# Verification and test entry points

This is the current verification entry point for contributors. It lists
commands that exist at this revision and the prerequisites they need. Check
`package.json` and the relevant script before relying on an older example; do
not advertise a command that has not been implemented.

## Base requirements

- Node.js 24 from `.nvmrc` and the committed npm lockfile.
- An existing `.env` for local application work. Do not create or replace one
  silently; preserve working credentials.
- Docker Compose for the development PostgreSQL 17 service on
  `127.0.0.1:55432`, and for the isolated test service on a generated loopback
  port from 55433.
- Playwright Chromium for browser tests: `npx playwright install chromium` if
  the browser is missing.
- The private `.local/development-baseline.dump` for the current populated
  migration check. This is a local prerequisite, not a clean-checkout fixture.

## Setup and build

Full local setup, `.env` generation and the guarded development migration are
documented in `README.md` and the operational runbook. The build-specific
sequence is:

```sh
nvm use
npm ci                 # installs locked dependencies and runs postinstall build
# or, after dependencies are installed:
npm run build
```

`npm run build` runs `npm run typecheck`, `npm run build:node` and
`npm run build:client`. It emits CommonJS Node islands under `.generated/node/`
and the browser IIFE bundle `generated/client/vault.js`. Both output trees are
ignored by Git. Rebuild after changing TypeScript sources.

`npm start` and `npm run dev` run `node server.js`; their pre-hooks run
`node scripts/check-build.js`, which refuses to start when required generated
files are missing. The check proves existence, not freshness. The optional
`npm run start:ts` and `npm run dev:ts` entries use `ts-node` and delegate to
the canonical startup; they are not required for normal development.

A runtime-only artifact should be built while development tools are available:

```sh
npm ci --include=dev   # postinstall runs the build
# Apply reviewed migrations as an explicit operator step, not at startup.
npm prune --omit=dev
npm start
```

The `postinstall` hook needs TypeScript and esbuild, which are development
dependencies. Do not use a production-only `npm ci --omit=dev` as the build
stage, and do not run `npm run build` after pruning.

The default static gate for a clean checkout is:

```sh
npm ci                 # locked install; postinstall builds the generated outputs
npm run verify:static  # typecheck, build, typed lint, JS syntax and unit tests
```

`npm run check:js` checks repository JavaScript syntax without executing it. It
excludes generated, dependency and private local trees; it is also part of
`verify:static`.

## Core commands

| Command | Purpose | Prerequisites and notes |
| --- | --- | --- |
| `npm run typecheck` | Typecheck the legacy schema/server entry plus Node and browser islands | Dependencies installed; no database |
| `npm run lint:typed` | Strict typed lint for `src/browser` and `src/node` | Dependencies installed; no database |
| `npm run build:node` | Compile Node islands to `.generated/node/` | Dependencies installed |
| `npm run build:client` | Bundle the browser facade to `generated/client/vault.js` | Dependencies installed |
| `npm run check:js` | Parse repository JavaScript with Node 24; never execute it | Dependencies installed; excludes generated/private/dependency trees |
| `npm run verify:static` | Typecheck, build, typed lint, JS syntax and unit tests | Dependencies installed; no database or private inputs |
| `node scripts/check-build.js` | Check that required generated outputs exist | Run after a build; does not check freshness |
| `npm start` | Run `node server.js` | Existing `.env`, built outputs, ready database schema |
| `npm run dev` | Same runtime as `npm start` | Same as `npm start` |
| `npm run test:unit` | Unit tests; no database or browser required | Pre-hook rebuilds Node/browser output |
| `npm run test:integration` | PostgreSQL and HTTP integration tests | Isolated test environment and migrated test schema; existing development `.env` for the sentinel |
| `npm run test:browser` | Playwright browser tests | Isolated test environment, migrated test schema and Chromium; existing development `.env` for the sentinel |
| `npm test` | Unit plus integration suites | Same test setup as integration; does not include browser |
| `npm run test:all` | Unit, integration and browser suites | Full isolated test setup |
| `npm run test:env:up` | Start the isolated test service and write private test configuration | Docker and existing development `.env` |
| `npm run test:env:down` | Stop the isolated test service and keep its test-only volume | Does not remove the development volume |
| `npm run test:migration:populated` | Restore a private verified 0006 baseline, add synthetic rows, migrate and compare | Isolated test target plus private `.local/development-baseline.dump`; see caveat below |

The test runner requires Node 24. It loads the development sentinel from the
existing `.env` and checks that it is unchanged before and after integration or
browser runs. It removes inherited `DATABASE_URL`/`DEV_DATABASE_URL` from child
test processes and supplies only the isolated `ETERVERSO_TEST_DATABASE_URL`.

## Database commands

Every database preflight and migration command requires an explicit target;
timeline seeding requires an explicit target or an explicit `DATABASE_URL`; the
administrator bootstrap requires an explicit database name and environment
file.

```sh
npm run db:preflight -- --target=development
npm run db:migrate -- --target=development
npm run db:preflight -- --target=test
npm run db:migrate -- --target=test
```

- `--target=development` accepts only the local `eterverso` database on
  loopback port 55432. A development migration also requires a private,
  non-empty `.local/development-baseline.dump` that the wrapper validates before
  running.
- `--target=test` requires `npm run test:env:up` and the private test
  configuration. The wrapper asserts container ownership and target identity
  before writing.
- `--target=sandbox` requires a provisioned, ownership-checked public sandbox.
- Preflight is a read-only schema/history inspection but writes a private report
  under `.local/test/reports/` (or `.local/public-sandbox/reports/` for the
  sandbox). Automatic migration supports an empty database or an exact reviewed
  schema state; unknown or divergent states are refused.
- Startup only verifies readiness. It does not run DDL, migrations or seed data.
- Do not remove the development volume, reset the development database or test
  recovery against real data.

Timeline seed material is a content decision and is never loaded at startup.
After an explicit review, load it only into an empty timeline with
`npm run db:seed:timeline -- --confirm-empty --target=development` (or the
corresponding `test`/`sandbox` target), or use the explicit `DATABASE_URL` form
documented in `README.md`.

## Content and tooling commands

These commands exist but are not part of ordinary application changes:

- `npm run wiki:authoring:compile` validates staged authoring JSON and produces
  a portable bundle offline. It does not load `.env`, send requests, write a
  database or publish.
- `npm run wiki:authoring:revision-plan` prepares citation-aware staff revision
  requests offline from explicit target/source bindings.
- `npm run wiki:sources:stage -- --archive <path>` and
  `npm run wiki:sources:import ...` operate on private source archives and an
  explicitly named database. They are not a publication path.
- `npm run public:fetch -- --output <new-directory>` captures anonymous public
  API data into private `.local/public-snapshots/`; it defaults to the
  production origin, supports `--dry-run`, and never sends cookies or
  credentials.
- `npm run public:sandbox -- <provision|migrate|import|start|stop|status>` manages
  a separate ownership-checked sandbox. It uses Docker and private
  `.local/public-sandbox/` state; do not point it at development or real data.

## Risk-triggered checks

| Change type | Minimum checks | Evidence notes |
| --- | --- | --- |
| Documentation only | Local link/path/command/source accuracy; preserved requirements; `git diff --check` | A prose-only diff does not require rerunning application suites as evidence; do not claim behavioral verification |
| TypeScript or runtime | `npm run typecheck`, `npm run lint:typed`, `npm run build`, affected unit tests | JavaScript changes also need `node --check`; report whitespace checks |
| API, permissions, persistence or concurrency | Relevant isolated integration tests plus fresh-read, authorization-failure and rollback checks | Confirm the development sentinel was unchanged; do not test against development |
| UI or browser state | Actual generated bundle, affected browser tests and inspection of the real screen | Use separate browser contexts for account/session independence; verify drafts, reload and stale-response behavior |
| Migration | Isolated empty, populated and refusal paths; recovery checks where applicable | No real-data migration; the current populated command needs the private baseline described below |
| Build or deployment contract | Clean install/build/prune/start, static/API/private-path probes and shutdown | No deployment is authorized by a local check |
| Security or privacy | Relevant auth, CSRF, sanitization, source and private-path tests | Keep credentials, DSNs, private source text and raw captures out of logs and commits |

A skipped, blocked or unavailable prerequisite is not a passed gate. A clean
compiler, checker or model review is not a behavioral acceptance.

Add a regression test when the behavior warrants it. Do not add tests that
merely restate the implementation or assert static documentation prose.

## Manual flow checks

For affected user flows, inspect the real screen and verify persistence rather
than only reading the code. Useful smoke checks include registration,
login/logout, profile updates, and character, scene and turn
creation/editing/deletion as applicable. For API or persistence changes, check
the response, permission failures and a fresh read or page reload.

Use temporary records in the local development database and clean them up. Do
not use real accounts, private lore or production data for a smoke check.

## Test target guards

`npm run test:env:up` reads the existing development `.env`, refuses to create
or replace it, starts only the `compose.test.yaml` service and writes private
configuration under `.local/test/` with owner-only permissions. It selects a
free loopback port from 55433 upward and refuses an occupied container that
this project does not own.

Integration and browser runners call `scripts/test-env.js assert` before tests,
verify Docker/container ownership and the test DSN, and compare a read-only
development database sentinel before and after the run. The development
sentinel check accepts only the local `eterverso` database on loopback port
55432. Tests receive the isolated test DSN, never the development DSN.

The browser runner uses Chromium headless with one worker; two tabs in one
profile do not establish session independence. Use fresh contexts where the
test needs separate cookies, localStorage and sessionStorage.

## Populated migration caveat

At this revision, `npm run test:migration:populated` restores
`.local/development-baseline.dump`, a private verified 0006 baseline. The
command checks that the dump is a regular, non-empty, owner-only file, restores
it into a uniquely named disposable test database, adds synthetic records,
applies the reviewed migrations and compares selected content. It never targets
the development database. Because the baseline is private, this exact command
is a local/historical procedure and is not reproducible from a clean checkout
or public CI.

Do not describe this as migration of real users' data, and do not infer that a
private baseline validation proves public synthetic portability. The dated
runbook `docs/planning/verification-and-recovery.md` retains that task's
detailed requirements and recovery instructions; it is historical operational
evidence, not a clean-checkout CI script.

## Verification evidence

Record the tested commit, worktree, Node version, commands, exits, salient
assertions and any skipped or blocked checks. Test counts belong to the tested
commit and should not be copied forward as permanent claims. For UI changes,
identify the affected screen and the actual browser used. For API or
persistence changes, include the request/response outcome and a fresh read.
For migration changes, distinguish synthetic, local and real-data evidence.

`.github/workflows/verify.yml` runs the static gate on pull requests, pushes and
manual dispatch with Node 24, locked dependencies and read-only contents
permission. This revision commits only that static job. A local workflow file
does not prove an actual hosted run or branch-protection state; those remain
maintainer operations.
