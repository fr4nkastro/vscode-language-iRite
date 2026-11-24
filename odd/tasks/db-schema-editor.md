# iRite database schema editor

Opt-in `.rev` write-back on `feat/db-schema-editor` from `335b9eb`. Local commits only. Risk: item 1 (persisted indicator configuration).

## Specs

- S1 Pure model (no vscode import, vitest-testable) under `src/dbschema/`: parse the DB tables from a parsed rev, apply edits (add/rename/delete table, set max records, add/rename/delete/reorder field, change type and size), validate, and serialize back to `DB.SCHEMA#n=<maxRecords>,0,(<field>,<typeCode>,<size>)*` and `DB.ALIAS#n=<Name>` lines.
- S2 Lossless: a `.rev` with no edits round-trips byte-for-byte. Lines and tables that were not edited keep their original tokens and bytes. New tables get the lowest free index; existing indexes are never renumbered. New lines go inside the existing DB block in Revolution's order (see docs/rev-format.md family order: the database family sits after analog out and before comm ports). Recompute `ConfigHash` with `src/rev/configHash.ts`.
- S3 Type codes: DOLE evidence (`~/Documents/localdev/IPESAH/DOLE/main.rev` vs `main.iri`, read-only, never modify DOLE): code 1 size 1 -> Integer (TypeWgt), 2 size 2 -> Integer, 3 size 4 -> Integer, 4 size 4 -> Real, 7 size N -> String, 6 size 19 -> String (OutDT). Establish the real enum and the size rules from the clean-room evidence sources already used in docs/rev-format.md ([REA]/[IL]/[SAMPLES]); record only facts, no copied code. Anything not proven stays UNCONFIRMED in the doc and the editor must keep unknown codes as raw tokens and never rewrite them. Add a "Database" section to docs/rev-format.md.
- S4 Validation rules (block save with a clear message): table names and field names unique (case-insensitive, iRite identifiers are case-insensitive), valid iRite identifiers, max lengths and max field count / max records per the evidence (UNCONFIRMED limits are warnings, not blocks), at least one field per table.
- S5 UI: an opt-in command `iRite: Edit Database Schema` (`irite.editDatabaseSchema`) opening a webview editor for the project's `.rev` (reuse the project locator in `src/commands/locateProject.ts`). Table list, field grid (name, type, size, order), max records. Save follows the screen editor's flow: backup first, save plan with post-check (re-parse the written file and compare the DB model), `ConfigHash` recomputed. Keep the vscode-bound part thin (`src/commands/dbSchemaEditor.ts`); everything else pure.
- S6 `main.iri` sync: do NOT write `main.iri` (Revolution generates it). After a save, show the `type <Name>Database is database ("<Name>") ... end database;` block and the `<Table>_<Field> : constant integer := n;` constants the user must regenerate/paste, like `src/editor/iriHint.ts` does for widgets, and warn that `src/dbaccess` routines and existing code using renamed/deleted fields will break (dbaccess diagnostics will flag missing routines).
- S7 CRLF: real `.rev` files are CRLF. Known issue: the `.rev` and DB parsers currently fail on CRLF inputs (14 failing tests in rev.test.ts / dbaccess.test.ts on Windows checkouts). Fix the parsing so CRLF and LF both work, and add CRLF fixtures and a CRLF round-trip test for the schema editor.
- S8 Docs: update AGENTS.md (Project Shape + the "only reads .rev" statements), readme.md feature list, CHANGELOG.md (Unreleased), package.json contributes (command + activation if needed).

## Tasks

- [x] T1 — S7, except schema editor round-trip: parser and fixtures. Route: worker. Commit: `3ab8c78`.
- [ ] T2 — S3: observed evidence documented in `8a004ea`; complete REA/IL enum and limits unconfirmed. Route: explorer then worker.
- [x] T3 — S1, S3–S4: editable DB model and validation. Route: worker. Commit: `54e3161` (serialization proof in T4).
- [x] T4 — S2, S5, S7: lossless serializer, save plan and round-trip checks. Route: worker + independent verifier. Commit: `c0b9d26`.
- [x] T5 — S5–S6, S8: webview, command, generated hints and docs. Route: worker + independent verifier. Commits: `81538d8`, `0a0dd45`. Live VS Code interaction not exercised.
- [ ] T6 — S1–S8: foreground checks and targeted independent verification passed; native review blocked on candidate-specific consent. Route: worker and verifier. Commit: this ODD evidence commit.

## Log

- L1 (user, Goal verbatim): Add an opt-in database schema editor to the iRite VS Code extension: create, rename and delete tables and fields in the `.rev` file's `DB.SCHEMA#n` / `DB.ALIAS#n` lines (table alias, max records, field name, type, size, field order), the way Revolution's database designer does, with backup first and `ConfigHash` recomputed on save. Today the extension can only read these lines (ERD, dbaccess); the screen editor only writes `WDGT` lines.
- L2: Delivery strategy `feature-branch-chain`; no human available for delivery-choice prompts, and no remote delivery authorized. No scratch deletion.
- L3: T1 reproduced 14 failures (13 double-CRLF fixture conversions, one LF-only scaffold assertion); valid CRLF and LF already parse. After fixing fixtures and adding parity coverage, 46 focused tests and typecheck passed.
- L4: DOLE cross-check confirms the observed S3 mappings. No authorized reachable REA/IL DB findings established the full enum or limits; documentation does not promote sample observations to universal limits.
- L5: T3 passed typecheck and 4 tests; RED was missing-module failure. Preserve raw field triples by source provenance in T4.
- L6: T4 single-file Vitest timed out at 120 s; not retried. Expanded GREEN 10 tests. Independent probes found observed code-1 classification, malformed keys and reserved words; regression RED 4 failures, GREEN 15 tests and typecheck. Scratch retained: `/tmp/gpzbAa3r/gapJM5ze/tmp.wJO1a7IE1a`.
- L7: T5 initial focused GREEN 7 tests and typecheck; independent probes found first-table insertion without EDP and exact readback gaps. Regression RED 2 failures, GREEN 15 tests and typecheck. Scratch retained: `/tmp/gpzbAa3r/gahkYK32/tmp.scKyQK8z74`.
- L8: Final foreground checks on `0a0dd45`: typecheck exit 0; test exit 0 (40 files, 497 passed, 7 skipped because optional DOLE golden copies were missing); compile exit 0. Independent recheck: 11/11 targeted assertions, including actual scratch-file corruption detection and byte-identical backup retention. Retained scratch: `/tmp/gpzbAa3r/gaHgwsLn/tmp.g810PzTkOj`.
- L9: Native review inspect rejected the abbreviated base ref; the full ref resolved and START returned candidate-scoped consent required for `81538d8..0a0dd45`. No consent was submitted, no lineage created, and no reviewers ran. No live VS Code interaction, Revolution import or test 1280 validation was performed.
