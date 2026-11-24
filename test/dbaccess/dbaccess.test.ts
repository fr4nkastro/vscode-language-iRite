import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadIriteProject, parseIriteSource } from '../../src/irite';
import type { IriteDatabase } from '../../src/irite';
import {
	DEFAULT_OPTIONS,
	PENDING_MARKER,
	applyScaffold,
	buildPendingJson,
	checkDbAccess,
	deriveExpected,
	formatTableMessage,
	planIncludeInsertion,
	renderStub,
	tableName,
} from '../../src/dbaccess';

const root = path.join(__dirname, '..', 'fixtures', 'dbaccess');
const mainSrc = path.join(root, 'main.src');
const readDisk = (p: string): string | undefined => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : undefined);
const rel = (p: string) => path.relative(root, p).split(path.sep).join('/');
const fixtureProject = (read = readDisk) => loadIriteProject(mainSrc, read);
const fixtureReport = (read = readDisk) => checkDbAccess(fixtureProject(read), read, DEFAULT_OPTIONS);

/** In-memory project: keys are project-relative paths. */
function memProject(files: Record<string, string>) {
	const map = new Map(Object.entries(files).map(([k, v]) => [path.normalize(path.join('/proj', k)), v]));
	const read = (p: string) => map.get(path.normalize(p));
	return { project: loadIriteProject(path.join('/proj', 'main.src'), read), read };
}

const db = (text: string): IriteDatabase => parseIriteSource(text, 'main.iri').databases[0];
const TRANS = 'type TransDatabase is database ("Trans")\n Id: Integer;\n Ticket: Integer;\n InWeight: Real;\n NetW: Real;\nend database;';
const MAIN_SRC = 'program main;\n#include main.iri\n#include db.iri\nbegin\nend main;\n';

/** A fully implemented module for TRANS: every stub with its marker removed. */
const implemented = (): string =>
	deriveExpected(db(TRANS), 'db').map(e => renderStub(e).replace(PENDING_MARKER, '-- implemented')).join('\n');

describe('deriveExpected', () => {
	it('parses database declarations identically with CRLF and LF', () => {
		const crlf = TRANS.replace(/\n/g, '\r\n');
		expect(db(crlf)).toEqual(db(TRANS));
		expect(deriveExpected(db(crlf), 'db')).toEqual(deriveExpected(db(TRANS), 'db'));
	});
	it('derives the standard set from the declaration (4 CRUD + record + 2 per field + search)', () => {
		const exp = deriveExpected(db(TRANS), 'db');
		expect(exp.map(e => e.name)).toEqual([
			'dbTransCreate', 'dbTransRead', 'dbTransUpdate', 'dbTransDelete', 'dbTransGetRecord',
			'dbTransGetId', 'dbTransGetTicket', 'dbTransGetInWeight', 'dbTransGetNetW',
			'dbTransSetId', 'dbTransSetTicket', 'dbTransSetInWeight', 'dbTransSetNetW',
			'dbTransSearch',
		]);
	});

	it('uses the table alias, falling back to the type name without the Database suffix', () => {
		expect(tableName(db(TRANS))).toBe('Trans');
		expect(tableName(db('type Foo is database ()\n A: Integer;\nend database;'))).toBe('Foo');
		expect(tableName(db('type BarDatabase is database\n A: Integer;\nend database;'))).toBe('Bar');
	});

	it('renders house-style signatures (SysCode, var outputs, key = first field)', () => {
		const sig = Object.fromEntries(deriveExpected(db(TRANS), 'db').map(e => [e.name, e.signature]));
		expect(sig.dbTransCreate).toBe('function dbTransCreate(iId: integer; iTicket: integer; rInWeight: real; rNetW: real): SysCode;');
		expect(sig.dbTransRead).toBe('function dbTransRead(iId: integer): SysCode;');
		expect(sig.dbTransGetRecord).toBe('function dbTransGetRecord(iId: integer; var vRecord: TransDatabase): SysCode;');
		expect(sig.dbTransGetInWeight).toBe('function dbTransGetInWeight(iId: integer; var vValue: real): SysCode;');
		expect(sig.dbTransSetNetW).toBe('function dbTransSetNetW(iId: integer; value: real): SysCode;');
		expect(sig.dbTransSearch).toBe('function dbTransSearch(sColumn: string; sValue: string; var vResult: integer): SysCode;');
	});

	it('honors a custom (even empty) prefix', () => {
		expect(deriveExpected(db(TRANS), '')[0].name).toBe('TransCreate');
		expect(deriveExpected(db(TRANS), 'xx')[0].name).toBe('xxTransCreate');
	});

	it('drops a derived name that collides case-insensitively with an earlier one', () => {
		const exp = deriveExpected(db('type TDatabase is database ("T")\n Id: Integer;\n Record: String;\nend database;'), 'db');
		const lower = exp.map(e => e.name.toLowerCase());
		expect(new Set(lower).size).toBe(lower.length);
		expect(exp.find(e => e.name.toLowerCase() === 'dbtgetrecord')!.group).toBe('record');
	});

	it('returns nothing for a table without fields', () => {
		expect(deriveExpected(db('type E is database ("E")\nend database;'), 'db')).toEqual([]);
	});
});

