/** Self-contained call-map page (inline SVG + vanilla script, no external libs). Pure: no `vscode` imports. */
import type { CallGraph } from "./callGraph";
import type { SystemContext, ViewState } from "./callContext";
import { CALL_VIEWS_SOURCE } from "./callViews";

export interface CallMapData {
	graph: CallGraph;
	context: SystemContext;
	/** View to restore after a refresh (already sanitized). */
	state?: ViewState;
}

export interface CallMapHtmlOptions {
	cspSource: string;
	nonce: string;
	title: string;
}

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** JSON that is safe inside a `<script>` element (no `</script>`, no line separators). */
export const jsonForScript = (v: unknown): string =>
	JSON.stringify(v).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

// Built with DOM calls and textContent only: names and paths from the project never reach innerHTML.
const SCRIPT = `
const vscode = (typeof acquireVsCodeApi === 'function') ? acquireVsCodeApi() : { postMessage() {}, getState() { return undefined; }, setState() {} };
const DATA = JSON.parse(document.getElementById('cm-data').textContent);
const G = DATA.graph, CTX = DATA.context;
const V = __VIEWS__;
const NS = 'http://www.w3.org/2000/svg';
const BI = '\\u0000builtins';
const svg = document.getElementById('cm'), vp = document.getElementById('vp');
const side = document.getElementById('side'), crumbs = document.getElementById('crumbs');
const q = document.getElementById('q'), results = document.getElementById('results');
const optFolders = document.getElementById('optFolders'), optBuiltins = document.getElementById('optBuiltins');
let S = { level: 1, module: null, routine: null, gran: 'file', builtins: false };
let edgeSel = null, ctxSel = null, tx = 20, ty = 20, k = 1, edges = [], drag = null, moved = false;

function el(tag, attrs, text) {
  const n = document.createElementNS(NS, tag);
  for (const a in (attrs || {})) { n.setAttribute(a, attrs[a]); }
  if (text !== undefined) { n.textContent = text; }
  return n;
}
function h(tag, attrs, text) {
  const n = document.createElement(tag);
  for (const a in (attrs || {})) { n.setAttribute(a, attrs[a]); }
  if (text !== undefined) { n.textContent = text; }
  return n;
}
const rname = (i) => G.routines[i].name;
const rfile = (i) => G.files[G.routines[i].file];
const keyOf = (i) => S.gran === 'folder' ? rfile(i).folder : rfile(i).label;
const siteFile = (s) => rfile(G.sites[s].from);
const short = (t, n) => t.length > n ? t.slice(0, n - 1) + '\\u2026' : t;
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
function save() { try { vscode.setState(S); vscode.postMessage({ type: 'state', state: S }); } catch (e) {} }
function open(file, line) { if (file && line > 0) { vscode.postMessage({ type: 'open', file: file, line: line }); } }

/* ---------- viewport ---------- */
const apply = () => vp.setAttribute('transform', 'translate(' + tx + ' ' + ty + ') scale(' + k + ')');
function fit(w, hh) {
  const r = svg.getBoundingClientRect();
  const W = r.width || 1000, H = r.height || 600;
  k = Math.max(0.05, Math.min(1.4, (W - 40) / Math.max(w, 1), (H - 40) / Math.max(hh, 1)));
  tx = Math.max(20, (W - w * k) / 2); ty = Math.max(20, (H - hh * k) / 2);
  apply();
}
svg.addEventListener('wheel', (e) => {
  e.preventDefault();
  const r = svg.getBoundingClientRect();
  const px = e.clientX - r.left, py = e.clientY - r.top;
  const nk = Math.min(4, Math.max(0.05, k * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
  tx = px - (px - tx) * nk / k; ty = py - (py - ty) * nk / k; k = nk; apply();
}, { passive: false });
svg.addEventListener('mousedown', (e) => { drag = { x: e.clientX, y: e.clientY, tx: tx, ty: ty }; moved = false; });
window.addEventListener('mousemove', (e) => {
  if (!drag) { return; }
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (Math.abs(dx) + Math.abs(dy) > 4) { moved = true; }
  if (moved) { tx = drag.tx + dx; ty = drag.ty + dy; apply(); }
});
window.addEventListener('mouseup', () => { drag = null; });

/* ---------- geometry ---------- */
const mid = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
function clip(r, p) {
  const c = mid(r), dx = p.x - c.x, dy = p.y - c.y;
  if (!dx && !dy) { return c; }
  const s = Math.min(dx ? (r.w / 2) / Math.abs(dx) : Infinity, dy ? (r.h / 2) / Math.abs(dy) : Infinity);
  return { x: c.x + dx * s, y: c.y + dy * s };
}
function curve(a, b) {
  const ca = mid(a), cb = mid(b), dx = cb.x - ca.x, dy = cb.y - ca.y, len = Math.hypot(dx, dy) || 1;
  if (Math.abs(dx) < 4 && a !== b) {
    const ay = ca.y, by = cb.y, bx = a.x - 34 - Math.abs(ay - by) * 0.18;
    return { d: 'M' + a.x + ' ' + ay + ' Q' + bx + ' ' + ((ay + by) / 2) + ' ' + b.x + ' ' + by, lx: bx + (a.x - bx) / 2, ly: (ay + by) / 2 };
  }
  if (a === b) {
    return { d: 'M' + (a.x + a.w) + ' ' + (a.y + a.h * 0.3) + ' C' + (a.x + a.w + 44) + ' ' + (a.y - 8) + ' ' + (a.x + a.w + 44) + ' ' + (a.y + a.h + 8) + ' ' + (a.x + a.w) + ' ' + (a.y + a.h * 0.7), lx: a.x + a.w + 36, ly: a.y + a.h / 2 };
  }
  const off = Math.min(70, len * 0.18), cx = (ca.x + cb.x) / 2 - dy / len * off, cy = (ca.y + cb.y) / 2 + dx / len * off;
  const p1 = clip(a, { x: cx, y: cy }), p2 = clip(b, { x: cx, y: cy });
  return { d: 'M' + p1.x + ' ' + p1.y + ' Q' + cx + ' ' + cy + ' ' + p2.x + ' ' + p2.y, lx: 0.25 * p1.x + 0.5 * cx + 0.25 * p2.x, ly: 0.25 * p1.y + 0.5 * cy + 0.25 * p2.y };
}

/* ---------- drawing primitives ---------- */
function node(layer, id, r, cls, title, lines, onClick) {
  const g = el('g', { class: 'node ' + cls, 'data-id': id, tabindex: '0', role: 'button' });
  g.appendChild(el('title', null, title));
  g.appendChild(el('rect', { x: r.x, y: r.y, width: r.w, height: r.h, rx: 5 }));
  lines.forEach((t, i) => g.appendChild(el('text', { class: i === 0 ? 'nt' : 'ns', x: r.x + 9, y: r.y + (lines.length === 1 ? r.h / 2 + 4 : 16 + i * 14) }, t)));
  g.addEventListener('click', () => { if (!moved) { onClick(); } });
  g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } });
  layer.appendChild(g);
  return g;
}
function edge(layer, from, to, a, b, count, cls, tip, selected, onClick) {
  const c = curve(a, b);
  const g = el('g', { class: 'edge ' + cls + (selected ? ' sel' : '') });
  g.appendChild(el('title', null, tip));
  g.appendChild(el('path', { class: 'line', d: c.d, 'marker-end': 'url(#arr)' }));
  g.appendChild(el('path', { class: 'hit', d: c.d }));
  if (count > 0) { g.appendChild(el('text', { class: 'cnt', x: c.lx, y: c.ly + 4, 'text-anchor': 'middle' }, String(count))); }
  g.addEventListener('click', (e) => { e.stopPropagation(); if (!moved) { onClick(); } });
  layer.appendChild(g);
  edges.push({ g: g, from: from, to: to });
  return g;
}
function hover(g, id) {
  g.addEventListener('mouseenter', () => edges.forEach((e) => { const on = e.from === id || e.to === id; e.g.classList.toggle('hl', on); e.g.classList.toggle('faint', !on); }));
  g.addEventListener('mouseleave', () => edges.forEach((e) => { e.g.classList.remove('hl'); e.g.classList.remove('faint'); }));
}

/* ---------- side panel ---------- */
function clear(n) { while (n.firstChild) { n.removeChild(n.firstChild); } }
function loc(file, line, label) {
  const b = h('button', { type: 'button', class: 'loc', title: 'Open ' + label + ':' + line }, label + ':' + line);
  b.addEventListener('click', () => open(file, line));
  return b;
}
function siteRow(s) {
  const site = G.sites[s], f = siteFile(s);
  const li = h('li');
  const from = h('a', { href: '#', class: 'rt' }, rname(site.from));
  from.addEventListener('click', (e) => { e.preventDefault(); goRoutine(site.from); });
  li.appendChild(from);
  li.appendChild(document.createTextNode(' \\u2192 '));
  if (site.to >= 0) {
    const to = h('a', { href: '#', class: 'rt' }, rname(site.to));
    to.addEventListener('click', (e) => { e.preventDefault(); goRoutine(site.to); });
    li.appendChild(to);
  } else { li.appendChild(h('span', { class: 'bi' }, site.name + ' (built-in)')); }
  li.appendChild(document.createTextNode(' '));
  li.appendChild(loc(f.file, site.line, f.label));
  return li;
}
function section(title, list) {
  side.appendChild(h('h3', null, title));
  const ul = h('ul'); list.forEach((x) => ul.appendChild(x)); side.appendChild(ul);
}
function help(text) { side.appendChild(h('p', { class: 'hint' }, text)); }
function renderSide() {
  clear(side);
  if (S.routine !== null) { return routineSide(S.routine); }
  if (edgeSel) {
    side.appendChild(h('h2', null, edgeSel.title));
    side.appendChild(h('p', { class: 'hint' }, plural(edgeSel.sites.length, 'call site') + '. Click a call to open it in the editor.'));
    return section('Calls', edgeSel.sites.map(siteRow));
  }
  if (ctxSel) {
    side.appendChild(h('h2', null, ctxSel.label));
    side.appendChild(h('p', { class: 'hint' }, 'Read from the .rev (read-only). Not part of the call graph.'));
    return section(plural(ctxSel.names.length, 'entry'), ctxSel.names.map((n) => h('li', null, n)));
  }
  if (S.level === 1) { return help('System context. Click the program to open its modules.'); }
  if (S.level === 2) { return help('Click a module to see its routines, or a line to list the calls behind it. Hover a module to highlight its calls.'); }
  help('Click a routine to highlight its callers and callees, a line to list its calls, or another module to open it.');
}
function routineSide(id) {
  const r = G.routines[id], f = rfile(id), n = V.neighborhood(G, id);
  side.appendChild(h('h2', null, r.name));
  side.appendChild(h('p', { class: 'hint' }, r.kind + (r.forward ? ' (declared, no body)' : '') + ' in ' + f.label));
  const go = h('button', { type: 'button', class: 'primary' }, 'Go to definition (' + f.label + ':' + r.line + ')');
  go.addEventListener('click', () => open(f.file, r.line));
  side.appendChild(go);
  section('Modules involved (' + n.modules.length + ')', n.modules.map((m) => h('li', null, m)));
  section('Called by (' + n.callers.length + ')', n.callers.map((c) => { const li = h('li'); const a = h('a', { href: '#', class: 'rt' }, rname(c.id) + (c.count > 1 ? ' \\u00d7' + c.count : '')); a.addEventListener('click', (e) => { e.preventDefault(); goRoutine(c.id); }); li.appendChild(a); li.appendChild(document.createTextNode(' ' + rfile(c.id).label + ' ')); c.sites.forEach((s) => li.appendChild(loc(siteFile(s).file, G.sites[s].line, 'L'))); return li; }));
  section('Calls (' + n.callees.length + ')', n.callees.map((c) => { const li = h('li'); const a = h('a', { href: '#', class: 'rt' }, rname(c.id) + (c.count > 1 ? ' \\u00d7' + c.count : '')); a.addEventListener('click', (e) => { e.preventDefault(); goRoutine(c.id); }); li.appendChild(a); li.appendChild(document.createTextNode(' ' + rfile(c.id).label + ' ')); c.sites.forEach((s) => li.appendChild(loc(siteFile(s).file, G.sites[s].line, 'L'))); return li; }));
  if (n.builtins.length) { section('Built-ins (' + n.builtins.length + ')', n.builtins.map((b) => h('li', null, b.name + (b.count > 1 ? ' \\u00d7' + b.count : '')))); }
}

/* ---------- navigation ---------- */
function setView(level, module, routine, refit) {
  S.level = level; S.module = module; S.routine = routine; edgeSel = null; ctxSel = null;
  render(refit !== false);
}
function goRoutine(id) { setView(3, keyOf(id), id); }
function renderCrumbs() {
  clear(crumbs);
  const add = (label, fn) => {
    if (crumbs.childNodes.length) { crumbs.appendChild(h('span', { class: 'sep' }, '\\u203a')); }
    const b = h('button', { type: 'button', class: fn ? 'crumb' : 'crumb cur' }, label);
    if (fn) { b.addEventListener('click', fn); }
    crumbs.appendChild(b);
  };
  add('System', S.level > 1 || S.routine !== null || edgeSel || ctxSel ? () => setView(1, null, null) : null);
  if (S.level >= 2) { add('Modules', S.level > 2 || S.routine !== null || edgeSel ? () => setView(2, null, null) : null); }
  if (S.level === 3) { add(S.module, S.routine !== null ? () => setView(3, S.module, null, false) : null); }
  if (S.level === 3 && S.routine !== null) { add(rname(S.routine), null); }
}

/* ---------- Level 1 ---------- */
function renderSystem() {
  const P = CTX.program, gx = 0, px = 420;
  const gh = 54, gap = 18, total = Math.max(1, CTX.groups.length) * (gh + gap) - gap;
  const prog = { x: px, y: Math.max(0, total / 2 - 45), w: 250, h: 90 };
  const layerE = el('g'), layerN = el('g'); vp.appendChild(layerE); vp.appendChild(layerN);
  CTX.groups.forEach((grp, i) => {
    const r = { x: gx, y: i * (gh + gap), w: 220, h: gh };
    edge(layerE, 'ctx' + i, 'prog', r, prog, 0, 'ctx', grp.label + ' \\u2194 program', ctxSel === grp, () => {});
    const sel = () => { edgeSel = null; S.routine = null; ctxSel = grp; renderSide(); renderCrumbs(); layerN.querySelectorAll('.node.ctx').forEach((n) => n.classList.toggle('sel', n.getAttribute('data-id') === 'ctx' + i)); };
    node(layerN, 'ctx' + i, r, 'ctx', grp.label + ': ' + grp.names.join(', '), [grp.label, plural(grp.names.length, 'entry')], sel);
  });
  node(layerN, 'prog', prog, 'program', 'Open the modules of the program', [short(P.name, 28), plural(P.modules, 'module') + ' \\u00b7 ' + plural(P.routines, 'routine'), plural(P.calls, 'call') + ' (+' + P.builtinCalls + ' built-in)'], () => setView(2, null, null));
  if (!CTX.hasRev) { vp.appendChild(el('text', { class: 'note', x: px, y: prog.y + prog.h + 34 }, 'No .rev next to main.src: showing the program only.')); }
  return { w: px + prog.w, h: Math.max(total, prog.y + prog.h + 40) };
}

/* ---------- Level 2 ---------- */
function renderModules() {
  const view = V.moduleView(G, S.gran);
  const items = view.nodes.map((n) => ({ id: n.id, group: n.group }));
  const showBi = S.builtins && view.builtins.length > 0;
  if (showBi) { items.push({ id: BI, group: '' }); }
  const L = V.layoutGrouped(items);
  L.groups.forEach((g) => { vp.appendChild(el('rect', { class: 'frame', x: g.x, y: g.y, width: g.w, height: g.h, rx: 7 })); vp.appendChild(el('text', { class: 'frameLabel', x: g.x + 10, y: g.y + 16 }, g.name)); });
  const layerE = el('g'), layerN = el('g'); vp.appendChild(layerE); vp.appendChild(layerN);
  view.edges.forEach((e) => {
    const sel = edgeSel && edgeSel.key === e.from + '>' + e.to;
    const lab = (id) => view.nodes.find((n) => n.id === id).id;
    edge(layerE, e.from, e.to, L.pos[e.from], L.pos[e.to], e.count, '', lab(e.from) + ' \\u2192 ' + lab(e.to) + ': ' + plural(e.count, 'call'), sel,
      () => { S.routine = null; edgeSel = { key: e.from + '>' + e.to, title: lab(e.from) + ' \\u2192 ' + lab(e.to), sites: e.sites }; render(false); });
  });
  if (showBi) {
    view.builtins.forEach((b) => edge(layerE, b.from, BI, L.pos[b.from], L.pos[BI], b.count, 'bi', b.from + ' \\u2192 built-ins: ' + plural(b.count, 'call'), edgeSel && edgeSel.key === 'bi>' + b.from,
      () => { S.routine = null; edgeSel = { key: 'bi>' + b.from, title: b.from + ' \\u2192 built-ins', sites: b.sites }; render(false); }));
  }
  view.nodes.forEach((n) => {
    const g = node(layerN, n.id, L.pos[n.id], 'module', n.id + ' \\u2014 ' + plural(n.routines, 'routine'), [short(n.label, 26), plural(n.routines, 'routine') + ' \\u00b7 ' + n.internal + ' internal'], () => setView(3, n.id, null));
    hover(g, n.id);
  });
  if (showBi) { node(layerN, BI, L.pos[BI], 'builtins', 'Calls to names the project does not declare', ['built-ins', 'not drawn as modules'], () => {}); }
  return { w: L.width, h: L.height, hidden: G.hiddenFiles };
}

/* ---------- Level 3 ---------- */
function renderRoutines() {
  const D = V.moduleDetail(G, S.gran, S.module);
  const nb = S.routine !== null ? V.neighborhood(G, S.routine) : null;
  const showBi = S.builtins && D.builtins.length > 0;
  const left = D.inModules.map((m) => 'i:' + m), right = D.outModules.map((m) => 'o:' + m);
  if (showBi) { right.push(BI); }
  const L = V.layoutColumns(left, D.routines.map(String), right);
  const layerE = el('g'), layerN = el('g'); vp.appendChild(layerE); vp.appendChild(layerN);
  const sel = S.routine;
  const touches = (a, b) => sel === null || a === sel || b === sel;
  const pick = (title, sites, key) => () => { S.routine = null; edgeSel = { key: key, title: title, sites: sites }; render(false); };
  D.internal.forEach((e) => { const key = 'r' + e.from + '>' + e.to; edge(layerE, e.from, e.to, L.pos[e.from], L.pos[e.to], e.count, touches(e.from, e.to) ? '' : 'faint', rname(e.from) + ' \\u2192 ' + rname(e.to) + ': ' + plural(e.count, 'call'), edgeSel && edgeSel.key === key, pick(rname(e.from) + ' \\u2192 ' + rname(e.to), e.sites, key)); });
  D.incoming.forEach((e) => { const key = 'i' + e.from + '>' + e.to; edge(layerE, 'i:' + e.from, e.to, L.pos['i:' + e.from], L.pos[e.to], e.count, touches(-1, e.to) ? 'ext' : 'ext faint', e.from + ' \\u2192 ' + rname(e.to) + ': ' + plural(e.count, 'call'), edgeSel && edgeSel.key === key, pick(e.from + ' \\u2192 ' + rname(e.to), e.sites, key)); });
  D.outgoing.forEach((e) => { const key = 'o' + e.from + '>' + e.to; edge(layerE, e.from, 'o:' + e.to, L.pos[e.from], L.pos['o:' + e.to], e.count, touches(e.from, -1) ? 'ext' : 'ext faint', rname(e.from) + ' \\u2192 ' + e.to + ': ' + plural(e.count, 'call'), edgeSel && edgeSel.key === key, pick(rname(e.from) + ' \\u2192 ' + e.to, e.sites, key)); });
  if (showBi) { D.builtins.forEach((b) => { const key = 'b' + b.from; edge(layerE, b.from, BI, L.pos[b.from], L.pos[BI], b.count, touches(b.from, -1) ? 'bi' : 'bi faint', rname(b.from) + ' \\u2192 built-ins: ' + plural(b.count, 'call'), edgeSel && edgeSel.key === key, pick(rname(b.from) + ' \\u2192 built-ins', b.sites, key)); }); }
  const label = (m) => V.shortLabel(m);
  D.inModules.forEach((m) => node(layerN, 'i:' + m, L.pos['i:' + m], 'module ext', m + ' (calls into this module)', [short(label(m), 26), 'calls this module'], () => setView(3, m, null)));
  D.outModules.forEach((m) => node(layerN, 'o:' + m, L.pos['o:' + m], 'module ext', m + ' (called from this module)', [short(label(m), 26), 'called from here'], () => setView(3, m, null)));
  if (showBi) { node(layerN, BI, L.pos[BI], 'builtins', 'Calls to names the project does not declare', ['built-ins', 'not drawn as modules'], () => {}); }
  D.routines.forEach((id) => {
    const r = G.routines[id];
    const cls = 'routine' + (r.kind === 'handler' ? ' handler' : '') + (r.forward ? ' fwd' : '') + (id === sel ? ' sel' : '') + (nb && (nb.callers.some((c) => c.id === id) || nb.callees.some((c) => c.id === id)) ? ' nb' : '') + (nb && id !== sel && !nb.callers.some((c) => c.id === id) && !nb.callees.some((c) => c.id === id) ? ' dim' : '');
    const g = node(layerN, String(id), L.pos[String(id)], cls, r.name + ' \\u2014 ' + r.kind + ' (line ' + r.line + ')', [short(r.name, 28)], () => { edgeSel = null; S.routine = S.routine === id ? null : id; render(false); });
    g.addEventListener('dblclick', () => open(rfile(id).file, r.line));
    hover(g, id);
  });
  return { w: L.width, h: L.height };
}

/* ---------- render ---------- */
function render(refit) {
  clear(vp); edges = [];
  if (S.level === 3 && !G.files.some((f) => (S.gran === 'folder' ? f.folder : f.label) === S.module)) { S.level = 2; S.module = null; S.routine = null; }
  const dims = S.level === 1 ? renderSystem() : S.level === 2 ? renderModules() : renderRoutines();
  if (refit) { fit(dims.w, dims.h); }
  optFolders.checked = S.gran === 'folder'; optBuiltins.checked = S.builtins;
  document.getElementById('count').textContent = S.level === 2 && dims.hidden ? dims.hidden + ' file(s) without routines are not drawn' : '';
  renderCrumbs(); renderSide(); save();
}
optFolders.addEventListener('change', () => {
  S.gran = optFolders.checked ? 'folder' : 'file';
  if (S.level === 3) { if (S.routine !== null) { S.module = keyOf(S.routine); } else { S.level = 2; S.module = null; } }
  edgeSel = null; render(true);
});
optBuiltins.addEventListener('change', () => { S.builtins = optBuiltins.checked; render(false); });
document.getElementById('home').addEventListener('click', () => setView(1, null, null));

/* ---------- search ---------- */
function runSearch() {
  clear(results);
  const ids = V.search(G, q.value, 30);
  results.hidden = ids.length === 0;
  ids.forEach((id) => {
    const li = h('li', { tabindex: '0' }, rname(id) + '  \\u00b7  ' + G.routines[id].kind + '  \\u00b7  ' + rfile(id).label);
    const pickIt = () => { results.hidden = true; q.value = ''; goRoutine(id); };
    li.addEventListener('click', pickIt);
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter') { pickIt(); } });
    results.appendChild(li);
  });
}
q.addEventListener('input', runSearch);
q.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { const f = results.firstChild; if (f) { f.click(); } }
  if (e.key === 'Escape') { results.hidden = true; q.value = ''; }
});

/* ---------- boot ---------- */
try {
  const old = DATA.state || vscode.getState();
  if (old && typeof old === 'object') {
    S.gran = old.gran === 'folder' ? 'folder' : 'file';
    S.builtins = old.builtins === true;
    S.level = old.level === 2 || old.level === 3 ? old.level : 1;
    S.module = typeof old.module === 'string' ? old.module : null;
    S.routine = Number.isInteger(old.routine) && old.routine >= 0 && old.routine < G.routines.length ? old.routine : null;
    if (S.level === 3 && S.module === null) { S.level = 2; }
  }
} catch (e) {}
render(true);
`;

