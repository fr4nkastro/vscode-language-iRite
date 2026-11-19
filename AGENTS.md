# AGENTS.md

## Project Shape
- VS Code extension for **iRite**, the Pascal-like language of Rice Lake Weighing Systems indicators (1280, 920i, 880, 820). Language id `irite`, files `.src` / `.iri`.
- This clone is the **internal IPESAH fork**: `origin` = `github.com/fr4nkastro/vscode-language-iRite`, `upstream` = `github.com/58-RlwsEng/vscode-language-iRite` (RLWS original). Default branch `master`. IPESAH house conventions are acceptable as defaults; upstreaming is not a goal.
- Current features (all there is today):
  - TextMate grammar `syntaxes/irite.tmLanguage` (regex list of built-ins and enums), language config `irite.configuration.json` (comments `--` and `(* *)`).
  - Snippets `snippets/irite.json` (~1300 lines, built-in API hints with type-prefixed placeholders like `int_`, `db_`, `string_`) and `snippets/my.irite.json`.
  - Two commands in `src/extension.ts`: `irite.build` (F7) and `irite.deploy` (F8). Both save all files and run `iRite_preprocessor.exe <file> <compilerPath> build|deploy` (via `wine` on Linux/macOS). Settings: `irite.build.engine`, `irite.build.enginePath`, `irite.build.compilerPath`. The indicator connection comes from the target project's `iRite.settings.json` (template in `syntaxes/iRite.settings.json`).
- Layout: `src/extension.ts` (activation only), `src/commands/engine.ts` (build/deploy commands, vscode-bound), `src/engine/invocation.ts` (pure helpers). Keep pure logic (parsers, models, layout) free of `vscode` imports so vitest can test it.
- **Not present yet**: iRite parser, `.rev` reader, providers, webviews (see Roadmap).

## Toolchain
- `engines.vscode: ^1.85.0`, `@types/vscode ~1.85`, TypeScript 5 (`strict`, `noEmit`), esbuild bundles `src/extension.ts` → `dist/extension.js` (CJS, node18, `vscode` external). No runtime dependencies.
- Commands: `npm run typecheck` (tsc), `npm test` (vitest, tests in `test/**/*.test.ts`), `npm run compile` / `npm run watch` (esbuild), `npm run package` (vsce → `.vsix`; runs `vscode:prepublish` = typecheck + production bundle).
- `dist/` is a build artifact (git-ignored). F5 launch runs `npm: compile` first.
- npm may block esbuild's postinstall script; the build still works through its platform package.
- Check package contents with `npx vsce ls --no-dependencies` after touching `.vscodeignore`.

## Dangerous Files — never run
- `Release.bat`, `deploy.bat`, `sync.bat` are RLWS maintainer scripts: they run `git init`, remove/replace `origin`, commit everything, push to RLWS servers, and call a release API. **Never execute them.** `Release.bat` also contains a hard-coded credential (pre-existing; flag it, do not copy it anywhere).
- `*.vsix`, `VSIX old/`, `dist/` are build artifacts.
- Publish checklist (manual, user decision): `Checklist to Publish.txt` — update `CHANGELOG.md`, `package.json`, `package-lock.json`, then `npm run package`.

