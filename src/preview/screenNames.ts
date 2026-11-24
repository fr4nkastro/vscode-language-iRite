/**
 * Pure screen-name and click-handler resolution (no `vscode` import).
 *
 * House convention (IPESAH, e.g. DOLE): a record type `UiScreen` has one integer field per screen and
 * `uiLoadSettingsUi` assigns each field its `.rev` screen number (`tScreen.PlateEntry:=12;`). The single
 * `handler WidgetClicked` then dispatches per screen with an if/elsif chain whose condition ends in
 * `.Screen.<Field>` and whose branch calls the per-screen routine.
 */
import type { IriteProjectModel, IriteRoutine } from "../irite";

export const SCREEN_RECORD = "UiScreen";
export const SCREEN_LOADER = "uiLoadSettingsUi";
export const CLICK_HANDLER = "WidgetClicked";

export interface ScreenEntry {
	/** The dispatching handler (`WidgetClicked`). */
	handler: string;
	/** Per-screen click routine the handler calls for this screen. */
	routine: string;
	/** Where that routine is declared (1-based line). */
	file: string;
	line: number;
	/** The call inside the handler that dispatches to it. */
	dispatchFile: string;
	dispatchLine: number;
}

const lower = (s: string): string => s.toLowerCase();

/** Field name (lower-case) → declared spelling, for the `UiScreen` record. */
function screenFields(project: IriteProjectModel): Map<string, string> {
	const rec = project.records.find((r) => lower(r.name) === lower(SCREEN_RECORD));
	return new Map((rec?.fields ?? []).map((f) => [lower(f.name), f.name]));
}

/** Screen number → names of every `UiScreen` field assigned that number, in assignment order. */
export function resolveScreenNames(project: IriteProjectModel | undefined): Map<number, string[]> {
	const out = new Map<number, string[]>();
	if (!project) {
		return out;
	}
	const fields = screenFields(project);
	if (fields.size === 0) {
		return out;
	}
	const loaders = project.routines.filter((r) => lower(r.name) === lower(SCREEN_LOADER));
	for (const routine of loaders.length > 0 ? loaders : project.routines) {
		for (const a of routine.literalAssigns ?? []) {
			const parts = a.target.split(".");
			const declared = parts.length === 2 ? fields.get(lower(parts[1])) : undefined;
			if (declared === undefined) {
				continue;
			}
			const names = out.get(a.value) ?? [];
			if (!names.includes(declared)) {
				names.push(declared);
			}
			out.set(a.value, names);
		}
	}
	return out;
}

/** The `UiScreen` field a dispatch condition compares against (`X = a.b.Field` or `a.b.Field = X`), if any. */
function conditionField(condition: string, fields: Map<string, string>): string | undefined {
	const right = /=\s*(?:\w+\s*\.\s*)*(\w+)\s*$/.exec(condition);
	const left = /^\s*(?:\w+\s*\.\s*)*(\w+)\s*=/.exec(condition);
	for (const m of [right, left]) {
		if (m && fields.has(lower(m[1]))) {
			return lower(m[1]);
		}
	}
	return undefined;
}

/** Screen number → the per-screen routine that `WidgetClicked` dispatches to. */
export function resolveScreenEntries(project: IriteProjectModel | undefined, names: Map<number, string[]>): Map<number, ScreenEntry> {
	const out = new Map<number, ScreenEntry>();
	if (!project || names.size === 0) {
		return out;
	}
	const fields = screenFields(project);
	const numberOf = new Map<string, number>();
	for (const [n, list] of names) {
		for (const name of list) {
			if (!numberOf.has(lower(name))) {
				numberOf.set(lower(name), n);
			}
		}
	}
	const byName = new Map<string, IriteRoutine>();
	for (const r of project.routines) {
		if (!r.forward || !byName.has(lower(r.name))) {
			byName.set(lower(r.name), r);
		}
	}
	for (const handler of project.routines.filter((r) => r.kind === "handler" && lower(r.name) === lower(CLICK_HANDLER))) {
		for (const call of handler.calls) {
			const target = byName.get(lower(call.callee));
			const cond = call.conditions[call.conditions.length - 1];
			const field = cond === undefined ? undefined : conditionField(cond, fields);
			const screen = field === undefined ? undefined : numberOf.get(field);
			if (!target || screen === undefined || target === handler || out.has(screen)) {
				continue;
			}
			out.set(screen, {
				handler: handler.name,
				routine: target.name,
				file: target.file,
				line: target.line,
				dispatchFile: handler.file,
				dispatchLine: call.line,
			});
		}
	}
	return out;
}
