import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../../src/cli/revCli";
import type { CliIo } from "../../src/cli/revCli";
import { renderScreensHtml } from "../../src/preview/screenHtml";
import { buildScreenView } from "../../src/preview/screenModel";
import { renderScreenSvg } from "../../src/preview/screenSvg";
import { findOverlaps, widgetBox } from "../../src/preview/widgetBox";
import { parseRev } from "../../src/rev";

const FIX = join(__dirname, "../fixtures/editor");
const io: CliIo = {
	readText: (p) => (existsSync(p) ? readFileSync(p, "utf8") : undefined),
	readBinary: (p) => (existsSync(p) ? readFileSync(p) : undefined),
	exists: existsSync,
};
const rev = join(FIX, "main.rev");
const json = (args: string[]) => JSON.parse(runCli(args, io).stdout);

describe("cli: screens / widgets", () => {
	it("lists the screens with widget counts", () => {
		const r = json(["screens", rev]);
		const model = parseRev(readFileSync(rev, "utf8"));
		expect(r.screens.map((s: { number: number }) => s.number)).toEqual(model.screens.map((s) => s.number));
		expect(r.screens.reduce((n: number, s: { widgetCount: number }) => n + s.widgetCount, 0)).toBe(model.widgets.filter((w) => w.screen !== undefined).length);
	});

	it("lists widgets of one screen in paint (id) order with boxes, panel boxes and overlaps", () => {
		const all = json(["widgets", rev]);
		const n = all.screens[0].number;
		const one = json(["widgets", rev, "--screen", String(n), "--panel", "12"]).screens[0];
		expect(one.number).toBe(n);
		const ids = one.widgets.map((w: { id: number }) => w.id);
		expect(ids).toEqual([...ids].sort((a: number, b: number) => a - b));
		const w = one.widgets[0];
		expect(w.panelBox.x).toBeCloseTo(w.box.x * 1.6, 9);
		expect(one.panel.scale).toBe(1.6);
		expect(Array.isArray(one.overlaps)).toBe(true);
	});

	it("reports overlaps of non-backdrop widgets and flags out-of-bounds", () => {
		const o = findOverlaps([
			{ id: 1, box: { x: 0, y: 0, w: 800, h: 388 } },
			{ id: 2, box: { x: 10, y: 10, w: 100, h: 50 } },
			{ id: 3, box: { x: 60, y: 30, w: 100, h: 50 } },
			{ id: 4, box: { x: 500, y: 300, w: 10, h: 10 } },
		]);
		expect(o).toEqual([{ a: 2, b: 3, area: 50 * 30 }]);
	});

	it("fails cleanly: unknown command, missing file, unknown screen, bad flags", () => {
		expect(runCli(["frob", rev], io).code).toBe(2);
		expect(runCli(["screens", join(FIX, "nope.rev")], io).code).toBe(1);
		expect(runCli(["widgets", rev, "--screen", "9999"], io).stderr).toMatch(/not found/);
		expect(runCli(["render", rev], io).code).toBe(2);
		expect(runCli(["widgets", rev, "--panel", "9"], io).code).toBe(2);
		expect(runCli(["widgets", rev, "--screen", "x"], io).code).toBe(2);
		expect(runCli([], io).code).toBe(2);
		expect(runCli(["--help"], io).code).toBe(0);
	});

	it("never writes: only render --out asks the caller for a file, and nothing else", () => {
		const n = json(["screens", rev]).screens[0].number;
		expect(runCli(["screens", rev], io).out).toBeUndefined();
		expect(runCli(["render", rev, "--screen", String(n)], io).out).toBeUndefined();
		expect(runCli(["render", rev, "--screen", String(n), "--out", "x.svg"], io).out?.path).toBe("x.svg");
	});
});

describe("cli: render matches the webview", () => {
	const model = parseRev(readFileSync(rev, "utf8"));
	const view = buildScreenView(model);

	it("draws every widget at the box the preview page uses, in the same paint order", () => {
		const html = renderScreensHtml(view, { cspSource: "x", nonce: "n", title: "t", imageUri: () => undefined });
		for (const s of view.screens) {
			const svg = renderScreenSvg(s, { panel: "7" });
			const fromSvg = [...svg.matchAll(/<svg class="widget" data-id="(\d+)"[^>]* x="(-?\d+)" y="(-?\d+)" width="(\d+)" height="(\d+)"/g)].map((m) => `${m[1]}|${m[2]},${m[3]},${m[4]},${m[5]}`);
			const sec = html.slice(html.indexOf(`<section class="screen" data-screen="${s.number}"`));
			const sectionHtml = sec.slice(0, sec.indexOf("</section>"));
			const fromHtml = [...sectionHtml.matchAll(/data-id="(\d+)" style="left:(-?\d+)px;top:(-?\d+)px;width:(\d+)px;height:(\d+)px;/g)].map((m) => `${m[1]}|${m[2]},${m[3]},${m[4]},${m[5]}`);
			expect(fromSvg).toEqual(fromHtml);
			expect(fromSvg.length).toBe(s.widgets.length);
		}
	});

	it("widgetBox applies the same defaults for types without a stored size", () => {
		expect(widgetBox({ typeName: "scale", x: 1, y: 2 })).toEqual({ x: 1, y: 2, w: 220, h: 60 });
		expect(widgetBox({ typeName: "symbol", x: 1, y: 2 })).toEqual({ x: 1, y: 2, w: 24, h: 24 });
		expect(widgetBox({ typeName: "label", x: 1, y: 2, width: 5, height: 6 })).toEqual({ x: 1, y: 2, w: 5, h: 6 });
	});

	it("12 inch: scales content uniformly by 1.6 and draws the letterbox band", () => {
		const s = view.screens[0];
		const svg = renderScreenSvg(s, { panel: "12" });
		expect(svg).toContain('viewBox="0 0 1280 652.8"');
		expect(svg).toContain('transform="scale(1.6)"');
		expect(svg).toContain('class="band"');
		expect(renderScreenSvg(s, { panel: "7" })).not.toContain('class="band"');
	});

	it("escapes text and refuses unsafe colors and image URIs", () => {
		const s = view.screens[0];
		const evil = { ...s, widgets: [{ ...s.widgets[0], typeName: "label" as const, text: '<script>"&', color: "red;x" }, { ...s.widgets[1], typeName: "image" as const, image: "a.png" }] };
		const svg = renderScreenSvg(evil, { panel: "7", imageData: () => 'data:image/png;base64,AAAA" onload="x' });
		expect(svg).not.toContain("<script>");
		expect(svg).toContain("&lt;script&gt;&quot;&amp;");
		expect(svg).not.toContain("red;x");
		expect(svg).not.toContain("onload");
	});

	it("embeds an image file as a data URI when it exists", () => {
		const s = view.screens[0];
		const img = s.widgets.find((w) => w.typeName === "image") ?? s.widgets[0];
		const svg = renderScreenSvg({ ...s, widgets: [{ ...img, typeName: "image" as const, image: "x.png" }] }, { panel: "7", imageData: () => "data:image/png;base64,iVBORw0KGgo=" });
		expect(svg).toContain('<image href="data:image/png;base64,iVBORw0KGgo="');
	});
});
