/**
 * Pure adapter between the Language Model tools and the headless CLI core (no `vscode` import).
 * Every tool is an entry of `TOOLS`: its input schema (kept identical to `contributes.languageModelTools`
 * in package.json, checked by a test), a `kind` and a `run` that maps the validated input to the phase 1
 * core (`runCli` with an injected `CliIo`, so no parsing or planning logic is duplicated here).
 * The vscode-bound registration (`src/commands/lmTools.ts`) iterates this table; write tools are added
 * as further entries (kind "write").
 */
import * as path from "node:path";
import { fieldType } from "../dbschema/fieldTypes";
import { createDbSchema } from "../dbschema/model";
import { parseRev } from "../rev";
import type { CliIo } from "../cli/revCli";
import { runCli } from "../cli/revCli";
import { confine, isInside, resolveTarget } from "./paths";
import type { PathDeps, ProjectKind } from "./paths";
import { validateInput } from "./schema";
import type { ObjectSchema } from "./schema";
import type { WritePlan } from "./writeInvocation";
import { WRITE_TOOLS } from "./writeTools";

/** Maximum characters of a tool result text before lists are truncated. */
export const MAX_RESULT_CHARS = 60000;

export interface LiveDiagnostic {
	file: string;
	/** 1-based line. */
	line?: number;
	severity: "error" | "warning" | "info" | "hint";
	message: string;
	/** `Diagnostic.source` as shown in the Problems panel. */
	source?: string;
	code?: string;
}

export interface ToolContext extends PathDeps {
	io: CliIo;
	confirmWrite?(plan: WritePlan): Promise<boolean>;
	cancelled?(): boolean;
	/** Current Problems entries (the vscode layer reads `vscode.languages.getDiagnostics()`). */
	liveDiagnostics?(): LiveDiagnostic[];
	/** Override of `MAX_RESULT_CHARS` (tests). */
	maxChars?: number;
}

export interface ToolOutput {
	ok: boolean;
	/** Compact JSON text for the model. */
	text: string;
}

