# Issue #4 — interactive call map (reviewer report)

Branch `feat/issue-4-callmap` (on top of `feat/issue-3-sfc-layout`). `iRite: Show Call Map` (`irite.showCallMap`) opens a read-only, C4-style webview: System -> Modules -> Routines by clicking, a breadcrumb back, a routine search and go to source. The generated docs also get a Mermaid Level 2 page. Feature doc: `odd/tasks/issue-4-callmap.md`.

## Review path

| Order | Commit | Review first |
|-------|--------|--------------|
| 1 | `c207295` feat(callmap): pure call graph, module aggregation, neighbourhood, search | `src/callmap/callGraph.ts`, `src/callmap/callViews.ts`, `test/callmap/callmap.test.ts`, fixture `test/fixtures/callmap/` |
| 2 | `140cc16` feat(callmap): system context (level 1) and message validation | `src/callmap/callContext.ts` (`parseOpenMessage`, `sanitizeViewState`) |
| 3 | `ad0c16b` feat(callmap): the Show Call Map webview | `src/callmap/callMapHtml.ts` (script), `src/commands/callMap.ts` |
| 4 | `b36be36` feat(docs): Mermaid call map in `callmap.md` | `src/callmap/callMermaid.ts`, `src/docs/generateDocs.ts` |

