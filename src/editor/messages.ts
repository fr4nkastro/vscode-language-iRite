/** Validation of webview-to-extension messages of the screen editor (pure, no `vscode` import). */
import { previewState } from "../preview/previewState";
import type { PreviewState } from "../preview/previewState";
import type { GeometryPatch } from "./editState";

export type EditorMessage =
	| { type: "edit"; id: number; patch: GeometryPatch }
	| { type: "state"; state: PreviewState }
	| { type: "prefs"; snap: boolean; grid: number };

export const DEFAULT_GRID = 8;
const MAX_GRID = 200;

/** Returns a trusted message, or undefined for anything unknown, malformed or aimed at a widget that is not in the file. */
export function parseEditorMessage(raw: unknown, widgetIds: ReadonlySet<number>): EditorMessage | undefined {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		return undefined;
	}
	const m = raw as Record<string, unknown>;
	switch (m.type) {
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
