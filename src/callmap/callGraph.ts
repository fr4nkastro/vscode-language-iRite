/** Call graph of an iRite project (routines, files, call sites). Pure: no `vscode` imports. */
import * as path from "node:path";
import type { IriteProjectModel, IriteRoutine } from "../irite";

export interface CallFile {
	/** Absolute path as loaded. */
	file: string;
	/** Project-relative, forward slashes. */
	label: string;
	/** Project-relative folder, forward slashes; `(root)` for the project folder itself. */
	folder: string;
}

export interface CallRoutine {
	/** Index in `CallGraph.routines`. */
	id: number;
	name: string;
	kind: "procedure" | "function" | "handler";
	/** Index in `CallGraph.files`. */
	file: number;
	/** 1-based declaration line. */
	line: number;
	/** Declared but never implemented in the project. */
	forward?: boolean;
}

export interface CallSite {
	/** Caller routine id. */
	from: number;
	/** Callee routine id, or -1 for a call to a name the project does not declare (a built-in). */
	to: number;
	/** Callee name as written at the call site. */
	name: string;
	/** 1-based line of the call, in the caller's file. */
	line: number;
}

export interface CallGraph {
	/** Files that hold at least one routine, in include order. */
	files: CallFile[];
	routines: CallRoutine[];
	sites: CallSite[];
	/** Project files without routines (main.src, declaration-only files): not drawn. */
	hiddenFiles: number;
	diagnostics: string[];
}

export const ROOT_FOLDER = "(root)";

const slash = (p: string): string => p.split(path.sep).join("/").replace(/\\/g, "/");

/**
 * Builds the call graph. Forward declarations were already dropped by the parser when a definition
 * exists; a forward declaration that survives has no implementation and stays a node flagged `forward`.
 * Callees match case-insensitively (iRite identifiers are case-insensitive); the first definition wins.
 */
export function buildCallGraph(project: IriteProjectModel, projectDir: string): CallGraph {
	const withCode = new Set(project.routines.map((r) => r.file));
	const files: CallFile[] = [];
	const fileIndex = new Map<string, number>();
	for (const f of project.files) {
		if (!withCode.has(f) || fileIndex.has(f)) {
			continue;
		}
		const rel = slash(path.relative(projectDir, f));
		const label = rel.startsWith("..") ? slash(f) : rel;
		const dir = label.includes("/") ? label.slice(0, label.lastIndexOf("/")) : ROOT_FOLDER;
		fileIndex.set(f, files.length);
		files.push({ file: f, label, folder: dir });
	}
	const hiddenFiles = project.files.filter((f) => !fileIndex.has(f)).length;

	const diagnostics: string[] = [];
	const routines: CallRoutine[] = [];
	const sources: IriteRoutine[] = [];
	for (const r of project.routines) {
		const fi = fileIndex.get(r.file);
		if (fi === undefined) {
			continue;
		}
		const node: CallRoutine = { id: routines.length, name: r.name, kind: r.kind, file: fi, line: r.line };
		if (r.forward) {
			node.forward = true;
		}
		routines.push(node);
		sources.push(r);
	}
	const byName = new Map<string, number>();
	for (const r of routines) {
		const key = r.name.toLowerCase();
		const known = byName.get(key);
		if (known === undefined) {
			byName.set(key, r.id);
		} else if (!r.forward && !routines[known].forward) {
			diagnostics.push(`Duplicate definition of ${r.name}: ${files[r.file].label}:${r.line} (calls resolve to ${files[routines[known].file].label}:${routines[known].line})`);
		}
	}

	const sites: CallSite[] = [];
	sources.forEach((r, i) => {
		for (const c of r.calls) {
			sites.push({ from: i, to: byName.get(c.callee.toLowerCase()) ?? -1, name: c.callee, line: c.line });
		}
	});
	return { files, routines, sites, hiddenFiles, diagnostics };
}