describe('checkDbAccess', () => {
	it('reports every table; missing vs pending (marker) vs present (case-insensitive name match)', () => {
		const rep = fixtureReport();
		expect(rep.tables.map(t => t.table).sort()).toEqual(['Settings', 'Trans', 'Vehicles']);
		const trans = rep.tables.find(t => t.table === 'Trans')!;
		const status = (n: string) => trans.items.find(i => i.expected.name === n)?.status;
		expect(status('dbTransCreate')).toBeUndefined(); // implemented
		expect(status('dbTransDelete')).toBeUndefined(); // implemented, declared as DBTRANSDELETE
		expect(status('dbTransGetInWeight')).toBe('pending');
		expect(status('dbTransGetNetW')).toBe('missing');
		expect(trans.items.filter(i => i.status === 'pending')).toHaveLength(1);
		expect(trans.items).toHaveLength(12);
		const pending = trans.items.find(i => i.status === 'pending')!;
		expect(rel(pending.stub!.file)).toBe('src/db/Trans.iri');
		expect(pending.stub!.line).toBe(14);
		expect(rel(trans.file)).toBe('main.iri');
		expect(trans.line).toBe(6);
	});

	it('every table with missing routines is reported with all of them (Vehicles: 2 fields)', () => {
		const veh = fixtureReport().tables.find(t => t.table === 'Vehicles')!;
		expect(veh.expected).toBe(4 + 1 + 2 * 2 + 1);
		expect(veh.items).toHaveLength(veh.expected);
		expect(veh.items.every(i => i.status === 'missing')).toBe(true);
	});

	it('produces no items for a table with the full routine set', () => {
		const { project, read } = memProject({ 'main.src': MAIN_SRC, 'main.iri': TRANS, 'db.iri': implemented() });
		const rep = checkDbAccess(project, read, DEFAULT_OPTIONS);
		expect(rep.tables).toHaveLength(1);
		expect(rep.tables[0].items).toEqual([]);
		expect(formatTableMessage(rep.tables[0])).toBe('');
	});

	it('adding a field to the table makes its getter and setter appear as missing', () => {
		const { project, read } = memProject({
			'main.src': MAIN_SRC,
			'main.iri': TRANS.replace('NetW: Real;', 'NetW: Real;\n OutDT: String;'),
			'db.iri': implemented(),
		});
		const rep = checkDbAccess(project, read, DEFAULT_OPTIONS);
		expect(rep.tables[0].items.map(i => [i.expected.name, i.status])).toEqual([
			['dbTransGetOutDT', 'missing'],
			['dbTransSetOutDT', 'missing'],
		]);
	});

	it('a routine stays pending until the marker is removed', () => {
		const stubs = deriveExpected(db(TRANS), 'db').map(e => renderStub(e)).join('\n');
		const { project, read } = memProject({ 'main.src': MAIN_SRC, 'main.iri': TRANS, 'db.iri': stubs });
		const rep = checkDbAccess(project, read, DEFAULT_OPTIONS);
		expect(rep.tables[0].items.every(i => i.status === 'pending')).toBe(true);
		expect(rep.tables[0].items).toHaveLength(14);
	});

	it('honors exclusions per table and per group (case-insensitive, `*` = every table)', () => {
		const rep = checkDbAccess(fixtureProject(), readDisk, { ...DEFAULT_OPTIONS, exclusions: ['Settings', 'vehicles:search', '*:setters'] });
		const settings = rep.tables.find(t => t.table === 'Settings')!;
		expect(settings.excluded).toBe(true);
		expect(settings.items).toEqual([]);
		const veh = rep.tables.find(t => t.table === 'Vehicles')!;
		expect(veh.items.some(i => i.expected.group === 'search')).toBe(false);
		expect(veh.items.some(i => i.expected.group === 'setters')).toBe(false);
		expect(veh.items.some(i => i.expected.group === 'getters')).toBe(true);
	});
});

