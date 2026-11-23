# Issue #6 — screen editor with .rev write-back (reviewer report)

Branch `feat/issue-6-screen-editor` (on top of `feat/issue-5-preview-inspect`). First phase that WRITES a `.rev`. HIGH RISK: the file is consumed by Revolution and, through the external EDP MCP, by the 1280. Feature doc: `odd/tasks/issue-6-screen-editor.md`. Nothing was pushed; no device, EDP tool or Revolution was touched.

## Review path

| Order | Commit | Review first |
|-------|--------|--------------|
| 1 | `c1f9a02` feat(rev): lossless serializer | `src/rev/serialize.ts`, `test/rev/serialize.test.ts`, fixture `test/fixtures/editor/main.rev`, `.gitattributes` |
| 2 | `7635559` feat(editor): pure model | `src/editor/editState.ts`, `editorMath.ts`, `messages.ts`, `backup.ts`, `previewState.ts` (`stepBack/stepForward`) |
| 3 | `8bede08` feat(editor): CustomEditorProvider | `src/commands/screenEditor.ts`, `src/editor/saveRev.ts`, `src/editor/editorHtml.ts`, `package.json` |
| 4 | `f88fd86` feat(cli): rev-cli | `src/cli/revCli.ts`, `src/preview/widgetBox.ts`, `screenSvg.ts`, `esbuild.mjs` |
| 5 | docs(editor), docs(odd) | `readme.md`, `CHANGELOG.md`, `AGENTS.md`, this report |

Commits 1 and 3 are the high-risk ones (own commits, suitable for native review). Commit 3 is larger than 400 lines (provider ~250, page ~350, tests) because the page, the provider and `package.json` are one behaviour.

## Spike outcome and hash decision

The manual spike (hand-edit, open in Revolution, load via EDP) cannot be run from here. Decision: option (a), leave the hashes and accept a possible Revolution warning, with safeguards.

-   `CustomHash`: reproduced on DOLE. It is the SHA-1 of the UTF-16LE text of `<Printers>` (CRLF kept; entity-decoded and raw are identical on DOLE). `computeCustomHash` implements it and is tested. The writer never touches Printers, so `CustomHash` stays valid without recomputing.
-   `ConfigHash`: NOT reproduced. Tried (about 29,000 combinations, scripts were throw-away): SHA-1, MD5, SHA-256, RIPEMD-160 over the `<Config>` body, with tags, whole file, with/without BOM, CRLF/LF/none/NUL/space/comma separators, trailing newline or not, UTF-8 / UTF-16LE / Latin-1 / with BOM, entity decoded or not, sorted lines, only non-empty values, subsets by key family (each family excluded or alone, `WDGT` excluded), with Printers appended. No hit. It may be keyed, computed over an internal binary form, or exclude data in a way not guessable offline. It is left byte-for-byte as it is.
-   Consequence: after a save, `ConfigHash` no longer matches the Config. Whether Revolution warns, silently recomputes, or refuses is UNKNOWN.

Safeguards: priority "option" (never the default editor); a one-time modal per document per session (text says the hash is not recomputed and the result is unverified); backup before the first write of every save; refusal when the file changed on disk; no write at all when there is nothing to change.

## Decisions and why

| Question | Decision | Why |
|----------|----------|-----|
| Serializer strategy | Patch only the x/y/width/height tokens of existing `WDGT#n` lines, on a latin1 byte-per-char string | Lossless for any byte (no UTF-8 decode), BOM/CRLF/order/hashes untouched by construction; the diff is one line per edited widget |
| Unsafe input | Unknown or duplicated id, non-integer, out of range (+-10000), size for types 1 and 6, non-numeric token, short line: `RevWriteError`, nothing returned | A half-written `.rev` is worse than no write |
| Post-check | `planSave` re-parses the result: edited widgets equal the requested geometry and keep fields 5+, untouched widgets are deep-equal, only the edited lines differ | A bug in the patcher cannot reach the disk |
| Where state lives | Extension owns the document (`EditState` = effective geometry of changed widgets, relative to the bytes at open/revert); the page only sends `edit` messages and applies `sync` | Single source of truth, undo/redo/dirty come from VS Code's edit events; messages are validated (`parseEditorMessage`) |
| Undo after save | State stays relative to `doc.original`; `doc.bytes` is the last written content | Undo after a save then save rewrites the file correctly (found by the smoke) |
| Backup | `main.rev.bak` next to the file; if it exists `main.rev.<yyyymmdd-hhmmss>.bak`, then `.2.bak`...; never overwritten; created before every write | Earlier sessions' backups are never lost |
| Atomic write | write `main.rev.irite-tmp` then rename | No truncated `.rev` if the process dies |
| Stale file | Save refused if the disk bytes differ from the last known bytes | Revolution or git may have rewritten it; overwriting would lose that work |
| Z-order | NOT persisted to `.rev`; view-only (phase 1 override + one step back/forward) | See below |
| Backdrops | Widgets covering at least 90% of the canvas are not draggable on the canvas | A full-screen background otherwise gets dragged by any click on empty space |
| Arrow keys | 1 px; Shift = one grid step (10 when the grid size is 1) | Issue asked for Shift = larger step; not coalesced (each press is one undo step) |
| Hot exit | `backupCustomDocument` stores the edit state JSON, sanitized on restore | Unsaved edits survive window reload |
| CLI | Option B, second esbuild entry `dist/rev-cli.js`, no dependencies | Reuses `src/rev` + `src/preview`; no MCP SDK dependency |
| PNG | Out of scope (needs a rasterizer dependency); SVG only | Issue allows PNG/SVG |
| Paint order in preview | Unchanged (id ascending) | Evidence below supports it |

