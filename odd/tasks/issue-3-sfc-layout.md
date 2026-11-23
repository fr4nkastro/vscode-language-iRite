# Issue #3 — editable, persistent SFC layout and diagnostics in Problems

Objective: make `iRite: Show Sequence Diagram (SFC)` hand-editable (drag steps/transitions, bend points), persist that layout in a JSON sidecar, and publish SFC diagnostics to the Problems panel. Branch `feat/issue-3-sfc-layout` (from `feat/issue-2-db-access`). Test runner: vitest (`npm test`); checks: `npm run typecheck`, `npm test`, `npm run compile`. Delivery strategy: `ask-on-risk`, 3 code slices + docs.

## Specs
- S1 — "Steps can be dragged and edges can get bend points in the SFC webview."
- S2 — "Layout is saved and restored on the next `iRite: Show SFC`; reset is available."
- S3 — "SFC diagnostics appear in the Problems panel with severity and, when available, file/line; clicking one opens the location."
- S4 — "Pure logic (layout merge, severity mapping) stays free of `vscode` imports and is covered by vitest."
- S5 — Scope (issue): "never write into `.src`/`.iri`/`.rev`"; "Keep zoom/pan behavior as it is today."; ERD diagnostics out of scope.
- S6 — Existing behavior stays intact (Mermaid export, `src/docs` SFC page, click-to-open).

## Tasks
- [ ] T1 — Diagnostics: `severity` gains `"error"`, locations for every diagnostic, pure severity mapping + grouping, `irite-sfc` DiagnosticCollection tied to the panel lifecycle (S3, S4, S6). Route: inline. Risk: none (extends a type with an optional field/union member; docs generator ignores severity). Commit: pending
- [ ] T2 — Pure layout editing core: sidecar schema/validation/serialization, diagram key, `mergeLayout`, geometry (route, insert/remove bend) (S2, S4). Route: inline. Risk: none. Commit: pending
- [ ] T3 — Webview editing + persistence wiring: drag steps/bars, bend points, debounced save, Reset layout (button + command), settings/docs (S1, S2, S5). Route: inline. Risk: none (adds command; webview message surface validated). Commit: pending
- [ ] T4 — ODD doc + reviewer report + AGENTS.md note. Route: inline. Commit: pending

## Log
- L1 (user, original request): GitHub issue #3 "feat(sfc): editable, persistent SFC layout and diagnostics in Problems panel" — https://github.com/fr4nkastro/vscode-language-iRite/issues/3 . User gave green light to pick the most recommended option for every open decision.
