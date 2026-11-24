/**
 * Indicator panel sizes and the widget scaling between them (pure, no `vscode` import).
 *
 * `.rev` coordinates are authored for the 7" panel (800x480). On the 12" panel (1280x800) widgets are scaled
 * uniformly so authored proportions are kept: the factor is the smaller axis ratio, 1280/800 = 1.6 (the
 * vertical ratio 800/480 = 1.667 would stretch widgets). The unused vertical remainder is a letterbox band.
 *
 * ASSUMPTIONS, unconfirmed on a real 12" unit: the header height of each panel and that the scaled content
 * sits at the top of the usable area with the leftover band below it.
 */

export type PanelId = "7" | "12";

export interface PanelSpec {
	id: PanelId;
	label: string;
	/** Full panel size in pixels. */
	width: number;
	height: number;
	/**
	 * Height reserved by the firmware header (ASSUMPTION). 7": 92 px (800x480 panel, 800x388 usable area,
	 * observed on DOLE). 12": 92 * 1.6 = 147.2 px, i.e. the 7" header scaled with the content (not measured).
	 */
	headerHeight: number;
}

export const PANELS: Record<PanelId, PanelSpec> = {
	"7": { id: "7", label: '7" 800x480', width: 800, height: 480, headerHeight: 92 },
	"12": { id: "12", label: '12" 1280x800', width: 1280, height: 800, headerHeight: 147.2 },
};

export const DEFAULT_PANEL: PanelId = "7";
/** The panel `.rev` coordinates are authored for. */
export const AUTHORED_PANEL: PanelSpec = PANELS["7"];

export function isPanelId(v: unknown): v is PanelId {
	return v === "7" || v === "12";
}

export interface Size {
	width: number;
	height: number;
}

/** Factor that fits `from` inside `to` without changing proportions. */
export function uniformScale(from: Size, to: Size): number {
	return Math.min(to.width / from.width, to.height / from.height);
}

export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

export function scaleRect(r: Rect, scale: number): Rect {
	return { x: r.x * scale, y: r.y * scale, w: r.w * scale, h: r.h * scale };
}

export interface PanelGeometry {
	id: PanelId;
	label: string;
	/** Widget scale relative to the authored 7" coordinates. */
	scale: number;
	headerHeight: number;
	/** Usable area below the header. */
	canvasWidth: number;
	canvasHeight: number;
	/** Authored usable area (800x388) after scaling. */
	contentWidth: number;
	contentHeight: number;
	/** Unused strip of the usable area, below the content / right of it. */
	bandHeight: number;
	bandWidth: number;
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

export function panelGeometry(id: PanelId): PanelGeometry {
	const p = PANELS[id];
	const scale = uniformScale(AUTHORED_PANEL, p);
	const authoredHeight = AUTHORED_PANEL.height - AUTHORED_PANEL.headerHeight;
	const canvasWidth = p.width;
	const canvasHeight = round3(p.height - p.headerHeight);
	const contentWidth = round3(AUTHORED_PANEL.width * scale);
	const contentHeight = round3(authoredHeight * scale);
	return {
		id,
		label: p.label,
		scale,
		headerHeight: p.headerHeight,
		canvasWidth,
		canvasHeight,
		contentWidth,
		contentHeight,
		bandHeight: round3(Math.max(0, canvasHeight - contentHeight)),
		bandWidth: round3(Math.max(0, canvasWidth - contentWidth)),
	};
}

export function allGeometries(): Record<PanelId, PanelGeometry> {
	return { "7": panelGeometry("7"), "12": panelGeometry("12") };
}
