import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseRev } from "../../src/rev";
import { RevWriteError, applyWidgetOps, checkWidgetToken } from "../../src/rev/serialize";
import type { WidgetOp } from "../../src/rev/serialize";
import { crlfFixture, goldenPath, hasGolden, utf8 } from "./revFixtures";

const crlf = crlfFixture("hashed.rev");
const lf = crlf.replace(/\r\n/g, "\n");
const noBom = crlf.slice(3);

const lines = (t: string): string[] => t.split("\n");
/** Line-level diff of two texts (same length): indexes that differ. */
function diff(a: string, b: string): { removed: string[]; added: string[] } {
	const sa = new Set(lines(a));
	const sb = new Set(lines(b));
	return { removed: lines(a).filter((l) => !sb.has(l)), added: lines(b).filter((l) => !sa.has(l)) };
}
const patch = (id: number, fields: Record<string, string | number>): WidgetOp => ({ kind: "patch", id, fields });
const props = (t: string, id: number) => parseRev(utf8(t)).widgets.find((w) => w.id === id)!.props;

describe("applyWidgetOps: patch any field", () => {
	it("no ops or an unchanged value return the very same bytes", () => {
		expect(applyWidgetOps(crlf, [])).toBe(crlf);
		expect(applyWidgetOps(crlf, [patch(4, { alias: "lbl4", fontSize: 18 })])).toBe(crlf);
	});

	it("edits one property by name: exactly one changed line", () => {
		const out = applyWidgetOps(crlf, [patch(4, { color: "Red" })]);
		const d = diff(crlf, out);
		expect(d.removed).toHaveLength(1);
		expect(d.added).toHaveLength(1);
		expect(d.added[0]).toContain("WDGT#4=4,170,160,221,28,");
		expect(d.added[0].endsWith("\r")).toBe(true);
		expect(props(out, 4).color).toBe("Red");
		expect(props(out, 4).caption).toBe("Total & <NL> ñ");
	});

	it("edits several fields at once, by name or by catalog index", () => {
		const out = applyWidgetOps(crlf, [patch(3, { orientation: 2, "13": 3, visible: "2" })]);
		const p = props(out, 3);
		expect(p).toMatchObject({ orientation: "2", dataSubField: "3", visible: "2", alias: "bar3" });
		expect(diff(crlf, out).added).toHaveLength(1);
	});

	it("patches types the old geometry API refused (type 11 monospace, type 8 chart, type 9 softkey)", () => {
		const out = applyWidgetOps(crlf, [patch(11, { x: 5 }), patch(8, { chartStyle: 2 }), patch(9, { orientation: 2 })]);
		expect(props(out, 11).x).toBe("5");
		expect(props(out, 8).chartStyle).toBe("2");
		expect(props(out, 9).orientation).toBe("2");
		expect(diff(crlf, out).added).toHaveLength(3);
	});

	it("XML-escapes only & < > and writes non-ASCII as UTF-8; quotes stay raw", () => {
		const out = applyWidgetOps(crlf, [patch(4, { caption: 'A & <NL> "q" ñ' })]);
		expect(out).toContain('WDGT#4=4,170,160,221,28,A &amp; &lt;NL&gt; "q" ' + Buffer.from("ñ", "utf8").toString("latin1") + ",2,1,18,");
		expect(props(out, 4).caption).toBe('A & <NL> "q" ñ');
		// an untouched widget with escapes in the file round-trips too
		expect(applyWidgetOps(crlf, [patch(4, { x: 171 })])).toContain("Total &amp; &lt;NL&gt; " + Buffer.from("ñ", "utf8").toString("latin1"));
	});

	it("keeps LF-only files and files without BOM in their own style", () => {
		const a = applyWidgetOps(lf, [patch(4, { color: "Red" })]);
		expect(a.includes("\r")).toBe(false);
		const b = applyWidgetOps(noBom, [patch(4, { color: "Red" })]);
		expect(b.startsWith("<?xml")).toBe(true);
		expect(b.includes("\r\n")).toBe(true);
	});

	it("patches and removes an unknown-type line by index without touching the others", () => {
		const out = applyWidgetOps(crlf, [patch(12, { "2": 7 })]);
		expect(out).toContain("WDGT#12=99,1,7,3\r\n");
		expect(diff(crlf, out).added).toHaveLength(1);
		const gone = applyWidgetOps(crlf, [{ kind: "remove", id: 12 }]);
		expect(diff(crlf, gone)).toEqual({ removed: ["WDGT#12=99,1,2,3\r"], added: [] });
	});

	it("an unknown line cannot be patched by name, and the type token is never rewritten", () => {
		expect(() => applyWidgetOps(crlf, [patch(12, { x: 1 })])).toThrow(RevWriteError);
		expect(() => applyWidgetOps(crlf, [patch(4, { type: 7 })])).toThrow(RevWriteError);
		expect(() => applyWidgetOps(crlf, [patch(4, { "0": 7 })])).toThrow(RevWriteError);
	});

	it("a label line with more tokens than the catalog only allows geometry patches (caption commas or trailing extras are ambiguous)", () => {
		const commas = "<Config>WDGT#1=4,1,2,3,4,Hello, world,1,2,18,#BB0000,lbl1,4,0,0,1,7\r\n</Config>";
		expect(applyWidgetOps(commas, [patch(1, { x: 10 })])).toBe("<Config>WDGT#1=4,10,2,3,4,Hello, world,1,2,18,#BB0000,lbl1,4,0,0,1,7\r\n</Config>");
		expect(() => applyWidgetOps(commas, [patch(1, { color: "Red" })])).toThrow(RevWriteError);
		expect(() => applyWidgetOps(commas, [patch(1, { caption: "Hi" })])).toThrow(RevWriteError);
		const trailing = "<Config>WDGT#1=4,1,2,3,4,Hello,2,1,18,#BB0000,lbl1,4,0,0,1,7,extra1,extra2\r\n</Config>";
		expect(() => applyWidgetOps(trailing, [patch(1, { caption: "NEW" })])).toThrow(/ambiguous/);
		expect(() => applyWidgetOps(trailing, [patch(1, { "5": "NEW" })])).toThrow(RevWriteError);
		expect(applyWidgetOps(trailing, [patch(1, { width: 30 })])).toBe("<Config>WDGT#1=4,1,2,30,4,Hello,2,1,18,#BB0000,lbl1,4,0,0,1,7,extra1,extra2\r\n</Config>");
	});
});

