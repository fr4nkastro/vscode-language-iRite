/** HTML (inline SVG) for the SFC webview. Pure string rendering; every text is escaped. */
import type { SfcLayout } from "./sfcLayout";
import type { SfcModel } from "./sfcModel";

export interface SfcHtmlOptions {
	cspSource: string;
	nonce: string;
	title: string;
}

function esc(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const baseName = (p: string): string => p.replace(/\\/g, "/").split("/").pop() ?? p;

const STYLE = `
body { margin: 0; font-family: var(--vscode-font-family, sans-serif); color: var(--vscode-foreground, #222); background: var(--vscode-editor-background, #fff); display: flex; height: 100vh; overflow: hidden; }
#stage { flex: 1; overflow: hidden; cursor: grab; }
#stage.drag { cursor: grabbing; }
aside { width: 320px; overflow: auto; padding: 8px 12px; border-left: 1px solid var(--vscode-panel-border, #444); font-size: 12px; }
h1 { font-size: 14px; margin: 0 0 8px; }
h2 { font-size: 12px; margin: 12px 0 4px; }
.step rect { fill: var(--vscode-editor-background, #fff); stroke: var(--vscode-foreground, #222); stroke-width: 1.5; }
.step.hasfile { cursor: pointer; }
.step.hasfile:hover rect { fill: var(--vscode-list-hoverBackground, #2a2d2e); }
.step text, .lbl, .note { fill: var(--vscode-foreground, #222); font-size: 12px; }
.lbl { font-size: 11px; }
.note { font-style: italic; }
.edge { fill: none; stroke: var(--vscode-foreground, #222); stroke-width: 1.2; }
.edge.dashed { stroke-dasharray: 5 3; }
.bar { fill: var(--vscode-foreground, #222); }
.tr { cursor: pointer; }
.tr:hover .bar, .tr.sel .bar { fill: var(--vscode-textLink-foreground, #3794ff); }
.hit { fill: transparent; }
.em { display: none; }
.em.show { display: block; }
.em button, #diag li { text-align: left; }
.em button { display: block; width: 100%; margin: 2px 0; background: var(--vscode-button-secondaryBackground, #3a3d41); color: var(--vscode-button-secondaryForeground, inherit); border: 0; padding: 4px 6px; cursor: pointer; }
.cond { opacity: 0.8; font-family: var(--vscode-editor-font-family, monospace); }
#diag { padding-left: 16px; }
.warning { color: var(--vscode-editorWarning-foreground, #cca700); }
`;

const SCRIPT = `
const vscode = (typeof acquireVsCodeApi === 'function') ? acquireVsCodeApi() : { postMessage() {} };
const stage = document.getElementById('stage');
const vp = document.getElementById('vp');
let scale = 1, tx = 10, ty = 10, moved = false, drag = null;
function apply() { vp.setAttribute('transform', 'translate(' + tx + ',' + ty + ') scale(' + scale + ')'); }
try {
  const b = vp.getBBox(), r0 = stage.getBoundingClientRect();
  if (b.width > 0 && r0.width > 0) { scale = Math.min(1, (r0.width - 20) / (b.x + b.width), (r0.height - 20) / (b.y + b.height)); scale = Math.max(0.2, scale); }
} catch (e) { /* keep default zoom */ }
apply();
stage.addEventListener('wheel', (e) => {
  e.preventDefault();
  const r = stage.getBoundingClientRect();
  const px = e.clientX - r.left, py = e.clientY - r.top;
  const k = e.deltaY < 0 ? 1.1 : 1 / 1.1;
  const ns = Math.min(4, Math.max(0.2, scale * k));
  tx = px - (px - tx) * (ns / scale);
  ty = py - (py - ty) * (ns / scale);
  scale = ns;
  apply();
}, { passive: false });
stage.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, tx, ty }; moved = false; });
window.addEventListener('pointermove', (e) => {
  if (!drag) { return; }
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (Math.abs(dx) + Math.abs(dy) > 3) { moved = true; stage.classList.add('drag'); }
  if (moved) { tx = drag.tx + dx; ty = drag.ty + dy; apply(); }
});
window.addEventListener('pointerup', () => { drag = null; stage.classList.remove('drag'); });
function open(el) {
  const line = Number(el.getAttribute('data-line'));
  const file = el.getAttribute('data-file');
  if (file && line > 0) { vscode.postMessage({ type: 'open', file: file, line: line }); }
}
document.addEventListener('click', (e) => {
  const t = e.target instanceof Element ? e.target : null;
  if (!t) { return; }
  const btn = t.closest('button[data-file]');
  if (btn) { open(btn); return; }
  if (moved) { moved = false; return; }
  const step = t.closest('.step[data-file]');
  if (step) { open(step); return; }
  const tr = t.closest('.tr');
  if (tr) {
    const id = tr.getAttribute('data-tr');
    document.querySelectorAll('.em').forEach((n) => n.classList.toggle('show', n.id === 'em-' + id));
    document.querySelectorAll('.tr').forEach((n) => n.classList.toggle('sel', n.getAttribute('data-tr') === id));
  }
});
`;

export function renderSfcHtml(sfc: SfcModel, layout: SfcLayout, opts: SfcHtmlOptions): string {
	const trIndex = new Map(sfc.transitions.map((t, i) => [t.name, i]));
	const svg: string[] = [];
	svg.push(`<defs><marker id="arr" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="currentColor"/></marker></defs>`);
	for (const l of layout.links) {
		const pts = l.points.map((p) => `${p.x},${p.y}`).join(" ");
		const idx = trIndex.get(l.transition) ?? -1;
		const bx = l.bar.x - l.bar.w / 2;
		svg.push(
			`<g class="tr" data-tr="${idx}"><title>${esc(l.tooltip)}</title>` +
				(pts ? `<polyline class="edge${l.dashed ? " dashed" : ""}" points="${pts}" marker-end="url(#arr)" style="color:var(--vscode-foreground, #222)"/>` : "") +
				`<rect class="hit" x="${bx - 4}" y="${l.bar.y - 10}" width="${l.bar.w + 8 + l.label.length * 6.2 + 24}" height="20"/>` +
				`<rect class="bar" x="${bx}" y="${l.bar.y - 2}" width="${l.bar.w}" height="4"/>` +
				`<text class="lbl" x="${l.bar.x + l.bar.w / 2 + 6}" y="${l.bar.y + 4}">${esc(l.label)}</text></g>`,
		);
	}
	for (const n of layout.nodes) {
		const open = n.file && n.line ? ` data-file="${esc(n.file)}" data-line="${n.line}"` : "";
		const tip = n.entryRoutine ? `${n.name} → ${n.entryRoutine}` : `${n.name} (no entry routine)`;
		svg.push(
			`<g class="step${open ? " hasfile" : ""}"${open}><title>${esc(tip)}</title>` +
				`<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}"/>` +
				(n.initial ? `<rect x="${n.x + 4}" y="${n.y + 4}" width="${n.w - 8}" height="${n.h - 8}"/>` : "") +
				`<text x="${n.x + n.w / 2}" y="${n.y + n.h / 2 + 4}" text-anchor="middle">${esc(n.name)}</text></g>`,
		);
	}
	for (const note of layout.notes) {
		svg.push(`<text class="note" x="${note.x}" y="${note.y}">${esc(note.text)}</text>`);
	}

	const panels = sfc.transitions.map((t, i) => {
		const rows = t.emitters.map((e) => {
			const cond = e.conditions.length > 0 ? e.conditions.join(" and ") : "(unconditional)";
			const src = (e.sources ?? []).length > 0 ? (e.sources ?? []).join(", ") : "any step";
			return (
				`<button data-file="${esc(e.file)}" data-line="${e.line}"><b>${esc(e.routine)}</b> · ${esc(baseName(e.file))}:${e.line} · ${esc(e.via)}` +
				`<br/>from: ${esc(src)}<br/><span class="cond">${esc(cond)}</span></button>`
			);
		});
		return `<div class="em" id="em-${i}"><h2>${esc(t.name)}${t.target ? ` → ${esc(t.target)}` : ""}</h2>${rows.length > 0 ? rows.join("") : "<p>Never emitted.</p>"}</div>`;
	});

	const diag = sfc.diagnostics.map((d) => `<li class="${d.severity}">${esc(d.message)}</li>`).join("");
	const csp = `default-src 'none'; style-src ${opts.cspSource} 'unsafe-inline'; script-src 'nonce-${opts.nonce}';`;
	return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy" content="${csp.replace(/"/g, "&quot;")}"/>
<title>${esc(opts.title)}</title>
<style>${STYLE}</style></head>
<body>
<div id="stage"><svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"><g id="vp">${svg.join("")}</g></svg></div>
<aside><h1>${esc(opts.title)}</h1>
<p>Click a step to open its entry routine; click a transition to list its emitters. Wheel = zoom, drag = pan.</p>
${panels.join("")}
<h2>Diagnostics</h2>${diag ? `<ul id="diag">${diag}</ul>` : "<p>None.</p>"}
</aside>
<script nonce="${opts.nonce}">${SCRIPT}</script>
</body></html>`;
}
