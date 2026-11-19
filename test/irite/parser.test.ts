import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadIriteProject, parseIriteSource } from '../../src/irite';

const root = path.join(__dirname, '..', 'fixtures', 'irite');
const readFile = (p: string): string | undefined => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : undefined);
const project = () => loadIriteProject(path.join(root, 'main.src'), readFile);
const rel = (p: string) => path.relative(root, p).split(path.sep).join('/');

describe('parseIriteSource', () => {
	it('parses databases with alias and fields', () => {
		const m = parseIriteSource('type Product is database ("Product")\n  Id : Integer;\n  Name : String; -- d\nend database;', 'a.iri');
		expect(m.databases).toEqual([
			{ file: 'a.iri', line: 1, typeName: 'Product', alias: 'Product', fields: [{ name: 'Id', type: 'Integer' }, { name: 'Name', type: 'String' }] },
		]);
	});

	it('parses single-line and multi-line enums with comments', () => {
		const m = parseIriteSource(
			'type T is (A, B, C);\ntype S is (\n  X, -- one\n  (* two *) Y,\n  Z\n);',
			'a.iri',
		);
		expect(m.enums).toEqual([
			{ file: 'a.iri', line: 1, name: 'T', members: ['A', 'B', 'C'] },
			{ file: 'a.iri', line: 2, name: 'S', members: ['X', 'Y', 'Z'] },
		]);
	});

	it('parses records, splitting grouped field names', () => {
		const m = parseIriteSource('type R is record\n a, b : integer;\n s : string[20];\nend record;', 'a.iri');
		expect(m.records).toEqual([
			{ file: 'a.iri', line: 1, name: 'R', fields: [{ name: 'a', type: 'integer' }, { name: 'b', type: 'integer' }, { name: 's', type: 'string[20]' }] },
		]);
	});

	it('parses constants (integer, string, real)', () => {
		const m = parseIriteSource('a : constant integer := 3;\nb : constant string := "x -- y";\nc : constant real := 1.5;', 'a.iri');
		expect(m.constants.map(c => [c.name, c.type, c.value, c.line])).toEqual([
			['a', 'integer', '3', 1],
			['b', 'string', '"x -- y"', 2],
			['c', 'real', '1.5', 3],
		]);
	});

	it('parses routines with params, return type and line range', () => {
		const m = parseIriteSource(
			'procedure P(a: integer; b, c: string);\nbegin\nend;\nfunction F(x: integer): real;\n  v: integer;\nbegin\n  return 1;\nend;\nhandler H;\nbegin\nend;',
			'a.iri',
		);
		const [p, f, h] = m.routines;
		expect(p).toMatchObject({ kind: 'procedure', name: 'P', startLine: 1, endLine: 3, params: [{ name: 'a', type: 'integer' }, { name: 'b', type: 'string' }, { name: 'c', type: 'string' }] });
		expect(f).toMatchObject({ kind: 'function', name: 'F', returnType: 'real', startLine: 4, endLine: 8, params: [{ name: 'x', type: 'integer' }] });
		expect(h).toMatchObject({ kind: 'handler', name: 'H', params: [], startLine: 9, endLine: 11 });
		expect(m.diagnostics).toEqual([]);
	});

	it('collects calls with raw args and nested if/elsif/else conditions', () => {
		const m = parseIriteSource(
			[
				'procedure P;',
				'begin',
				'  if a = 1 then',
				'    X(1, Foo(2, 3), "a,b");',
				'    if b then',
				'      Y(z);',
				'    else',
				'      W(z);',
				'    end if;',
				'  elsif c then',
				'    V(q);',
				'  else',
				'    U(q);',
				'  end if;',
				'  T(0);',
				'end;',
			].join('\n'),
			'a.iri',
		);
		const calls = m.routines[0].calls.map(c => [c.callee, c.line, c.conditions]);
		expect(calls).toContainEqual(['X', 4, ['a = 1']]);
		expect(m.routines[0].calls.find(c => c.callee === 'X')!.args).toEqual(['1', 'Foo(2, 3)', '"a,b"']);
		expect(calls).toContainEqual(['Foo', 4, ['a = 1']]);
		expect(calls).toContainEqual(['Y', 6, ['a = 1', 'b']]);
		expect(calls).toContainEqual(['W', 8, ['a = 1', 'not (b)']]);
		expect(calls).toContainEqual(['V', 11, ['c']]);
		expect(calls).toContainEqual(['U', 13, ['not (a = 1 or c)']]);
		expect(calls).toContainEqual(['T', 15, []]);
	});

	it('resolves parameterless calls only for known routine names', () => {
		const m = parseIriteSource(
			'procedure Known;\nbegin\nend;\nprocedure P;\nbegin\n  Known;\n  other;\n  x := Known;\n  Known := 1;\nend;',
			'a.iri',
		);
		const calls = m.routines[1].calls;
		expect(calls.map(c => [c.callee, c.line, c.args, c.parameterless])).toEqual([
			['Known', 6, [], true],
			['Known', 8, [], true],
		]);
	});

	it('ignores comments and strings and never throws on junk', () => {
		const m = parseIriteSource(
			'-- procedure Nope;\n(* procedure Nope2;\n begin end; *)\nprocedure P;\nbegin\n  S("end; -- X(1)");  -- Y(2)\n  (* Z(3) *)\nend;',
			'a.iri',
		);
		expect(m.routines.map(r => r.name)).toEqual(['P']);
		expect(m.routines[0].calls.map(c => c.callee)).toEqual(['S']);
		expect(() => parseIriteSource('type is is ((( end database; procedure ; "oops\n begin if then', 'a.iri')).not.toThrow();
		expect(parseIriteSource('type X is garbage;', 'a.iri').diagnostics).toEqual([
			{ file: 'a.iri', line: 1, message: expect.any(String) },
		]);
	});

	it('is case-insensitive but keeps original spelling', () => {
		const m = parseIriteSource(
			'TYPE T IS (A);\nPROCEDURE Known;\nBEGIN\nEND;\nPROCEDURE P;\nBEGIN\n  IF X THEN\n    known;\n  END IF;\nEND;',
			'a.iri',
		);
		expect(m.enums[0].name).toBe('T');
		expect(m.routines.map(r => r.name)).toEqual(['Known', 'P']);
		expect(m.routines[1].calls).toMatchObject([{ callee: 'known', conditions: ['X'] }]);
	});
});

