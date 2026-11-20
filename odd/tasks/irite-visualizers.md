# iRite visualizers — design and documentation inside VS Code

Branch `feat/visualizers` (fork `fr4nkastro/vscode-language-iRite`). Read `AGENTS.md` first: it documents the `.rev` format, the iRite/Petri conventions and the reference project `~/Documents/localdev/IPESAH/DOLE` (read-only, never modified).
Delivery strategy: `ask-on-risk`. Forecast ~2500 authored lines → chained slices, one per task commit.

## Specs
- S1 — "Me gustaría mejorar la extensión de irite para poder tener el diseño y documentación ahí."
- S2 — "visualizar graficamente las DBs con un ERD"
- S3 — "las secuencias con un diagrama SFC tipo PLC"
- S4 — "previsualizar las pantallas para ya no depender de revolution"
- S5 — Decisions (user, 2026-07): distribution "Fork interno IPESAH"; first view after toolchain + parser: "Pantallas".
- S6 — Revolution stays the editor of `.rev`; the extension only reads `.rev` and iRite sources (never writes them).
- S7 — Existing commands `irite.build` (F7) and `irite.deploy` (F8) keep their current behavior and settings.

## Tasks
- [x] T1 — F0 toolchain: engine ^1.85, `@types/vscode`, TS 5, esbuild, vitest, drop dead deps/`build.ts`, split `extension.ts` (S7). Route: inline. Risk: item 5. Commit: 8814c82 (lockfile) + f1aafd9
- [x] T2 — F1 iRite parser → project model (includes, databases, enums, constants, records, procedures/handlers, call sites) with tests (S1-S3). Route: worker (parallel with T3). Commit: c88df6d
- [x] T3 — `.rev` reader → model (header, Config KV, `WDGT`, `DB.SCHEMA`/`DB.ALIAS`, aliases) with tests (S4, S6). Route: worker (parallel with T2). Commit: a17bd05
- [x] T4 — Screen preview webview: `iRite: Preview Screens` renders each screen from `.rev` + `sdimages/`, widget ↔ code cross-reference (S4). Route: worker. Commit: 980213f
- [x] T5 — ERD webview from database declarations / `DB.SCHEMA` (S2). Route: worker (parallel with T6). Commit: e25ce33 + c47815f (wiring)
- [x] T6 — SFC/Grafcet webview from the Petri FSM (S3). Route: worker (parallel with T5). Commit: 6af0b61 + c47815f (wiring)
- [ ] T7 — `iRite: Generate Project Docs` → Markdown + diagrams in `docs/` (S1). Commit: —

## Log
- L1 (user, original request): "Hay una idea que me da vueltas. Me gustaría mejorar la extensión de irite para poder tener el diseño y documentación ahí. Siempre se requiere poder visualizar graficamente las DBs con un ERD, las secuencias con un diagrama SFC tipo PLC, previsualizar las pantallas para ya no depender de revolution. Explora y propone. Usa subagentes"
- L2 (user): distribution "Fork interno IPESAH"; priority "Pantallas"; sample project path given.
- L3 (user): "Este es el repo y de paso ANaliza en mi repo de ~/DOCUMENTS/LOCALDEV/IPESAH/DOLE ahí tengo un AGENTS.md que explica donde tengo documentación context7 de irite el lenguaje de programación de RICELAKE quiero que tu tambien crees un AGENTS.md para que el proximo agente no tenga que volver a explorar todo el proyecto para comprenderlo"
- L4 (evidence): DOLE `main.rev` is XML; 179 `WDGT#` lines verified by grep (types 4:93, 7:37, 10:31, 3:9, 1:7, 6:2); `DB.SCHEMA#1=1000,0,IdPlate,7,15,...`.
- L5 (user): "procede" → create this document and start T1.
- L6 (evidence): `Release.bat` contains a pre-existing hard-coded credential; reported to user, out of scope.
- L7 (evidence T1): typecheck, vitest 4/4, esbuild bundle, vsce ls, activate smoke (2 commands) pass; gentle-ai-verify PASS S7. Native review of whole T1 stopped lens_context_budget_exceeded (lockfile); split lockfile into 8814c82, code commit f1aafd9 reviewed: approved, burned (lineage review-bc68b3618c278900). Advisories: R1-001 workspace-configurable enginePath (pre-existing), R3-001 build/deploy orchestration untested. Slice boundary: T1 = slice 1.
- L8 (evidence T2/T3): typecheck clean, vitest 44/44. DOLE smoke: parser 35 files, 6 DBs, 9 enums, 201 routines, 912 calls, 0 diagnostics; rev reader 179 widgets (0 unknown), 15 screens, 6 DBs, 5/5 widget ids match main.iri. Assess d43ac8d..a17bd05: medium, not due (under_budget); pending review boundary d43ac8d.
- L9 (evidence T4): vitest 54/54, typecheck, compile, vsce ls pass. DOLE smoke rendered in headless Edge: 15 screens, 179 widgets, 42 with code references; first render was blank outside VS Code because acquireVsCodeApi was missing → parent added a fallback. Webview glue (panel, watchers, open-at-line) NOT exercised in a real VS Code host. Assess d43ac8d..980213f: medium, not due (under_budget).
- L10 (evidence T5/T6): typecheck clean, vitest 84/84, bundle 92 kB, activate registers 5 commands. DOLE smoke in headless Edge: ERD 6 tables (all in code and .rev, 0 drift), 4 inferred relations; SFC 11 steps, 14 transitions, matches docs/fsm-weighing.md for Start/PlateConfirmed/CaptureStable/Abandon/Release; flags Stop never emitted, Stoping/CheckingOperation/CapturingWeight unreachable. Follow-ups: SFC initial zoom too small and global-lane wiring cluttered; ERD edges drawn under cards; project-locating logic duplicated in 3 commands. Webview glue not exercised in a real VS Code host. Assess d43ac8d..c47815f: medium, not due (under_budget).
