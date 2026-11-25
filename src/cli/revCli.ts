/**
 * Core of the headless `.rev` CLI (pure: no `vscode` import, no direct file access; IO is injected).
 * Read-only: it never writes a `.rev`. Commands:
 *   screens <rev>                                  screens and widget counts, JSON
 *   widgets <rev> [--screen n] [--panel 7|12]      widgets in paint order with boxes and overlaps, JSON
 *   render  <rev> --screen n [--panel 7|12] [--out file]   SVG that matches the preview webview
 */
import * as path from "node:path";
import { builtinResolver, fileUri, loadCacheFromDir } from "../firmware/imageResolver";
import { galleryModel } from "../firmware/imageCache";
import { loadIriteProject } from "../irite";
import type { IriteProjectModel } from "../irite";
import { isPanelId, panelGeometry, scaleRect } from "../preview/panels";
import type { PanelId } from "../preview/panels";
import { renderScreenSvg } from "../preview/screenSvg";
import { buildScreenView } from "../preview/screenModel";
import type { ScreenView } from "../preview/screenModel";
import { findOverlaps, isBackdrop, outOfBounds, widgetBox } from "../preview/widgetBox";
import { parseRev } from "../rev";
import { widgetTypeDef } from "../rev/widgetCatalog";
import { runDbCommand } from "./dbCommands";
import { runWidgetCommand } from "./widgetCommands";
import type { WriteFs } from "./writeCore";

export interface CliIo {
	readText(p: string): string | undefined;
	readBinary(p: string): Buffer | undefined;
	exists(p: string): boolean;
	/** Needed only by write commands with `--write`. */
	writeFs?: WriteFs;
	/** Clock for backup names and temp files (defaults to `new Date()`). */
	now?: () => Date;
}

export interface CliResult {
	code: number;
	stdout: string;
	stderr: string;
	/** When set, the caller writes `content` to `path` (only `render --out`). */
	out?: { path: string; content: string };
}

export const USAGE = `Usage: rev-cli <command> <file.rev> [options]
  screens <rev>                                       List screens (number, names, widget count) as JSON
  widgets <rev> [--screen n] [--panel 7|12]           Widgets in paint order, named props, boxes, overlaps, as JSON
  render  <rev> --screen n [--panel 7|12] [--out f] [--firmware-images dir]   Render a screen as SVG
  widget set <rev> <id> <field>=<value>...            Change widget fields (catalog names, editable ones only)
  widget add <rev> <type> --screen n [field=value...] Add a widget (lowest free id, catalog defaults, default alias)
  widget rm  <rev> <id> [--force]                     Remove a widget (refused when code still references it)
  db add-table <rev> <Name> [--records n] [--field Name:type[:size]...]   Add a table (it needs >= 1 field: use --field)
  db rm-table  <rev> <Name>                           Remove a table
  db add-field <rev> <Table> <Field> <type> [--size n] [--at pos]   Add a field (type: Revolution name or code 1..8)
  db set-field <rev> <Table> <Field> [name=<new>] [type=<t>] [size=<n>]   Rename, retype (size resets to the type default) or resize
  db rm-field  <rev> <Table> <Field>                  Remove a field
  db move-field <rev> <Table> <Field> <pos>           Move a field to position pos (1-based)
Database types: 1 Byte, 2 Short Integer, 3 Long Integer, 4 Single Precision Real, 5 Double Precision Real,
6 Fixed Length String, 7 Variable Length String, 8 DateTime (fields of an unknown type code stay read-only).
Write commands are DRY-RUN by default and print JSON { ok, command, file, dryRun, fileHash, newHash?, backup?,
changes, warnings }. Options: --write applies (backup first, atomic replace, ConfigHash recomputed, readback
validated); --dry-run (default); --expect-hash <sha256 hex of the file> refuses a stale file. main.iri is never
written; the constant lines that change are listed in "warnings". Errors are JSON { ok:false, error, ... }.
Exit codes: 0 ok, 1 file not readable, 2 usage, 3 validation/refused, 4 stale file, 5 write/backup/readback failure.
Each widget lists "props": its named properties from the widget catalog (type name in "typeName").
An explicit --firmware-images directory must contain a usable image cache.
screens, widgets and render are read-only: they never modify the .rev.
`;

const MAX_IMAGE_BYTES = 2_000_000;
const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", svg: "image/svg+xml" };

function fail(code: number, message: string): CliResult {
	return { code, stdout: "", stderr: `${message}\n` };
}

interface Parsed {
	command: string;
	file: string;
	screen?: number;
	panel: PanelId;
	out?: string;
	firmwareImages?: string;
}

function parseArgs(argv: string[]): Parsed | string {
	const [command, file, ...rest] = argv;
	if (!command || !file) {
		return "Missing command or file";
	}
	const p: Parsed = { command, file, panel: "7" };
	for (let i = 0; i < rest.length; i++) {
		const flag = rest[i];
		const value = rest[++i];
		if (value === undefined) {
			return `Missing value for ${flag}`;
		}
		if (flag === "--screen") {
			if (!/^\d{1,6}$/.test(value)) {
				return `--screen must be a number, got "${value}"`;
			}
			p.screen = Number(value);
		} else if (flag === "--panel") {
			if (!isPanelId(value)) {
				return `--panel must be 7 or 12, got "${value}"`;
			}
			p.panel = value;
		} else if (flag === "--firmware-images" && command === "render") {
			p.firmwareImages = value;
		} else if (flag === "--out") {
			p.out = value;
		} else {
			return `Unknown option ${flag}`;
		}
	}
	return p;
}

