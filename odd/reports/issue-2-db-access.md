# Report — issue #2: standard per-table DB access routines

Branch `feat/issue-2-db-access`. Feature doc: `odd/tasks/issue-2-db-access.md`.

## What was implemented

| Area | Files |
| --- | --- |
| Pure logic (no `vscode`) | `src/dbaccess/convention.ts` (the whole convention), `check.ts` (compare + message), `scaffold.ts` (stubs, include planning), `json.ts` (hand-off), `index.ts` |
| vscode layer | `src/commands/dbAccess.ts` (diagnostics, Quick Fix, 2 commands), `src/commands/locateProject.ts` (shared helpers), `src/extension.ts` (registration) |
| Contributes | `package.json`: commands `irite.dbAccess.scaffold`, `irite.dbAccess.exportPending`; settings `irite.dbAccess.{enabled,severity,routinePrefix,exclusions,moduleFolder,exportPath}` |
| Tests | `test/dbaccess/dbaccess.test.ts` (20), fixture `test/fixtures/dbaccess/` (trimmed from DOLE's `main.iri` DB declarations; DOLE is never referenced) |
| Docs | `readme.md` section, `CHANGELOG.md` (Unreleased) |

Behavior: for each table the expected set is derived from the declaration, compared with the project's routines (case-insensitive name match), and one diagnostic per incomplete table is anchored on the `type T is database` line (`Table Trans: missing routines a, b, ... (+N more); pending implementation: c`). It refreshes on activation, open, save, file-system change and configuration change. A Quick Fix (only when something is missing) and `iRite: Scaffold DB Access Routines` append stubs. `iRite: Export Pending DB Routines (JSON)` writes `.irite/db-pending.json` and returns the JSON.

## Convention (key = first field; every routine returns `SysCode`; prefix `db`)

| Group | Routine |
| --- | --- |
| crud | `dbTCreate(all fields)`, `dbTRead(key)`, `dbTUpdate(all fields)`, `dbTDelete(key)` |
| record | `dbTGetRecord(key; var vRecord: TDatabase)` |
| getters | `dbTGet<F>(key; var vValue: <type>)` per field |
| setters | `dbTSet<F>(key; value: <type>)` per field |
| search | `dbTSearch(sColumn: string; sValue: string; var vResult: integer)` |

## Decisions on the issue's open decisions, and why

1. **Naming**: `db` + table alias + operation. DOLE already names DB routines `dbSetIsSensor`, `dbDeleteInboundRegister`, `dbGetSettingsBPC`; the issue's bare `TransGetInWeight` would not match any existing code. Prefix is configurable (empty reproduces the issue's names). The alias (`"Trans"`) is used rather than the type name (`TransDatabase`) because it is the table name and the base of the `Trans_Field` constants; the type name minus `Database` is the fallback.
2. **Signatures**: scalar parameters in Hungarian style (`iId`, `rInWeight`) as in the house code; `var` outputs (documented copy-in/copy-out) instead of returning values, so every routine can return a DB status code like the built-ins do, and so no unverified feature (returning a database record) is needed. Create/Update take every field because assigning whole database records is not documented.
3. **Search**: one routine, `Search(sColumn, sValue, var vResult)`; `vResult` is the `DBExec` handle (caller finalizes), matching DOLE's `dbGetPage`. Per-field `FindBy<Field>` was not added: it multiplies the required set with little gain.
4. **Module location**: one module per table, `src/db/<Table>.iri`. Avoids editing hand-written files (DOLE has a hand-written `db/main.iri`), makes "never overwrite or duplicate" trivial (append-only, checked by name), and a table module only depends on the DB type (declared in the generated root `main.iri`). The include is inserted right after the include of the file that declares the table (else after the last include), idempotent, only when the user triggers the scaffold, and reported in the notification. Callers must come after the module in the include order (documented).
5. **Settings**: enabled (true), severity (Warning), prefix, exclusions (`Table`, `Table:group`, `*:group`; a bare `*` is ignored on purpose so it cannot silently disable the check), moduleFolder, exportPath.
6. **Pending marker**: `-- TODO(irite-db): pending implementation`, matched case-insensitively on any line of the routine body; a routine with it is `pending` and the warning stays.
7. **Stub body**: `return SysInvalidRequest;` (no "not implemented" SysCode exists), so an unimplemented stub fails loudly rather than reporting success.
8. **JSON**: schema `irite.dbAccess.pending`, `version: 1`, paths relative to the project. Command returns it; it writes the file only from the palette/menu (or `write: true`), never for a programmatic call with an object argument.
9. **Cross-check with `DB.SCHEMA`**: not done; the source declaration is the single source of truth here (see not verified/limits).

