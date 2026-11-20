/** Pure ERD model built from the iRite project and/or the `.rev`. No `vscode` imports. */
import type { IriteProjectModel } from "../irite";
import type { RevModel } from "../rev";

export interface ErdField {
	name: string;
	type: string;
	size?: number;
	typeCode?: number;
}

export interface ErdTable {
	name: string;
	typeName?: string;
	alias: string;
	fields: ErdField[];
	maxRecords?: number;
	source?: { file: string; line: number };
	origin: "source" | "rev" | "both";
}

export interface ErdRelation {
	from: { table: string; field: string };
	to: { table: string; field: string };
	kind: "inferred";
}

export interface ErdDiagnostic {
	severity: "warning" | "info";
	message: string;
}

export interface Erd {
	tables: ErdTable[];
	relations: ErdRelation[];
	diagnostics: ErdDiagnostic[];
}

const lc = (s: string): string => s.toLowerCase();

function normType(t: string): string | undefined {
	const x = lc(t);
	return x === "integer" || x === "real" || x === "string" ? x : undefined;
}

/**
 * Merge key: table alias, case-insensitive. A source table whose alias has no
 * `.rev` match falls back to its type name (`type tProduct is database ("Product")`
 * is matched on "Product" first, then on the type name).
 */
export function buildErd(project?: IriteProjectModel, rev?: RevModel): Erd {
	const diagnostics: ErdDiagnostic[] = [];
	const tables: ErdTable[] = [];
	const revByName = new Map<string, RevModel["databases"][number]>();
	for (const d of rev?.databases ?? []) {
		if (d.name !== "" && !revByName.has(lc(d.name))) {
			revByName.set(lc(d.name), d);
		}
	}
	const used = new Set<string>();

	for (const s of project?.databases ?? []) {
		const alias = s.alias || s.typeName;
		const r = revByName.get(lc(alias)) && !used.has(lc(alias)) ? revByName.get(lc(alias)) : !used.has(lc(s.typeName)) ? revByName.get(lc(s.typeName)) : undefined;
		const fields: ErdField[] = s.fields.map((f) => ({ name: f.name, type: f.type }));
		const table: ErdTable = { name: alias, typeName: s.typeName, alias, fields, source: { file: s.file, line: s.line }, origin: "source" };
		if (r) {
			used.add(lc(r.name));
			table.origin = "both";
			table.maxRecords = r.maxRecords;
			const revFields = new Map(r.fields.map((f) => [lc(f.name), f]));
			const seen = new Set<string>();
			for (const f of fields) {
				seen.add(lc(f.name));
				const rf = revFields.get(lc(f.name));
				if (!rf) {
					diagnostics.push({ severity: "warning", message: `${alias}: field "${f.name}" exists in source but not in .rev` });
					continue;
				}
				f.size = rf.size;
				f.typeCode = rf.typeCode;
				const a = normType(f.type);
				const b = rf.typeName === "unknown" ? undefined : rf.typeName;
				if (a && b && a !== b) {
					diagnostics.push({ severity: "warning", message: `${alias}: field "${f.name}" is ${f.type} in source but ${rf.typeName} in .rev` });
				}
			}
			for (const rf of r.fields) {
				if (!seen.has(lc(rf.name))) {
					fields.push({ name: rf.name, type: rf.typeName, size: rf.size, typeCode: rf.typeCode });
					diagnostics.push({ severity: "warning", message: `${alias}: field "${rf.name}" exists in .rev but not in source` });
				}
			}
		} else if (rev) {
			diagnostics.push({ severity: "warning", message: `Table "${alias}" exists in source but not in .rev` });
		}
		tables.push(table);
	}

	for (const r of rev?.databases ?? []) {
		if (used.has(lc(r.name)) || r.name === "") {
			continue;
		}
		tables.push({
			name: r.name,
			alias: r.name,
			maxRecords: r.maxRecords,
			origin: "rev",
			fields: r.fields.map((f) => ({ name: f.name, type: f.typeName, size: f.size, typeCode: f.typeCode })),
		});
		if (project) {
			diagnostics.push({ severity: "warning", message: `Table "${r.name}" exists in .rev but not in source` });
		}
	}

	return { tables, relations: inferRelations(tables), diagnostics };
}

function singular(s: string): string {
	if (/ies$/.test(s) && s.length > 4) {
		return s.slice(0, -3) + "y";
	}
	if (/s$/.test(s) && !/ss$/.test(s) && s.length > 3) {
		return s.slice(0, -1);
	}
	return s;
}

function plural(s: string): string {
	return /y$/.test(s) ? s.slice(0, -1) + "ies" : s + "s";
}

/** Case-sensitive stem of `VehicleId` / `Vehicle_ID` / `IdVehicle` / `Id_Vehicle`; undefined if not an id-style name. */
function idStem(field: string): string | undefined {
	const m = /^(.+?)_?(?:Id|ID)$/.exec(field) ?? /^(?:Id|ID)_?([A-Z0-9].*)$/.exec(field);
	if (!m) {
		return undefined;
	}
	const x = m[1].replace(/_$/, "");
	return x.length >= 3 ? x : undefined;
}

/**
 * Inferred relations (naming heuristics only; the `.rev` has no foreign keys):
 *  1. A field `<X>Id`, `<X>ID`, `<X>_Id`, `Id<X>` (X >= 3 chars) points to the table whose
 *     name equals X (or its singular/plural form); failing that, the single table whose name
 *     starts with X or one of its forms (Cust -> Customer). Several candidates = ambiguous = no
 *     relation. The target field is `Id`/`ID`, else the table's first field.
 *  2. A non-key field (not first in its table, not named Id) whose name equals the first field
 *     (key) of another table, when heuristic 1 produced nothing for it.
 * Never relates a table to itself. Every relation is `inferred`.
 */
function inferRelations(tables: ErdTable[]): ErdRelation[] {
	const out: ErdRelation[] = [];
	const push = (from: ErdTable, ff: string, to: ErdTable, tf: string): void => {
		out.push({ from: { table: from.name, field: ff }, to: { table: to.name, field: tf }, kind: "inferred" });
	};
	for (const t of tables) {
		t.fields.forEach((f, idx) => {
			const others = tables.filter((o) => o !== t && o.fields.length > 0 && lc(o.name) !== lc(t.name));
			const stem = idStem(f.name);
			if (stem) {
				const forms = [...new Set([lc(stem), lc(singular(stem)), lc(plural(stem))])];
				let cands = others.filter((o) => forms.includes(lc(o.name)));
				if (cands.length === 0) {
					cands = others.filter((o) => forms.some((x) => lc(o.name).startsWith(x)));
				}
				if (cands.length === 1) {
					const target = cands[0];
					const key = target.fields.find((x) => lc(x.name) === "id") ?? target.fields[0];
					push(t, f.name, target, key.name);
					return;
				}
				if (cands.length > 1) {
					return;
				}
			}
			if (idx === 0 || lc(f.name) === "id") {
				return;
			}
			for (const o of others) {
				if (lc(o.fields[0].name) === lc(f.name)) {
					push(t, f.name, o, o.fields[0].name);
				}
			}
		});
	}
	return out;
}
