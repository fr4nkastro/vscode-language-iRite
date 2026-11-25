/**
 * `widget set | add | rm` of the headless CLI (pure: no `vscode` import). Validation and edits go through the
 * screen editor's own pure model (`src/editor/editState.ts`, `widgetRules.ts`) and its save plan
 * (`planSaveOps`), so the CLI writes exactly what the editor would; the shared safety rules (dry-run,
 * `--write`, `--expect-hash`, backup, atomic replace, readback) live in `./writeCore`.
 * `main.iri` is never written: the constant lines that change are reported in `warnings`.
 */
import * as path from "node:path";
import { aliasEntries, addWidget, deleteWidget, effectiveWidgets, emptyEditState, renameAlias, setProp, toOps } from "../editor/editState";
import type { EditState } from "../editor/editState";
import { iriHint } from "../editor/iriHint";
import { loadIriteProject } from "../irite";
import type { IriteProjectModel } from "../irite";
import { buildScreenView } from "../preview/screenModel";
import { parseRev } from "../rev";
import type { RevModel } from "../rev";
import { checkWidgetToken } from "../rev/serialize";
import { widgetFieldByName, widgetTypeDef } from "../rev/widgetCatalog";
import { planSaveOps } from "../editor/saveRev";
import type { CliIo } from "./revCli";
import { Refusal, runWriteCommand, usageFailure } from "./writeCore";
import type { Planned, WriteResult } from "./writeCore";

const COORD_LIMIT = 10000;

interface Opts {
	write: boolean;
	dryRun: boolean;
	force: boolean;
	expectHash?: string;
	screen?: number;
	positional: string[];
}

function parseOpts(sub: string, rest: string[]): Opts | string {
	const o: Opts = { write: false, dryRun: false, force: false, positional: [] };
	for (let i = 0; i < rest.length; i++) {
		const a = rest[i];
		if (a === "--write") {
			o.write = true;
		} else if (a === "--dry-run") {
			o.dryRun = true;
		} else if (a === "--force" && sub === "rm") {
			o.force = true;
		} else if (a === "--expect-hash") {
			const v = rest[++i];
			if (v === undefined || !/^[0-9a-fA-F]{64}$/.test(v)) {
				return "--expect-hash needs a SHA-256 as 64 hexadecimal characters";
			}
			o.expectHash = v;
		} else if (a === "--screen" && sub === "add") {
			const v = rest[++i];
			if (v === undefined || !/^\d{1,3}$/.test(v)) {
				return `--screen must be a number, got "${v ?? ""}"`;
			}
			o.screen = Number(v);
		} else if (a.startsWith("--")) {
			return `Unknown option ${a}`;
		} else {
			o.positional.push(a);
		}
	}
	if (o.write && o.dryRun) {
		return "--write and --dry-run cannot be used together";
	}
	return o;
}

function parseFields(args: string[]): Array<[string, string]> | string {
	const out: Array<[string, string]> = [];
	for (const a of args) {
		const eq = a.indexOf("=");
		if (eq < 1) {
			return `Expected field=value, got "${a}"`;
		}
		out.push([a.slice(0, eq), a.slice(eq + 1)]);
	}
	return out;
}

function loadProject(io: CliIo, dir: string): IriteProjectModel | undefined {
	const mainSrc = path.join(dir, "main.src");
	try {
		return io.exists(mainSrc) ? loadIriteProject(mainSrc, io.readText) : undefined;
	} catch {
		return undefined;
	}
}

/** Same checks the editor applies plus a hard coordinate range (the editor's page clamps instead of refusing). */
function checkValue(type: number, field: string, value: string): string | undefined {
	const f = widgetFieldByName(type, field);
	if (f && (f.role === "x" || f.role === "y" || f.role === "width" || f.role === "height")) {
		const n = Number(value.trim());
		if (/^-?\d+$/.test(value.trim()) && Math.abs(n) > COORD_LIMIT) {
			return `"${field}" is out of range (-${COORD_LIMIT} to ${COORD_LIMIT})`;
		}
	}
	return checkWidgetToken(type, field, value);
}