### Z-order (the issue's open question)

Evidence on DOLE (`main.rev`, 193 widgets): the `WDGT` lines are contiguous but 7 are out of id order. The out-of-order ids (8, 9, 10, 35, 36 and a few of 172-186) are gaps in the sequence, i.e. ids freed by deleted widgets and reused later, so the line order is creation order. Full-screen backgrounds 8 (`entrada.png`, screen 14) and 35 (`ingreso.png`, screen 12) appear AFTER labels of their own screens: if line order were paint order they would cover them. The device receives configuration by `WDGT#<id>`, so it cannot even know line order. Therefore: paint order follows the id (still an assumption: not verified on a real unit), line reordering would not change what the device paints and would add noisy diffs, and renumbering would break the constants in the generated `main.iri`. Hence z-order is not persisted: the buttons are labelled "view only, not saved". This is a deliberate deviation from the issue's "persisted"; the only safe route to persist it is an id swap plus regenerating `main.iri` in Revolution, which is out of scope.

## Acceptance criteria

| Criterion | How it is met | Evidence |
|-----------|---------------|----------|
| Open + save without edits leaves `main.rev` unchanged | Empty patch list returns the same string; `planSave` returns undefined and the provider writes nothing | `serialize.test.ts` "returns the very same bytes...", golden DOLE round trip (byte-identical, runs when `~/Documents/localdev/IPESAH/DOLE/main.rev` exists); `saveRev.test.ts` "open + save without edits writes nothing"; smoke: "save without edits does not touch the file" (bytes and mtime) |
| Moving one widget changes exactly one `WDGT#` line | In-place token patch | `serialize.test.ts` "moving one widget changes exactly one WDGT line", DOLE golden; `saveRev.test.ts`; smoke "exactly one WDGT line changed on disk" |
| Undo/redo through standard VS Code commands | `onDidChangeCustomDocument` edit events with `undo`/`redo` closures | Smoke: undo restores, redo re-applies, undo after save + save rewrites; platform dirty tracking is VS Code's |
| Edited `.rev` opens in Revolution and loads through EDP on a test 1280 | NOT VERIFIED (pending manual check below) | - |
| MCP/CLI renders a screen image matching the webview | `renderScreenSvg` uses the preview's panel geometry, `widgetBox` and id paint order | `cli.test.ts` "draws every widget at the box the preview page uses, in the same paint order" (HTML vs SVG for every screen), 12" scale and band test; Edge screenshot of DOLE screen 2 at 12" visually matches the webview |
| Move/resize/snap/numeric fields | `editorMath` + page | `editorMath.test.ts` (17), `editState.test.ts` (13); headless Edge on DOLE (24 checks): click selects, drag sends one edit on pointer up and snaps to 8, snap off exact delta, arrows 1 px and Shift grid step, se-handle resize sends w/h only, numeric field edit, junk ignored, sync from the extension repositions, Escape cancels, backdrop not draggable |
| 12" view keeps auto-scaling, edits in 7" | `toAuthored(delta, viewScale, 1.6)` | `editorMath.test.ts` "a drag of 160 screen pixels on the 12 inch view moves the widget by 100 authored pixels"; Edge "12 inch: pointer delta converted by viewScale*1.6" |
| z-order back/front/steps | View-only (see above) | `previewState.test.ts` "one step back / forward" (4), Edge z-index checks |

