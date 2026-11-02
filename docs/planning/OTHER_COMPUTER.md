# Continue on another computer

GitHub stores the application, tests and planning documents on Arthur's fork,
branch `arthur/local-setup`. Git does not copy a device's PostgreSQL database,
accounts, characters, `.env`, ignored sources or private editorial drafts.
Planning from files does not require a database or local admin login.

## Get the branch

Clone the fork into a new directory and open that directory as the Codex project:

```sh
git clone --branch arthur/local-setup https://github.com/ArthurAleksandravicius/eterverso.git
cd eterverso
```

If a checkout already exists, first inspect `git status` and its remote URLs.
Preserve existing changes, fetch the fork, and switch to `arthur/local-setup`.
Do not reset an existing checkout to make it match these instructions.

## Bring the private editorial materials separately

On the original device a private source-and-pilot archive was prepared at:

```text
.local/handoffs/aetherverse-editorial-workspace-2026-10-21.tar.gz
```

Copy this file to the other computer using your own private file transfer.
It contains the staged lore package, source manifests, pilot outlines,
editorial notes, five pilot snapshots and the portable pilot wiki bundle.
It excludes `.env`, account credentials, sessions, database dumps, user
characters and test configuration. It is private lore material; keep it out
of Git and public uploads.

From the root of a fresh clone without existing private wiki materials,
extract the archive (replace the example archive path):

```sh
tar -xzf /path/to/aetherverse-editorial-workspace-2026-10-21.tar.gz
```

If `.local/wiki-pilots/` or the matching `.local/wiki-sources/` archive
directory already exists, compare it before extracting; do not overwrite newer
material. Extraction restores repository-relative paths. Historical absolute
paths in manifests may still name the original device; do not edit provenance
manifests just to change those paths.

The archive includes a file-hash manifest. Check the restored files from the
repository root with Python 3:

```sh
python3 - <<'PY'
import hashlib
import json
from pathlib import Path

manifest = json.loads(Path('.local/editorial-handoff/manifest.json').read_text())
for entry in manifest['files']:
    relative = Path(entry['path'])
    if relative.is_absolute() or '..' in relative.parts:
        raise SystemExit('Unsafe path in handoff manifest')
    if hashlib.sha256(relative.read_bytes()).hexdigest() != entry['sha256']:
        raise SystemExit('Private handoff verification failed')
print(f"Verified {len(manifest['files'])} private source and pilot files.")
PY
```

## Start the planning chat

Select Sol 6.1 / High and use `WIKI_EDITORIAL_START_PROMPT.md`. The brief and
restored private files supply the context; this conversation need not be
copied. Read `EXECUTION_STATE.md` as a report of the original device's local
setup, not as evidence that the new device already has a database or server.

If you later want to run the app on that computer, follow README using Node 24
and fresh local configuration. Never copy credentials into the repository.
The source/pilot archive is not a full database backup; importing its wiki
bundle into a newly prepared database is a separate, reviewed operation and
does not restore Mand's account or the test character.
