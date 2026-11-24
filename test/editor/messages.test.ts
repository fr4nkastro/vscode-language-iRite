import { describe, expect, it } from "vitest";
import { parseEditorMessage } from "../../src/editor/messages";

const ids = new Set([3, 15, 22]);
const types = new Map([[3, 4], [15, 1], [22, 10]]);
const p = (m: unknown) => parseEditorMessage(m, ids, types);

describe("editor messages (new)", () => {
	it("accepts add with a palette type, finite position and screen", () => {
		expect(p({ type: "add", widgetType: 4, x: 10.4, y: 20, screen: 2 })).toEqual({ type: "add", widgetType: 4, x: 10.4, y: 20, screen: 2 });
	});
	it("rejects add with unknown/legacy types, bad numbers, bad screens", () => {
		for (const bad of [
			{ type: "add", widgetType: 5, x: 0, y: 0, screen: 1 },
			{ type: "add", widgetType: 99, x: 0, y: 0, screen: 1 },
			{ type: "add", widgetType: "4", x: 0, y: 0, screen: 1 },
			{ type: "add", widgetType: 4, x: NaN, y: 0, screen: 1 },
			{ type: "add", widgetType: 4, x: 0, y: 0, screen: 0 },
			{ type: "add", widgetType: 4, x: 0, y: 0, screen: 1.5 },
			{ type: "add", widgetType: 4, x: 0, screen: 1 },
		]) {
			expect(p(bad)).toBeUndefined();
		}
	});
	it("accepts delete of an existing id only", () => {
		expect(p({ type: "delete", id: 3 })).toEqual({ type: "delete", id: 3 });
		expect(p({ type: "delete", id: 4 })).toBeUndefined();
		expect(p({ type: "delete", id: "3" })).toBeUndefined();
	});
	it("accepts setProp for an editable catalog field of that widget's type", () => {
		expect(p({ type: "setProp", id: 3, field: "fontSize", value: 20 })).toEqual({ type: "setProp", id: 3, field: "fontSize", value: 20 });
		expect(p({ type: "setProp", id: 3, field: "caption", value: "hi" })).toMatchObject({ value: "hi" });
	});
	it("rejects setProp with unknown id, field of another type, non-editable, alias, bad value types", () => {
		for (const bad of [
			{ type: "setProp", id: 4, field: "fontSize", value: 1 },
			{ type: "setProp", id: 3, field: "nope", value: 1 },
			{ type: "setProp", id: 15, field: "fontSize", value: 1 },
			{ type: "setProp", id: 3, field: "screen", value: 1 },
			{ type: "setProp", id: 3, field: "alias", value: "x" },
			{ type: "setProp", id: 3, field: "fontSize", value: {} },
			{ type: "setProp", id: 3, field: "fontSize", value: NaN },
			{ type: "setProp", id: 3, field: "caption", value: "x".repeat(300) },
			{ type: "setProp", id: 3, field: "__proto__", value: 1 },
		]) {
			expect(p(bad)).toBeUndefined();
		}
	});
	it("accepts renameAlias for existing ids with a string", () => {
		expect(p({ type: "renameAlias", id: 3, alias: "abc" })).toEqual({ type: "renameAlias", id: 3, alias: "abc" });
		expect(p({ type: "renameAlias", id: 4, alias: "abc" })).toBeUndefined();
		expect(p({ type: "renameAlias", id: 3, alias: 5 })).toBeUndefined();
		expect(p({ type: "renameAlias", id: 3, alias: "x".repeat(100) })).toBeUndefined();
	});
	it("accepts requestRefs and select for existing ids (select also null)", () => {
		expect(p({ type: "requestRefs", id: 3 })).toEqual({ type: "requestRefs", id: 3 });
		expect(p({ type: "requestRefs", id: 4 })).toBeUndefined();
		expect(p({ type: "select", id: null })).toEqual({ type: "select", id: null });
		expect(p({ type: "select", id: 22 })).toEqual({ type: "select", id: 22 });
		expect(p({ type: "select", id: 5 })).toBeUndefined();
	});
	it("still handles the old messages", () => {
		expect(p({ type: "edit", id: 3, x: 5 })).toEqual({ type: "edit", id: 3, patch: { x: 5 } });
		expect(p({ type: "wat" })).toBeUndefined();
	});
});
