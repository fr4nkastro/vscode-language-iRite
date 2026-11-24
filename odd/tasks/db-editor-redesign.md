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

S11 — Limits, legacy renderer and validator:
- Limits (R2-unexplained-records-cap, R2-duplicated-threshold): one named, documented constant module (e.g. src/dbschema/limits.ts) for 128 tables, 100 fields, 2,000,000 records, 255 string max, 460,000,000-byte designer threshold, with the [IL]/[REA] source in a comment; validation, draft budget and HTML all import it. The total-records meter must state its basis (or drop the derived 256,000,000 cap if no Revolution rule names it; show the plain total instead).
- R2-legacy-dead-renderer: remove the legacy renderer from src if only tests use it, migrating or deleting those tests with justification; otherwise make it delegate to the shared rules.
- R2-ambient-issue-location: refactor validateDbSchema to pass location explicitly per issue (no mutable closure state); behaviour and messages unchanged; tests stay green.

S12 — Move behavior and harness:
- R2-duplicated-vm-harness: use the shared test/erd/draftVmHarness.ts everywhere.
- R2-misleading-move-error + R3-move-guard-untested: separate error messages for missing field / out-of-range / unknown-type span; disable move/drag in the webview for unknown-type rows; tests for each.
- The session-level moveField guard repeats the bounds check that ErdDraft.apply already performs. It also reports every failure, including a missing field or an out-of-range index, as 'Cannot move unknown type code field', which misdescribes the cause. Separately, the view and hasChanges getters rebuild and revalidate the entire draft on every access, which a getter name does not suggest.

S13 — Watcher and CSP:
- R3-cancel-refresh: restore the deferred watcher refresh after a cancelled save as the baseline did (without dropping the pending draft); test it.
- R3-csp-style-coverage: extend the no-inline-style test to a populated read-only ERD and the navigation script, fixing any violations.

S14 — Delivery:
- Add a task and Log entry (keep L1) and commit the doc with git add -f. No absolute local paths in the doc.
- Same constraints as before: TDD, focused checks then npm run typecheck, npm test, npm run compile once at the end via a foreground gentle-ai-worker; Conventional Commits with git -c user.name="Allan Castro" -c user.email=it@ipesah.com, no co-author lines; no push/PR/merge; no native review; do not delete scratch (list as <scratch> placeholders); finish in the foreground.

S15 — Visual fidelity at 1280×800 (approved proposal HTML and target image in `<visual-scratch>`):
1. Top toolbar: "Database: <name>" title, a segmented Diagram / Edit schema toggle, then right-aligned status ("No unsaved changes" / "N pending changes", error badge with count), Discard (secondary) and Save (primary).
2. Sidebar table list: "TABLES n/128" header with add (+) icon button, filter input full width, one row per table (name left, "3 fields · 39.0 KB" right, thin size bar under it, dirty/error dot), only the selected row highlighted (list.activeSelection), hover = list.hoverBackground.
3. Detail header: labelled inputs ("Table name" with "7/8 chars" counter under it, "Max records" with "up to 2,000,000"), then inline stats "Fields 3/100 · Record 39 B · Table 39.0 KB", and icon buttons (duplicate/delete) at the right.
4. Fields grid: drag handle, #, NAME, TYPE (full width select), SIZE (right aligned; read-only/greyed for fixed-size types), BYTES (right aligned), and icon buttons ↑ ↓ 🗑 (codicon-like, use plain Unicode or inline SVG, no external fonts) instead of blue text buttons. Row separators, comfortable row height (~36px). "+ Add field" link-style button with the "or press Enter in the last field name" hint.
5. Optional collapsible "iRite declaration preview" (`<details>`) showing the main.iri hint for the selected table.
6. Status footer pinned at the bottom: Storage bar "4.67 MB / 460 MB", Tables bar "6 / 128", Records total, and "● n errors ▲ n warnings" at the right. Human-readable byte units (B, KB, MB) everywhere instead of raw byte counts.
7. Layout fills the webview height (sidebar and detail scroll independently, footer fixed), no outer bordered box, no stray fieldset border.
8. Colors only from `--vscode-*` variables (with sensible fallbacks), correct in light, dark and high contrast; dirty = gitDecoration modified, added = gitDecoration added, removed = gitDecoration deleted + strikethrough; errors = inputValidation/errorForeground. Keyboard focus visible (focusBorder).

S16 — "Keep the hook ids/data attributes the controller and tests use; update tests only where markup legitimately changed, add tests for: only the selected table has the selected class, fixed-size inputs are readonly, byte formatting helper (pure, unit-tested), footer totals." Iterate and inspect PNGs; retain dark, light and high contrast renders. Delivery and final-check constraints from S14 still apply.

S17 — Visual pass review follow-up (decisions verbatim):
- Name limit: import the 8-char limit from the shared limits module (add it there if missing).
- One pluralization helper shared by server render and webview script ('1 error', '2 errors', same for warnings); test the initial badge text.
- Named constant for the default new-field type, reused by both add-field paths.
- Single issues lookup per property in fieldRow.
- Enter-to-add: queue the add after pending edits instead of dropping it, and clear focusNewIn on reject or non-render acknowledgement; tests for both.
- Byte formatter: choose decimals after rounding (99,999,999 B -> 100 MB); boundary tests.
- Re-render screenshots with the shot scripts in `<visual-scratch>` (dark, light, high contrast, dirty state) into its shots dir.
- Findings covered: R2-dup-name-limit, R2-error-label-divergence, R2-magic-typecode, R2-redundant-issue-lookup, R3-focus-new-sticky, R3-enter-dropped-when-busy, R3-initial-error-plural, R3-bytes-100mb-decimals.

