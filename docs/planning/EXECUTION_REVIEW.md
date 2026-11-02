# Independent execution-brief review

Reviewed `EXECUTION.md`, `implementation-contracts.md`, `verification-and-recovery.md` and `EXECUTION_STATE.md`, including the principal's final edits to lock ordering, post numbering, integer bounds and staged import endpoints. This is a review of instructions for future implementation, not a review or approval of implemented application behavior.

Original evidence checked: repository `server.js`, `app.js`, `editor.js`, `db/schema.ts`, SQL migrations, package versions and README; the source package README and previously inspected extracted-source evidence. No broad source inventory was repeated. No repository/application/database changes were made.

## Readiness verdict

Ready for the authorized local implementation. R1 and R2 are closed after the focused check recorded below; no unresolved material brief findings remain. No architectural rewrite, extra approval system, new service, generalized legacy repair mechanism or broader feature scope is needed. A clean final implementation review and actual gate evidence remain required; this brief review cannot substitute for them.

## Focused closure check — R1/R2 resolved

Read only the corrected contract/runbook portions for this closure, without repeating the broad review.

- R1 CLOSED: `implementation-contracts.md` C2, lines 291–308 and 333–338, now separates continuity/provenance from canonical content identity. The server recomputes a globally unique `contentDigest` over defined converted content/attribution with explicit exclusions for UUIDs, times, cache fields, transport and mapping-review decisions. Exact assembled-content replays reuse canonical mappings across different source/export labels and chunking. The recovery runbook section 3, lines 120–134, aligns, and IMP-01 explicitly tests new source/export UUIDs and chunking. Changed item/plan/batch cases remain conflicts with explicit resolution rather than overwrites.
- R2 CLOSED: contract B1, lines 190–195, now explicitly blocks ordinary content edits/new posts for every role when locked/archived, while preserving audited staff moderation and requiring unlock/unarchive before rewriting. An owner's hide/edit remains subject to writability. FOR-05 now states the same all-role restriction and moderation exception. The endpoint table's owner-specific reminders do not override this explicit universal rule.

No remaining material defect was found in the focused closure check. The findings below are retained as the historical review record, not pending work.

## Original material findings — both closed

### R1 — CLOSED: Define import identity independently of volatile export/job metadata

Anchors: `implementation-contracts.md`, C2, lines 284–310; `verification-and-recovery.md`, section 3, lines 120–129; test IMP-01.

The content-only format includes an export UUID and source digest; the server recomputes an assembled canonical source hash, and deduplication keys use `sourceDigest`. The contract does not specify which fields the hash covers. Hashing the whole canonical export includes a newly generated export UUID (and potentially the digest field itself), so exporting the same stored content twice can produce different deduplication identities. The retry guarantee would then hold only for the exact original envelope/job, not repeated recovery of the same browser content across admins. The new batch endpoints solve size/approval sequencing but do not define this semantic identity.

Minimal correction: name the exact canonical payload used for `sourceDigest`; exclude its own digest, export UUID, generated timestamps, job IDs/batch transport metadata, and preview/attribution decisions. Keep a separate raw-snapshot hash for provenance if needed. Specify that different chunking/export UUIDs of the same canonical source content yield the same source identity. Add that case to IMP-01; retain changed-source conflict/candidate behavior already specified. This does not require a new duplicate-detection engine.

### R2 — CLOSED: Resolve archived-content edits versus staff moderation

Anchors: `EXECUTION.md`, Fixed product defaults (archive/read-only behavior and writable discussion policy); `implementation-contracts.md`, B1 lines 143–144 and B2 lines 200–204; `verification-and-recovery.md`, FOR-05.

B1 calls archived categories read-only, and FOR-05 says archived discussions reject writes. B2, however, applies the writable-topic/category restriction specifically to owners for PATCH topic/post routes; staff are not restricted. Hide/restore/moderation are explicitly available and must remain possible for recovery. An executor could reasonably implement either staff edits to archived post bodies or mandatory unarchive-before-edit, and either reading can claim to follow part of this brief. This affects preserved historical content and the test oracle.

Minimal correction: state whether staff may edit title/body in archived categories/topics, and distinguish those content edits from moderation/unarchive/hide/restore operations. The narrowest reading of public read-only archives is: no new posts or title/body edits by anyone while archived; staff can perform explicit recoverable moderation and unarchive before content editing. If the principal intends staff body-edit exceptions instead, state them explicitly and narrow FOR-05 accordingly. Keep the already settled rule that even staff cannot append replies to locked/archived discussions. One short permission note/table and matching FOR-05 wording suffice.

