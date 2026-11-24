# Database schema editor redesign
Branch: `feat/db-editor-redesign` (base `fd6d195`). Approved reference: `<proposal-html>`.
Keep the existing save workflow; no push, PR, merge, or native review in this session.

## Specs
S1 Master-detail layout: table list on the left (name, field count, computed size, pending-change marker, filter box, add table), the selected table's editor on the right. Must scale to 128 tables. The diagram view stays available (toolbar toggle Diagram / Edit schema as in the mock-up).

S2 No per-row Apply buttons. Every edit becomes a pending change marked visually (dirty / added / removed, removed rows struck through and restorable until save). A change counter, one Discard and one Save; Save (and Ctrl+S / Cmd+S inside the webview) is disabled while any blocking error exists. Saving keeps the existing safe flow unchanged (confirm modal, stale-file refusal, backup, atomic write, ConfigHash, readback) in `src/dbschema/workflow.ts` / `save.ts`.

S3 Fields as a compact table, one row per field: # · name · type · size · bytes. Reorder by drag and drop and by Alt+Up / Alt+Down (keyboard accessible); delete per row.

S4 Live inline validation while typing, using the existing `validateDbSchema` / name rules (ASCII, starts with letter or _, max 8 chars, reserved words, case-insensitive duplicates, records 1..2,000,000, strings 1..255, max 100 fields, max 128 tables). Messages next to the offending input and summarized per table. Do not duplicate rules in the webview with a different shape: share one pure rule set (factory embedded in the webview like `editorMath` / `callViews`, or validate host-side and post results), so host and webview can never disagree.

S5 Size locked by type: numeric and DateTime show their fixed size read-only; only string types take a length. Changing type applies the catalog default (reuse `src/dbschema/fieldTypes.ts`).

S6 Totals/budget footer: bytes per record and per table, and global bars for tables (of 128), total records, and total bytes against the 460,000,000-byte designer threshold (warning, not a block, as today).

S7 Theming: colors only from `--vscode-*` variables (light, dark, high contrast); keep the strict CSP with nonce; escape every value.

S8 Reserved words: the mock-up's RESERVED list was written from memory. Verify the list against the real source: Revolution's `Support.VerifyIriteAliasString` in `revolution.library.dll` (clean-room with REA, as in docs/rev-format.md; REA runs with `"<rea-node>" "<rea-script>" inspect-managed-members <dll> --json ...`, assemblies in `<revolution-install>/`, read-only), and compare with what `src/dbschema` enforces today and with the iRite keyword lists in `src/irite/parser.ts` / `src/dbaccess/scaffold.ts`. Use one shared list matching Revolution; record the evidence (facts only, [REA]/[IL] tags) in `docs/rev-format.md`. If REA cannot establish it, keep the current enforced list and mark the gap UNCONFIRMED.

S9 Pure logic tested with vitest (pending-change diff, reorder, budget totals, validation parity host/webview). HTML tests for escaping, CSP nonce, disabled Save with errors, size field read-only for fixed types. If the repo has a harness to execute webview scripts (the ERD tests already run the change handler), use it for drag/Alt+arrow reorder and Ctrl+S. All existing ERD/dbschema tests must still pass or be updated with justification.

S10 TDD (RED then GREEN); focused checks while iterating; at the end `npm run typecheck`, `npm test`, `npm run compile` once via a foreground gentle-ai-worker. Optionally render the webview HTML headless (Playwright/Chromium if available) for screenshots saved in scratch, list their paths. Conventional Commits with `git -c user.name="Allan Castro" -c user.email=it@ipesah.com`, no co-author lines. Do not delete scratch (list paths). Do not start a native review (Claude handles it). If a guarded command is refused, stop and report it. Finish everything in the foreground.

## Tasks
- [x] T1 — S8, S10 — Foreground worker: document the S8 fallback after inconclusive REA inspection — `a34410d`.
- [x] T4 — S2–S6, S9–S10 — Foreground worker: pure draft, validation locations and estimates — `b81b132`.
- [x] T5 — S1, S3–S7, S9–S10 — Foreground worker: draft markup and themed layout — `69272ef`.
- [x] T6 — S2, S4, S7, S9–S10 — Foreground worker: trusted host action protocol and save integration — `30953fe`.
- [x] T2 — S1–S7, S9, S10 — Foreground worker: webview event integration and interaction checks — `30953fe`.
- [x] T3 — S1–S10 — Independent high-risk verification and foreground worker final checks — tested `30953fe`; evidence in this tracking commit.

## Log
L1: Delega a gentle-shell con gpt la mejora de la visualización del editor de db de la extensión
L2: Risk item 1 (pending edits feed persisted schema, with field index changes); item 2 (webview CSP and message validation); item 3 (shared schema validation also serves existing save and editor paths). Existing save workflow remains untouched.
L3: Delivery: feature-branch-chain; no push, PR, merge, or native review. Local paths use placeholders.
L4: REA could not resolve unqualified `Support` and returned no list for the follow-up selector. A later CLI option combination was unsupported. No keyword enforcement changed; exact designer membership is **UNCONFIRMED**.
L5: Initial integration test was RED (1 failed, 83 passed). Split the next work into a pure draft core and its presentation/host integration; keep the existing save boundary.
L6: Draft unit typechecked and focused GREEN passed 44 tests. Validator differential against the previous implementation is pending; isolated from presentation work.
L7: Pure presentation RED observed, then 2 GREEN HTML tests and typecheck passed. Webview integration is not yet verified.
L8: Host protocol RED observed, then 23 GREEN focused tests and typecheck passed. Transitional legacy edit adapter must be resolved in browser integration; shared validator differential remains pending.
L9: Browser and watcher fixtures migrated without removing safety assertions; legacy Apply protocol removed from the active ERD path. Focused checks: 101 passed; typecheck passed. Old renderer retained as a test-only reference for field catalog tests; it is not called by the extension.
L10: Base/current validator differential: 17 fixture groups matched on exit status, stdout and stderr. First scratch run could not resolve the Bash path; the corrected Windows path worked.
L11: Independent verification on `30953fe`: committed diff check passed; 19 files / 101 focused tests passed and an isolated deletion/reorder probe preserved untouched field tokens and rejected injected provenance. S1–S7 and S9 met at repository-test scope; S8 met by fallback. A supplemental race probe did not run because its scratch path was unavailable in the continuation. No browser, Revolution, or device verification.
L12: Foreground final checks on `30953fe`: `npm run typecheck` exit 0; `npm test` exit 0 (64 files, 652 passed, 7 skipped); `npm run compile` exit 0. No native review started. The read-only native assessment lacked an intended-untracked declaration; independent risk verification proceeded separately.
