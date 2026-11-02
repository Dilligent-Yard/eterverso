# Apply returned edits to existing pages

Work uses exactly the same `AetherverseWikiAuthoringV1` shape for an existing
article as for a new one. Return existing-page edits in a separate batch file
and identify the intended current article in the private delivery changelog.
Work does not supply local page IDs, source IDs, credentials or work versions.
Keep workspace/article/section keys stable. Codex resolves local targets after
reading the actual current site state; never guess them from similar titles.

## Prepare sources and target bindings locally

1. Compile the returned authoring file with its exact source manifests, just
   as for new pages. The output is a validated transfer bundle with article
   snapshots and private source/citation identities. Do not import it as new
   pages or change the workspace to escape a collision.
2. Confirm the requested edits against the existing page and preserve its
   current content. Read its staff detail response using the normal local
   authenticated session; record page ID and `workVersion`. Source and page
   IDs in these files identify content, not accounts. Do not store session
   tokens or credentials in the files.
3. Ensure each cited source exists locally. The staff source API exposes
   archive/path/hash metadata. Match the entire metadata tuple, not just a
   filename. If an exact source is absent, use the documented restricted
   source importer against the explicitly selected local development database
   after reviewing the source set. It imports sources, not articles. Never
   target Render or bootstrap/reset an account for this step.
4. Save a private bindings file with the following exact shape. `sourcePageId`
   comes from the compiled bundle, `targetPageId` and `expectedVersion` come
   from the selected current local page, and `sources` contains actual staff
   source DTO records. Include every bundle page once; do not bind two entries
   to the same local page. The local source list may include unused records.

```text
{
  format: "AetherverseWikiRevisionBindingsV1",
  targets: [{ sourcePageId: UUID, targetPageId: UUID, expectedVersion: positive integer }],
  sources: [{
    id: UUID, archiveSha256: hash, relativePath: path, fileSha256: hash,
    family: string, language: string, declaredVersion: string or null,
    declaredDate: string or null
  }]
}
```

Use the existing staff source listing with pagination to obtain its complete
metadata records. The planner checks archive hash, relative path, file hash,
family, language and declared version/date before remapping source IDs. A
missing or ambiguous mapping blocks preparation. Local source matching is
technical provenance checking; review locator accuracy and claim support too.

## Build requests without sending them

```sh
nvm use
npm run wiki:authoring:revision-plan -- \
  --bundle .local/wiki-work/compiled/revisions-01.bundle.json \
  --bindings .local/wiki-work/incoming/revisions-01.bindings.json \
  --output .local/wiki-work/compiled/revisions-01.plan.json
```

The private output is `AetherverseWikiRevisionPlanV1`, with the bundle digest
and an `operations` array. Each operation identifies one selected page, the
staff revision endpoint, and a complete request body containing a staff
snapshot, edit summary, expected work version and remapped citations. The
planner does not load `.env`, connect to a database, send requests, publish or
overwrite existing files. It refuses an invalid bundle, incomplete/duplicate
binding or mismatched source record.

Review the generated requests and a before/after comparison. In the later
receipt/import task, submit accepted operations through the authenticated
staff API only after the intended target and local write are authorized.
No account password or session belongs in a shell command, plan or bundle.
The server locks/checks the current version and saves snapshot and citations
atomically. If a version is stale, reread the page and reassess the diff;
do not automatically retry with a newer version.

## Citation-aware revision contract

Staff creation and revision endpoints accept an optional `citations` array of
`{sectionId, sourceId, locator}`. Section IDs must belong to the new snapshot,
sources must exist, locators must be nonblank and at most 500 characters,
duplicate tuples are rejected, and the limit is 10,000. Explicit replacement
on an existing page requires `expectedVersion`. A supplied array replaces the
new revision's citations; `[]` explicitly clears them. With no array, a normal
editor save carries forward citations for section IDs retained in the new
snapshot. Restore-to-draft carries citations from the restored revision.

Historical revisions remain unchanged. Staff detail/mutation responses expose
`head.citations`; public article/history responses do not expose private
source citations. Saving a draft does not publish it or move the published
revision pointer. These guarantees apply to this staff intake path; do not
infer citation behavior for unrelated workflows such as accepting a member
proposal without checking and testing that path separately.

To publish a restricted draft for everyone, the publication API requires
explicit `makePublic: true` alongside its revision/version/base checks. It
creates and publishes a new public snapshot with copied citations atomically;
the private historical snapshot is not rewritten. The UI asks for confirmation.
New implicit staff-only publications are rejected. Legacy staff publication
records remain readable in the shared draft view without becoming public.

After submitting a revision, read it fresh and compare snapshot, citations,
work version and publication pointers with the plan. Review the actual local
layout and record the result in the batch changelog. Preserve the returned
authoring files, bindings and review evidence privately for recovery.


## Explicit legacy section bindings

A target may optionally contain `sectionBindings`, an array of
`{sourceSectionId, targetSectionId}` UUID pairs. The source must belong to that
compiled page. Origins and destinations must be unique; final section IDs must
not collide with untouched sections. The planner remaps snapshot IDs and all
citation section IDs together, then validates the resulting staff snapshot.
Omitting this field preserves the previous behavior. The bundle digest still
identifies the original input, not the transformed request.

The operator must verify each target section against the freshly read local
page before preparing bindings. This offline command cannot verify database
membership or infer equivalence from titles. Retired section IDs must not be
reused for unrelated content. Preserve the binding evidence privately and
review merges separately from identity preservation.
