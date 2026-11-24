# Issue #3 — SFC layout editing, persistence and Problems diagnostics (reviewer report)

Branch `feat/issue-3-sfc-layout` (on top of `feat/issue-2-db-access`). `iRite: Show Sequence Diagram (SFC)` now lets you drag steps and bars, route lines with bend points, keeps that layout in `.vscode/irite-sfc.layout.json`, and publishes the FSM diagnostics to the Problems panel. Feature doc: `odd/tasks/issue-3-sfc-layout.md`.

## Review path

| Order | Commit | Review first |
|-------|--------|--------------|
| 1 | `2f72892` feat(sfc): publish SFC diagnostics to the Problems panel | `src/sfc/sfcModel.ts` (locations, severities), `src/sfc/sfcDiagnostics.ts`, `SfcProblems` in `src/commands/sfc.ts` |
| 2 | `40a2e6d` feat(sfc): add pure layout editing core | `src/sfc/sfcGeometry.ts`, `sfcSidecar.ts`, `sfcLayoutEdit.ts` |
| 3 | `02efbab` feat(sfc): drag steps and bars, add bend points and persist | `src/sfc/sfcHtml.ts` (script), `sfcLayoutStore.ts`, `SfcPanel` in `src/commands/sfc.ts` |

Out of scope: ERD diagnostics (issue note), editing anything but the sidecar. Commit 2 is about 560 changed lines (about 400 of them code; the rest is its 20 tests) and commit 3 about 600 (webview script and wiring); each is one behaviour and not split artificially.

## What was implemented

| Area | Files |
|------|-------|
| Diagnostics (pure) | `src/sfc/sfcModel.ts` (`"error"`, `SfcDiagnosticCode`, file/line for every diagnostic), `src/sfc/sfcDiagnostics.ts` (`toVsSeverityName`, `groupSfcDiagnostics`) |
| Layout core (pure) | `sfcGeometry.ts` (route, insertBend), `sfcSidecar.ts` (schema, sanitize, parse, serialize, keys), `sfcLayoutEdit.ts` (`mergeLayout`, `mergeSave`, `knownKeys`), optional fields on `LayoutNode`/`LayoutLink` in `sfcLayout.ts` |
| IO (node `fs`, no vscode) | `sfcLayoutStore.ts` (read, atomic write via tmp+rename, delete when empty) |
| Webview | `sfcHtml.ts`: drag/bend script, model JSON block, Reset button, layout hints and warnings |
| vscode wiring | `src/commands/sfc.ts`: `SfcProblems`, `SfcPanel` (load/merge/save/reset), command `irite.sfc.resetLayout`; `src/commands/locateProject.ts` now reused instead of a private copy |
| Docs / manifest | `package.json` (command `iRite: Reset SFC Layout`), `readme.md`, `CHANGELOG.md`, `AGENTS.md` |

No new setting. New command: `irite.sfc.resetLayout`. New Problems collection: `irite-sfc` (source `iRite SFC`, code = diagnostic kind).

### Diagnostics

| Kind (`code`) | Severity | Location |
|---------------|----------|----------|
| `no-target` | Error | first emitter call site, else the `TRANSITIONS` enum line |
| `unreachable-step` | Warning | the step's entry routine, else the `STATES` enum line |
| `never-emitted` | Warning | the `TRANSITIONS` enum line |
| `conflicting-targets` | Warning | the second `SetState` call site |
| `missing-enum` | Warning | none, so `main.src` line 1 |
| `no-entry-routine` | Information | the `STATES` enum line |

The enum line is the declaration, not the member (the parser does not keep member lines).

### Sidecar schema (`version: 1`)

```json
{
  "version": 1,
  "diagrams": {
    ".::states/transitions": {
      "steps": { "standby": { "x": 500, "y": 60 } },
      "links": {
        "start@standby": { "bar": { "x": 20, "y": 30 }, "before": [{ "x": 5, "y": 5 }], "after": [{ "x": 9, "y": 9 }] },
        "clear": { "after": [{ "x": 700, "y": 40 }] }
      }
    }
  }
}
```

- Diagram key: project folder relative to the workspace folder (posix, `.` = root) `::` states enum `/` transitions enum, lower-case.
- Step key: lower-cased name. Link key: `transition@sourceStep` for a link drawn from a step, `transition` for the "from any step" lane.
- `bar` present = bar fixed by hand; absent = the bar follows its source step. `before`/`after` = bend points between the source and the bar / the bar and the target.
- Coordinates are integers, clamped to +-100000; at most 5000 entries and 64 bends per side; sorted keys and a trailing newline so it diffs cleanly.

## Decisions and why

