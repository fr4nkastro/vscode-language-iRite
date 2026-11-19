/** Pure HTML renderer for the screen preview webview (no `vscode` import). */
import { resolveImage } from "../rev";
import type { ScreensView, WidgetView } from "./screenModel";

/** Usable 1280 screen area in pixels (AGENTS.md: assumption, panel may be 800x480 with a header). */
export const CANVAS_WIDTH = 800;
export const CANVAS_HEIGHT = 388;
const SAMPLE_WEIGHT = "888888.1";

export interface RenderOptions {
	cspSource: string;
	nonce: string;
	/** Project-relative path (e.g. `sdimages/a.png`) → webview URI, or undefined when the file is missing. */
	imageUri: (relPath: string) => string | undefined;
	title: string;
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

function renderWidget(w: WidgetView, opts: RenderOptions): string {
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
			cls += " label";
			extra = `font-size:${px(w.fontSize, 12)}px;color:${color(w.color, "Black")};`;
			inner = escapeHtml(w.text ?? "");
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
		refs: w.references,
	};
	const style = `left:${x}px;top:${y}px;width:${px(width, 0)}px;height:${px(height, 0)}px;${extra}`;
	const open = `<${tag} class="${cls}" data-id="${w.id}" style="${style}" data-info="${escapeHtml(JSON.stringify(info))}"${attrs}`;
	return tag === "img" ? `${open}>` : `${open}>${inner}</${tag}>`;
}

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
.w{position:absolute;box-sizing:border-box;overflow:hidden;cursor:pointer;}
.w:hover,.w.sel{outline:2px solid #e91e63;z-index:100000;}
.label{white-space:nowrap;text-overflow:ellipsis;}
.line{min-height:1px;}
.scale{display:flex;align-items:center;justify-content:center;font-family:monospace;}
.bargraph{border:2px solid #000;}
.symbol{border:2px solid #888;border-radius:50%;}
.placeholder{border:1px dashed #888;background:#eee;color:#555;font-size:11px;word-break:break-all;}
.unknown{background:repeating-linear-gradient(45deg,#ccc,#ccc 4px,#eee 4px,#eee 8px);border:1px solid #999;}
#inspector{margin-top:8px;padding:6px;border:1px solid var(--vscode-panel-border,#666);font-size:12px;min-height:3em;}
#inspector a{color:var(--vscode-textLink-foreground);cursor:pointer;display:block;}
#inspector code{white-space:pre-wrap;word-break:break-all;}
`;

const SCRIPT = `
const vscode = typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : { postMessage() {}, getState() { return undefined; }, setState() {} };
const W = ${CANVAS_WIDTH}, H = ${CANVAS_HEIGHT};
let state = vscode.getState() || { screen: 'all' };
const body = document.body;
function layout() {
  const single = state.screen !== 'all';
  body.classList.toggle('single', single);
  const avail = Math.max(200, document.documentElement.clientWidth - 20);
  const scale = single ? Math.min(avail / W, 2) : Math.min(0.4, avail / W);
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.toggle('sel', s.dataset.screen === state.screen);
    const f = s.querySelector('.frame');
    f.style.width = Math.round(W * scale) + 'px';
    f.style.height = Math.round(H * scale) + 'px';
    f.firstElementChild.style.transform = 'scale(' + scale + ')';
  });
  document.querySelectorAll('#bar button').forEach(b => b.classList.toggle('on', b.dataset.screen === state.screen));
}
function select(s) { state = { screen: s }; vscode.setState(state); layout(); }
document.querySelectorAll('#bar button').forEach(b => b.addEventListener('click', () => select(b.dataset.screen)));
document.querySelectorAll('.screen h3').forEach(h => h.addEventListener('click', () => select(h.parentElement.dataset.screen)));
let pinned = null;
function show(el) {
  const i = JSON.parse(el.dataset.info);
  const box = document.getElementById('inspector');
  box.textContent = '';
  const line = (t) => { const d = document.createElement('div'); d.textContent = t; box.appendChild(d); };
  line('#' + i.id + ' - ' + i.typeName + ' (type ' + i.type + ')' + (i.alias ? ' - ' + i.alias : ''));
  line('x=' + i.x + ' y=' + i.y + ' w=' + i.w + ' h=' + i.h);
  const c = document.createElement('code'); c.textContent = i.raw.join(','); box.appendChild(c);
  line(i.refs.length ? 'Code references (' + i.refs.length + '):' : 'No code references.');
  i.refs.forEach(r => {
    const a = document.createElement('a');
    a.textContent = r.callee + ' - ' + r.file.split(/[\\\\/]/).pop() + ':' + r.line;
    a.addEventListener('click', () => vscode.postMessage({ type: 'open', file: r.file, line: r.line }));
    box.appendChild(a);
  });
}
document.querySelectorAll('.w').forEach(el => {
  el.addEventListener('mouseenter', () => { if (!pinned) show(el); });
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    if (pinned) pinned.classList.remove('sel');
    pinned = el; el.classList.add('sel'); show(el);
  });
});
window.addEventListener('resize', layout);
layout();
`;

export function renderScreensHtml(view: ScreensView, opts: RenderOptions): string {
	const csp = [
		"default-src 'none'",
		`img-src ${opts.cspSource}`,
		`style-src ${opts.cspSource} 'unsafe-inline'`,
		`script-src 'nonce-${opts.nonce}'`,
	].join("; ");
	const buttons = [
		`<button data-screen="all">All screens</button>`,
		...view.screens.map((s) => `<button data-screen="${s.number}">Screen ${s.number} (${s.widgets.length})</button>`),
	].join("");
	const sections = view.screens
		.map(
			(s) =>
				`<section class="screen" data-screen="${s.number}"><h3>Screen ${s.number} - ${s.widgets.length} widgets</h3>` +
				`<div class="frame"><div class="canvas">${s.widgets.map((w) => renderWidget(w, opts)).join("")}</div></div></section>`,
		)
		.join("\n");
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
<div id="bar">${buttons}${diag}</div>
${empty}<div id="screens">
${sections}
</div>
<div id="inspector">Hover or click a widget to inspect it.</div>
<script nonce="${opts.nonce}">${SCRIPT}</script>
</body></html>`;
}

