# Issue #3 — editable, persistent SFC layout and diagnostics in Problems

Objective: make `iRite: Show Sequence Diagram (SFC)` hand-editable (drag steps/transitions, bend points), persist that layout in a JSON sidecar, and publish SFC diagnostics to the Problems panel. Branch `feat/issue-3-sfc-layout` (from `feat/issue-2-db-access`). Test runner: vitest (`npm test`); checks: `npm run typecheck`, `npm test`, `npm run compile`. Delivery strategy: `ask-on-risk`, 3 code slices + docs. Reviewer report: `odd/reports/issue-3-sfc-layout.md`.

## Specs
- S1 — "Steps can be dragged and edges can get bend points in the SFC webview."
- S2 — "Layout is saved and restored on the next `iRite: Show SFC`; reset is available."
- S3 — "SFC diagnostics appear in the Problems panel with severity and, when available, file/line; clicking one opens the location."
- S4 — "Pure logic (layout merge, severity mapping) stays free of `vscode` imports and is covered by vitest."
- S5 — Scope (issue): "never write into `.src`/`.iri`/`.rev`"; "Keep zoom/pan behavior as it is today."; ERD diagnostics out of scope.
- S6 — Existing behavior stays intact (Mermaid export, `src/docs` SFC page, click-to-open).

## Tasks
- [x] T1 — Diagnostics: `severity` gains `"error"`, stable codes, a file/line for every diagnostic, pure severity mapping + grouping, `irite-sfc` DiagnosticCollection tied to the panel lifecycle, webview list clickable (S3, S4, S6). Route: inline. Risk: none (extends a union type and adds optional fields; the docs generator only reads `message`). Commit: 2f72892
- [x] T2 — Pure layout editing core: sidecar schema/validation/serialization, diagram key, `mergeLayout`, geometry (route, insert bend) shared with the webview (S2, S4). Route: inline. Risk: none (new modules; `layoutSfc` only gained optional fields). Commit: 40a2e6d
- [x] T3 — Webview editing + persistence wiring: drag steps/bars, bend points, debounced validated save, Reset layout (button + `irite.sfc.resetLayout`), readme/changelog/AGENTS (S1, S2, S5). Route: inline. Risk: none (adds a command and a validated message type; no existing option or format changed). Commit: 02efbab
- [x] T4 — ODD doc + reviewer report. Route: inline. Commit: see git log (`docs(odd)`)

## Log
- L1 (user, original request): GitHub issue #3 "feat(sfc): editable, persistent SFC layout and diagnostics in Problems panel" — https://github.com/fr4nkastro/vscode-language-iRite/issues/3 . User gave green light to pick the most recommended option for every open decision.
- L2 (decision): sidecar `.vscode/irite-sfc.layout.json` in the workspace folder that contains `main.src` (next to `main.src` when there is none); one file holds every project of the workspace, each under a diagram key `<project dir relative to the base>::<states enum>/<transitions enum>` (lower-case). Schema `version: 1`; keys lower-cased because iRite identifiers are case-insensitive.
- L3 (decision): edits are shipped as one `{type:'layout', diagram}` message per drag end; the extension sanitizes it (rounding, clamping, caps, unknown names dropped) and writes it 250 ms later (flushed when the tab closes). Entries saved for names that are not drawn right now are kept until Reset, so a temporary rename does not lose a hand-made layout.
- L4 (decision): a step carries its outgoing bars unless the bar itself was dragged; automatic link segments are Z-shaped, segments next to a bend are straight; bends are stored as `before` / `after` the bar.
- L5 (decision): routing code is one self-contained function (`createGeometry`) used by the extension (merge, tests) and embedded into the webview through `Function.prototype.toString`, so there is a single implementation. Verified under esbuild `--minify` too.
- L6 (decision): "closed" for Problems = the SFC panel of that project is disposed. Diagnostics live only while the panel is open; refresh = every panel render (file watcher on `*.iri`/`*.src`, which covers save, plus settings changes).
- L7 (decision): diagnostics without a location go to `main.src` line 1 in Problems. Stale-layout entries are reported in the webview side panel only, not in Problems (they are not FSM defects).
- L8 (process note): the geometry and sidecar modules were written together with their tests (green-first); `mergeLayout`, `mergeSave`, diagnostics mapping and locations were test-first (RED observed for diagnostics: module missing).
- L9 (evidence): vitest 157/157 (114 baseline + 43 new), `npm run typecheck` clean, `npm run compile` ok (also `node esbuild.mjs --production`).
- L10 (evidence, scratch only, not committed): real Chromium (Edge headless) driving the rendered webview with synthetic pointer events, 21 checks (drag step/bar/bend, dblclick and Alt+click add, dblclick and right-click remove, pan, zoom, click-to-open, drag-does-not-open, reset) at scale 1 and 0.35, with the normal and the minified bundle, on the petri fixture and on DOLE: all pass.
- L11 (evidence, scratch only): mock-`vscode` smoke of `dist/extension.js` (21 checks): Problems published/cleared, validated debounced write, restore on reopen, flush on close, reset (webview and command), corrupt sidecar warned and never overwritten.
- L12 (evidence): DOLE (read-only) yields 11 steps, 14 transitions, 2 errors / 6 warnings / 1 info, all with file+line; DOLE untouched (its untracked `docs/generated/` predates this work).
