/**
 * Views over a `CallGraph`: module aggregation (Level 2), module detail (Level 3), routine
 * neighbourhood, search and the two deterministic layouts. Pure: no `vscode` imports.
 *
 * `createCallViews` is deliberately self-contained (no reference to anything outside its body) so
 * the very same code runs in the extension (tests, docs export) and, through `CALL_VIEWS_SOURCE`,
 * inside the webview. Never add outer references to it (types are fine: they are erased).
 */
import type { CallGraph } from "./callGraph";

export type Granularity = "file" | "folder";

export interface ModuleNode {
	/** File label (file granularity) or folder (folder granularity). */
	id: string;
	label: string;
	/** Folder frame the node is drawn in; empty when there is no frame. */
	group: string;
	routines: number;
	/** Calls between routines of this same module. */
	internal: number;
	incoming: number;
	outgoing: number;
}

/** Aggregated edge; `sites` index `CallGraph.sites`. */
export interface ModuleEdge {
	from: string;
	to: string;
	count: number;
	sites: number[];
}

export interface BuiltinEdge {
	from: string;
	count: number;
	sites: number[];
}

export interface ModuleView {
	nodes: ModuleNode[];
	edges: ModuleEdge[];
	builtins: BuiltinEdge[];
}

export interface RoutineEdge {
	from: number;
	to: number;
	count: number;
	sites: number[];
}

/** Routine -> other module. */
export interface OutEdge {
	from: number;
	to: string;
	count: number;
	sites: number[];
}

/** Other module -> routine. */
export interface InEdge {
	from: string;
	to: number;
	count: number;
	sites: number[];
}

export interface RoutineBuiltins {
	from: number;
	count: number;
	sites: number[];
}

export interface ModuleDetail {
	routines: number[];
	internal: RoutineEdge[];
	outgoing: OutEdge[];
	incoming: InEdge[];
	builtins: RoutineBuiltins[];
	/** Other modules the routines call, then those that call them (first appearance order). */
	outModules: string[];
	inModules: string[];
}

export interface Neighbor {
	id: number;
	count: number;
	sites: number[];
}

export interface Neighborhood {
	routine: number;
	callers: Neighbor[];
	callees: Neighbor[];
	builtins: { name: string; count: number }[];
	/** File labels involved: the routine's own, then its callers', then its callees'. */
	modules: string[];
}

export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface GroupedLayout {
	pos: Record<string, Rect>;
	groups: { name: string; x: number; y: number; w: number; h: number }[];
	width: number;
	height: number;
}

export interface ColumnLayout {
	pos: Record<string, Rect>;
	width: number;
	height: number;
}

