# Revolution `.rev` format (1280) — clean-room reference

Own description of the `.rev` file written by Rice Lake Revolution for the 1280 indicator (model `1280`, child assembly `rev1280.v308.dll`), written for this extension's reader, serializer and screen editor. It contains facts only (field order, names, types, enum values, defaults, ranges), no copied code, no copied model XML, no copied help text, no images.

## How the facts were obtained

Static, read-only analysis of the Revolution 1.0.0.x installation (nothing was executed, nothing was modified), cross-checked against real files.

| Tag | Source |
|-----|--------|
| `[REA]` | `rea inspect-managed-members` (REA, `rea-agents` 6.10.1) on `rev1280.v308.dll`, `rev1280.v310.dll`, `rev1280.dll`: type, member and call inventories, string literals |
| `[IL]` | Managed-code reading of the same assemblies (read through a decompiler) to see what a member does; only the conclusions are recorded here |
| `[SAMPLES]` | 21,462 `WDGT` lines in about 60 real `.rev` files written by Revolution (all `rev1280.v308.dll`, one `v310`), including the DOLE project; every line was checked against the tables below (token count and enum range): 0 mismatches |
| `[MODEL]` | `1280std.v308.xml` (the model definition shipped with Revolution): read for facts only, never copied |

Assembly names: base = `rev1280.dll` (1.0.15.0), `v308` = `rev1280.v308.dll` (1.0.0.21114), `v310` = `rev1280.v310.dll` (1.0.0.21110). Evidence is quoted as `assembly: Type.Member`. Anything not proven is marked **UNCONFIRMED**.

## 1. File layout

- UTF-8 with BOM, XML declaration with `standalone="yes"`, root `<Indicator>`, indented with two spaces, CRLF between elements. `[IL]` `rev1280.v308: Indicator.Save` (XML text writer, indented, UTF-8, `WriteStartDocument(standalone: true)`).
- Element order: `Revision`, `IndicatorModel`, `IndicatorVersion`, `ChildAssembly`, `ConfigHash`, `CODFile`, `Config`, then optional `CustomData` (`CustomHash`, `Printers`). All header elements carry one `value` attribute. `[IL]` `Indicator.Save`, `[SAMPLES]`.
- `Config` is one text node: lines `KEY#index=value`, each ended by CRLF (including the last one). Order of families = order of the indicator's child objects: scales, general, hardware, digital I/O, analog out, database, comm ports, fieldbus, streams, ethernet, junction boxes, setpoints, **widgets**, system settings, tickets, load cells. `[IL]` `Indicator.CreateChildren` / `Indicator.Save`; `[SAMPLES]`: the `WDGT#` block is contiguous, directly after `SP.DUNDER#100` and before `AUTOBKLGHT` in every sample.
- Revolution saves by deleting the file and writing a new one (no in-place update). `[IL]` `Indicator.Save`.

### Escaping of the `Config` text (XML level)

- The text node is written with the XML writer's text escaping: `&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;`. Quotes and apostrophes are written raw. Line breaks are written raw (CRLF in the file). `[IL]` `Indicator.Save` (`WriteString`); `[SAMPLES]`: only `&lt;` and `&gt;` occur (about 68,000 each), `&amp;` never (no `&` in any sample), 80 raw `"`.
- Non-ASCII text appears as raw UTF-8 in the XML. `[SAMPLES]`. Some uploaded/imported files instead carry the UTF-8 bytes of a character as decimal tokens in angle brackets (for example two tokens for `ñ`), which is an artifact of the device dump path, not an XML escape. `[SAMPLES]` (one project); the cause is **UNCONFIRMED**.
- On load the text is read as-is (CRLF kept) and split into lines by removing LF and splitting on CR; the key is everything before the first `=`; the first occurrence of a duplicated key wins. `[IL]` `Indicator.ParseConfigData`.

### Escaping inside a `WDGT` value (value level)

There is **no escaping**. A `WDGT` value is `string.Split(',')` on load and a plain comma-joined string on save. `[IL]` `Display.WidgetCollection.LoadImpl`, `Display.WidgetData.LoadWidgetData`, each widget class `WidgetCommandOutput`.

- Therefore no token may contain `,`, CR or LF. Revolution enforces this only for the label caption (type 4 and 11): the caption setter deletes every comma and cuts the text to 64 characters. `[IL]` `Display.Widgets.LabelWidget.Caption`. The image path (type 7) and the alias are NOT stripped: a comma there would shift every following token. Write nothing but numbers, colour names, and comma-free text.
- The whole value is limited to 255 characters (`WDGT` command maximum in the model). `[MODEL]` command `WDGT` `Max`; `[IL]` `Base.SerialCommandString.Value` rejects longer text. Longest value seen in the samples: 84.
- Aliases are cut to 8 characters by every alias setter. `[IL]` `Display.Widgets.*Widget.Alias`; `[SAMPLES]`: max length 8.
- Text with `<NL>` or other markup is not interpreted by the widget code (no such handling found). **UNCONFIRMED** for the firmware.

