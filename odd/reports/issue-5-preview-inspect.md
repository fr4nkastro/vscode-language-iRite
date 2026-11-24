# Issue #5 — screen preview inspection upgrades (reviewer report)

Branch `feat/issue-5-preview-inspect` (on top of `feat/issue-4-callmap`). Phase 1 of the screen tooling, strictly read-only: `iRite: Preview Screens` gets a z-index bug fix, a 7"/12" panel selector, a widget list, hide/show, preview-only z-order and richer code links. Nothing is written to `.rev` or to sources. Feature doc: `odd/tasks/issue-5-preview-inspect.md`.

## Review path

| Order | Commit | Review first |
|-------|--------|--------------|
| 1 | `6641f01` fix(preview): overlay for hover/selection | `src/preview/screenHtml.ts` (`.ovl`, `place`), test `never lifts a hovered or selected widget...` |
| 2 | `6acab31` feat(preview): references outside calls, grouped | `src/irite/parser.ts` (`noteIdRef`, `noteLiteralAssign`, `endLine`), `src/preview/screenModel.ts` (`indexReferences`), `src/preview/refGroups.ts`, `test/preview/references.test.ts`, fixture `test/fixtures/preview/` |
| 3 | `2eed723` feat(preview): screen names and click-handler entry | `src/preview/screenNames.ts`, `test/preview/screenNames.test.ts` |
| 4 | `dac2532` feat(preview): 7"/12" selector | `src/preview/panels.ts` (assumptions documented in the header), `test/preview/panels.test.ts` |
| 5 | `f7bf4fd` feat(preview): widget list, screen header, grouped links | `src/preview/widgetList.ts`, `src/preview/screenHtml.ts` (`renderScreen`, script), `test/preview/widgetList.test.ts` |
| 6 | `2380689` feat(preview): hide/show and z-order, kept across refreshes | `src/preview/previewState.ts`, `src/commands/previewScreens.ts` (`onMessage`), `test/preview/previewState.test.ts`, `previewControls.test.ts` |
| 7 | `28ad246` docs(preview) | `readme.md`, `CHANGELOG.md`, `AGENTS.md` |

Commit 2 is about 345 lines (a third of it fixtures and tests), commits 5 and 6 are 300-450 lines each, all one behaviour. Out of scope (as in the issue): moving or resizing widgets, persisting z-order, any `.rev` write.

## What was implemented

| Area | Files |
|------|-------|
| Bug fix | `src/preview/screenHtml.ts`: hover/selection are `.ovl` boxes (pointer-events none) instead of `z-index:100000` on the widget |
| Parser (additive, optional fields) | `src/irite/model.ts`, `src/irite/parser.ts`: `IriteRoutine.idRefs`, `IriteRoutine.literalAssigns`, `IriteCall.endLine` |
| Reference index (pure) | `src/preview/screenModel.ts`, `src/preview/refGroups.ts`: `WidgetReference.routine`, `(reference)` for non-call uses, `WidgetView.refGroups` |
| Screen names / entry (pure) | `src/preview/screenNames.ts`: `resolveScreenNames`, `resolveScreenEntries`; `ScreenView.names`, `ScreenView.entry` |
| Panels (pure) | `src/preview/panels.ts`: `PANELS`, `panelGeometry`, `uniformScale`, `scaleRect` |
| List and labels (pure) | `src/preview/widgetList.ts`: `buildWidgetRows`, `screenTitle`, `entryLabel` |
| View state (pure, also embedded in the page) | `src/preview/previewState.ts`: `createPreviewState` factory, `PREVIEW_STATE_SOURCE` |
| Page / command | `src/preview/screenHtml.ts`, `src/commands/previewScreens.ts` (`state` message, `parseOpenMessage`) |

No new command, setting or dependency. `src/docs` and `src/callmap` are untouched; their tests pass unchanged (the only preview tests edited are three `toEqual` expectations that gained `routine`).

## Decisions on the open questions (and why)

