import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseRev } from "../../src/rev";
import {
	WIDGET_TYPES,
	aliasIndex,
	defaultAlias,
	geometryFields,
	newWidgetTokens,
	paletteTypes,
	propsOf,
	screenIndex,
	widgetFieldByName,
	widgetTypeDef,
} from "../../src/rev/widgetCatalog";
import { crlfFixture, goldenPath, hasGolden, utf8 } from "./revFixtures";

const TOKEN_COUNTS: Record<number, number> = { 1: 8, 2: 10, 3: 16, 4: 16, 5: 13, 6: 12, 7: 11, 8: 9, 9: 8, 10: 9, 11: 16 };

describe("widget catalog", () => {
	it("has every 1280 type 1..11 with the documented token count", () => {
		expect(WIDGET_TYPES.map((t) => t.type)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
		for (const [type, count] of Object.entries(TOKEN_COUNTS)) {
			const t = widgetTypeDef(Number(type))!;
			expect(t.tokenCount).toBe(count);
			expect(t.fields).toHaveLength(count);
			expect(t.fields.map((f) => f.index)).toEqual([...Array(count).keys()]);
		}
	});

	it("returns undefined for unknown types and fields", () => {
		expect(widgetTypeDef(99)).toBeUndefined();
		expect(widgetFieldByName(4, "nope")).toBeUndefined();
		expect(propsOf(99, ["99", "1"])).toEqual({});
	});

	it("looks fields up by name with their enum values", () => {
		expect(widgetFieldByName(4, "visible")!.values!.map((v) => v.value)).toEqual([1, 2]);
		expect(widgetFieldByName(6, "style")!.values).toHaveLength(48);
		expect(widgetFieldByName(6, "symbolColor")!.values).toHaveLength(16);
		expect(widgetFieldByName(3, "orientation")!.values!.map((v) => v.value)).toEqual([1, 2, 3, 4]);
	});

	it("gives geometry indexes per type", () => {
		expect(geometryFields(4)).toEqual({ x: 1, y: 2, width: 3, height: 4 });
		expect(geometryFields(10)).toEqual({ x: 1, y: 2, width: 3, height: 4 });
		expect(geometryFields(1)).toEqual({ x: 1, y: 2 });
		expect(geometryFields(6)).toEqual({ x: 1, y: 2 });
		expect(geometryFields(9)).toEqual({ x: 1, y: 2 });
		expect(geometryFields(99)).toBeUndefined();
	});

	it("knows where the screen and alias tokens are (type 8 has screen before alias)", () => {
		expect(screenIndex(7)).toBe(9);
		expect(screenIndex(8)).toBe(7);
		expect(aliasIndex(8)).toBe(8);
		expect(aliasIndex(7)).toBe(10);
		expect(aliasIndex(1)).toBeUndefined();
		expect(aliasIndex(9)).toBeUndefined();
		expect(aliasIndex(10)).toBeUndefined();
	});

	it("default aliases are prefix + id", () => {
		expect(defaultAlias(4, 12)).toBe("lbl12");
		expect(defaultAlias(11, 3)).toBe("mlbl3");
		expect(defaultAlias(10, 5)).toBe("line5");
		expect(defaultAlias(1, 5)).toBeUndefined();
	});

	it("the palette offers every type but the legacy numeric widget", () => {
		expect(paletteTypes().map((t) => t.type)).toEqual([1, 2, 3, 4, 6, 7, 8, 9, 10, 11]);
		expect(newWidgetTokens(5, { id: 1, screen: 1, x: 0, y: 0 })).toBeUndefined();
	});

	it("builds new widget tokens with the documented defaults, with the token count of the type", () => {
		const o = { id: 7, screen: 3, x: 40.4, y: -5 };
		expect(newWidgetTokens(4, o)).toEqual("4,40,0,76,20,Caption,2,1,12,Black,lbl7,1,1,1,1,3".split(","));
		expect(newWidgetTokens(1, o)).toEqual("1,40,0,4,1,3,#393939,#F0EEEE".split(","));
		expect(newWidgetTokens(10, o)).toEqual("10,40,0,80,1,1,1,Black,3".split(","));
		expect(newWidgetTokens(8, o)).toEqual("8,40,0,100,100,1,1,3,cht7".split(","));
		for (const t of paletteTypes()) {
			expect(newWidgetTokens(t.type, o)).toHaveLength(t.tokenCount);
		}
	});
});

describe("reader exposes named props", () => {
	const model = parseRev(utf8(crlfFixture("hashed.rev")));
	const w = (id: number) => model.widgets.find((x) => x.id === id)!;

	it("fills props by catalog name and keeps tokens raw for every type", () => {
		expect(w(4).props).toMatchObject({ x: "170", caption: "Total & <NL> ñ", border: "2", fontSize: "18", color: "#BB0000", alias: "lbl4", screen: "1" });
		expect(w(8).props).toMatchObject({ chartStyle: "1", screen: "1", alias: "cht8" });
		expect(w(9).props).toMatchObject({ orientation: "1", backgroundColor: "#F0EEEE" });
		expect(w(1).tokens).toEqual("1,119,2,4,1,1,#393939,#F0EEEE".split(","));
		expect(w(4).tokens).toEqual(w(4).raw);
	});

	it("every fixture widget of a known type has the catalog token count and enum values in range", () => {
		for (const x of model.widgets.filter((v) => v.type !== 99)) {
			const def = widgetTypeDef(x.type)!;
			expect(x.tokens).toHaveLength(def.tokenCount);
			for (const f of def.fields.filter((q) => q.values)) {
				expect(f.values!.map((v) => String(v.value))).toContain(x.props[f.name]);
			}
		}
	});

	it("unknown types stay raw tokens with empty props", () => {
		expect(w(12).tokens).toEqual(["99", "1", "2", "3"]);
		expect(w(12).props).toEqual({});
		expect(w(12).typeName).toBe("unknown");
	});

	it("a caption with commas written by another tool still maps later fields by name", () => {
		const m = parseRev("<Config>WDGT#1=4,1,2,3,4,Hello, world,1,2,18,#BB0000,lbl1,4,0,0,1,7\r\n</Config>");
		expect(m.widgets[0].props).toMatchObject({ caption: "Hello, world", fontSize: "18", alias: "lbl1", screen: "7" });
	});
});

const GOLDEN = ["dole-00fe873.rev", "dole-main-current.rev"];
describe("golden scratch DOLE copies (skipped when absent)", () => {
	for (const name of GOLDEN) {
		it.skipIf(!hasGolden(name))(`${name}: every WDGT line has the catalog token count and valid enums`, () => {
			const model = parseRev(readFileSync(goldenPath(name), "utf8"));
			expect(model.widgets.length).toBeGreaterThan(100);
			for (const x of model.widgets) {
				const def = widgetTypeDef(x.type);
				expect(def, `WDGT#${x.id} type ${x.type}`).toBeDefined();
				expect(x.tokens, `WDGT#${x.id}`).toHaveLength(def!.tokenCount);
				for (const f of def!.fields.filter((q) => q.values)) {
					expect(f.values!.map((v) => String(v.value)), `WDGT#${x.id}.${f.name}`).toContain(x.props[f.name]);
				}
			}
		});
	}
});