## 2. Hashes

Both hashes use the same function. `[IL]` `rev1280.v308/v310/base: Indicator.GenerateHash`.

> `value = SHA-1( UTF-16LE( text ) )`; the 20 digest bytes are written as decimal numbers, each followed by one space (including the last), for example `164 247 85 ... 81 `. The UTF-16 encoding has no BOM.

| Hash | Header element | `text` |
|------|----------------|--------|
| `ConfigHash` | `<ConfigHash value="...">` | the XML-decoded text of `<Config>` exactly as stored (CRLF line ends, all lines, last CRLF included) |
| `CustomHash` | `<CustomHash value="...">` | the XML-decoded text of `<CustomData><Printers>` |

- Reproduced `[SAMPLES]`: the recipe matches the stored `ConfigHash` of every unmodified Revolution-saved file tested (all the sample `.rev` files except two) and every stored `CustomHash`. The DOLE history matches for every commit until the first hand edit.
- Files edited outside Revolution (for example DOLE's working copy and its last three commits, where six `WDGT` lines were patched by a tool) do not match. On load Revolution compares the hash and raises a "hash value" load error that the user can continue past. `[IL]` `Indicator.Load`. The effect of continuing is **UNCONFIRMED** (not run).
- Recomputation on save is therefore possible and exact: after any change to `Config` text, recompute `ConfigHash` with the recipe above (CRLF text, UTF-16LE, decimal-with-spaces). The earlier "not reproducible" conclusion was caused by comparing in the wrong output format and by testing a hand-edited file.

## 3. Widget line: common rules

Line: `WDGT#<id>=<type>,<token1>,...`. The first token is the type code, then x and y for every type.

- `id`: integer 1..999. The loader reads ids 1 to 999 in ascending order; an id of 1000 or more is not loaded. `[IL]` `Display.WidgetCollection.LoadImpl` (loop bound); the widget count limit shown in the UI is 1000. `[IL]` `DisplayControl.UpdateWidgetCount`.
- A line must have the exact token layout of its type (see below). The loader reads tokens by index and converts integer tokens with a plain parse; a malformed line throws (effect on the whole load **UNCONFIRMED**). Extra trailing tokens are ignored. `[IL]` `Display.Widgets.WidgetFactory.Create`.
- Tokens are decimal integers with no sign handling beyond `-`; colours are .NET colour names or `#RRGGBB`. Colour output uses the standard HTML colour conversion: a colour that is a .NET *known colour* is written by name (`Black`, `Silver`, `Gray`, `Maroon`, `White`, `Blue`, `Green`, `Yellow`, ...), any other colour as `#RRGGBB` (upper-case hex); input accepts both. `[IL]` `ColorTranslator.ToHtml/FromHtml` use in each widget; `[SAMPLES]` both forms (`#000000` and `Black` both occur).
- `screen` token: 1..99 (the editor lists 99 screens). It is not a designer property; screens have no names or records. `[IL]` `DisplayControl.LoadScreenList`.
- `visible` and `border` are **1/2 enumerations, not 0/1**: visible 1 = visible, 2 = hidden; border 1 = none, 2 = fixed single. `[IL]` `Converters.WidgetBoolConverter`, `Converters.BorderStyleConverter`; `[SAMPLES]` both values for visible and border.
- Width/height setters silently ignore values <= 0. Moving by drag clamps x to `[0, screen width]` and y to `[0, client height]`; typed values in the property grid are not clamped. `[IL]` `WidgetBase.Width/Height/MoveWidget`.
- Coordinates are in pixels of the **client area below a 42 px title bar** (the editor adds 42 only when drawing). 7 in: screen 800x479, client 800x384, status bar 50. 12 in: screen 1280x799, client 1280x704, status bar 50. Both have the 42 px title bar. `[IL]` `Display.DisplayRepository` (members `TitleBarHeight`, `ClientAreaHeight`, `ScreenWidth`, `ScreenHeight`, `StatusBarHeight`). The display size is NOT stored in the `.rev`; the user opens the 7 in or the 12 in designer, and the tokens are the same. `[IL]` `InterfaceHandler` creates `Display.SevenInch.DisplayControl` or `Display.TwelveInch.DisplayControl`. The "resize widgets" command between the two scales x by 1.6 / 0.625 and y by 1.8333 / 0.5454. `[IL]` `DisplayControl` (both). NOTE: this contradicts the 92 px header / 147.2 px 12 in header assumptions used by the preview; the preview should be re-validated against these constants (**UNCONFIRMED** which one matches the real device).
- Types that have no width/height tokens (scale 1, symbol 6, softkey 9) derive their size (see their tables).

### Defaults (new widget from the palette)

A new widget gets the defaults in the tables, the current screen, and the drop position (clamped at 0). Default alias = prefix + id. `[IL]` constructor of each widget class; `Display.Widgets.WidgetFactory.Create(type, id, screen, position)`.

## 4. Widget types

Type codes of the 1280 builds (v308 = v310; base has fewer): `[REA]` `Display.Widgets.WidgetType` and `WidgetFactory` in all three assemblies; `[IL]` `WidgetFactory.Create(string[], int)`.

| Type | Class | Name | Tokens | Introduced | In samples |
|------|-------|------|--------|-----------|------------|
| 1 | `ScaleWidget` | Scale (weight display) | 8 | base | yes |
| 2 | `BitmapWidget` | Bitmap (hopper / tank) | 10 | base | no |
| 3 | `BargraphWidget` | Bargraph | 16 | base | yes |
| 4 | `LabelWidget` | Label | 16 | base | yes |
| 5 | `NumericWidget` | Numeric (legacy 920i; loader converts to a label) | 13 | legacy | no |
| 6 | `SymbolWidget` | Symbol | 12 | base | yes |
| 7 | `ImageWidget` | Image | 11 | base | yes |
| 8 | `ChartWidget` | Chart | 9 | v302 | no |
| 9 | `SoftkeyWidget` | Softkey bar | 8 | v303 | no |
| 10 | `LineWidget` | Line | 9 | v303 | yes |
| 11 | `MonospaceLabelWidget` | Monospace label | 16 | v307 | yes |

Version differences: v308 and v310 are identical for every widget class, converter, factory and serialization member (member-by-member comparison, `[REA]` + `[IL]`); only `DisplayRepository` was refactored (constants moved into fields, same values). Base `rev1280.dll` has types 1-4, 6, 7 (+5 legacy), same token layouts; it has no chart/line/softkey/monospace types and no bargraph-orientation converter. v301 = base set; v302 adds 8; v303 adds 9 and 10; v307 adds 11 (`[REA]` `WidgetType` of each `rev1280.v30x.dll`).

Legend: **Ed** = exposed as a designer property (property grid) `[IL]` `Browsable` attribute; "ro" = shown read-only. Values in `{}` are the stored integers.

### Type 1 — Scale widget (8 tokens)

`1,x,y,size,displayed,screen,fg,bg`. Not resizable, no alias (it does not appear in `main.iri`). `[IL]` `ScaleWidget.WidgetCommandOutput`, `WidgetFactory.CreateScaleWidgetFromExisting`.

| # | Name | Kind | Values | Default | Ed | Notes |
|---|------|------|--------|---------|----|-------|
| 0 | type | const | 1 | 1 | no | |
| 1 | x | int | >= 0 | drop | yes (Left) | |
| 2 | y | int | >= 0 | drop | yes (Top) | |
| 3 | size | enum | {1..7}: 260x65, 270x73, 340x84, 400x98, 470x105, 560x119, 700x143 | 4 | yes | width/height derived; identical on 7 in and 12 in; values > 7 behave as 7, < 1 as 1 |
| 4 | displayed | int | always written as 1 | 1 | no | `[IL]` output uses literal 1 |
| 5 | screen | screen | 1..99 | current | no | |
| 6 | foreground | colour | name or #RRGGBB | #393939 | yes | |
| 7 | background | colour | name or #RRGGBB | #F0EEEE | yes | |

Two scale widgets on the same screen may not overlap (the designer undoes the move). `[IL]` `DisplayControl.IsScaleWidgetCollision`.

### Type 2 — Bitmap widget (10 tokens)

`2,x,y,w,h,border,style,alias,visible,screen`. `[IL]` `BitmapWidget`.

| # | Name | Kind | Values | Default | Ed |
|---|------|------|--------|---------|----|
| 3 | width | int | >= 1 | 80 | yes |
| 4 | height | int | >= 1 | 80 | yes |
| 5 | border | enum | {1 none, 2 fixed single} | 1 | yes |
| 6 | style | enum | {1 hopper, 2 horizontal tank, 3 vertical tank} | 1 | yes |
| 7 | alias | alias | <= 8 chars | `bit<id>` | yes |
| 8 | visible | enum | {1,2} | 1 | yes |
| 9 | screen | screen | | current | no |

### Type 3 — Bargraph widget (16 tokens)

`3,x,y,w,h,border,style,graduations,orientation,color,alias,source,field,subfield,visible,screen`. `[IL]` `BargraphWidget`, `Converters.BargraphOrientationConverter`.

| # | Name | Kind | Values | Default | Ed |
|---|------|------|--------|---------|----|
| 3,4 | width, height | int | >= 1 | 76 x 16 | yes |
| 5 | border | enum | {1,2} | 2 | yes; forced to 1 when orientation is 3 or 4 (setting 2 is then ignored) |
| 6 | style | enum | {1 basic} | 1 | no |
| 7 | graduations | int | | 2 | no |
| 8 | orientation | enum | {1 horizontal, 2 vertical, 3 dial, 4 hopper} | 1 | yes |
| 9 | color | colour | | Black | yes |
| 10 | alias | alias | <= 8 | `bar<id>` | yes |
| 11 | source | enum | {1 scale, 2 programmability, 3 setpoint} | 1 | yes |
| 12 | field | int | see binding | 1 | yes |
| 13 | subfield | int | see binding | 1 | yes |
| 14 | visible | enum | {1,2} | 1 | yes |
| 15 | screen | screen | | current | no |

Binding: source 1 → field = scale number (configured scales; 1 when none), subfield 1 gross, 2 net, 3 displayed. Source 3 → field 0 = current setpoint, 1..100 = setpoint number, subfield 0. Source 2 → field 0, subfield 0. `[IL]` `BargraphWidget.DataSourceChanged`.

### Type 4 — Label widget (16 tokens) and Type 11 — Monospace label (same layout)

`4,x,y,w,h,caption,border,justification,font,color,alias,source,field,subfield,visible,screen`. `[IL]` `LabelWidget`, `MonospaceLabelWidget`.

| # | Name | Kind | Values | Default | Ed |
|---|------|------|--------|---------|----|
| 3,4 | width, height | int | >= 1 | 76 x 20 | yes |
| 5 | caption | text | <= 64 chars, commas removed | `Caption` | yes |
| 6 | border | enum | {1,2} | 2 | yes |
| 7 | justification | enum | {1 left, 2 right, 3 center} | 1 | yes |
| 8 | font size | int | free integer (samples 8..40) | 12 | yes; the setter grows the height to the font height if larger, also while loading |
| 9 | color | colour | | Black | yes |
| 10 | alias | alias | <= 8 | `lbl<id>` (type 11: `mlbl<id>`) | yes |
| 11 | source | enum | {1 scale, 2 programmability = program sets the text, 3 setpoint, 4 self = static caption} | 1 | yes |
| 12 | field | int | see binding | | yes |
| 13 | subfield | int | see binding | | yes |
| 14 | visible | enum | {1,2} | 1 | yes |
| 15 | screen | screen | | current | no |

Binding: source 1 → field = scale number, subfield 1..9 = gross primary / secondary / tertiary, net primary / secondary / tertiary, displayed, rate of change, scale alias text. Source 3 → field 0 = current setpoint or 1..100, subfield 1 name, 2 target, 3 preact, 4 tolerance band, 5 evaluation value. Sources 2 and 4 → field 0, subfield 0. `[IL]` `LabelWidget.DataSourceChanged`. `[SAMPLES]`: `4,0,0` (source 4, "self") and `2,0,0` (source 2) dominate; `1,1,1` appears 5 times.

Version: the 16-token layout is the same in base, v308 and v310. Code for older firmware (< 2.05.01) sends only the first 16 tokens and mentions a font-family token after them; v308 never writes it. `[IL]` `WidgetCollection.SendToIndicatorImpl`, `WidgetData.SendToIndicatorWithoutFontFamily`.

### Type 5 — Numeric widget (legacy)

`5,x,y,w,h,justification,fontCode,alias,source,field,subfield,visible,screen` (13 tokens). Never created by the 1280 designer; the loader converts it into a label on load (the font code 1..7 maps to 12, 16, 24, 51, 72, 85, 96 px, other values to 12). Keep as raw tokens, do not offer in a palette. `[IL]` `WidgetFactory.Create(string[], int, bool)`, `LabelWidget.ConvertFontSize`.

### Type 6 — Symbol widget (12 tokens)

`6,x,y,style,value,symbolColor,alias,source,field,subfield,visible,screen`. Fixed size 32x32 (no width/height tokens, not resizable). `[IL]` `SymbolWidget`, `Converters.SymbolStyleConverter`, `Converters.SymbolColorConverter`, `Converters.SymbolValueConverter`.

| # | Name | Kind | Values | Default | Ed |
|---|------|------|--------|---------|----|
| 3 | style | enum | {1..48} symbols (tare, standstill, center of zero, round, square, bell, exclamation, light bulb, divert, over/under/in range, stoplight, 4 arrows, speaker, serial, 2 trucks, weight, overload, underload, stop, yield, skull, unbalanced, runner, walker, printer, hourglass, gas pump, conveyor, batch auto/manual, valve, motor, checkmark, faucet, padlock, key, pipe, not, conveyor full, info, power, folder, recipe, report, manual mode) in that order | 1 | yes |
| 4 | value (state) | enum | {1..4} | 1 | yes |
| 5 | symbolColor | enum | {1..16} palette index: black, dark red, red, pink, teal, green, bright green, turquoise, dark blue, violet, blue, light grey, dark grey, dark yellow, yellow, white | 13 | yes |
| 6 | alias | alias | <= 8 | `sym<id>` | yes |
| 7 | source | enum | {1 scale, 2 programmability, 3 setpoint, 4 digital I/O} | 1 | yes |
| 8 | field | int | see binding | | yes |
| 9 | subfield | int | see binding | | yes |
| 10 | visible | enum | {1,2} | 1 | yes |
| 11 | screen | screen | | current | no |

Binding: source 1 → field = scale number, subfield 1 tare, 2 standstill, 3 center of zero, 4 overload, 5 underload. Source 3 → field 1..100, subfield 1 (state). Source 4 → field = DIO card/slot (0 = onboard), subfield = point 1..8 (onboard) or 1..24 (card). Source 2 → 0, 0. `[IL]` `SymbolWidget.DataSourceChanged`, `DataFieldChanged`. Which symbols really have 2, 3 or 4 states: **UNCONFIRMED** (texture map in the editor only).

### Type 7 — Image widget (11 tokens)

`7,x,y,w,h,border,visible,refresh,path,screen,alias`. `[IL]` `ImageWidget`.

| # | Name | Kind | Values | Default | Ed |
|---|------|------|--------|---------|----|
| 3,4 | width, height | int | >= 1 | 100 x 100 | yes |
| 5 | border | enum | {1,2} | 1 | yes |
| 6 | visible | enum | {1,2} | 1 | yes |
| 7 | refresh time | int | 0..300 seconds | 0 | yes |
| 8 | path | text | <= 255; stored verbatim; comma-free | empty | yes |
| 9 | screen | screen | | current | no |
| 10 | alias | alias | <= 8 | `img<id>` | yes |

The designer draws a placeholder; it does not read the image, and it does not interpret `local://N.png` (that is a device-side name). `[IL]` `ImageWidget.DrawWidget`; `[SAMPLES]`: about 1,500 of 3,600 image lines use `local://`. Where `sdimages/` files are resolved is outside Revolution's widget code (**UNCONFIRMED**).

#### Built-in image resolution (firmware 2.09.04)

Clean-room evidence: `odd/reports/firmware-local-images.md`, T1, including REA
`analyze-javascript-application` on `var/node/public/scripts/app/widgets/imageWidget.js`,
tar listings and the `S11graphicsetup` boot script. The device maps
`local://N.png` to `/images/lclimages/N.png` without an offset; this firmware
contains 1.png through 68.png. Boot selects `images7` or `images12` by panel;
`images` is the pre-boot default. All three variants were byte-identical in
2.09.04, not established for other releases. The device stretches images to
the widget box; no official image names were found. Native binaries were not
analysed by REA because its native providers were unavailable. No firmware
assets are reproduced here. The extension's cache fallback (panel, default,
other panel) is its own policy, not a device fallback. Bitmap type 2 has a
style enum, not an image file token.

