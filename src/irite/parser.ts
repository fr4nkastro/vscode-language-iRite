import type { IriteField, IriteFileModel, IriteInclude, IriteRoutine } from './model';
import { joinTokens, tokenize, type Token } from './tokenizer';

/** Words that are never call targets / bare routine references. */
const NON_CALL_WORDS = new Set([
	'begin', 'end', 'if', 'then', 'elsif', 'else', 'loop', 'while', 'for', 'to', 'by', 'exit', 'return', 'var',
	'constant', 'type', 'is', 'record', 'database', 'array', 'of', 'procedure', 'function', 'handler', 'program',
	'not', 'and', 'or', 'xor', 'mod', 'div', 'do', 'case', 'external',
]);
const ROUTINE_WORDS = new Set(['procedure', 'function', 'handler']);

type Frame =
	| { kind: 'if'; seen: string[]; cur: string }
	| { kind: 'loop' }
	| { kind: 'block' };

class Parser {
	private i = 0;
	readonly model: IriteFileModel;
	private tokens: Token[] = [];
	private programName = 'main';

	constructor(private readonly text: string, private readonly file: string) {
		this.model = {
			file, includes: [], databases: [], enums: [], records: [], constants: [], routines: [], diagnostics: [],
		};
	}

	run(): IriteFileModel {
		const tk = tokenize(this.text);
		this.tokens = tk.tokens;
		for (const e of tk.errors) {
			this.diag(e.line, e.message);
		}
		this.model.includes = scanIncludes(this.text);
		while (this.i < this.tokens.length) {
			const before = this.i;
			this.topLevel();
			if (this.i === before) {
				this.i++;
			}
		}
		return this.model;
	}

	private diag(line: number, message: string): void {
		this.model.diagnostics.push({ file: this.file, line, message });
	}

	private get tok(): Token | undefined {
		return this.tokens[this.i];
	}

	private peek(offset = 0): Token | undefined {
		return this.tokens[this.i + offset];
	}

	private is(lower: string, offset = 0): boolean {
		const t = this.peek(offset);
		return t !== undefined && t.kind !== 'str' && t.lower === lower;
	}

	/** Index of the next token (from `from`) with this lowercase text at bracket depth 0, or -1. */
	private find(lower: string, from: number, stopAtSemicolon = false): number {
		let depth = 0;
		for (let k = from; k < this.tokens.length; k++) {
			const t = this.tokens[k];
			if (t.kind === 'str') {
				continue;
			}
			if (depth <= 0 && t.lower === lower) {
				return k;
			}
			if (t.text === '(' || t.text === '[') {
				depth++;
			} else if (t.text === ')' || t.text === ']') {
				depth--;
			} else if (stopAtSemicolon && t.text === ';') {
				return -1;
			}
		}
		return -1;
	}

	private skipStatement(): void {
		while (this.i < this.tokens.length) {
			const t = this.tokens[this.i++];
			if (t.kind === 'str') {
				continue;
			}
			if (t.lower === 'record' || t.lower === 'database') {
				while (this.i < this.tokens.length && !(this.is('end') && this.is(t.lower, 1))) {
					this.i++;
				}
				this.i += 2;
			} else if (t.text === ';') {
				return;
			}
		}
	}

	private topLevel(): void {
		const t = this.tok!;
		if (t.kind === 'id' && t.lower === 'type') {
			this.typeDecl();
		} else if (t.kind === 'id' && ROUTINE_WORDS.has(t.lower)) {
			this.routine();
		} else if (t.kind === 'id' && t.lower === 'program') {
			if (this.peek(1)?.kind === 'id') {
				this.programName = this.peek(1)!.text;
			}
			this.skipStatement();
		} else if (t.kind === 'id' && t.lower === 'begin') {
			// Program body (main.src): modelled as a procedure named after the program.
			const routine: IriteRoutine = {
				file: this.file, line: t.line, kind: 'procedure', name: this.programName,
				params: [], startLine: t.line, endLine: t.line, calls: [],
			};
			this.model.routines.push(routine);
			this.i++;
			this.body(routine);
		} else if (t.kind === 'id' && t.lower === 'var') {
			this.i++;
		} else if (t.kind === 'id' && !NON_CALL_WORDS.has(t.lower) && this.peek(1)?.text === ':') {
			this.varOrConstant();
		} else {
			this.diag(t.line, `Unrecognized top-level construct near "${t.text}"`);
			this.skipStatement();
		}
	}

