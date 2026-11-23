# Reviewer report — screen editor widgets (complete 1280 widget knowledge + full screen editing)

Branch `feat/screen-editor-widgets` (from `feat/issue-6-screen-editor`, base `28c45c7`). Feature document: `odd/tasks/screen-editor-widgets.md` (specs S1–S16, log L1–L12). High risk: item 1 (the `.rev` file is consumed by Revolution and the 1280) and item 3 (contract with Revolution: file format and `main.iri` constants). Local commits only; no push, PR or merge.

## Commits

| Commit | Subject | Tasks |
|---|---|---|
| `c3b76a9` | docs(rev): add clean-room 1280 .rev format reference from Revolution analysis | T1 |
| `1092807` | feat(rev): add 1280 widget catalog and expose named widget properties | T2 |
| `3a3b345` | feat(rev): patch, append and remove WDGT lines and recompute ConfigHash on save | T3 (serializer, own commit) |
| `be5bc6f` | feat(editor): add widget id, alias and main.iri constant hint rules | T4 |
| `0bb9f43` | feat(editor): undoable add, delete, property and alias edits with validated messages | T4 (does not typecheck alone; paired with the next commit) |
| `bd75d51` | feat(editor): widget palette drag-and-drop, property inspector and reference-checked delete | T4 |
| `5c5c1c3` | feat(preview): render every 1280 widget type and add named props to rev-cli widgets | T5 |
| `074dff5` | docs: document full screen editing, widget catalog and ConfigHash recompute | T6 |
| `4eeb153` | fix(rev): refuse ambiguous caption patches on label lines with extra tokens | T7 finding |

## What REA found (S2)

Tooling: REA (`rea-agents` 6.10.1, run under `node@26` from a scratch prefix, no global install) with `inspect-managed-members <dll> --max-metadata-representation-bytes 1500000000 --max-snapshot-bytes 400000000 --json` gave the type/member inventory, call edges and string literals of `rev1280.v308.dll`, `rev1280.v310.dll`, `rev1280.dll` and the shared assemblies. REA has no .NET decompiler, so method bodies were read with ILSpy 8.2 in scratch only. Nothing decompiled, no model XML, help text, image or binary is in the repository (S3); `docs/rev-format.md` tags each fact with its source (`[REA]`, `[IL]` = assembly + type/member name, `[MODEL]`, `[SAMPLES]`). The CHM help and `streams1280.dat` were not analysed (no extractor; print streams are unrelated).