### Type 8 — Chart widget (9 tokens)

`8,x,y,w,h,visible,chartStyle,screen,alias` (note: screen BEFORE alias, unlike type 7). `[IL]` `ChartWidget`.

| # | Name | Kind | Values | Default | Ed |
|---|------|------|--------|---------|----|
| 3,4 | width, height | int | >= 1 | 100 x 100 | yes |
| 5 | visible | enum | {1,2} | 1 | yes |
| 6 | chart style | enum | {1 line, 2 bar} | 1 | yes |
| 7 | screen | screen | | current | no |
| 8 | alias | alias | <= 8 | `cht<id>` | yes |

Never seen in the samples: layout from code only.

### Type 9 — Softkey widget (8 tokens)

`9,x,y,orientation,visible,color,background,screen`. No width/height tokens (derived from orientation), not resizable, no alias token. `[IL]` `SoftkeyWidget`.

| # | Name | Kind | Values | Default | Ed |
|---|------|------|--------|---------|----|
| 3 | orientation | enum | {1 horizontal, 2 vertical} | 1 | yes |
| 4 | visible | enum | {1,2} | 1 | yes |
| 5 | color | colour | | #393939 | yes |
| 6 | background | colour | | #F0EEEE | yes |
| 7 | screen | screen | | current | no |

