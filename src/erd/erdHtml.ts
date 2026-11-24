/** Self-contained SVG ERD page (no external libs). Pure: no `vscode` imports. */
import type { Erd, ErdTable } from "./erdModel";

export interface ErdHtmlOptions {
	cspSource: string;
	nonce: string;
	title: string;
}

const CARD_W = 260;
const HEAD_H = 46;
const ROW_H = 18;
const GAP_X = 90;
const GAP_Y = 50;

export function esc(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

interface Box {
	t: ErdTable;
	x: number;
	y: number;
	h: number;
}

const cardHeight = (t: ErdTable): number => HEAD_H + Math.max(1, t.fields.length) * ROW_H + 6;

/** Deterministic grid: ceil(sqrt(n)) columns, rows as tall as their tallest card. */
function layout(tables: ErdTable[]): Map<string, Box> {
	const cols = Math.max(1, Math.ceil(Math.sqrt(tables.length)));
	const boxes = new Map<string, Box>();
	let y = 0;
	for (let i = 0; i < tables.length; i += cols) {
		const row = tables.slice(i, i + cols);
		const rowH = Math.max(...row.map(cardHeight));
		row.forEach((t, c) => boxes.set(t.name, { t, x: c * (CARD_W + GAP_X), y, h: cardHeight(t) }));
		y += rowH + GAP_Y;
	}
	return boxes;
}

const rowY = (b: Box, field: string): number => {
	const i = Math.max(0, b.t.fields.findIndex((f) => f.name === field));
	return b.y + HEAD_H + i * ROW_H + ROW_H / 2;
};

function edge(a: Box, af: string, b: Box, bf: string): { d: string; lx: number; ly: number } {
	const y1 = rowY(a, af);
	const y2 = rowY(b, bf);
	if (a.x + CARD_W + 20 <= b.x) {
		const xm = (a.x + CARD_W + b.x) / 2;
		return { d: `M${a.x + CARD_W} ${y1} H${xm} V${y2} H${b.x}`, lx: xm, ly: (y1 + y2) / 2 };
	}
	if (b.x + CARD_W + 20 <= a.x) {
		const xm = (b.x + CARD_W + a.x) / 2;
		return { d: `M${a.x} ${y1} H${xm} V${y2} H${b.x + CARD_W}`, lx: xm, ly: (y1 + y2) / 2 };
	}
	// Same column: bracket on the right side.
	const xo = Math.max(a.x, b.x) + CARD_W + 30;
	return { d: `M${a.x + CARD_W} ${y1} H${xo} V${y2} H${b.x + CARD_W}`, lx: xo, ly: (y1 + y2) / 2 };
}

function card(b: Box): string {
	const t = b.t;
	const meta = [`alias ${t.alias}`, t.maxRecords !== undefined ? `max ${t.maxRecords}` : undefined, t.origin !== "both" ? `${t.origin} only` : undefined]
		.filter(Boolean)
		.join(" · ");
	const link = t.source ? ` data-file="${esc(t.source.file)}" data-line="${t.source.line}"` : "";
	const rows = t.fields
		.map((f, i) => {
			const y = HEAD_H + i * ROW_H + 13;
			const type = esc(f.type) + (f.size !== undefined ? `(${f.size})` : "");
			return `<text class="fn" x="10" y="${y}">${esc(f.name)}</text><text class="ft" x="${CARD_W - 10}" y="${y}" text-anchor="end">${type}</text>`;
		})
		.join("");
	return (
		`<g class="card" transform="translate(${b.x} ${b.y})">` +
		`<rect class="body" width="${CARD_W}" height="${b.h}" rx="4"/>` +
		`<g class="hdr${t.source ? " link" : ""}"${link}><title>${esc(t.name)}</title><rect class="head" width="${CARD_W}" height="${HEAD_H}" rx="4"/>` +
		`<text class="tn" x="10" y="19">${esc(t.name)}</text><text class="tm" x="10" y="36">${esc(meta)}</text></g>` +
		rows +
		`</g>`
	);
}

const SCRIPT = `
const vscode = (typeof acquireVsCodeApi === 'function') ? acquireVsCodeApi() : { postMessage() {} };
const svg = document.getElementById('erd');
const vp = document.getElementById('vp');
let tx = 20, ty = 20, k = 1, drag = null, moved = false;
const apply = () => vp.setAttribute('transform', 'translate(' + tx + ' ' + ty + ') scale(' + k + ')');
apply();
svg.addEventListener('wheel', (e) => {
  e.preventDefault();
  const r = svg.getBoundingClientRect();
  const px = e.clientX - r.left, py = e.clientY - r.top;
  const nk = Math.min(4, Math.max(0.1, k * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
  tx = px - (px - tx) * nk / k; ty = py - (py - ty) * nk / k; k = nk; apply();
}, { passive: false });
svg.addEventListener('mousedown', (e) => { drag = { x: e.clientX, y: e.clientY, tx, ty }; moved = false; });
window.addEventListener('mousemove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
  tx = drag.tx + dx; ty = drag.ty + dy; apply();
});
window.addEventListener('mouseup', () => { drag = null; });
svg.addEventListener('click', (e) => {
  if (moved) return;
  const h = e.target.closest ? e.target.closest('.hdr[data-line]') : null;
  if (h) vscode.postMessage({ type: 'open', file: h.getAttribute('data-file'), line: Number(h.getAttribute('data-line')) });
});
`;

export function renderErdHtml(erd: Erd, opts: ErdHtmlOptions): string {
	const boxes = layout(erd.tables);
	const edges = erd.relations
		.map((r) => {
			const a = boxes.get(r.from.table);
			const b = boxes.get(r.to.table);
			if (!a || !b) {
				return "";
			}
			const e = edge(a, r.from.field, b, r.to.field);
			return (
				`<path class="rel" d="${e.d}" fill="none" stroke-dasharray="6 4"/>` +
				`<text class="rl" x="${e.lx + 3}" y="${e.ly - 3}">${esc(r.from.field)}</text>`
			);
		})
		.join("");
	const cards = [...boxes.values()].map(card).join("");
	const diags = erd.diagnostics.length
		? `<h2>Diagnostics</h2><ul>${erd.diagnostics.map((d) => `<li class="${d.severity}">${esc(d.message)}</li>`).join("")}</ul>`
		: "";
	const empty = erd.tables.length === 0 ? `<p>No database tables found.</p>` : "";
	const csp = `default-src 'none'; style-src ${esc(opts.cspSource)} 'unsafe-inline'; script-src 'nonce-${esc(opts.nonce)}';`;
	return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>${esc(opts.title)}</title>
<style>
body{margin:0;font-family:var(--vscode-font-family,sans-serif);color:var(--vscode-foreground,#ddd);background:var(--vscode-editor-background,#1e1e1e)}
h1{font-size:14px;margin:8px 12px}h2{font-size:13px;margin:8px 12px 0}ul{margin:4px 12px 12px;font-size:12px}li.warning{color:#d9a400}
svg{width:100%;height:78vh;cursor:grab;display:block}
.body{fill:#252526;stroke:#888}.head{fill:#0e639c}.tn{fill:#fff;font-weight:bold;font-size:13px}.tm{fill:#cde;font-size:10px}
.fn{fill:#ddd;font-size:12px}.ft{fill:#9cdcfe;font-size:11px}.rel{stroke:#d9a400;stroke-width:1.5}.rl{fill:#d9a400;font-size:10px}
.link{cursor:pointer}
</style></head><body>
<h1>${esc(opts.title)}</h1>${empty}
<svg id="erd" xmlns="http://www.w3.org/2000/svg"><g id="vp">${edges}${cards}</g></svg>
${diags}
<script nonce="${esc(opts.nonce)}">${SCRIPT}</script>
</body></html>`;
}