## Roadmap (agreed direction, not yet implemented)
Goal: keep design and documentation inside VS Code — DB ERDs, PLC-style SFC/Grafcet of state machines, and 1280 screen previews — so Revolution is not needed just to *see* a project. Revolution remains the editor of `.rev`; the extension only **reads** it.
- F0 toolchain modernization + split `extension.ts` into modules + test infra.
- F1 lightweight iRite parser → project model JSON, starting at `main.src` and following `#include` order.
- F4 **screen preview from `.rev`** (user's first priority after F0+F1).
- F2 ERD from `type X is database`. F3 Grafcet/SFC from the house Petri FSM. F5 `docs/` generation (Markdown + diagrams).
- Track large work with ODD (`odd/tasks/<feature>.md`) before writing code.

## Reference Project (real-world sample, read-only)
- `~/Documents/localdev/IPESAH/DOLE` (Rice Lake 1280, DOLE truck-scale stations). Read its `AGENTS.md` first. Use it as the parser/preview fixture source; **never modify it from this repo's tasks.**
- Key files there: `main.src` (include order), `main.rev` (Revolution config), `main.iri` (generated aliases + DB types), `sdimages/` (screen images), `src/machine/submodules/scale/submodules/petri/` (FSM), `src/machine/submodules/ui/` (screens), `docs/erd.md` and `docs/fsm-weighing.md` (hand-written targets the extension should be able to generate).
- iRite language reference: Context7 library **`/fr4nkastro/frank-docs`**. House style: skill `irite-dev`; compile/deploy: skill `irite-compile`. If the compiler contradicts a reference, the compiler wins.

## `.rev` Format (reverse-engineered from DOLE `main.rev`, Revolution 1.0.0.15438, model 1280, `rev1280.v308.dll`)
- UTF-8 **with BOM**, CRLF, XML. Root `<Indicator>` with single-value header elements `<Revision|IndicatorModel|IndicatorVersion|ChildAssembly|ConfigHash|CODFile value="..."/>`.
- Almost everything is one `<Config>` **text node** of lines `KEY#index=value` (XML-escaped, e.g. `&lt;NL&gt;`). `<CustomData>` holds `<CustomHash>` and `<Printers>` (same text style).
- `ConfigHash` / `CustomHash` are 20-byte digests (SHA-1-like). Treat the file as **read-only**; editing likely breaks Revolution integrity.
- Key families: `SC.*` scales (`SC.ALIAS#1=SCALE_1`), `DISPLAY.*`, `SKT.TEXT#n` / `SK.OP#n` softkeys, `DIO.*` (`DIO.ALIAS.<bit>#<card>=NAME`), `DB.SCHEMA#n` / `DB.ALIAS#n`, `EDP.*` ports (`EDP.ALIAS#1=Port1`), `SP.*#1..100` setpoints, `WDGT#n` widgets, print formats (`GFMT`, `NFMT`, `AUXFMT`), `LC.*` load cells.
- **Widgets** `WDGT#<id>=<type>,...` — `<id>` is the widget number used in code (matches constants in generated `main.iri`). DOLE has 179 widgets, types: 4 (93), 7 (37), 10 (31), 3 (9), 1 (7), 6 (2).
  - Type 7 image: `7,x,y,w,h,?,?,0,file,screen,alias` — `file` is `name.png|svg` in `sdimages/` or `local://N.png` (device built-in, no file → placeholder).
  - Type 4 label/button: `4,x,y,w,h,text,?,?,fontSize,color,alias,?,0,0,?,screen` (the `?` after text are probably alignment).
  - Type 3 (likely bargraph / button backplate): `3,x,y,w,h,?,?,?,?,color,alias,?,0,0,?,screen`.
  - Type 10 line: `10,x,y,w,thickness,?,?,color,screen` (no alias).
  - Type 1 (likely scale/weight display): `1,x,y,?,?,screen,fg,bg` (size from scale format).
  - Type 6 symbol: `6,x,y,?,?,?,alias,screen,...` (layout uncertain).
  - Colors: names (`Black`, `Silver`) or `#RRGGBB`. Coordinates are pixels; usable screen area ≈ **800×388** (full-screen backgrounds are 800×388; the panel is probably 800×480 with a fixed header — unconfirmed).
  - Screens have **no records or names** in `.rev`: a screen is only the screen number field of each widget (DOLE uses 1–15). Screen names come from code (DOLE: `UiScreen` record values in `ui/main.iri` `uiLoadSettingsUi`).
  - Unknown `?` fields and types 2, 5, 8, 9, 11, 12 still need samples.
- **Databases** `DB.SCHEMA#n=<maxRecords>,0,(<field>,<typeCode>,<size>)*` + `DB.ALIAS#n=<TableName>`. Type codes seen: 2/3 Integer, 4 Real, 6/7 String (difference unknown). No foreign keys anywhere.

## iRite Source Conventions a Parser Must Handle
- `main.src`: `program main;` then `#include path\file.iri` lines (backslashes, project-relative); order = declaration order; `--#include` is commented out.
- Comments `-- ...`; identifiers case-insensitive; `:=` assignment, `=` equality; parameterless calls have no parentheses.
- Declarations: `type T is database ("Alias") Field: Type; ... end database;`, `type R is record ... end record;`, `type E is (A, B, C);` (single or multi-line), `name : constant integer := N;`, `procedure P(a: integer; b: integer);`, `function F(...): T;`, `handler Name; ... begin ... end;`.
- Generated root `main.iri` (from Revolution): widget/pin/port/scale alias constants (`lbIN : constant integer := 3;`), DB types and `<Table>_<Field>` column-index constants (1-based).
- **House Petri FSM** (IPESAH): enums `STATES` / `TRANSITIONS` (sentinels `NullState`, `NullTransition`); `HandlerTransitions` = flat `if/elsif CurrentTransition = T then SetState(M, S, X)` (transition → target step, source implicit); `HandlerStates` = `if GetState(M,S) = X then CmdX(M,S)` (step → entry procedure). Edges source→transition come from `CmdSetTransition(M,S,T)` / `SetHandlerTransition(M,S,T)` call sites, sourced by the enclosing `CmdX` or by `GetState(...) = X` / local `tState = X` guards; emitters also live in UI and setpoint/timer handlers, so scan the whole project.
- Screens in code: `SelectScreen(n)` (DOLE wraps it in `uiChangeScreen(g_tUiStatus.Screen.<Name>)`), `SetLabelText(alias, ...)`, `SetWidgetVisibility(alias, ...)`, one `handler WidgetClicked` with `EventWidget` dispatching per screen.

## Workflow Constraints
- Do not commit, push, or open PRs unless the user asks; conventional commits on `feat/*`, `fix/*`, `chore/*`, `docs/*` branches.
- Technical artifacts in English; the user converses in Spanish (Rioplatense).
