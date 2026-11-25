ChangeLog
=========

#### Unreleased
- New **iRite: Regenerate main.iri from .rev** (explorer menu on `.rev`, and a button after saving in the screen and database schema editors) regenerates `main.iri` the way Revolution does, byte-identical on the DOLE sample, keeping a backup of the previous file (never overwritten); an identical file is left untouched. Not verified against Revolution v310.
- Fix (#19): label and monospace label widgets now preview their **justification** (Left / Right / Center) and **border** (Fixed single draws a 1 px frame, None draws none) in the preview, the screen editor and `rev-cli render`; label text is always vertically centered. Border color (black) and placement inside the box are unconfirmed on a 1280.
- Database schema edits enforce v308 designer name and count limits and show estimated sizes against its warning threshold; indicator limits and overhead remain unconfirmed.
- Database diagrams, Mermaid export and schema editing now show Revolution field type names; changing a type applies its designer default size. Numeric codes remain in `.rev`, unknown types stay read-only, and unchanged legacy sizes are preserved. Designer rules do not establish indicator acceptance; validate in Revolution and on a test indicator.
- Firmware image import now reports rejected image counts (not PNG, too large) and, when re-importing an existing version yields fewer usable images, keeps the current cache and shows a warning.
- Import 1280 built-in images from a user-supplied firmware update folder or rootfs.tar into global storage. Preview, editor and the type-7 image picker use the selected firmware and panel; reopen views after importing. Type-2 Bitmap retains its style selector. Generated screen SVGs and `rev-cli render --firmware-images <dir>` reference cached images by absolute file URI; firmware images are not shipped or copied into projects.
- New opt-in **iRite: Edit Database Schema** edits `.rev` database tables and fields with confirmation, backup, stale-file refusal, `ConfigHash` recomputation and readback validation. Shows `main.iri` regeneration hints without writing it; verify changes in Revolution and on a test indicator.
- After an uncertain database schema write, restore the backup before continuing; either database diagram command reloads the file without retrying the write and retains the recovery warning. Deferred watcher refresh can resume after editing ends when a save is cancelled or the draft is unchanged.
- The database ERD now supports opt-in schema editing: **Edit schema** is off by default, and **iRite: Edit Database Schema** opens the same diagram in edit mode. Without a `.rev`, the diagram remains available but editing is disabled. Apply table/column sends typed values to the draft; Revert unsent edits resets only unapplied values. Save requires pending values to be applied or reverted, blocks validation errors, confirms, backs up, refuses stale files, recomputes `ConfigHash`, writes atomically and validates readback. Unknown type codes remain raw and their columns cannot be edited. It shows `main.iri` hints without writing that file; schema changes can break existing code and DB access routines. Opening edited files in Revolution and loading them on an indicator remain unverified.
- Screen editor now edits whole widgets: a **palette** of all 1280 widget types (drag onto the canvas or click to add, Revolution's defaults), a **property inspector** with typed controls for every property, **delete** with a code-reference check (also on alias rename), Revolution's id rule (lowest free id, never renumbered) and default aliases, and the exact **`main.iri` constant lines** to add or update (the file is never edited). Saving changes only the edited, added or removed `WDGT` lines and **recomputes `ConfigHash`** (algorithm reproduced); backup and confirmation as before. Still unverified: opening an edited file in Revolution and loading it on a 1280.
- Preview and `rev-cli render` now draw every widget type (bitmap, chart, softkey, monospace label, numeric) instead of a grey box, and `rev-cli widgets` JSON includes the type name and the named properties (`props`, `catalogName`). The `.rev` reader now exposes geometry, screen and alias for all catalog types.
- New clean-room format reference `docs/rev-format.md` (widget/property tables, escaping, ids/aliases, `main.iri`, hash recipe, paint order).
- New opt-in **screen editor** (`iRite: Edit Screens`, a custom editor over `.rev` with priority "option"): move (drag, arrow keys, Shift = grid step), resize (handles), numeric x/y/w/h, snap with `irite.editor.snap` / `irite.editor.gridSize`, 12" view that edits in 7" pixels. Undo/redo/dirty/save/revert come from VS Code. Saving patches only the x/y/width/height of the edited `WDGT#n` lines (BOM, CRLF, order and every other byte are kept; no edits = no write). The first save of a session asks for confirmation and writes `main.rev.bak` (timestamped if it exists): `ConfigHash` is not recomputed and the result is unverified in Revolution. z-order and hide/show stay view-only. This is the first time the extension writes a `.rev`.
- New headless CLI `dist/rev-cli.js` (`screens`, `widgets`, `render` SVG), read-only, no dependencies, for agents and scripts.
- `iRite: Preview Screens` inspection upgrades (read-only, nothing is written to the `.rev`): 7"/12" panel selector with uniform widget scaling, a widget list synchronised with the canvas, hide/show per widget, preview-only bring-to-front / send-to-back, references grouped by file and routine (now including assignments and plain comparisons), screen names from `UiScreen` and the `WidgetClicked` entry point of each screen. Hidden widgets and z-order survive refreshes of the same panel.
- Fix: selecting or hovering a widget in the preview no longer lifts it above the others (a full-screen background hid every widget on its screen); selection is now an outline overlay.
- Generated `screens.md` now also lists references that are not call arguments (marked `(reference)`).
- New command `iRite: Show Call Map`: read-only, C4-style interactive map of how modules and routines call each other. Level 1 system (plus `.rev` scales, ports, DIO and databases), Level 2 modules grouped by folder with call-count edges (click an edge to list the calls with file:line), Level 3 routines with their callers and callees, breadcrumb, case-insensitive routine search, go to definition / call site, optional built-ins group and folder collapse.
- SFC diagram is now editable: drag steps and transition bars, add/move/remove bend points on lines (double-click or Alt+click a line), and the layout is saved to `.vscode/irite-sfc.layout.json` (keyed by step/transition name, never writes `.src`/`.iri`/`.rev`). `Reset layout` button and `iRite: Reset SFC Layout` command restore the automatic layout. Zoom/pan are kept across refreshes.
- SFC diagnostics now appear in the Problems panel (collection `irite-sfc`) with real severities (no target = Error, unreachable / never emitted = Warning, no entry routine = Information) and file/line; they are cleared when the SFC tab is closed.
- New DB access standard check: every `type X is database` table is expected to have `db<Table>Create/Read/Update/Delete/GetRecord/Get<Field>/Set<Field>/Search`; a Warning on the declaration lists the missing and pending routines. Quick Fix / `iRite: Scaffold DB Access Routines` appends stubs marked `-- TODO(irite-db): pending implementation` (never overwrites); `iRite: Export Pending DB Routines (JSON)` hands the list to an MCP/agent. Settings `irite.dbAccess.*`.
- New command `iRite: Generate Project Docs`: writes Markdown (index, ERD, SFC, screens with SVG wireframes, routines, module call map) to `docs/generated/`; never overwrites files without the generated marker.
- New command `iRite: Show Database Diagram`: ERD of the iRite databases merged with the `.rev` schema, with drift diagnostics and inferred relations.
- New command `iRite: Show Sequence Diagram (SFC)`: Grafcet-style diagram derived from the STATES/TRANSITIONS Petri state machine, with settings `irite.sfc.statesEnum`, `irite.sfc.transitionsEnum`, `irite.sfc.initialStep`.
- New command `iRite: Preview Screens` (also in the explorer and editor-title menus of `.rev` files): read-only webview of every 1280 screen with a widget inspector and links to the code that references each widget.
- Toolchain: VS Code ^1.85, TypeScript 5, esbuild bundle, vitest tests; removed unused dependencies and the dead formatter.
- Build/deploy commands now show an error instead of failing silently when no file is open.

#### 2.12.1
- Security updates. 

#### 2.12.0
- Security updates.  882D Snippets and highlighting added.  

#### 2.11.0
- SubmitDSPData snippet actually filled in SubmitData code, fixed.  Missing snippet for GetFBStatus.  

#### 2.10.1

- Added new API for getting the status of all DIOs on a given slot with one bitmasked integer.

#### 2.9.0

- Missing highlighting from recent changes

#### 2.8.0

- Added new snippets and highlighting for the new APIs

#### 2.7.1

- Security patches

#### 2.7.0

- Completely revamped the snippets for continuity and completeness.
- Added missing or incorrect snippet and autocomplete info.

#### 2.5.2

-   Update 1.33 to VSCode broke the extension. Can no longer compile the
    active window. No longer will try to search for .src just compile
    first one. Will work like used to now.  MUST HAVE .src file ACTIVE to
    compile.

#### 2.5.1

-   Fixed issue when multiple .src files are present in the
    folder/workspace only the first one alphabetically would compile.
    Now if only one exists will find and compile that one regardless of
    what file is active. If more than one src file is found in the
    folder it will compile the active window. User needs to make sure
    they have the correct .src file active when compiling.

#### 2.4.0

-   Fixed issue in which the console did not auto-scroll to the bottom
    so any compiler success/fail message as well as any compiler issues
    did not show.

#### 2.3.1

-   Fixed issue in which the compiler success/fail message as well as
    any compiler issues did not show in the console.

#### 2.2.0

-   Patched security flaw introduced by flatmap-stream malware.

#### 2.1.0

-   Fixed error when trying to build with only a file open.
    Workspace/folder is required.

#### 2.0.2

-   Autosaves all workspace files and selects the src before building.
    -   This allows autosaving to be turned off and initiating the build
        from any file AND any window.
        -   (No more trying to compile the output window or iri file)

#### 2.0.1

-   Added missing syntax colorization and snippets
-   Added more detailed description to each snippet
-   Added and fixed the tab to complete portions of each snippet
-   Complete revamp and expansion of Intellisense.

