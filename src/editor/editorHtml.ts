/**
 * Pure HTML renderer of the screen editor webview (no `vscode` import). It reuses the preview's widget boxes
 * (`renderWidget`, `WIDGET_STYLE`), panel geometry and view state, and the self-contained `createEditorMath`.
 *
 * The page never decides what is saved: it sends `edit` messages with authored 7" numbers, the extension
 * validates them, owns the document and answers with `sync` messages holding the effective geometry.
 * Hide/show and z-order are preview-only view state (see `odd/reports/issue-6-screen-editor.md`, z-order).
 */
import { BUILTIN_IMAGE_HINT } from "../firmware/imageCache";
import { resolveImage } from "../rev";
import type { imagePickerModel } from "./imagePicker";
import { allGeometries, panelGeometry, PANELS } from "../preview/panels";
import type { PanelId } from "../preview/panels";
import { PREVIEW_STATE_SOURCE, previewState } from "../preview/previewState";
import { escapeHtml, renderWidget, WIDGET_STYLE } from "../preview/screenHtml";
import type { RenderOptions } from "../preview/screenHtml";
import type { ScreensView, ScreenView } from "../preview/screenModel";
import { screenTitle } from "../preview/widgetList";
import { WIDGET_TYPES, paletteTypes } from "../rev/widgetCatalog";
import { EDITOR_MATH_SOURCE } from "./editorMath";
import type { IriHint } from "./iriHint";
import { DEFAULT_GRID } from "./messages";

export interface EditorRenderOptions extends RenderOptions {
	prefs: { snap: boolean; grid: number };
	/** Widget selected after a rebuild of the page (an edit that adds, deletes or changes fields). */
	selected?: number | null;
	/** File names of the project's `sdimages/` folder, for the image picker. */
	images?: string[];
	builtinUri?: (id: string, panel: PanelId) => string | undefined;
	gallery?: ReturnType<typeof imagePickerModel>;
	/** `main.iri` lines to add, change and remove for the session's edits (never written by the extension). */
	hint?: IriHint;
}

const CANVAS_WIDTH = panelGeometry("7").canvasWidth;
const CANVAS_HEIGHT = panelGeometry("7").canvasHeight;
const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

