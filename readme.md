iRite for Visual Studio Code
============================

This extension adds support for the iRite Language to Visual Studio
Code. It supports:

-   Syntax Colorization
-   Snippets
-   Preprocessing
-   Compiling
-   Deployment to Indicator

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
Hover or click a widget to see its id, type, alias, geometry, raw fields and
the code (`main.src` and its `#include`s) that references its alias; click a
reference to open it. The panel refreshes when the `.rev` or sources change.

Limitations:

-   Read-only: the `.rev` and sources are never modified.
-   Screen size is assumed to be 800x388 px (usable area); the real panel
    may include a fixed header.
-   Paint order is assumed to be widget id ascending.
-   Some `.rev` fields are still unknown (e.g. label alignment); unknown
    widget types are drawn as hatched boxes.
-   Built-in images (`local://N.png`) and missing files are drawn as dashed
    placeholders.
-   Scales show a sample weight; screen names are not stored in the `.rev`,
    so screens are identified by number.

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

Both diagrams are read-only and refresh when the sources or `.rev` change.

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
