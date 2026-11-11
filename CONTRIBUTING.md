# Contributing to aetherverse vault

aetherverse vault is a Portuguese-language forum, character collection,
reference wiki and collaborative RPG. The browser app uses plain JavaScript,
HTML and CSS; Express serves the app and API; PostgreSQL stores shared state.
Contributions should fit that existing stack and preserve the Portuguese
interface and RPG terminology unless a change is explicitly about them.

## Before you start

Read `README.md` for local setup and `docs/development/verification.md` for the
checks that apply to your change. `docs/development/architecture.md` explains
current ownership, build boundaries and known transitional seams.

Use Node.js 24 from `.nvmrc` and the committed npm lockfile. Check whether
`.env` already exists before creating one; never overwrite working credentials.
Keep secrets, private recovery exports, source archives and generated test
configuration out of Git.

## Branches, forks and pull requests

The original project is `Dilligent-Yard/eterverso`. In a typical fork, `origin`
is your fork and `upstream` is the original repository. Branches should start
from the current `upstream/main`, be pushed to your fork, and open pull requests
against `Dilligent-Yard/eterverso:main`. Verify the remotes in your checkout
rather than assuming a particular personal fork.

```sh
git switch -c your-name/short-change-description
# Make and check a focused change.
git add path/to/changed-file
git commit -m "Describe the change"
git push -u origin HEAD
```

Do not merge, deploy or publish lore unless the task explicitly authorizes it.
The repository can contain local task records under `docs/planning/`; those are
historical evidence, not current contribution requirements.

## Scope and reviewability

Prefer one coherent concern per pull request. Keep intentional behavior changes
separate from moves, renames and type-only work so reviewers can see what is
preserved and what changes. Architecture-only changes, simplification and net
code deletion are valid contributions when they remove real coupling or
duplication and keep behavior covered.

Split unrelated deployment changes, framework migrations, dependency upgrades
and broad data migrations into separate work. Commit count, line count or the
number of files is not by itself a quality claim, and every touched file does
not need to be converted to TypeScript.

## Behavior and ownership

- Keep server authority explicit. Shared accounts, forum content, characters,
  scenes, scene turns, wiki state, timeline events and interactions belong in
  PostgreSQL. Browser storage is for account-scoped drafts, preferences and the
  separate legacy recovery workflow.
- Enforce authorization, CSRF, session validity, input validation, HTML
  sanitization and version/concurrency checks on the server. Browser role checks
  only control the interface.
- Keep one authoritative owner per state machine or policy. A module or
  function abstraction should remove or isolate real coupling, not add generic
  layers for their own sake.
- When responsibility moves, remove the old authoritative implementation and
  writable mirror. An adapter may delegate to the new owner but must not keep a
  second implementation or silent fallback.
- Substantial new production implementation should use the strict typed islands
  under `src/browser/` and `src/node/` where the responsibility fits. Focused
  fixes to existing JavaScript and minimal entry adapters are acceptable with a
  reason. Do not use `any`, non-null assertions or compiler/lint suppression as
  a substitute for modeling and runtime validation.
- The browser shell owns rendering, navigation, composition and compatibility
  wiring. Do not add unrelated policy or state machines there by default, and
  do not make typed modules depend back on shell globals.

See `docs/development/architecture.md` for current owners and the transitional
retirement map.

## Temporary exceptions

Every meaningful temporary exception should record its reason, the risk it
introduces, the replacement or removal condition, and the trigger that should
make the project reconsider it. Preserve recovery requirements that still
protect unknown real data. Do not turn a temporary adapter, legacy route or
private fixture prerequisite into an undocumented permanent interface.

## Verification and evidence

Run the checks appropriate to the risk of the change; the matrix in
`docs/development/verification.md` is the entry point. In the pull request or
review note, report the actual commands and exits, tests that failed, tests that
were skipped or blocked, and any manual or browser checks. Do not present a
skipped prerequisite as a passing gate.

- Documentation-only changes need link, path, command and source-accuracy
  checks plus `git diff --check`; they do not need application suites rerun as
  evidence for prose.
- TypeScript and runtime changes normally need `npm run verify:static` (or the
  affected typecheck, build, typed-lint, JS-syntax and unit commands) plus
  affected tests. JavaScript changes also need `node --check`.
- API, permission, persistence and concurrency changes need the relevant
  isolated PostgreSQL/HTTP tests, including failure and fresh-read behavior.
- UI and browser-state changes need the actual generated bundle, affected
  browser flows and inspection of the real screen.
- Migration changes need isolated empty, populated and refusal paths. Do not
  migrate real data or test recovery against the development database.
- Build and deployment-contract changes need a clean artifact build, prune and
  start check with static, API and private-path probes.

Counterexample regressions and real tool output are stronger evidence than
confidence. A clean automated run does not replace missing requirements or
manual checks for an affected user flow. Independent review is useful when the
risk warrants it; no paid model, personal account or fixed reviewer ceremony is
required.

## Database, security and privacy

- `server.js` verifies schema readiness and must not run DDL, migrations or
  content seeding at startup.
- Database preflight, migration and seed commands require an explicit
  `--target` (or their documented explicit DSN). The administrator bootstrap
  requires an explicit database name and environment file. Development is the
  local Compose PostgreSQL 17 on `127.0.0.1:55432`; tests use the separate
  `compose.test.yaml` service. Never point tests at the development database.
- Do not remove the development volume, reset a database, overwrite `.env` or
  discard recovery dumps as routine cleanup.
- Use synthetic data in committed tests. Do not commit real browser exports,
  private source text, credentials, dumps or production data.
- Do not expose private fields, unpublished drafts, source text or restricted
  records through public APIs, pages, logs, screenshots or exports.

## Pull request description

Use `.github/pull_request_template.md`. Describe the concern and scope,
intentional behavior changes versus preserved behavior, old and new owners
when responsibility moves, compatibility/removal notes, commands run with
failures and skips, and any temporary exceptions, deployment concerns or data
risks. Keep the description proportional to the change.
