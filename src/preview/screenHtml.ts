/** Pure HTML renderer for the screen preview webview (no `vscode` import). */
import { resolveImage } from "../rev";
import { BUILTIN_IMAGE_HINT } from "../firmware/imageCache";
import { PANELS, allGeometries, panelGeometry } from "./panels";
import type { PanelId } from "./panels";
import type { ScreenView, ScreensView, WidgetView } from "./screenModel";
import { PREVIEW_STATE_SOURCE, previewState } from "./previewState";
import { entryLabel, buildWidgetRows, screenTitle } from "./widgetList";

/** Usable area of the authored 7" panel in pixels (800x480 minus the 92 px header; see `panels.ts`). */
export const CANVAS_WIDTH = panelGeometry("7").canvasWidth;
export const CANVAS_HEIGHT = panelGeometry("7").canvasHeight;
const BAND_TIP =
	'Letterbox band (assumption): scaling a 7" layout uniformly by 1.6 leaves this strip unused on a 12" panel. ' +
	"The header height and the band position are unconfirmed on a real 12\" unit.";
const SAMPLE_WEIGHT = "888888.1";
const EYE_BTN =
	'<button data-act="eye" title="Hide / show this widget (preview only, not saved)" aria-label="Hide or show widget">' +
	'<svg viewBox="0 0 16 16"><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" fill="none" stroke="currentColor"/>' +
	'<circle cx="8" cy="8" r="2" fill="currentColor"/><path class="slash" d="M2 14L14 2" stroke="currentColor" stroke-width="1.5"/></svg></button>';

export interface RenderOptions {
	cspSource: string;
	nonce: string;
	/** Project-relative path (e.g. `sdimages/a.png`) → webview URI, or undefined when the file is missing. */
	imageUri: (relPath: string) => string | undefined;
	builtinUri?: (id: string, panel: PanelId) => string | undefined;
	title: string;
	/** Preview-only state to restore (screen, panel, hidden widgets, z-order); sanitized before use. */
	initialState?: unknown;
}

