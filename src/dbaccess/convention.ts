/**
 * The IPESAH per-table data-access convention, in ONE place. Change the rules here and
 * diagnostics, scaffold and JSON follow. Pure: no `vscode` imports.
 *
 * For a table `T` with fields `F1..Fn` (the FIRST field is the key):
 *
 *   crud     <p>T Create(all fields) | Read(key) | Update(all fields) | Delete(key)
 *   record   <p>T GetRecord(key; var vRecord: <TypeName>)
 *   getters  <p>T Get<Fi>(key; var vValue: <type>)           one per field
 *   setters  <p>T Set<Fi>(key; value: <type>)                one per field
 *   search   <p>T Search(sColumn: string; sValue: string; var vResult: integer)
 *
 * Every routine is a `function ...: SysCode` (DB status codes, like the DB built-ins).
 * `<p>` is the configurable prefix (default `db`, the house prefix for database routines).
 */
import type { IriteDatabase, IriteField } from '../irite';

export type DbGroup = 'crud' | 'record' | 'getters' | 'setters' | 'search';
export const DB_GROUPS: readonly DbGroup[] = ['crud', 'record', 'getters', 'setters', 'search'];

/** Marker (without the leading `--`) that keeps a routine "pending" until it is removed. */
export const PENDING_MARKER_TEXT = 'TODO(irite-db): pending implementation';
export const PENDING_MARKER = `-- ${PENDING_MARKER_TEXT}`;

export interface DbAccessOptions {
	/** Routine-name prefix. Default `db`. */
	prefix: string;
	/** `Table` (whole table) or `Table:group`; `*` matches every table. Case-insensitive. */
	exclusions: string[];
	/** Project-relative folder of the generated per-table modules. Default `src/db`. */
	moduleFolder: string;
}

export const DEFAULT_OPTIONS: DbAccessOptions = { prefix: 'db', exclusions: [], moduleFolder: 'src/db' };

export interface ExpectedParam {
	name: string;
	type: string;
	/** Declared with `var` (copy-in/copy-out output). */
	byRef?: boolean;
}

export interface ExpectedRoutine {
	/** Table name: the database alias, else the type name without the `Database` suffix. */
	table: string;
	typeName: string;
	/** Field the routine is about (getters/setters only). */
	field?: string;
	group: DbGroup;
	/** `Create`, `Read`, `Update`, `Delete`, `GetRecord`, `Get`, `Set`, `Search`. */
	operation: string;
	name: string;
	params: ExpectedParam[];
	returnType: 'SysCode';
	/** Full declaration line, e.g. `function dbTransGetNetW(iId: integer; var vValue: real): SysCode;`. */
	signature: string;
	/** One-line intent, used for stub comments. */
	description: string;
}

/** Table name used in routine names and messages. */
export function tableName(db: IriteDatabase): string {
	const alias = db.alias.trim();
	if (alias !== '') {
		return alias;
	}
	const stripped = db.typeName.replace(/database$/i, '');
	return stripped !== '' ? stripped : db.typeName;
}

const TYPE_PREFIX: Record<string, string> = { integer: 'i', real: 'r', string: 's' };

/** `String[20]` -> `string`; unknown types are kept as written. */
function normType(t: string): string {
	const base = t.replace(/\[.*\]/, '').trim().toLowerCase();
	return base in TYPE_PREFIX ? base : t.trim();
}

function hungarian(f: IriteField): string {
	return `${TYPE_PREFIX[normType(f.type).toLowerCase()] ?? 't'}${f.name}`;
}

function paramOf(f: IriteField): ExpectedParam {
	return { name: hungarian(f), type: normType(f.type) };
}

function declaration(name: string, params: ExpectedParam[]): string {
	const list = params.map(p => `${p.byRef ? 'var ' : ''}${p.name}: ${p.type}`).join('; ');
	return `function ${name}(${list}): SysCode;`;
}

/** Expected routines for one table, in a stable order. A table without fields has none. */
export function deriveExpected(db: IriteDatabase, prefix: string): ExpectedRoutine[] {
	const fields = db.fields;
	if (fields.length === 0) {
		return [];
	}
	const table = tableName(db);
	const base = `${prefix}${table}`;
	const key = paramOf(fields[0]);
	const all = fields.map(paramOf);
	const out: ExpectedRoutine[] = [];
	const seen = new Set<string>();
	const add = (group: DbGroup, operation: string, suffix: string, params: ExpectedParam[], description: string, field?: string): void => {
		const name = `${base}${suffix}`;
		if (seen.has(name.toLowerCase())) {
			return; // iRite identifiers are case-insensitive: first derivation wins
		}
		seen.add(name.toLowerCase());
		out.push({
			table, typeName: db.typeName, group, operation, name, params, returnType: 'SysCode',
			signature: declaration(name, params), description, ...(field !== undefined ? { field } : {}),
		});
	};
	const keyName = fields[0].name;
	add('crud', 'Create', 'Create', all, `Insert a new ${table} record from all fields.`);
	add('crud', 'Read', 'Read', [key], `Find the ${table} record whose ${keyName} equals ${key.name}; SysNoSuchRecord when absent.`);
	add('crud', 'Update', 'Update', all, `Update the ${table} record whose ${keyName} equals ${all[0].name} with all fields.`);
	add('crud', 'Delete', 'Delete', [key], `Delete the ${table} record whose ${keyName} equals ${key.name}.`);
	add('record', 'GetRecord', 'GetRecord', [key, { name: 'vRecord', type: db.typeName, byRef: true }],
		`Copy the whole ${table} record whose ${keyName} equals ${key.name} into vRecord.`);
	for (const f of fields) {
		add('getters', 'Get', `Get${f.name}`, [key, { name: 'vValue', type: normType(f.type), byRef: true }],
			`Copy ${f.name} of the ${table} record whose ${keyName} equals ${key.name} into vValue.`, f.name);
	}
	for (const f of fields) {
		add('setters', 'Set', `Set${f.name}`, [key, { name: 'value', type: normType(f.type) }],
			`Set ${f.name} of the ${table} record whose ${keyName} equals ${key.name}.`, f.name);
	}
	add('search', 'Search', 'Search',
		[{ name: 'sColumn', type: 'string' }, { name: 'sValue', type: 'string' }, { name: 'vResult', type: 'integer', byRef: true }],
		`Find ${table} records where column sColumn equals sValue; vResult receives the DBExec result handle (caller runs DBFinalize).`);
	return out;
}

/** True when `exclusions` removes the whole table (`Table` or `*`) or the given group. */
export function isExcluded(exclusions: readonly string[], table: string, group?: DbGroup): boolean {
	const t = table.toLowerCase();
	for (const raw of exclusions) {
		const [name, grp] = raw.split(':').map(s => s.trim().toLowerCase());
		if (name !== t && name !== '*') {
			continue;
		}
		if (grp === undefined || grp === '') {
			if (name === t) {
				return true; // a bare `*` is ignored: it would disable the whole check
			}
			continue;
		}
		if (group !== undefined && grp === group) {
			return true;
		}
	}
	return false;
}
