/** Self-contained SVG ERD page (no external libs). Pure: no `vscode` imports. */
import type { Erd, ErdTable } from "./erdModel";
import type { DbSchema } from "../dbschema/model";
import { renderErdEditState } from "./erdEdit";

export interface ErdHtmlOptions {
	cspSource: string;
	nonce: string;
	title: string;
	generation?: number;
	disabledReason?: string;
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
const toggle = document.getElementById('edit-toggle');
const readonlyView = document.getElementById('readonly-view'), editView = document.getElementById('edit-view');
const feedback = document.getElementById('edit-feedback'), save = document.getElementById('edit-save');
const generation = __ERD_GENERATION__;
let pending = null, modePending = false, aliasPending = false, nextRequest = 0, focusSelector = null;
const dirty = new Set();
const notice = text => { document.getElementById('edit-notice').textContent = text; };
const numberValue = input => input.value.trim() === '' ? null : Number(input.value);
document.getElementById('edit-revert').addEventListener('click', () => {
 if (pending) return;
 dirty.forEach(input => { if (input.tagName === 'SELECT') { const selected = input.querySelector('option[selected]'); if (selected) input.value = selected.value; } else input.value = input.defaultValue; });
 dirty.clear(); notice('Unsent edits reverted.');
});
function mode() { readonlyView.style.display = toggle.checked ? 'none' : ''; editView.style.display = toggle.checked ? '' : 'none'; document.getElementById('edit-toolbar').style.display = toggle.checked ? '' : 'none'; }
mode();
function requestMode(editing) { modePending = true; toggle.disabled = true; toggle.checked = !editing; vscode.postMessage({ type: 'erd-edit-mode', generation, editing }); }
toggle.addEventListener('change', () => { if (pending || modePending || dirty.size) { toggle.checked = !toggle.checked; notice('Apply or revert pending values first.'); return; } requestMode(toggle.checked); });
editView.addEventListener('input', e => { if (e.target.matches('input,select')) { if (e.target.value === e.target.defaultValue || (e.target.tagName === 'SELECT' && e.target.value === e.target.querySelector('option[selected]')?.value)) dirty.delete(e.target); else dirty.add(e.target); } });
editView.addEventListener('change', e => { if (e.target.tagName === 'SELECT') e.target.dispatchEvent(new Event('input', { bubbles: true })); });
function send(message) {
 if (pending || modePending) return;
 pending = ++nextRequest;
 const active = document.activeElement;
 const t = active && active.closest ? active.closest('[data-table]') : null;
 const f = active && active.closest ? active.closest('[data-field]') : null;
 const action = active && active.dataset ? active.dataset.action : null;
 focusSelector = t && action && /^\\d+$/.test(t.dataset.table) && /^[A-Za-z]+$/.test(action) ? '[data-table="' + t.dataset.table + '"] ' + (f && /^\\d+$/.test(f.dataset.field) && !['deleteField','moveUp','moveDown'].includes(action) ? '[data-field="' + f.dataset.field + '"] ' : '') + '[data-action="' + (['deleteField','moveUp','moveDown'].includes(action) ? 'addField' : action) + '"]' : null;
 document.querySelectorAll('#edit-view input, #edit-view select, #edit-view button, #edit-toolbar button, #edit-toggle').forEach(e => e.disabled = true);
 vscode.postMessage({ type: 'erd-edit-request', generation, requestId: pending, message });
}
editView.addEventListener('click', e => {
 const button = e.target.closest('button[data-action]'); if (!button || pending) return;
 const tableNode = button.closest('[data-table]'), fieldNode = button.closest('[data-field]');
 const table = Number(tableNode.dataset.table), field = fieldNode ? Number(fieldNode.dataset.field) : undefined, action = button.dataset.action;
 const allowed = action === 'updateField' ? fieldNode : action === 'updateTable' ? tableNode : null;
 if ([...dirty].some(input => !allowed || !allowed.contains(input) || (action === 'updateTable' && !input.hasAttribute('data-table-value')))) { notice('Apply or revert other pending values first.'); return; }
 let edit;
 if (action === 'updateTable') edit = { kind: action, table, name: tableNode.querySelector('[data-table-value=name]').value, maxRecords: numberValue(tableNode.querySelector('[data-table-value=maxRecords]')) };
 else if (action === 'updateField') edit = { kind: action, table, field, changes: { name: fieldNode.querySelector('[data-value=name]').value, typeCode: numberValue(fieldNode.querySelector('[data-value=typeCode]')), size: numberValue(fieldNode.querySelector('[data-value=size]')) } };
 if (edit && (edit.maxRecords === null || (edit.changes && (edit.changes.size === null || edit.changes.typeCode === null)))) { notice('Numeric values cannot be blank.'); return; }
 if (edit) { send({ type: 'edit', edit }); return; }
 else if (action === 'moveUp' || action === 'moveDown') edit = { kind: 'moveField', table, from: field, to: field + (action === 'moveUp' ? -1 : 1) };
 else if (action === 'addField') edit = { kind: action, table, name: '', typeCode: 3, size: 4 };
 else edit = { kind: action, table, ...(field === undefined ? {} : { field }) };
 send({ type: 'edit', edit });
});
document.getElementById('add-table').addEventListener('click', () => { if (dirty.size) { notice('Apply or revert pending values first.'); return; } send({ type: 'edit', edit: { kind: 'addTable', name: '', maxRecords: 1 } }); });
save.addEventListener('click', () => { if (dirty.size) { notice('Apply or revert pending values first.'); return; } send({ type: 'save' }); });
window.addEventListener('message', e => {
 const m = e.data;
 if (!m || m.generation !== generation) return;
 if (m.type === 'erd-enable-edit') { if (modePending || pending) aliasPending = true; else if (!toggle.disabled) requestMode(true); return; }
 if (m.type === 'erd-edit-mode-state' && modePending) { modePending = false; toggle.disabled = false; toggle.checked = m.editing; mode(); if (aliasPending) { aliasPending = false; requestMode(true); } return; }
 if (m.type !== 'erd-edit-state' || !pending || m.requestId !== pending) return;
 editView.innerHTML = m.diagram; feedback.innerHTML = m.feedback; if (typeof m.readonly === 'string') readonlyView.innerHTML = m.readonly; dirty.clear(); pending = null;
 toggle.disabled = !!m.disabled; document.getElementById('add-table').disabled = !!m.disabled; document.getElementById('edit-revert').disabled = !!m.disabled; save.disabled = !m.canSave || !!m.disabled;
 if (focusSelector) { const target = editView.querySelector(focusSelector); if (target && !target.disabled) target.focus(); }
 focusSelector = null; notice('');
 if (aliasPending && !m.disabled) { aliasPending = false; requestMode(true); }
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

export function renderErdHtml(erd: Erd, opts: ErdHtmlOptions): string {
	const readonly = renderErdReadonly(erd);
	const diags = erd.diagnostics.length
		? `<h2>Diagnostics</h2><ul>${erd.diagnostics.map((d) => `<li class="${d.severity}">${esc(d.message)}</li>`).join("")}</ul>`
		: "";
	const empty = erd.tables.length === 0 ? `<p>No database tables found.</p>` : "";
	const editor = opts.editor && renderErdEditState(opts.editor.schema, opts.editor);
	const editing = !!opts.editor?.startEditing;
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
.edit-body{box-sizing:border-box;width:100%;height:100%;overflow:auto;padding:8px;background:#252526;border:1px solid #888;color:var(--vscode-foreground,#ddd);font-size:12px}.edit-body label{display:inline-block;margin:3px}.edit-body input{width:90px}.field{border-top:1px solid #888;padding:4px}.edit-body button{margin:2px}pre{white-space:pre-wrap}.error{color:#f88}
</style></head><body>
<h1>${esc(opts.title)}</h1><label><input id="edit-toggle" type="checkbox" ${editor ? '' : 'disabled'} ${editing && editor ? 'checked' : ''}>Edit schema</label>${editor ? '' : `<span>${esc(opts.disabledReason ?? 'No .rev available; schema editing is disabled.')}</span>`}
<div id="edit-toolbar" data-editing="${editing && !!editor}" style="display:${editing && editor ? '' : 'none'}"><button id="add-table">Add table</button><button id="edit-revert">Revert unsent edits</button><button id="edit-save" ${editor?.canSave ? '' : 'disabled'}>Save</button><span id="edit-notice" role="status"></span></div>${empty}
<svg id="erd" xmlns="http://www.w3.org/2000/svg"><g id="vp"><g id="readonly-view" style="display:${editing && editor ? 'none' : ''}">${readonly}</g><g id="edit-view" style="display:${editing && editor ? '' : 'none'}">${editor?.diagram ?? ''}</g></g></svg>
<div id="edit-feedback">${editor?.feedback ?? ''}</div>${diags}
<script nonce="${esc(opts.nonce)}">${SCRIPT.replace('__ERD_GENERATION__', String(opts.generation ?? 0))}</script>
</body></html>`;
}
