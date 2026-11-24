/** Validation of webview-to-extension messages of the screen editor (pure, no `vscode` import). */
import { previewState } from "../preview/previewState";
import type { PreviewState } from "../preview/previewState";
import { paletteTypes, widgetFieldByName, WIDGET_VALUE_MAX, WIDGET_TYPES } from "../rev/widgetCatalog";
import type { GeometryPatch } from "./editState";

export type EditorMessage =
	| { type: "edit"; id: number; patch: GeometryPatch }
	| { type: "add"; widgetType: number; x: number; y: number; screen: number }
	| { type: "delete"; id: number }
	| { type: "setProp"; id: number; field: string; value: string | number }
	| { type: "renameAlias"; id: number; alias: string }
	| { type: "requestRefs"; id: number }
	| { type: "select"; id: number | null }
	| { type: "state"; state: PreviewState }
	| { type: "prefs"; snap: boolean; grid: number };

export const DEFAULT_GRID = 8;
const MAX_GRID = 200;

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Returns a trusted message, or undefined for anything unknown, malformed or aimed at a widget that is not in
 * the file. `types` (id to widget type) lets `setProp` be checked against the fields of that widget's type;
 * without it the field only has to be an editable field of some type. Value ranges are checked by the edit state.
 */
export function parseEditorMessage(raw: unknown, widgetIds: ReadonlySet<number>, types?: ReadonlyMap<number, number>): EditorMessage | undefined {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		return undefined;
	}
	const m = raw as Record<string, unknown>;
	const knownId = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && widgetIds.has(v);
	switch (m.type) {
		case "add": {
			const screen = m.screen;
			if (typeof m.widgetType !== "number" || !paletteTypes().some((t) => t.type === m.widgetType) || !finite(m.x) || !finite(m.y)) {
				return undefined;
			}
			return typeof screen === "number" && Number.isInteger(screen) && screen >= 1 && screen <= 99 ? { type: "add", widgetType: m.widgetType, x: m.x, y: m.y, screen } : undefined;
		}
		case "delete":
			return knownId(m.id) ? { type: "delete", id: m.id } : undefined;
		case "requestRefs":
			return knownId(m.id) ? { type: "requestRefs", id: m.id } : undefined;
		case "select":
			return m.id === null ? { type: "select", id: null } : knownId(m.id) ? { type: "select", id: m.id } : undefined;
		case "renameAlias":
			return knownId(m.id) && typeof m.alias === "string" && m.alias.length <= 64 ? { type: "renameAlias", id: m.id, alias: m.alias } : undefined;
		case "setProp": {
			if (!knownId(m.id) || typeof m.field !== "string" || !(typeof m.value === "string" ? m.value.length <= WIDGET_VALUE_MAX : finite(m.value))) {
				return undefined;
			}
			const type = types?.get(m.id);
			const f = type === undefined ? WIDGET_TYPES.map((t) => widgetFieldByName(t.type, m.field as string)).find((x) => x?.editable) : widgetFieldByName(type, m.field);
			return f && f.editable && f.kind !== "alias" && Object.prototype.hasOwnProperty.call(f, "name") ? { type: "setProp", id: m.id, field: f.name, value: m.value as string | number } : undefined;
		}
		case "edit": {
			if (typeof m.id !== "number" || !Number.isInteger(m.id) || !widgetIds.has(m.id)) {
				return undefined;
			}
			const patch: GeometryPatch = {};
			for (const [from, to] of [["x", "x"], ["y", "y"], ["w", "w"], ["h", "h"]] as const) {
				const v = m[from];
				if (typeof v === "number" && Number.isFinite(v)) {
					patch[to] = v;
				}
			}
			return Object.keys(patch).length > 0 ? { type: "edit", id: m.id, patch } : undefined;
		}
		case "state":
			return { type: "state", state: previewState.sanitize(m.state) };
		case "prefs": {
			if (typeof m.snap !== "boolean") {
				return undefined;
			}
			const g = typeof m.grid === "number" && Number.isInteger(m.grid) && m.grid >= 1 && m.grid <= MAX_GRID ? m.grid : DEFAULT_GRID;
			return { type: "prefs", snap: m.snap, grid: g };
		}
		default:
			return undefined;
	}
}