describe("applyWidgetOps: refuses unsafe values (nothing is returned)", () => {
	const bad: Array<[string, WidgetOp]> = [
		["comma in a caption", patch(4, { caption: "a,b" })],
		["CR in a caption", patch(4, { caption: "a\rb" })],
		["LF in a caption", patch(4, { caption: "a\nb" })],
		["comma in an alias", patch(4, { alias: "a,b" })],
		["comma in an image path", patch(7, { path: "a,b.png" })],
		["value over 255 characters", patch(7, { path: "x".repeat(250) })],
		["unknown id", patch(99, { x: 1 })],
		["unknown field name", patch(4, { nope: 1 })],
		["index past the end of the line", patch(4, { "30": 1 })],
		["non-integer number", patch(4, { x: 1.5 })],
		["text in an integer field", patch(4, { x: "abc" })],
		["enum out of range", patch(4, { visible: 3 })],
		["screen out of range", patch(4, { screen: 100 })],
		["zero width", patch(4, { width: 0 })],
		["remove of an unknown id", { kind: "remove", id: 500 }],
	];
	for (const [why, op] of bad) {
		it(why, () => {
			const before = crlf.slice();
			expect(() => applyWidgetOps(crlf, [op])).toThrow(RevWriteError);
			expect(crlf).toBe(before);
		});
	}

	it("a duplicated id in the file is refused for patch and remove", () => {
		const dup = crlf.replace("WDGT#12=99,1,2,3\r\n", "WDGT#12=99,1,2,3\r\nWDGT#4=4,1,1,1,1,x,1,1,1,Black,l,1,1,1,1,1\r\n");
		expect(() => applyWidgetOps(dup, [patch(4, { x: 1 })])).toThrow(/more than once/);
		expect(() => applyWidgetOps(dup, [{ kind: "remove", id: 4 }])).toThrow(/more than once/);
	});

	it("is atomic: a failing second op throws", () => {
		expect(() => applyWidgetOps(crlf, [patch(4, { x: 1 }), patch(4, { caption: "a,b" })])).toThrow(RevWriteError);
	});

	it("a file without Config is refused", () => {
		expect(() => applyWidgetOps("<Indicator/>", [patch(1, { x: 1 })])).toThrow(/no <Config>/);
	});

	it("checkWidgetToken explains the problem", () => {
		expect(checkWidgetToken(4, "caption", "a,b")).toMatch(/comma/);
		expect(checkWidgetToken(4, "visible", "2")).toBeUndefined();
		expect(checkWidgetToken(4, "visible", "3")).toMatch(/visible/);
	});
});

