# Public-data local sandbox runbook

This runbook documents the optional local public-data sandbox tooling. It is for
exercising the changed site locally against a reconstruction of the site's
**publicly readable** content. It is not a database backup, deployment
procedure, or editorial publication.

## What the copy contains and omits

Preserved from anonymous public JSON: visible characters, scenes and turns,
published wiki pages/bodies, wiki sections/categories, and forum discussions
referenced by captured wiki pages. Missing by design: accounts/passwords,
private sources, proposals, unpublished revisions, hidden/archived content,
complete revision history, and any private production data. Public authors are
mapped to non-login placeholders; three synthetic local testers are created.

External HTTPS images remain external. Relative images/avatars from the site
origin are qualified to the public origin. The sandbox is data-local, not a
fully offline media mirror.

## Prerequisites

- Node.js 24 (`source ~/.nvm/nvm.sh && nvm use 24`).
- Docker with the repository's existing Compose installation.
- No inherited `DATABASE_URL` in the shell when running sandbox commands.
- Never point these commands at development or the automated test service.
  The sandbox uses its own project, volume, database, port `55434`, and app
  port `3001`.

## 1. Capture public content (anonymous read-only)

```sh
node scripts/public-snapshot-fetch.js \
  --output .local/public-snapshots/public-2026-11-09
```

Output must be a new directory under `.local/public-snapshots/`. The tool uses
anonymous GET only, one request per second, bounded retries, and fails closed
with explicit gaps. It does not log in or write to production. A complete
capture exits 0; inspect any gaps before importing.

`--dry-run` validates arguments without network access or output creation.
`--allow-loopback-http` and `--allow-test-output` are test-only and must not be
used for production capture.

## 2. Validate and preview the import

```sh
node scripts/public-sandbox.js import \
  --capture .local/public-snapshots/public-2026-11-09 \
  --dry-run
```

The dry run verifies manifest hashes, the dataset digest, counts, entity
inventory, and forum dependency closure, then prints the planned record counts
and every normalization/gap. It performs no database connection or write.

## 3. Provision, migrate, import

```sh
node scripts/public-sandbox.js provision
node scripts/public-sandbox.js migrate
node scripts/public-sandbox.js import \
  --capture .local/public-snapshots/public-2026-11-09
```

Provision creates independent credentials under `.local/public-sandbox/`
(mode 700/600), a private instance record, the dedicated Compose project and
volume, and verifies the connected database/role/version/address and published
binding. Migrate reuses the committed Drizzle journal and readiness checks.
Import is transactional; an exact repeat is a no-op, and conflicting or
locally edited content is refused rather than overwritten.

## 4. Run the local site

```sh
node scripts/public-sandbox.js start
```

Open <http://127.0.0.1:3001>. The process stays in the foreground; stop it with
Ctrl+C. If you start it in the background for testing, record its PID (for
example with `pgrep -f 'scripts/public-sandbox.js start'`) and stop that specific
process rather than using a broad process-name kill. `status` reports
database/app-port state; `stop` stops only the owned database project and
preserves the named volume. There is no implicit reset or `down -v`.

Synthetic tester credentials are generated privately at
`.local/public-sandbox/testers.env` (mode 600). Do not paste them into commits,
reports, or chat. They are local test accounts only.

### Manual checklist

- [ ] Browse the forum, characters, scenes, and wiki; reload direct URLs.
- [ ] Open character/scene/wiki links in new tabs (middle/Ctrl/Cmd-click).
- [ ] Open a rich character, preview/export JSON, re-import it, save, reload.
- [ ] Open a scene with turns; verify turn order and participant rows.
- [ ] Edit and re-read a character/scene; confirm persistence after reload.
- [ ] Test a member account against staff-only controls.
- [ ] Reload a drafted form and confirm account-scoped restoration.
- [ ] Open the timeline, create/edit/delete a synthetic event as staff, and
      confirm the optimistic-concurrency error on a stale edit.
- [ ] Toggle a character/scene/turn like and open the notifications panel.
- [ ] Confirm external images behave as documented.

## 5. Stop and resume

```sh
node scripts/public-sandbox.js stop
node scripts/public-sandbox.js provision   # resumes owned container/volume
```

This stop/resume cycle was exercised on the real owned service: the container
and network were removed, the named volume was preserved, and `provision`
recreated the container and verified the connected sandbox identity. The
database was subsequently migrated to `verified-0017-timeline-events` after a
verified `pg_dump` backup under `.local/public-sandbox/backups/`.

A repeat import of the same capture is a no-op on a pristine sandbox. After
manual local edits it refuses with a field-specific conflict rather than
overwriting them. To use a newer capture, keep the old sandbox for comparison
or create a separate environment; do not expect an automatic destructive
refresh.

## Current verified result

Live capture `capture-20261109T154244Z-0e84746d` (2026-11-09) imported successfully:
5 characters, 3 scenes, 6 turns, 1 published wiki page, 16 sections, 2 wiki
categories, 0 referenced forum threads/posts, 0 gaps. The sandbox is
`eterverso_public_sandbox` in project `eterverso-public-sandbox`, volume
`eterverso-public-sandbox-data`, instance
`8dc35510-ace6-464d-a172-99c7784f677c`. The app listens on
<http://127.0.0.1:3001> when started. Tester credentials are in
`.local/public-sandbox/testers.env` (private, mode 600).

A canonical comparison found no content differences in characters, scenes,
turns, wiki bodies, sections, or categories. Documented differences: public
author roles are downgraded to non-login placeholder members; the wiki revision
author is the labelled `reconstrucao-local` actor (body unchanged); local
revision/history IDs are reconstruction metadata; external media remains
external. The persistence probe changed one character to version 5 and restored
its title, so a repeat import now correctly conflicts on `version`/`updatedAt`
instead of no-op; use a fresh sandbox instance for a pristine no-op baseline.

The sandbox was upgraded from 0015 to 0017 (notifications, likes, timeline)
after a verified custom-format backup, preserving the imported content and the
documented version-5 probe metadata. Real PostgreSQL rollback was exercised in
disposable probe databases: a full synthetic import inserted inside a
transaction and a forced failure left every touched table at its baseline
count. A committed import also completed on a disposable 0017 database.

The integrated application now serves this sandbox. It passed the timeline
create/stale/update/delete flow, turn-like canonical/legacy alias convergence,
notification dedup/read/delete, timeline audit writes, character like toggling,
scene/turn rendering, wiki reading and the existing browser suites.

The checks above are the operator-facing summary; the detailed verification
evidence remains in the local development history rather than this operator
runbook.

## Troubleshooting and safety

- Target guards refuse dev/test/remote/unknown databases, inherited
  `DATABASE_URL`, wrong container labels/volume, and wrong connected identity.
  Do not bypass them.
- Do not use the sandbox to publish real lore or write to production.
- Raw captures and tester credentials live under ignored `.local/` and must
  remain private.
- If a capture reports gaps, inspect them before importing; do not treat zero
  counts as success.
