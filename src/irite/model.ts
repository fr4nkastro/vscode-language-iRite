/** Plain JSON-serializable model of an iRite project. No `vscode` imports. */

export interface Located {
	file: string;
	/** 1-based line */
	line: number;
}

export interface IriteField {
	name: string;
	type: string;
}

export interface IriteDatabase extends Located {
	typeName: string;
	alias: string;
	fields: IriteField[];
}

export interface IriteEnum extends Located {
	name: string;
	members: string[];
}

export interface IriteRecord extends Located {
	name: string;
	fields: IriteField[];
}

export interface IriteConstant extends Located {
	name: string;
	type: string;
	value: string;
}

export interface IriteCall {
	callee: string;
	/** Raw argument text (whitespace-normalized), split on top-level commas. */
	args: string[];
	line: number;
	/**
	 * Enclosing if/elsif/else conditions, outermost first.
	 * - `if`/`elsif` branch: the branch's own condition text (earlier branches are NOT negated).
	 * - `else` branch: `not (<c1> or <c2> ...)` over every earlier branch condition of that chain.
	 */
	conditions: string[];
	/** True when written without parentheses (resolved against known routine names). */
	parameterless?: boolean;
}

export interface IriteRoutine extends Located {
	kind: 'procedure' | 'function' | 'handler';
	name: string;
	params: IriteField[];
	returnType?: string;
	startLine: number;
	endLine: number;
	calls: IriteCall[];
	/** Declaration without a body (forward/external). */
	forward?: boolean;
}

export interface IriteInclude {
	/** Path as written, backslashes preserved. */
	path: string;
	line: number;
}

export interface IriteDiagnostic {
	file: string;
	line: number;
	message: string;
}

export interface IriteFileModel {
	file: string;
	includes: IriteInclude[];
	databases: IriteDatabase[];
	enums: IriteEnum[];
	records: IriteRecord[];
	constants: IriteConstant[];
	routines: IriteRoutine[];
	diagnostics: IriteDiagnostic[];
}

export interface IriteProjectModel {
	mainSrc: string;
	/** Files in include (declaration) order, main.src first. */
	files: string[];
	databases: IriteDatabase[];
	enums: IriteEnum[];
	records: IriteRecord[];
	constants: IriteConstant[];
	routines: IriteRoutine[];
	diagnostics: IriteDiagnostic[];
}