## Tasks
- [x] T1 — S8, S10 — Foreground worker: document the S8 fallback after inconclusive REA inspection — `a34410d`.
- [x] T4 — S2–S6, S9–S10 — Foreground worker: pure draft, validation locations and estimates — `b81b132`.
- [x] T5 — S1, S3–S7, S9–S10 — Foreground worker: draft markup and themed layout — `69272ef`.
- [x] T6 — S2, S4, S7, S9–S10 — Foreground worker: trusted host action protocol and save integration — `30953fe`.
- [x] T2 — S1–S7, S9, S10 — Foreground worker: webview event integration and interaction checks — `30953fe`.
- [x] T3 — S1–S10 — Independent high-risk verification and foreground worker final checks — tested `30953fe`; evidence in this tracking commit.

- [x] T7 — S11–S14 — Resolve the approved review's non-blocking findings via bounded foreground workers; independent verification for named risk items; foreground final checks — `0779301`, `4630357`, `42cf916`; evidence in this tracking commit.

- [x] T8 — S15–S16 — Foreground worker: approved visual fidelity, browser captures, and focused tests; foreground final checks — `716ff23`; evidence in this tracking commit.

- [x] T9 — S17, S14 — Foreground worker: resolve the visual pass review findings, re-render captures; foreground final checks — `b3831a6`; evidence in this tracking commit.

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
L13: Resolve the non-blocking findings from the approved native review of feature odd/tasks/db-editor-redesign.md (branch feat/db-editor-redesign, this cwd). Add a task and Log entry (keep L1) and commit the doc with git add -f. No absolute local paths in the doc.
L14: Delivery: feature-branch-chain. Risk item 3 (shared validator and draft helpers); item 4 (watcher/save interleaving). CSP enforcement code was unchanged. No native review.
L15: Focused RED/GREEN: limits 1 failed then 49 passed; renderer-assertion migration 13 passed; move and VM 5 failed then 68 passed; watcher 1 failed then 69 passed after removing an unused confirmation mock that leaked across tests. Populated CSP checks passed without production CSP changes.
L16: Independent verification on `42cf916`: diff check passed; 108 focused tests passed; seven validator fixture groups matched baseline and the delayed-message watcher probe passed. The implementation-worker differential also matched baseline for 15 fixture groups across existing callers. Retained paths: `<scratch:validator-differential>`, `<scratch:verifier-preparation>`, `<scratch:verifier-probes>`. No real browser, Revolution, or device checks.
L17: Foreground final checks on `42cf916`, once each: `npm run typecheck` exit 0; `npm test` exit 0 (64 files, 659 passed, 7 skipped); `npm run compile` exit 0. Compile outputs remain ignored. No push, PR, merge, or native review.

L18: "Visual fidelity pass on the redesigned database schema editor (branch `feat/db-editor-redesign`, this cwd, feature doc `odd/tasks/db-editor-redesign.md`). The behaviour is in place and tested, but the rendered UI does not look like the approved proposal. Make it match the proposal's look and layout while keeping all behaviour, tests and the strict CSP." Visual evidence and render scripts are in `<visual-scratch>`; retain all scratch. Delivery: feature-branch-chain.
L19: T8 RED 8 failed/1 passed; focused GREEN 21 files/119 passed. CSP-enforced Chromium renders at 1280x800 (dark, light, high contrast, dirty, narrow, diagram) showed no page or CSP errors, one selected row, pinned footer. S15.5 preview skipped (no per-table declaration source); duplicate not shipped (no existing action). Footer counts the global limits-unconfirmed warning. Final checks once: typecheck 0; test 0 (66 files, 670 passed, 7 skipped); compile 0. Renders in `<visual-scratch>/shots`. No native review.
L20: "Resolve the non-blocking findings from the approved native review of the visual fidelity pass (feature odd/tasks/db-editor-redesign.md, branch feat/db-editor-redesign, this cwd). Add a task and Log entry (keep L1; no absolute local paths) and commit the doc with git add -f." DOLE stays read-only (its current 5-table main.rev is an external change, expected). Delivery: feature-branch-chain; no push, PR, merge, or native review.
L21: T9 RED 5 failed/5 passed (`test/erd/erdReviewFollowup.test.ts`, stub exports), GREEN 10/10; focused `test/erd` + `test/dbschema` 22 files/129 passed. `MAX_NAME_LENGTH` added to the shared limits; `src/dbschema/model.ts` now builds the same name pattern and message from it (outside the declared edit surfaces, behavior-equivalent). One `plural()` (`src/erd/erdPlural.ts`) embedded in the webview script: badge and footer say "1 error" / "1 warning". `DEFAULT_NEW_FIELD_TYPE` shared by both add-field paths. Enter-to-add queues behind pending edits; focus moves only on a rendered, unrejected ack. Byte decimals chosen after rounding (99,999,999 B -> 100 MB). Known: a double Enter while busy queues two adds. Final checks once: typecheck 0; test 0 (67 files, 680 passed, 7 skipped); compile 0. Renders (dark, light, high contrast, dirty, narrow, diagram) re-generated in `<visual-scratch>/shots`. Risk: none (requested shared-limit change is behavior-equivalent). No native review.
