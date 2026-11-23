/**
 * Headless SVG render of one screen (pure, no `vscode` import) that mirrors the preview webview: same
 * panel geometry (7"/12", uniform 1.6 scale, letterbox band), same widget boxes (`widgetBox`), same defaults
 * and paint order (id ascending). Used by the CLI so an agent can look at a layout without VS Code.
 * Images are embedded through `imageData` (a data URI) when the file is available, else a placeholder is drawn.
 */
import { resolveImage } from "../rev";
import { panelGeometry } from "./panels";
import type { PanelId } from "./panels";
import type { ScreenView, WidgetView } from "./screenModel";
import { widgetBox } from "./widgetBox";

export interface SvgOptions {
	panel: PanelId;
	/** Project-relative path (`sdimages/a.png`) -> data URI, or undefined when the file is missing. */
	imageData?: (relPath: string) => string | undefined;
}

const SAFE_COLOR = /^(#[0-9A-Fa-f]{3,8}|[A-Za-z]{3,20})$/;
const color = (c: string | undefined, fallback: string): string => (c && SAFE_COLOR.test(c.trim()) ? c.trim() : fallback);

export function xmlEscape(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function shape(w: WidgetView, width: number, height: number, opts: SvgOptions): string {
	switch (w.typeName) {
		case "image": {
			const res = w.image ? resolveImage(w.image, "") : undefined;
			const uri = res && res.kind === "file" ? opts.imageData?.(res.relPath) : undefined;
			if (uri && /^data:image\/[a-z+.-]+;base64,[A-Za-z0-9+/=]+$/.test(uri)) {
				return `<image href="${uri}" width="${width}" height="${height}" preserveAspectRatio="none"/>`;
			}
			return (
				`<rect x="0.5" y="0.5" width="${Math.max(0, width - 1)}" height="${Math.max(0, height - 1)}" fill="#eee" stroke="#888" stroke-dasharray="3 2"/>` +
				`<text x="2" y="12" font-size="11" fill="#555">${xmlEscape(w.image ?? "(no image)")}</text>`
			);
		}
		case "label": {
			const size = typeof w.fontSize === "number" && Number.isFinite(w.fontSize) ? Math.round(w.fontSize) : 12;
			return `<text x="0" y="${size}" font-size="${size}" fill="${color(w.color, "Black")}">${xmlEscape(w.text ?? "")}</text>`;
		}
		case "line":
			return `<rect width="${width}" height="${height}" fill="${color(w.color, "Black")}"/>`;
		case "scale":
			return (
				`<rect width="${width}" height="${height}" fill="${color(w.background, "White")}"/>` +
				`<text x="${width / 2}" y="${height / 2}" font-size="${Math.round(height * 0.7)}" font-family="monospace" text-anchor="middle" dominant-baseline="central" fill="${color(w.foreground, "Black")}">888888.1</text>`
			);
		case "bargraph":
			return `<rect x="1" y="1" width="${Math.max(0, width - 2)}" height="${Math.max(0, height - 2)}" fill="none" stroke="${color(w.color, "Black")}" stroke-width="2"/>`;
		case "symbol":
			return `<ellipse cx="${width / 2}" cy="${height / 2}" rx="${Math.max(0, width / 2 - 1)}" ry="${Math.max(0, height / 2 - 1)}" fill="none" stroke="#888" stroke-width="2"/>`;
		default:
			return `<rect x="0.5" y="0.5" width="${Math.max(0, width - 1)}" height="${Math.max(0, height - 1)}" fill="#ddd" stroke="#999"/>`;
	}
}

export function renderScreenSvg(screen: ScreenView, opts: SvgOptions): string {
	const g = panelGeometry(opts.panel);
	const out: string[] = [];
	out.push(
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${g.canvasWidth} ${g.canvasHeight}" width="${g.canvasWidth}" height="${g.canvasHeight}" font-family="sans-serif" data-screen="${screen.number}" data-panel="${opts.panel}">`,
	);
	out.push(`<title>${xmlEscape(`Screen ${screen.number}${screen.names.length ? " " + screen.names.join("/") : ""} - ${g.label}`)}</title>`);
	out.push(`<rect width="${g.canvasWidth}" height="${g.canvasHeight}" fill="#fff"/>`);
	out.push(`<g transform="scale(${g.scale})">`);
	for (const w of screen.widgets) {
		const b = widgetBox(w);
		out.push(`<svg class="widget" data-id="${w.id}" data-type="${xmlEscape(w.typeName)}" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" overflow="hidden">${shape(w, b.w, b.h, opts)}</svg>`);
	}
	out.push("</g>");
	if (g.bandHeight > 0) {
		out.push(`<rect class="band" y="${g.contentHeight}" width="${g.canvasWidth}" height="${g.bandHeight}" fill="#ececec" stroke="#999" stroke-dasharray="4 3"/>`);
	}
	out.push("</svg>");
	return out.join("\n") + "\n";
}
