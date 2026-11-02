# Eventual contribution to Rickson's upstream project

This is preparation for a future PR, not authorization to open or merge one,
deploy, copy production data, or publish lore. The contribution target remains
`Dilligent-Yard/eterverso:main`; publish the contribution branch to Arthur's fork.
The source of current truth is the repository and test evidence at PR time.

## Keep the two deliveries explicit

1. The Git delivery contains application code, migrations, tests and process
   documentation. Private `.local/` lore files, accounts, credentials and
   databases stay outside it.
2. The content delivery consists of reviewed authoring JSON, exact source
   documents, editorial decisions and validated `AetherverseWikiBundleV1`
   bundles. Record whether each batch was only compiled, imported as local
   staff drafts, reviewed, or separately approved for publication. A merged
   code PR does not transfer database rows or publish the article corpus.

Work should return a human-readable changelog per batch using stable page
keys: proposed additions, edits to existing pilots, renames/splits/merges,
source changes, editorial decisions and unresolved items. Do not treat an
authoring file as evidence that the application rendered or saved it correctly.

## Compare with the maintainer's current branch

Immediately before preparing the PR, fetch `upstream` and record the exact
`upstream/main`, contribution HEAD and merge-base SHAs. Inspect:

```sh
git fetch upstream
git merge-base upstream/main HEAD
git log --reverse --no-merges upstream/main..HEAD
git diff --stat upstream/main...HEAD
git diff upstream/main...HEAD
```

The three-dot diff shows the proposed contribution since the common ancestor.
Also inspect changes that upstream has made since that ancestor and compare
the two tips where needed. Resolve actual interactions in a preserved branch
and test the integrated result; do not assume the maintainer's site still
matches the version seen during the original onboarding. Do not reset local
changes, force-push or silently replace upstream fixes to obtain a clean diff.

## Test before claiming readiness

- Run the applicable current unit, isolated integration and browser suites,
  syntax/whitespace checks, and populated migration gate for the final schema
  chain. Record commands, date, revision and actual results; an earlier green
  checkpoint does not establish the final integrated result passed.
- Check authoring packages against the current contract, exact source files,
  citation locators and scoped authority. Review pt-BR prose, navigation,
  categories, term consistency, source conflicts and reader/author boundaries.
- Compile files offline first. Before an actual local import, confirm target,
  preserve a current backup and use the admin preview/commit process. Check
  collisions rather than overwriting existing drafts. Then verify fresh reads,
  citation remapping, staff-only access and null published revision pointers.
  Test representative real layouts in the local browser; automated synthetic
  tests alone cannot establish the readability or fidelity of actual articles.
- For existing-page edits, use the offline revision planner and the
  citation-aware staff revision path. Check the exact source remapping,
  explicit expected work version, old revision immutability and new citations.
  Do not use a fresh import namespace to bypass transfer collision checks.
- A known separate limitation remains in member-proposal acceptance:
  `server/proposals.js` creates an accepted revision without carrying its
  prior revision citations. This is outside the Work staff-revision intake.
  Resolve and test it before a PR claims citation preservation for proposal
  acceptance, and do not route Work batches through that workflow meanwhile.
- Review authorization, hostile HTML, source privacy, conflict/replay behavior
  and migration/recovery implications. Perform proportionate independent
  review of the final implementation and consequential changes, addressing
  findings before claiming readiness. Keep existing user content intact.

## Full changelog and PR description

Write the changelog against the recorded current upstream base, not merely
against Arthur's previous local commit. Cover concrete user-visible behavior
and significant technical consequences:

- Shared forum, administration and persistence behavior contributed by this
  branch, with any actual compatibility limits.
- Reference wiki drafts/revisions, proposals, search/navigation, private
  sources, source citations and portable transfers.
- The Work authoring input/validation workflow and what still requires staff
  review and explicit import/publication.
- Schema changes and supported upgrade path; backup/recovery procedure,
  configuration requirements, and any outstanding operator steps.
- Test and review evidence, unresolved limitations, and upstream changes
  reconciled during integration.
- Separately reviewed content batches, if any, with article counts and status.
  Do not expose private lore or source text in a public changelog unless its
  release has been explicitly approved.

Lead the PR description with the actual problem and resulting behavior, then
give the migration/verification information a maintainer needs. Link the full
changelog if it is longer. Identify remaining decisions candidly. Opening the
PR, deploying, importing into Render, merging and publishing lore are later
actions requiring Arthur's explicit direction.
