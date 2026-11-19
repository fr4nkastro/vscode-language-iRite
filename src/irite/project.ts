import * as path from 'node:path';
import type { IriteDiagnostic, IriteFileModel, IriteProjectModel } from './model';
import { parseFileRaw, resolveParameterless } from './parser';

/** Parses a single iRite source file. */
export function parseIriteSource(text: string, file: string): IriteFileModel {
	const model = parseFileRaw(text, file);
	resolveParameterless([model]);
	return model;
}

/**
 * Loads `main.src` and follows `#include` lines depth-first, in order.
 * Include paths are project-relative (relative to the directory of `main.src`), backslash-separated.
 * Missing/unreadable includes become diagnostics; repeated includes are parsed once.
 */
export function loadIriteProject(
	mainSrcPath: string,
	readFile: (absPath: string) => string | undefined,
): IriteProjectModel {
	const root = path.dirname(mainSrcPath);
	const models: IriteFileModel[] = [];
	const seen = new Set<string>();
	const missing: IriteDiagnostic[] = [];

	const visit = (abs: string, from?: { file: string; line: number; written: string }): void => {
		const key = path.normalize(abs).toLowerCase();
		if (seen.has(key)) {
			return;
		}
		seen.add(key);
		let text: string | undefined;
		try {
			text = readFile(abs);
		} catch {
			text = undefined;
		}
		if (text === undefined) {
			if (from) {
				missing.push({ file: from.file, line: from.line, message: `Included file not found: ${from.written}` });
			} else {
				missing.push({ file: abs, line: 1, message: `File not found: ${abs}` });
			}
			return;
		}
		const model = parseFileRaw(text, abs);
		models.push(model);
		for (const inc of model.includes) {
			visit(path.join(root, inc.path.replace(/\\/g, '/')), { file: abs, line: inc.line, written: inc.path });
		}
	};
	visit(mainSrcPath);

	resolveParameterless(models);
	return {
		mainSrc: mainSrcPath,
		files: models.map(m => m.file),
		databases: models.flatMap(m => m.databases),
		enums: models.flatMap(m => m.enums),
		records: models.flatMap(m => m.records),
		constants: models.flatMap(m => m.constants),
		routines: models.flatMap(m => m.routines),
		diagnostics: [...models.flatMap(m => m.diagnostics), ...missing],
	};
}