Commit 3 is about 630 changed lines (390 of them the webview page and its script, the rest command wiring, tests, readme); it is one behaviour (the webview) and is not split artificially. Out of scope: editing anything, a persisted hand layout (as in #3), intra-routine control flow, counting calls through function pointers or dynamic names (iRite has none).

## What was implemented

| Area | Files |
|------|-------|
| Call graph (pure) | `src/callmap/callGraph.ts`: files that hold routines (project-relative labels), routines (forward declarations resolved), call sites (`to = -1` = built-in) |
| Views (pure, shared with the webview) | `src/callmap/callViews.ts`: `moduleView` (L2, file or folder), `moduleDetail` (L3), `neighborhood`, `search`, `layoutGrouped`, `layoutColumns`; `CALL_VIEWS_SOURCE` |
| Level 1 + messages (pure) | `src/callmap/callContext.ts`: `buildSystemContext`, `parseOpenMessage`, `sanitizeViewState` |
| Page | `src/callmap/callMapHtml.ts`: CSP page, inline SVG, DOM-only script (no `innerHTML`), graph embedded as escaped JSON |
| Extension | `src/commands/callMap.ts` (panel, watchers, `open`/`state` messages), `src/extension.ts`, `package.json` command |
| Docs export | `src/callmap/callMermaid.ts`, `src/docs/generateDocs.ts` (`callmap.md`, links in `routines.md` and `index.md`) |
| Docs / manifest | `readme.md`, `CHANGELOG.md`, `AGENTS.md`, `package.json` |

No new setting. One new command. `src/commands/locateProject.ts` (added in #2) is reused.

## Decisions on the open questions (and why)

| Question | Decision | Why |
|----------|----------|-----|
| Level 1 content | Program plus `.rev` neighbours (scales, EDP ports, DIO, databases) as one context node per kind; program only without a `.rev` | It is the C4 "system context" the issue asks about, costs one pass over the existing `RevModel`, and degrades to the program alone. Kinds are collapsed (not one node per alias) because DOLE has 8 scales, 8 DIO, 6 databases: per-alias nodes would drown the program |
| Level 2 granularity | One node per `#include`d file that declares routines, in a frame per folder; toggle "Collapse to folders" | File level is what the issue asks for and what the code review needs; folder level is cheap because both come from the same `moduleView(g, gran)`. Files without routines (DOLE: 14 of 35, e.g. generated `main.iri`) have no calls, so they are counted in the header instead of drawn |
| Edge click | Side panel lists `caller -> callee file:line` per call site; each location opens the editor at the call line | Acceptance criterion; sites are kept as indices into one call table so nothing is duplicated |
| Level 3 | Module routines in columns; modules that call in on the left, modules it calls on the right, one box per module; internal edges aggregated per routine pair | Matches "collapsed per module"; a module that is both caller and callee appears on both sides on purpose, so direction is readable |
| Built-ins | Calls to names the project does not declare are hidden; optional dashed "built-ins" box | The issue's default; the toggle costs one pseudo node |
| Forward declarations | Resolved by name to the implementation; a forward without body stays as a node marked dashed | Parser already drops superseded forwards; the survivor is real information (declared but never implemented) |
| Open file/line | `{type:'open', file, line}` validated in the extension (`parseOpenMessage`): only project files, integer line >= 1, project's own path string used | Same trust model as #2/#3, now a tested pure function |
| Refresh | The webview reports its view (`state` message, sanitized); the extension re-embeds it on re-render | `webview.html` is replaced on every file change; without this the map would jump back to Level 1 |
| Mermaid export (optional) | Done: `callmap.md` with a `flowchart LR` (subgraph per folder, edges weighted), a table of module edges with every call site, a hidden-files note | Cheap because the pure `moduleView` already exists; it is the issue's "link from routines.md" |
| Search | Case-insensitive; exact, then prefix, then substring; selecting opens the routine's module with the routine selected | Matches iRite identifier semantics; results show routine, kind and module |

## Acceptance criteria

| Criterion | How it is met | Evidence |
|-----------|---------------|----------|
| New command opens an interactive webview for the active project | `irite.showCallMap`, `locateMainSrc` shared with the other previews | Smoke: "irite.showCallMap is registered", "one webview panel with scripts and no local resources", "second invocation reuses the panel" |
| L1 -> L2 -> L3 by click, breadcrumb back | `setView` + `renderCrumbs` | Browser: "L2 breadcrumb System > Modules", "L3 breadcrumb System > Modules > module", "breadcrumb Modules returns to L2", "breadcrumb System returns to L1". DOLE: 4 context groups, 21 modules, biggest module renders its routines |
| L2 module edges; edge click lists calls with file:line | `moduleView` + `edge` panel | Vitest `aggregates caller module -> callee module with counts and internal calls` (lines 4, 11, 13); browser "edge click lists 3 calls with file:line", "edge panel rows read caller -> callee". DOLE: 64 edges |
| Search shows callers/callees | `search` + `neighborhood` | Vitest `searches case-insensitively...`, `returns callers, callees and the modules involved for a routine`; browser "search is case-insensitive...", "result panel: callers, callee Beep2, modules involved". DOLE: `CmdSetTransition` 7 callers, 3 callees, 4 modules |
| Selecting a routine / call site opens the file at the line | `open` message from Go to definition, `file:line` buttons, double-click | Browser "call site opens its file at the call line" (line 11), "Go to definition opens the declaration line" (line 8); smoke "valid open message opens the file at line-1"; vitest `parseOpenMessage` (2 tests) |
| Pure logic without `vscode` imports, vitest, cross-module fixture | `src/callmap/{callGraph,callViews,callContext,callMermaid}.ts` import nothing from `vscode`; fixture `test/fixtures/callmap/` (4 modules in 2 folders, forward declarations, built-ins, recursion, mixed-case calls, parameterless calls) | 32 new tests in `test/callmap/` (4 files) |
| Verified against DOLE | Pages generated from the real project and driven in headless Edge; docs generated into a scratch dir | L13 in the feature doc: 21 modules / 201 routines / 914 sites (515 project + 399 built-in) / 64 edges; 14 folders / 39 folder edges |

Other scope items: read-only (smoke compares the project tree before and after: identical; the command never calls any write API); forward declarations (`resolves forward declarations to their implementation`); built-in filtering (`marks calls to undeclared names as built-ins`, `lists built-in calls apart from the module edges`, browser built-ins toggle: 1 node, 4 edges on the fixture).

## Security notes

-   Strict CSP (`default-src 'none'`, scripts by nonce only); no inline handlers; no external resources; `localResourceRoots: []`. Test: `locks the page down...`.
-   Names, paths and diagnostics reach the page as JSON escaped for `<script>` (`jsonForScript`, test with `</script><img onerror>`) and are written with `textContent` only; the page never uses `innerHTML`.
-   The two webview-to-extension messages are validated (`parseOpenMessage`, `sanitizeViewState`); nothing from the webview is used as a path except through the project's own file list.

## Not verified

-   Not run inside a real VS Code window: the webview was driven in headless Edge with a stubbed `acquireVsCodeApi`, and the extension through a mock `vscode`. `vscode.getState`/`setState` persistence is a fallback; the primary refresh path is the extension re-embedding the sanitized state.
-   The generated Mermaid was not rendered (no Mermaid engine offline); it uses plain `flowchart LR`, `subgraph`, quoted labels and `-->|n|` edges, with `"[]<>` replaced in labels.
-   Layout quality on very large projects: DOLE's Level 2 (21 nodes, 64 edges) is a dense but readable hairball; hover highlight and edge click are the mitigation. No force-directed or crossing-minimising layout was attempted.
-   Parameterless calls (`Foo;`) are only detected for routines the project declares (parser rule); a call to an undeclared parameterless name is therefore invisible, which is the same as a built-in.

## Refactor candidates / design notes for the reviewer

-   `src/commands/callMap.ts`, `erd.ts` and `sfc.ts` now repeat the same panel skeleton (panel map, watcher trio, debounce, project-membership check). A shared `WebviewPanelBase` would remove roughly 60 lines each; left out to keep this slice about one behaviour. `erd.ts` and `docs.ts` still carry their own `locateMainSrc` copy (same note as in #3).
-   The `.rev` lookup (`readdirSync ... main.rev first`) is now copied four times (erd, docs, callMap, previewScreens variants); a `findRevText(dir)` in `locateProject.ts` is the obvious extraction.
-   `callMapHtml.ts` keeps the page script in a template literal (about 280 lines). If it grows (keyboard navigation, minimap), move it to a real `.js` file bundled by esbuild as text; the current approach keeps a single file and no extra build step, as for the SFC page.
-   `createCallViews` must stay self-contained to be embeddable. Every helper is declared inside the factory; a lint rule or a test that evaluates `CALL_VIEWS_SOURCE` in isolation guards it (`embeds the very same view functions the extension uses`).
-   The view layer works on indices (`routines[i]`, `sites[i]`) to keep the embedded JSON small (DOLE: 914 sites). Names are only resolved at render time; if the graph ever needs stable ids across refreshes (e.g. to persist a selected routine), key by lowercase routine name instead of index. Today a refresh restores the selection by index, which can point at a different routine if one is inserted above it; the worst case is a different routine highlighted after an edit.
-   Folder granularity uses the folder's own path as module id and file granularity uses the file label; both are project-relative with `/`, so ids are stable across machines.
-   The Level 3 layout shows a module twice (left and right) when it is both caller and callee. That is intentional (direction), but a reviewer may prefer a single box with two-way edges.
