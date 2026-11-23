/** Applies a saved manual layout on top of the automatic one. Pure: no `vscode` imports. */
import { geometry } from "./sfcGeometry";
import type { Pt } from "./sfcGeometry";
import type { LayoutLink, LayoutNode, SfcLayout } from "./sfcLayout";
import { isEmptyDiagram, isRecord, linkKey, sanitizeDiagram, stepKey } from "./sfcSidecar";
import type { SavedDiagram } from "./sfcSidecar";

export interface MergeResult {
	layout: SfcLayout;
	/** Saved keys that match no current step / link (renamed or removed); they are not applied. */
	ignored: { steps: string[]; links: string[] };
}

const MARGIN = 40;
const lc = (s: string): string => s.toLowerCase();
const box = (n: LayoutNode) => ({ x: n.x, y: n.y, w: n.w, h: n.h });

/**
 * Overlays `saved` on `auto`:
 * - a saved step position replaces the automatic one (steps without an entry keep theirs);
 * - a link is re-routed when it has a saved entry or touches a moved step; its bar follows the source
 *   step unless the bar itself was saved; every other link is returned exactly as drawn by `auto`.
 */
export function mergeLayout(auto: SfcLayout, saved: SavedDiagram | undefined): MergeResult {
	const ignored = { steps: [] as string[], links: [] as string[] };
	if (!saved || isEmptyDiagram(saved)) {
		return { layout: auto, ignored };
	}
	const autoByName = new Map(auto.nodes.map((n) => [lc(n.name), n]));
	const nodes: LayoutNode[] = auto.nodes.map((n) => {
		const p = saved.steps[stepKey(n.name)];
		return p ? { ...n, x: p.x, y: p.y, moved: true } : n;
	});
	const byName = new Map(nodes.map((n) => [lc(n.name), n]));
	ignored.steps = Object.keys(saved.steps).filter((k) => !byName.has(k));
	ignored.links = Object.keys(saved.links).filter((k) => !auto.links.some((l) => linkKey(l.transition, l.from) === k));

	const links: LayoutLink[] = auto.links.map((l) => {
		const entry = saved.links[linkKey(l.transition, l.from)];
		const from = l.from ? byName.get(lc(l.from)) : undefined;
		const to = l.to ? byName.get(lc(l.to)) : undefined;
		if (!entry && !from?.moved && !to?.moved) {
			return l;
		}
		let bar: Pt = { x: l.bar.x, y: l.bar.y };
		if (entry?.bar) {
			bar = entry.bar;
		} else if (from?.moved) {
			const was = autoByName.get(lc(from.name))!;
			bar = { x: bar.x + (from.x - was.x), y: bar.y + (from.y - was.y) };
		}
		const before = from ? (entry?.before ?? []) : [];
		const after = entry?.after ?? [];
		const { points } = geometry.route({ from: from ? box(from) : undefined, to: to ? box(to) : undefined, bar, before, after });
		return { ...l, bar: { x: bar.x, y: bar.y, w: l.bar.w }, points, before, after, barFixed: !!entry?.bar };
	});

	let width = auto.width;
	let height = auto.height;
	for (const n of nodes) {
		width = Math.max(width, n.x + n.w + MARGIN);
		height = Math.max(height, n.y + n.h + MARGIN);
	}
	for (const l of links) {
		for (const p of l.points) {
			width = Math.max(width, p.x + MARGIN);
			height = Math.max(height, p.y + MARGIN);
		}
	}
	return { layout: { ...auto, width, height, nodes, links }, ignored };
}

/** Keys of the steps and links currently drawn (what a webview message may refer to). */
export function knownKeys(layout: SfcLayout): { steps: Set<string>; links: Set<string> } {
	return { steps: new Set(layout.nodes.map((n) => stepKey(n.name))), links: new Set(layout.links.map((l) => linkKey(l.transition, l.from))) };
}

/**
 * Builds the diagram to store from a webview message: the message is validated, entries for names that
 * are not drawn are dropped, and entries previously saved for names that are not drawn right now (a
 * renamed or removed step) are kept, so a temporary rename does not lose a hand-made layout.
 * A payload that is not shaped like a layout returns `prev` untouched.
 */
export function mergeSave(prev: SavedDiagram | undefined, incoming: unknown, known: { steps: Set<string>; links: Set<string> }): SavedDiagram {
	// A message that is not a layout (missing or malformed `steps` / `links`) changes nothing.
	if (!isRecord(incoming) || !isRecord(incoming.steps) || !isRecord(incoming.links)) {
		return prev ?? { steps: {}, links: {} };
	}
	const inc = sanitizeDiagram(incoming);
	const out: SavedDiagram = { steps: {}, links: {} };
	for (const [k, v] of Object.entries(inc.steps)) {
		if (known.steps.has(k)) {
			out.steps[k] = v;
		}
	}
	for (const [k, v] of Object.entries(inc.links)) {
		if (known.links.has(k)) {
			out.links[k] = v;
		}
	}
	for (const [k, v] of Object.entries(prev?.steps ?? {})) {
		if (!known.steps.has(k)) {
			out.steps[k] = v;
		}
	}
	for (const [k, v] of Object.entries(prev?.links ?? {})) {
		if (!known.links.has(k)) {
			out.links[k] = v;
		}
	}
	return out;
}
