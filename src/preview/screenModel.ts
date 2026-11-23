/**
 * Pure screen model for the preview webview (no `vscode` import).
 * Combines the read-only `.rev` model with the iRite project model to
 * cross-reference widgets with the code that touches them.
 */
import type { IriteProjectModel } from "../irite";
import type { RevDiagnostic, RevModel, RevWidget } from "../rev";
import { groupReferences } from "./refGroups";
import type { FileRefs } from "./refGroups";

export interface WidgetReference {
	file: string;
	/** 1-based line. */
	line: number;
	/**
	 * Called routine; `(condition)` when the alias is part of an if/elsif condition enclosing the call (reported
	 * at the call's line); `(reference)` for any other use (plain comparison, assignment, continuation line).
	 */
	callee: string;
	/** Routine whose body holds the reference. */
	routine: string;
}

export interface WidgetView extends RevWidget {
	references: WidgetReference[];
	/** `references` grouped by file and routine. */
	refGroups: FileRefs[];
}

export interface ScreenView {
	number: number;
	/**
	 * Paint order = widget id ascending (assumption: Revolution paints in id
	 * order; unconfirmed on a real device).
	 */
	widgets: WidgetView[];
}

export interface ScreensView {
	screens: ScreenView[];
	diagnostics: RevDiagnostic[];
}

/** Removes string literals (iRite strings use double quotes, `""` escapes) so text is not matched as identifiers. */
function stripStrings(s: string): string {
	return s.replace(/"(?:[^"]|"")*"/g, '""');
}

function identifiers(s: string): Set<string> {
	const out = new Set<string>();
	for (const m of stripStrings(s).matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
		out.add(m[0].toLowerCase());
	}
	return out;
}

/** alias (lower-case) → references, from calls (args, conditions) and every other identifier use. */
function indexReferences(project: IriteProjectModel | undefined, aliases: Set<string>): Map<string, WidgetReference[]> {
	const index = new Map<string, WidgetReference[]>();
	if (!project) {
		return index;
	}
	const add = (alias: string, ref: WidgetReference): void => {
		const list = index.get(alias) ?? [];
		if (!list.some((r) => r.file === ref.file && r.line === ref.line && r.callee === ref.callee && r.routine === ref.routine)) {
			list.push(ref);
		}
		index.set(alias, list);
	};
	for (const routine of project.routines) {
		const base = { file: routine.file, routine: routine.name };
		/** alias → [first line, last line] spans already explained by a call or condition of this routine. */
		const covered = new Map<string, Array<[number, number]>>();
		const cover = (alias: string, from: number, to: number): void => {
			const spans = covered.get(alias) ?? [];
			spans.push([from, to]);
			covered.set(alias, spans);
		};
		for (const call of routine.calls) {
			const last = call.endLine ?? call.line;
			for (const id of identifiers(call.args.join(","))) {
				if (aliases.has(id)) {
					add(id, { ...base, line: call.line, callee: call.callee });
					cover(id, call.line, last);
				}
			}
			for (const id of identifiers(call.conditions.join(" "))) {
				if (aliases.has(id)) {
					add(id, { ...base, line: call.line, callee: "(condition)" });
				}
			}
		}
		for (const ref of routine.idRefs ?? []) {
			const id = ref.name.toLowerCase();
			if (aliases.has(id) && !covered.get(id)?.some(([from, to]) => ref.line >= from && ref.line <= to)) {
				add(id, { ...base, line: ref.line, callee: "(reference)" });
			}
		}
	}
	return index;
}

function dirOf(p: string): string {
	const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
	return i < 0 ? "" : p.slice(0, i);
}

export function buildScreenView(rev: RevModel, project?: IriteProjectModel): ScreensView {
	const aliases = new Set<string>();
	for (const w of rev.widgets) {
		if (w.alias) {
			aliases.add(w.alias.toLowerCase());
		}
	}
	const refs = indexReferences(project, aliases);
	const root = project ? dirOf(project.mainSrc) : "";
	const byScreen = new Map<number, WidgetView[]>();
	for (const w of rev.widgets) {
		if (w.screen === undefined) {
			continue;
		}
		const list = byScreen.get(w.screen) ?? [];
		const references = w.alias ? [...(refs.get(w.alias.toLowerCase()) ?? [])] : [];
		list.push({ ...w, references, refGroups: groupReferences(references, root) });
		byScreen.set(w.screen, list);
	}
	const screens = [...byScreen.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([number, widgets]) => ({ number, widgets: widgets.sort((a, b) => a.id - b.id) }));
	return { screens, diagnostics: rev.diagnostics };
}