describe("applyWidgetOps: append", () => {
	const tokens = ["4", "10", "20", "76", "20", "New & <x>", "2", "1", "12", "Black", "lbl13", "1", "1", "1", "1", "2"];

	it("adds exactly one line right after the last WDGT line, with the file's line ending", () => {
		const out = applyWidgetOps(crlf, [{ kind: "add", id: 13, tokens }]);
		const d = diff(crlf, out);
		expect(d.removed).toEqual([]);
		expect(d.added).toEqual(["WDGT#13=4,10,20,76,20,New &amp; &lt;x&gt;,2,1,12,Black,lbl13,1,1,1,1,2\r"]);
		const l = lines(out);
		expect(l[l.indexOf("AUTOBKLGHT#1=ON\r") - 1]).toBe(d.added[0]);
		expect(l[l.indexOf(d.added[0]) - 1]).toBe("WDGT#12=99,1,2,3\r");
		expect(props(out, 13).caption).toBe("New & <x>");
	});

	it("uses LF in an LF file", () => {
		const out = applyWidgetOps(lf, [{ kind: "add", id: 13, tokens }]);
		expect(out.includes("\r")).toBe(false);
		expect(diff(lf, out).added).toHaveLength(1);
	});

	it("accepts numbers as tokens", () => {
		const out = applyWidgetOps(crlf, [{ kind: "add", id: 14, tokens: [10, 1, 2, 80, 1, 1, 1, "Black", 2] }]);
		expect(props(out, 14)).toMatchObject({ width: "80", color: "Black" });
	});

	it("appends at the end of Config when there is no widget yet", () => {
		const t = "<Config>A=1\r\n</Config>";
		expect(applyWidgetOps(t, [{ kind: "add", id: 1, tokens: ["10", 1, 2, 80, 1, 1, 1, "Black", 2] }])).toBe("<Config>A=1\r\nWDGT#1=10,1,2,80,1,1,1,Black,2\r\n</Config>");
	});

	it("appends after a final WDGT line that has no terminator", () => {
		const t = "<Config>WDGT#1=10,1,2,80,1,1,1,Black,2</Config>";
		const out = applyWidgetOps(t, [{ kind: "add", id: 2, tokens: ["10", 1, 2, 80, 1, 1, 1, "Black", 2] }]);
		expect(out).toBe("<Config>WDGT#1=10,1,2,80,1,1,1,Black,2\nWDGT#2=10,1,2,80,1,1,1,Black,2</Config>");
	});

	const refused: Array<[string, WidgetOp]> = [
		["an id already used", { kind: "add", id: 4, tokens }],
		["id 0", { kind: "add", id: 0, tokens }],
		["id 1000", { kind: "add", id: 1000, tokens }],
		["a non-integer id", { kind: "add", id: 1.5, tokens }],
		["a wrong token count", { kind: "add", id: 13, tokens: tokens.slice(1) }],
		["an unknown type", { kind: "add", id: 13, tokens: ["99", "1"] }],
		["a comma in a token", { kind: "add", id: 13, tokens: tokens.map((t, i) => (i === 5 ? "a,b" : t)) }],
		["an LF in a token", { kind: "add", id: 13, tokens: tokens.map((t, i) => (i === 5 ? "a\nb" : t)) }],
		["an enum out of range", { kind: "add", id: 13, tokens: tokens.map((t, i) => (i === 6 ? "9" : t)) }],
		["a value over 255 characters", { kind: "add", id: 13, tokens: ["7", "1", "2", "3", "4", "1", "1", "0", "p".repeat(250), "1", "img13"] }],
	];
	for (const [why, op] of refused) {
		it(`refuses ${why}`, () => {
			expect(() => applyWidgetOps(crlf, [op])).toThrow(RevWriteError);
		});
	}

	it("refuses to add the same id twice", () => {
		expect(() =>
			applyWidgetOps(crlf, [
				{ kind: "add", id: 13, tokens },
				{ kind: "add", id: 13, tokens },
			]),
		).toThrow(RevWriteError);
	});
});

