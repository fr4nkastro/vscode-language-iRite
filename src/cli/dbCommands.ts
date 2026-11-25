/**
 * `db add-table | rm-table | add-field | set-field | rm-field | move-field` of the headless CLI (pure: no `vscode`).
 * Edits, validation (names, reserved words, v308 limits, sizes, default size on type change) and the byte-preserving
 * save plan with ConfigHash and readback all come from the database schema editor's pure logic (`src/dbschema/`),
 * so the CLI writes exactly what the editor would; the shared safety rules (dry-run, `--write`, `--expect-hash`,
 * backup, atomic replace, readback) live in `./writeCore`. `main.iri` is never written: a warning says it must be
 * regenerated (`regen-iri`) and that renamed/deleted/reordered fields can break code and DB access routines.
 */
import { parseRev } from "../rev";
import { RevWriteError } from "../rev/serialize";
import { editableFieldType, fieldType, fieldTypes } from "../dbschema/fieldTypes";
import { dbIriHint } from "../dbschema/iriHint";
import { createDbSchema, editDbSchema, validateDbSchema } from "../dbschema/model";
import type { DbEdit, DbField, DbSchema, DbTable } from "../dbschema/model";
import { planDbSave } from "../dbschema/save";
import type { CliIo } from "./revCli";
import { Refusal, runWriteCommand, usageFailure } from "./writeCore";
import type { Planned, WriteResult } from "./writeCore";

const SUBS = ["add-table", "rm-table", "add-field", "set-field", "rm-field", "move-field"] as const;
type Sub = (typeof SUBS)[number];
/** Positional arguments after the file (set-field's `key=value` pairs come after these). */
const POSITIONALS: Record<Sub, { names: string[]; usage: string }> = {
	"add-table": { names: ["Name"], usage: "db add-table <file.rev> <Name> [--records n] [--field Name:type[:size]...]" },
	"rm-table": { names: ["Name"], usage: "db rm-table <file.rev> <Name>" },
	"add-field": { names: ["Table", "Field", "type"], usage: "db add-field <file.rev> <Table> <Field> <type> [--size n] [--at pos]" },
	"set-field": { names: ["Table", "Field"], usage: "db set-field <file.rev> <Table> <Field> [name=<new>] [type=<t>] [size=<n>]" },
	"rm-field": { names: ["Table", "Field"], usage: "db rm-field <file.rev> <Table> <Field>" },
	"move-field": { names: ["Table", "Field", "pos"], usage: "db move-field <file.rev> <Table> <Field> <pos>" },
};

interface Opts {
	write: boolean;
	dryRun: boolean;
	expectHash?: string;
	records?: number;
	size?: number;
	at?: number;
	fields: string[];
	positional: string[];
}

const INT = /^\d{1,9}$/;