	private fieldList(endWord: string): IriteField[] {
		const fields: IriteField[] = [];
		while (this.i < this.tokens.length && !(this.is('end') && this.is(endWord, 1))) {
			const semi = this.find(';', this.i);
			const end = semi === -1 ? this.tokens.length : semi;
			const stop = this.findEndWord(this.i, end, endWord);
			const sliceEnd = stop === -1 ? end : stop;
			const colon = this.find(':', this.i);
			if (colon !== -1 && colon < sliceEnd) {
				const type = joinTokens(this.tokens.slice(colon + 1, sliceEnd));
				for (const n of this.tokens.slice(this.i, colon).filter(x => x.kind === 'id')) {
					fields.push({ name: n.text, type });
				}
			} else if (sliceEnd > this.i) {
				this.diag(this.tokens[this.i].line, 'Unparseable field declaration');
			}
			this.i = stop !== -1 ? stop : end + 1;
		}
		this.i += 2;
		if (this.tok?.text === ';') {
			this.i++;
		}
		return fields;
	}

	private findEndWord(from: number, to: number, word: string): number {
		for (let k = from; k < to; k++) {
			if (this.tokens[k].lower === 'end' && this.tokens[k + 1]?.lower === word) {
				return k;
			}
		}
		return -1;
	}

	private typeDecl(): void {
		const start = this.tok!;
		const name = this.peek(1);
		if (!name || name.kind !== 'id' || !this.is('is', 2)) {
			this.diag(start.line, 'Malformed type declaration');
			this.skipStatement();
			return;
		}
		const kind = this.peek(3);
		this.i += 3;
		if (kind?.lower === 'database') {
			this.i++;
			let alias = '';
			if (this.tok?.text === '(') {
				const s = this.peek(1);
				alias = s?.kind === 'str' ? s.text.slice(1, -1) : '';
				const close = this.find(')', this.i + 1);
				this.i = close === -1 ? this.i + 1 : close + 1;
			}
			const fields = this.fieldList('database');
			this.model.databases.push({ file: this.file, line: start.line, typeName: name.text, alias, fields });
		} else if (kind?.lower === 'record') {
			this.i++;
			const fields = this.fieldList('record');
			this.model.records.push({ file: this.file, line: start.line, name: name.text, fields });
		} else if (kind?.text === '(') {
			this.i++;
			const members: string[] = [];
			let expectMember = true;
			let closed = false;
			while (this.i < this.tokens.length) {
				const t = this.tokens[this.i++];
				if (t.text === ')') {
					closed = true;
					break;
				}
				if (t.text === ',') {
					expectMember = true;
				} else if (expectMember && t.kind === 'id') {
					members.push(t.text);
					expectMember = false;
				} else if (t.text === ';') {
					break;
				}
			}
			if (!closed) {
				this.diag(start.line, `Unterminated enum "${name.text}"`);
			}
			if (this.tok?.text === ';') {
				this.i++;
			}
			this.model.enums.push({ file: this.file, line: start.line, name: name.text, members });
		} else if (kind?.lower === 'array') {
			this.skipStatement(); // array types are not modelled
		} else {
			this.diag(start.line, `Unsupported type declaration "${name.text}"`);
			this.skipStatement();
		}
	}

	private varOrConstant(): void {
		const name = this.tok!;
		const semi = this.find(';', this.i);
		const end = semi === -1 ? this.tokens.length : semi;
		if (this.is('constant', 2)) {
			const assign = this.find(':=', this.i, true);
			if (assign !== -1 && assign < end) {
				this.model.constants.push({
					file: this.file,
					line: name.line,
					name: name.text,
					type: joinTokens(this.tokens.slice(this.i + 3, assign)),
					value: joinTokens(this.tokens.slice(assign + 1, end)),
				});
			} else {
				this.diag(name.line, `Malformed constant "${name.text}"`);
			}
			this.i = end + 1;
		} else {
			this.skipStatement(); // global variable
		}
	}

	private parseParams(open: number, close: number): IriteField[] {
		const params: IriteField[] = [];
		let groupStart = open + 1;
		for (let k = open + 1; k <= close; k++) {
			if (k === close || this.tokens[k].text === ';') {
				const group = this.tokens.slice(groupStart, k);
				const colon = group.findIndex(t => t.text === ':');
				if (colon !== -1) {
					const type = joinTokens(group.slice(colon + 1));
					for (const n of group.slice(0, colon)) {
						if (n.kind === 'id' && n.lower !== 'var' && n.lower !== 'const') {
							params.push({ name: n.text, type });
						}
					}
				} else if (group.length) {
					this.diag(group[0].line, 'Unparseable parameter');
				}
				groupStart = k + 1;
			}
		}
		return params;
	}