describe('formatTableMessage', () => {
	it('lists missing and pending routines and truncates long lists', () => {
		const trans = fixtureReport().tables.find(t => t.table === 'Trans')!;
		const msg = formatTableMessage(trans, 3);
		expect(msg).toContain('Table Trans: missing routines dbTransRead, dbTransUpdate, dbTransGetRecord (+8 more)');
		expect(msg).toContain('pending implementation: dbTransGetInWeight');
		const full = formatTableMessage(trans, 100);
		expect(full).toContain('dbTransSearch');
		expect(full).not.toContain('more)');
	});

	it('says only "pending implementation" when nothing is missing', () => {
		const stubs = deriveExpected(db(TRANS), 'db').map(e => renderStub(e)).join('\n');
		const { project, read } = memProject({ 'main.src': MAIN_SRC, 'main.iri': TRANS, 'db.iri': stubs });
		const msg = formatTableMessage(checkDbAccess(project, read, DEFAULT_OPTIONS).tables[0], 2);
		expect(msg).toBe('Table Trans: pending implementation: dbTransCreate, dbTransRead (+12 more)');
	});
});

describe('scaffold', () => {
	it('stubs carry the pending marker, fail loudly and parse without diagnostics', () => {
		for (const e of deriveExpected(db(TRANS), 'db')) {
			const text = renderStub(e);
			expect(text).toContain(PENDING_MARKER);
			expect(text).toContain('return SysInvalidRequest;');
			const m = parseIriteSource(text, 'x.iri');
			expect(m.diagnostics).toEqual([]);
			expect(m.routines.map(r => r.name)).toEqual([e.name]);
			expect(m.routines[0].params.map(p => p.name)).toEqual(e.params.map(p => p.name));
		}
	});

	const args = (table: string, read = readDisk) => ({
		report: fixtureReport(read),
		table,
		mainSrcPath: mainSrc,
		readText: read,
		options: DEFAULT_OPTIONS,
	});

	it('appends only missing routines to an existing table module and never rewrites existing text', () => {
		const existing = readDisk(path.join(root, 'src', 'db', 'Trans.iri'))!;
		const edits = applyScaffold(args('Trans'));
		const file = edits.files.find(f => rel(f.path) === 'src/db/Trans.iri')!;
		expect(file.text.startsWith(existing)).toBe(true);
		expect(edits.added).toHaveLength(11); // 14 - 2 implemented - 1 pending
		expect(edits.added).not.toContain('dbTransGetInWeight');
		expect(file.text.match(/function dbTransGetInWeight/gi)).toHaveLength(1);
		expect(edits.mainSrc).toBeUndefined(); // module already included
	});

	it('creates a new module, includes it right after the declaring file, and is idempotent', () => {
		const first = applyScaffold(args('Vehicles'));
		expect(first.files.map(f => rel(f.path))).toEqual(['src/db/Vehicles.iri']);
		expect(first.mainSrc!.text.split(/\r?\n/).slice(0, 5)).toEqual([
			'program main;', '', '--Generated', '#include main.iri', '#include src\\db\\Vehicles.iri',
		]);
		// Re-run on the produced state: stubs are now pending, nothing to add, include not duplicated.
		const state = new Map([[first.files[0].path, first.files[0].text], [first.mainSrc!.path, first.mainSrc!.text]]);
		const read = (p: string) => state.get(p) ?? readDisk(p);
		const second = applyScaffold(args('Vehicles', read));
		expect(second.added).toEqual([]);
		expect(second.files).toEqual([]);
		expect(second.mainSrc).toBeUndefined();
		const veh = fixtureReport(read).tables.find(t => t.table === 'Vehicles')!;
		expect(veh.items.every(i => i.status === 'pending')).toBe(true);
	});

	it('planIncludeInsertion is idempotent, keeps CRLF and ignores commented includes', () => {
		const src = 'program main;\r\n#include main.iri\r\n--#include src\\db\\T.iri\r\n#include a.iri\r\nbegin\r\nend main;\r\n';
		const r = planIncludeInsertion(src, 'main.iri', 'src\\db\\T.iri');
		expect(r.changed).toBe(true);
		expect(r.text).toBe(
			'program main;\r\n#include main.iri\r\n#include src\\db\\T.iri\r\n--#include src\\db\\T.iri\r\n#include a.iri\r\nbegin\r\nend main;\r\n',
		);
		expect(planIncludeInsertion(r.text, 'main.iri', 'SRC\\DB\\t.iri').changed).toBe(false);
		// declaring file not directly included: after the last include
		const r2 = planIncludeInsertion('program main;\n#include a.iri\nbegin\nend main;\n', 'zzz.iri', 'src\\db\\T.iri');
		expect(r2.text).toBe('program main;\n#include a.iri\n#include src\\db\\T.iri\nbegin\nend main;\n');
	});
});

