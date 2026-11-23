# Issue #6 — screen editor with .rev write-back (phase 2)

Objective: design 1280 screens inside VS Code and write widget geometry back to `main.rev`, plus a headless CLI so an agent can inspect and render screens. HIGH RISK (item 1: persisted file consumed by Revolution and the 1280; item 3: contract with Revolution and the external EDP MCP). Branch `feat/issue-6-screen-editor` (chain: `feat/visualizers` -> `feat/issue-2-db-access` -> `feat/issue-3-sfc-layout` -> `feat/issue-4-callmap` -> `feat/issue-5-preview-inspect` -> this one). Delivery: local work-unit commits only (no push, no PR). Test runner: vitest (`npm test`), `npm run typecheck`, `npm run compile`.

## Specs
- S1 — "Move (drag + arrow keys) and resize widgets; snap to grid; numeric x/y/w/h fields."
- S2 — "Z-order: Send to back / Bring to front / one step back/forward, persisted." and "Z-order persistence: confirm how Revolution stores paint order (id order vs. line order) before choosing renumbering or reordering." (see L5: not persisted to `.rev`; view-only; deviation reported)
- S3 — "Edit on 7" coordinates; 12" view keeps the phase-1 auto-scaling."
- S4 — "Implemented as a VS Code `CustomEditorProvider` over `.rev` so undo, redo, dirty state and save come from the editor platform." / "Undo/redo works through the standard VS Code commands."
- S5 — "Saving produces a minimal, stable diff in `.rev` (only touched `WDGT#n` lines change; BOM, CRLF and key order preserved)." / "Moving one widget changes exactly one `WDGT#` line."
- S6 — "Serializer that round-trips an unmodified `.rev` byte-for-byte (golden test on DOLE)." / "Open + save without edits leaves `main.rev` unchanged (byte-identical)."
- S7 — "Expose the screen model headlessly (no VS Code needed): list screens/widgets as JSON and render a screen to PNG/SVG" / "MCP/CLI renders a screen image matching the webview." (Option B, SVG only)
- S8 — Blocking spike: "Determine whether Revolution and the 1280 verify these hashes and how they are computed." / "If hashes cannot be reproduced, decide between (a) leaving them and accepting a Revolution warning, (b) a sidecar layout file applied by the MCP, or (c) stopping write-back." (decided (a), see L3)
- S9 — "The edited `.rev` opens in Revolution and loads through the EDP MCP on a test 1280 (manual check, recorded)." (PENDING manual check, protocol in the report)
- S10 — "Needs independent verification and a backup/rollback note before release."

## Tasks
- [x] T1 — S5, S6, S8: lossless serializer `src/rev/serialize.ts` + `computeCustomHash` + BOM/CRLF fixture derived from DOLE (pinned `-text`) + golden test. Route: inline. Risk: item 1, 3 (own commit). Commit `c1f9a02`.
- [x] T2 — S1, S3, S4: pure editor model (`editState`, `editorMath`, `messages`, `backup`) and one-step back/forward in `previewState`. Route: inline. Risk: none (pure, unwired). Commit `7635559`.
- [x] T3 — S1-S4, S6, S8: `CustomEditorProvider`, webview, confirmation + backup on first save, atomic write, stale-file refusal, hot exit, `package.json` contributes. Route: inline. Risk: item 1, 3. Commit `8bede08`.
- [x] T4 — S7: headless CLI (`screens`, `widgets`, `render` SVG) + `widgetBox` / `screenSvg`. Route: inline. Risk: none (read-only, new bundle). Commit `f88fd86`.
- [x] T5 — docs: readme, CHANGELOG, AGENTS. Route: inline. Commit `docs(editor)` (after `f88fd86`).
- [x] T6 — ODD doc + reviewer report. Route: inline. Commit `docs(odd)`.
- [ ] T7 — S9: open the saved `.rev` in Revolution and load it on a test 1280 (manual, user). Not runnable from here.

## Log
- L1 (user, original request): GitHub issue #6 "feat(editor): screen editor with .rev write-back (phase 2)" — https://github.com/fr4nkastro/vscode-language-iRite/issues/6 .
- L2 (decision, execution): Revolution and a 1280 are not reachable from this session and no EDP/diagnostics tool was used, so the blocking spike could not be run by hand.
- L3 (decision, hashes): option (a). `CustomHash` reproduced offline on DOLE (SHA-1 of the UTF-16LE `<Printers>` text, CRLF kept) and the writer never touches Printers, so it stays valid. `ConfigHash` could not be reproduced (about 29,000 combinations of SHA-1/MD5/SHA-256 over Config text, UTF-8/UTF-16/Latin-1, BOM, CRLF/LF, entity decoding, per-family subsets, with Printers appended); it is left untouched. Safeguards: opt-in editor, modal confirmation, backup first, stale-file refusal, manual protocol.
- L4 (evidence, widget order): on DOLE 193 `WDGT` lines are contiguous but 7 are out of id order (ids 8, 9, 10, 35, 36 and a few of 172-186 appear late). Those ids are gaps in the sequence reused for widgets created later, and e.g. the full-screen backgrounds 8 (`entrada.png`, screen 14) and 35 (`ingreso.png`, screen 12) sit AFTER labels of the same screen: if line order were paint order the backgrounds would hide the labels. The device receives widgets by `WDGT#id`, so it cannot know line order.
- L5 (decision, z-order): line order is not paint order and ids are code constants (generated `main.iri`), so z-order is NOT persisted to `.rev`: it stays the phase-1 view-only override (now with one step back/forward). Renumbering was rejected (breaks compiled code), line reordering rejected (no effect on the device, noisy diff). Deviation from the issue's "persisted", flagged as unverified in the report.
- L6 (decision, serializer): patch only the x/y/width/height tokens in place on a latin1 byte-per-char string; unknown/duplicate ids, non-integers and out-of-range values are refused; the save plan re-parses the result and refuses unless exactly the edited widgets changed.
- L7 (decision, undo after save): the edit state is relative to the bytes at open/revert (`doc.original`), `doc.bytes` tracks the last written bytes, so undo after a save rewrites the file correctly.
- L8 (evidence): `npm run typecheck`, `npm test` (332 tests, 29 files), `npm run compile`, `npx vsce ls` lists `dist/rev-cli.js`; headless Edge drive of the editor page on DOLE (24 checks) and mock-`vscode` smoke of `dist/extension.js` (27 checks).
