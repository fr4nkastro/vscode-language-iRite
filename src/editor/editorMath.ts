/**
 * Geometry helpers of the screen editor: snap, pointer-delta conversion, move, resize, nudge (pure, no
 * `vscode` import). Everything is expressed in authored 7" pixels (the `.rev` space); the 12" view only
 * changes how pointer deltas are converted back (`toAuthored`).
 *
 * `createEditorMath` is deliberately self-contained (no reference to anything outside its body) so the same
 * code runs in the extension (tests) and, through `EDITOR_MATH_SOURCE`, in the webview. Never add outer
 * references to it (types are fine: they are erased).
 */

export interface EditRect {
	x: number;
	y: number;
	w: number;
	h: number;
}

export type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export function createEditorMath() {
	const COORD_MIN = -10000;
	const COORD_MAX = 10000;
	const MIN_SIZE = 1;
	const clamp = (n: number): number => Math.max(COORD_MIN, Math.min(COORD_MAX, Math.round(n)));

	/** Nearest multiple of `grid`; just rounds when the grid is off (<= 1) or not a usable number. */
	function snap(n: number, grid: number): number {
		return Number.isFinite(grid) && grid > 1 ? Math.round(n / grid) * grid : Math.round(n);
	}

	/** Pointer delta in screen pixels -> authored 7" pixels, given the page zoom and the panel scale (1 / 1.6). */
	function toAuthored(delta: number, viewScale: number, panelScale: number): number {
		return delta / (viewScale * panelScale);
	}

	function move(r: EditRect, dx: number, dy: number, grid: number): { x: number; y: number } {
		return { x: clamp(snap(r.x + dx, grid)), y: clamp(snap(r.y + dy, grid)) };
	}

	/** The edge(s) named by the handle move by the delta (snapped); the opposite edge stays; size never below 1. */
	function resize(r: EditRect, handle: ResizeHandle, dx: number, dy: number, grid: number): EditRect {
		let left = r.x;
		let top = r.y;
		let right = r.x + r.w;
		let bottom = r.y + r.h;
		if (handle.includes("w")) {
			left = Math.min(clamp(snap(left + dx, grid)), right - MIN_SIZE);
		}
		if (handle.includes("e")) {
			right = Math.max(clamp(snap(right + dx, grid)), left + MIN_SIZE);
		}
		if (handle.includes("n")) {
			top = Math.min(clamp(snap(top + dy, grid)), bottom - MIN_SIZE);
		}
		if (handle.includes("s")) {
			bottom = Math.max(clamp(snap(bottom + dy, grid)), top + MIN_SIZE);
		}
		return { x: left, y: top, w: right - left, h: bottom - top };
	}

	/** Arrow keys: 1 px, Shift = one grid step (10 px when the grid is off). Undefined for any other key. */
	function nudge(r: EditRect, key: string, shift: boolean, grid: number): { x: number; y: number } | undefined {
		const step = shift ? (Number.isFinite(grid) && grid > 1 ? grid : 10) : 1;
		switch (key) {
			case "ArrowLeft":
				return { x: clamp(r.x - step), y: r.y };
			case "ArrowRight":
				return { x: clamp(r.x + step), y: r.y };
			case "ArrowUp":
				return { x: r.x, y: clamp(r.y - step) };
			case "ArrowDown":
				return { x: r.x, y: clamp(r.y + step) };
			default:
				return undefined;
		}
	}

	return { COORD_MIN, COORD_MAX, MIN_SIZE, snap, toAuthored, move, resize, nudge };
}

export const editorMath = createEditorMath();

/** Expression that evaluates to the same API inside the webview. */
export const EDITOR_MATH_SOURCE = `(${createEditorMath.toString()})()`;