describe('buildPendingJson', () => {
	it('lists missing and pending items with a version field and stable keys', () => {
		const json = buildPendingJson(fixtureReport(), { mainSrcPath: mainSrc, options: DEFAULT_OPTIONS });
		expect(json.schema).toBe('irite.dbAccess.pending');
		expect(json.version).toBe(1);
		expect(json.convention.pendingMarker).toBe('TODO(irite-db): pending implementation');
		const item = json.items.find(i => i.routine === 'dbTransGetInWeight')!;
		expect(item).toMatchObject({
			table: 'Trans', typeName: 'TransDatabase', field: 'InWeight', group: 'getters', operation: 'Get',
			status: 'pending', stub: { file: 'src/db/Trans.iri', line: 14 },
			signature: 'function dbTransGetInWeight(iId: integer; var vValue: real): SysCode;',
			scaffoldTarget: 'src/db/Trans.iri',
		});
		const missing = json.items.find(i => i.routine === 'dbVehiclesSearch')!;
		expect(missing.status).toBe('missing');
		expect(missing.stub).toBeNull();
		expect(missing.field).toBeNull();
		expect(missing.scaffoldTarget).toBe('src/db/Vehicles.iri');
		expect(json.tables.find(t => t.table === 'Trans')).toMatchObject({ expected: 14, missing: 11, pending: 1 });
		expect(JSON.parse(JSON.stringify(json))).toEqual(json);
	});

	it('omits complete and excluded tables from items', () => {
		const json = buildPendingJson(
			checkDbAccess(fixtureProject(), readDisk, { ...DEFAULT_OPTIONS, exclusions: ['Settings'] }),
			{ mainSrcPath: mainSrc, options: DEFAULT_OPTIONS },
		);
		expect(json.items.some(i => i.table === 'Settings')).toBe(false);
	});
});