export function createCallViews() {
	const keyOf = (g: CallGraph, routine: number, gran: Granularity): string => {
		const f = g.files[g.routines[routine].file];
		return gran === "folder" ? f.folder : f.label;
	};
	const baseName = (label: string): string => label.slice(label.lastIndexOf("/") + 1);

	/** Accumulates `sites` per key, keeping insertion order. */
	const bucket = <T extends { count: number; sites: number[] }>(map: Map<string, T>, key: string, make: () => T, site: number): void => {
		let e = map.get(key);
		if (!e) {
			e = make();
			map.set(key, e);
		}
		e.count++;
		e.sites.push(site);
	};

	function moduleView(g: CallGraph, gran: Granularity): ModuleView {
		const nodes = new Map<string, ModuleNode>();
		g.files.forEach((f) => {
			const id = gran === "folder" ? f.folder : f.label;
			if (!nodes.has(id)) {
				nodes.set(id, { id, label: gran === "folder" ? f.folder : baseName(f.label), group: gran === "folder" ? "" : f.folder, routines: 0, internal: 0, incoming: 0, outgoing: 0 });
			}
		});
		g.routines.forEach((r) => {
			nodes.get(keyOf(g, r.id, gran))!.routines++;
		});
		const edges = new Map<string, ModuleEdge>();
		const builtins = new Map<string, BuiltinEdge>();
		g.sites.forEach((s, i) => {
			const a = keyOf(g, s.from, gran);
			if (s.to < 0) {
				bucket(builtins, a, () => ({ from: a, count: 0, sites: [] }), i);
				return;
			}
			const b = keyOf(g, s.to, gran);
			if (a === b) {
				nodes.get(a)!.internal++;
				return;
			}
			nodes.get(a)!.outgoing++;
			nodes.get(b)!.incoming++;
			bucket(edges, a + "\u0000" + b, () => ({ from: a, to: b, count: 0, sites: [] }), i);
		});
		return { nodes: [...nodes.values()], edges: [...edges.values()], builtins: [...builtins.values()] };
	}

	function moduleDetail(g: CallGraph, gran: Granularity, key: string): ModuleDetail {
		const mine = new Set<number>();
		g.routines.forEach((r) => {
			if (keyOf(g, r.id, gran) === key) {
				mine.add(r.id);
			}
		});
		const internal = new Map<string, RoutineEdge>();
		const outgoing = new Map<string, OutEdge>();
		const incoming = new Map<string, InEdge>();
		const builtins = new Map<string, RoutineBuiltins>();
		g.sites.forEach((s, i) => {
			const fromMine = mine.has(s.from);
			if (s.to < 0) {
				if (fromMine) {
					bucket(builtins, String(s.from), () => ({ from: s.from, count: 0, sites: [] }), i);
				}
				return;
			}
			const toMine = mine.has(s.to);
			if (fromMine && toMine) {
				bucket(internal, s.from + ">" + s.to, () => ({ from: s.from, to: s.to, count: 0, sites: [] }), i);
			} else if (fromMine) {
				const other = keyOf(g, s.to, gran);
				bucket(outgoing, s.from + ">" + other, () => ({ from: s.from, to: other, count: 0, sites: [] }), i);
			} else if (toMine) {
				const other = keyOf(g, s.from, gran);
				bucket(incoming, other + ">" + s.to, () => ({ from: other, to: s.to, count: 0, sites: [] }), i);
			}
		});
		const out = [...outgoing.values()];
		const inc = [...incoming.values()];
		return {
			routines: [...mine],
			internal: [...internal.values()],
			outgoing: out,
			incoming: inc,
			builtins: [...builtins.values()],
			outModules: [...new Set(out.map((e) => e.to))],
			inModules: [...new Set(inc.map((e) => e.from))],
		};
	}

	function neighborhood(g: CallGraph, id: number): Neighborhood {
		const callers = new Map<number, Neighbor>();
		const callees = new Map<number, Neighbor>();
		const builtins = new Map<string, { name: string; count: number }>();
		g.sites.forEach((s, i) => {
			const add = (m: Map<number, Neighbor>, other: number): void => {
				let n = m.get(other);
				if (!n) {
					n = { id: other, count: 0, sites: [] };
					m.set(other, n);
				}
				n.count++;
				n.sites.push(i);
			};
			if (s.to === id) {
				add(callers, s.from);
			}
			if (s.from === id) {
				if (s.to >= 0) {
					add(callees, s.to);
				} else {
					const k = s.name.toLowerCase();
					const b = builtins.get(k);
					if (b) {
						b.count++;
					} else {
						builtins.set(k, { name: s.name, count: 1 });
					}
				}
			}
		});
		const byId = (a: Neighbor, b: Neighbor): number => a.id - b.id;
		const cs = [...callers.values()].sort(byId);
		const ce = [...callees.values()].sort(byId);
		const label = (r: number): string => g.files[g.routines[r].file].label;
		const modules = [...new Set([label(id), ...cs.map((n) => label(n.id)), ...ce.map((n) => label(n.id))])];
		return { routine: id, callers: cs, callees: ce, builtins: [...builtins.values()], modules };
	}

	/** Routine ids whose name matches, case-insensitively: exact first, then prefix, then substring. */
	function search(g: CallGraph, query: string, limit = 50): number[] {
		const q = query.trim().toLowerCase();
		if (q === "") {
			return [];
		}
		const scored: { id: number; score: number }[] = [];
		g.routines.forEach((r) => {
			const n = r.name.toLowerCase();
			const at = n.indexOf(q);
			if (at >= 0) {
				scored.push({ id: r.id, score: n === q ? 0 : at === 0 ? 1 : 2 });
			}
		});
		scored.sort((a, b) => a.score - b.score || a.id - b.id);
		return scored.slice(0, limit).map((s) => s.id);
	}

	const NODE_W = 170;
	const NODE_H = 40;
	const GAP_X = 26;
	const GAP_Y = 20;
	const PAD = 16;
	const HEAD = 24;
	const SHELF = 1300;

	/** Items grouped in labelled folder frames; frames are shelf-packed, items form a grid inside. */
	function layoutGrouped(items: { id: string; group: string }[]): GroupedLayout {
		const order: string[] = [];
		const members = new Map<string, string[]>();
		items.forEach((it) => {
			if (!members.has(it.group)) {
				members.set(it.group, []);
				order.push(it.group);
			}
			members.get(it.group)!.push(it.id);
		});
		const blocks = order.map((name) => {
			const ids = members.get(name)!;
			const framed = name !== "";
			const cols = Math.max(1, Math.ceil(Math.sqrt(ids.length)));
			const rows = Math.ceil(ids.length / cols);
			const pad = framed ? PAD : 0;
			const head = framed ? HEAD : 0;
			return {
				name,
				ids,
				cols,
				pad,
				head,
				framed,
				w: cols * NODE_W + (cols - 1) * GAP_X + 2 * pad,
				h: head + rows * NODE_H + (rows - 1) * GAP_Y + 2 * pad,
			};
		});
		const maxW = Math.max(SHELF, ...blocks.map((b) => b.w));
		const pos: Record<string, Rect> = {};
		const groups: GroupedLayout["groups"] = [];
		let x = 0;
		let y = 0;
		let rowH = 0;
		let width = 0;
		for (const b of blocks) {
			if (x > 0 && x + b.w > maxW) {
				x = 0;
				y += rowH + 2 * GAP_Y;
				rowH = 0;
			}
			if (b.framed) {
				groups.push({ name: b.name, x, y, w: b.w, h: b.h });
			}
			b.ids.forEach((id, i) => {
				pos[id] = {
					x: x + b.pad + (i % b.cols) * (NODE_W + GAP_X),
					y: y + b.pad + b.head + Math.floor(i / b.cols) * (NODE_H + GAP_Y),
					w: NODE_W,
					h: NODE_H,
				};
			});
			x += b.w + 2 * GAP_X;
			rowH = Math.max(rowH, b.h);
			width = Math.max(width, x - 2 * GAP_X);
		}
		return { pos, groups, width, height: y + rowH };
	}

	const ROUTINE_W = 210;
	const ROUTINE_H = 30;
	const COL_GAP = 150;
	const MAX_ROWS = 14;

	/** Incoming modules left, routines in the middle (columns of at most 14), outgoing modules right. */
	function layoutColumns(left: string[], center: string[], right: string[]): ColumnLayout {
		const pos: Record<string, Rect> = {};
		const cCols = Math.max(1, Math.ceil(center.length / MAX_ROWS));
		const cRows = Math.min(center.length, MAX_ROWS);
		const cHeight = Math.max(0, cRows * (ROUTINE_H + 12) - 12);
		const lHeight = Math.max(0, left.length * (NODE_H + 14) - 14);
		const rHeight = Math.max(0, right.length * (NODE_H + 14) - 14);
		const height = Math.max(cHeight, lHeight, rHeight);
		const cX = NODE_W + COL_GAP;
		const cWidth = cCols * ROUTINE_W + (cCols - 1) * 30;
		left.forEach((id, i) => {
			pos[id] = { x: 0, y: (height - lHeight) / 2 + i * (NODE_H + 14), w: NODE_W, h: NODE_H };
		});
		center.forEach((id, i) => {
			pos[id] = {
				x: cX + Math.floor(i / MAX_ROWS) * (ROUTINE_W + 30),
				y: (height - cHeight) / 2 + (i % MAX_ROWS) * (ROUTINE_H + 12),
				w: ROUTINE_W,
				h: ROUTINE_H,
			};
		});
		const rX = cX + cWidth + COL_GAP;
		right.forEach((id, i) => {
			pos[id] = { x: rX, y: (height - rHeight) / 2 + i * (NODE_H + 14), w: NODE_W, h: NODE_H };
		});
		return { pos, width: rX + NODE_W, height };
	}

	return { moduleView, moduleDetail, neighborhood, search, layoutGrouped, layoutColumns };
}

export const callViews = createCallViews();

/** Source of the factory call, evaluated inside the webview. */
export const CALL_VIEWS_SOURCE = `(${createCallViews.toString()})()`;
