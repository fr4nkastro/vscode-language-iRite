/**
 * `diagnose <project-dir|file.rev|main.src>` of the headless CLI (pure: no `vscode` import, IO injected, read-only).
 * Runs the producers behind the Problems collections with the extension's default settings:
 *   irite-sfc        `buildSfc` + `groupSfcDiagnostics` (same grouping/line rules as `irite.showSfc`)
 *   irite-db-access  `checkDbAccess` + `tableDiagnostics` (default severity Warning)
 *   widgets          overlaps and out-of-bounds of the preview model (the ones `rev-cli widgets` reports)
 * Output `{ ok, command, project, rev, diagnostics, counts }`. Exit 0 even with diagnostics; 1 unreadable; 2 usage.
 */
import * as path from "node:path";
import { checkDbAccess, DEFAULT_OPTIONS, tableDiagnostics } from "../dbaccess";
import { loadIriteProject } from "../irite";
import type { IriteProjectModel } from "../irite";
import { buildScreenView } from "../preview/screenModel";
import { findOverlaps, outOfBounds, widgetBox } from "../preview/widgetBox";
import { parseRev } from "../rev";
import { groupSfcDiagnostics } from "../sfc/sfcDiagnostics";
import { buildSfc } from "../sfc/sfcModel";
import type { CliIo, CliResult } from "./revCli";
import { EXIT, usageFailure } from "./writeCore";

const COMMAND = "diagnose";

export type DiagnoseSource = "irite-sfc" | "irite-db-access" | "widgets";

export interface DiagnoseItem {
	source: DiagnoseSource;
	severity: "error" | "warning" | "info";
	file: string;
	line?: number;
	message: string;
	code?: string;
}

const json = (code: number, body: Record<string, unknown>): CliResult => ({ code, stdout: JSON.stringify(body, null, 2) + "\n", stderr: "" });
const unreadable = (error: string): CliResult => json(EXIT.READ, { ok: false, command: COMMAND, error });

function locate(input: string, io: CliIo): { mainSrc?: string; rev?: string } | undefined {
	const lower = input.toLowerCase();
	if (lower.endsWith(".rev")) {
		const mainSrc = path.join(path.dirname(input), "main.src");
		return io.exists(input) ? { rev: input, mainSrc: io.exists(mainSrc) ? mainSrc : undefined } : undefined;
	}
	let mainSrc: string;
	if (lower.endsWith(".src")) {
		mainSrc = input;
	} else {
		mainSrc = path.join(input, "main.src");
	}
	if (!io.exists(mainSrc)) {
		// A folder with only a main.rev still has widget diagnostics.
		const onlyRev = path.join(lower.endsWith(".src") ? path.dirname(input) : input, "main.rev");
		return !lower.endsWith(".src") && io.exists(onlyRev) ? { rev: onlyRev } : undefined;
	}
	const rev = path.join(path.dirname(mainSrc), "main.rev");
	return { mainSrc, rev: io.exists(rev) ? rev : undefined };
}

/** 1-based line of `WDGT#<id>=` in the raw file text (undefined when not found). */
function widgetLine(text: string, id: number): number | undefined {
	const re = new RegExp(`^\\s*WDGT#${id}=`);
	const i = text.split(/\r?\n/).findIndex((l) => re.test(l));
	return i < 0 ? undefined : i + 1;
}

export function runDiagnose(argv: string[], io: CliIo): CliResult {
	const positional: string[] = [];
	for (const a of argv.slice(1)) {
		if (a.startsWith("--")) {
			return usageFailure(COMMAND, undefined, `Unknown option ${a}`);
		}
		positional.push(a);
	}
	if (positional.length !== 1) {
		return usageFailure(COMMAND, undefined, positional.length === 0 ? "Missing <project-dir|file.rev|main.src>" : `Unexpected argument "${positional[1]}"`);
	}
	const input = positional[0];
	const found = locate(input, io);
	if (!found) {
		return unreadable(`No main.src or .rev found at ${input}`);
	}
	const diagnostics: DiagnoseItem[] = [];
	let project: IriteProjectModel | undefined;
	if (found.mainSrc) {
		try {
			project = loadIriteProject(found.mainSrc, io.readText);
		} catch (e) {
			return unreadable(`Cannot load project ${found.mainSrc}: ${e instanceof Error ? e.message : String(e)}`);
		}
		for (const [file, list] of groupSfcDiagnostics(buildSfc(project, {}).diagnostics, found.mainSrc)) {
			for (const d of list) {
				diagnostics.push({ source: "irite-sfc", severity: d.severity, file, line: d.line, message: d.message, code: d.code });
			}
		}
		for (const t of tableDiagnostics(checkDbAccess(project, io.readText, DEFAULT_OPTIONS))) {
			diagnostics.push({ source: "irite-db-access", severity: "warning", file: t.file, line: t.line, message: t.message, code: "irite-db-access" });
		}
	}
	if (found.rev) {
		const text = io.readText(found.rev);
		if (text === undefined) {
			return unreadable(`Cannot read ${found.rev}`);
		}
		for (const s of buildScreenView(parseRev(text), project).screens) {
			const items = s.widgets.map((w) => ({ w, id: w.id, box: widgetBox(w) }));
			for (const o of findOverlaps(items)) {
				diagnostics.push({
					source: "widgets",
					severity: "warning",
					file: found.rev,
					line: widgetLine(text, o.a),
					message: `Widgets ${o.a} and ${o.b} overlap on screen ${s.number} (${o.area} px2)`,
					code: "overlap",
				});
			}
			for (const i of items) {
				if (outOfBounds(i.box)) {
					diagnostics.push({
						source: "widgets",
						severity: "warning",
						file: found.rev,
						line: widgetLine(text, i.id),
						message: `Widget ${i.id}${i.w.alias ? ` (${i.w.alias})` : ""} is outside the 7" usable area on screen ${s.number}`,
						code: "out-of-bounds",
					});
				}
			}
		}
	}
	const bySource: Record<DiagnoseSource, number> = { "irite-sfc": 0, "irite-db-access": 0, widgets: 0 };
	const bySeverity = { error: 0, warning: 0, info: 0 };
	for (const d of diagnostics) {
		bySource[d.source]++;
		bySeverity[d.severity]++;
	}
	return json(EXIT.OK, {
		ok: true,
		command: COMMAND,
		project: found.mainSrc ?? null,
		rev: found.rev ?? null,
		diagnostics,
		counts: { total: diagnostics.length, bySource, bySeverity },
	});
}