**(a) Widget types and fields.** Enum `Display.Widgets.WidgetType` (11 values). Write path: `Display.WidgetData` (`SaveWidgetProperties`, `GetConfigData`; key `WDGT#<id>`, value = the widget's `WidgetCommandOutput`). Read path: `WidgetFactory.Create(string[], int[, bool])` by token index; `Display.WidgetCollection.LoadImpl` loops ids 1..999.

| Type | Name | Tokens | Notes |
|---|---|---|---|
| 1 | Scale | 8 | no alias; size 1–7 derives width/height |
| 2 | Bitmap | 10 | since base |
| 3 | Bargraph | 16 | 3 data sources |
| 4 | Label | 16 | caption ≤64, commas stripped by Revolution |
| 5 | Numeric | 13 | legacy 920i; loader converts it to a label; not creatable |
| 6 | Symbol | 12 | style 1–48, colour index 1–16 |
| 7 | Image | 11 | `name.png` in `sdimages/` or `local://N.png` |
| 8 | Chart | 9 | since v302; screen token before alias |
| 9 | Softkey | 8 | since v303; alias not stored |
| 10 | Line | 9 | since v303; alias not stored |
| 11 | Monospace label | 16 | since v307; same layout as 4 |

v308 and v310 widget classes are identical (only `DisplayRepository` constants were refactored); v309 = v308; v301 = base. Common enums: visible 1 = visible / 2 = hidden; border 1 = none / 2 = fixed single. The full per-field table (index, name, kind, enum values, default, range, designer-exposed, version notes) is in `docs/rev-format.md` §4 and in code as `src/rev/widgetCatalog.ts`. Validation: 21,462 `WDGT` lines from about 60 real `.rev` files matched the catalog on token count and enum range, 0 mismatches. Types 2, 5, 8 and 9 never appear in the samples; their layouts come from code reading only.

**Escaping.** The `<Config>` text node escapes only `&`, `<`, `>` (quotes and CRLF raw). Inside a `WDGT` value there is no escaping: a plain comma split/join, value ≤255 characters (`[MODEL]` WDGT max; `Base.SerialCommandString.Value`). Revolution strips commas and cuts to 64 only for label captions; aliases are cut to 8; the image path is not sanitised.

**(b) Ids, aliases, `main.iri`.** New id = lowest free id from 1 (`Display.WidgetCollection.GetNextAvailableWidgetIndex`); deletion never renumbers; ids 1–999 load, UI limit 1000 widgets. Default alias = prefix + id (`lbl`, `mlbl`, `bar`, `sym`, `img`, `bit`, `cht`, `line`, `sk`); scale has none; line and softkey aliases are not stored in the `.rev` and are regenerated on load. Revolution has no alias syntax or uniqueness validation, only the 8-character cut. `Indicator.GenerateIncludeFile` writes the widget block: `-- Widget Aliases`, then per widget `alias` left-aligned and padded to 10, `: constant integer := <id>;`, CRLF, ascending id after a load, blank line after the block.

**(c) Hashes — reproduced.** `Indicator.GenerateHash`: SHA-1 over the UTF-16LE (no BOM) XML-decoded `<Config>` text with CRLF line ends; each of the 20 digest bytes is written as a decimal number followed by one space. `CustomHash` is the same function over `<Printers>`. Earlier attempts (issue #6 L3) failed because the output format is decimal, not hex, and because DOLE's current `main.rev` carries a stale hash: DOLE was hand-patched in its commit `a495703`; its blob at `00fe873` (CRLF restored) matches exactly (`75 150 160 124 …`). Every other sample matched except one hand-edited holcim file.

**(d) Paint order.** No z-order field exists in any layout. The designer paints a screen's widgets in ascending id, scale widgets in a second pass on top. The loader re-reads by id, so line order has no meaning (files with out-of-order lines are still hash-valid). Revolution sends `WDGT.CLR` and then `WDGT#<id>=` per widget in memory order; the firmware's own paint rule is not visible (unconfirmed, assumed id order). Persisting z-order would require renumbering ids, which changes the `main.iri` constants used by code, so it is not safe.

## What was implemented

- **Catalog + reader (S4):** `src/rev/widgetCatalog.ts` (pure) describes all 11 types and every field. `parseRev` names all 11 types, fills geometry/screen/alias/caption/colours for each, and exposes `tokens` (raw) and `props` (by catalog name). Unknown types and extra tokens stay raw.
- **Serializer (S5):** `applyWidgetOps(text, ops)` with `patch` (any field by name or index), `add` (one line after the last `WDGT` line, file's own line ending) and `remove` (line plus its terminator). Every other byte is untouched; LF-only and no-BOM files keep their style. Refused, with nothing returned: commas, CR/LF, values over 255, unknown/duplicate ids, ids outside 1–999, type changes, non-integers in numeric fields, enum/screen out of range, unknown types on add, legacy type 5 on add, and (after T7) caption or later fields on a label line with more tokens than the catalog.
- **Hash (S2c):** `src/rev/configHash.ts` (`computeConfigHash`, `rewriteConfigHash`, `computeCustomHashValue`). The save plan recomputes `ConfigHash` whenever `Config` changes; a save without edits writes nothing.
- **Save plan (S11):** `planSaveOps` / `planSave` apply the ops, rewrite the hash, then re-parse and refuse unless exactly the intended `WDGT` lines changed/added/removed plus the `ConfigHash` header.
- **Editor (S6–S12):** palette of the 10 creatable types (drag onto the canvas, snapped 7" coordinates, current screen; click-to-add fallback; type 5 listed as legacy). Inspector with typed inputs from the catalog (enum dropdowns, colour text + picker, numbers with min/max, caption ≤64, screen number, image input with a datalist of `sdimages/` files plus `local://N.png`); unknown types read-only. Delete (key and button) and alias rename first compute code references through the issue #5 reference index and require a modal confirmation when the alias is used. After add/rename/delete a panel shows the exact `main.iri` constant lines to add, change or remove; `main.iri` is never written. Every operation is an undoable edit of the existing CustomDocument model; backup + confirmation on first save, stale-file refusal and hot exit are kept. New messages (`add`, `delete`, `setProp`, `renameAlias`, `requestRefs`, `select`) are validated extension-side. Z-order stays view-only.
- **Preview + CLI (S13):** placeholders for every type in the webview preview and in `rev-cli render` (SVG); `rev-cli widgets` JSON carries `catalogName` and `props`.
- **Docs (S14):** `docs/rev-format.md` (clean-room reference), readme, CHANGELOG (Unreleased), AGENTS.md.

## Decisions and why

1. **Recompute `ConfigHash` on save** (L5): the recipe is proven on all samples; leaving a stale hash makes Revolution warn on load. The header line is the only non-`WDGT` line that changes; a file whose stored hash was already stale (current DOLE) gets a correct one on its first save.
2. **Refuse commas instead of stripping them** (L6): stripping silently changes user text; a refusal with a message is visible. Captions ≤64, aliases ≤8, values ≤255 mirror Revolution's limits.
3. **Alias validation stricter than Revolution** (S9): iRite identifier syntax and case-insensitive uniqueness, because the alias becomes a `main.iri` constant the compiler must accept.
4. **Lowest free id** (S9, L7) as Revolution does; in addition, ids of widgets deleted in the current editing session stay reserved until save, so one undo history never reuses an id (Revolution would reuse it immediately — a deliberate, conservative deviation).
5. **New lines appended after the last `WDGT` line**: Revolution re-reads by id, so placement is cosmetic and appending keeps the diff minimal.
6. **Ambiguous label lines (T7 finding):** a label line with more tokens than the catalog (another tool's comma caption or trailing extras) cannot be interpreted safely; only geometry before the caption may be patched, everything else is refused (`4eeb153`).
7. **Z-order view-only** (S12, L8): the only lever is the id, which code depends on.
8. **Preview geometry left as is:** Revolution's designer uses a 42 px title bar with an 800x384 (7") / 1280x704 (12") client area and its 7"↔12" resize scales y by 1.8333, which contradicts the preview's 92 px / 147.2 px header and uniform 1.6 scale. Which one matches the device is unconfirmed, so it is recorded, not changed.

## Spec coverage

| Spec | Status | Evidence |
|---|---|---|
| S1, S2 | done | `docs/rev-format.md`; scratch `FINDINGS.md`, `catalog.json`, `reproduce_confighash.py` |
| S3 | done | diff contains only own `.ts`/`.md`/`.rev` fixture/`.gitattributes`; verifier grep for decompiler/copyright text clean |
| S4 | done | `test/rev/widgetCatalog.test.ts` (token counts; every fixture and golden line parses; unknown type raw) |
| S5 | done | `test/rev/serializeOps.test.ts` (patch/add/remove, escaping, LF, no BOM, unknown type, refusals, ambiguous label line) |
| S2c | done | `test/rev/configHash.test.ts` (golden DOLE `00fe873` matches; committed `test/fixtures/rev/hashed.rev` hashed by the independent Python script; stale DOLE hash detected) |
| S6–S10 | done | `test/editor/widgetRules.test.ts`, `widgetEdit.test.ts`, `messages.test.ts`, `editorHtml.test.ts`; headless Edge drive 27/27, mock-`vscode` smoke 20/20 (L10) |
| S11, S15 | done | `test/editor/saveRev.test.ts` (one line per widget, hash-only header change, no-op save byte-identical) and golden tests with `REV_GOLDEN_DIR` |
| S12 | done | no z-order write; L8 |
| S13 | done | `test/preview/widgetTypes.test.ts`; `rev-cli render` of `hashed.rev` screen 1 shows all 11 types |
| S14, S16 | done | docs commit `074dff5`; this report |

Independent verification (L12): 8 adversarial probe families green — DOLE golden round-trip byte-identical; one add per creatable type on 3 files = 30 outputs, 44 generated files all matching the Python hash recipe; delete/edit/rename/undo; escaping and 38/38 malformed messages rejected; unknown type preserved; LF/no-BOM style kept; lowest-free id; `main.iri` line format.

## Checks (final, run through Windows interop)

- `npm run typecheck`: clean.
- `npm test`: 36 files, 470 passed, 7 skipped (golden tests skip without `REV_GOLDEN_DIR`); with `REV_GOLDEN_DIR` set: 477 passed, 0 skipped.
- `npm run compile`: OK (`dist/extension.js`, `dist/rev-cli.js`).
- `npx vsce ls --no-dependencies`: packages `docs/rev-format.md` and the `dist/` bundles; nothing from scratch.

## Unverified / pending — manual protocol

Not runnable here: Revolution opening an edited file (T8) and loading it on a test 1280. Protocol:
1. Copy the project (never the production one). Open `main.rev` with **iRite: Edit Screens**, add one widget of each type you need, edit a caption with `&` and `<`, delete one unused widget, save (a `.bak` backup is written next to the file on first save).
2. Open the saved file in Revolution 1280 (v308): expect **no hash warning** (ConfigHash recomputed), every widget in place, the new widgets with the ids/aliases the editor showed.
3. Let Revolution regenerate `main.iri`; compare its `-- Widget Aliases` block with the hint panel lines; compile.
4. Load to a **test** 1280 and check each screen, especially label/scale stacking (paint order is assumed by id) and the preview header geometry (92 vs 42 px).
5. Rollback: restore the backup file over `main.rev` (or `git checkout main.rev`), reopen in Revolution, reload the indicator.

Also unconfirmed: firmware paint order, how the firmware renders `<NL>`, where `local://N.png` resolves, behaviour of Revolution when it loads a malformed line, the device's real header height.

## Refactor candidates / design notes for the reviewer

- The old hex `computeCustomHash` / `applyWidgetPatches` APIs in `src/rev/serialize.ts` remain for existing callers; they can be folded into `applyWidgetOps` / `computeCustomHashValue`.
- `src/editor/catalogModel.ts` (`enrichRev`) is now a pass-through after the reader learned all types; remove it.
- Structural edits rebuild the whole webview page; a DOM patch would keep scroll/focus.
- Preview panel geometry (`src/preview/panels.ts`) should be re-derived from the designer constants once the device header is measured.
- Each webview command still carries its own project-locating logic (see AGENTS.md); the screen editor now uses it for references too.
- Golden tests depend on a scratch copy via `REV_GOLDEN_DIR`; a committed, licence-safe synthetic full-size fixture would make them always run.
- No way yet to create a new screen number from the editor.
