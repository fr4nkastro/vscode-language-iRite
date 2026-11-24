# Issue #2 — standard per-table DB access routines with missing-implementation warnings

Objective: detect, warn, scaffold and hand off the standard DB access routines of every `type X is database` table. Branch `feat/issue-2-db-access` (from `feat/visualizers`). Test runner: vitest (`npm test`); checks: `npm run typecheck`, `npm test`, `npm run compile`. Delivery strategy: `ask-on-risk`, 2 code slices + docs.

## Specs
- S1 — "Opening a project shows one warning per table with missing standard routines, listing them."
- S2 — "A table with the full routine set produces no warning."
- S3 — "Adding a field to a table makes its getter/setter appear as missing."
- S4 — "The scaffold action creates compilable stubs with the pending marker and does not overwrite existing routines."
- S5 — "Pending items are available in a machine-readable form for an MCP/agent."
- S6 — "Pure detection logic lives outside `vscode` imports and is covered by vitest using the DOLE fixture."
- S7 — "No automatic code generation without the user triggering it." (scope) and "The extension only reads `.rev` (unchanged)".
- S8 — Existing commands and behavior stay intact.

## Tasks
- [x] T1 — Pure module `src/dbaccess/` (convention, check, scaffold, json) + 20 vitest tests + trimmed DOLE fixture (S1-S6). Route: inline. Risk: none. Commit: 88707c4
- [x] T2 — vscode wiring: diagnostics, Quick Fix, `irite.dbAccess.scaffold`, `irite.dbAccess.exportPending`, settings, readme, changelog (S1, S4, S5, S7, S8). Route: inline. Risk: none (adds commands/settings only; no existing option touched). Commit: fa72069
- [x] T3 — ODD doc + reviewer report + AGENTS.md layout note. Route: inline. Commit: see git log (`docs(odd)`)

## Log
- L1 (user, original request): GitHub issue #2 "feat(db): standard per-table access routines with missing-implementation warnings" — https://github.com/fr4nkastro/vscode-language-iRite/issues/2 . User gave green light to pick the most recommended option for every open decision.
- L2 (decision): prefix `db` + table alias (`dbTransGetInWeight`), not the issue's bare `TransGetInWeight`: the house style and DOLE name database routines `db*` (`dbSetIsSensor`, `dbDeleteInboundRegister`). Prefix is a setting, empty gives the issue's literal names.
- L3 (decision): all routines return `SysCode`; outputs through `var` (documented iRite copy-in/copy-out); stubs return `SysInvalidRequest` (no "not implemented" code exists in the SysCode catalog) so an unimplemented stub fails loudly.
- L4 (decision): one module per table `src/db/<Table>.iri`; scaffold appends only missing routines and adds the `#include` after the file declaring the table (idempotent, only on the explicit user action).
- L5 (evidence): stubs for the 3 fixture tables (Trans, Vehicles, Settings: 31 stubs) compiled with the real Rice Lake preprocessor on a scratch copy: `Compile Successful`. Scratch copy only; DOLE untouched.
- L6 (evidence): vitest 114/114 (20 new), typecheck clean, esbuild bundle ok. Mock-`vscode` smoke of `dist/extension.js`: 2 commands registered, diagnostics on the declaration lines, Quick Fix titles, JSON v1 with 22 items, scaffold wrote module + include and the warning changed from missing to pending.
