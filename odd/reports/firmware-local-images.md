# Report: firmware built-in images (`local://N.png`)

Feature: `odd/tasks/firmware-local-images.md`. Draft sections are added per task; T5 completes the report.

## Findings (T1)

Clean-room facts only (paths, names, sizes, counts, short excerpts). No firmware file or image was copied into the repo.

Source: `1280-firmware-pn162123-version-2_09_04\update\` (`image_version=2.09.04`, build 0011, 2026-09-03). Scratch extraction: `%TEMP%\fw-1280-2.09.04\` (resolved in the worker shell as `C:\Users\ALLANC~1\AppData\Local\Temp\gpVnYSNg\gaO1H8D8\fw-1280-2.09.04\`; `x\` = extracted entries, `list.txt` / `listR.txt` = `tar -tvf` / `tar -tvRf` listings).

Evidence tags: `[TAR]` tar entry path in `rootfs.tar`; `[JS]` text file extracted from the tar (path inside the tar, minified so line = 1-based line of the extracted file); `[SH]` shell script from the tar; `[REV]` `.rev` file.

### a) How the indicator resolves `local://N.png`

- The operator UI is a web page (node/express server on `http://127.0.0.1:3000` shown by the Qt `qlxuihost` browser). Evidence: `[TAR] ./home/qlx/bin/qlxuihost7in` contains the string `http://127.0.0.1:3000`; `[SH] ./etc/init.d/S12nodejs:20` starts `/var/node/app.js` with `forever`; `[JS] ./var/node/app.js` (1 line) has `express.static(path.join(__dirname,"public"))`.
- The mapping is done in the browser by the image widget, not in the native binaries. `[JS] ./var/node/public/scripts/app/widgets/imageWidget.js` (minified; `local://` branch is on line 15 of the `;`-split view) and the same code in `[JS] ./var/node/public/scripts/app/spa.feature.weigh.js:2`:

  ```js
  else if(a.startsWith("local://")){var o=e.value;o=o.substring(8),a="/images/lclimages/"+o}
  else a.startsWith("/images/sdimages/")||(a="/images/sdimages/"+e.value);
  ```

  So: `local://N.png` -> URL `/images/lclimages/N.png` (`substring(8)` drops `local://`; the rest, `N.png`, is appended verbatim). `http`/`HTTP` values are used as is. Any other value (plain `name.png`) -> `/images/sdimages/<name>`.
- `/images/` is a directory of `/var/node/public`; `/var/node/public/images/sdimages` is a symlink to the SD card (`[SH] ./etc/init.d/S70qlx:150-151`: `ln -s /media/sdcard1/sdimages /var/node/public/images/sdimages`). The string `/var/node/public/images/sdimages/` is also in `[TAR] ./home/qlx/bin/QlxCore`.
- **N is the file number**: the file is `lclimages/N.png`, no offset. Files present are `1.png` .. `68.png` (contiguous; there is no `0.png`), so N is 1-based. `[TAR] ./var/node/public/images7/lclimages/1.png` .. `68.png` (68 files, 1,533,152 bytes together, names `^[0-9]+\.png$`, typeflag `0`, mode 0750, uid/gid 201/201).
- The native side (`QlxCore`, `qlxuihost*`) never rewrites it: `grep -a` for `lclimages`, `local://`, `images7`, `images12` in `home/qlx/bin/QlxCore` and `qlxuihost7in` / `12in` / `qlxuihost` found none (only the `sdimages/` string above). `rootfs.cpio.uboot` and `post_script.sh`: none.
- Fallback: none for unknown N or a missing file (the `<img>` just 404s). Empty value: the widget logs `empty image widget path!` and sets nothing. Also: the image is stretched to the widget box (`<img ... height="<h>" width="<w>">` built from fields `w`/`h` of the `WDGT`, no aspect-ratio preservation; `[JS] imageWidget.js` `getMarkup`).

### b) Variant per panel

