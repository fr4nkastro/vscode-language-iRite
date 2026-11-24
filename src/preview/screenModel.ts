/**
 * Pure screen model for the preview webview (no `vscode` import).
 * Combines the read-only `.rev` model with the iRite project model to
 * cross-reference widgets with the code that touches them.
 */
import type { IriteProjectModel } from "../irite";
import type { RevDiagnostic, RevModel, RevWidget } from "../rev";

export interface WidgetReference {
	file: string;
	/** 1-based line. */
	line: number;
	/** Called routine, or `(condition)` when the alias appears in an enclosing if/elsif condition. */
	callee: string;
}

export interface WidgetView extends RevWidget {
	references: WidgetReference[];
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

/** alias (lower-case) → references, from every call's args and conditions. */
function indexReferences(project: IriteProjectModel | undefined, aliases: Set<string>): Map<string, WidgetReference[]> {
	const index = new Map<string, WidgetReference[]>();
	if (!project) {
		return index;
	}
	const add = (alias: string, ref: WidgetReference): void => {
		const list = index.get(alias) ?? [];
		if (!list.some((r) => r.file === ref.file && r.line === ref.line && r.callee === ref.callee)) {
			list.push(ref);
		}
		index.set(alias, list);
	};
	for (const routine of project.routines) {
		for (const call of routine.calls) {
			for (const id of identifiers(call.args.join(","))) {
				if (aliases.has(id)) {
					add(id, { file: routine.file, line: call.line, callee: call.callee });
				}
			}
			for (const id of identifiers(call.conditions.join(" "))) {
				if (aliases.has(id)) {
					add(id, { file: routine.file, line: call.line, callee: "(condition)" });
				}
			}
		}
	}
	return index;
}

export function buildScreenView(rev: RevModel, project?: IriteProjectModel): ScreensView {
	const aliases = new Set<string>();
	for (const w of rev.widgets) {
		if (w.alias) {
			aliases.add(w.alias.toLowerCase());
		}
	}
	const refs = indexReferences(project, aliases);
	const byScreen = new Map<number, WidgetView[]>();
	for (const w of rev.widgets) {
		if (w.screen === undefined) {
			continue;
		}
		const list = byScreen.get(w.screen) ?? [];
		list.push({ ...w, references: w.alias ? [...(refs.get(w.alias.toLowerCase()) ?? [])] : [] });
		byScreen.set(w.screen, list);
	}
	const screens = [...byScreen.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([number, widgets]) => ({ number, widgets: widgets.sort((a, b) => a.id - b.id) }));
	return { screens, diagnostics: rev.diagnostics };
}
