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
- [ ] T1 — F0 toolchain: engine ^1.85, `@types/vscode`, TS 5, esbuild, vitest, drop dead deps/`build.ts`, split `extension.ts` (S7). Route: inline. Risk: item 5. Commit: —
- [ ] T2 — F1 iRite parser → project model (includes, databases, enums, constants, records, procedures/handlers, call sites) with tests (S1-S3). Route: worker (parallel with T3). Commit: —
- [ ] T3 — `.rev` reader → model (header, Config KV, `WDGT`, `DB.SCHEMA`/`DB.ALIAS`, aliases) with tests (S4, S6). Route: worker (parallel with T2). Commit: —
- [ ] T4 — Screen preview webview: `iRite: Preview Screens` renders each screen from `.rev` + `sdimages/`, widget ↔ code cross-reference (S4). Route: inline. Commit: —
- [ ] T5 — ERD webview from database declarations / `DB.SCHEMA` (S2). Commit: —
- [ ] T6 — SFC/Grafcet webview from the Petri FSM (S3). Commit: —
- [ ] T7 — `iRite: Generate Project Docs` → Markdown + diagrams in `docs/` (S1). Commit: —

## Log
- L1 (user, original request): "Hay una idea que me da vueltas. Me gustaría mejorar la extensión de irite para poder tener el diseño y documentación ahí. Siempre se requiere poder visualizar graficamente las DBs con un ERD, las secuencias con un diagrama SFC tipo PLC, previsualizar las pantallas para ya no depender de revolution. Explora y propone. Usa subagentes"
- L2 (user): distribution "Fork interno IPESAH"; priority "Pantallas"; sample project path given.
- L3 (user): "Este es el repo y de paso ANaliza en mi repo de ~/DOCUMENTS/LOCALDEV/IPESAH/DOLE ahí tengo un AGENTS.md que explica donde tengo documentación context7 de irite el lenguaje de programación de RICELAKE quiero que tu tambien crees un AGENTS.md para que el proximo agente no tenga que volver a explorar todo el proyecto para comprenderlo"
- L4 (evidence): DOLE `main.rev` is XML; 179 `WDGT#` lines verified by grep (types 4:93, 7:37, 10:31, 3:9, 1:7, 6:2); `DB.SCHEMA#1=1000,0,IdPlate,7,15,...`.
- L5 (user): "procede" → create this document and start T1.
- L6 (evidence): `Release.bat` contains a pre-existing hard-coded credential; reported to user, out of scope.