	private routine(): void {
		const kw = this.tok!;
		const nameTok = this.peek(1);
		if (!nameTok || nameTok.kind !== 'id' || NON_CALL_WORDS.has(nameTok.lower)) {
			this.diag(kw.line, `Malformed ${kw.lower} declaration`);
			this.i++;
			return;
		}
		this.i += 2;
		let params: IriteField[] = [];
		if (this.tok?.text === '(') {
			const close = this.find(')', this.i + 1);
			if (close === -1) {
				this.diag(kw.line, `Unterminated parameter list for "${nameTok.text}"`);
				this.skipStatement();
				return;
			}
			params = this.parseParams(this.i, close);
			this.i = close + 1;
		}
		let returnType: string | undefined;
		if (this.tok?.text === ':') {
			const semi = this.find(';', this.i);
			const end = semi === -1 ? this.tokens.length : semi;
			returnType = joinTokens(this.tokens.slice(this.i + 1, end));
			this.i = end;
		}
		if (this.tok?.text === ';') {
			this.i++;
		}
		const routine: IriteRoutine = {
			file: this.file,
			line: kw.line,
			kind: kw.lower as IriteRoutine['kind'],
			name: nameTok.text,
			params,
			startLine: kw.line,
			endLine: kw.line,
			calls: [],
		};
		if (returnType !== undefined) {
			routine.returnType = returnType;
		}
		this.model.routines.push(routine);
		// Locals until `begin`; another declaration first means this one has no body.
		while (this.i < this.tokens.length && !this.is('begin')) {
			const t = this.tokens[this.i];
			if (t.kind === 'id' && (ROUTINE_WORDS.has(t.lower) || t.lower === 'type' || t.lower === 'program')) {
				routine.forward = true;
				routine.endLine = this.tokens[this.i - 1]?.line ?? kw.line;
				return;
			}
			this.i++;
		}
		if (this.i >= this.tokens.length) {
			routine.forward = true;
			return;
		}
		this.i++; // begin
		this.body(routine);
	}

	private body(routine: IriteRoutine): void {
		const frames: Frame[] = [];
		const conds = (upTo = frames.length): string[] =>
			frames.slice(0, upTo).flatMap(f => (f.kind === 'if' ? [f.cur] : []));
		let lastLine = routine.startLine;
		while (this.i < this.tokens.length) {
			const t = this.tokens[this.i];
			lastLine = t.line;
			if (t.kind === 'id' && ROUTINE_WORDS.has(t.lower)) {
				this.diag(t.line, `Missing "end" for ${routine.kind} "${routine.name}"`);
				routine.endLine = this.tokens[this.i - 1].line;
				return;
			}
			if (t.kind === 'id') {
				if (t.lower === 'if' || t.lower === 'elsif' || t.lower === 'while' || t.lower === 'for') {
					this.conditional(routine, frames, conds);
					continue;
				}
				if (t.lower === 'else') {
					const top = frames[frames.length - 1];
					if (top?.kind === 'if') {
						top.seen.push(top.cur);
						top.cur = `not (${top.seen.join(' or ')})`;
					} else {
						this.diag(t.line, '"else" without matching "if"');
					}
					this.i++;
					continue;
				}
				if (t.lower === 'loop' || t.lower === 'begin') {
					frames.push({ kind: t.lower === 'loop' ? 'loop' : 'block' });
					this.i++;
					continue;
				}
				if (t.lower === 'end') {
					const next = this.peek(1);
					this.i++;
					if (next?.lower === 'if' || next?.lower === 'loop') {
						this.i++;
						frames.pop();
					} else if (frames.length > 0) {
						frames.pop();
					} else {
						routine.endLine = t.line;
						if (this.tok?.kind === 'id' && !NON_CALL_WORDS.has(this.tok.lower) && this.peek(1)?.text === ';') {
							this.i++; // `end Name;`
						}
						if (this.tok?.text === ';') {
							this.i++;
						}
						return;
					}
					continue;
				}
			}
			this.scanCalls(routine, this.i, this.i + 1, conds());
			this.i++;
		}
		this.diag(lastLine, `Missing "end" for ${routine.kind} "${routine.name}"`);
		routine.endLine = lastLine;
	}