Checks run at the end: `npm run typecheck` clean, `npm test` 332 tests in 29 files (up from 250 at the end of #5), `npm run compile` (two bundles), `npx vsce ls --no-dependencies` lists `dist/rev-cli.js` and `dist/extension.js` (source maps excluded). Existing preview and docs tests pass unchanged; the only change to preview code is exporting `renderWidget` / `WIDGET_STYLE` and adding step functions to `previewState`.

## Pending manual checks (not done, blocking release)

Protocol (do on a scratch copy of a project, not the only copy):
1. Commit or copy `main.rev`. Open it with "iRite: Edit Screens", move ONE widget by a few pixels, save, confirm the warning. Check `git diff` shows exactly one `WDGT#` line and `main.rev.bak` exists.
2. Open the saved `main.rev` in Revolution. Record: opens cleanly / warning text / refuses / silently rewrites `ConfigHash` (look at the `ConfigHash` line after Revolution saves).
3. In Revolution, check the widget is at the new position on the screen designer.
4. Load the configuration on a test 1280 through the EDP MCP (separate repository, `edp_compare_config` against the `.rev` first, then the normal deploy of widgets/setpoints/DIO). Check the widget on the indicator screen and that no other widget moved.
5. Record outcome (date, Revolution version, firmware, result) in the issue. If Revolution or the 1280 rejects it: restore with `copy main.rev.bak main.rev` and fall back to option (b) (sidecar applied by the MCP) or (c).
6. Also confirm paint order is by widget id on the device (swap two overlapping widgets' ids in Revolution on a scratch project).

Rollback: the previous bytes are in `main.rev.bak` (or the timestamped sibling) and in git; restoring is a file copy. The extension never deletes backups.

## Security notes

-   Webview: CSP unchanged (`default-src 'none'`, scripts by nonce, one script element, `localResourceRoots` = the project folder); no `innerHTML`; all text goes through `textContent` or escaped attributes.
-   Every webview message is validated on the extension side: type whitelist, integer id that exists in the file, numbers finite and clamped to +-10000, widgets without a stored size reject w/h, view state sanitized, grid bounded to 1-200. The extension never uses a path from the page.
-   Save only writes the document's own file (or the user-chosen Save As target) and the sibling backup.
-   `Release.bat`, `deploy.bat`, `sync.bat` were not run. The fixture derives from DOLE (a copy was made in a scratch dir for the Edge/CLI runs); DOLE was only read.

## Not verified

-   Revolution and 1280 acceptance of a file with an unchanged `ConfigHash` (see protocol). Paint order by id on a real unit.
-   Not run inside a real VS Code window: the page was driven in headless Edge with a stubbed `acquireVsCodeApi`; the provider through a mock `vscode` (27 checks including save, backup, refusal, hot exit, Save As). `retainContextWhenHidden`, the real modal dialog, and the platform's own dirty/undo UI were not exercised.
-   Keyboard undo (Ctrl+Z) inside the webview relies on VS Code forwarding it to the custom editor; not exercised.
-   RED: the serializer tests were written first and run against a missing module (RED = module missing); later tests were written with the implementation, then run once.
-   Responsive layout only at the headless window width.

## Refactor candidates / design notes for the reviewer

-   `locateRev` is now exported from `previewScreens.ts` and reused; the project-locating duplication across the other webview commands still exists.
-   `editorHtml.ts` embeds a ~300 line script as a template literal like the other pages; a bundled `.js` asset would allow linting it. `createEditorMath` and `createPreviewState` are self-embedded factories (third such pattern), guarded by tests that evaluate the embedded source.
-   `RevWidget` has no write model of the unknown `?` fields; the serializer deliberately never touches them. Supporting more edits (text, color, alias) would need those semantics first.
-   `renderWidget` is exported to share boxes with the editor; its defaults are duplicated in `widgetBox` and pinned by a test (HTML vs SVG). Making `renderWidget` call `widgetBox` would remove the duplication.
-   Arrow-key presses are not coalesced into one undo step; a 300 ms coalescing window would make holding an arrow one step.
-   The CLI `widgets` overlap report is O(n^2) per screen (fine for 40 widgets; DOLE max).
-   The `.rev` model reports 193 widgets on the current DOLE file while AGENTS.md said 179 earlier; the AGENTS number is a snapshot of an older file.

## Scratch paths

Scratch lived in the session scratchpad (`dole.rev` copy, generated HTML, Edge profile, smoke work dir) and `/tmp/spk` (hash experiments); the DOLE copy, Edge profiles, smoke work dir and `/tmp/spk` were removed; only small throw-away scripts remain in the session scratchpad.
