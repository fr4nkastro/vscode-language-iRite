/** Pure grouping of widget references by file and routine (no `vscode` import). */
import type { WidgetReference } from "./screenModel";

export interface RefSite {
	/** 1-based line. */
	line: number;
	callee: string;
}

export interface RoutineRefs {
	routine: string;
	sites: RefSite[];
}

export interface FileRefs {
	/** Absolute path, as the project model spells it (the only value the `open` message accepts). */
	file: string;
	/** Path relative to the project root, with `/`. */
	label: string;
	routines: RoutineRefs[];
	count: number;
}

const slash = (p: string): string => p.replace(/\\/g, "/");

/** `file` relative to `root` using `/`; falls back to the file's own spelling when it is outside `root`. */
export function relativeLabel(file: string, root: string): string {
	const f = slash(file);
	const r = slash(root).replace(/\/+$/, "");
	return r && f.toLowerCase().startsWith(r.toLowerCase() + "/") ? f.slice(r.length + 1) : f;
}

/** Files ordered by label, routines by their first reference line, sites by line. */
export function groupReferences(refs: WidgetReference[], root: string): FileRefs[] {
	const files = new Map<string, FileRefs>();
	for (const r of refs) {
		let f = files.get(r.file);
		if (!f) {
			f = { file: r.file, label: relativeLabel(r.file, root), routines: [], count: 0 };
			files.set(r.file, f);
		}
		let rt = f.routines.find((x) => x.routine === r.routine);
		if (!rt) {
			rt = { routine: r.routine, sites: [] };
			f.routines.push(rt);
		}
		rt.sites.push({ line: r.line, callee: r.callee });
		f.count++;
	}
	const out = [...files.values()].sort((a, b) => a.label.localeCompare(b.label));
	for (const f of out) {
		for (const rt of f.routines) {
			rt.sites.sort((a, b) => a.line - b.line || a.callee.localeCompare(b.callee));
		}
		f.routines.sort((a, b) => a.sites[0].line - b.sites[0].line);
	}
	return out;
}
