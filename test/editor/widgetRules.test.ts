import { describe, expect, it } from "vitest";
import { iriHint, constantLine } from "../../src/editor/iriHint";
import { displayAlias, nextFreeId, pickDefaultAlias, validateAlias } from "../../src/editor/widgetRules";

describe("ids (L7)", () => {
	it("is the lowest free id from 1, filling gaps", () => {
		expect(nextFreeId([])).toBe(1);
		expect(nextFreeId([1, 2, 4])).toBe(3);
		expect(nextFreeId([2, 3])).toBe(1);
	});
	it("is undefined when 1..999 are all used", () => {
		expect(nextFreeId(Array.from({ length: 999 }, (_, i) => i + 1))).toBeUndefined();
	});
});

describe("aliases (L6, L7)", () => {
	it("accepts an iRite identifier of up to 8 characters", () => {
		expect(validateAlias("lbIN", [])).toBeUndefined();
		expect(validateAlias("a_1", [])).toBeUndefined();
		expect(validateAlias("lblPesad", [])).toBeUndefined();
	});
	it("rejects empty, too long, bad first character, bad characters", () => {
		expect(validateAlias("", [])).toMatch(/required/);
		expect(validateAlias("lblPesada", [])).toMatch(/8/);
		expect(validateAlias("1abc", [])).toMatch(/letter/);
		expect(validateAlias("_abc", [])).toMatch(/letter/);
		expect(validateAlias("a-b", [])).toMatch(/letter/);
		expect(validateAlias("a b", [])).toMatch(/letter/);
	});
	it("rejects a duplicate ignoring case", () => {
		expect(validateAlias("LBIN", ["lbIN"])).toMatch(/already/);
	});
	it("default alias is prefix+id, with a letter suffix on collision", () => {
		expect(pickDefaultAlias(4, 7, [])).toBe("lbl7");
		expect(pickDefaultAlias(4, 7, ["LBL7"])).toBe("lbl7b");
		expect(pickDefaultAlias(1, 7, [])).toBeUndefined();
	});
	it("scale has no alias; line and softkey have a derived one that is not stored", () => {
		expect(displayAlias(1, 3, undefined)).toBeUndefined();
		expect(displayAlias(10, 22, undefined)).toBe("line22");
		expect(displayAlias(9, 5, undefined)).toBe("sk5");
		expect(displayAlias(4, 3, "lbIN")).toBe("lbIN");
	});
});

describe("main.iri hint (S10)", () => {
	it("formats a constant line: alias padded to 10", () => {
		expect(constantLine("lbIN", 3)).toBe("lbIN      : constant integer := 3;");
		expect(constantLine("lblPesada1", 12)).toBe("lblPesada1: constant integer := 12;");
	});
	it("lists added, renamed (old to new) and removed constants", () => {
		const h = iriHint([{ id: 3, alias: "lbIN" }, { id: 4, alias: "lbl4" }, { id: 5, alias: "x" }], [{ id: 3, alias: "lbOUT" }, { id: 4, alias: "lbl4" }, { id: 9, alias: "bar9" }]);
		expect(h.add).toEqual(["bar9      : constant integer := 9;"]);
		expect(h.change).toEqual([{ old: "lbIN      : constant integer := 3;", new: "lbOUT     : constant integer := 3;" }]);
		expect(h.remove).toEqual(["x         : constant integer := 5;"]);
	});
	it("is empty when nothing changed", () => {
		expect(iriHint([{ id: 1, alias: "a" }], [{ id: 1, alias: "a" }])).toEqual({ add: [], change: [], remove: [] });
	});
});