export function renderCallMapHtml(data: CallMapData, opts: CallMapHtmlOptions): string {
	const csp = `default-src 'none'; style-src ${esc(opts.cspSource)} 'unsafe-inline'; script-src 'nonce-${esc(opts.nonce)}';`;
	const empty = data.graph.routines.length === 0 ? `<p class="empty">No routines found in this project.</p>` : "";
	const diags = data.graph.diagnostics.length > 0 ? `<ul class="diag">${data.graph.diagnostics.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>` : "";
	return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>${esc(opts.title)}</title>
<style>
:root{--cm-bg:var(--vscode-editor-background,#1e1e1e);--cm-fg:var(--vscode-foreground,#ddd);--cm-line:var(--vscode-panel-border,#555);--cm-accent:var(--vscode-textLink-foreground,#3794ff);--cm-warn:var(--vscode-editorWarning-foreground,#d9a400);--cm-card:var(--vscode-editorWidget-background,#252526)}
*{box-sizing:border-box}
body{margin:0;display:flex;flex-direction:column;height:100vh;font-family:var(--vscode-font-family,sans-serif);font-size:13px;color:var(--cm-fg);background:var(--cm-bg)}
header{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;padding:6px 12px;border-bottom:1px solid var(--cm-line)}
h1{font-size:13px;margin:0}h2{font-size:14px;margin:0 0 4px}h3{font-size:12px;margin:12px 0 4px;text-transform:uppercase;opacity:.75}
#crumbs{display:flex;align-items:center;gap:4px;flex:1 1 240px;min-width:0}.sep{opacity:.6}
button{font:inherit;color:inherit;background:none;border:0;cursor:pointer}
button.crumb{color:var(--cm-accent);padding:2px 4px;border-radius:3px}button.crumb:hover{text-decoration:underline}button.cur{color:var(--cm-fg);cursor:default;font-weight:600}button.cur:hover{text-decoration:none}
#find{position:relative}#q{width:220px;padding:3px 6px;color:var(--vscode-input-foreground,#ddd);background:var(--vscode-input-background,#3c3c3c);border:1px solid var(--vscode-input-border,#555);border-radius:3px}
#results{position:absolute;z-index:5;top:100%;left:0;min-width:320px;max-height:260px;overflow:auto;margin:2px 0 0;padding:0;list-style:none;background:var(--cm-card);border:1px solid var(--cm-line)}
#results[hidden]{display:none}#results li{padding:4px 8px;cursor:pointer;white-space:nowrap}#results li:hover,#results li:focus{background:var(--vscode-list-hoverBackground,#2a2d2e);outline:none}
label.opt{display:flex;gap:4px;align-items:center;cursor:pointer}#count{opacity:.7;font-size:12px}
main{display:flex;flex:1;min-height:0}
#stage{flex:1;min-width:0}svg{width:100%;height:100%;display:block;cursor:grab}
#side{width:320px;max-width:42vw;overflow:auto;padding:10px 12px;border-left:1px solid var(--cm-line)}
#side ul{margin:0;padding:0;list-style:none}#side li{padding:2px 0;line-height:1.5}.hint{opacity:.75;margin:2px 0 8px}
a.rt{color:var(--cm-accent);text-decoration:none}a.rt:hover{text-decoration:underline}
button.loc{color:var(--cm-accent);font-size:12px;padding:0 3px;text-decoration:underline}button.primary{margin:4px 0;padding:4px 10px;background:var(--vscode-button-background,#0e639c);color:var(--vscode-button-foreground,#fff);border-radius:3px}
.bi{opacity:.8;font-style:italic}.empty,.diag{margin:8px 12px}
.node{cursor:pointer}.node rect{fill:var(--cm-card);stroke:var(--cm-line);stroke-width:1.2}.node:hover rect,.node:focus rect{stroke:var(--cm-accent)}.node:focus{outline:none}
.nt{fill:var(--cm-fg);font-size:12px;font-weight:600}.ns{fill:var(--cm-fg);opacity:.7;font-size:10px}
.program rect{fill:var(--vscode-button-background,#0e639c);stroke:var(--cm-accent)}.program .nt,.program .ns{fill:var(--vscode-button-foreground,#fff);opacity:1}
.ctx rect{stroke-dasharray:5 3}.ctx.sel rect,.routine.sel rect{stroke:var(--cm-warn);stroke-width:2.4}
.ext rect{stroke-dasharray:5 3}.builtins{cursor:default}.builtins rect{stroke-dasharray:2 3;opacity:.8}
.routine rect{fill:var(--cm-card)}.routine.handler .nt{font-style:italic}.routine.fwd rect{stroke-dasharray:3 3}.routine.nb rect{stroke:var(--cm-accent);stroke-width:2}.routine.dim{opacity:.35}
.frame{fill:none;stroke:var(--cm-line);stroke-dasharray:6 4}.frameLabel{fill:var(--cm-fg);opacity:.75;font-size:11px}.note{fill:var(--cm-fg);opacity:.7;font-size:12px}
.edge .line{fill:none;stroke:var(--cm-fg);opacity:.55;stroke-width:1.4}.edge .hit{fill:none;stroke:transparent;stroke-width:12;cursor:pointer}
.edge.ext .line{stroke-dasharray:5 3}.edge.bi .line{stroke-dasharray:2 3}.edge.ctx .line{marker-end:none;stroke-dasharray:4 3}
.edge:hover .line,.edge.hl .line,.edge.sel .line{opacity:1;stroke:var(--cm-warn);stroke-width:2.2}.edge.faint{opacity:.18}
.cnt{fill:var(--cm-fg);font-size:10px;paint-order:stroke;stroke:var(--cm-bg);stroke-width:3px;pointer-events:none}
#arr path{fill:currentColor}
</style></head><body>
<header><h1>${esc(opts.title)}</h1><nav id="crumbs" aria-label="Breadcrumb"></nav>
<div id="find"><input id="q" type="search" placeholder="Find a routine..." aria-label="Find a routine" autocomplete="off"><ul id="results" hidden></ul></div>
<label class="opt"><input type="checkbox" id="optFolders"> Collapse to folders</label>
<label class="opt"><input type="checkbox" id="optBuiltins"> Show built-ins</label>
<button type="button" id="home" class="crumb">Reset view</button><span id="count"></span></header>
${empty}${diags}
<main><div id="stage"><svg id="cm" xmlns="http://www.w3.org/2000/svg"><defs><marker id="arr" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" style="color:var(--cm-fg)"/></marker></defs><g id="vp"></g></svg></div><aside id="side" aria-live="polite"></aside></main>
<script type="application/json" id="cm-data">${jsonForScript(data)}</script>
<script nonce="${esc(opts.nonce)}">${SCRIPT.replace("__VIEWS__", () => CALL_VIEWS_SOURCE)}</script>
</body></html>`;
}
