/**
 * Document model of the screen editor (pure, no `vscode` import): the geometry edits made on top of the
 * `.rev` as it was read. It is immutable; the `CustomEditorProvider` keeps the state before and after each
 * edit so VS Code's undo/redo, dirty tracking and save point work from the platform.
 *
 * Only geometry is editable (x, y, and width/height for the types that store them). Widget ids, line order and
 * every other field never change, which is what keeps the written diff to one line per edited widget.
 */
import type { RevModel, RevWidget } from "../rev";
import type { WidgetPatch } from "../rev/serialize";
import { editorMath } from "./editorMath";

export interface Geometry {
	x: number;
	y: number;
	width?: number;
	height?: number;
}

/** Full effective geometry of the widgets that differ from the file, keyed by widget id. */
export interface EditState {
	geom: Record<number, Geometry>;
}

/** What the page may ask for: loose numbers that are validated, rounded and clamped here. */
export interface GeometryPatch {
	x?: number;
	y?: number;
	w?: number;
	h?: number;
}

export type SetResult = { ok: true; state: EditState; geometry: Geometry } | { ok: false; reason: string };

export function emptyEditState(): EditState {
	return { geom: {} };
}

/** Widgets of these types store a size; scale (1) and symbol (6) store only a position. */
export function hasSize(w: RevWidget): boolean {
	return w.width !== undefined && w.height !== undefined;
}

export function originalGeometry(w: RevWidget): Geometry {
	return { x: w.x ?? 0, y: w.y ?? 0, ...(hasSize(w) ? { width: w.width, height: w.height } : {}) };
}

export function effectiveGeometry(w: RevWidget, state: EditState): Geometry {
	return state.geom[w.id] ?? originalGeometry(w);
}

const same = (a: Geometry, b: Geometry): boolean => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

const clampInt = (n: number): number => Math.max(editorMath.COORD_MIN, Math.min(editorMath.COORD_MAX, Math.round(n)));

/** Applies `patch` to widget `id`. Dropping back to the file's geometry removes the entry (document clean again). */
export function setGeometry(state: EditState, rev: RevModel, id: number, patch: GeometryPatch): SetResult {
	const w = rev.widgets.find((x) => x.id === id);
	if (!w || w.x === undefined || w.y === undefined) {
		return { ok: false, reason: `Widget ${id} cannot be edited` };
	}
	for (const [k, v] of Object.entries(patch)) {
		if (v !== undefined && !isNum(v)) {
			return { ok: false, reason: `${k} is not a number` };
		}
	}
	if ((patch.w !== undefined || patch.h !== undefined) && !hasSize(w)) {
		return { ok: false, reason: `Widget ${id} (type ${w.type}) does not store a size` };
	}
	const cur = effectiveGeometry(w, state);
	const next: Geometry = {
		x: patch.x !== undefined ? clampInt(patch.x) : cur.x,
		y: patch.y !== undefined ? clampInt(patch.y) : cur.y,
		...(hasSize(w)
			? {
					width: patch.w !== undefined ? Math.max(editorMath.MIN_SIZE, clampInt(patch.w)) : cur.width,
					height: patch.h !== undefined ? Math.max(editorMath.MIN_SIZE, clampInt(patch.h)) : cur.height,
				}
			: {}),
	};
	const geom = { ...state.geom };
	if (same(next, originalGeometry(w))) {
		delete geom[id];
	} else {
		geom[id] = next;
	}
	return { ok: true, state: { geom }, geometry: next };
}

export function isDirty(rev: RevModel, state: EditState): boolean {
	return toPatches(rev, state).length > 0;
}

/** Serializer patches for the widgets whose geometry differs from the file; ascending by id. */
export function toPatches(rev: RevModel, state: EditState): WidgetPatch[] {
	const out: WidgetPatch[] = [];
	for (const w of rev.widgets) {
		const g = state.geom[w.id];
		if (g && !same(g, originalGeometry(w))) {
			out.push({ id: w.id, x: g.x, y: g.y, ...(g.width !== undefined ? { width: g.width } : {}), ...(g.height !== undefined ? { height: g.height } : {}) });
		}
	}
	return out.sort((a, b) => a.id - b.id);
}

/** The widgets as they look with the edits applied (same order as `widgets`). */
export function withEdits<T extends RevWidget>(widgets: readonly T[], state: EditState): T[] {
	return widgets.map((w) => {
		const g = state.geom[w.id];
		return g ? { ...w, x: g.x, y: g.y, ...(g.width !== undefined ? { width: g.width } : {}), ...(g.height !== undefined ? { height: g.height } : {}) } : w;
	});
}

export function editLabel(w: RevWidget, patch: GeometryPatch): string {
	const moves = patch.x !== undefined || patch.y !== undefined;
	const sizes = patch.w !== undefined || patch.h !== undefined;
	return `${moves && sizes ? "Edit" : sizes ? "Resize" : "Move"} widget ${w.id}`;
}

export function serializeEditState(state: EditState): string {
	return JSON.stringify(state);
}

/** Restores a hot-exit backup; entries for unknown widgets or with bad numbers are dropped. */
export function parseEditState(raw: unknown, rev: RevModel): EditState {
	let state = emptyEditState();
	const geom = (raw as { geom?: unknown } | null | undefined)?.geom;
	if (!geom || typeof geom !== "object" || Array.isArray(geom)) {
		return state;
	}
	for (const [key, value] of Object.entries(geom as Record<string, unknown>)) {
		const v = value as Record<string, unknown> | null;
		if (!v || typeof v !== "object") {
			continue;
		}
		const r = setGeometry(state, rev, Number(key), { x: v.x as number, y: v.y as number, w: v.width as number | undefined, h: v.height as number | undefined });
		if (r.ok) {
			state = r.state;
		}
	}
	return state;
}