Size: horizontal 800x70 (7 in) or 1280x70 (12 in); vertical 171x290 (7 in) or 274x484 (12 in). The designer allows only one softkey widget per screen. The alias `sk<id>` is read-only and not stored (regenerated on load). Never seen in the samples.

### Type 10 — Line widget (9 tokens)

`10,x,y,w,h,orientation,visible,color,screen`. `[IL]` `LineWidget`.

| # | Name | Kind | Values | Default | Ed |
|---|------|------|--------|---------|----|
| 3 | width | int | >= 1; forced to 1 when vertical | 80 | yes |
| 4 | height | int | >= 1; forced to 1 when horizontal | 1 | yes |
| 5 | orientation | enum | {1 horizontal, 2 vertical} | 1 | yes |
| 6 | visible | enum | {1,2} | 1 | yes |
| 7 | color | colour | | Black | yes |
| 8 | screen | screen | | current | no |

Changing the orientation swaps the length into the other dimension and sets the thickness to 1. The alias `line<id>` is read-only in the designer, not stored, regenerated from the id, but it is emitted into `main.iri`.

## 5. Ids, aliases, `main.iri`

### New id rule

Lowest free id ≥ 1: starting at 1, take the first id not in use, looking only at the first `count + 1` candidates (always finds one). Deleting never renumbers. `[IL]` `Display.WidgetCollection.GetNextAvailableWidgetIndex` (used by palette insert, paste, screen clone and import). `[SAMPLES]`: gaps in id sequences are reused (DOLE ids 8, 9, 10, 35, 36 appear late in the file).

