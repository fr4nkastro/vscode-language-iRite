/** Deterministic layered layout of an SFC model. Pure: no `vscode` imports. */
import type { SfcModel, SfcTransition } from "./sfcModel";

export interface LayoutNode {
	name: string;
	x: number;
	y: number;
	w: number;
	h: number;
	rank: number;
	initial: boolean;
	entryRoutine?: string;
	file?: string;
	line?: number;
	/** True when the position comes from a saved manual layout. */
	moved?: boolean;
}

export interface LayoutPoint {
	x: number;
	y: number;
}

export interface LayoutLink {
	transition: string;
	/** Source step; undefined for "from any step" links. */
	from?: string;
	to?: string;
	/** Transition bar (centered on x, w wide). */
	bar: { x: number; y: number; w: number };
	/** Polyline from the source step (or lane) through the bar to the target step. */
	points: LayoutPoint[];
	/** Truncated receptivity label shown next to the bar. */
	label: string;
	/** Full text for the tooltip. */
	tooltip: string;
	back: boolean;
	global: boolean;
	dashed: boolean;
	/** Manual bend points between the source step and the bar (set by `mergeLayout`). */
	before?: LayoutPoint[];
	/** Manual bend points between the bar and the target step (set by `mergeLayout`). */
	after?: LayoutPoint[];
	/** True when the bar position was fixed by hand (otherwise it follows its source step). */
	barFixed?: boolean;
}

export interface LayoutNote {
	x: number;
	y: number;
	text: string;
}

export interface SfcLayout {
	width: number;
	height: number;
	nodes: LayoutNode[];
	links: LayoutLink[];
	notes: LayoutNote[];
}

export const BOX_W = 150;
export const BOX_H = 44;
const RANK_GAP = 90;
const SLOT_MIN = 260;
const SLOT_PER_LINK = 250;
const BAR_W = 36;
const MARGIN = 40;
const LABEL_MAX = 36;
const lc = (s: string): string => s.toLowerCase();

function condense(conds: string[]): string {
	return conds
		.map((c) => c.replace(/GetState\s*\([^)]*\)/gi, "state").replace(/\s+/g, " ").trim())
		.filter((c) => c.length > 0)
		.join(" and ");
}

function describeLink(t: SfcTransition, from: string | undefined): { label: string; tooltip: string } {
	const emitters = t.emitters.filter((e) => {
		const src = e.sources ?? [];
		return from === undefined ? src.length === 0 : src.some((s) => lc(s) === lc(from));
	});
	const texts = [...new Set(emitters.map((e) => condense(e.conditions)).filter((c) => c.length > 0))];
	const cond = texts.join(" | ");
	const full = cond ? `${t.name}: ${cond}` : t.name;
	const label = full.length > LABEL_MAX ? `${full.slice(0, LABEL_MAX - 1)}…` : full;
	const lines = [full, ...emitters.map((e) => `${e.routine} (${e.via}) line ${e.line}`)];
	return { label, tooltip: lines.join("\n") };
}

