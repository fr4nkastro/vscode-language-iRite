ChangeLog
=========

#### Unreleased
- SFC diagram is now editable: drag steps and transition bars, add/move/remove bend points on lines (double-click or Alt+click a line), and the layout is saved to `.vscode/irite-sfc.layout.json` (keyed by step/transition name, never writes `.src`/`.iri`/`.rev`). `Reset layout` button and `iRite: Reset SFC Layout` command restore the automatic layout. Zoom/pan are kept across refreshes.
- SFC diagnostics now appear in the Problems panel (collection `irite-sfc`) with real severities (no target = Error, unreachable / never emitted = Warning, no entry routine = Information) and file/line; they are cleared when the SFC tab is closed.
- New DB access standard check: every `type X is database` table is expected to have `db<Table>Create/Read/Update/Delete/GetRecord/Get<Field>/Set<Field>/Search`; a Warning on the declaration lists the missing and pending routines. Quick Fix / `iRite: Scaffold DB Access Routines` appends stubs marked `-- TODO(irite-db): pending implementation` (never overwrites); `iRite: Export Pending DB Routines (JSON)` hands the list to an MCP/agent. Settings `irite.dbAccess.*`.
- New command `iRite: Generate Project Docs`: writes Markdown (index, ERD, SFC, screens with SVG wireframes, routines) to `docs/generated/`; never overwrites files without the generated marker.
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