## Checked points with no further material finding

- Historical migration risk is correctly bounded now: 0002 drops the password hash, 0004 recreates it empty, and 0005 drops `apex_tier`; supported upgrades are explicitly verified current-baseline clones, with older/unknown populated schemas refused rather than auto-repaired. The real SQL supports these warnings. Startup DDL removal and empty/current-upgrade fixtures are appropriately separated.
- Raw recovery precedes old normalization. Original `app.js:130–134` removes scene 101, `2614–2622` omits users from the UI export, and `2703–2726` persists the session projection. The new dedicated raw recovery path addresses the earlier preservation finding.
- Actor-before-resource locks, the admin-set advisory lock exception, sorted category locks for moves and parent revalidation now fit together. Separate metadata versions and post ordering avoid manufacturing conflicts between two independent replies. Final-admin auditing and state mutation commit together.
- Identity is server UUID/version based; disabled and demoted sessions are revoked. Self/public/admin DTO separation explicitly avoids the current `server.js:85–97` email-bearing self serializer. Existing privileged guards actually re-read database roles (`340–365`), as the brief claims.
- Safe rendering covers source-mode previews, legacy reads, blocks and structured URLs, with private originals preserved. Existing `sanitizeBlocks` (`server.js:269–272`) and string descriptions (`330–335`, `464–469`) justify the broader boundary. No regex sanitizer shortcut is permitted.
- Wiki published data and staff work are separated, including title/names/categories, derived records, ETags and timestamps. Staff-only history is a deliberate initial policy. Revision restoration and proposal acceptance create new drafts without publication; acceptance checks publication base and existing staff work. The instructions do not require a separate proposal workflow engine or verbatim detector.
- Public/staff access is distinct from audience, knowledge and section authority markers. Actual lore publication is excluded from execution, while synthetic publication tests remain required. Private sources and missing editorial witnesses remain explicit.
- Milestones can be executed in order. M2 category/topic write restrictions can be tested using fixture states before M3 exposes moderation UI. Cross-feature test IDs must acquire their additional cases as later surfaces appear; no need to implement absent later features in M1 to test its existing sinks. The brief already distinguishes technical completion from unavailable real browser exports or author decisions.

## Non-blocking suggestion

The test-ID matrix spans several milestones. A compact milestone-to-test mapping in the checkpoint would make progress reporting easier, especially for HTML-01, WIK-02 and UI-01/UI-02, which gain surfaces over time. This is an organizational convenience, not a request for additional features or acceptance tests.

## Limits

This review did not access production, run migrations/tests, import actual lore or browser data, exercise a new application, or verify future model execution identities. Runtime behavior remains unimplemented. The original ZIP is available in the recorded local path; actual multi-browser recovery and deployed migration state remain outside the present evidence.

## Implementation review — 20 October 2026

The principal requested a read-only review using `gpt-6.1-sol` / `high` of the
actual worktree changes against `EXECUTION.md`, the implementation contracts,
the verification runbook, and the reported test evidence. This records the
requested model configuration and returned review; it is not an independent
measurement of model identity or capability. The reviewer did not access
production, `.env`, `.local/`, or run database/browser tests.

### P2 — CLOSED: expanded canonical imports must advance an existing forum sequence

The reviewer found that a second job selecting additional posts from an
already imported canonical snapshot could insert the next historical post at
the number still reserved by `threads.next_post_no`. The next normal forum
reply would then fail the unique `(thread_id, post_no)` constraint.

`server/legacy-import.js` now locks affected existing categories and topics in
the forum's actor → sorted categories → sorted topics order, rechecks moved,
archived, locked, and quarantined targets under those locks, then reconciles
`next_post_no` to at least one greater than the highest persisted post number
without lowering a higher allocation. It refreshes the affected topic's
activity timestamp. `tests/integration/legacy-import.test.js` adds a real
PostgreSQL regression: import only the opening post, replay the same canonical
content with an expanded selection, then verify the normal reply receives
post number 3.

The reviewer performed a narrow read-only follow-up and confirmed the finding
closed, including the lock order, parent revalidation, sequence update, and
regression. No other consequential finding was reported. The full suite was
rerun after the correction: 110 unit tests, 37 PostgreSQL/HTTP integration
tests, and 13 browser tests passed; the runner reported the development DB
sentinel unchanged. `git diff --check` and JavaScript syntax checks also pass.
The populated MIG-02 and synthetic BACK-01 evidence recorded in
`EXECUTION_STATE.md` remains applicable; neither was altered by this fix.