- Three directories ship: `./var/node/public/images/lclimages/`, `./var/node/public/images7/lclimages/`, `./var/node/public/images12/lclimages/`, each with the same 68 names `1.png`..`68.png` (`[TAR]`).
- Selection happens at boot in `[SH] ./etc/init.d/S11graphicsetup` (`start`):
  - line 51-52: `grep "1280x800" /sys/class/graphics/fb0/mode` (framebuffer mode). Match -> 12" branch; else branch (line 185-188, `800x480`) -> 7" branch. 7" is the default.
  - 12": lines 153-170: `rm -rf /var/node/public/images/*` then `cd /var/node/public/images; ln -fsv /var/node/public/images12/* .`, then `echo "12" > /var/node/public/12`. 7": lines 232-241: same with `images7/*`, marker file `07`. So `/images/lclimages` is a symlink to `images12/lclimages` or `images7/lclimages` according to the panel. The same script swaps `stylesheets/` for `stylesheets7`/`stylesheets12`, `qlxuihost` for `qlxuihost7in`/`12in` and the boot splash.
  - The plain `images/lclimages/` directory in the tar (68 files) is the pre-boot default; on a real device it is deleted by the `rm -rf images/*` above, so the tar content is only the default/fallback copy.
- **In firmware 2.09.04 the three variants are byte-identical**: SHA-1 of every `N.png` is equal across `images`, `images7`, `images12` (68/68), so file sizes are the same and the 1.6 scale factor does not apply (width and height ratio 12"/7" = 1.00 for all 68). PNG signature valid for all 204 files.
- Pixel sizes (IHDR, same in all three variants), N -> WxH:
  - 1,5,7,8: 162x94; 2,3,4,6: 163x94
  - 9-26 and 50: 250x250 (12, 21, 26, 50 are large, 46-52 KB; the rest 2.9-8.9 KB)
  - 27: 279x108; 28: 200x208; 29,31-35: 250x75; 30: 465x108
  - 36,37: 182x163; 38: 643x201; 39: 222x404; 40: 473x206; 41: 553x197; 42: 447x180; 43: 451x182
  - 44-49, 51: 394x197; 52: 200x159; 53: 1093x311; 54: 454x171; 55: 640x800 (969,638 bytes, the largest)
  - 56: 309x73; 57,58: 560x80
  - 59,63,64,65,66,67,68: 2576x55; 60,61,62: 2576x54
- Practical consequence: one set is enough for 7" and 12" in this firmware; the importer should still keep `default`/`7`/`12` separately (the device does) because other firmware versions may differ (**unverified**: only 2.09.04 analysed).

### c) How `.rev` image widgets reference them; Revolution

