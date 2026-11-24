/** Self-contained SVG ERD page (no external libs). Pure: no `vscode` imports. */
import type { Erd, ErdTable } from "./erdModel";
import type { DbSchema } from "../dbschema/model";
import { ErdDraft } from './erdDraft';
import { renderErdDraft } from './erdDraftHtml';
import { ERD_DRAFT_STYLE } from './erdDraftStyle';
import { ERD_DRAFT_SCRIPT } from './erdDraftScript';
import { fieldType } from '../dbschema/fieldTypes';

export interface ErdHtmlOptions {
	cspSource: string;
	nonce: string;
	title: string;
	generation?: number;
	disabledReason?: string;
	recoveryMessage?: string;
	editor?: { schema: DbSchema; startEditing?: boolean; hint?: string; message?: string };
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
			const type = esc(f.typeCode !== undefined ? (fieldType(f.typeCode)?.name ?? `Unknown (${f.typeCode})`) : f.type) + (f.size !== undefined ? ` (${f.size})` : "");
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
svg.addEventListener('mousedown', (e) => { if (e.target.closest && e.target.closest('.edit-card')) return; drag = { x: e.clientX, y: e.clientY, tx, ty }; moved = false; });
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

export function renderErdReadonly(erd: Erd): string {
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
	return edges + cards;
}

/** `Database diagram: NAME` is shown as `Database: NAME`; any other title is kept. */
const heading = (title: string): string => {
	const m = /^Database diagram: ([\s\S]*)$/.exec(title);
	return m ? `Database: <span class="mono">${esc(m[1])}</span>` : esc(title);
};

export function renderErdHtml(erd: Erd, opts: ErdHtmlOptions): string {
	const readonly = renderErdReadonly(erd);
	const diags = erd.diagnostics.length
		? `<h2>Diagnostics</h2><ul>${erd.diagnostics.map((d) => `<li class="${d.severity}">${esc(d.message)}</li>`).join("")}</ul>`
		: "";
	const empty = erd.tables.length === 0 ? `<p>No database tables found.</p>` : "";
	const view = opts.editor ? new ErdDraft(opts.editor.schema).view() : undefined;
	const editing = !!view && !!opts.editor?.startEditing;
	const csp = `default-src 'none'; style-src 'nonce-${esc(opts.nonce)}'; script-src 'nonce-${esc(opts.nonce)}';`;
	// Stable controller hooks: diagram-mode/edit-mode, diagram-view, edit-toolbar,
	// edit-view, edit-count, edit-revert, edit-save, edit-notice, edit-feedback.
	const diagramScript = SCRIPT;
	const draftScript = ERD_DRAFT_SCRIPT.replace('__ERD_EDITING__', String(editing)).replace('__ERD_AVAILABLE__', String(!!view));
	return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>${esc(opts.title)}</title>
<style nonce="${esc(opts.nonce)}">
body{margin:0;font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background)}
h2{font-size:13px;margin:8px 12px 0}ul{margin:4px 12px 12px;font-size:12px}li.warning{color:var(--vscode-editorWarning-foreground)}
svg{width:100%;height:78vh;cursor:grab;display:block}
.body{fill:var(--vscode-editor-background);stroke:var(--vscode-panel-border)}.head{fill:var(--vscode-button-background)}.tn{fill:var(--vscode-button-foreground);font-weight:bold;font-size:13px}.tm{fill:var(--vscode-button-foreground);font-size:10px}
.fn{fill:var(--vscode-foreground);font-size:12px}.ft{fill:var(--vscode-descriptionForeground);font-size:11px}.rel{stroke:var(--vscode-editorWarning-foreground);stroke-width:1.5}.rl{fill:var(--vscode-editorWarning-foreground);font-size:10px}
.link{cursor:pointer}.error{color:var(--vscode-errorForeground)}pre{white-space:pre-wrap}
${ERD_DRAFT_STYLE}
</style></head><body>
<header class="erd-topbar"><h1>${heading(opts.title)}</h1>
<nav class="erd-seg" aria-label="Database views"><button id="diagram-mode" type="button" disabled>Diagram</button><button id="edit-mode" type="button" disabled>Edit schema</button></nav>
${view ? '' : `<span class="erd-unavailable">${esc(opts.disabledReason ?? 'No .rev available; schema editing is disabled.')}</span>`}
<div id="edit-toolbar" class="erd-status" ${editing ? '' : 'hidden'}><span id="edit-count">${view?.count ? `${view.count} pending ${view.count === 1 ? 'change' : 'changes'}` : 'No unsaved changes'}</span><span id="edit-errors" class="erd-errors" ${view?.issues.some(i => i.severity === 'error') ? '' : 'hidden'}>${view ? view.issues.filter(i => i.severity === 'error').length : 0} errors</span><button id="edit-revert" class="erd-secondary" type="button" disabled>Discard</button><button id="edit-save" class="erd-primary" type="button" disabled>Save</button><span id="edit-notice" role="status"></span></div></header>
${opts.recoveryMessage ? `<p class="error" role="alert">${esc(opts.recoveryMessage)}</p>` : ''}
<div id="diagram-view" ${editing ? 'hidden' : ''}>${empty}<svg id="erd" xmlns="http://www.w3.org/2000/svg"><g id="vp"><g id="readonly-view">${readonly}</g></g></svg>${diags}</div>
<fieldset id="edit-view" ${editing ? '' : 'hidden'} disabled>${view ? renderErdDraft(view) : ''}</fieldset>
<div id="edit-feedback"></div>
<script nonce="${esc(opts.nonce)}">${diagramScript}\nconst generation = ${Number.isSafeInteger(opts.generation) ? opts.generation : 0};\n${draftScript}</script>
</body></html>`;
}