describe('loadIriteProject', () => {
	it('follows includes in order, skipping commented ones', () => {
		const p = project();
		expect(p.files.map(rel)).toEqual(['main.src', 'main.iri', 'src/petri/types.iri', 'src/petri/handler.iri', 'src/ui.iri']);
	});

	it('records missing includes as diagnostics', () => {
		const p = project();
		expect(p.diagnostics).toHaveLength(1);
		expect(p.diagnostics[0]).toMatchObject({ line: 9, message: expect.stringContaining('src\\missing.iri') });
		expect(rel(p.diagnostics[0].file)).toBe('main.src');
	});

	it('merges the generated database and constants', () => {
		const p = project();
		expect(p.databases).toHaveLength(1);
		expect(p.databases[0]).toMatchObject({ typeName: 'Product', alias: 'Product', line: 7 });
		expect(p.constants.map(c => c.name)).toEqual(['lbStat', 'imgLogo', 'APP_NAME', 'SCALE_FACTOR', 'PRODUCT_ID']);
	});

	it('extracts the Petri FSM structure', () => {
		const p = project();
		expect(p.enums.map(e => e.name)).toEqual(['STATES', 'TRANSITIONS']);
		expect(p.enums[0].members).toEqual(['NullState', 'Standby', 'PlateRequest', 'Finished']);
		const trans = p.routines.find(r => r.name === 'HandlerTransitions')!;
		const set = trans.calls.filter(c => c.callee === 'SetState');
		expect(set.map(c => [c.args[2], c.conditions])).toEqual([
			['PlateRequest', ['CurrentTransition = Start']],
			['Standby', ['CurrentTransition = Clear']],
			['Finished', ['CurrentTransition = Finish']],
		]);
		const cmd = p.routines.find(r => r.name === 'CmdPlateRequest')!;
		const edges = cmd.calls.filter(c => c.callee === 'CmdSetTransition').map(c => [c.args[2], c.conditions]);
		expect(edges).toEqual([
			['Finish', ['GetWeight(iScaleId) > 10', 'PlateOk(iScaleId)']],
			['Clear', ['GetWeight(iScaleId) > 10', 'not (PlateOk(iScaleId))']],
			['Start', ['GetWeight(iScaleId) < 0']],
		]);
	});

	it('resolves parameterless calls across files and finds handlers', () => {
		const p = project();
		expect(p.routines.find(r => r.name === 'CmdStandby')!.calls.map(c => c.callee)).toEqual(['initMachines', 'SetLabelText']);
		expect(p.routines.find(r => r.name === 'initMachines')!.calls.map(c => c.callee)).toEqual(['PlateOk', 'Beep']);
		expect(p.routines.find(r => r.name === 'WidgetClicked')).toMatchObject({ kind: 'handler' });
		expect(rel(p.routines.find(r => r.name === 'WidgetClicked')!.file)).toBe('src/ui.iri');
	});

	it('is JSON-serializable', () => {
		const p = project();
		expect(JSON.parse(JSON.stringify(p))).toEqual(p);
	});
});

describe('program body and array types', () => {
	it('models the program body as a routine and tolerates array types', () => {
		const m = parseIriteSource('program demo;\ntype Arr is array [1..3] of integer;\nprocedure Init;\nbegin\nend;\nbegin\n  Init;\n  Run(1);\nend;', 'main.src');
		expect(m.diagnostics).toEqual([]);
		expect(m.routines.map(r => [r.name, r.calls.map(c => c.callee)])).toEqual([['Init', []], ['demo', ['Init', 'Run']]]);
	});
});