Pasted/imported/cloned widgets get new ids by the same rule and a default alias (`<prefix><newId>`), not the source alias. `[IL]` `WidgetFactory.Create(string[], int)` (new-alias mode).

### Alias validation

Revolution has **no** alias validation in the widget code: no identifier syntax check, no uniqueness check, no reserved-word check; the only rule is truncation to 8 characters. `[IL]` all `Alias` setters, `DisplayControl` (no alias checks). An alias is not persisted for types 1 (no alias), 9 and 10 (default regenerated). The extension may be stricter (identifier syntax, uniqueness) as its own policy.

### Generated `main.iri` widget constants

Produced by `Indicator.GenerateIncludeFile` which concatenates each child's import text (scales, digital I/O, analog out, database, serial ports, ethernet, setpoints, widgets) and appends two print-job constants. `[IL]` `Indicator.GenerateIncludeFile`, `Display.WidgetCollection.GetImportConfig`; `[SAMPLES]` DOLE `main.iri`.

The widget block:

```
-- Widget Aliases
<alias padded right to 10> : constant integer := <id>;
...
<blank line>
```

Exact: a header line `-- Widget Aliases`, then one line per widget that has an alias (types 2, 3, 4, 6, 7, 8, 9, 10, 11; not type 1), written as the alias left-aligned and space-padded to 10 characters, then `: constant integer := `, the id and `;`. Lines end with CRLF; a blank line follows the block. The block is followed (after the other families) by `USBPRN` and `ADVPRN` string constants at file end. Order = Revolution's in-memory order (see section 6; after a load it is ascending id). Example from DOLE: `lbIN      : constant integer := 3;`. A widget with an empty or duplicate alias is emitted as is (no validation).