| Decision | Why |
|----------|-----|
| Sidecar in the workspace folder's `.vscode/`, one file for all projects | The issue proposed it; `.vscode/` is the conventional place for per-workspace tool state and is committable. A project outside any workspace folder falls back to the `main.src` folder. |
| Diagram key includes the enum pair | The enum names are settings; two FSMs in one project must not share positions. |
| Lower-cased keys | iRite identifiers are case-insensitive (AGENTS.md), so a case-only rename must not lose the layout. |
| Bar follows its source step until dragged | Moving a step otherwise leaves its transitions behind and forces a second drag per link. |
| Z-shaped automatic segments, straight next to bends | Keeps the Grafcet look without making bends meaningless; one rule that can be explained in a line. |
| `before`/`after` bend lists | A bend between the step and the bar must stay on that side of the bar when the bar moves. |
| One geometry function shared with the webview via `toString` | A duplicate in the webview would drift from the one the extension tests. `createGeometry` is self-contained; a test evaluates the shipped source and compares it with the direct call; also verified minified. |
| Save on drag end, 250 ms debounce, flush on dispose | Satisfies "debounced" without losing an edit made just before closing the tab. |
| Extension validates every message (`sanitizeDiagram`, `mergeSave`) | Webview content is untrusted: unknown names dropped, numbers rounded/clamped, counts capped, a payload that is not a layout changes nothing. |
| Keep saved entries for names not drawn now | A temporary rename or a parse error must not destroy a hand-made layout; Reset is the explicit clean-up. |
| Never overwrite an unparsable or newer-version sidecar | Refusing is recoverable, overwriting is not. The panel warns and shows the automatic layout. |
| Delete the file when the last diagram is reset | No empty file left behind. |
| Zoom/pan stored with `vscode.setState` | "Keep current zoom/pan": re-renders (file change, reset) used to reset the view. |
| Problems tied to the panel lifetime | The issue says "clear when the project is closed"; the extension has no other notion of an open project. Closed = the SFC tab is disposed. |
| Located diagnostics clickable in the webview list too | Same data, three lines. |
| Reset also as a command | The issue said "if cheap": it reuses the same function. |

## Acceptance criteria

| Criterion | How it is met | Evidence |
|-----------|---------------|----------|
| S1 Drag steps, bend points | Pointer handling in `sfcHtml.ts`; `geometry.route/insertBend` | tests `geometry > inserts a bend on the nearest segment...`, `mergeLayout > uses an explicit bar position and bend points...`, `renderSfcHtml editing support > marks every step and link...`; Chromium run (below) |
| S2 Saved, restored, reset | `sfcLayoutStore.ts`, `mergeLayout`, `SfcPanel.render/reset`, `irite.sfc.resetLayout` | tests `sfc layout store > saves, reloads...`, `> deletes the file when the last diagram is reset`, `> never overwrites a sidecar it cannot understand`, `mergeLayout > applies saved step positions...`, `> falls back to the automatic position...`, `> ignores and reports...`; mock-vscode smoke |
| S3 Problems with severity and file/line | `SfcProblems`, `groupSfcDiagnostics`, `toVsSeverityName` | tests `SFC diagnostic severities and codes`, `SFC diagnostic locations`, `groupSfcDiagnostics`; smoke. Clicking a Problems entry is native VS Code behaviour on a `Diagnostic` with a URI and range |
| S4 Pure, tested | no `vscode` import in `src/sfc/**` | test `purity > keeps src/sfc free of vscode imports` (scans the folder) |
| Existing behaviour | Mermaid and docs generators untouched | the 114 pre-existing tests still pass, including `src/docs` |

Checks run on the final tree: `npm run typecheck` clean, `npm test` 157 passed (12 files; 43 new), `npm run compile` ok, `node esbuild.mjs --production` ok.

## What could not be verified

- Real VS Code UI. Not exercised: the Problems panel rendering, click-through from a Problems row, `getWorkspaceFolder` with a real multi-root workspace, webview state persistence (`getState/setState`) across a real panel reload, real file-watcher timing.
- Instead (scratch scripts, deleted, not committed): the rendered page was driven in headless Edge (Chromium) with synthetic pointer events, 21 checks (drag step/bar/bend, add by double-click and Alt+click, remove by double-click and right-click, pan, wheel zoom, click-to-open, drag does not open, reset) at scale 1 and 0.35, normal and minified bundle, petri fixture and DOLE; and `dist/extension.js` was run against a hand-written `vscode` mock for the command/diagnostics/sidecar flow (21 checks). A mock encodes my reading of the API, so it does not replace a manual pass in the Extension Development Host.
- Touch and pen input, high-DPI, and a very large diagram's drag performance (each drag move redraws only the links of the dragged step).
- The `.vscode` sidecar is not git-ignored by this repo; whether projects want it committed is their choice.

## Refactor candidates / design notes for the reviewer

- `SfcPanel` now mixes rendering, persistence and message handling (about 200 lines). A small `SfcLayoutController` (load, merge, debounced save, reset) would make it unit-testable with a fake store.
- `src/commands/erd.ts` and `previewScreens.ts` still carry their own project-locating copy; only the SFC command moved to `locateProject.ts`.
- The webview script is a string template in `sfcHtml.ts`. It is covered by the headless-browser pass only; a committed browser test would need a dev dependency (Playwright), which the repo does not have.
- Diagnostics point at the enum declaration, not the member. Storing member lines in `IriteEnum` would sharpen `never-emitted` and `no-entry-routine`.
- `SfcProblems` tracks published URIs per project; two panels whose projects share a file would overwrite each other's entries for that file. Not expected with one `main.src` per project.
- `LayoutNode.moved` / `LayoutLink.before|after|barFixed` are optional fields on the auto-layout types so `layoutSfc` and its tests are unchanged; a dedicated `EditableLayout` type would be stricter at the cost of touching the HTML signature.
- Stale entries (renamed names) are kept forever until Reset; a "prune" action could be added if files grow.
- A webview `layout` message replaces the whole stored diagram for the drawn names, so two panels on the same project can overwrite each other's layout (the last save wins).
- Risk line for the whole feature: none of the high-risk items apply (no stored-data migration, no security boundary change, no changed public contract: the new command and message type are additive).
