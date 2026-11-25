/** Compares the expected DB access routines with the ones declared in the project. No `vscode` imports. */
import type { IriteProjectModel, IriteRoutine } from '../irite';
import {
	DB_GROUPS,
	isExcluded,
	deriveExpected,
	tableName,
	type DbAccessOptions,
	type ExpectedRoutine,
} from './convention';

export type RoutineStatus = 'missing' | 'pending';

export interface DbAccessItem {
	expected: ExpectedRoutine;
	status: RoutineStatus;
	/** Declaration of the existing stub (pending items only). */
	stub?: { file: string; line: number };
}

export interface TableReport {
	table: string;
	typeName: string;
	/** Location of the `type T is database` line. */
	file: string;
	line: number;
	/** Whole table excluded by the settings. */
	excluded: boolean;
	/** Number of expected routines after exclusions. */
	expected: number;
	/** Missing and pending routines, in convention order. Empty = complete. */
	items: DbAccessItem[];
}

export interface DbAccessReport {
	tables: TableReport[];
}

const MARKER_RE = /--\s*TODO\(irite-db\)\s*:\s*pending implementation/i;

/** A routine is pending while a line of its body still carries the marker comment. */
function isPending(r: IriteRoutine, readText: (file: string) => string | undefined): boolean {
	const text = readText(r.file);
	if (text === undefined) {
		return false;
	}
	const lines = text.split(/\r?\n/);
	for (let i = Math.max(0, r.startLine - 1); i < Math.min(lines.length, r.endLine); i++) {
		if (MARKER_RE.test(lines[i])) {
			return true;
		}
	}
	return false;
}

export function checkDbAccess(
	project: IriteProjectModel,
	readText: (file: string) => string | undefined,
	options: DbAccessOptions,
): DbAccessReport {
	const byName = new Map<string, IriteRoutine>();
	for (const r of project.routines) {
		const key = r.name.toLowerCase();
		// Prefer a definition over a forward declaration.
		if (!byName.has(key) || (byName.get(key)!.forward && !r.forward)) {
			byName.set(key, r);
		}
	}
	const tables: TableReport[] = [];
	const seen = new Set<string>();
	for (const db of project.databases) {
		const table = tableName(db);
		if (seen.has(table.toLowerCase())) {
			continue; // duplicate declaration of the same table
		}
		seen.add(table.toLowerCase());
		const base = { table, typeName: db.typeName, file: db.file, line: db.line };
		if (isExcluded(options.exclusions, table)) {
			tables.push({ ...base, excluded: true, expected: 0, items: [] });
			continue;
		}
		const groups = new Set(DB_GROUPS.filter(g => !isExcluded(options.exclusions, table, g)));
		const expected = deriveExpected(db, options.prefix).filter(e => groups.has(e.group));
		const items: DbAccessItem[] = [];
		for (const e of expected) {
			const found = byName.get(e.name.toLowerCase());
			if (!found) {
				items.push({ expected: e, status: 'missing' });
			} else if (isPending(found, readText)) {
				items.push({ expected: e, status: 'pending', stub: { file: found.file, line: found.line } });
			}
		}
		tables.push({ ...base, excluded: false, expected: expected.length, items });
	}
	return { tables };
}

/** Diagnostic text for a table; empty string when the table is complete. */
export function formatTableMessage(t: TableReport, maxNames = 8): string {
	const names = (status: RoutineStatus): string => {
		const list = t.items.filter(i => i.status === status).map(i => i.expected.name);
		return list.length > maxNames ? `${list.slice(0, maxNames).join(', ')} (+${list.length - maxNames} more)` : list.join(', ');
	};
	const parts: string[] = [];
	const missing = names('missing');
	if (missing !== '') {
		parts.push(`missing routines ${missing}`);
	}
	const pending = names('pending');
	if (pending !== '') {
		parts.push(`pending implementation: ${pending}`);
	}
	return parts.length === 0 ? '' : `Table ${t.table}: ${parts.join('; ')}`;
}

export interface TableDiagnostic {
	table: string;
	/** Location of the `type T is database` line (1-based). */
	file: string;
	line: number;
	message: string;
	/** Number of routines still missing (pending stubs are not counted). */
	missing: number;
}

/** One diagnostic per incomplete table: what the extension publishes to Problems and what `rev-cli diagnose` prints. */
export function tableDiagnostics(report: DbAccessReport): TableDiagnostic[] {
	const out: TableDiagnostic[] = [];
	for (const t of report.tables) {
		const message = formatTableMessage(t);
		if (message !== '') {
			out.push({ table: t.table, file: t.file, line: t.line, message, missing: t.items.filter(i => i.status === 'missing').length });
		}
	}
	return out;
}