/** JSON safe to embed inside an inline script. */
function jsonForScript(v: unknown): string {
	return JSON.stringify(v).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

export function escapeHtml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function px(n: number | undefined, fallback: number): number {
	return typeof n === "number" && Number.isFinite(n) ? Math.round(n) : fallback;
}

/** Only plain CSS color names and #hex pass; anything else falls back. */
function color(c: string | undefined, fallback: string): string {
	const v = (c ?? "").trim();
	return /^#[0-9a-fA-F]{3,8}$/.test(v) || /^[A-Za-z]{3,20}$/.test(v) ? v : fallback;
}

export function renderWidget(w: WidgetView, opts: RenderOptions): string {
	const x = px(w.x, 0);
	const y = px(w.y, 0);
	let width = w.width;
	let height = w.height;
	let extra = "";
	let cls = "w";
	let inner = "";
	let tag = "div";
	let attrs = "";
	switch (w.typeName) {
		case "image": {
			const res = w.image ? resolveImage(w.image, "") : undefined;
			const uri = res && res.kind === "file" ? opts.imageUri(res.relPath) : undefined;
			if (uri) {
				tag = "img";
				attrs = ` src="${escapeHtml(uri)}" alt=""`;
			} else {
				cls += " placeholder";
				inner = escapeHtml(w.image ?? "(no image)");
			}
			break;
		}
		case "label":
		case "monolabel":
		case "numeric":
			cls += w.typeName === "monolabel" ? " label mono" : " label";
			extra = `font-size:${px(w.fontSize, 12)}px;color:${color(w.color, "Black")};`;
			inner = escapeHtml(w.text ?? (w.typeName === "numeric" ? "123.4" : ""));
			break;
		case "bitmap":
			cls += " bitmap";
			inner = "&#9660;";
			break;
		case "chart":
			cls += " chart";
			inner = "&#8767;";
			break;
		case "softkey":
			cls += " softkey";
			width = width ?? 800;
			height = height ?? 70;
			extra = `color:${color(w.foreground, "#393939")};background:${color(w.background, "#F0EEEE")};`;
			inner = "F1 F2 F3 F4 F5";
			break;
		case "line":
			cls += " line";
			extra = `background:${color(w.color, "Black")};`;
			break;
		case "scale":
			cls += " scale";
			width = width ?? 220;
			height = height ?? 60;
			extra = `color:${color(w.foreground, "Black")};background:${color(w.background, "White")};font-size:${Math.round(height * 0.7)}px;`;
			inner = SAMPLE_WEIGHT;
			break;
		case "bargraph":
			cls += " bargraph";
			extra = `border-color:${color(w.color, "Black")};`;
			break;
		case "symbol":
			cls += " symbol";
			width = width ?? 24;
			height = height ?? 24;
			break;
		default:
			cls += " unknown";
			width = width ?? 24;
			height = height ?? 24;
	}
	const info = {
		id: w.id,
		type: w.type,
		typeName: w.typeName,
		alias: w.alias ?? null,
		x: w.x ?? null,
		y: w.y ?? null,
		w: w.width ?? null,
		h: w.height ?? null,
		raw: w.raw,
		count: w.references.length,
		groups: w.refGroups,
	};
	const style = `left:${x}px;top:${y}px;width:${px(width, 0)}px;height:${px(height, 0)}px;${extra}`;
	const open = `<${tag} class="${cls}" data-id="${w.id}" style="${style}" data-info="${escapeHtml(JSON.stringify(info))}"${attrs}`;
	return tag === "img" ? `${open}>` : `${open}>${inner}</${tag}>`;
}

/** Visual rules of the widget boxes, shared by the preview and the editor so both paint identically. */
export const WIDGET_STYLE = `
.w{position:absolute;box-sizing:border-box;overflow:hidden;cursor:pointer;}
.label{white-space:nowrap;text-overflow:ellipsis;}
.mono{font-family:monospace;}
.line{min-height:1px;}
.bitmap{border:1px solid #666;background:#f4f4f4;color:#666;display:flex;align-items:center;justify-content:center;}
.chart{border:1px solid #666;background:#fff;color:#888;font-size:28px;display:flex;align-items:center;justify-content:center;}
.softkey{border:1px solid #999;display:flex;align-items:center;justify-content:space-around;font-size:14px;}
.scale{display:flex;align-items:center;justify-content:center;font-family:monospace;}
.bargraph{border:2px solid #000;}
.symbol{border:2px solid #888;border-radius:50%;}
.placeholder{border:1px dashed #888;background:#eee;color:#555;font-size:11px;word-break:break-all;}
.unknown{background:repeating-linear-gradient(45deg,#ccc,#ccc 4px,#eee 4px,#eee 8px);border:1px solid #999;}
`;

const STYLE = `
body{margin:0;padding:8px;font-family:var(--vscode-font-family,sans-serif);color:var(--vscode-foreground);}
#bar{display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-bottom:8px;}
#bar button{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:1px solid var(--vscode-panel-border,#666);padding:2px 8px;cursor:pointer;}
#bar button.on{background:var(--vscode-button-background);color:var(--vscode-button-foreground);}
#diag{margin-left:auto;opacity:.8;}
#screens{display:flex;flex-wrap:wrap;gap:12px;}
body.single .screen{display:none;width:100%;}
body.single .screen.sel{display:block;}
.screen h3{margin:0 0 4px;font-size:12px;font-weight:normal;}
.frame{position:relative;overflow:hidden;border:1px solid var(--vscode-panel-border,#666);}
.canvas{position:absolute;left:0;top:0;width:${CANVAS_WIDTH}px;height:${CANVAS_HEIGHT}px;background:#fff;transform-origin:0 0;}
.content{position:absolute;left:0;top:0;width:${CANVAS_WIDTH}px;height:${CANVAS_HEIGHT}px;transform-origin:0 0;}
.band{position:absolute;left:0;display:none;background:repeating-linear-gradient(45deg,#e8e8e8,#e8e8e8 6px,#f6f6f6 6px,#f6f6f6 12px);border-top:1px dashed #999;box-sizing:border-box;}
#panels{display:inline-flex;gap:4px;margin-left:8px;}
${WIDGET_STYLE}
.ovl{position:absolute;box-sizing:border-box;pointer-events:none;display:none;outline:2px solid #e91e63;z-index:1000000;}
.ovl.hov{outline-style:dashed;outline-width:1px;}
.entry{margin:0 0 6px;font-size:12px;}
.entry a,.insp a{color:var(--vscode-textLink-foreground);cursor:pointer;}
.muted{opacity:.7;}
.body{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start;}
.left{flex:0 0 auto;}
.side{flex:1 1 300px;min-width:280px;max-height:560px;overflow:auto;}
body:not(.single) .side,body:not(.single) .insp,body:not(.single) .entry{display:none;}
.wlist{width:100%;border-collapse:collapse;font-size:11px;}
.wlist th{text-align:left;position:sticky;top:0;background:var(--vscode-editor-background,#1e1e1e);font-weight:600;}
.wlist td,.wlist th{padding:2px 6px;white-space:nowrap;}
.wlist tr.row{cursor:pointer;}
.wlist tr.row:hover{background:var(--vscode-list-hoverBackground,#2a2d2e);}
.wlist tr.row.sel{background:var(--vscode-list-activeSelectionBackground,#094771);color:var(--vscode-list-activeSelectionForeground,#fff);}
.wlist td.r,.wlist td.n{text-align:right;}
.wlist td.ctl{white-space:nowrap;}
.wlist button,.tools button{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:1px solid var(--vscode-panel-border,#666);padding:0 5px;margin-right:2px;cursor:pointer;font-size:10px;line-height:16px;}
.wlist button svg{width:12px;height:12px;vertical-align:middle;}
.wlist .slash{display:none;}
.wlist tr.hid .slash{display:inline;}
.wlist tr.hid td:not(.ctl){opacity:.45;text-decoration:line-through;}
.wlist tr.zf button[data-act=front],.wlist tr.zb button[data-act=back]{background:var(--vscode-button-background);color:var(--vscode-button-foreground);}
.tools{margin:0 0 4px;display:flex;flex-wrap:wrap;gap:4px;align-items:center;font-size:11px;}
.insp{margin-top:8px;padding:6px;border:1px solid var(--vscode-panel-border,#666);font-size:12px;min-height:3em;max-width:100%;}
.insp .t{font-weight:600;}
.insp .grp{margin-top:6px;font-weight:600;}
.insp .rt{margin-left:8px;opacity:.85;}
.insp a.site{display:block;margin-left:20px;}
.insp code{white-space:pre-wrap;word-break:break-all;}
`;

const SCRIPT = `
const vscode = typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : { postMessage() {}, getState() { return undefined; }, setState() {} };
const GEOM = __GEOM__;
const PS = __PS__;
const INIT = __INIT__;
// Preview-only state: kept by the webview (setState) and reported to the extension; never written to .rev.
let state = PS.sanitize(vscode.getState() || INIT);
const body = document.body;
function layout() {
  const single = state.screen !== 'all';
  body.classList.toggle('single', single);
  const g = GEOM[state.panel];
  const avail = Math.max(200, document.documentElement.clientWidth - 20);
  // Thumbnails keep the same width on both panels; the single view fits the window (never above 2x).
  const room = single && avail >= 900 ? avail - 340 : avail;
  const scale = single ? Math.min(room / g.canvasWidth, 2) : Math.min(320 / g.canvasWidth, avail / g.canvasWidth);
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.toggle('sel', s.dataset.screen === state.screen);
    const f = s.querySelector('.frame');
    f.style.width = Math.round(g.canvasWidth * scale) + 'px';
    f.style.height = Math.round(g.canvasHeight * scale) + 'px';
    const canvas = f.firstElementChild;
    canvas.style.width = g.canvasWidth + 'px';
    canvas.style.height = g.canvasHeight + 'px';
    canvas.style.transform = 'scale(' + scale + ')';
    const content = canvas.querySelector('.content');
    content.style.transform = 'scale(' + g.scale + ')';
    const band = canvas.querySelector('.band');
    band.style.top = g.contentHeight + 'px';
    band.style.width = g.canvasWidth + 'px';
    band.style.height = g.bandHeight + 'px';
    band.style.display = g.bandHeight > 0 ? 'block' : 'none';
  });
  document.querySelectorAll('img[data-uri7][data-uri12]').forEach(el => { el.src = state.panel === '12' ? el.dataset.uri12 : el.dataset.uri7; });
  document.querySelectorAll('#bar button[data-screen]').forEach(b => b.classList.toggle('on', b.dataset.screen === state.screen));
  document.querySelectorAll('#panels button').forEach(b => b.classList.toggle('on', b.dataset.panel === state.panel));
  applyView();
}
// Hidden widgets and z-order overrides, per screen. Paint order = z-index rank; overlays stay above all ranks.
function applyView() {
  document.querySelectorAll('.screen').forEach(sec => {
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
      const row = sec.querySelector('tr.row[data-id="' + id + '"]');
      if (row) {
        row.classList.toggle('hid', h);
        row.classList.toggle('zf', !!o && o.front.includes(id));
        row.classList.toggle('zb', !!o && o.back.includes(id));
      }
    });
    sec.querySelector('.tools .note').textContent = (hid ? hid + ' hidden. ' : '') + (o ? 'Z-order overridden. ' : '') + 'Preview only, not saved to .rev.';
    if (sel && sel.sec === sec) {
      const el = widgetEl(sec, sel.id);
      place(sec.querySelector('.ovl.sel'), el);
    }
  });
}
function save() { vscode.setState(state); vscode.postMessage({ type: 'state', state }); layout(); }
function select(s) { state = { ...state, screen: s }; save(); }
document.querySelectorAll('#bar button[data-screen]').forEach(b => b.addEventListener('click', () => select(b.dataset.screen)));
document.querySelectorAll('#panels button').forEach(b => b.addEventListener('click', () => { state = { ...state, panel: b.dataset.panel }; save(); }));
document.querySelectorAll('.screen h3').forEach(h => h.addEventListener('click', () => select(h.parentElement.dataset.screen)));
let sel = null;
function widgetEl(sec, id) { return sec.querySelector('.w[data-id="' + id + '"]'); }
function rowEl(sec, id) { return sec.querySelector('tr.row[data-id="' + id + '"]'); }
// Hover/selection are separate overlay boxes: they never change a widget's paint order.
function place(box, el) {
  if (!el || el.style.display === 'none') { box.style.display = 'none'; return; }
  const st = el.style;
  box.style.cssText = 'display:block;left:' + st.left + ';top:' + st.top + ';width:' + st.width + ';height:' + st.height + ';';
}
function fmt(n, k) { return n === null || n === undefined ? '?' : String(Math.round(n * k * 10) / 10); }
function show(sec, el) {
  const i = JSON.parse(el.dataset.info);
  const box = sec.querySelector('.insp');
  box.textContent = '';
  const add = (cls, t) => { const d = document.createElement('div'); if (cls) d.className = cls; d.textContent = t; box.appendChild(d); return d; };
  add('t', '#' + i.id + ' - ' + i.typeName + ' (type ' + i.type + ')' + (i.alias ? ' - ' + i.alias : ''));
  add('', 'x=' + fmt(i.x, 1) + ' y=' + fmt(i.y, 1) + ' w=' + fmt(i.w, 1) + ' h=' + fmt(i.h, 1));
  const k = GEOM[state.panel].scale;
  if (k !== 1) add('muted', 'On this panel (x' + k + '): x=' + fmt(i.x, k) + ' y=' + fmt(i.y, k) + ' w=' + fmt(i.w, k) + ' h=' + fmt(i.h, k));
  const c = document.createElement('code'); c.textContent = i.raw.join(','); box.appendChild(c);
  add('', i.count ? 'Code references (' + i.count + '):' : 'No code references.');
  i.groups.forEach(g => {
    add('grp', g.label + ' (' + g.count + ')');
    g.routines.forEach(r => {
      add('rt', r.routine);
      r.sites.forEach(s => {
        const a = document.createElement('a');
        a.className = 'open site';
        a.dataset.file = g.file;
        a.dataset.line = String(s.line);
        a.textContent = 'line ' + s.line + ' - ' + s.callee;
        box.appendChild(a);
      });
    });
  });
}
function clearSelection() {
  if (!sel) return;
  place(sel.sec.querySelector('.ovl.sel'), null);
  const r = rowEl(sel.sec, sel.id);
  if (r) r.classList.remove('sel');
  sel = null;
}
function selectWidget(sec, id, scroll) {
  const el = widgetEl(sec, id);
  if (!el) return;
  clearSelection();
  sel = { sec, id };
  place(sec.querySelector('.ovl.sel'), el);
  const r = rowEl(sec, id);
  if (r) { r.classList.add('sel'); if (scroll) r.scrollIntoView({ block: 'nearest' }); }
  show(sec, el);
}
document.querySelectorAll('.screen').forEach(sec => {
  sec.querySelectorAll('.w').forEach(el => {
    const id = el.dataset.id;
    el.addEventListener('mouseenter', () => { place(sec.querySelector('.ovl.hov'), el); if (!sel || sel.sec !== sec) show(sec, el); });
    el.addEventListener('mouseleave', () => place(sec.querySelector('.ovl.hov'), null));
    el.addEventListener('click', (e) => { e.stopPropagation(); selectWidget(sec, id, true); });
  });
  sec.querySelectorAll('tr.row').forEach(r => {
    const id = r.dataset.id;
    r.addEventListener('mouseenter', () => place(sec.querySelector('.ovl.hov'), widgetEl(sec, id)));
    r.addEventListener('mouseleave', () => place(sec.querySelector('.ovl.hov'), null));
    r.addEventListener('click', () => selectWidget(sec, id, false));
  });
});
document.addEventListener('click', (e) => {
  const t = e.target;
  const btn = t && t.closest ? t.closest('button[data-act]') : null;
  if (btn) {
    const sec = btn.closest('.screen');
    const key = sec.dataset.screen;
    const row = btn.closest('tr.row');
    const id = row ? Number(row.dataset.id) : 0;
    const act = btn.dataset.act;
    if (act === 'eye') state = PS.toggleHidden(state, key, id);
    else if (act === 'front') state = PS.bringToFront(state, key, id);
    else if (act === 'back') state = PS.sendToBack(state, key, id);
    else if (act === 'showall') state = PS.showAll(state, key);
    else if (act === 'resetorder') state = PS.resetOrder(state, key);
    save();
    return;
  }
  if (t && t.classList && t.classList.contains('open')) {
    vscode.postMessage({ type: 'open', file: t.dataset.file, line: Number(t.dataset.line) });
  }
});
window.addEventListener('resize', layout);
layout();
`;

function renderRow(r: ReturnType<typeof buildWidgetRows>[number]): string {
	const geo = [r.x, r.y, r.w, r.h].map((n) => (n === undefined ? "?" : String(n))).join(",");
	return (
		`<tr class="row" data-id="${r.id}"><td class="ctl">${EYE_BTN}<button data-act="front" title="Bring to front (preview only, not saved)">&#9650;</button><button data-act="back" title="Send to back (preview only, not saved)">&#9660;</button></td><td class="n">${r.id}</td><td>${escapeHtml(r.typeName)} (${r.type})</td>` +
		`<td>${escapeHtml(r.alias)}</td><td>${geo}</td><td class="r">${r.refCount}</td></tr>`
	);
}

function renderEntry(s: ScreenView): string {
	const label = entryLabel(s);
	if (!s.entry || !label) {
		return "";
	}
	const e = s.entry;
	return (
		`<div class="entry">Click handler: ` +
		`<a class="open" data-file="${escapeHtml(e.dispatchFile)}" data-line="${e.dispatchLine}" title="Where ${escapeHtml(e.handler)} dispatches this screen">${escapeHtml(e.handler)}</a> -&gt; ` +
		`<a class="open" data-file="${escapeHtml(e.file)}" data-line="${e.line}" title="Open ${escapeHtml(e.routine)}">${escapeHtml(e.routine)}</a></div>`
	);
}

function renderPreviewWidget(w: WidgetView, opts: RenderOptions): string {
	const html = renderWidget(w, opts);
	const ref = w.typeName === "image" && w.image ? resolveImage(w.image, "") : undefined;
	if (ref?.kind !== "builtin") return html;
	const seven = opts.builtinUri?.(ref.id, "7");
	const twelve = opts.builtinUri?.(ref.id, "12");
	if (!seven || !twelve) return html.replace(/>([^<]*)<\/div>$/, ` title="${escapeHtml(BUILTIN_IMAGE_HINT)}">$1</div>`);
	const uri = previewState.sanitize(opts.initialState).panel === "12" ? twelve : seven;
	return html.replace(/^<div class="w placeholder"/, '<img class="w"')
		.replace(/>[^<]*<\/div>$/, ` data-uri7="${escapeHtml(seven)}" data-uri12="${escapeHtml(twelve)}" src="${escapeHtml(uri)}" alt="">`);
}

function renderScreen(s: ScreenView, opts: RenderOptions): string {
	const rows = buildWidgetRows(s).map(renderRow).join("");
	return (
		`<section class="screen" data-screen="${s.number}"><h3>${escapeHtml(screenTitle(s))}</h3>` +
		renderEntry(s) +
		`<div class="body"><div class="left"><div class="frame"><div class="canvas"><div class="content">${s.widgets.map((w) => renderPreviewWidget(w, opts)).join("")}` +
		`<div class="ovl hov"></div><div class="ovl sel"></div></div><div class="band" title="${escapeHtml(BAND_TIP)}"></div></div></div>` +
		`<div class="insp">Hover or click a widget (or a list row) to inspect it.</div></div>` +
		`<aside class="side"><div class="tools"><button data-act="showall" title="Show every hidden widget of this screen">Show all</button><button data-act="resetorder" title="Restore the authored paint order of this screen">Reset order</button><span class="note muted">Preview only, not saved to .rev.</span></div><table class="wlist"><thead><tr><th></th><th>Id</th><th>Type</th><th>Alias</th><th>x,y,w,h</th><th>Refs</th></tr></thead><tbody>${rows}</tbody></table></aside></div></section>`
	);
}

export function renderScreensHtml(view: ScreensView, opts: RenderOptions): string {
	const csp = [
		"default-src 'none'",
		`img-src ${opts.cspSource}`,
		`style-src ${opts.cspSource} 'unsafe-inline'`,
		`script-src 'nonce-${opts.nonce}'`,
	].join("; ");
	const buttons = [
		`<button data-screen="all">All screens</button>`,
		...view.screens.map(
			(s) => `<button data-screen="${s.number}">Screen ${s.number}${s.names.length ? " " + escapeHtml(s.names.join("/")) : ""} (${s.widgets.length})</button>`,
		),
	].join("");
	const sections = view.screens.map((sc) => renderScreen(sc, opts)).join("\n");
	const panelButtons = (Object.keys(PANELS) as PanelId[])
		.map((id) => `<button data-panel="${id}" title="Preview panel size (not saved to .rev)">${escapeHtml(PANELS[id].label)}</button>`)
		.join("");
	const diagTitle = view.diagnostics.map((d) => `line ${d.line}: ${d.message}`).join("\n");
	const diag = `<span id="diag" title="${escapeHtml(diagTitle)}">${view.diagnostics.length} diagnostics</span>`;
	const empty = view.screens.length ? "" : `<p>No widgets with a screen number were found in this .rev.</p>`;
	return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(opts.title)}</title>
<style>${STYLE}</style></head>
<body class="single">
<div id="bar">${buttons}<span id="panels">${panelButtons}</span>${diag}</div>
${empty}<div id="screens">
${sections}
</div>
<script nonce="${opts.nonce}">${SCRIPT.replace("__GEOM__", () => JSON.stringify(allGeometries()))
		.replace("__PS__", () => PREVIEW_STATE_SOURCE)
		.replace("__INIT__", () => jsonForScript(previewState.sanitize(opts.initialState)))}</script>
</body></html>`;
}