- DOLE `main.rev` (type-7 widgets): 22 of the `WDGT#<id>=7,...` lines use `local://N.png`; the others use plain names of `sdimages/` files (11 files in `DOLE\sdimages`, e.g. `buttonG.png`, `load.svg`). Field 9 (1-based, after the type) of the widget line is the image. Examples: `WDGT#27=7,723,1,75,75,1,1,0,local://9.png,7,btExit7`. No other scheme (no `http`, no absolute path) appears in DOLE.
- DOLE `local://` ids (count): 9 (8), 11, 14, 15, 18 (3), 19 (3), 20, 23, 25, 28 (2) = 10 distinct ids, 22 uses. **All 10 ids exist in the firmware (1..68).** Widget boxes are 70x70 to 78x75 while the images are 250x250 (9, 11, 14, 15, 18, 19, 20, 23, 25 per the table above; 28 is 200x208), so the device stretches the image to the widget box (see a).
- Firmware sample programs agree: `[REV] ./home/qlx/apps/Truck_InOut_Program/TruckInOut_*.rev` (19 `local://` each), `Filling_Dosing_*.rev` (30 each, plus one plain `red.png`), `Checkweighing.rev` (5); `Counting.rev` and `Recipe.rev` use none. Ids used there go up to 56 (e.g. 45, 48-51, 56 in Filling/Dosing).
- Revolution (`C:\Program Files (x86)\Rice Lake Weighing Systems\Revolution`, 273 MB): **no copies and no names**. A byte scan (UTF-8 and UTF-16LE) of every file for `local://`, `lclimages`, `sdimages`, `images7` found nothing; there are no `.png` files in the install; `1280_module_Help.chm` decompiled (`hh.exe -decompile`, scratch `chm\out\`, 81 files) has no mention of `local://`, `lclimages`, `sdimages` or built-in images. This matches `docs/rev-format.md:205` (the designer draws a placeholder and does not interpret `local://N.png`).

### d) Names / labels for the built-in images

- None found. There is no JSON/QML/JS list or translation key naming the 68 images: `grep` of `local://` / `lclimages` over the extracted `/var/node` (non-`node_modules`), `/home/qlx`, `/etc`, locale `translation.json` files and the `[TAR]` text only hits the resolution code above and the `.rev` files; the QML tree (`/usr/qml`) is Qt stock modules (`Qt/labs/...`) and unrelated. Revolution has nothing either (c). The only hint is the widget alias chosen by the authors in the firmware sample `.rev` files (`btnExt*` for 9, `btnSetup` 11, `btnDlAll` 13, `btnDl` 14, `btnRegs` 15, `btnPgDn*` 18, `btnPgUp*` 19, `btnRpt` 20, `btnGo` 23, `btnStop` 25, `btnRPnt` 28, `btnNo` / `lbNo` 36, `btnYes` / `lbYes` 37, ...), i.e. the images are mostly button icons. These are inferences from aliases, not official names; the images were not viewed. Recommendation: the gallery shows the number (and size) only.

### Format facts for the importer

- `rootfs.tar`: 696,227,840 bytes, plain (uncompressed) tar, 22,020 entries, **ustar** (`ustar\0` + `00`, magic in all headers), written by GNU tar with a **pax extended header (typeflag `x`) before every entry**, named `<dir>/PaxHeaders.15876/<name>` and carrying only `mtime`/`atime`/`ctime` records (90 bytes for the lclimages entries). Counts by typeflag: `x` 22,020; `0` 17,727; `5` (dir) 2,710; `2` (symlink) 1,171; `1` (hardlink) 412. No GNU long-name (`L`/`K`) entries and no `g` global headers; none of the entries of interest is a hardlink or symlink (all 204 PNGs are typeflag `0`). A reader must nevertheless skip/parse the `x` records.
- Entry path form has a leading `./`: `./var/node/public/images7/lclimages/9.png` (also `./var/node/public/images/lclimages/`, `./var/node/public/images12/lclimages/`; directory entries end with `/`). Files of interest appear contiguously around 512-byte block 1,331,023 (images/lclimages) and in each variant directory.
- `rootfs.tar` is read-only inside `update\` next to `manifest.txt`, `rootfs.cpio.uboot` (recovery, no images), `uImage`, `.sgn` signature files, `post_script.sh`.
- `manifest.txt`: `key=value` lines, keys lower case, no spaces; `#` starts a comment line and the section headers are themselves comments (`#[Image_File_Info]`, `#[Core_Info]`, `#[Verification_Info]`, `#[File_Version_System_Info]`, `#[Override]`), so there are no real section lines to parse. Keys seen: `image_name`, `image_version` (`2.09.04`), `image_build` (`0011`), `image_build_date` (`20260903`), `image_build_time`, `image_bootloader_version`, `image_zip_size`, `image_unzip_size`, `image_num_files`, `core_version` (`2.09.04`), `core_build`, `core_build_date`, `core_build_time`, `image_sgn_file`, `image_hash`, `ver_bsp`, `ver_uboot`, `ver_recovery`, `ver_kernel`, `ver_kernelb`, `ver_dtb`, `ver_buildroot`, `over_unknown`. Some `#image_zip_size=` lines are commented duplicates (the later uncommented line wins). Use `image_version` as the firmware version (fall back to `core_version`).

### REA attempts (history: first round failed; superseded by `### REA evidence` below)

> Correction: the statement "REA could not run" held only for the first round (Node 24.18.0). REA 6.10.1 runs with Node 26 (see `### REA evidence`). The original failure is kept below as history.

- `npx -y -p node@26 -p rea-agents@latest rea --help` -> exit without help; output: `REA requires Node.js 22.x (>=22.23.4), 24.x (>=24.22.1), 26.12.1+; this process runs Node.js 24.18.0. Install a supported release, then retry.` (npm also warned `EBADENGINE` for `rea-agents@6.10.1`: node `^22.23.4 || ^24.22.1 || >=26.12.1`, current v24.18.0). The `node@26` package is installed by npx but does not take precedence in PATH on this Windows shell (`npx ... node -v` prints `v24.18.0`).
- `npx -y -p node@26 -p rea-agents@latest -- sh -c 'node -v; which rea; rea --help'` -> same error (`node -v` = v24.18.0).
- Direct call of the `node@26` binary from the npx cache: no `node/bin` directory exists in the `_npx` cache, so the binary was not available. Third and last attempt; no more loops.
- Fallback used: JS source of the node server (plain text, minified), shell scripts, and `strings`/`grep -a` on `QlxCore` / `qlxuihost*`. REA would add nothing for the resolution logic because it lives in the JS served to the browser (a), and the binaries do not contain `local://`/`lclimages`.

### REA evidence

Runner (no npm install/update): `"C:\Users\Allan Castro\node_modules\node-win-x64\bin\node.exe" "C:\Users\Allan Castro\node_modules\rea-agents\scripts\rea.mjs" <command>`; `--help` prints `rea@6.10.1` (works with Node 26). The earlier scratch dir no longer existed (temp cleaned), so the five artifacts needed were re-extracted read-only from `rootfs.tar` into a new scratch `%TEMP%\fw-1280-2.09.04\x\` (`imageWidget.js`, `spa.feature.weigh.js`, `S11graphicsetup`, `qlxuihost7in`, `QlxCore`); REA outputs in sibling `rea\`. Nothing from them is in the repo.

| # | Command (abridged) | Result |
|---|---|---|
| 1 | `rea search x/var/node/public/scripts/app/widgets/imageWidget.js lclimages --format json` | exit 1, `code: capability_unavailable`, `selection_reason: target_unsupported`: `search` is a native-binary mode (providers `ghidra`, `hopper`, `ida`, `kuna`; Ghidra: `GHIDRA_INSTALL_DIR is not set`). No mode for JS via `search`. |
| 2 | `rea search x/home/qlx/bin/qlxuihost7in lclimages --format json` | exit 1, `code: provider_unavailable` (same four providers, none configured). Native QLX binaries (`qlxuihost7in`, `QlxCore`) therefore **cannot be analysed by REA on this machine** (no Ghidra/IDA/Hopper). Not retried on `QlxCore`. |
| 3 | `rea analyze-javascript-application x/var/node/public/scripts/app --artifact-format directory --source-path widgets/imageWidget.js --format json` | exit 0 (static analysis, 1 file). Evidence has the operator literals `"/images/lclimages/"` (line 1, col 1759-1779) and `"/images/sdimages/"` (col 1825-1844), the string `"local://"`, calls `startsWith` and `substring`, and `"image"`, `"#wdgt"`. |

S11graphicsetup is a shell script (no REA mode: REA handles binaries/JS/firmware images); it was already read as text in (b). Only 3 invocations were used.

Per finding:
- (a) `local://N.png` -> `/images/lclimages/N.png`: **confirmed by REA** for the literal and the `startsWith`/`substring` use in `imageWidget.js` (JS static analysis; the exact `substring(8)` argument and the 1-based file range stay confirmed by the text read and the tar listing, REA did not evaluate them). The same code in `spa.feature.weigh.js` was **not covered** by REA (not analysed).
- (a) no fallback for unknown N: **not covered** by REA (absence of a branch; confirmed only by reading the code).
- (b) 7"/12" variant by `fb0` mode: **not covered** by REA (`S11graphicsetup` is a shell script, no mode); stays supported by the text read (`grep "1280x800" /sys/class/graphics/fb0/mode`, `ln -fsv images12/* .` / `images7/* .`).
- Native binary role in image resolution: **not covered** by REA (providers unavailable, #1/#2); the earlier `grep -a` result (no `lclimages`, `local://`, `images7`, `images12` in `QlxCore`/`qlxuihost*`) is the only evidence, plus the JS shows resolution happens in the browser. No refutation of any earlier finding; (a) and (b) are unchanged.

### Unverified points

- Native binaries not analysed with REA (needs Ghidra 12.2+ via `GHIDRA_INSTALL_DIR`, or IDA/Hopper).

- Other firmware versions or panel variants (7"/12" lclimages are identical in 2.09.04 only).
- Visual content of each image (not viewed), and the semantic names (d).
- Whether the on-device stretching (img `width`/`height` = widget box) matches what a user expects when the widget aspect ratio differs; read from JS only, not observed on a device.
- A 12" `.rev` widget box in the firmware samples vs. the 7" one was not compared (not needed for resolution).

## Implementation and verification

| Specs | Evidence |
| --- | --- |
| S1–S2 | Findings above and real DOLE browser smoke below. |
| S3 | `tarReader.test.ts`, `imageEntries.test.ts`, `manifest.test.ts`, `importer.test.ts`, `contributions.test.ts`: streaming, PAX/GNU names, malformed headers, traversal, PNG validation, cache versions and public contribution. The actual VS Code file dialog was not tested. |
| S4 | `imageCache.test.ts`, `imageResolver.test.ts`, `preview.test.ts`: selected version, panel fallback, no-cache placeholder and hint. Try the panel-specific variant, then the packaged default, then the other variant as extension fallback; the last two steps are not a claim about device behavior. |
| S5 | `editorHtml.test.ts`, `imagePicker.test.ts`, `messages.test.ts`: editor canvas, gallery model, no-cache placeholder, existing message validation. The picker applies to Image type 7; Bitmap type 2 stores a style enum, not an image file path. After independent readback, canonical path confinement was added to the editor; focused tests passed (23), including rejection of a Windows junction escape. |
| S6 | `cli.test.ts`, `docs.test.ts`: `render --firmware-images <dir>` and generated SVGs link to the cache by absolute file URI, without copying the assets. The SVG viewer must be able to load local URIs. |
| S7–S8 | `readme.md`, `CHANGELOG.md`, `AGENTS.md`, `docs/rev-format.md`; only synthetic binary test data. VSCE inventory contains the extension icon, not firmware PNGs. |
| S9 | Windows suite and Edge smoke below. Native review and independent isolated verification are not complete. |

### Windows checks

On the final code candidate (`883380e`), `npm run typecheck`, `npm test` (44 files; 528 passed, 7 skipped), `npm run compile`, `npx vsce ls --no-dependencies`, and `git diff --check` all exited 0. VSCE listed `images/icon.png` as its only PNG. A VSIX was not built or published. On the earlier browser-smoke candidate (`596ebcd`), 526 tests passed and 7 skipped; the same compile/typecheck/package inventory checks passed.

### DOLE scratch smoke

The streaming importer processed the real firmware 2.09.04: 68 images per variant (204 total), with none rejected. The actual preview and editor HTML builders were served on loopback using a scratch DOLE copy. Edge decoded all 22 built-in image instances in **each** page; after switching to 12 inches, all 22 used 12-inch cache URIs and retained nonzero natural dimensions. The gallery model had 68 built-ins and 11 project files. This did not run a VS Code extension host, exercise a picker click or save, test an indicator, or re-run the browser after the host-side confinement patch.

### Remaining verification and reviewer focus

- The independent verifier did not run its tests: the first candidate was mutable; isolated preparation on a committed candidate subsequently timed out at 60 seconds. Its editor confinement observation was fixed and covered by focused and full tests; there is no independent pass.
- Native review of the confinement patch is due and waiting for user consent. No lineage was created. Nothing was pushed.
- Refactor candidate: share canonical-path checks between preview and editor instead of keeping distinct adapters. Keep local-file SVG references separate from Webview URI conversion.

### Retained scratch and tooling

- Real-import browser smoke (includes firmware, DOLE scratch, profiles, and `preview.png`/`editor.png`): `C:\Users\ALLANC~1\AppData\Local\Temp\gp7NCIaq\gauKwgCa\irite-fw-smoke-alu6A4`.
- REA: `C:\Users\ALLANC~1\AppData\Local\Temp\gpVnYSNg\fw-1280-2.09.04`; the earlier `C:\Users\ALLANC~1\AppData\Local\Temp\gpVnYSNg\gaO1H8D8\fw-1280-2.09.04` was reported absent by the follow-up worker. Node bootstrap log: `C:\Users\ALLANC~1\AppData\Local\Temp\gpVnYSNg\rea-node26\npm.log`.
- Verifier: `C:\Users\ALLANC~1\AppData\Local\Temp\gp7NCIaq\gaYs2zKc\tmp.pl5gb6B5um` and `C:\Users\ALLANC~1\AppData\Local\Temp\gp7NCIaq\gaYs2zKc\tmp.g8iiLUJc1o`.
- Editor RED log: `C:\Users\ALLANC~1\AppData\Local\Temp\gp7NCIaq\gab432cr\pi-bash-f48da3cc2a4bf22e.log`.
- npm resolved the Node 26/REA bootstrap outside its intended scratch prefix, into `C:\Users\Allan Castro\node_modules`. No cleanup or rollback was attempted.