function applyField(state: EditState, rev: RevModel, id: number, name: string, value: string): EditState {
	const w = effectiveWidgets(rev, state).find((x) => x.id === id);
	if (!w) {
		throw new Refusal(`Widget ${id} does not exist`);
	}
	const f = widgetFieldByName(w.type, name);
	if (f && f.kind !== "alias") {
		const why = checkValue(w.type, name, value);
		if (why) {
			throw new Refusal(`${name}: ${why}`);
		}
	}
	const r = name === "alias" ? renameAlias(state, rev, id, value) : setProp(state, rev, id, name, value);
	if (!r.ok) {
		throw new Refusal(`${name}: ${r.reason}`);
	}
	return "state" in r ? r.state : state;
}

const refSites = (view: ReturnType<typeof buildScreenView>, id: number, dir: string) =>
	(view.screens.flatMap((s) => s.widgets).find((w) => w.id === id)?.references ?? []).map((r) => ({ file: path.relative(dir, r.file), line: r.line, callee: r.callee, ...(r.routine ? { routine: r.routine } : {}) }));

/** Everything the three commands share after the state is built: save plan, structured changes, main.iri lines. */
function finish(original: Buffer, rev: RevModel, state: EditState, warnings: string[]): Planned {
	const plan = planSaveOps(original, toOps(rev, state));
	const hint = iriHint(aliasEntries(rev, emptyEditState()), aliasEntries(rev, state));
	if (!plan) {
		return { changes: [], warnings };
	}
	const before = new Map(rev.widgets.map((w) => [w.id, w]));
	const after = new Map(plan.model.widgets.map((w) => [w.id, w]));
	const changes: unknown[] = [];
	for (const id of plan.changed) {
		const a = before.get(id)?.props ?? {};
		const b = after.get(id)?.props ?? {};
		const fields: Record<string, { from: string; to: string }> = {};
		for (const k of Object.keys(b)) {
			if (a[k] !== b[k]) {
				fields[k] = { from: a[k] ?? "", to: b[k] };
			}
		}
		changes.push({ op: "set", id, fields });
	}
	for (const id of plan.added) {
		const w = after.get(id);
		changes.push({ op: "add", id, type: w?.type, ...(w?.alias ? { alias: w.alias } : {}), screen: w?.screen, line: `WDGT#${id}=${w?.tokens.join(",")}` });
	}
	for (const id of plan.removed) {
		const alias = effectiveAliasOf(rev, id);
		changes.push({ op: "rm", id, ...(alias ? { alias } : {}) });
	}
	const lines = [...hint.add.map((l) => `add line "${l}"`), ...hint.change.map((c) => `change line "${c.old}" to "${c.new}"`), ...hint.remove.map((l) => `remove line "${l}"`)];
	const iriWarnings = lines.length > 0 ? [`main.iri is NOT regenerated by this command (use regen-iri); constants that change: ${lines.join("; ")}`] : [];
	return { bytes: plan.bytes, changes, warnings: [...warnings, ...iriWarnings], ...(lines.length > 0 ? { extra: { iriHint: hint } } : {}) };
}

function effectiveAliasOf(rev: RevModel, id: number): string | undefined {
	return effectiveWidgets(rev, emptyEditState()).find((w) => w.id === id)?.alias;
}

