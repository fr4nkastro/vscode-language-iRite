# Firmware built-in images (`local://N.png`)

Preview the 1280 built-in images referenced as `local://N.png` by importing them from a user-supplied firmware `update` folder into the extension's global storage. Branch `feat/firmware-local-images` (from `feat/screen-editor-widgets`). Firmware files are Rice Lake property: never committed, shipped, or used as fixtures.

## Specs

- S1 (user request, verbatim): "Analiza con REA las fotos local para que las previsualice el editor de imagenes de la extensión, te comparto el firmware del 1280:
C:\Users\Allan Castro\Downloads\1280-firmware-pn162123-version-2_09_04\update"
- S2 Analysis with evidence (REA on firmware binaries / node server + reading text files), answering: (a) how the indicator resolves `local://N.png` (directory, naming, whether N is the file number of `lclimages/N.png`, 1-based or not); (b) which variant applies per panel (`images7` 7", `images12` 12", `images` default), whether files differ, pixel sizes per variant; (c) how `.rev` image widgets reference them (only `local://N.png`?) and whether Revolution ships copies or names; (d) names/labels for the built-in images. Scratch extraction outside the repo only.
- S3 Import command `iRite: Import 1280 Built-in Images from Firmware` (`irite.firmware.importImages`): user picks the firmware `update` folder or `rootfs.tar`; a pure, dependency-free, streaming TS tar reader (ustar, GNU long names, pax headers) extracts only built-in image entries per variant into `<globalStorage>/firmware-images/<firmwareVersion>/{default,7,12}/N.png` plus `manifest.json` (firmware version from `manifest.txt`, source path, counts, sizes). Idempotent re-import; several versions coexist; setting `irite.firmware.imagesVersion` (default: latest imported) picks one. Entry names validated (no path traversal, only digit `N.png`), PNG signatures validated.
- S4 Pure resolution (no `vscode`): `local://N.png` + panel (7"/12") → cached file path with the fallback rules found in S2(b); unknown N or no import → current placeholder plus hint "Import the built-in images from the 1280 firmware".
- S5 Preview Screens, the screen editor canvas and the editor's image property picker (gallery of built-in images with numbers, plus `sdimages/` files) show real images. Webview `localResourceRoots` include the cache dir; CSP kept; messages validated.
- S6 Generated docs (screens SVG) use the cache when present; `rev-cli render` takes optional `--firmware-images <dir>`. Reference images by path; never copy firmware images into this repo.
- S7 Docs: readme.md (import, cache location, images not shipped), CHANGELOG.md (Unreleased), AGENTS.md, docs/rev-format.md (`local://` facts, clean-room, cite evidence source).
- S8 IP: no firmware file or PNG in commits, `.vsix` (`npx vsce ls --no-dependencies`), fixtures, docs or repo screenshots. Tests use synthetic tars and PNGs generated in the tests.
- S9 Checks: `npm run typecheck`, `npm test`, `npm run compile`, `npx vsce ls --no-dependencies`; headless Edge on a scratch copy of DOLE with a real import into a scratch global storage, images render (screenshots in scratch).

## Tasks

- T1 S2 — REA/firmware analysis, findings into the report draft. Route: gentle-ai-worker (read-only on firmware, scratch extraction). Risk: none. Commit: with T5.
- T2 S3,S4,S8 — pure tar reader, entry filter/validation, manifest parse, cache layout, resolution, gallery model + vitest (synthetic tars/PNGs). Route: gentle-ai-worker. Risk: item 2 (validates user-selected archive paths before extracting). Commit: d99b105
- T3 S3,S5,S6,S7 — VS Code command, setting, Webview preview and editor, SVG, CLI, and docs. Route: gentle-ai-worker in slices. Risk: item 2 (changes Webview resource roots and message boundaries). Commit: 9c4ecad, 596ebcd, 883380e
- T4 S8,S9 — full checks + headless Edge on DOLE scratch with real import. Route: gentle-ai-worker; independent verification of the archive and Webview boundaries. Risk: item 2 (archive and Webview boundaries). Commit: with T5.
- T5 S1-S9 — report `odd/reports/firmware-local-images.md`, commits. Route: inline. Risk: none. Commit: documentation slice containing this file.

## Log

- L1 User request: "Analiza con REA las fotos local para que las previsualice el editor de imagenes de la extensión, te comparto el firmware del 1280:
C:\Users\Allan Castro\Downloads\1280-firmware-pn162123-version-2_09_04\update"
- L2 Orchestrator decisions given with the task: import command + global storage cache, pure resolution, preview/editor/picker/docs/CLI integration, strict IP constraint (see S3-S8). Delivery: `feature-branch-chain` (no human available); no push.
- L3 S5 refinement: `src/rev/widgetCatalog.ts` defines a file path for type 7 Image but only a style enum for type 2 Bitmap. Limit the file gallery to type 7 and retain the Bitmap style control; do not invent a file token the format cannot persist.
- L4 Delivery boundary: branch base `335b9eb`; streaming core, VS Code, SVG/CLI, and resource confinement are separate commits. The initial core slice is 1,167 inserted lines including its synthetic fixtures and tests, over the nominal 400-line target. No push or PR.
- L5 Windows checks passed on `883380e`: 44 files, 528 tests passed, 7 skipped; typecheck, compile, package inventory and diff check exited 0. Earlier real-firmware Edge builder smoke passed. T4 remains open: independent isolation timed out, and native review requires human consent. See the report for scope and retained scratch paths.
