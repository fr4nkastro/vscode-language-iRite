/** HTML (inline SVG) for the SFC webview. Pure string rendering; every text is escaped. */
import { GEOMETRY_SOURCE } from "./sfcGeometry";
import type { SfcLayout } from "./sfcLayout";
import type { SfcModel } from "./sfcModel";
import { linkKey } from "./sfcSidecar";

export interface SfcHtmlOptions {
	cspSource: string;
	nonce: string;
	title: string;
	/** Hand-edited layout details shown in the side panel. */
	layoutInfo?: {
		/** Where the layout is saved, as shown to the user. */
		file: string;
		/** True when a saved layout is applied. */
		saved: boolean;
		/** Saved entries that match nothing in the current diagram (renamed or removed names). */
		ignored: string[];
		/** Set when the sidecar cannot be read or written. */
		warning?: string;
	};
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
.step { cursor: move; }
.step:hover rect { fill: var(--vscode-list-hoverBackground, #2a2d2e); }
.step text, .lbl, .note { fill: var(--vscode-foreground, #222); font-size: 12px; }
.step text, .lbl { user-select: none; }
.lbl { font-size: 11px; }
.note { font-style: italic; }
.edge { fill: none; stroke: var(--vscode-foreground, #222); stroke-width: 1.2; }
.edge.dashed { stroke-dasharray: 5 3; }
.edgehit { fill: none; stroke: transparent; stroke-width: 10; pointer-events: stroke; }
.bar { fill: var(--vscode-foreground, #222); }
.tr { cursor: pointer; }
.barg { cursor: move; }
.tr:hover .bar, .tr.sel .bar { fill: var(--vscode-textLink-foreground, #3794ff); }
.bend { fill: var(--vscode-editor-background, #fff); stroke: var(--vscode-textLink-foreground, #3794ff); stroke-width: 2; cursor: move; }
.hit { fill: transparent; }
.em { display: none; }
.em.show { display: block; }
.em button, #diag li { text-align: left; }
.em button, #reset { display: block; width: 100%; margin: 2px 0; background: var(--vscode-button-secondaryBackground, #3a3d41); color: var(--vscode-button-secondaryForeground, inherit); border: 0; padding: 4px 6px; cursor: pointer; }
.cond { opacity: 0.8; font-family: var(--vscode-editor-font-family, monospace); }
#diag { padding-left: 16px; }
.error { color: var(--vscode-editorError-foreground, #f14c4c); }
.warning { color: var(--vscode-editorWarning-foreground, #cca700); }
#diag li.hasfile { cursor: pointer; }
#diag li.hasfile:hover { text-decoration: underline; }
.hint { opacity: 0.8; }
`;

/**
 * Webview script. `__GEOMETRY__` is replaced by the shared routing code, so links are re-routed while
 * dragging with exactly the code the extension used for the initial render. Edits are posted as one
 * `{ type: 'layout', diagram }` message at the end of each drag / bend change; the extension validates it.
 */
const SCRIPT = `
const vscode = (typeof acquireVsCodeApi === 'function') ? acquireVsCodeApi() : { postMessage() {}, getState() { return undefined; }, setState() {} };
const geom = __GEOMETRY__;
const SVGNS = 'http://www.w3.org/2000/svg';
const model = JSON.parse(document.getElementById('model').textContent);
const stage = document.getElementById('stage');
const vp = document.getElementById('vp');
let scale = 1, tx = 10, ty = 10, moved = false, drag = null;
function apply() {
  vp.setAttribute('transform', 'translate(' + tx + ',' + ty + ') scale(' + scale + ')');
  try { vscode.setState({ scale: scale, tx: tx, ty: ty }); } catch (e) { /* state is a convenience */ }
}
let restored = false;
try {
  const st = vscode.getState();
  if (st && isFinite(st.scale) && isFinite(st.tx) && isFinite(st.ty)) { scale = st.scale; tx = st.tx; ty = st.ty; restored = true; }
} catch (e) { /* ignore */ }
if (!restored) {
  try {
    const b = vp.getBBox(), r0 = stage.getBoundingClientRect();
    if (b.width > 0 && r0.width > 0) { scale = Math.min(1, (r0.width - 20) / (b.x + b.width), (r0.height - 20) / (b.y + b.height)); scale = Math.max(0.2, scale); }
  } catch (e) { /* keep default zoom */ }
}
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

// ---- model ----
const nodes = new Map();
document.querySelectorAll('.step[data-i]').forEach((el) => {
  const n = model.nodes[Number(el.getAttribute('data-i'))];
  nodes.set(n.name.toLowerCase(), { key: n.name.toLowerCase(), x: n.x, y: n.y, w: n.w, h: n.h, ox: n.x, oy: n.y, moved: !!n.moved, el: el });
});
const links = [];
document.querySelectorAll('.tr[data-li]').forEach((el) => {
  const m = model.links[Number(el.getAttribute('data-li'))];
  const barg = el.querySelector('.barg');
  links.push({
    key: m.key, from: m.from ? m.from.toLowerCase() : undefined, to: m.to ? m.to.toLowerCase() : undefined,
    bar: { x: m.bx, y: m.by }, bx0: m.bx, by0: m.by, barFixed: !!m.barFixed,
    before: m.before.map((p) => ({ x: p.x, y: p.y })), after: m.after.map((p) => ({ x: p.x, y: p.y })),
    el: el, poly: el.querySelector('.edge'), hit: el.querySelector('.edgehit'), barg: barg, bends: el.querySelector('.bends'),
  });
});
function box(n) { return { x: n.x, y: n.y, w: n.w, h: n.h }; }
function spec(L) {
  return { from: L.from ? box(nodes.get(L.from)) : undefined, to: L.to && nodes.get(L.to) ? box(nodes.get(L.to)) : undefined, bar: L.bar, before: L.before, after: L.after };
}
function drawBends(L) {
  while (L.bends.firstChild) { L.bends.removeChild(L.bends.firstChild); }
  ['before', 'after'].forEach((list) => {
    L[list].forEach((p, i) => {
      const c = document.createElementNS(SVGNS, 'circle');
      c.setAttribute('class', 'bend'); c.setAttribute('r', '5'); c.setAttribute('cx', String(p.x)); c.setAttribute('cy', String(p.y));
      c.setAttribute('data-list', list); c.setAttribute('data-i', String(i));
      L.bends.appendChild(c);
    });
  });
}
function redraw(L) {
  const pts = geom.route(spec(L)).points.map((p) => p.x + ',' + p.y).join(' ');
  L.poly.setAttribute('points', pts);
  L.hit.setAttribute('points', pts);
  L.barg.setAttribute('transform', 'translate(' + (L.bar.x - L.bx0) + ',' + (L.bar.y - L.by0) + ')');
  drawBends(L);
}
links.forEach(drawBends);
function placeNode(N) { N.el.setAttribute('transform', 'translate(' + (N.x - N.ox) + ',' + (N.y - N.oy) + ')'); }
function save() {
  const steps = {}, out = {};
  nodes.forEach((n) => { if (n.moved) { steps[n.key] = { x: n.x, y: n.y }; } });
  links.forEach((L) => {
    const e = {};
    if (L.barFixed) { e.bar = { x: L.bar.x, y: L.bar.y }; }
    if (L.before.length > 0) { e.before = L.before; }
    if (L.after.length > 0) { e.after = L.after; }
    if (Object.keys(e).length > 0) { out[L.key] = e; }
  });
  vscode.postMessage({ type: 'layout', diagram: { steps: steps, links: out } });
}
function world(e) {
  const r = stage.getBoundingClientRect();
  return { x: Math.round((e.clientX - r.left - tx) / scale), y: Math.round((e.clientY - r.top - ty) / scale) };
}
function linkOf(el) { const g = el.closest('.tr[data-li]'); return g ? links[Number(g.getAttribute('data-li'))] : undefined; }
/** Inserts a bend where the pointer is and returns where it ended up. */
function addBend(L, at) {
  const r = geom.insertBend(spec(L), at);
  const list = r.before.length > L.before.length ? 'before' : 'after';
  L.before = r.before; L.after = r.after;
  redraw(L);
  const i = L[list].findIndex((p) => p.x === at.x && p.y === at.y);
  return { list: list, i: i };
}

// ---- pointer handling: pan (background), drag step / bar / bend ----
stage.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) { return; }
  const t = e.target instanceof Element ? e.target : null;
  moved = false;
  const start = { x: e.clientX, y: e.clientY };
  const bend = t && t.closest('.bend');
  const barg = t && t.closest('.barg');
  const step = t && t.closest('.step[data-i]');
  const edge = t && e.altKey && t.closest('.edgehit, .edge');
  if (bend) {
    const L = linkOf(bend), list = bend.getAttribute('data-list'), i = Number(bend.getAttribute('data-i'));
    drag = { mode: 'bend', L: L, list: list, i: i, start: start, orig: { x: L[list][i].x, y: L[list][i].y } };
  } else if (edge) {
    const L = linkOf(edge), p = addBend(L, world(e));
    drag = { mode: 'bend', L: L, list: p.list, i: p.i, start: start, orig: { x: L[p.list][p.i].x, y: L[p.list][p.i].y }, fresh: true };
    moved = true;
  } else if (barg) {
    const L = linkOf(barg);
    drag = { mode: 'bar', L: L, start: start, orig: { x: L.bar.x, y: L.bar.y } };
  } else if (step) {
    const N = nodes.get(model.nodes[Number(step.getAttribute('data-i'))].name.toLowerCase());
    drag = { mode: 'step', N: N, start: start, orig: { x: N.x, y: N.y }, bars: links.filter((L) => L.from === N.key && !L.barFixed).map((L) => ({ L: L, x: L.bar.x, y: L.bar.y })) };
  } else {
    drag = { mode: 'pan', start: start, tx: tx, ty: ty };
  }
});
window.addEventListener('pointermove', (e) => {
  if (!drag) { return; }
  const dx = e.clientX - drag.start.x, dy = e.clientY - drag.start.y;
  if (!moved && Math.abs(dx) + Math.abs(dy) > 3) { moved = true; if (drag.mode === 'pan') { stage.classList.add('drag'); } }
  if (!moved) { return; }
  if (drag.mode === 'pan') { tx = drag.tx + dx; ty = drag.ty + dy; apply(); return; }
  const wx = Math.round(dx / scale), wy = Math.round(dy / scale);
  if (drag.mode === 'step') {
    drag.N.x = drag.orig.x + wx; drag.N.y = drag.orig.y + wy; placeNode(drag.N);
    drag.bars.forEach((b) => { b.L.bar = { x: b.x + wx, y: b.y + wy }; });
    links.forEach((L) => { if (L.from === drag.N.key || L.to === drag.N.key) { redraw(L); } });
  } else if (drag.mode === 'bar') {
    drag.L.bar = { x: drag.orig.x + wx, y: drag.orig.y + wy }; drag.L.barFixed = true; redraw(drag.L);
  } else {
    drag.L[drag.list][drag.i] = { x: drag.orig.x + wx, y: drag.orig.y + wy }; redraw(drag.L);
  }
});
window.addEventListener('pointerup', () => {
  const d = drag;
  drag = null;
  stage.classList.remove('drag');
  if (!d || d.mode === 'pan' || !moved) { return; }
  if (d.mode === 'step') { d.N.moved = true; }
  save();
});
stage.addEventListener('dblclick', (e) => {
  const t = e.target instanceof Element ? e.target : null;
  if (!t) { return; }
  const bend = t.closest('.bend');
  if (bend) {
    const L = linkOf(bend);
    L[bend.getAttribute('data-list')].splice(Number(bend.getAttribute('data-i')), 1);
    redraw(L); save(); return;
  }
  const edge = t.closest('.edgehit, .edge');
  if (edge) { addBend(linkOf(edge), world(e)); save(); }
});
stage.addEventListener('contextmenu', (e) => {
  const bend = e.target instanceof Element ? e.target.closest('.bend') : null;
  if (!bend) { return; }
  e.preventDefault();
  const L = linkOf(bend);
  L[bend.getAttribute('data-list')].splice(Number(bend.getAttribute('data-i')), 1);
  redraw(L); save();
});
document.getElementById('reset').addEventListener('click', () => vscode.postMessage({ type: 'reset' }));

function open(el) {
  const line = Number(el.getAttribute('data-line'));
  const file = el.getAttribute('data-file');
  if (file && line > 0) { vscode.postMessage({ type: 'open', file: file, line: line }); }
}
document.addEventListener('click', (e) => {
  const t = e.target instanceof Element ? e.target : null;
  if (!t) { return; }
  const btn = t.closest('button[data-file], li[data-file]');
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
	layout.links.forEach((l, li) => {
		const pts = l.points.map((p) => `${p.x},${p.y}`).join(" ");
		const idx = trIndex.get(l.transition) ?? -1;
		const bx = l.bar.x - l.bar.w / 2;
		// The bar group is drawn in place; the webview moves it with a translate while dragging.
		svg.push(
			`<g class="tr" data-tr="${idx}" data-li="${li}"><title>${esc(l.tooltip)}</title>` +
				`<polyline class="edge${l.dashed ? " dashed" : ""}" points="${pts}" marker-end="url(#arr)" style="color:var(--vscode-foreground, #222)"/>` +
				`<polyline class="edgehit" points="${pts}"/>` +
				`<g class="barg"><rect class="hit" x="${bx - 4}" y="${l.bar.y - 10}" width="${l.bar.w + 8 + l.label.length * 6.2 + 24}" height="20"/>` +
				`<rect class="bar" x="${bx}" y="${l.bar.y - 2}" width="${l.bar.w}" height="4"/>` +
				`<text class="lbl" x="${l.bar.x + l.bar.w / 2 + 6}" y="${l.bar.y + 4}">${esc(l.label)}</text></g>` +
				`<g class="bends"></g></g>`,
		);
	});
	layout.nodes.forEach((n, i) => {
		const open = n.file && n.line ? ` data-file="${esc(n.file)}" data-line="${n.line}"` : "";
		const tip = n.entryRoutine ? `${n.name} → ${n.entryRoutine}` : `${n.name} (no entry routine)`;
		svg.push(
			`<g class="step${open ? " hasfile" : ""}" data-i="${i}"${open}><title>${esc(tip)}</title>` +
				`<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}"/>` +
				(n.initial ? `<rect x="${n.x + 4}" y="${n.y + 4}" width="${n.w - 8}" height="${n.h - 8}"/>` : "") +
				`<text x="${n.x + n.w / 2}" y="${n.y + n.h / 2 + 4}" text-anchor="middle">${esc(n.name)}</text></g>`,
		);
	});
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

	const diag = sfc.diagnostics
		.map((d) => {
			const open = d.file && d.line ? ` data-file="${esc(d.file)}" data-line="${d.line}"` : "";
			return `<li class="${d.severity}${open ? " hasfile" : ""}"${open}>${esc(d.message)}</li>`;
		})
		.join("");

	const info = opts.layoutInfo;
	const layoutPanel =
		`<h2>Layout</h2><p class="hint">Drag steps and bars to move them. Double-click (or Alt+click) a line to add a bend point; drag it to route the line, double-click or right-click it to remove it.` +
		`${info ? ` ${info.saved ? "Saved layout applied." : "Automatic layout."} Edits are saved to <code>${esc(info.file)}</code>.` : ""}</p>` +
		`<button id="reset" type="button">Reset layout</button>` +
		(info?.warning ? `<p class="warning">${esc(info.warning)}</p>` : "") +
		(info && info.ignored.length > 0 ? `<p class="hint">Ignored saved entries (no longer in the diagram): ${info.ignored.map((k) => `<code>${esc(k)}</code>`).join(", ")}.</p>` : "");

	// Data for the script. `<` is escaped so no value can close the data block.
	const modelJson = JSON.stringify({
		nodes: layout.nodes.map((n) => ({ name: n.name, x: n.x, y: n.y, w: n.w, h: n.h, moved: !!n.moved })),
		links: layout.links.map((l) => ({
			key: linkKey(l.transition, l.from),
			from: l.from,
			to: l.to,
			bx: l.bar.x,
			by: l.bar.y,
			barFixed: !!l.barFixed,
			before: l.before ?? [],
			after: l.after ?? [],
		})),
	}).replace(/</g, "\\u003c");

	const csp = `default-src 'none'; style-src ${opts.cspSource} 'unsafe-inline'; script-src 'nonce-${opts.nonce}';`;
	return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy" content="${csp.replace(/"/g, "&quot;")}"/>
<title>${esc(opts.title)}</title>
<style>${STYLE}</style></head>
<body>
<div id="stage"><svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"><g id="vp">${svg.join("")}</g></svg></div>
<aside><h1>${esc(opts.title)}</h1>
<p>Click a step to open its entry routine; click a transition to list its emitters. Wheel = zoom, drag the background = pan.</p>
${layoutPanel}
${panels.join("")}
<h2>Diagnostics</h2>${diag ? `<ul id="diag">${diag}</ul>` : "<p>None.</p>"}
</aside>
<script type="application/json" id="model" nonce="${opts.nonce}">${modelJson}</script>
<script nonce="${opts.nonce}">${SCRIPT.replace("__GEOMETRY__", () => GEOMETRY_SOURCE)}</script>
</body></html>`;
}