## Acceptance criteria

| Criterion | Where it is satisfied | Test |
| --- | --- | --- |
| One warning per table with missing routines, listing them | `checkDbAccess` + `formatTableMessage`; one diagnostic per table in `dbAccess.ts` | `reports every table; missing vs pending...`, `every table with missing routines is reported...`, `lists missing and pending routines and truncates` |
| Full set gives no warning | empty `items`, empty message | `produces no items for a table with the full routine set` |
| Adding a field makes getter/setter missing | expected set derived per field | `adding a field to the table makes its getter and setter appear as missing` |
| Scaffold: compilable stubs, marker, no overwrite | `renderStub`, `applyScaffold` (append-only, name check) | `stubs carry the pending marker...`, `appends only missing routines...`, `creates a new module... idempotent`; compile verified manually (below) |
| Machine-readable pending list | `buildPendingJson`, `irite.dbAccess.exportPending` | `lists missing and pending items with a version field...`, `omits complete and excluded tables` |
| Pure logic outside vscode, vitest with DOLE fixture | `src/dbaccess/*` imports no `vscode` | whole file; fixture trimmed from DOLE |

Warning severity, exclusions, pending-until-marker-removed and case-insensitive matching also have tests (`honors exclusions...`, `a routine stays pending until the marker is removed`).

## Verification

- `npm run typecheck`: clean. `npm test`: 8 files, 114 tests pass (94 existing + 20 new). `npm run compile`: bundle ok.
- RED observed first (module did not exist, suite failed to load), then GREEN.
- Real compiler: stubs for Trans, Vehicles and Settings (31 stubs, including `var <TableDatabase>` parameters) generated by `applyScaffold` into a scratch copy of the fixture and built with `iRite_preprocessor.exe`: `Compile Successful`. (An empty `begin end main;` is a syntax error in this compiler; the scratch `main.src` got one statement. Not related to the feature.)
- Smoke of the bundled `dist/extension.js` with a mocked `vscode` module: commands registered, diagnostics on the right lines, Quick Fix titles, JSON, scaffold + include edit, diagnostic switching from missing to pending.

## Not verified / limits

- Not run inside a real VS Code window (no Extension Development Host in this environment): Quick Fix UI, notification, QuickPick for several tables, and refresh timing are covered only by the mock smoke.
- Not run against DOLE itself (read-only reference; only trimmed declarations were copied into the fixture).
- Signature mismatches are not detected: a routine with the right name but different parameters counts as present, so adding a field does not flag `Create`/`Update` as outdated.
- `DB.SCHEMA` cross-check (issue scope note) is not implemented; `src/erd/` already reports drift.
- The stub bodies are not real implementations by design; the `Expected:` comment above each stub is the hand-off description for an agent.
- The `.rev` is never read or written by this feature.

## Refactor candidates / design notes for the reviewer

- `src/commands/locateProject.ts` duplicates logic that `erd.ts`, `sfc.ts`, `docs.ts` and `previewScreens.ts` each still carry; those could switch to it (not done to keep this change additive).
- `convention.ts` is the single place to change names/signatures, but `renderStub` bodies are all `return SysInvalidRequest;`; if real templates are wanted later they belong next to `deriveExpected` per operation.
- Diagnostics re-parse every `main.src` in the workspace on each refresh (debounced); fine for current project sizes, a per-project cache keyed by file mtimes would be the next step.
- `check.ts` finds routines by name only; a stricter check could compare `params`/`returnType` with the expected signature.
- Table module naming sanitizes the alias to `[A-Za-z0-9_]`; two aliases that collapse to the same name would share a file (stubs are still name-checked, so no duplicates).
- The Quick Fix target lookup uses an in-memory map from the last refresh; if the file changes before the next refresh the action is simply absent until it runs.
- The exclusions syntax (`Table:group`) is a string DSL for simplicity; an object-valued setting would be easier to validate in the settings UI.
- Pending detection is textual (marker regex over the routine's lines).
