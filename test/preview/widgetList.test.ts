import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadIriteProject } from "../../src/irite";
import { parseRev } from "../../src/rev";
import { buildScreenView } from "../../src/preview/screenModel";
import { renderScreensHtml } from "../../src/preview/screenHtml";
import { buildWidgetRows, entryLabel, screenTitle } from "../../src/preview/widgetList";

const dir = join(__dirname, "../fixtures/preview");
const read = (p: string): string | undefined => {
	try {
		return readFileSync(p, "utf8");
	} catch {
		return undefined;
	}
};
const project = loadIriteProject(join(dir, "main.src"), read);
const rev = parseRev(read(join(dir, "main.rev")) ?? "");
const view = buildScreenView(rev, project);
const screen = (n: number) => view.screens.find((s) => s.number === n)!;

describe("buildWidgetRows", () => {
	it("lists every widget of the screen in id order with id, type, alias, geometry and reference count", () => {
		const rows = buildWidgetRows(screen(12));
		expect(rows.map((r) => r.id)).toEqual(screen(12).widgets.map((w) => w.id));
		expect(rows.map((r) => r.id)).toEqual([3, 4, 6, 7]);
		const lbl = rows.find((r) => r.alias === "lblPlaca")!;
		expect(lbl).toMatchObject({ id: 3, type: 4, typeName: "label", x: 10, y: 10, w: 200, h: 30 });
		expect(lbl.refCount).toBe(screen(12).widgets.find((w) => w.id === 3)!.references.length);
		expect(lbl.refCount).toBeGreaterThan(1);
	});
	it("keeps widgets without alias or geometry, with empty values", () => {
		const row = buildWidgetRows(screen(12)).find((r) => r.id === 6)!;
		expect(row.alias).toBe("");
		expect(row.refCount).toBe(0);
	});
	it("covers every widget of every screen", () => {
		for (const s of view.screens) {
			expect(buildWidgetRows(s).length).toBe(s.widgets.length);
		}
	});
});

describe("screen labels", () => {
	it("titles a screen with its number, names and widget count", () => {
		expect(screenTitle(screen(12))).toBe("Screen 12 - PlateEntry - 4 widgets");
		expect(screenTitle(screen(6))).toBe("Screen 6 - Error / Notification - 1 widget");
		expect(screenTitle({ ...screen(12), names: [] })).toBe("Screen 12 - 4 widgets");
	});
	it("describes the entry point as handler -> routine", () => {
		expect(entryLabel(screen(12))).toBe("WidgetClicked -> handlerScreenPlateEntry");
		expect(entryLabel({ ...screen(12), entry: undefined })).toBeUndefined();
	});
});

describe("screen section in the page", () => {
	const html = renderScreensHtml(view, { cspSource: "x:", nonce: "N", imageUri: () => undefined, title: "T" });
	const section = (n: number): string => html.split('<section class="screen"').find((s) => s.startsWith(` data-screen="${n}"`))!;
	it("has one list row per widget, with the widget id on the row", () => {
		for (const s of view.screens) {
			const sec = section(s.number);
			expect(sec.match(/<tr class="row"/g)?.length).toBe(s.widgets.length);
			for (const w of s.widgets) {
				expect(sec).toContain(`<tr class="row" data-id="${w.id}"`);
			}
		}
	});
	it("shows the screen name and the click handler entry as an openable link", () => {
		const sec = section(12);
		expect(sec).toContain("Screen 12 - PlateEntry - 4 widgets");
		expect(sec).toMatch(/class="open"[^>]*data-file="[^"]*main\.iri"[^>]*data-line="30"[^>]*>handlerScreenPlateEntry</);
		expect(sec).toContain("WidgetClicked");
	});
	it("omits the entry line when none was found", () => {
		expect(section(9)).not.toContain('class="entry"');
	});
	it("embeds references grouped by file and routine for the inspector", () => {
		const m = section(12).match(/data-id="3"[^>]*data-info="([^"]*)"/)!;
		const info = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
		expect(info.count).toBeGreaterThan(1);
		expect(info.groups[0].label).toBe("ui/main.iri");
		expect(info.groups[0].routines.map((r: { routine: string }) => r.routine)).toContain("handlerScreenPlateEntry");
		expect(info.groups[0].file).toMatch(/main\.iri$/);
	});
});
