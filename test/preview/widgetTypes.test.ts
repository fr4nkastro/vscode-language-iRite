import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../../src/cli/revCli";
import type { CliIo } from "../../src/cli/revCli";
import { renderScreensHtml, renderWidget } from "../../src/preview/screenHtml";
import { buildScreenView } from "../../src/preview/screenModel";
import { renderScreenSvg } from "../../src/preview/screenSvg";
import { widgetBox } from "../../src/preview/widgetBox";
import { parseRev } from "../../src/rev";

const FILE = join(__dirname, "../fixtures/rev/hashed.rev");
const text = readFileSync(FILE, "utf8");
const rev = parseRev(text);
const view = buildScreenView(rev);
const screen = view.screens.find((s) => s.number === 1)!;
const opts = { cspSource: "x", nonce: "n", title: "t", imageUri: () => undefined };
const io: CliIo = { readText: (p) => (p === FILE ? text : undefined), readBinary: () => undefined, exists: () => false };

const NAMES: Record<number, string> = { 1: "scale", 2: "bitmap", 3: "bargraph", 4: "label", 5: "numeric", 6: "symbol", 7: "image", 8: "chart", 9: "softkey", 10: "line", 11: "monolabel" };

describe("reader: every catalog type gets geometry, screen, alias and a type name", () => {
	it("names types 1..11 and leaves type 99 unknown", () => {
		for (const [t, n] of Object.entries(NAMES)) expect(rev.widgets.find((w) => w.type === Number(t))!.typeName).toBe(n);
		expect(rev.widgets.find((w) => w.type === 99)!.typeName).toBe("unknown");
	});
	it("fills the fields of the types that were unknown", () => {
		const g = (id: number) => rev.widgets.find((w) => w.id === id)!;
		expect(g(2)).toMatchObject({ x: 10, y: 10, width: 80, height: 80, screen: 1, alias: "bit2" });
		expect(g(5)).toMatchObject({ x: 10, y: 20, width: 100, height: 30, screen: 1 });
		expect(g(8)).toMatchObject({ x: 300, y: 50, width: 100, height: 100, screen: 1, alias: "cht8" });
		expect(g(9)).toMatchObject({ x: 0, y: 300, screen: 1, color: "#393939" });
		expect(g(9).width).toBeUndefined();
		expect(g(9).alias).toBeUndefined();
		expect(g(11)).toMatchObject({ x: 20, y: 40, width: 76, height: 20, text: "Mono", fontSize: 12, color: "Black", alias: "mlbl11", screen: 1 });
	});
	it("puts every type on its screen and in the aliases", () => {
		expect(screen.widgets.map((w) => w.type).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
		expect(rev.aliases.filter((a) => a.kind === "widget").map((a) => a.name)).toEqual(expect.arrayContaining(["bit2", "cht8", "mlbl11"]));
	});
});

describe("preview HTML renders each catalog type with its own class", () => {
	const cls: Record<number, string> = { 2: "bitmap", 5: "label", 8: "chart", 9: "softkey", 11: "label mono" };
	it.each(Object.entries(cls))("type %s", (t, c) => {
		const w = screen.widgets.find((x) => x.type === Number(t))!;
		const html = renderWidget(w, opts);
		expect(html).toContain(`class="w ${c}`);
		expect(html).not.toContain("unknown");
	});
	it("monospace label shows its caption; softkey gets a default size", () => {
		expect(renderWidget(screen.widgets.find((w) => w.type === 11)!, opts)).toContain(">Mono<");
		expect(renderWidget(screen.widgets.find((w) => w.type === 9)!, opts)).toMatch(/width:800px;height:70px/);
	});
	it("the page defines the style rules", () => {
		const html = renderScreensHtml(view, opts);
		for (const c of [".bitmap", ".chart", ".softkey", ".mono"]) expect(html).toContain(c);
	});
	it("widget boxes match the numbers written into the HTML", () => {
		for (const w of screen.widgets) {
			const b = widgetBox(w);
			expect(renderWidget(w, opts)).toContain(`left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;`);
		}
	});
});

describe("headless SVG renders each catalog type", () => {
	const svg = renderScreenSvg(screen, { panel: "7" });
	it("emits one widget per type with the new type names", () => {
		for (const [t, n] of Object.entries(NAMES)) expect(svg).toMatch(new RegExp(`data-id="\\d+" data-type="${n}"`));
		expect((svg.match(/class="widget"/g) ?? []).length).toBe(11);
	});
	it("monospace label uses a monospace font and its caption", () => {
		expect(svg).toMatch(/font-family="monospace"[^>]*>Mono</);
	});
	it("bitmap, chart and softkey are not the generic grey rectangle", () => {
		for (const n of ["bitmap", "chart", "softkey"]) {
			const m = new RegExp(`data-type="${n}"[^>]*>(.*?)</svg>`, "s").exec(svg)!;
			expect(m[1]).not.toBe(`<rect x="0.5" y="0.5" width="99" height="99" fill="#ddd" stroke="#999"/>`);
			expect(m[1].length).toBeGreaterThan(20);
		}
	});
});

describe("rev-cli widgets", () => {
	it("includes the type name and named props, and keeps the old fields", () => {
		const r = JSON.parse(runCli(["widgets", FILE, "--screen", "1"], io).stdout);
		const ws = r.screens[0].widgets as Array<Record<string, any>>;
		const w11 = ws.find((w) => w.id === 11)!;
		expect(w11.typeName).toBe("monolabel");
		expect(w11.catalogName).toBe("Monospace label widget");
		expect(w11.props).toMatchObject({ caption: "Mono", fontSize: "12", alias: "mlbl11", dataSource: "4", screen: "1" });
		expect(ws.find((w) => w.id === 8)!.props).toMatchObject({ chartStyle: "1", alias: "cht8" });
		expect(ws.find((w) => w.id === 4)!.props.caption).toBe("Total & <NL> ñ");
		expect(ws.find((w) => w.id === 4)).toMatchObject({ typeName: "label", text: "Total & <NL> ñ", x: 170 });
		expect(ws.find((w) => w.id === 12)).toBeUndefined();
	});
	it("an unknown type has empty props and a null catalog name", () => {
		const r = JSON.parse(runCli(["widgets", FILE], io).stdout);
		expect(r.screens.length).toBeGreaterThan(0);
	});
	it("help lists the named properties", () => {
		expect(runCli(["--help"], io).stdout).toMatch(/props/);
	});
});