function summarize(s: ScreenView, panel: PanelId) {
	const g = panelGeometry(panel);
	const items = s.widgets.map((w) => ({ w, box: widgetBox(w) }));
	return {
		number: s.number,
		names: s.names,
		widgetCount: s.widgets.length,
		panel: { id: panel, scale: g.scale, canvasWidth: g.canvasWidth, canvasHeight: g.canvasHeight, contentHeight: g.contentHeight, bandHeight: g.bandHeight },
		widgets: items.map(({ w, box }) => ({
			id: w.id,
			type: w.type,
			typeName: w.typeName,
			/** Catalog name of the type (null for a type the catalog does not know). */
			catalogName: widgetTypeDef(w.type)?.name ?? null,
			/** Named properties by catalog field name, raw token strings (empty for unknown types). */
			props: w.props,
			alias: w.alias ?? null,
			text: w.text ?? null,
			image: w.image ?? null,
			x: w.x ?? null,
			y: w.y ?? null,
			width: w.width ?? null,
			height: w.height ?? null,
			/** Authored 7" box with the same defaults the preview uses for types without a stored size. */
			box,
			/** The box on the selected panel (uniform scale). */
			panelBox: scaleRect(box, g.scale),
			backdrop: isBackdrop(box),
			outOfBounds: outOfBounds(box),
		})),
		overlaps: findOverlaps(items.map(({ w, box }) => ({ id: w.id, box }))),
	};
}

export function runCli(argv: string[], io: CliIo): CliResult {
	if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
		return { code: argv.length === 0 ? 2 : 0, stdout: argv.length === 0 ? "" : USAGE, stderr: argv.length === 0 ? USAGE : "" };
	}
	if (argv[0] === "widget") {
		return runWidgetCommand(argv, io);
	}
	if (argv[0] === "db") {
		return runDbCommand(argv, io);
	}
	const args = parseArgs(argv);
	if (typeof args === "string") {
		return fail(2, `${args}\n${USAGE}`);
	}
	if (!["screens", "widgets", "render"].includes(args.command)) {
		return fail(2, `Unknown command "${args.command}"\n${USAGE}`);
	}
	if (args.command === "render" && args.screen === undefined) {
		return fail(2, "render needs --screen <n>");
	}
	const text = io.readText(args.file);
	if (text === undefined) {
		return fail(1, `Cannot read ${args.file}`);
	}
	const dir = path.dirname(args.file);
	const mainSrc = path.join(dir, "main.src");
	let project: IriteProjectModel | undefined;
	try {
		project = io.exists(mainSrc) ? loadIriteProject(mainSrc, io.readText) : undefined;
	} catch {
		project = undefined;
	}
	const rev = parseRev(text);
	const view = buildScreenView(rev, project);

	if (args.command === "screens") {
		const body = {
			file: path.basename(args.file),
			model: rev.header.indicatorModel ?? null,
			screens: view.screens.map((s) => ({ number: s.number, names: s.names, widgetCount: s.widgets.length })),
			diagnostics: view.diagnostics.length,
		};
		return { code: 0, stdout: JSON.stringify(body, null, 2) + "\n", stderr: "" };
	}

	const wanted = args.screen === undefined ? view.screens : view.screens.filter((s) => s.number === args.screen);
	if (args.screen !== undefined && wanted.length === 0) {
		return fail(1, `Screen ${args.screen} not found (available: ${view.screens.map((s) => s.number).join(", ") || "none"})`);
	}
	if (args.command === "widgets") {
		const body = { file: path.basename(args.file), screens: wanted.map((s) => summarize(s, args.panel)) };
		return { code: 0, stdout: JSON.stringify(body, null, 2) + "\n", stderr: "" };
	}
	let builtinImageUri: ReturnType<typeof builtinResolver> | undefined;
	if (args.firmwareImages !== undefined) {
		try {
			const cache = loadCacheFromDir(path.resolve(args.firmwareImages));
			if (cache && galleryModel(cache, args.panel).length > 0) builtinImageUri = builtinResolver(cache, fileUri);
		} catch { /* Invalid or inaccessible cache. */ }
		if (!builtinImageUri) return fail(1, `Cannot load usable firmware images from ${args.firmwareImages}`);
	}
	const svg = renderScreenSvg(wanted[0], {
		panel: args.panel,
		builtinImageUri,
		imageData: (rel) => {
			const abs = path.join(dir, rel);
			const ext = path.extname(rel).slice(1).toLowerCase();
			const bytes = MIME[ext] && io.exists(abs) ? io.readBinary(abs) : undefined;
			return bytes && bytes.length <= MAX_IMAGE_BYTES ? `data:${MIME[ext]};base64,${bytes.toString("base64")}` : undefined;
		},
	});
	return args.out ? { code: 0, stdout: "", stderr: "", out: { path: args.out, content: svg } } : { code: 0, stdout: svg, stderr: "" };
}
