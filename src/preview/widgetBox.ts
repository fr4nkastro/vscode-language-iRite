/**
 * Authored box of a widget (pure, no `vscode` import), with the same defaults the preview page and the editor
 * use for types that do not store a size (scale 220x60, symbol and unknown 24x24). The headless SVG renderer
 * and the overlap report use it; a test pins it to the numbers `renderWidget` writes into the HTML.
 */
import type { RevWidget } from "../rev";
import { panelGeometry } from "./panels";

export interface Box {
	x: number;
	y: number;
	w: number;
	h: number;
}

const px = (n: number | undefined, fallback: number): number => (typeof n === "number" && Number.isFinite(n) ? Math.round(n) : fallback);

export function widgetBox(w: Pick<RevWidget, "typeName" | "x" | "y" | "width" | "height">): Box {
	let width = w.width;
	let height = w.height;
	if (w.typeName === "scale") {
		width = width ?? 220;
		height = height ?? 60;
	} else if (w.typeName === "softkey") {
		width = width ?? 800;
		height = height ?? 70;
	} else if (w.typeName === "symbol" || w.typeName === "unknown") {
		width = width ?? 24;
		height = height ?? 24;
	}
	return { x: px(w.x, 0), y: px(w.y, 0), w: px(width, 0), h: px(height, 0) };
}

/** A box that covers (almost) the whole authored usable area: a backdrop, not a layout element. */
export function isBackdrop(b: Box): boolean {
	const g = panelGeometry("7");
	return b.w >= g.canvasWidth * 0.9 && b.h >= g.canvasHeight * 0.9;
}

export interface Overlap {
	a: number;
	b: number;
	/** Intersection area in authored pixels. */
	area: number;
}

/** Pairs of widgets (ids) whose boxes intersect; backdrops are ignored. Input order = paint order. */
export function findOverlaps(items: Array<{ id: number; box: Box }>): Overlap[] {
	const out: Overlap[] = [];
	const live = items.filter((i) => !isBackdrop(i.box) && i.box.w > 0 && i.box.h > 0);
	for (let i = 0; i < live.length; i++) {
		for (let j = i + 1; j < live.length; j++) {
			const p = live[i].box;
			const q = live[j].box;
			const w = Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x);
			const h = Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y);
			if (w > 0 && h > 0) {
				out.push({ a: live[i].id, b: live[j].id, area: w * h });
			}
		}
	}
	return out;
}

export function outOfBounds(b: Box): boolean {
	const g = panelGeometry("7");
	return b.x < 0 || b.y < 0 || b.x + b.w > g.canvasWidth || b.y + b.h > g.canvasHeight;
}
