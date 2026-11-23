/**
 * Link routing for the hand-editable SFC layout. Pure: no `vscode` imports.
 *
 * `createGeometry` is deliberately self-contained (no reference to anything outside its body) so the
 * very same code runs in the extension (merge + tests) and, through `GEOMETRY_SOURCE`, inside the
 * webview while dragging. Never add outer references to it.
 */
export interface Pt {
	x: number;
	y: number;
}

export interface Box extends Pt {
	w: number;
	h: number;
}

export interface RouteSpec {
	/** Source step; absent for "from any step" links, which start at the bar. */
	from?: Box;
	/** Target step; absent when the transition has no target. */
	to?: Box;
	/** Centre of the transition bar. */
	bar: Pt;
	/** Bend points between the source step and the bar (ignored without `from`). */
	before: Pt[];
	/** Bend points between the bar and the target step. */
	after: Pt[];
}

export interface Route {
	points: Pt[];
	/** For control point i (source, bends, bar, bends, target), its index in `points`. */
	ctrl: number[];
}

export interface Geometry {
	route(spec: RouteSpec): Route;
	/** Where a new bend point at `at` goes: it splits the visible segment nearest to `at`. */
	insertBend(spec: RouteSpec, at: Pt): { before: Pt[]; after: Pt[] };
}

export function createGeometry(): Geometry {
	interface Control {
		p: { x: number; y: number };
		bend: boolean;
	}

	function controls(spec: RouteSpec): Control[] {
		const mid: Control[] = [];
		const before = spec.from ? spec.before : [];
		for (const p of before) {
			mid.push({ p, bend: true });
		}
		mid.push({ p: spec.bar, bend: false });
		for (const p of spec.after) {
			mid.push({ p, bend: true });
		}
		const out: Control[] = [];
		if (spec.from) {
			const f = spec.from;
			// Leave through the top when the first control point lies above the step's middle.
			out.push({ p: { x: f.x + f.w / 2, y: mid[0].p.y < f.y + f.h / 2 ? f.y : f.y + f.h }, bend: false });
		}
		out.push(...mid);
		if (spec.to) {
			const t = spec.to;
			const prevY = mid[mid.length - 1].p.y;
			// Enter through the bottom when the last control point lies below the step's middle.
			out.push({ p: { x: t.x + t.w / 2, y: prevY > t.y + t.h / 2 ? t.y + t.h : t.y }, bend: false });
		}
		return out;
	}

	function route(spec: RouteSpec): Route {
		const c = controls(spec);
		const points: { x: number; y: number }[] = [];
		const ctrl: number[] = [];
		const push = (p: { x: number; y: number }): void => {
			const last = points[points.length - 1];
			if (!last || last.x !== p.x || last.y !== p.y) {
				points.push({ x: p.x, y: p.y });
			}
		};
		c.forEach((cur, i) => {
			if (i > 0) {
				const prev = c[i - 1];
				// Automatic segments (no bend at either end) are Z-shaped; segments next to a bend are straight.
				if (!prev.bend && !cur.bend && Math.abs(prev.p.x - cur.p.x) > 0.5 && Math.abs(prev.p.y - cur.p.y) > 0.5) {
					const my = (prev.p.y + cur.p.y) / 2;
					push({ x: prev.p.x, y: my });
					push({ x: cur.p.x, y: my });
				}
			}
			push(cur.p);
			ctrl.push(points.length - 1);
		});
		return { points, ctrl };
	}

	function insertBend(spec: RouteSpec, at: { x: number; y: number }): { before: { x: number; y: number }[]; after: { x: number; y: number }[] } {
		const { points, ctrl } = route(spec);
		let best = 0;
		let bestD = Infinity;
		for (let i = 0; i + 1 < points.length; i++) {
			const a = points[i];
			const b = points[i + 1];
			const dx = b.x - a.x;
			const dy = b.y - a.y;
			const len2 = dx * dx + dy * dy;
			const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((at.x - a.x) * dx + (at.y - a.y) * dy) / len2));
			const d = Math.hypot(at.x - (a.x + t * dx), at.y - (a.y + t * dy));
			if (d < bestD) {
				bestD = d;
				best = i;
			}
		}
		let k = 0;
		for (let i = 0; i + 1 < ctrl.length; i++) {
			if (ctrl[i] <= best) {
				k = i;
			}
		}
		const off = spec.from ? 1 : 0;
		const before = spec.from ? spec.before.map((p) => ({ x: p.x, y: p.y })) : [];
		const after = spec.after.map((p) => ({ x: p.x, y: p.y }));
		const barAt = off + before.length;
		const p = { x: at.x, y: at.y };
		if (k + 1 <= barAt) {
			before.splice(k + 1 - off, 0, p);
		} else {
			after.splice(k + 1 - (barAt + 1), 0, p);
		}
		return { before, after };
	}

	return { route, insertBend };
}

export const geometry: Geometry = createGeometry();

/** JavaScript expression evaluating to the same `Geometry`, for embedding in the webview script. */
export const GEOMETRY_SOURCE = `(${createGeometry.toString()})()`;
