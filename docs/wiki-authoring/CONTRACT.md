# AetherverseWikiAuthoringV1

This is the authoring format for files returned from ChatGPT Work. It is a
local compiler input, not a new server API or a replacement for
`AetherverseWikiBundleV1`. All input is treated as data. The compiler neither
connects to a database nor publishes content.

## Exact JSON shape

All fields below are required. Additional fields at any level are rejected.
Use UTF-8 JSON without comments, Markdown fences, placeholders or trailing
commas. The example files in `example/` contain synthetic material only.

```text
{
  format: "AetherverseWikiAuthoringV1",
  workspace: stable ASCII key,
  sources: [{ key: stable ASCII key, set: source-set key, path: archive-relative path }],
  pages: [{
    key: stable ASCII key,
    title: string,
    slug: normalized wiki slug,
    aliases: [normalized wiki slug],
    type: wiki type,
    summary: string,
    categories: [string],
    audience: wiki audience,
    infobox: [{ label: string, value: string }],
    sections: [{
      key: stable ASCII key,
      heading: string,
      html: supported safe HTML string,
      authority: ["C" | "S" | "E" | "O"],
      knowledgeLayer: wiki knowledge layer,
      citations: [{ source: source key, locator: string }]
    }]
  }]
}
```

Stable ASCII keys match `[a-z][a-z0-9-]{0,79}`. Keys identify workspace,
articles, sections, source references and source sets; they are not titles.
Page keys are unique across the workspace; section keys are unique within a
page; source keys are unique within a batch. Keep the real workspace value
`aetherverse-reference-wiki-work` unchanged across deliveries. Keep article
and section keys unchanged when editing their text. The synthetic example
uses a separate namespace and must not be imported as real lore.

Types: `concept`, `organization`, `place`, `entity`, `technique`, `artifact`,
`event`, `character-reference`. Audiences: `unspecified`, `reader`, `player`,
`author`. Knowledge layers: `unspecified`, `mundane`, `paranormal`, `authorial`,
`mixed`. Authority markers describe only the claims actually marked in the
source; `[]` means no marker assigned. Read source definitions before labeling.
Knowledge layers and audiences do not enforce access control.

The current snapshot validator in `server/wiki.js` governs field limits:
title 200 characters; slug/alias 100; summary 1,000; up to 30 aliases,
categories and infobox entries; infobox labels 80 and values 300; section
headings 200. Require at least one section and one citation per section.
The sources cited by the sections must support the lead and infobox too;
this is an editorial review requirement, not an automatic proof of fidelity.
Limit each batch to 100 pages, 500 source references and 10,000 citations.
The input and resulting transfer bundle must each fit within 4 MiB.

Use ordinary semantic HTML supported by `server/content.js`: paragraphs,
emphasis, lists, headings, links and tables. Do not include JavaScript,
event attributes, custom CSS classes, embedded applications or Markdown syntax
as if it were HTML. The compiler rejects reported discarded formatting;
it may apply the existing sanitizer's harmless canonical normalization.
V1 authors plain section HTML; the compiler sets structured `blocks` to `[]`.
Use article links such as `<a href="/wiki/other-article">text</a>` without
section fragments. Work does not know the generated UUID anchors. Confirm
link targets against the article catalog and later against the local site;
successful compilation alone does not prove links resolve.

## Source resolution

Each citation references a declared source `key`. Its `set` is a symbolic name
mapped locally to a verified staged source manifest, and `path` is the exact
path inside that archive. Paths are case-sensitive and must not be absolute,
contain `..`, backslashes or drive prefixes. A source declaration identifies
one document; duplicate declarations of the same set/path are rejected.
Every declared source must be cited. Do not cite README/context files.

Codex binds each used set with repeated arguments:
`--source-set original=.local/wiki-sources/ARCHIVE_SHA/manifest.json`.
Manifests/files are read with the existing restricted source-stage reader,
including permissions, path and byte-hash checks. Several sets may be bound
for one batch. No source text or hash is guessed or reconstructed from memory.
Locators are nonblank strings of at most 500 characters after trimming,
preferably exact line ranges and/or headings in the provided document.
Control characters are rejected. The compiler trims locators before hashing
and deduplication; duplicates after normalization are rejected. Canonical
ordering uses locale-independent code-unit comparison so different computer
language settings do not change generated identities.

For the original package, use set `original` and exact paths from the source
catalog supplied with the Work kit. If Work uses an additional or revised
document, use a distinct source-set label and return the exact source file
alongside the articles. A source ZIP can be staged locally with the existing
`wiki:sources:stage` command; its manifest is then bound to that label.
Do not relabel a revised Work document as the old original merely because
its filename matches. If a cited file cannot be exported or matched exactly,
return the article as blocked in a separate editorial register rather than
manufacturing source text or a citation.

## Compiler and stable identity

Command: `npm run wiki:authoring:compile -- --input INPUT.json
--source-set LABEL=MANIFEST.json [--source-set OTHER=MANIFEST.json]
--output .local/wiki-work/OUTPUT.bundle.json`. The command requires Node 24,
does not load `.env`, performs no HTTP/database calls and has no import flag.
It prints counts and safe validation errors, never article/source content.
It refuses to overwrite an existing output, creates private output files
(mode 600), and fails without leaving a partial bundle.

The implementation deterministically derives UUIDs from workspace/article/
section keys and source archive/path/hash identity, with separate domains for
each kind. A page's revision reference is derived from its validated staff
snapshot and canonical citations. Therefore unchanged content has stable
identity across batches; edited content has a different revision reference.
Work must not invent UUIDs, archive hashes, account identifiers or timestamps.
Codex calculates source and bundle hashes and uses a canonical timestamp in
the compiled manifest so identical inputs and sources compile reproducibly.

The compiler invokes the existing snapshot and complete transfer-bundle
validators before writing. It rejects duplicate page slugs/aliases across the
batch, unknown source/section references, invalid shapes and unsafe source
paths. It forces `accessLevel: "staff"`, uses only the cited source closure,
and excludes accounts, credentials, sessions and editorial notes.

The output then goes through the existing admin upload, preview and explicit
commit. Imports produce unpublished staff drafts and private source records.
An exact replay is recognized; changed previously imported content or slug
collisions are conflicts, never an overwrite mechanism. In particular, the
five existing pilots already occupy their names. Work returns their proposed
revisions in a separate file using this same authoring shape. Codex prepares
explicit, citation-aware staff revision requests using
[`REVISION_INTAKE.md`](REVISION_INTAKE.md), rather than importing duplicate
copies or changing the workspace to evade collision checks.

## Separate editorial artifacts

Return the page catalog, terminology/authority decisions, unavailable sources,
unresolved canon questions, batch status and human-readable changelog as
separate private Markdown or JSON files. Do not insert staff TODOs, editorial
questions or source text into reader-facing article bodies. Compilation
checks technical compatibility only; source fidelity, pt-BR quality, article
boundaries, spoilers and authority remain review responsibilities.