| Question | Decision | Why |
|----------|----------|-----|
| 12" scale: uniform 1.6 or per-axis | Uniform 1.6, 32 px letterbox band under the content | Per-axis (1.6 x 1.667) distorts authored proportions (round symbols, image aspect). The issue's own recommended default. The band is drawn hatched with a tooltip that says "assumption". Not confirmed on a real unit |
| Header per panel | 7": 92 px (800x388 usable, as before, seen on DOLE). 12": 147.2 px = 92 x 1.6 | It is the only value for which header + scaled content + the 32 px band equals the 800 px panel height; no other measurement exists. A single named constant in `panels.ts`, documented as unconfirmed in code, readme, AGENTS and the band tooltip |
| Where the band sits | Below the scaled content, full width | Simplest consistent model (content anchored under the header); a centered band would be equally unmeasured |
| Selection style | Outline overlay element per screen, hover dashed 1 px, selection solid 2 px | Meets "does not change paint order" by construction: no widget ever gets a different z-index because of hover or selection |
| List placement | Side panel when the window is at least 900 px wide, below otherwise (flex wrap) | Issue default; one DOM, no duplicate list |
| Hide/show | Eye per row, `display:none` on the widget, "Show all" per screen | Hidden widgets cannot be hit by the pointer, so the ones behind can be selected from the canvas |
| Z-order | Two ordered lists (`back`, `front`) per screen; latest operation wins; ranks applied as z-index | Pure, testable, and "reset order" is just clearing the list. Labelled "preview only, not saved" in tooltips and a note |
| Persistence | `vscode.setState` plus the extension keeps the sanitized state and re-embeds it | Same belt and braces as #4; the page is replaced on every file change, so extension memory is the reliable path |
| Non-call references | Parser records identifier uses (one per name and line) and the preview index adds `(reference)` entries not already covered by a call span | Catches `g_i := lblPlaca;` and `if iWidget = btnOk then`; multi-line calls do not produce a duplicate (via `endLine`) |
| Screen names | `UiScreen` fields assigned numeric literals in `uiLoadSettingsUi` (any routine as fallback) | House convention, works on DOLE (14 of 15 screens named). A project that assigns names differently simply shows no name |
| Entry point | The routine called under the `WidgetClicked` branch whose condition ends in `.Field` | Matches DOLE's chain; both the handler (dispatch line) and the routine (declaration) are links |
| Message validation | `parseOpenMessage` (shared with #4) for `open`; `previewState.sanitize` for `state` | Same trust model as #2-#4; the extension never uses a path from the page except through the project's own file list |

## Acceptance criteria

| Criterion | How it is met | Evidence |
|-----------|---------------|----------|
| Selecting `img7` on DOLE screen 1 keeps `imLoad` (id 130) visible | Overlay instead of z-index | Vitest `never lifts a hovered or selected widget in paint order (selection is an overlay)`. Headless Edge on DOLE: "imLoad still topmost after selecting img7" PASS (same check FAILED on the pre-fix code: top element was the selected `img7`) |
| Switching to 12" rescales every widget without user input; switching back restores 7" | `panelGeometry` scale 1.6, CSS transform of the content layer | Vitest `scales 12 inch uniformly by 1.6 and leaves a 32 px letterbox band`, `rescales every widget of a real .rev without input and restores 7 inch exactly`. Edge on DOLE screen 11: 40 of 40 widgets x1.6 (max deviation 0.0000), restored on 7" |
| Every widget of a screen appears in the list; list and canvas selection stay in sync | Server-rendered rows + selection handlers | Vitest `lists every widget of the screen...`, `covers every widget of every screen`, `has one list row per widget...`. Edge on DOLE and fixture: rows = widgets, canvas click selects row, row click shows overlay |
| Hidden widgets stay hidden across re-renders of the same panel and reset on demand | `previewState` kept in webview and extension, re-embedded | Vitest `toggles one widget per screen...`, `restores a valid state ... so a re-render keeps it`; smoke: state message then second invocation embeds `{"12":[4]}`; Edge restore run (screen, panel, hidden, front override restored), `Show all` resets |
| Clicking a reference opens the file at that line | `open` message through `parseOpenMessage` | Smoke: valid message opens handler.iri at line 255 (selection line 254); foreign files, line 0, 1.5, missing line and junk ignored. Edge: reference and entry links post `{type:'open', file, line}` |
| Pure logic covered by vitest in `test/preview/` | `panels`, `refGroups`/`screenModel`, `screenNames`, `widgetList`, `previewState` have no `vscode` import | 61 new tests (250 total) in `references`, `screenNames`, `panels`, `widgetList`, `previewState`, `previewControls`, `preview` plus 4 parser tests |

Other scope items: grouping by routine and file (`groups references by file, then routine...`), assignments and comparisons (`includes plain comparisons and assignments outside calls`), screen names and entry (`screenNames.test.ts`, 11 tests), "clearly marked as not saved" (`previewControls.test.ts`: buttons carry "not saved", every screen has the note).

## Security notes

-   CSP unchanged and tested (`default-src 'none'`, scripts by nonce, one script element). The initial state is sanitized, then escaped for `<script>` (`<`, `>`, `&`); test `sanitizes junk and cannot break out of the script element`.
-   The page builds the inspector with `textContent` only; no `innerHTML`. File paths travel in `data-file` attributes, escaped, and only project paths are ever opened.
-   `state` messages are bounded (2000 ids per list, 1000 screens) and shape-checked.

## Not verified

-   **No real 12" unit.** Scale 1.6, the 12" header (147.2 px) and the band position are assumptions; the issue's two open decisions remain open for hardware confirmation.
-   **Not run inside a real VS Code window.** The page was driven in headless Edge with a stubbed `acquireVsCodeApi`; the extension through a mock `vscode`. `vscode.getState` persistence across a real `webview.html` replacement is covered only by the extension re-embedding path.
-   Responsive layout (side vs below) was exercised only at the headless window width (1500 px).
-   RED was observed for the bug fix. For the later pure modules the tests were written first but first run together with the implementation (module-missing was the only RED).
-   The Mermaid/other pages of earlier issues were not touched and not re-driven; only docs generation on DOLE was re-run (21 files, now with 70 extra `(reference)` rows in `screens.md`).

## Refactor candidates / design notes for the reviewer

-   `screenHtml.ts` keeps CSS and the page script as template literals (now ~330 lines). Moving the script to a bundled `.js` text asset would allow linting it; same note as for the call map and SFC pages.
-   `createPreviewState` is self-contained and embedded with `Function.prototype.toString`, exactly like `createCallViews`; a test (`embedded source`) evaluates the string in isolation to guard it. A third self-embedded factory is a hint that a small `embeddable()` helper plus lint rule would pay off.
-   `previewScreens.ts` still has its own `.rev` locator and panel skeleton (the same duplication listed in #4). Extracting `findRevText` and a shared panel base would now touch four commands.
-   `WidgetReference` identity is `(file, line, callee, routine)`. A routine name is not unique across files; if two files declare the same routine name, the group header still shows the right file, but the routine label is ambiguous.
-   `idRefs` stores one entry per identifier use of every routine (not only widget aliases) to keep the parser unaware of `.rev`. It is cheap on DOLE (82 ms to load and index the whole project) but grows with code size; a lazily computed index would be the next step if it ever shows up in profiles.
-   `screenNames` assumes the IPESAH convention. If another house style appears, `SCREEN_RECORD`, `SCREEN_LOADER` and `CLICK_HANDLER` are the only three names to make configurable.

### Reuse notes for phase 2 (issue #6, `.rev` screen editor as a `CustomEditorProvider`)

-   `src/preview/panels.ts` is the single source for panel sizes, scale and the header assumption; an editor needs exactly these numbers (and the same unconfirmed header) for coordinate conversion between screen space and `.rev` space (`scaleRect` plus the inverse).
-   `src/preview/previewState.ts` is the right home for editor view state (selection, hidden, z-order). Keep "preview-only" state separate from edits: edits must go through the editor's own document model so undo/redo and dirty tracking work; z-order override must stay a view concern unless `.rev` ordering is proven (paint order = id ascending is still an assumption).
-   `buildWidgetRows` / `screenTitle` / `entryLabel` and the list markup can back the editor's outline view; row selection already syncs both ways.
-   `parseOpenMessage` and `previewState.sanitize` show the pattern for every webview-to-extension message; an editor needs the same for edit messages (validate ids against the document, bound numbers).
-   `.rev` integrity: `ConfigHash` / `CustomHash` are digests and the format is reverse-engineered; the parser in `src/rev` is read-only. A writer must preserve the BOM, CRLF and text-node layout and decide what to do with the hashes before any save path is built; none of that exists yet.
-   Widget type semantics (types 1, 3, 6 and the unknown `?` fields in `AGENTS.md`) are still incomplete; an editor that rewrites a line must round-trip unknown fields verbatim (`RevWidget.raw` already keeps them).