	/** Handles `if`, `elsif`, `while`, `for` heads: scans the condition for calls and updates frames. */
	private conditional(routine: IriteRoutine, frames: Frame[], conds: (upTo?: number) => string[]): void {
		const t = this.tokens[this.i];
		const closer = t.lower === 'if' || t.lower === 'elsif' ? 'then' : 'loop';
		const stop = this.find(closer, this.i + 1, true);
		const condEnd = stop === -1 ? this.i + 1 : stop;
		const condText = joinTokens(this.tokens.slice(this.i + 1, condEnd));
		const top = frames[frames.length - 1];
		const outer = t.lower === 'elsif' ? Math.max(frames.length - 1, 0) : frames.length;
		this.scanCalls(routine, this.i + 1, condEnd, conds(outer));
		if (stop === -1) {
			this.diag(t.line, `Missing "${closer}" after "${t.lower}"`);
		}
		if (t.lower === 'if') {
			frames.push({ kind: 'if', seen: [], cur: condText });
		} else if (t.lower === 'elsif') {
			if (top?.kind === 'if') {
				top.seen.push(top.cur);
				top.cur = condText;
			} else {
				this.diag(t.line, '"elsif" without matching "if"');
			}
		} else {
			frames.push({ kind: 'loop' });
		}
		this.i = stop === -1 ? condEnd : stop + 1;
	}

	/** Records calls found in tokens[from, to). */
	private scanCalls(routine: IriteRoutine, from: number, to: number, conditions: string[]): void {
		for (let k = from; k < to; k++) {
			const t = this.tokens[k];
			if (t.kind !== 'id' || NON_CALL_WORDS.has(t.lower)) {
				continue;
			}
			const next = this.tokens[k + 1];
			const prev = this.tokens[k - 1];
			if (next?.text === '(') {
				const close = this.matchParen(k + 1);
				const args = close === -1 ? [] : splitArgs(this.tokens.slice(k + 2, close));
				routine.calls.push({ callee: t.text, args, line: t.line, conditions: [...conditions] });
			} else if (next?.text !== ':=' && next?.text !== '.' && prev?.text !== '.' && next?.text !== ':') {
				routine.calls.push({ callee: t.text, args: [], line: t.line, conditions: [...conditions], parameterless: true });
			}
		}
	}

	private matchParen(open: number): number {
		let depth = 0;
		for (let k = open; k < this.tokens.length; k++) {
			const t = this.tokens[k];
			if (t.kind === 'str') {
				continue;
			}
			if (t.text === '(') {
				depth++;
			} else if (t.text === ')' && --depth === 0) {
				return k;
			} else if (t.text === ';') {
				return -1;
			}
		}
		return -1;
	}
}

function splitArgs(tokens: Token[]): string[] {
	const args: Token[][] = [];
	let cur: Token[] = [];
	let depth = 0;
	for (const t of tokens) {
		if (t.kind !== 'str') {
			if (t.text === '(' || t.text === '[') {
				depth++;
			} else if (t.text === ')' || t.text === ']') {
				depth--;
			} else if (t.text === ',' && depth === 0) {
				args.push(cur);
				cur = [];
				continue;
			}
		}
		cur.push(t);
	}
	if (cur.length || args.length) {
		args.push(cur);
	}
	return args.map(joinTokens);
}

function scanIncludes(text: string): IriteInclude[] {
	const out: IriteInclude[] = [];
	let inBlock = false;
	text.split(/\r?\n/).forEach((raw, idx) => {
		const line = raw.replace(/^\uFEFF/, '');
		if (inBlock) {
			inBlock = !line.includes('*)');
			return;
		}
		if (/^\s*\(\*/.test(line) && !line.includes('*)')) {
			inBlock = true;
			return;
		}
		const m = /^\s*#include\s+(.*?)\s*$/i.exec(line);
		if (m) {
			const p = m[1].replace(/\s*--.*$/, '').replace(/^"(.*)"$/, '$1').trim();
			if (p) {
				out.push({ path: p, line: idx + 1 });
			}
		}
	});
	return out;
}

/** Parses one file's raw structure; bare identifiers are still unresolved (see `resolveParameterless`). */
export function parseFileRaw(text: string, file: string): IriteFileModel {
	try {
		return new Parser(text, file).run();
	} catch (e) {
		// Defensive: the parser must never throw on unknown syntax.
		return {
			file, includes: [], databases: [], enums: [], records: [], constants: [], routines: [],
			diagnostics: [{ file, line: 1, message: `Internal parser error: ${(e as Error).message}` }],
		};
	}
}

/**
 * Second pass: keeps parameterless candidates only when they name a known routine,
 * and drops forward declarations superseded by a definition.
 */
export function resolveParameterless(models: IriteFileModel[]): void {
	const known = new Set(models.flatMap(m => m.routines.map(r => r.name.toLowerCase())));
	const defined = new Set(models.flatMap(m => m.routines.filter(r => !r.forward).map(r => r.name.toLowerCase())));
	for (const m of models) {
		m.routines = m.routines.filter(r => !r.forward || !defined.has(r.name.toLowerCase()));
		for (const r of m.routines) {
			r.calls = r.calls.filter(c => !c.parameterless || known.has(c.callee.toLowerCase()));
		}
	}
}