### `main.iri` generation

The extension reproduces the file with `generateMainIri` (`src/iri/generateIri.ts`) and `iRite: Regenerate main.iri from .rev` (previous file kept as a backup). Output is CRLF, written as UTF-8 without a BOM (`[REA]` `StreamWriter(path)` in `Indicator.GenerateIncludeFile`). `{pad10}` below is the alias left-aligned and space-padded to 10, never truncated. Sources: `[REA]` decoded IL of `rev1280.v308.dll` (`Indicator.GenerateIncludeFile` and each child's import text); `[SAMPLES]` DOLE `main.rev` -> `main.iri`, reproduced byte-for-byte.

Each section is its header line, its lines and one blank line, in this order:

1. `-- Scale Aliases`: `SC.ALIAS#n` ascending where `SC.KIND#n` is not `NONE` (case-insensitive): `{pad10}: constant integer := n;`.
2. `-- Digital I/O Aliases`: per card `c` (distinct `#c` of `DIO.ALIAS.<bit>#<c>`, ascending): `DIOCRD<c padded to 4>: constant integer := c;`, then bits 1..N (N = number of `DIO.ALIAS.<bit>#c` keys, empty alias allowed) as `{pad10}: constant integer := bit;`, then two blank lines per card.
3. `-- Analog Output Aliases`: `ALG.ALIAS#n` ascending, no filter, same line format as scales.
4. `-- Database Type Definitions and Field Aliases`: for each `DB.SCHEMA#n` ascending `type <Alias>Database is database ("<Alias>")`, one line per field (`name` right-aligned to width 10, `: `, type, `;`) and `end database;`; a blank line; then per table `<Alias>_<field padded to 9>: constant integer := <1-based position>;` followed by a blank line; one more blank line. Type codes: 1-3 Integer, 4-5 Real, 6-7 String, 8 DateTime, any other None.
5. `-- Serial Port Aliases`: `EDP.ALIAS#n` ascending, scale line format.
6. `-- Ethernet Communication Aliases`: for `TCPS`, `UDPS`, `TCPC1`, `TCPC2`, `TCPC3`: `{pad10 of <K>.NAME or empty}: constant string := "<K>";` (the literal is always the key).
7. `-- Setpoint Aliases`: `SP.ALIAS#n` ascending where `SP.KIND#n` is not `OFF` (case-insensitive): `{pad10}: constant integer :=n;` (no space before the number).
8. `-- Widget Aliases`: ascending id, widgets whose type has an alias; alias is the stored one, `sk<id>` for type 9, `line<id>` for type 10; types 1 and 5 and unknown types are skipped.

After the last blank line: `USBPRN    : constant string := "USBPRN";` and `ADVPRN    : constant string := "ADVPRN";`, each ending CRLF, nothing after.

Replacement: identical bytes write nothing; different bytes are copied to a never-overwritten backup (`main.iri.bak`, else timestamped) and replaced through a temp file and rename; a missing file is created without backup; a failed backup leaves the target untouched.

UNCONFIRMED: the alias token of types 2, 8 and 11 is not checked against a sample (DOLE has none of types 2 and 8); the number of DIO bits per card type (the generator uses the number of `DIO.ALIAS` keys found); the header texts are resources taken from DOLE `main.iri`, not from the DLL; Revolution v310 was not compared.

## 6. Paint order, line order, persisted z-order

- **No z-order field exists** in any widget layout. `[IL]` all `WidgetCommandOutput`, no member named for z-order/layer/bring-to-front in `Display.*`.
- The designer paints the widgets of the selected screen **in ascending id**, in two passes: all non-scale widgets first, then all scale widgets (type 1) last, so scale widgets are always on top. A later id is drawn over an earlier one. Hit-testing walks the list in reverse. `[IL]` `Display.SevenInch/TwelveInch.DisplayControl.DrawNonScaleWidgets`, `DrawScaleWidgets`.
- Line order in `Config` has no stored meaning: the loader reads `WDGT#1` to `WDGT#999` by id and rebuilds its list in that order; the saver writes the list in memory order (ascending after a load; new widgets append; a freed slot may be reused). Files with out-of-order lines exist (up to 21 inversions in the samples) next to files with none, all hash-valid. `[IL]` `WidgetCollection.LoadImpl/GetConfigData`; `[SAMPLES]`.
- To the device: after `WDGT.CLR`, Revolution sends one `WDGT#<id>=<value>` command per widget in memory order (value as in the file). `[IL]` `WidgetCollection.SendToIndicatorImpl`, `WidgetData.SendToIndicatorImpl`. How the firmware orders painting is not visible in Revolution: **UNCONFIRMED** (assumed id order; sending order is not stable).
- Conclusion: the only persistable paint-order lever is the **id** (and for scales their fixed top layer), which would mean renumbering widgets and changing the `main.iri` constants used by code. Z-order cannot be persisted safely without that; keep it view-only.

## 7. How the extension uses this

- The reader (`src/rev/index.ts`) names every catalog type (1..11) and exposes geometry, screen, alias, caption, font and colours for all of them plus every named property (`props`, by the field names of `src/rev/widgetCatalog.ts`). Types outside the catalog (for example 12 or later) stay raw tokens and round-trip untouched.
- Preview and `rev-cli render` draw each type (bitmap, bargraph, label, numeric as label, symbol, image, chart, softkey, line, scale, monospace label with a monospace font); built-in images resolve from an optional user-imported firmware cache, otherwise they remain placeholders. Preview paint order stays ascending id (the designer's "scale widgets last" pass is not applied); z-order is view-only.
- The preview's panel header assumption (92 px for 7 in, 147.2 px for 12 in) is not the designer's 42 px title bar with an 800x384 / 1280x704 client area (section 3). Which one matches the real device is **UNCONFIRMED** and the preview constants are unchanged.

- Label lines (types 4, 11) with more tokens than the catalog (a caption with commas written by another tool, or trailing extras) are ambiguous: the serializer patches only the geometry before the caption on such lines and refuses everything else.

## Database

Database type evidence below concerns the Revolution v308 designer, not indicator acceptance. Sample observations are from read-only DOLE `main.rev:1005-1016` and generated `main.iri:20-56` (`[SAMPLES]`).

- A table uses `DB.SCHEMA#<index>=<maxRecords>,<recordsToken>,<field>,<typeCode>,<size>[,<field>,<typeCode>,<size>...]` and `DB.ALIAS#<index>=<tableName>`. The matching index pairs a schema with its alias; field triples are in the same order as the corresponding iRite database declaration. `[IL]` `rev1280.v308.dll: Database.Table.CreateSchemaString` sources the second token from `m_records`; its meaning and permitted values remain **UNCONFIRMED**. It is `0` in all six DOLE schemas (`[SAMPLES]`).
- DOLE writes each `DB.SCHEMA#n` immediately followed by `DB.ALIAS#n`, for indices 1 through 6 in ascending order. Its DB block follows `DIO.ALIAS.8#0` and precedes `EDP.ADDRESS#1` (then `EDP.ALIAS#1`): the observed port key prefix is `EDP.`. The family order from `[IL]` places analog out before database and comm ports after it (section 1), but DOLE has no observed analog-out line at this boundary; the exact analog-out key prefix is **UNCONFIRMED**. Do not infer a prefix or assume every file has either neighboring family.

When inserting the first database block, the editor puts it before the first recognized later-family key (`EDP.`, `STRM.`, `SP.`, `WDGT`, `SKT.`, `SK.OP`, `GFMT`, `NFMT`, `AUXFMT`, or `LC.`). If none is present, it appends to the Config text; unknown keys remain in place. The exact placement of softkey, format and other unrecognized keys relative to the database is **UNCONFIRMED**, so this fallback is a best effort rather than a proven Revolution boundary.

### Field types (v308 designer)

`[REA]` `rev1280.v308.dll: Database.DatabaseType.DBType` establishes codes 0–8; `[REA]`/`[IL]` `Database.DatabaseType.GetString`, `GetDefaultSize` and `Database.DatabaseField.ConvertToiRiteType` establish the names, defaults and mappings. Fixed/variable describes the designer size control, not proven device storage behavior: `[IL]` `Database.EditFieldForm.DataTypeSelection`.

| Code | Revolution name | iRite type | Designer size rule / default |
|------|-----------------|------------|------------------------------|
| 0 | None | None | 0; rejected by edit form |
| 1 | Byte | Integer | fixed 1 |
| 2 | Short Integer | Integer | fixed 2 |
| 3 | Long Integer | Integer | fixed 4 |
| 4 | Single Precision Real | Real | fixed 4 |
| 5 | Double Precision Real | Real | fixed 8 |
| 6 | Fixed Length String | String | variable; default 20 |
| 7 | Variable Length String | String | variable; default 20 |
| 8 | DateTime | DateTime | fixed 8 |

`[IL]` `rev1280.v308.dll: Database.EditFieldForm.InitControls` includes None in the picker, but `ValidateUi` requires a type greater than zero. For string sizes, `ValidateUi` parses a signed 32-bit integer and rejects values above 255; its size branch has no lower-bound check, so zero and negatives pass that branch, subject to other form checks. The actual device minimum, acceptance and distinction between the two string types remain **UNCONFIRMED**. `Database.DatabaseType.GetMaxSize` is a separate data-display helper, not an established schema byte-size rule.

`[SAMPLES]` DOLE corroborates codes 1/2/3 as Integer with sizes 1/2/4, code 4 as Real size 4, and codes 6/7 as String with sizes 19 and 7/15/16/19/20 respectively. Codes 0/5/8 were not cross-checked in samples. The extension requires newly edited string sizes to be positive integers up to 255 as its own policy, and fixed sizes for the other editable types; unchanged legacy size combinations are preserved with warnings. Unknown codes and code 0 remain raw and read-only; unchanged schemas cause no write. `.rev` continues to store numeric codes.

The v308 designer validates table and field names with an ASCII letter or underscore followed by up to seven ASCII word characters, rejecting reserved words case-insensitively. Its regex also accepts a final LF; the extension deliberately rejects newlines and preserves stricter case-insensitive collision checks. `[IL]` `revolution.library.dll: Support.VerifyIriteAliasString`; `rev1280.v308.dll: Database.DatabaseConfigForm._tableName_TextChanged`, `Database.EditFieldForm.ValidateUi`. The designer limits additions to 100 fields and 128 tables, and its maximum-rows control to 2,000,000. `[IL]` `rev1280.v308.dll: Database.DatabaseConfigForm.addButton_Click`, `Database.Database.AddTable`, `Database.DatabaseConfigForm.InitializeComponent`. These are designer rules, not proven firmware limits; the extension additionally requires positive record counts.

**Reserved-word membership: UNCONFIRMED.** `[REA]` The follow-up managed-member inspection did not resolve the unqualified `Support` selector or yield the contents of the list referenced by `Support.VerifyIriteAliasString`. The extension retains its existing grammar-derived policy in `src/dbschema/model.ts`; it is not a verified Revolution list. The parser's non-call words classify identifiers for parsing, and the dbaccess scaffolder does not define a reserved-word list. Neither is evidence for the designer's exact membership.

`[IL]` `rev1280.v308.dll: Database.Table.CalculateSize` sums stored field sizes and multiplies by MaxRecords; `Database.DatabaseSchemaControl.LoadData` colors rows when cumulative size exceeds 460,000,000 bytes. `[REA]` `rev1280.v308.dll: Database.Database.MAX_DATABASE_MEMORY_BYTES` contains that value. This is a designer warning threshold, not a proven save rejection or indicator hard limit. Firmware/indicator enforcement, storage overhead, any per-table memory cap, the second schema token's meaning and permitted values, the distinction between string types, and device minimums remain **UNCONFIRMED**. Validate in Revolution and on a test indicator before production.

## 8. Other facts

- Maximum 1000 widgets per file (UI); ids up to 999 load. A screen number is 1..99. `[IL]`.
- Custom colours live in `<CustomData><Printers>` as `CUSTOMCOLORS=<int>|...` (up to 16 entries), not in the widget line. `[IL]` `WidgetCollection.CustomSave/CustomLoad`.
- Alias default prefixes: `lbl`, `mlbl`, `bar`, `sym`, `img`, `bit`, `cht`, `line`, `sk`; scale widgets have none.
- Data-source numbers are not shared across types: bargraph has 3 sources, label 4 (4 = self), symbol 4 (4 = digital I/O).
- Not analyzed: the CHM help file (no extractor available), `streams1280.dat` (print stream definitions, unrelated to widgets), the 120/320/420/... models (other indicators).