function parseOpts(sub: Sub, rest: string[]): Opts | string {
	const o: Opts = { write: false, dryRun: false, fields: [], positional: [] };
	for (let i = 0; i < rest.length; i++) {
		const a = rest[i];
		if (a === "--write") {
			o.write = true;
		} else if (a === "--dry-run") {
			o.dryRun = true;
		} else if (a === "--expect-hash") {
			const v = rest[++i];
			if (v === undefined || !/^[0-9a-fA-F]{64}$/.test(v)) {
				return "--expect-hash needs a SHA-256 as 64 hexadecimal characters";
			}
			o.expectHash = v;
		} else if ((a === "--records" && sub === "add-table") || (a === "--size" && sub === "add-field") || (a === "--at" && sub === "add-field")) {
			const v = rest[++i];
			if (v === undefined || !INT.test(v)) {
				return `${a} must be a non-negative integer, got "${v ?? ""}"`;
			}
			if (a === "--records") o.records = Number(v);
			else if (a === "--size") o.size = Number(v);
			else o.at = Number(v);
		} else if (a === "--field" && sub === "add-table") {
			const v = rest[++i];
			if (v === undefined) {
				return "--field needs Name:type[:size]";
			}
			o.fields.push(v);
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

const norm = (s: string): string => s.toLowerCase().replace(/[\s_-]+/g, "");
const typeList = (): string => fieldTypes.filter((t) => t.code !== 0).map((t) => `${t.code}=${t.name}`).join(", ");

/** Revolution name (as the editor shows it; case and spacing tolerant) or numeric code 0..8. */
export function parseFieldType(text: string): number {
	const t = text.trim();
	if (/^\d+$/.test(t)) {
		const code = Number(t);
		if (!fieldType(code)) {
			throw new Refusal(`Unknown type code ${t}; known types: ${typeList()}`);
		}
		return code;
	}
	const hit = fieldTypes.find((f) => norm(f.name) === norm(t));
	if (!hit) {
		throw new Refusal(`Unknown type "${text}"; known types: ${typeList()}`);
	}
	return hit.code;
}

function findTable(model: DbSchema, name: string): DbTable {
	const hit = model.tables.find((t) => t.name === name) ?? model.tables.find((t) => t.name.toLowerCase() === name.toLowerCase());
	if (!hit) {
		throw new Refusal(`Table "${name}" does not exist (tables: ${model.tables.map((t) => t.name).join(", ") || "none"})`);
	}
	return hit;
}

function findField(table: DbTable, name: string): number {
	let i = table.fields.findIndex((f) => f.name === name);
	if (i < 0) i = table.fields.findIndex((f) => f.name.toLowerCase() === name.toLowerCase());
	if (i < 0) {
		throw new Refusal(`Field "${name}" does not exist in table ${table.name} (fields: ${table.fields.map((f) => f.name).join(", ") || "none"})`);
	}
	return i;
}

const describe = (f: Pick<DbField, "name" | "typeCode" | "size">) => ({ name: f.name, typeCode: f.typeCode, type: fieldType(f.typeCode)?.name ?? "Unknown", size: f.size });
const describeTable = (t: DbTable) => ({ index: t.index, name: t.name, maxRecords: t.maxRecords, fields: t.fields.map(describe) });

const IRI_WARNING =
	"main.iri is NOT regenerated by this command (use regen-iri): the database types and the <Table>_<Field> column-index constants change. Renamed, deleted or reordered tables/fields can break existing code and DB access routines; check them.";

function apply(model: DbSchema, edit: DbEdit): DbSchema {
	try {
		return editDbSchema(model, edit);
	} catch (e) {
		throw new Refusal(e instanceof Error ? e.message : String(e));
	}
}

export function runDbCommand(argv: string[], io: CliIo): WriteResult {
	const [, sub, file, ...rest] = argv;
	const command = `db ${sub ?? ""}`.trim();
	if (!sub || !(SUBS as readonly string[]).includes(sub)) {
		return usageFailure(command, undefined, sub ? `Unknown db subcommand "${sub}" (expected ${SUBS.join(", ")})` : `Missing db subcommand (${SUBS.join(", ")})`);
	}
	const s = sub as Sub;
	if (!file) {
		return usageFailure(command, undefined, "Missing <file.rev>");
	}
	const opts = parseOpts(s, rest);
	if (typeof opts === "string") {
		return usageFailure(command, file, opts);
	}
	const spec = POSITIONALS[s];
	const kv: Array<[string, string]> = [];
	let args = opts.positional;
	if (s === "set-field") {
		args = opts.positional.slice(0, 2);
		for (const a of opts.positional.slice(2)) {
			const eq = a.indexOf("=");
			const key = eq < 1 ? "" : a.slice(0, eq);
			if (!["name", "type", "size"].includes(key)) {
				return usageFailure(command, file, `Expected name=, type= or size=, got "${a}"`);
			}
			if (kv.some(([k]) => k === key)) {
				return usageFailure(command, file, `Duplicate ${key}=`);
			}
			kv.push([key, a.slice(eq + 1)]);
		}
		const sz = kv.find(([k]) => k === "size");
		if (sz && !INT.test(sz[1])) {
			return usageFailure(command, file, `size must be a non-negative integer, got "${sz[1]}"`);
		}
	}
	if (args.length < spec.names.length) {
		return usageFailure(command, file, `Missing <${spec.names[args.length]}>. Usage: ${spec.usage}`);
	}
	if (args.length > spec.names.length) {
		return usageFailure(command, file, `Unexpected argument "${args[spec.names.length]}". Usage: ${spec.usage}`);
	}
	if (s === "set-field" && kv.length === 0) {
		return usageFailure(command, file, "db set-field needs at least one of name=, type=, size=");
	}
	if (s === "move-field" && !INT.test(args[2])) {
		return usageFailure(command, file, `<pos> must be a 1-based integer, got "${args[2]}"`);
	}

	return runWriteCommand({
		command,
		file,
		write: opts.write,
		expectHash: opts.expectHash,
		io,
		plan: (original) => planDb(s, args, kv, opts, original),
	});
}

function planDb(s: Sub, args: string[], kv: Array<[string, string]>, opts: Opts, original: Buffer): Planned {
	let before: DbSchema;
	try {
		before = createDbSchema(parseRev(original.toString("utf8")));
	} catch (e) {
		throw new Refusal(`Cannot edit the database schema: ${e instanceof Error ? e.message : String(e)}`);
	}
	let model = before;
	let changes: unknown[];
	if (s === "add-table") {
		const name = args[0];
		if (before.tables.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
			throw new Refusal(`Table "${name}" already exists`);
		}
		model = apply(model, { kind: "addTable", name, maxRecords: opts.records ?? 1 });
		const index = model.tables[model.tables.length - 1].index;
		for (const spec of opts.fields) {
			const [fname, ftype, fsize, extra] = spec.split(":");
			if (!fname || !ftype || extra !== undefined || (fsize !== undefined && !INT.test(fsize))) {
				throw new Refusal(`--field must be Name:type[:size], got "${spec}"`);
			}
			const typeCode = parseFieldType(ftype);
			const size = fsize !== undefined ? Number(fsize) : (editableFieldType(typeCode)?.defaultSize ?? 0);
			model = apply(model, { kind: "addField", table: index, name: fname, typeCode, size });
		}
		changes = [{ op: "addTable", table: describeTable(model.tables[model.tables.length - 1]) }];
	} else {
		const table = findTable(before, args[0]);
		if (s === "rm-table") {
			model = apply(model, { kind: "deleteTable", table: table.index });
			changes = [{ op: "rmTable", table: describeTable(table) }];
		} else if (s === "add-field") {
			const typeCode = parseFieldType(args[2]);
			const type = editableFieldType(typeCode);
			if (!type) {
				throw new Refusal(`Type code ${typeCode} (${fieldType(typeCode)?.name}) cannot be added; use one of ${typeList()}`);
			}
			if (table.fields.some((f) => f.name.toLowerCase() === args[1].toLowerCase())) {
				throw new Refusal(`Field "${args[1]}" already exists in table ${table.name}`);
			}
			const size = opts.size ?? type.defaultSize;
			const last = table.fields.length;
			const at = opts.at ?? last + 1;
			if (at < 1 || at > last + 1) {
				throw new Refusal(`--at ${at} is out of range (1..${last + 1})`);
			}
			model = apply(model, { kind: "addField", table: table.index, name: args[1], typeCode, size });
			if (at - 1 !== last) {
				model = apply(model, { kind: "moveField", table: table.index, from: last, to: at - 1 });
			}
			changes = [{ op: "addField", table: table.name, position: at, field: describe({ name: args[1], typeCode, size }) }];
		} else if (s === "rm-field") {
			const i = findField(table, args[1]);
			model = apply(model, { kind: "deleteField", table: table.index, field: i });
			changes = [{ op: "rmField", table: table.name, position: i + 1, field: describe(table.fields[i]) }];
		} else if (s === "move-field") {
			const i = findField(table, args[1]);
			const pos = Number(args[2]);
			if (pos < 1 || pos > table.fields.length) {
				throw new Refusal(`Position ${pos} is out of range (1..${table.fields.length})`);
			}
			model = apply(model, { kind: "moveField", table: table.index, from: i, to: pos - 1 });
			changes = pos - 1 === i ? [] : [{ op: "moveField", table: table.name, field: table.fields[i].name, from: i + 1, to: pos }];
		} else {
			const i = findField(table, args[1]);
			const cur = table.fields[i];
			const get = (k: string) => kv.find(([key]) => key === k)?.[1];
			const newType = get("type") !== undefined ? parseFieldType(get("type") as string) : undefined;
			const newSize = get("size") !== undefined ? Number(get("size")) : undefined;
			const newName = get("name");
			if (newName !== undefined && newName !== cur.name && table.fields.some((f, j) => j !== i && f.name.toLowerCase() === newName.toLowerCase())) {
				throw new Refusal(`Field "${newName}" already exists in table ${table.name}`);
			}
			model = apply(model, { kind: "updateField", table: table.index, field: i, changes: { name: newName, typeCode: newType, size: newSize } });
			const after = model.tables.find((t) => t.index === table.index)!.fields[i];
			if (newSize !== undefined && after.size !== newSize) {
				throw new Refusal(`size=${newSize} does not apply to ${fieldType(after.typeCode)?.name} (its size is ${after.size})`);
			}
			const diff: Record<string, { from: string | number; to: string | number }> = {};
			if (after.name !== cur.name) diff.name = { from: cur.name, to: after.name };
			if (after.typeCode !== cur.typeCode) diff.type = { from: describe(cur).type, to: describe(after).type };
			if (after.size !== cur.size) diff.size = { from: cur.size, to: after.size };
			changes = Object.keys(diff).length ? [{ op: "setField", table: table.name, field: cur.name, position: i + 1, changes: diff }] : [];
		}
	}

	const checked = validateDbSchema(model, before);
	if (checked.errors.length > 0) {
		throw new Refusal(checked.errors.join("; "), { errors: checked.errors });
	}
	let plan: ReturnType<typeof planDbSave>;
	try {
		plan = planDbSave(original, model);
	} catch (e) {
		if (e instanceof RevWriteError) throw e;
		throw new Refusal(e instanceof Error ? e.message : String(e));
	}
	if (!plan) {
		return { changes: [], warnings: [...checked.warnings] };
	}
	return { bytes: plan.bytes, changes, warnings: [...checked.warnings, IRI_WARNING], extra: { iriHint: dbIriHint(plan.model) } };
}