export interface ToolDef {
	name: string;
	kind: "read" | "write";
	inputSchema: ObjectSchema;
	run(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutput>;
}

const REV_PROP = {
	type: "string",
	description:
		"Path of the .rev file or of the iRite project folder (the one with main.rev / main.src), absolute or relative to the first workspace folder. Must be inside an open workspace folder. Optional: when omitted the project of the workspace is used; if there are several, pass it.",
} as const;

const fail = (error: string, extra: Record<string, unknown> = {}): ToolOutput => ({ ok: false, text: JSON.stringify({ ok: false, error, ...extra }) });
const done = (body: unknown): ToolOutput => ({ ok: true, text: JSON.stringify(body) });

/** Shrinks the given lists (all by the same fraction) until the JSON fits; returns the truncation info. */
function fit(body: Record<string, unknown>, lists: unknown[][], max: number, tool: string, hint: string): ToolOutput {
	if (JSON.stringify(body).length <= max) {
		return done(body);
	}
	const originals = lists.map((l) => l.slice());
	const total = originals.reduce((n, l) => n + l.length, 0);
	const render = (k: number): { text: string; shown: number } => {
		let shown = 0;
		lists.forEach((l, i) => {
			const keep = Math.floor(originals[i].length * k);
			l.splice(0, l.length, ...originals[i].slice(0, keep));
			shown += keep;
		});
		const text = JSON.stringify({ ...body, truncated: { shown, total, note: `${tool} result truncated to ${shown} of ${total} entries to stay small. ${hint}` } });
		return { text, shown };
	};
	let lo = 0;
	let hi = 1;
	let best = render(0);
	for (let i = 0; i < 12; i++) {
		const mid = (lo + hi) / 2;
		const r = render(mid);
		if (r.text.length <= max) {
			best = r;
			lo = mid;
		} else {
			hi = mid;
		}
	}
	return { ok: true, text: best.text };
}

function cliJson(argv: string[], io: CliIo): { ok: true; body: Record<string, any> } | { ok: false; out: ToolOutput } {
	const r = runCli(argv, io);
	if (r.code !== 0) {
		if (r.stdout.startsWith("{")) {
			try {
				return { ok: false, out: { ok: false, text: JSON.stringify(JSON.parse(r.stdout)) } };
			} catch { /* fall through */ }
		}
		return { ok: false, out: fail(r.stderr.trim() || `rev-cli exited with code ${r.code}`) };
	}
	try {
		return { ok: true, body: JSON.parse(r.stdout) as Record<string, any> };
	} catch {
		return { ok: false, out: fail("rev-cli returned output that is not JSON") };
	}
}

async function target(input: Record<string, unknown>, kind: ProjectKind, ctx: ToolContext): Promise<{ ok: true; path: string } | { ok: false; out: ToolOutput }> {
	const r = await resolveTarget(input.rev as string | undefined, kind, ctx);
	return r.ok ? r : { ok: false, out: fail(r.error) };
}

const screensTool: ToolDef = {
	name: "irite_screens",
	kind: "read",
	inputSchema: { type: "object", additionalProperties: false, properties: { rev: REV_PROP } },
	async run(input, ctx) {
		const t = await target(input, "rev", ctx);
		if (!t.ok) return t.out;
		const r = cliJson(["screens", t.path], ctx.io);
		return r.ok ? done(r.body) : r.out;
	},
};

const widgetsTool: ToolDef = {
	name: "irite_widgets",
	kind: "read",
	inputSchema: {
		type: "object",
		additionalProperties: false,
		properties: {
			rev: REV_PROP,
			screen: { type: "integer", minimum: 0, maximum: 999999, description: "Screen number to list. Optional: defaults to the lowest screen number (use irite_screens to list them)." },
			panel: { type: "string", enum: ["7", "12"], description: 'Panel for the scaled boxes: "7" (800x480, default) or "12" (1280x800).' },
		},
	},
	async run(input, ctx) {
		const t = await target(input, "rev", ctx);
		if (!t.ok) return t.out;
		const panel = (input.panel as string | undefined) ?? "7";
		let screen = input.screen as number | undefined;
		let note: string | undefined;
		if (screen === undefined) {
			const s = cliJson(["screens", t.path], ctx.io);
			if (!s.ok) return s.out;
			const numbers: number[] = (s.body.screens ?? []).map((x: { number: number }) => x.number).sort((a: number, b: number) => a - b);
			if (numbers.length > 0) {
				screen = numbers[0];
				if (numbers.length > 1) {
					note = `Showing screen ${screen} of ${numbers.length} screens (${numbers.join(", ")}). Pass "screen" to see another.`;
				}
			}
		}
		const argv = ["widgets", t.path, ...(screen === undefined ? [] : ["--screen", String(screen)]), "--panel", panel];
		const r = cliJson(argv, ctx.io);
		if (!r.ok) return r.out;
		const body: Record<string, any> = note ? { ...r.body, note } : r.body;
		const lists = (body.screens as Array<{ widgets: unknown[] }>).map((s) => s.widgets);
		return fit(body, lists, ctx.maxChars ?? MAX_RESULT_CHARS, "irite_widgets", 'Use "screen" and "panel" to narrow the request.');
	},
};

const LIVE_SOURCES: Record<string, "irite-sfc" | "irite-db-access"> = { "iRite SFC": "irite-sfc", "iRite DB access": "irite-db-access" };

function liveSection(projectDir: string, ctx: ToolContext) {
	const diagnostics: Array<Record<string, unknown>> = [];
	const bySource = { "irite-sfc": 0, "irite-db-access": 0 };
	const bySeverity = { error: 0, warning: 0, info: 0 };
	for (const d of ctx.liveDiagnostics?.() ?? []) {
		const source = d.source ? LIVE_SOURCES[d.source] : undefined;
		if (!source || !isInside(projectDir, d.file)) continue;
		const severity = d.severity === "hint" ? "info" : d.severity;
		diagnostics.push({ source, severity, file: d.file, line: d.line, message: d.message, code: d.code });
		bySource[source]++;
		bySeverity[severity]++;
	}
	return {
		diagnostics,
		counts: { total: diagnostics.length, bySource, bySeverity },
		note: "Live entries come from the Problems panel (collections irite-sfc and irite-db-access). irite-sfc entries exist only while the SFC diagram is open; they can repeat items from the static 'diagnostics' list.",
	};
}

const diagnoseTool: ToolDef = {
	name: "irite_diagnose",
	kind: "read",
	inputSchema: { type: "object", additionalProperties: false, properties: { rev: REV_PROP } },
	async run(input, ctx) {
		const t = await target(input, "project", ctx);
		if (!t.ok) return t.out;
		const r = cliJson(["diagnose", t.path], ctx.io);
		if (!r.ok) return r.out;
		const lower = t.path.toLowerCase();
		const projectDir = lower.endsWith(".rev") || lower.endsWith(".src") ? path.dirname(t.path) : t.path;
		const live = liveSection(projectDir, ctx);
		const body: Record<string, any> = { ...r.body, live };
		return fit(body, [body.diagnostics as unknown[], live.diagnostics], ctx.maxChars ?? MAX_RESULT_CHARS, "irite_diagnose", "Counts are complete; ask about one project or file to see the rest.");
	},
};

const dbSchemaTool: ToolDef = {
	name: "irite_dbSchema",
	kind: "read",
	inputSchema: { type: "object", additionalProperties: false, properties: { rev: REV_PROP } },
	async run(input, ctx) {
		const t = await target(input, "rev", ctx);
		if (!t.ok) return t.out;
		const text = ctx.io.readText(t.path);
		if (text === undefined) return fail(`Cannot read ${t.path}`);
		try {
			const schema = createDbSchema(parseRev(text));
			return done({
				ok: true,
				file: path.basename(t.path),
				tables: schema.tables.map((tb) => ({
					index: tb.index,
					name: tb.name,
					maxRecords: tb.maxRecords,
					fields: tb.fields.map((f) => ({ name: f.name, typeCode: f.typeCode, type: fieldType(f.typeCode)?.name ?? `Unknown (${f.typeCode})`, size: f.size })),
				})),
			});
		} catch (e) {
			return fail(`Cannot read the database schema: ${e instanceof Error ? e.message : String(e)}`);
		}
	},
};

/** Registration table: the vscode layer registers one tool per entry. T2 adds the write tools here. */
export const TOOLS: readonly ToolDef[] = [screensTool, widgetsTool, diagnoseTool, dbSchemaTool, ...WRITE_TOOLS];

/** Validates the input against the tool schema and runs it. Never throws. */
export async function runTool(name: string, input: unknown, ctx: ToolContext): Promise<ToolOutput> {
	const def = TOOLS.find((t) => t.name === name);
	if (!def) return fail(`Unknown tool ${name}`);
	const v = validateInput(def.inputSchema, input);
	if (!v.ok) return fail(v.errors.join("; "));
	let blocked: string | undefined;
	const allowed = (p: string) => {
		const result = confine(p, ctx);
		if (!result.ok) blocked ??= result.error;
		return result.ok;
	};
	const io: CliIo = {
		exists: p => allowed(p) && ctx.io.exists(p),
		readText: p => allowed(p) ? ctx.io.readText(p) : undefined,
		readBinary: p => allowed(p) ? ctx.io.readBinary(p) : undefined,
	};
	try {
		const result = await def.run(v.value, def.kind === "write" ? ctx : { ...ctx, io });
		return blocked ? fail(blocked) : result;
	} catch (e) {
		return fail(blocked ?? `Tool ${name} failed: ${e instanceof Error ? e.message : String(e)}`);
	}
}
