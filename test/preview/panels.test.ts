import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRev } from "../../src/rev";
import { buildScreenView } from "../../src/preview/screenModel";
import { renderScreensHtml, CANVAS_HEIGHT, CANVAS_WIDTH } from "../../src/preview/screenHtml";
import { AUTHORED_PANEL, DEFAULT_PANEL, PANELS, isPanelId, panelGeometry, scaleRect, uniformScale } from "../../src/preview/panels";

describe("panel sizes", () => {
	it("offers the 7 inch panel (default, the size .rev coordinates are authored for) and the 12 inch panel", () => {
		expect(DEFAULT_PANEL).toBe("7");
		expect(PANELS["7"]).toMatchObject({ label: '7" 800x480', width: 800, height: 480 });
		expect(PANELS["12"]).toMatchObject({ label: '12" 1280x800', width: 1280, height: 800 });
		expect(AUTHORED_PANEL).toBe(PANELS["7"]);
	});
	it("keeps the historical 800x388 usable area for 7 inch (header 92 px)", () => {
		const g = panelGeometry("7");
		expect(g).toMatchObject({ scale: 1, canvasWidth: 800, canvasHeight: 388, contentWidth: 800, contentHeight: 388, bandHeight: 0 });
		expect([CANVAS_WIDTH, CANVAS_HEIGHT]).toEqual([800, 388]);
	});
	it("scales 12 inch uniformly by 1.6 and leaves a 32 px letterbox band", () => {
		const g = panelGeometry("12");
		expect(g.scale).toBe(1.6);
		expect(g.canvasWidth).toBe(1280);
		expect(g.contentWidth).toBe(1280);
		expect(g.contentHeight).toBeCloseTo(620.8, 5);
		expect(g.bandHeight).toBeCloseTo(32, 5);
		expect(g.headerHeight).toBeCloseTo(147.2, 5);
		// header + scaled content + band fill the whole panel
		expect(g.headerHeight + g.contentHeight + g.bandHeight).toBeCloseTo(800, 5);
	});
});

describe("uniformScale", () => {
	it("is the smaller of the two axis ratios (1280/800 = 1.6 beats 800/480 = 1.667)", () => {
		expect(uniformScale({ width: 800, height: 480 }, { width: 1280, height: 800 })).toBe(1.6);
		expect(uniformScale({ width: 100, height: 100 }, { width: 400, height: 200 })).toBe(2);
		expect(uniformScale({ width: 100, height: 100 }, { width: 100, height: 100 })).toBe(1);
	});
});

describe("scaleRect", () => {
	const r = { x: 112, y: 242, w: 260, h: 60 };
	it("scales position and size by the same factor", () => {
		const s = scaleRect(r, 1.6);
		expect(s.x).toBeCloseTo(179.2, 5);
		expect(s.y).toBeCloseTo(387.2, 5);
		expect(s.w).toBeCloseTo(416, 5);
		expect(s.h).toBeCloseTo(96, 5);
	});
	it("rescales every widget of a real .rev without input and restores 7 inch exactly", () => {
		const rev = parseRev(readFileSync(join(__dirname, "../fixtures/rev/sample.rev"), "utf8"));
		const widgets = buildScreenView(rev)
			.screens.flatMap((s) => s.widgets)
			.filter((w) => w.x !== undefined && w.y !== undefined && w.width !== undefined && w.height !== undefined);
		expect(widgets.length).toBeGreaterThan(3);
		const k12 = panelGeometry("12").scale;
		for (const w of widgets) {
			const rect = { x: w.x!, y: w.y!, w: w.width!, h: w.height! };
			const up = scaleRect(rect, k12);
			expect(up.w).toBeCloseTo(rect.w * 1.6, 9);
			expect(up.x).toBeCloseTo(rect.x * 1.6, 9);
			expect(scaleRect(rect, panelGeometry("7").scale)).toEqual(rect);
		}
	});
});

describe("isPanelId", () => {
	it("accepts only the known ids", () => {
		expect(isPanelId("7")).toBe(true);
		expect(isPanelId("12")).toBe(true);
		expect(isPanelId("9")).toBe(false);
		expect(isPanelId(7)).toBe(false);
	});
});

describe("panel selector in the page", () => {
	const rev = parseRev(readFileSync(join(__dirname, "../fixtures/rev/sample.rev"), "utf8"));
	const html = renderScreensHtml(buildScreenView(rev), { cspSource: "x:", nonce: "N", imageUri: () => undefined, title: "T" });
	it("has one button per panel with its label", () => {
		expect(html).toContain('data-panel="7"');
		expect(html).toContain('data-panel="12"');
		expect(html).toContain("7&quot; 800x480");
		expect(html).toContain("12&quot; 1280x800");
	});
	it("embeds the geometry the script applies and marks the letterbox as an assumption", () => {
		expect(html).toContain('"scale":1.6');
		expect(html).toMatch(/title="[^"]*assum[^"]*"/i);
		expect(html.match(/class="band"/g)?.length).toBe(buildScreenView(rev).screens.length);
	});
});