function jsonForScript(v: unknown): string {
	return JSON.stringify(v).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

const STYLE = `
body{margin:0;padding:8px;font-family:var(--vscode-font-family,sans-serif);color:var(--vscode-foreground);}
#bar{display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-bottom:6px;}
#bar button{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:1px solid var(--vscode-panel-border,#666);padding:2px 8px;cursor:pointer;}
#bar button.on{background:var(--vscode-button-background);color:var(--vscode-button-foreground);}
#bar label{display:inline-flex;gap:4px;align-items:center;margin-left:8px;font-size:12px;}
#bar input[type=number]{width:3.5em;}
#panels{display:inline-flex;gap:4px;margin-left:8px;}
#hint{font-size:11px;opacity:.75;margin:0 0 8px;}
body:not(.single) .screen{display:none;}
.screen{display:none;}
.screen.sel{display:block;}
.screen h3{margin:0 0 4px;font-size:12px;font-weight:normal;}
.frame{position:relative;overflow:hidden;border:1px solid var(--vscode-panel-border,#666);}
.canvas{position:absolute;left:0;top:0;width:${CANVAS_WIDTH}px;height:${CANVAS_HEIGHT}px;background:#fff;transform-origin:0 0;}
.content{position:absolute;left:0;top:0;width:${CANVAS_WIDTH}px;height:${CANVAS_HEIGHT}px;transform-origin:0 0;}
.band{position:absolute;left:0;display:none;background:repeating-linear-gradient(45deg,#e8e8e8,#e8e8e8 6px,#f6f6f6 6px,#f6f6f6 12px);border-top:1px dashed #999;box-sizing:border-box;}
${WIDGET_STYLE}
.w{touch-action:none;}
.w.fixed{cursor:default;}
.w.moving{opacity:.85;}
.ovl{position:absolute;box-sizing:border-box;pointer-events:none;display:none;outline:2px solid #e91e63;z-index:1000000;}
.ovl.hov{outline-style:dashed;outline-width:1px;}
.ovl .h{position:absolute;width:var(--hs,8px);height:var(--hs,8px);background:#e91e63;border:1px solid #fff;box-sizing:border-box;pointer-events:auto;touch-action:none;}
.ovl.nosize .h{display:none;}
.h[data-h=nw]{left:calc(var(--hs,8px) / -2);top:calc(var(--hs,8px) / -2);cursor:nwse-resize;}
.h[data-h=n]{left:calc(50% - var(--hs,8px) / 2);top:calc(var(--hs,8px) / -2);cursor:ns-resize;}
.h[data-h=ne]{right:calc(var(--hs,8px) / -2);top:calc(var(--hs,8px) / -2);cursor:nesw-resize;}
.h[data-h=e]{right:calc(var(--hs,8px) / -2);top:calc(50% - var(--hs,8px) / 2);cursor:ew-resize;}
.h[data-h=se]{right:calc(var(--hs,8px) / -2);bottom:calc(var(--hs,8px) / -2);cursor:nwse-resize;}
.h[data-h=s]{left:calc(50% - var(--hs,8px) / 2);bottom:calc(var(--hs,8px) / -2);cursor:ns-resize;}
.h[data-h=sw]{left:calc(var(--hs,8px) / -2);bottom:calc(var(--hs,8px) / -2);cursor:nesw-resize;}
.h[data-h=w]{left:calc(var(--hs,8px) / -2);top:calc(50% - var(--hs,8px) / 2);cursor:ew-resize;}
.muted{opacity:.7;}
.body{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start;}
.left{flex:0 0 auto;}
.side{flex:1 1 300px;min-width:280px;max-height:620px;overflow:auto;}
.fields{margin-top:8px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:12px;}
.fields label{display:inline-flex;gap:4px;align-items:center;}
.fields input{width:4.5em;}
.fields .sel-title{font-weight:600;flex:1 0 100%;}
.wlist{width:100%;border-collapse:collapse;font-size:11px;}
.wlist th{text-align:left;position:sticky;top:0;background:var(--vscode-editor-background,#1e1e1e);font-weight:600;}
.wlist td,.wlist th{padding:2px 6px;white-space:nowrap;}
.wlist tr.row{cursor:pointer;}
.wlist tr.row:hover{background:var(--vscode-list-hoverBackground,#2a2d2e);}
.wlist tr.row.sel{background:var(--vscode-list-activeSelectionBackground,#094771);color:var(--vscode-list-activeSelectionForeground,#fff);}
.wlist tr.row.edited td.g{font-weight:700;}
.wlist td.n{text-align:right;}
.wlist button,.tools button{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:1px solid var(--vscode-panel-border,#666);padding:0 5px;margin-right:2px;cursor:pointer;font-size:10px;line-height:16px;}
.wlist tr.hid td:not(.ctl){opacity:.45;text-decoration:line-through;}
#palette{display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin:0 0 6px;font-size:12px;}
#palette button{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:1px solid var(--vscode-panel-border,#666);padding:2px 8px;cursor:grab;}
#palette .legacy{font-size:11px;opacity:.7;flex:1 0 100%;}
#notice{min-height:1.2em;font-size:12px;color:var(--vscode-errorForeground,#f66);margin:0 0 4px;}
#irihint,#refs{border:1px solid var(--vscode-panel-border,#666);padding:4px 8px;margin:0 0 8px;font-size:12px;}
#irihint pre,#refs pre{margin:4px 0;font-family:var(--vscode-editor-font-family,monospace);white-space:pre-wrap;}
.insp{font-size:12px;margin-bottom:8px;}
.insp .row{display:flex;gap:6px;align-items:center;margin:2px 0;}
.insp .row label{flex:0 0 8.5em;opacity:.85;}
.insp .row input[type=text],.insp .row input[type=number],.insp .row select{flex:1 1 auto;min-width:0;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,#666);}
.insp .row input[type=color]{flex:0 0 2.2em;padding:0;}
.insp .ro{opacity:.7;}
.insp button{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:1px solid var(--vscode-panel-border,#666);padding:2px 8px;margin-right:4px;cursor:pointer;}
.tools{margin:0 0 4px;display:flex;flex-wrap:wrap;gap:4px;align-items:center;font-size:11px;}
.gallery{display:flex;flex-wrap:wrap;gap:4px;max-height:220px;overflow:auto;}
.gallery button{display:flex;flex-direction:column;align-items:center;max-width:100px;overflow:hidden;}
.gallery img{width:64px;height:48px;object-fit:contain;}
`;

const SCRIPT = `
const vscode = typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : { postMessage() {}, getState() { return undefined; }, setState() {} };
const GEOM = __GEOM__;
const PS = __PS__;
const EM = __EM__;
const INIT = __INIT__;
const PREFS = __PREFS__;
const CAT = __CAT__;
const PROPS = __PROPS__;
const GALLERY = __GALLERY__;
const INITSEL = __INITSEL__;
const saved = vscode.getState() || {};
// View state (screen, panel, hidden, z-order) is preview-only; prefs (snap, grid) are per session. Edits are never kept here.
let state = PS.sanitize(saved.view || INIT);
let prefs = saved.prefs && typeof saved.prefs.snap === 'boolean' ? saved.prefs : PREFS;
const body = document.body;
const GEO = {};
const SIZED = {};
let viewScale = 1;
let sel = null;
let drag = null;
document.querySelectorAll('.w').forEach(el => {
  const i = JSON.parse(el.dataset.info);
  GEO[i.id] = { x: i.x, y: i.y, w: i.w, h: i.h };
  SIZED[i.id] = i.w !== null && i.h !== null;
});
const screens = [...document.querySelectorAll('.screen')];
if (!screens.some(s => s.dataset.screen === state.screen) && screens.length) state = { ...state, screen: screens[0].dataset.screen };
if (INITSEL !== null && GEO[INITSEL]) { const s0 = secOf(INITSEL); if (s0) { state = { ...state, screen: s0.dataset.screen }; sel = { id: INITSEL }; } }
function persist() { vscode.setState({ view: state, prefs }); }
function saveView() { persist(); vscode.postMessage({ type: 'state', state }); layout(); }
function savePrefs() { persist(); vscode.postMessage({ type: 'prefs', snap: prefs.snap, grid: prefs.grid }); }
function gridNow() { return prefs.snap ? prefs.grid : 0; }
function curSec() { return document.querySelector('.screen.sel'); }
function widgetEl(sec, id) { return sec.querySelector('.w[data-id="' + id + '"]'); }
function rowEl(sec, id) { return sec.querySelector('tr.row[data-id="' + id + '"]'); }
function isBackdrop(id) {
  const g = GEO[id];
  return !!g && g.w !== null && g.h !== null && g.w >= GEOM['7'].canvasWidth * 0.9 && g.h >= GEOM['7'].canvasHeight * 0.9;
}
function layout() {
  const g = GEOM[state.panel];
  const avail = Math.max(200, document.documentElement.clientWidth - 20);
  const room = avail >= 900 ? avail - 340 : avail;
  viewScale = Math.max(0.2, Math.min(room / g.canvasWidth, 2));
  screens.forEach(s => {
    s.classList.toggle('sel', s.dataset.screen === state.screen);
    const f = s.querySelector('.frame');
    f.style.width = Math.round(g.canvasWidth * viewScale) + 'px';
    f.style.height = Math.round(g.canvasHeight * viewScale) + 'px';
    const canvas = f.firstElementChild;
    canvas.style.width = g.canvasWidth + 'px';
    canvas.style.height = g.canvasHeight + 'px';
    canvas.style.transform = 'scale(' + viewScale + ')';
    canvas.querySelector('.content').style.transform = 'scale(' + g.scale + ')';
    const band = canvas.querySelector('.band');
    band.style.top = g.contentHeight + 'px';
    band.style.width = g.canvasWidth + 'px';
    band.style.height = g.bandHeight + 'px';
    band.style.display = g.bandHeight > 0 ? 'block' : 'none';
    s.querySelector('.ovl.sel').style.setProperty('--hs', (8 / (viewScale * g.scale)) + 'px');
  });
  document.querySelectorAll('#bar button[data-screen]').forEach(b => b.classList.toggle('on', b.dataset.screen === state.screen));
  document.querySelectorAll('#panels button').forEach(b => b.classList.toggle('on', b.dataset.panel === state.panel));
  document.getElementById('snap').checked = prefs.snap;
  document.getElementById('grid').value = String(prefs.grid);
  document.querySelectorAll('img[data-uri7]').forEach(el => { el.src = state.panel === '12' ? el.dataset.uri12 : el.dataset.uri7; });
  applyView();
  refreshSelection();
  syncInspector(true);
}
// Hidden widgets and z-order are view-only (not saved to .rev): ranks become z-index, overlays stay on top.
function applyView() {
  screens.forEach(sec => {
    const key = sec.dataset.screen;
    const els = [...sec.querySelectorAll('.w')];
    const rank = {};
    PS.paintOrder(state, key, els.map(e => Number(e.dataset.id))).forEach((id, i) => { rank[id] = i + 1; });
    const o = state.order[key];
    let hid = 0;
    els.forEach(el => {
      const id = Number(el.dataset.id);
      const h = PS.isHidden(state, key, id);
      el.style.zIndex = String(rank[id]);
      el.style.display = h ? 'none' : '';
      if (h) hid++;
      const row = rowEl(sec, id);
      if (row) row.classList.toggle('hid', h);
    });
    sec.querySelector('.tools .note').textContent = (hid ? hid + ' hidden. ' : '') + (o ? 'Z-order changed (view only). ' : '') + 'Hide and z-order are view only, not saved to .rev.';
  });
}
function fmt(v) { return v === null || v === undefined ? '' : String(v); }
function secOf(id) { const el = document.querySelector('.w[data-id="' + id + '"]'); return el ? el.closest('.screen') : null; }
function showGeo(id) {
  const sec = secOf(id);
  if (!sec) return;
  const g = GEO[id];
  const r = rowEl(sec, id);
  if (r && g) r.querySelector('td.g').textContent = [g.x, g.y, g.w, g.h].map(v => v === null ? '?' : v).join(',');
  if (sel && sel.id === id) {
    const f = sec.querySelector('.fields');
    f.querySelector('[name=x]').value = fmt(g.x);
    f.querySelector('[name=y]').value = fmt(g.y);
    f.querySelector('[name=w]').value = fmt(g.w);
    f.querySelector('[name=h]').value = fmt(g.h);
    [['x', g.x], ['y', g.y], ['width', g.w], ['height', g.h]].forEach(p => {
      const i = document.querySelector('.insp [data-f="' + p[0] + '"]');
      if (i && p[1] !== null && p[1] !== undefined) i.value = String(p[1]);
    });
  }
}
function setEl(id, g) {
  const sec = secOf(id);
  const el = sec && widgetEl(sec, id);
  if (!el) return;
  GEO[id] = { x: g.x, y: g.y, w: g.w === undefined ? GEO[id].w : g.w, h: g.h === undefined ? GEO[id].h : g.h };
  el.style.left = GEO[id].x + 'px';
  el.style.top = GEO[id].y + 'px';
  if (SIZED[id]) { el.style.width = GEO[id].w + 'px'; el.style.height = GEO[id].h + 'px'; }
  showGeo(id);
  if (sel && sel.id === id) placeOverlay();
}
function placeOverlay() {
  const sec = curSec();
  if (!sec) return;
  const box = sec.querySelector('.ovl.sel');
  const el = sel ? widgetEl(sec, sel.id) : null;
  if (!el || el.style.display === 'none') { box.style.display = 'none'; return; }
  const st = el.style;
  box.style.display = 'block';
  box.style.left = st.left; box.style.top = st.top; box.style.width = st.width; box.style.height = st.height;
  box.classList.toggle('nosize', !SIZED[sel.id]);
}
function refreshSelection() {
  screens.forEach(s => {
    s.querySelectorAll('tr.row.sel').forEach(r => r.classList.remove('sel'));
    if (s !== curSec()) s.querySelector('.ovl.sel').style.display = 'none';
  });
  const sec = curSec();
  if (!sec) return;
  const f = sec.querySelector('.fields');
  if (sel && !widgetEl(sec, sel.id)) sel = null;
  f.querySelectorAll('input').forEach(i => { i.disabled = !sel || (!SIZED[sel.id] && (i.name === 'w' || i.name === 'h')); if (!sel) i.value = ''; });
  f.querySelector('.sel-title').textContent = sel ? '#' + sel.id + ' - ' + (widgetEl(sec, sel.id).dataset.alias || 'no alias') + (SIZED[sel.id] ? '' : ' (position only: this widget type stores no size)') : 'Select a widget: click it, or pick a row.';
  if (sel) { const r = rowEl(sec, sel.id); if (r) r.classList.add('sel'); showGeo(sel.id); }
  placeOverlay();
  syncInspector(false);
}
function select(id, scroll) {
  sel = id === null ? null : { id };
  vscode.postMessage({ type: 'select', id });
  refreshSelection();
  if (sel && scroll) { const r = rowEl(curSec(), id); if (r) r.scrollIntoView({ block: 'nearest' }); }
}
function send(id, patch) { vscode.postMessage(Object.assign({ type: 'edit', id }, patch)); }
// Pointer drag: deltas are converted back to authored 7" pixels, so the 12" view edits the same numbers.
function beginDrag(e, id, mode) {
  if (e.button !== 0) return;
  const g = GEO[id];
  drag = { id, mode, sx: e.clientX, sy: e.clientY, start: { x: g.x, y: g.y, w: g.w, h: g.h }, moved: false, target: e.currentTarget, pid: e.pointerId };
  try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* not captured: window listeners still work */ }
  e.preventDefault();
  e.stopPropagation();
}
function currentGeo(e) {
  const k = GEOM[state.panel].scale;
  const dx = EM.toAuthored(e.clientX - drag.sx, viewScale, k);
  const dy = EM.toAuthored(e.clientY - drag.sy, viewScale, k);
  const r = { x: drag.start.x, y: drag.start.y, w: drag.start.w || 0, h: drag.start.h || 0 };
  return drag.mode === 'move' ? Object.assign({}, EM.move(r, dx, dy, gridNow()), { w: drag.start.w, h: drag.start.h }) : EM.resize(r, drag.mode, dx, dy, gridNow());
}
window.addEventListener('pointermove', e => {
  if (!drag) return;
  if (!drag.moved && Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) < 3) return;
  drag.moved = true;
  setEl(drag.id, currentGeo(e));
});
function endDrag(e, cancel) {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (!d.moved) return;
  if (cancel) { setEl(d.id, d.start); return; }
  const g = GEO[d.id];
  const patch = {};
  if (g.x !== d.start.x) patch.x = g.x;
  if (g.y !== d.start.y) patch.y = g.y;
  if (SIZED[d.id] && g.w !== d.start.w) patch.w = g.w;
  if (SIZED[d.id] && g.h !== d.start.h) patch.h = g.h;
  if (Object.keys(patch).length) send(d.id, patch);
}
window.addEventListener('pointerup', e => endDrag(e, false));
window.addEventListener('pointercancel', e => endDrag(e, true));
screens.forEach(sec => {
  sec.querySelectorAll('.w').forEach(el => {
    const id = Number(el.dataset.id);
    if (GEO[id].x === null || GEO[id].y === null) { el.classList.add('fixed'); return; }
    if (isBackdrop(id)) { el.classList.add('fixed'); el.title = 'Backdrop: select it here, move or resize it with the fields or the arrow keys'; }
    el.addEventListener('pointerdown', e => { select(id, true); if (!isBackdrop(id)) beginDrag(e, id, 'move'); else { e.preventDefault(); } });
  });
  sec.querySelectorAll('.ovl.sel .h').forEach(h => h.addEventListener('pointerdown', e => { if (sel && SIZED[sel.id]) beginDrag(e, sel.id, h.dataset.h); }));
  sec.querySelectorAll('tr.row').forEach(r => r.addEventListener('click', ev => { if (!ev.target.closest('button')) select(Number(r.dataset.id), false); }));
  sec.querySelector('.canvas').addEventListener('pointerdown', e => { if (e.target === e.currentTarget || e.target.classList.contains('content') || e.target.classList.contains('band')) select(null); });
  sec.querySelectorAll('.fields input').forEach(inp => inp.addEventListener('change', () => {
    if (!sel) return;
    const v = Number(inp.value);
    if (!Number.isFinite(v) || inp.value.trim() === '') { showGeo(sel.id); return; }
    const patch = {}; patch[inp.name] = v;
    send(sel.id, patch);
  }));
});
document.addEventListener('keydown', e => {
  if (drag && e.key === 'Escape') { endDrag(e, true); return; }
  const t = e.target;
  if (!sel || (t && t.closest && t.closest('input,textarea,button,select')) || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Delete') { e.preventDefault(); vscode.postMessage({ type: 'delete', id: sel.id }); return; }
  const g = GEO[sel.id];
  if (g.x === null || g.y === null) return;
  const n = EM.nudge({ x: g.x, y: g.y, w: g.w || 0, h: g.h || 0 }, e.key, e.shiftKey, prefs.grid);
  if (!n) return;
  e.preventDefault();
  setEl(sel.id, n);
  send(sel.id, { x: n.x, y: n.y });
});
document.querySelectorAll('#bar button[data-screen]').forEach(b => b.addEventListener('click', () => { sel = null; state = { ...state, screen: b.dataset.screen }; saveView(); }));
document.querySelectorAll('#panels button').forEach(b => b.addEventListener('click', () => { state = { ...state, panel: b.dataset.panel }; saveView(); }));
document.getElementById('snap').addEventListener('change', e => { prefs = { ...prefs, snap: e.target.checked }; savePrefs(); });
document.getElementById('grid').addEventListener('change', e => {
  const g = Number(e.target.value);
  prefs = { ...prefs, grid: Number.isInteger(g) && g >= 1 && g <= 200 ? g : prefs.grid };
  savePrefs();
  e.target.value = String(prefs.grid);
});
document.addEventListener('click', e => {
  const btn = e.target && e.target.closest ? e.target.closest('button[data-act]') : null;
  if (!btn) return;
  const sec = btn.closest('.screen');
  const key = sec.dataset.screen;
  const row = btn.closest('tr.row');
  const id = row ? Number(row.dataset.id) : 0;
  const natural = [...sec.querySelectorAll('.w')].map(el => Number(el.dataset.id));
  const act = btn.dataset.act;
  if (act === 'eye') state = PS.toggleHidden(state, key, id);
  else if (act === 'front') state = PS.bringToFront(state, key, id);
  else if (act === 'back') state = PS.sendToBack(state, key, id);
  else if (act === 'forward') state = PS.stepForward(state, key, id, natural);
  else if (act === 'backward') state = PS.stepBack(state, key, id, natural);
  else if (act === 'showall') state = PS.showAll(state, key);
  else if (act === 'resetorder') state = PS.resetOrder(state, key);
  saveView();
});
// Authoritative geometry from the extension: after every edit, undo, redo and revert.
window.addEventListener('message', ev => {
  const m = ev.data;
  if (!m || m.type !== 'sync' || !m.geom) return;
  Object.keys(m.geom).forEach(k => {
    const id = Number(k);
    const g = m.geom[k];
    if (GEO[id] && g && Number.isFinite(g.x) && Number.isFinite(g.y)) setEl(id, { x: g.x, y: g.y, w: g.width, h: g.height });
  });
  Object.keys(m.geom).forEach(k => {
    const sec = secOf(Number(k));
    const r = sec && rowEl(sec, Number(k));
    if (r) r.classList.toggle('edited', !!m.edited && m.edited.indexOf(Number(k)) >= 0);
  });
});
// Property inspector: typed inputs from the catalog; the extension validates and applies every change.
let inspFor;
function mk(tag, attrs, text) {
  const n = document.createElement(tag);
  Object.keys(attrs || {}).forEach(k => n.setAttribute(k, attrs[k]));
  if (text !== undefined) n.textContent = text;
  return n;
}
function extraOf(def, tokens) { return (def.type === 4 || def.type === 11) && tokens.length > def.tokenCount ? tokens.length - def.tokenCount : 0; }
function valueOf(def, tokens, f) {
  const extra = extraOf(def, tokens);
  if (extra && f.index === 5) return tokens.slice(5, 6 + extra).join(',');
  const v = tokens[f.index > 5 ? f.index + extra : f.index];
  return v === undefined ? '' : v;
}
function sendProp(id, f, raw) {
  if (f.kind === 'int' || f.kind === 'enum') {
    if (String(raw).trim() === '' || !Number.isFinite(Number(raw))) { syncInspector(true); return; }
    vscode.postMessage({ type: 'setProp', id, field: f.name, value: Number(raw) });
  } else vscode.postMessage({ type: 'setProp', id, field: f.name, value: String(raw) });
}
function fieldControl(id, def, f, val) {
  const attrs = { 'data-f': f.name };
  if (f.kind === 'enum' && f.values) {
    const s = mk('select', attrs);
    let hit = false;
    f.values.forEach(v => { const o = mk('option', { value: String(v.value) }, v.value + ' - ' + v.label); if (String(v.value) === val) { o.selected = true; hit = true; } s.appendChild(o); });
    if (!hit) { const o = mk('option', { value: val }, val + ' (raw)'); o.selected = true; s.appendChild(o); }
    s.addEventListener('change', () => sendProp(id, f, s.value));
    return [s];
  }
  if (f.kind === 'int') {
    const a = Object.assign({ type: 'number', step: '1' }, attrs);
    if (f.role !== 'x' && f.role !== 'y' && f.min !== undefined) a.min = String(f.min);
    if (f.max !== undefined) a.max = String(f.max);
    const i = mk('input', a); i.value = val;
    i.addEventListener('change', () => sendProp(id, f, i.value));
    return [i];
  }
  if (f.kind === 'color') {
    const t = mk('input', Object.assign({ type: 'text', list: 'colornames' }, attrs)); t.value = val;
    const c = mk('input', { type: 'color', title: 'Pick a color' });
    c.value = /^#[0-9a-fA-F]{6}$/.test(val) ? val.toLowerCase() : '#000000';
    t.addEventListener('change', () => sendProp(id, f, t.value));
    c.addEventListener('change', () => { t.value = c.value.toUpperCase(); sendProp(id, f, t.value); });
    return [t, c];
  }
  const a = Object.assign({ type: 'text' }, attrs);
  if (f.maxLength) a.maxlength = String(f.maxLength);
  if (f.kind === 'image') a.list = 'sdimages';
  const i = mk('input', a); i.value = val;
  i.addEventListener('change', () => sendProp(id, f, i.value));
  if (def.type === 7 && f.kind === 'image') {
    const wrap = mk('div', {}); wrap.appendChild(i);
    const gallery = mk('div', { class: 'gallery' });
    const items = GALLERY.builtin.concat(GALLERY.files);
    items.forEach(item => {
      const b = mk('button', { type: 'button', title: item.value });
      const uri = item.n ? (state.panel === '12' ? item.uri12 : item.uri7) : item.uri;
      if (uri) b.appendChild(mk('img', { src: uri, alt: '' }));
      b.appendChild(mk('span', {}, item.n ? '#' + item.n : item.value));
      b.addEventListener('click', () => sendProp(id, f, item.value));
      gallery.appendChild(b);
    });
    wrap.appendChild(gallery);
    if (GALLERY.hint) wrap.appendChild(mk('div', { class: 'ro' }, GALLERY.hint));
    return [wrap];
  }
  return [i];
}
function syncInspector(force) {
  const id = sel ? sel.id : null;
  if (!force && id === inspFor) return;
  inspFor = id;
  document.querySelectorAll('.insp').forEach(n => n.replaceChildren());
  const sec = curSec();
  const info = id === null ? null : PROPS[id];
  if (!sec || !info) return;
  const box = sec.querySelector('.insp');
  const def = CAT[info.type];
  box.appendChild(mk('div', { class: 'sel-title' }, 'Properties of #' + id + (def ? ' - ' + def.name : ' - unknown type ' + info.type)));
  if (!def) {
    box.appendChild(mk('div', { class: 'ro' }, 'Raw tokens (read only): ' + info.tokens.join(',')));
  } else {
    def.fields.forEach(f => {
      if (f.index === 0) return;
      const val = valueOf(def, info.tokens, f);
      const row = mk('div', { class: 'row' });
      row.appendChild(mk('label', {}, f.name));
      if (f.kind === 'alias' && !def.aliasPersisted) { row.appendChild(mk('span', { class: 'ro' }, 'not stored in the .rev')); box.appendChild(row); return; }
      if (!f.editable || f.kind === 'screen') { row.appendChild(mk('span', { class: 'ro' }, val + ' (fixed)')); box.appendChild(row); return; }
      if (f.kind === 'alias') {
        const i = mk('input', { type: 'text', maxlength: '8', 'data-f': 'alias' }); i.value = val;
        i.addEventListener('change', () => vscode.postMessage({ type: 'renameAlias', id, alias: i.value }));
        row.appendChild(i);
      } else fieldControl(id, def, f, val).forEach(n => row.appendChild(n));
      box.appendChild(row);
    });
    if (!def.hasAlias) box.appendChild(mk('div', { class: 'ro' }, 'This widget type has no alias.'));
    else if (!def.aliasPersisted) box.appendChild(mk('div', { class: 'ro' }, 'Its alias (' + def.aliasPrefix + id + ') is derived from the id and is not stored in the .rev, but it appears in main.iri.'));
  }
  const del = mk('button', { 'data-act2': 'delete', title: 'Delete this widget (Delete key)' }, 'Delete widget');
  del.addEventListener('click', () => vscode.postMessage({ type: 'delete', id }));
  const refs = mk('button', { title: 'Show where code uses this widget alias' }, 'Show code references');
  refs.addEventListener('click', () => vscode.postMessage({ type: 'requestRefs', id }));
  const bar = mk('div', {}); bar.appendChild(del); bar.appendChild(refs); box.appendChild(bar);
}
// Palette: drag an item onto the canvas (drop point in authored 7" pixels, snapped) or click it to add near the corner.
let dragType = null;
function screenNo() { const n = Number(state.screen); return Number.isInteger(n) && n >= 1 && n <= 99 ? n : 1; }
document.querySelectorAll('#palette button[data-wtype]').forEach(b => {
  b.addEventListener('dragstart', e => { dragType = Number(b.dataset.wtype); if (e.dataTransfer) { e.dataTransfer.setData('text/plain', 'irite-widget:' + dragType); e.dataTransfer.effectAllowed = 'copy'; } });
  b.addEventListener('dragend', () => { dragType = null; });
  b.addEventListener('click', () => vscode.postMessage({ type: 'add', widgetType: Number(b.dataset.wtype), x: EM.snap(24, gridNow()), y: EM.snap(24, gridNow()), screen: screenNo() }));
});
document.querySelectorAll('.frame').forEach(fr => {
  fr.addEventListener('dragover', e => { if (dragType !== null) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; } });
  fr.addEventListener('drop', e => {
    if (dragType === null) return;
    e.preventDefault();
    const c = fr.querySelector('.content');
    const r = c.getBoundingClientRect();
    const k = r.width / c.offsetWidth;
    const t = dragType;
    dragType = null;
    vscode.postMessage({ type: 'add', widgetType: t, x: EM.snap((e.clientX - r.left) / k, gridNow()), y: EM.snap((e.clientY - r.top) / k, gridNow()), screen: screenNo() });
  });
});
function showRefs(m) {
  const box = document.getElementById('refs');
  box.replaceChildren();
  if (!m.alias) { box.hidden = true; return; }
  box.hidden = false;
  box.appendChild(mk('strong', {}, 'Code references of ' + m.alias + ': ' + m.total));
  if (!m.total) box.appendChild(mk('div', {}, 'No uses found in the iRite sources of this project.'));
  (m.groups || []).forEach(g => {
    const lines = [g.label + ' (' + g.count + ')'];
    g.routines.forEach(r => r.sites.forEach(s => lines.push('  ' + r.routine + ' line ' + s.line + ': ' + s.callee)));
    box.appendChild(mk('pre', {}, lines.join(String.fromCharCode(10))));
  });
}
// Authoritative notices from the extension: rejected edits (the inspector goes back to the real values) and references.
window.addEventListener('message', ev => {
  const m = ev.data;
  if (!m) return;
  if (m.type === 'notice') { document.getElementById('notice').textContent = String(m.text || ''); syncInspector(true); }
  else if (m.type === 'refs') showRefs(m);
});
window.addEventListener('resize', layout);
layout();
`;

function renderRow(w: ScreenView["widgets"][number]): string {
	const geo = [w.x, w.y, w.width, w.height].map((n) => (n === undefined ? "?" : String(n))).join(",");
	const btns =
		`<button data-act="eye" title="Hide / show (view only, not saved)">eye</button>` +
		`<button data-act="front" title="Bring to front (view only, not saved)">&#9650;&#9650;</button>` +
		`<button data-act="forward" title="One step forward (view only, not saved)">&#9650;</button>` +
		`<button data-act="backward" title="One step back (view only, not saved)">&#9660;</button>` +
		`<button data-act="back" title="Send to back (view only, not saved)">&#9660;&#9660;</button>`;
	return `<tr class="row" data-id="${w.id}"><td class="ctl">${btns}</td><td class="n">${w.id}</td><td>${escapeHtml(w.typeName)} (${w.type})</td><td>${escapeHtml(w.alias ?? "")}</td><td class="g">${geo}</td></tr>`;
}

function renderScreen(s: ScreenView, opts: EditorRenderOptions): string {
	const rows = s.widgets.map(renderRow).join("");
	const handles = HANDLES.map((h) => `<i class="h" data-h="${h}"></i>`).join("");
	const widgets = s.widgets
		.map((w) => {
			let html = renderWidget(w, opts);
			const ref = w.type === 7 && w.image ? resolveImage(w.image, "") : undefined;
			if (ref?.kind === "builtin") {
				const seven = opts.builtinUri?.(ref.id, "7");
				const twelve = opts.builtinUri?.(ref.id, "12");
				if (seven && twelve) {
					html = html.replace(/^<div class="w placeholder"/, `<img class="w" data-uri7="${escapeHtml(seven)}" data-uri12="${escapeHtml(twelve)}" src="${escapeHtml(seven)}" alt=""`).replace(/>[^<]*<\/div>$/, ">");
				} else {
					html = html.replace(/^<div /, `<div title="${BUILTIN_IMAGE_HINT}" `);
				}
			}
			return html.replace(/^<(\w+) /, (m, tag: string) => `<${tag} data-alias="${escapeHtml(w.alias ?? "")}" `);
		})
		.join("");
	const field = (n: string, label: string): string => `<label>${label}<input type="number" step="1" name="${n}" disabled></label>`;
	return (
		`<section class="screen" data-screen="${s.number}"><h3>${escapeHtml(screenTitle(s))}</h3>` +
		`<div class="body"><div class="left"><div class="frame"><div class="canvas"><div class="content">${widgets}` +
		`<div class="ovl sel">${handles}</div></div><div class="band"></div></div></div>` +
		`<div class="fields"><div class="sel-title muted">Select a widget: click it, or pick a row.</div>${field("x", "x")}${field("y", "y")}${field("w", "w")}${field("h", "h")}</div></div>` +
		`<aside class="side"><div class="insp"></div><div class="tools"><button data-act="showall" title="Show every hidden widget of this screen">Show all</button><button data-act="resetorder" title="Restore the paint order of this screen">Reset order</button><span class="note muted"></span></div>` +
		`<table class="wlist"><thead><tr><th></th><th>Id</th><th>Type</th><th>Alias</th><th>x,y,w,h</th></tr></thead><tbody>${rows}</tbody></table></aside></div></section>`
	);
}

function renderPalette(): string {
	const items = paletteTypes()
		.map((t) => `<button type="button" draggable="true" data-wtype="${t.type}" title="Drag onto the canvas, or click to add near the top left corner. ${escapeHtml(t.versionNote)}">${escapeHtml(t.name)}</button>`)
		.join("");
	return `<div id="palette"><strong>Add widget:</strong>${items}<span class="legacy">The Numeric widget (type 5, legacy 920i) is not offered: Revolution converts it into a Label on load.</span></div>`;
}

function renderHint(h: IriHint | undefined): string {
	if (!h || h.add.length + h.change.length + h.remove.length === 0) {
		return "";
	}
	const lines = [
		...h.add.map((l) => `+ ${l}`),
		...h.change.flatMap((c) => [`- ${c.old}`, `+ ${c.new}`]),
		...h.remove.map((l) => `- ${l}`),
	];
	return `<div id="irihint"><strong>main.iri</strong> (never edited while you edit; run "iRite: Regenerate main.iri from .rev" after saving). In the "-- Widget Aliases" block: + add / - remove or replace.<pre>${escapeHtml(lines.join("\n"))}</pre></div>`;
}

function catalogForPage(): Record<number, unknown> {
	const out: Record<number, unknown> = {};
	for (const t of WIDGET_TYPES) {
		out[t.type] = {
			type: t.type,
			name: t.name,
			tokenCount: t.tokenCount,
			hasAlias: t.hasAlias,
			aliasPersisted: t.aliasPersisted,
			aliasPrefix: t.aliasPrefix ?? null,
			fields: t.fields.map((f) => ({ index: f.index, name: f.name, kind: f.kind, role: f.role ?? null, min: f.min ?? null, max: f.max ?? null, maxLength: f.maxLength ?? null, editable: f.editable, values: f.values ?? null })),
		};
	}
	return out;
}

export function renderEditorHtml(view: ScreensView, opts: EditorRenderOptions): string {
	const csp = [
		"default-src 'none'",
		`img-src ${opts.cspSource}`,
		`style-src ${opts.cspSource} 'unsafe-inline'`,
		`script-src 'nonce-${opts.nonce}'`,
	].join("; ");
	const buttons = view.screens
		.map((s) => `<button data-screen="${s.number}">Screen ${s.number}${s.names.length ? " " + escapeHtml(s.names.join("/")) : ""} (${s.widgets.length})</button>`)
		.join("");
	const panelButtons = (Object.keys(PANELS) as PanelId[])
		.map((id) => `<button data-panel="${id}" title="View size only: widgets are always edited in 7 inch coordinates">${escapeHtml(PANELS[id].label)}</button>`)
		.join("");
	const empty = view.screens.length ? "" : `<p>No widgets with a screen number were found in this .rev.</p>`;
	const sections = view.screens.map((sc) => renderScreen(sc, opts)).join("\n");
	const props: Record<number, { type: number; tokens: string[] }> = {};
	for (const sc of view.screens) {
		for (const w of sc.widgets) {
			props[w.id] = { type: w.type, tokens: w.tokens };
		}
	}
	const grid = Number.isInteger(opts.prefs.grid) && opts.prefs.grid >= 1 && opts.prefs.grid <= 200 ? opts.prefs.grid : DEFAULT_GRID;
	return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(opts.title)}</title>
<style>${STYLE}</style></head>
<body class="single">
<div id="bar">${buttons}<span id="panels">${panelButtons}</span><label><input type="checkbox" id="snap"> Snap</label><label>Grid <input type="number" id="grid" min="1" max="200" step="1"></label></div>
<p id="hint">Drag a widget or use the arrow keys (Shift: one grid step); drag the handles to resize; Delete removes the selected widget. Always edited in 7 inch pixels. Undo and redo are the standard VS Code commands. Saving rewrites only the edited, added or removed WDGT lines and recomputes the ConfigHash.</p>
${renderPalette()}
<div id="notice" role="status"></div>
<div id="refs" hidden></div>
${renderHint(opts.hint)}
<datalist id="sdimages">${(opts.images ?? []).map((i) => `<option value="${escapeHtml(i)}">`).join("")}</datalist>
<datalist id="colornames">${["Black", "White", "Silver", "Gray", "Red", "Green", "Blue", "Yellow", "Orange"].map((c) => `<option value="${c}">`).join("")}</datalist>
${empty}<div id="screens">
${sections}
</div>
<script nonce="${opts.nonce}">${SCRIPT.replace("__GEOM__", () => JSON.stringify(allGeometries()))
		.replace("__PS__", () => PREVIEW_STATE_SOURCE)
		.replace("__EM__", () => EDITOR_MATH_SOURCE)
		.replace("__INIT__", () => jsonForScript(previewState.sanitize(opts.initialState)))
		.replace("__PREFS__", () => jsonForScript({ snap: !!opts.prefs.snap, grid }))
		.replace("__CAT__", () => jsonForScript(catalogForPage()))
		.replace("__PROPS__", () => jsonForScript(props))
		.replace("__GALLERY__", () => jsonForScript(opts.gallery ?? { builtin: [], files: [], hint: BUILTIN_IMAGE_HINT }))
		.replace("__INITSEL__", () => jsonForScript(typeof opts.selected === "number" ? opts.selected : null))}</script>
</body></html>`;
}