describe("applyWidgetOps: remove", () => {
	it("removes exactly one line including its line ending", () => {
		const out = applyWidgetOps(crlf, [{ kind: "remove", id: 2 }]);
		expect(diff(crlf, out)).toEqual({ removed: ["WDGT#2=2,10,10,80,80,1,1,bit2,1,1\r"], added: [] });
		expect(lines(out)).toHaveLength(lines(crlf).length - 1);
		expect(parseRev(utf8(out)).widgets.map((w) => w.id)).not.toContain(2);
	});

	it("removing the last line of a Config without final terminator keeps the file well formed", () => {
		const t = "<Config>A=1\r\nWDGT#1=10,1,2,80,1,1,1,Black,2</Config>";
		expect(applyWidgetOps(t, [{ kind: "remove", id: 1 }])).toBe("<Config>A=1</Config>");
	});

	it("an id removed and added again is allowed (a replacement)", () => {
		const out = applyWidgetOps(crlf, [
			{ kind: "remove", id: 2 },
			{ kind: "add", id: 2, tokens: ["2", 1, 1, 80, 80, 1, 1, "bit2", 1, 1] },
		]);
		expect(parseRev(utf8(out)).widgets.filter((w) => w.id === 2)).toHaveLength(1);
	});
});

describe("golden: DOLE blob 00fe873 (skipped without the scratch copy)", () => {
	const name = "dole-00fe873.rev";
	const real = hasGolden(name) ? readFileSync(goldenPath(name)).toString("latin1") : "";
	const ids = (t: string) => parseRev(utf8(t)).widgets.map((w) => w.id);

	it.skipIf(!hasGolden(name))("an unmodified copy round-trips byte for byte", () => {
		expect(applyWidgetOps(real, [])).toBe(real);
	});

	it.skipIf(!hasGolden(name))("adding one widget adds exactly one WDGT line", () => {
		const free = [...Array(999).keys()].map((i) => i + 1).find((i) => !ids(real).includes(i))!;
		const out = applyWidgetOps(real, [{ kind: "add", id: free, tokens: ["10", 1, 2, 80, 1, 1, 1, "Black", 2] }]);
		const d = diff(real, out);
		expect(d.removed).toEqual([]);
		expect(d.added).toHaveLength(1);
		expect(ids(out)).toHaveLength(ids(real).length + 1);
	});

	it.skipIf(!hasGolden(name))("deleting removes exactly one line", () => {
		const out = applyWidgetOps(real, [{ kind: "remove", id: ids(real)[5] }]);
		const d = diff(real, out);
		expect(d.removed).toHaveLength(1);
		expect(d.added).toEqual([]);
	});

	it.skipIf(!hasGolden(name))("editing one property changes exactly one line", () => {
		const label = parseRev(utf8(real)).widgets.find((w) => w.type === 4)!;
		const out = applyWidgetOps(real, [patch(label.id, { color: "#123456" })]);
		const d = diff(real, out);
		expect(d.removed).toHaveLength(1);
		expect(d.added).toHaveLength(1);
		expect(props(out, label.id).color).toBe("#123456");
	});
});