export function runWidgetCommand(argv: string[], io: CliIo): WriteResult {
	const [, sub, file, ...rest] = argv;
	const command = `widget ${sub ?? ""}`.trim();
	if (sub !== "set" && sub !== "add" && sub !== "rm") {
		return usageFailure(command, undefined, sub ? `Unknown widget subcommand "${sub}" (expected set, add or rm)` : "Missing widget subcommand (set, add or rm)");
	}
	if (!file) {
		return usageFailure(command, undefined, "Missing <file.rev>");
	}
	const opts = parseOpts(sub, rest);
	if (typeof opts === "string") {
		return usageFailure(command, file, opts);
	}
	const [head, ...tail] = opts.positional;
	const what = sub === "add" ? "type" : "id";
	if (head === undefined || !/^\d+$/.test(head)) {
		return usageFailure(command, file, `Missing or invalid widget ${what}${head === undefined ? "" : ` "${head}"`} (a number)`);
	}
	const num = Number(head);
	let fields: Array<[string, string]> = [];
	if (sub === "rm") {
		if (tail.length > 0) {
			return usageFailure(command, file, `Unexpected argument "${tail[0]}"`);
		}
	} else {
		const parsed = parseFields(tail);
		if (typeof parsed === "string") {
			return usageFailure(command, file, parsed);
		}
		fields = parsed;
		if (sub === "set" && fields.length === 0) {
			return usageFailure(command, file, "widget set needs at least one field=value");
		}
		if (sub === "add" && opts.screen === undefined) {
			return usageFailure(command, file, "widget add needs --screen <n>");
		}
	}

	const dir = path.dirname(file);
	return runWriteCommand({
		command,
		file,
		write: opts.write,
		expectHash: opts.expectHash,
		io,
		plan: (original) => {
			const rev = parseRev(original.toString("utf8"));
			let state = emptyEditState();
			const warnings: string[] = [];
			if (sub === "set") {
				const before = effectiveWidgets(rev, state).find((w) => w.id === num);
				for (const [name, value] of fields) {
					state = applyField(state, rev, num, name, value);
				}
				if (fields.some(([n]) => n === "alias") && before?.alias) {
					const project = loadProject(io, dir);
					const refs = project ? refSites(buildScreenView(rev, project), num, dir) : [];
					if (refs.length > 0) {
						warnings.push(`The alias "${before.alias}" is used in ${refs.length} place(s) of the code; update them, the code will not compile otherwise`);
					} else if (!project) {
						warnings.push("No main.src next to the .rev: code references of the renamed alias were not checked");
					}
				}
			} else if (sub === "add") {
				const def = widgetTypeDef(num);
				if (!def || def.legacy) {
					throw new Refusal(`Widgets of type ${num} cannot be added`);
				}
				const pos: Record<string, string> = { x: "0", y: "0" };
				const rest2: Array<[string, string]> = [];
				for (const [name, value] of fields) {
					if (name === "x" || name === "y") {
						const why = checkValue(num, name, value);
						if (why || value.trim() === "") {
							throw new Refusal(`${name}: ${why ?? "is not a number"}`);
						}
						pos[name] = value.trim();
					} else {
						rest2.push([name, value]);
					}
				}
				const added = addWidget(state, rev, { type: num, x: Number(pos.x), y: Number(pos.y), screen: opts.screen as number });
				if (!added.ok) {
					throw new Refusal(added.reason);
				}
				state = added.state;
				for (const [name, value] of rest2) {
					state = applyField(state, rev, added.id, name, value);
				}
			} else {
				const target = effectiveWidgets(rev, state).find((w) => w.id === num);
				const project = loadProject(io, dir);
				const refs = project ? refSites(buildScreenView(rev, project), num, dir) : [];
				const del = deleteWidget(state, rev, num);
				if (!del.ok) {
					throw new Refusal(del.reason);
				}
				if (refs.length > 0) {
					const alias = target?.alias ?? String(num);
					const sample = refs.slice(0, 5).map((r) => `${r.file}:${r.line}`).join(", ");
					if (!opts.force) {
						throw new Refusal(`Widget ${num} (alias "${alias}") is referenced in code in ${refs.length} place(s) (${sample}${refs.length > 5 ? ", ..." : ""}); use --force to remove it anyway`, { references: refs });
					}
					warnings.push(`--force: widget ${num} ("${alias}") is still referenced in code in ${refs.length} place(s) (${sample}); the code will not compile until it is updated`);
				} else if (!project) {
					warnings.push("No main.src next to the .rev: code references of the widget were not checked");
				}
				state = del.state;
			}
			return finish(original, rev, state, warnings);
		},
	});
}
