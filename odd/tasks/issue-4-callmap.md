# Issue #4 — interactive C4-style call map of modules and routines

Objective: add the read-only command `iRite: Show Call Map` (`irite.showCallMap`): a webview that drills System -> Modules -> Routines over the call graph the parser already captures, with search, go to source and an optional Mermaid export in the generated docs. Branch `feat/issue-4-callmap` (from `feat/issue-3-sfc-layout`). Test runner: vitest (`npm test`); checks: `npm run typecheck`, `npm test`, `npm run compile`. Delivery strategy: `ask-on-risk`, 4 code slices + docs. Reviewer report: `odd/reports/issue-4-callmap.md`.

## Specs
- S1 — "New command opens an interactive call-map webview for the active iRite project."
- S2 — "Level 1 → Level 2 → Level 3 drill-down by click, with a way back (breadcrumb)."
- S3 — "Level 2 shows module-to-module edges; clicking an edge lists the calls behind it with file:line."
- S4 — "Routine search shows all callers/callees of the selected routine."
- S5 — "Selecting a routine or call site opens the source file at the right line."
- S6 — "Pure logic (call graph model, module aggregation, built-in filtering) has no `vscode` imports and is covered by vitest, including a fixture with cross-module calls."
- S7 — "Verified against the DOLE reference project."
- S8 — Scope (issue): "Only project routines are nodes; built-in iRite API calls (e.g. `SelectScreen`, `SetLabelText`) are excluded or shown as an optional collapsed "built-ins" group."; "Forward declarations resolve to their implementation."; "Read-only: never writes `.src` / `.iri` / `.rev`."; "Same project-locating behaviour as the other preview commands."
- S9 — Scope (issue, optional): "Optionally link the Routines page in generated docs to an exported static diagram (Mermaid) of Level 2."
- S10 — Existing behavior stays intact (docs generation, other webview commands).

## Tasks
- [x] T1 — Pure core: call graph (files, routines, call sites, forward resolution, built-in marking), module aggregation at file and folder granularity, module detail (Level 3), routine neighbourhood, search, grouped and column layouts, cross-module fixture (S6, S8). Route: inline. Risk: none (new modules only). Commit: c207295
- [x] T2 — Level 1 system context from the `.rev`, validated `open` and `state` webview messages (S1, S5, S8). Route: inline. Risk: none (new modules only; the message validator is the only new trust boundary and is tested). Commit: 140cc16
- [x] T3 — Webview (drill-down, breadcrumb, edge call lists, search, go to source, built-ins and folder toggles), `irite.showCallMap` command, manifest, readme, changelog, AGENTS (S1-S5, S8). Route: inline. Risk: none (adds a command and two validated message types; no existing option or format changed). Commit: ad0c16b
- [x] T4 — Mermaid Level 2 export as `docs/generated/callmap.md`, linked from `routines.md` and `index.md` (S9, S10). Route: inline. Risk: none (adds a generated page and one link line to existing generated pages; no existing contract is removed or changed and the docs tests that existed pass untouched). Commit: b36be36
- [x] T5 — ODD doc + reviewer report. Route: inline. Commit: see git log (`docs(odd)`)

## Log
- L1 (user, original request): GitHub issue #4 "feat(callmap): interactive C4-style call map of modules and routines" — https://github.com/fr4nkastro/vscode-language-iRite/issues/4 . User gave green light to pick the most recommended option for every open decision.
- L2 (decision, open question 1): Level 1 = the program node plus, when a `.rev` is present, one context node per equipment kind (scales, EDP ports, digital I/O, databases) read from the existing `src/rev` model; program only otherwise. Context nodes are read-only and not part of the call graph.
- L3 (decision, open question 2): Level 2 = one node per `#include`d file that declares routines, drawn inside a frame per folder; a "Collapse to folders" toggle turns each folder into one node. Files without routines (`main.src`, generated `main.iri`, forward-declaration-only files) are not drawn and are counted in the header.
- L4 (decision): one implementation of the views. `createCallViews` is self-contained and is both imported by the extension (tests, docs export) and embedded in the webview through `Function.prototype.toString` (same pattern as `createGeometry` in #3). The webview receives only the raw graph (files, routines, call sites) and derives every level on demand, so the folder and built-in toggles need no round trip.
- L5 (decision): forward declarations resolve by name. The parser already drops a forward when a definition exists; a forward that survives (no body anywhere) stays a node flagged `forward`. Callee matching is case-insensitive; with duplicate definitions the first wins and a diagnostic is reported.
- L6 (decision): built-ins = calls whose name is not a routine of the project. They never appear as nodes; "Show built-ins" adds one dashed "built-ins" box with weighted edges.
- L7 (decision): the open message is validated by `parseOpenMessage` (project files only, positive integer line, returns the project's own spelling of the path); view state travels as a separate `state` message, sanitized by `sanitizeViewState`, so a file-watcher refresh restores the level instead of resetting to Level 1.
- L8 (decision): module labels show the last two path segments (`machine/scale.iri`), because DOLE has many `main.iri`; the folder frame gives the rest.
- L9 (process note): the pure core, context/messages and Mermaid export were test-first (RED observed each time: module missing). The webview was written first and driven in a real browser afterwards (see L11); its static contract (CSP, no inline handlers, escaping, embedded views equal to the extension's) has vitest tests.
- L10 (evidence): vitest 189/189 (157 baseline + 32 new), `npm run typecheck` clean, `npm run compile` ok.
- L11 (evidence, scratch only, not committed): real Chromium (Edge headless over CDP) driving the rendered page, 31 checks on the cross-module fixture (drag does not navigate, L1->L2->L3, breadcrumb back, edge call list with file:line, open messages, hover highlight, built-ins and folder toggles, routine selection, go to definition, neighbour module drill, case-insensitive search, view restore on reload, no script errors) and 9 checks on DOLE, both with the normal and the minified bundle: all pass.
- L12 (evidence, scratch only): mock-`vscode` smoke of `dist/extension.js` (11 checks): command registered, panel created with scripts and no local roots, CSP, valid open message opens line-1, foreign file / bad line / wrong type / junk ignored, panel reused, state re-embedded, watcher re-render, project folder byte-identical.
- L13 (evidence): DOLE (read-only): 21 modules with routines (14 files hidden), 201 routines, 914 call sites (515 to project routines, 399 built-ins), 64 module edges, 14 folders and 39 folder edges, 0 forward-only routines, no graph diagnostics; Level 1 context Scales 8, EDP ports 3, Digital I/O 8, Databases 6; `CmdSetTransition` has 7 callers, 3 callees, 4 modules involved; generated `callmap.md` 193 lines. DOLE untouched (its untracked `docs/generated/` predates this work).