export function layoutSfc(sfc: SfcModel): SfcLayout {
	const stepIdx = new Map(sfc.steps.map((s, i) => [lc(s.name), i]));
	const initial = sfc.steps.find((s) => s.initial);

	// Specific links, in transition order.
	interface Edge {
		t: SfcTransition;
		from: string;
	}
	const outgoing = new Map<string, Edge[]>();
	for (const s of sfc.steps) {
		outgoing.set(lc(s.name), []);
	}
	for (const t of sfc.transitions) {
		for (const from of t.sources) {
			outgoing.get(lc(from))?.push({ t, from });
		}
	}

	// BFS ranks.
	const rank = new Map<string, number>();
	const order: string[] = [];
	if (initial) {
		rank.set(lc(initial.name), 0);
		order.push(initial.name);
		for (let i = 0; i < order.length; i++) {
			for (const e of outgoing.get(lc(order[i])) ?? []) {
				if (e.t.target && stepIdx.has(lc(e.t.target)) && !rank.has(lc(e.t.target))) {
					rank.set(lc(e.t.target), rank.get(lc(order[i]))! + 1);
					order.push(sfc.steps[stepIdx.get(lc(e.t.target))!].name);
				}
			}
		}
	}
	const maxRank = Math.max(-1, ...rank.values());
	for (const s of sfc.steps) {
		if (!rank.has(lc(s.name))) {
			rank.set(lc(s.name), maxRank + 1);
			order.push(s.name);
		}
	}

	// Columns per rank (BFS discovery order).
	const nodes: LayoutNode[] = [];
	const byName = new Map<string, LayoutNode>();
	const cursor = new Map<number, number>();
	for (const name of order) {
		const step = sfc.steps[stepIdx.get(lc(name))!];
		const r = rank.get(lc(name))!;
		const k = Math.max(1, outgoing.get(lc(name))!.length);
		const slot = Math.max(SLOT_MIN, k * SLOT_PER_LINK);
		const start = cursor.get(r) ?? MARGIN;
		cursor.set(r, start + slot);
		const node: LayoutNode = {
			name: step.name,
			x: start + (slot - BOX_W) / 2,
			y: MARGIN + r * (BOX_H + RANK_GAP),
			w: BOX_W,
			h: BOX_H,
			rank: r,
			initial: step.initial,
			entryRoutine: step.entryRoutine,
			file: step.source?.file,
			line: step.source?.line,
		};
		nodes.push(node);
		byName.set(lc(name), node);
	}
	const maxRight = Math.max(MARGIN, ...nodes.map((n) => Math.max(n.x + n.w, (cursor.get(n.rank) ?? 0) - 40)));
	const sideBase = maxRight + 50;
	let channels = 0;

	const links: LayoutLink[] = [];
	const dedupe = (pts: LayoutPoint[]): LayoutPoint[] => pts.filter((p, i) => i === 0 || p.x !== pts[i - 1].x || p.y !== pts[i - 1].y);

	for (const s of sfc.steps) {
		const node = byName.get(lc(s.name))!;
		const outs = outgoing.get(lc(s.name))!;
		const cx = node.x + node.w / 2;
		outs.forEach((e, i) => {
			const bx = cx + (i - (outs.length - 1) / 2) * SLOT_PER_LINK;
			const barY = node.y + node.h + 30;
			const tgt = e.t.target ? byName.get(lc(e.t.target)) : undefined;
			const back = !!tgt && tgt.rank <= node.rank;
			const head: LayoutPoint[] = [
				{ x: cx, y: node.y + node.h },
				{ x: cx, y: node.y + node.h + 12 },
				{ x: bx, y: node.y + node.h + 12 },
				{ x: bx, y: barY },
			];
			let tail: LayoutPoint[] = [];
			if (tgt) {
				const tcx = tgt.x + tgt.w / 2;
				if (tgt.rank === node.rank + 1) {
					tail = [{ x: bx, y: tgt.y - 14 }, { x: tcx, y: tgt.y - 14 }, { x: tcx, y: tgt.y }];
				} else {
					const chx = sideBase + 14 * channels++;
					tail = [
						{ x: bx, y: node.y + node.h + 44 },
						{ x: chx, y: node.y + node.h + 44 },
						{ x: chx, y: tgt.y - 14 },
						{ x: tcx, y: tgt.y - 14 },
						{ x: tcx, y: tgt.y },
					];
				}
			}
			const d = describeLink(e.t, s.name);
			links.push({
				transition: e.t.name,
				from: s.name,
				to: tgt?.name,
				bar: { x: bx, y: barY, w: BAR_W },
				points: dedupe([...head, ...tail]),
				label: d.label,
				tooltip: d.tooltip,
				back,
				global: false,
				dashed: false,
			});
		});
	}

	// Global lane: "from any step" transitions (and transitions never emitted).
	const globals = sfc.transitions.filter((t) => t.anyStep || t.emitters.length === 0);
	const laneX = sideBase + 14 * (channels + globals.length) + 70;
	const notes: LayoutNote[] = [];
	let height = Math.max(...nodes.map((n) => n.y + n.h), MARGIN) + MARGIN;
	if (globals.length > 0) {
		notes.push({ x: laneX - BAR_W / 2, y: MARGIN, text: "from any step" });
		globals.forEach((t, i) => {
			const y = MARGIN + 40 + i * 56;
			const gx = sideBase + 14 * (channels + i);
			const tgt = t.target ? byName.get(lc(t.target)) : undefined;
			const d = describeLink(t, undefined);
			const never = t.emitters.length === 0;
			const pts: LayoutPoint[] = [{ x: laneX, y }];
			if (tgt) {
				const tcx = tgt.x + tgt.w / 2;
				pts.push({ x: gx, y }, { x: gx, y: tgt.y - 14 }, { x: tcx, y: tgt.y - 14 }, { x: tcx, y: tgt.y });
			}
			links.push({
				transition: t.name,
				to: tgt?.name,
				bar: { x: laneX, y, w: BAR_W },
				points: dedupe(pts),
				label: never ? `${d.label} (never emitted)` : d.label,
				tooltip: never ? `${d.tooltip}\nnever emitted` : d.tooltip,
				back: false,
				global: true,
				dashed: true,
			});
			height = Math.max(height, y + MARGIN);
		});
	}
	return { width: laneX + 300, height, nodes, links, notes };
}
