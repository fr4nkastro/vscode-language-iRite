/**
 * Core of the headless `.rev` CLI (pure: no `vscode` import, no direct file access; IO is injected).
 * Read-only: it never writes a `.rev`. Commands:
 *   screens <rev>                                  screens and widget counts, JSON
 *   widgets <rev> [--screen n] [--panel 7|12]      widgets in paint order with boxes and overlaps, JSON
 *   render  <rev> --screen n [--panel 7|12] [--out file]   SVG that matches the preview webview
 */
import * as path from "node:path";
import { loadIriteProject } from "../irite";
import type { IriteProjectModel } from "../irite";
import { isPanelId, panelGeometry, scaleRect } from "../preview/panels";
import type { PanelId } from "../preview/panels";
import { renderScreenSvg } from "../preview/screenSvg";
import { buildScreenView } from "../preview/screenModel";
import type { ScreenView } from "../preview/screenModel";
import { findOverlaps, isBackdrop, outOfBounds, widgetBox } from "../preview/widgetBox";
import { parseRev } from "../rev";

export interface CliIo {
	readText(p: string): string | undefined;
	readBinary(p: string): Buffer | undefined;
	exists(p: string): boolean;
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
  widgets <rev> [--screen n] [--panel 7|12]           Widgets in paint order, boxes, overlaps, as JSON
  render  <rev> --screen n [--panel 7|12] [--out f]   Render a screen as SVG (same geometry as the preview)
Read-only: the .rev is never modified.
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
	const svg = renderScreenSvg(wanted[0], {
		panel: args.panel,
		imageData: (rel) => {
			const abs = path.join(dir, rel);
			const ext = path.extname(rel).slice(1).toLowerCase();
			const bytes = MIME[ext] && io.exists(abs) ? io.readBinary(abs) : undefined;
			return bytes && bytes.length <= MAX_IMAGE_BYTES ? `data:${MIME[ext]};base64,${bytes.toString("base64")}` : undefined;
		},
	});
	return args.out ? { code: 0, stdout: "", stderr: "", out: { path: args.out, content: svg } } : { code: 0, stdout: svg, stderr: "" };
}
