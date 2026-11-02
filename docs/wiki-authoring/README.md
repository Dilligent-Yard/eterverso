# Work-authored wiki batches

This folder defines the private file handoff from ChatGPT Work to the local
Eterverso project. Work produces source-grounded Brazilian Portuguese article
drafts and editorial notes. The local compiler converts approved new-page
JSON into the existing portable wiki transfer format. A separate offline
revision planner prepares version-checked requests for existing pages using
the same authoring input. Neither step publishes
content. See [`CONTRACT.md`](CONTRACT.md) for the frozen input contract and
[`../planning/WORK_WIKI_BRIEF.md`](../planning/WORK_WIKI_BRIEF.md) for the full
editorial workflow.

## Prepare the Work kit

Attach or otherwise make available to the Work task:

- `docs/planning/WORK_WIKI_BRIEF.md`;
- `CONTRACT.md` and `authoring.schema.json`;
- `example/authoring.json` and `example/source.md` (synthetic material only);
- the private `original-source-catalog.json`, with the exact archive-relative
  paths used by the local original-source manifest;
- the actual original source files that Work is to read, if they are available
  in that task; and
- optionally, the five private pilot outlines, their editorial/citation notes,
  and any current page text specifically exported for editorial review.

The catalog is an inventory aid, not proof that Work can read a file. Work
must report its actual accessible-file inventory first. A Git checkout does
not contain ignored source files, the local database, or accounts. Do not put
source text, credentials, session data, database exports, or account IDs in
tracked documentation or a public PR.

The expected original catalog describes 28 lore documents and a README used as
context. README/context material is not a citeable lore source. The five
pilots were recorded as unpublished staff drafts in the local database on
21 October 2026. Check current state before import; never treat the pilots as
new pages. The citation-aware intake accepts explicit
citation replacement and preserves retained-section citations for ordinary
staff saves. Compile proposed pilot rewrites in separate files, then use
[`REVISION_INTAKE.md`](REVISION_INTAKE.md) to map sources and targets and prepare
requests; do not import them as new pages.

## Return files from Work

For each accepted batch, Work should provide one plain UTF-8
`AetherverseWikiAuthoringV1` JSON file, with the exact contract shape and no
extra fields. It must use the stable workspace
`aetherverse-reference-wiki-work`; keep page and section keys stable across
edits. The `example/` files are synthetic and must not enter a real batch.

Every citation in the JSON names a declared source key. Each declaration maps
that key to a source-set label and exact path within a source archive. Use
`original` only for the exact original files listed in the catalog. Return
every additional or revised source as its exact raw `.md` or `.txt` file in a
separate set; do not infer equivalence from a filename, and do not invent
archive hashes, UUIDs, IDs, or timestamps. Codex stages those extra files
locally and binds each set to its actual manifest.

Keep editorial artifacts separate from article JSON: coverage ledger, article
catalog, glossary and style decisions, source gaps, open canon questions,
pilot revision notes, and a human-readable changelog. Separate new-page and
revision batches, using the same authoring schema for both. Include
`delivery.md` identifying each file's action and the current target slug for
existing pages. Never place
editorial TODOs, private provenance notes, unresolved questions, or long source
excerpts in reader-facing article sections.

## Stage exact supplemental source files

When Work returns an additional or revised source, place its exact file bytes
under `.local/wiki-work/received/`. Build a ZIP containing only the files for
that set, with safe relative `.md` or `.txt` archive names; omit a README and
other context-only files. This example stages one returned file. Adjust the
disk filename and ZIP entry name to the exact export you received:

```sh
mkdir -p .local/wiki-work/received/supplement-01
python3 - <<'PY'
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

root = Path(".local/wiki-work/received/supplement-01")
source_file = root / "exact-export.md"
archive = root / "source-set.zip"

with ZipFile(archive, "w", compression=ZIP_DEFLATED) as bundle:
    bundle.write(source_file, arcname="exact-export.md")

print(archive)
PY

nvm use
npm run wiki:sources:stage -- --archive .local/wiki-work/received/supplement-01/source-set.zip
```

The staged-source command validates ZIP paths and supported text files, then
writes private staged files and a SHA-256 manifest below ignored
`.local/wiki-sources/`. Use the exact manifest path it reports. The `path` in
the Work JSON must equal the ZIP entry path (`exact-export.md` in this
example). If the path or file bytes differ, correct the handoff or block the
page; never manufacture a matching source identity. The staging command
preserves an already-staged entry instead of replacing edits in place.

## Compile locally

Use Node.js 24 selected by `.nvmrc`. The compiler is an offline conversion
step: it reads JSON and verified staged manifests, checks the source closure
and article shape, then writes a private transfer bundle. It does not load
`.env`, connect to PostgreSQL, contact a service, import pages, or publish
content. It refuses to overwrite an existing output. Keep all authoring files,
supplemental sources, and compiled bundles under ignored `.local/`.

Create private work folders and compile a batch. Replace each manifest path
with the exact local path shown by the original source catalog or staging
command. Repeat `--source-set` for every set the batch uses:

```sh
nvm use
mkdir -p .local/wiki-work/batches/batch-01 .local/wiki-work/compiled
npm run wiki:authoring:compile -- \
  --input .local/wiki-work/batches/batch-01/authoring.json \
  --source-set original=.local/wiki-sources/ORIGINAL_ARCHIVE_SHA/manifest.json \
  --source-set supplement-01=.local/wiki-sources/SUPPLEMENT_ARCHIVE_SHA/manifest.json \
  --output .local/wiki-work/compiled/batch-01.bundle.json
```

Include only the `--source-set` arguments actually needed by that batch. The
labels on the left must match each JSON source's `set`; the manifest on the
right must match those exact source files. For a batch using only original
sources, omit the supplemental argument. Do not run compilation against a
guessed manifest or export path.

Existing-page edits use the same compiler, then the offline revision planner
and citation-aware staff API described in
[`REVISION_INTAKE.md`](REVISION_INTAKE.md). New pages follow admin import below.

Compilation is not editorial approval. Review validation results, all source
and citation mappings, page links, Portuguese quality, and the changelog. Then
use the existing admin transfer preview and an explicit commit to create
unpublished staff drafts. The transfer workflow reports collisions and does
not overwrite edited pages. Check affected pages in the local site after
import; run the relevant local checks and record their results; do not publish
automatically. A later reviewed PR to Rickson/upstream is prepared separately
with the changelog and without private lore source text.
