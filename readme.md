iRite for Visual Studio Code
============================

This extension adds support for the iRite Language to Visual Studio
Code. It supports:

-   Syntax Colorization
-   Snippets
-   Preprocessing
-   Compiling
-   Deployment to Indicator
-   Opt-in database schema editing with backup and generated `main.iri` hints

Installation
============

Click on the Extension tab, and type in iRite. Click install and allow
VScode to restart. You now have syntax highlighting and snippets.

Compilation and Deployment
--------------------------

-   Ensure Revolution is installed:
    [Revolution](https://www.ricelake.com/en-us/products/product-details/revolution-scale-software#/resources-downloads "Revolution Scale Software")
-   Click the "iRite: Build" button, this will initally generate an
    irite.settings.json file in your directory

### Linux / macOS (via Wine)

Revolution only ships for Windows. On Linux/macOS the extension runs the
build engine through [Wine](https://www.winehq.org/) instead:

1.  Install Wine (Debian/Ubuntu also needs the 32-bit architecture, since
    the engine is a 32-bit .NET binary):
    ```
    sudo dpkg --add-architecture i386
    sudo apt update
    sudo apt install wine
    ```
2.  `iRite_preprocessor.exe` is a .NET assembly, so it also needs
    [wine-mono](https://dl.winehq.org/wine/wine-mono/) — Debian/Ubuntu
    don't package it, so install the `.msi` manually:
    ```
    curl -LO https://dl.winehq.org/wine/wine-mono/11.2.0/wine-mono-11.2.0-x86.msi
    wine msiexec /i wine-mono-11.2.0-x86.msi /qn
    ```
3.  Copy the Revolution `iRite Editor` folder (`iRite_preprocessor.exe`,
    its dependency DLLs — `rlws.dll`, `log4net.dll`, `newtonsoft.json.dll`,
    etc. — and the `Compilers` folder) into your Wine prefix at the same
    relative path as the Windows default, so the extension's default
    settings work without any changes:
    ```
    ~/.wine/drive_c/Program Files (x86)/Rice Lake Weighing Systems/Revolution/iRite Editor/
    ```
    You do not need the full Revolution installer or `iriteeditor.exe` —
    only `iRite_preprocessor.exe`, its DLLs, and `Compilers/` are required
    for `irite.build`/`irite.deploy`.
4.  If you place the toolchain somewhere else, update `irite.build.enginePath`
    and `irite.build.compilerPath` in your VS Code settings to match. On
    Linux, filesystem paths are case-sensitive — make sure the casing
    matches the files on disk exactly.

### Screen preview

Run **iRite: Preview Screens** from the Command Palette, or right-click a
`.rev` file in the explorer (or use the editor-title button on a `.rev`).
Without a `.rev` argument the extension looks for one next to the active
file (walking upwards) or in the workspace.

It shows every 1280 screen of the project (widgets from the `.rev`, images
from `sdimages/`), a screen selector and an "All screens" thumbnail grid.
The panel refreshes when the `.rev` or sources change.

-   **Panel size**: `7" 800x480` (default, the size `.rev` coordinates are
    authored for) or `12" 1280x800`. On 12" every widget is scaled by 1.6
    (uniform scale, so authored proportions are kept) and the leftover 32 px
    is drawn as a hatched letterbox band. Switching back restores 7".
-   **Widget list** (beside the canvas, below it on narrow views): every
    widget of the screen with id, type, alias, x/y/w/h and reference count.
    Selecting a row selects the widget on the canvas and vice versa. Hover and
    selection are drawn as an outline overlay, so selecting a full-screen
    background never hides the widgets above it.
-   **Hide / show** a widget with the eye icon to see what sits behind it;
    *Show all* restores the screen. **Bring to front / send to back**
    (arrow buttons) override the paint order to inspect stacking; *Reset order*
    restores it. All of this is **preview only**: it is kept per panel
    (`vscode.setState` and the extension's memory, so it survives refreshes)
    and is never written to the `.rev`.
-   **Code links**: click a widget to see its references grouped by file and
    routine (call arguments, `if`/`elsif` conditions and any other use, such as
    an assignment or a plain comparison); each one opens `file:line`. The screen
    header shows the screen name (from the `UiScreen` record assigned in
    `uiLoadSettingsUi`, as in the IPESAH projects) and the routine that
    `handler WidgetClicked` dispatches to for that screen (its entry point).

Limitations:

-   Read-only: the `.rev` and sources are never modified.
-   7" usable area is 800x388 px (800x480 panel minus a 92 px header). For
    12" the header height (92 x 1.6 = 147 px) and the position of the
    letterbox band are **assumptions**, not measured on a real 12" unit.
-   Paint order is assumed to be widget id ascending.
-   Some `.rev` fields are still unknown (e.g. label alignment); unknown
    widget types are drawn as hatched boxes.
-   Missing built-in images (`local://N.png`) and missing files are drawn as dashed
    placeholders until imported or provided.
-   Scales show a sample weight; screen names are not stored in the `.rev`,
    so they are read from the code convention above and screens are always
    identified by number too.

### Built-in firmware images

Run **iRite: Import 1280 Built-in Images from Firmware** and select a firmware
`update` folder or its `rootfs.tar`. Images are Rice Lake property and are not
shipped with this extension. They are cached in VS Code extension global storage
under `firmware-images/<firmwareVersion>/{default,7,12}/`, with a manifest.
The notification lists rejected images (not PNG / too large); a re-import of an existing version with fewer usable images keeps the current cache and warns.
Multiple versions coexist; `irite.firmware.imagesVersion` selects one (otherwise
the latest imported version). Reopen Preview Screens and the screen editor after
import. The image widget (type 7) picker includes numbered built-ins and
`sdimages/` files; Bitmap (type 2) retains its style selector, not a file picker.
The panel variant is preferred, followed by default and the other panel.

### Screen editor (opt-in, writes the `.rev`)

Right-click a `.rev` and choose **iRite: Edit Screens** (or "Open With..." >
"iRite: Edit Screens"). It is never the default editor of `.rev` files.

-   **Palette:** a toolbox lists every widget type the 1280 supports (the
    legacy numeric type is listed but cannot be created). Drag an item onto the
    canvas to add a widget at the drop point (snap applies) on the current
    screen, with Revolution's default size, caption and colours; clicking an item
    adds it at a default position. A new widget gets the lowest free id
    (starting at 1; ids of widgets deleted in the same session stay reserved
    until you save) and a default alias (`lbl4`, `bar7`, ...). Existing ids are
    never renumbered.
-   **Property inspector:** the selected widget shows all its properties with
    typed controls (lists for enumerations, color input, numbers with ranges,
    text, image path with the `sdimages/` files suggested). The alias must be an
    iRite identifier of at most 8 characters and unique; captions are at most 64
    characters and cannot contain commas.
-   **Delete** (Delete key or button): before a widget is deleted or its alias
    renamed, the editor lists the code references (reuse of the preview's
    reference index) and warns when the alias is used in code.
-   **`main.iri` hint:** the extension never edits `main.iri`. After adding,
    renaming or deleting widgets the panel shows the exact constant lines to add
    or update (the format Revolution generates), or regenerate `main.iri` in
    Revolution.
-   Drag a widget, use the arrow keys (1 px; **Shift**: one grid step), drag the
    resize handles, or type x / y / w / h. **Snap** and the grid size
    (`irite.editor.snap`, `irite.editor.gridSize`) are in the toolbar.
    Scale (type 1) and symbol (type 6) widgets store no size: only x and y.
    Full-screen backdrops are not draggable on the canvas (use the fields or
    the arrow keys) so they are not moved by accident.
-   Everything is edited in 7" pixels. On the 12" view the pointer movement is
    converted back to 7" pixels.
-   Undo, redo, the dirty marker, save and revert are the standard VS Code ones.
-   Saving changes only the `WDGT#n` lines you edited, added or removed (one
    line per affected widget) and, because the `Config` text changed, the
    `ConfigHash` header line. BOM, CRLF, key order, widget ids, line order, other
    lines and `<Printers>` are kept. Saving without edits does not touch the
    file.
-   Z-order buttons (front, back, one step) and hide/show are **view only** and
    are not saved: Revolution paints in widget id order and the ids are the
    constants of the generated `main.iri`, so they are never renumbered.
-   **Integrity hash:** `ConfigHash` is recomputed on every save that changes
    the widgets (SHA-1 of the UTF-16LE `Config` text; the recipe reproduces the
    stored hash of files Revolution wrote). **Still unverified:** that Revolution
    opens an edited file without complaint and that a 1280 loads it. The first
    save of a session asks you to confirm and copies the file to `main.rev.bak`
    (a timestamped name when that exists) first. Open the saved file in
    Revolution before loading it on an indicator, and keep the backup until you
    have. Restore with: copy the `.bak` over the `.rev`.
-   A save is refused when the file changed on disk since it was opened.

#### Headless CLI (for agents and scripts)

`dist/rev-cli.js` (bundled with the extension, no dependencies, read-only):

```
node rev-cli.js screens <file.rev>
node rev-cli.js widgets <file.rev> [--screen n] [--panel 7|12]
node rev-cli.js render  <file.rev> --screen n [--panel 7|12] [--out screen.svg] [--firmware-images <dir>]
```

`screens` and `widgets` print JSON (type name, named properties `props`, boxes,
panel boxes, overlaps, out-of-bounds); `render` prints an SVG with the same panel geometry, widget
boxes and paint order as the preview. An MCP tool can run it as a subprocess and
read stdout (for example `node <extension>/dist/rev-cli.js widgets main.rev
--screen 2`). PNG is not produced (it needs a rasterizer dependency); convert
the SVG with any tool, for example a browser or `rsvg-convert`. The optional
firmware directory is either the `firmware-images` cache root or a specific
version directory. An explicitly supplied directory must contain a usable image
cache or render fails. Missing images in a usable cache remain placeholders.
Rendered built-ins use absolute `file:` URIs, not copies;
viewers may restrict local file access and the SVG is not portable without the
cache. Generated project documentation uses the selected cache's 7-inch variant
in the same way; regenerate it after importing.

### Database schema editor (opt-in)

Run **iRite: Show Database Diagram** for a project containing `main.src`.
The diagram opens read-only with **Edit schema** off; enable it to edit the
project's `.rev` database schema in the diagram. **iRite: Edit Database Schema**
opens the same ERD in edit mode. Without a `.rev`, the diagram remains available,
but schema editing is disabled with a message.

Add, rename or delete tables; edit record limits; and add, rename, delete or
reorder columns and edit their type and size. Unknown type codes are preserved
as raw values and their columns cannot be edited. Use **Apply table** or
**Apply column** to send typed values to the draft. **Revert unsent edits**
only resets values not yet applied; it does not undo changes already in the
draft. Apply or revert pending values before other actions, switching modes or
saving. Validation errors appear in the view and block **Save**.

**Save** explicitly writes the draft: it asks for confirmation, backs up the
original, refuses a stale file, recomputes `ConfigHash`, writes atomically and
checks the schema by reading it back. Saving with no changes reports that fact.
The editor never writes `main.iri`: after saving, regenerate it in Revolution
or use the displayed declarations and constants. Renames, deletions and field
order changes can break existing code and DB access routines; review both.
Limits and type/size combinations remain unconfirmed. Opening an edited file in
Revolution and loading it on an indicator remain unverified; check both before
production and keep the backup.

### Database diagram (ERD)

Run **iRite: Show Database Diagram** from the Command Palette. The extension
finds the project's `main.src` (next to the active file, walking upwards, or
in the workspace), reads every `type X is database ("Alias") ... end database;`
and the `DB.SCHEMA`/`DB.ALIAS` entries of the `.rev` next to it, and draws one
card per table with field types, string sizes and record limits.

-   Fields or tables that exist only in the code or only in the `.rev` are
    listed as diagnostics (schema drift).
-   iRite has no foreign keys: dashed relations are *inferred* from field
    names (`CustID` -> `Customer.Id`, a field equal to another table's key).
-   Click a table header to open its declaration. Wheel zooms, drag pans.

### Sequence diagram (SFC / Grafcet)

Run **iRite: Show Sequence Diagram (SFC)**. It derives a PLC-style Grafcet
from the Petri state machine convention:

-   Steps are the members of the `STATES` enum; transitions are the members of
    `TRANSITIONS` (sentinels `NullState`/`NullTransition` are skipped).
-   A transition's target comes from `SetState(..., X)` under
    `CurrentTransition = T`; its source steps come from where
    `CmdSetTransition` / `SetHandlerTransition` / `CmdSetTransitionFromHandler`
    emit it (inside a step's `Cmd*` entry routine or under a `= Step` guard).
    Transitions emitted without a step guard are drawn in a "from any step"
    lane.
-   Diagnostics flag unreachable steps and transitions without target or
    never emitted. They are also published to the **Problems** panel
    (source `iRite SFC`) while the diagram is open, with the file and line
    when known; click one to open it. Severities: transition without target =
    Error; unreachable step / transition never emitted / enum missing /
    conflicting targets = Warning; step without entry routine = Information.
    Entries without a location are attached to `main.src` line 1. The
    entries are refreshed when the sources change and removed when the
    diagram tab is closed.
-   Click a step to open its entry routine, a transition to list the code
    that emits it.

Settings: `irite.sfc.statesEnum`, `irite.sfc.transitionsEnum` (enum names,
default `STATES` / `TRANSITIONS`) and `irite.sfc.initialStep` (default: a step
named Standby/Idle/Init, else the first one).

#### Editing and saving the SFC layout

The automatic layout can be refined by hand; the sources are never touched.

-   **Drag** a step or a transition bar to move it. A step takes its outgoing
    bars with it unless a bar was positioned by hand.
-   **Bend points**: double-click (or Alt+click) a line to add one, drag it to
    route the line, double-click or right-click it to remove it.
-   Zoom (wheel) and pan (drag the background) work as before and are kept
    when the diagram refreshes.
-   The layout is saved automatically to `.vscode/irite-sfc.layout.json` in
    the workspace folder of the project (next to `main.src` when there is no
    workspace folder), keyed by step / transition name (case-insensitive), so
    it survives reopening and can be committed. New steps or transitions use the
    automatic layout; entries for names that no longer exist are ignored,
    listed in the side panel and kept in the file until you reset.
-   **Reset layout** (button in the side panel, or the command
    **iRite: Reset SFC Layout**) deletes the saved layout of that diagram.
-   If the layout file is invalid or written by a newer version, the diagram
    shows the automatic layout, says so in the side panel and does not
    overwrite the file.

The ERD is read-only until schema editing is enabled; the SFC layout editor
never writes the sources or `.rev`. Both diagrams refresh when the sources or
`.rev` change.

### Call map (modules and routines)

Run **iRite: Show Call Map**. It answers *how do the modules talk to each
other?* with a read-only, C4-style map you drill into by clicking. It is built
from the call sites the parser finds, starting at `main.src` and following
`#include`.

-   **Level 1, System**: the program and, when a `.rev` sits next to
    `main.src`, its neighbours (scales, EDP ports, digital I/O, databases).
    Click a neighbour to list its entries; click the program to continue.
-   **Level 2, Modules**: one node per included `.iri` that declares routines
    (`main.src` and declaration-only files such as the generated `main.iri` are
    not drawn), grouped in frames by folder. An arrow is "caller module calls
    callee module" and carries the number of calls. Hover a module to highlight
    its calls, click an arrow to list every call behind it (caller routine ->
    callee routine, `file:line`), click a module to open Level 3.
    **Collapse to folders** turns each folder into one node.
-   **Level 3, Routines**: the routines of the module, the modules that call
    into it on the left and the modules it calls on the right (one box per
    module). Click a routine to highlight its callers and callees and see them
    in the side panel; click another module to open it. Double-click a routine
    to open its declaration.
-   **Breadcrumb** (`System > Modules > module > routine`) goes back to any
    level. **Find a routine** is case-insensitive (iRite identifiers are) and
    selecting a result shows its callers, callees and the modules involved.
-   **Go to definition** and every `file:line` link open the file at that
    line; only files of the loaded project can be opened.
-   Calls to names the project does not declare (built-in API such as
    `SelectScreen`) are hidden; **Show built-ins** adds one collapsed
    "built-ins" node. A forward declaration resolves to its implementation.
    Parameterless calls (`Foo;`) are only detected for routines the project
    declares.

Wheel zooms, drag pans; the map refreshes when sources or the `.rev` change
and keeps the level you were on. It never writes `.src`, `.iri` or `.rev`.

### Database access routines (IPESAH standard)

Every `type X is database ("Table") ... end database;` is expected to come with
a fixed set of routines (the first field is the key; every routine returns a
`SysCode`; `db` is the configurable prefix):

| Group | Routine |
| --- | --- |
| `crud` | `dbTableCreate(<all fields>)`, `dbTableRead(key)`, `dbTableUpdate(<all fields>)`, `dbTableDelete(key)` |
| `record` | `dbTableGetRecord(key; var vRecord: TableDatabase)` |
| `getters` | `dbTableGet<Field>(key; var vValue: <type>)` per field |
| `setters` | `dbTableSet<Field>(key; value: <type>)` per field |
| `search` | `dbTableSearch(sColumn: string; sValue: string; var vResult: integer)` |

-   A Warning on the `type ... is database` line lists the missing routines
    (`Table Trans: missing routines dbTransGetNetW, ...`). Adding a field adds
    its getter and setter to the list. Names are matched case-insensitively.
-   Quick Fix **Scaffold N missing DB routine(s)** (or **iRite: Scaffold DB
    Access Routines**) appends compilable stubs to `src/db/<Table>.iri` and adds
    `#include src\db\<Table>.iri` to `main.src` right after the file that
    declares the table (skipped when already present). Existing routines are
    never overwritten or duplicated. Each stub returns `SysInvalidRequest`
    and carries `-- TODO(irite-db): pending implementation`; the warning
    stays until that line is removed. Check that callers come after the
    module in the `#include` order.
-   **iRite: Export Pending DB Routines (JSON)** writes
    `.irite/db-pending.json` (schema `irite.dbAccess.pending`, `version: 1`):
    one item per missing/pending routine with table, field, group, routine,
    signature, description, status, stub file/line and scaffold target. Another
    extension or an MCP can call the command `irite.dbAccess.exportPending`
    with `{ "mainSrc": "<path>" }` to get the same JSON back without writing.

Settings: `irite.dbAccess.enabled`, `severity` (default Warning),
`routinePrefix` (default `db`), `exclusions` (`"Settings"`, `"Settings:search"`,
`"*:setters"`), `moduleFolder` (default `src/db`) and `exportPath`.

### Project documentation

Run **iRite: Generate Project Docs**. It writes Markdown documentation of the
project (the folder of `main.src`) to `docs/generated/`:

-   `index.md`: summary (files in include order, counts, links, generation
    timestamp and extension version).
-   `erd.md`: database diagram (Mermaid `erDiagram`), a table per database and
    drift diagnostics. Relations are inferred from field names.
-   `sfc.md`: SFC flowchart (Mermaid), steps and transitions tables with
    `file:line` links.
-   `screens.md` and `screens/screen-<n>.svg`: widget tables per screen and an
    approximate SVG wireframe.
-   `routines.md`: handlers, procedures and functions per file.
-   `callmap.md`: module-to-module call map (Mermaid `flowchart`, one subgraph per
    folder, edges labelled with the call count) and a table with every call site.
    `routines.md` links to it.

Every generated file starts with the marker
`<!-- Generated by iRite extension: do not edit; regenerate with "iRite: Generate Project Docs" -->`.
Files in `docs/generated/` that exist **without** the marker are never
overwritten: they are skipped and reported. Nothing else is deleted, and the
`.rev` and the iRite sources are never written.

The Mermaid diagrams only render in a Markdown preview with Mermaid support
(for example GitHub, or a VS Code Markdown preview extension that adds
Mermaid); the built-in VS Code preview shows them as plain code blocks.

### irite.settings.json

Defaults are established on build, but must be modified for which
indicator you are deploying to. \* method: TCP, RS232 \* indicator:
1280, 920, 880, 820 \* ipaddress: If using TCP connection \* tcpport: If
using TCP connection \* comport: If using RS232 \* baudrate: If using
RS232 \* databits: If using RS232 \* parity: If using RS232 \* stopbits:
If using RS232

Deployment
==========

-   Ensure the irite.settings.json file has been modified to your system
    specs and then click iRite: Deploy
