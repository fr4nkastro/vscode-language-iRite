import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRev } from "../../src/rev";
import { RevWriteError, applyWidgetPatches, computeCustomHash, readCustomHash } from "../../src/rev/serialize";

/** The serializer works on a byte-per-char string (latin1), so it is lossless for any byte sequence. */
const bytes = readFileSync(join(__dirname, "../fixtures/editor/main.rev"));
const text = bytes.toString("latin1");
const widget = (id: number) => parseRev(text).widgets.find((w) => w.id === id)!;

function diffLines(a: string, b: string): Array<[string, string]> {
	const la = a.split("\n");
	const lb = b.split("\n");
	expect(lb.length).toBe(la.length);
	return la.flatMap((l, i) => (l === lb[i] ? [] : [[l, lb[i]] as [string, string]]));
}

describe("applyWidgetPatches: lossless", () => {
	it("returns the very same bytes when there is nothing to patch", () => {
		expect(Buffer.from(applyWidgetPatches(text, []), "latin1").equals(bytes)).toBe(true);
	});

	it("returns the same bytes when a patch repeats the current values", () => {
		const w = widget(3);
		const out = applyWidgetPatches(text, [{ id: 3, x: w.x, y: w.y, width: w.width, height: w.height }]);
		expect(out).toBe(text);
	});

	it("keeps the BOM and the CRLF endings", () => {
		const out = applyWidgetPatches(text, [{ id: 3, x: 11 }]);
		expect(Buffer.from(out, "latin1").subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
		expect(out.split("\n").every((l, i, all) => i === all.length - 1 || l.endsWith("\r"))).toBe(true);
	});

	it("survives bytes that are not valid UTF-8 (they are never decoded)", () => {
		const odd = text.replace("<Revision", '<Revision a="\xe9\xff"');
		expect(applyWidgetPatches(odd, [{ id: 3, x: 1 }]).includes('"\xe9\xff"')).toBe(true);
	});
});

describe("applyWidgetPatches: one widget, one line", () => {
	it("moving one widget changes exactly one WDGT line, and only its x", () => {
		const before = widget(3);
		const out = applyWidgetPatches(text, [{ id: 3, x: (before.x ?? 0) + 5 }]);
		const d = diffLines(text, out);
		expect(d).toHaveLength(1);
		expect(d[0][0].startsWith("WDGT#3=")).toBe(true);
		const after = parseRev(out).widgets.find((w) => w.id === 3)!;
		expect(after.x).toBe((before.x ?? 0) + 5);
		expect({ ...after, x: before.x, raw: before.raw }).toEqual(before);
	});

	it("resizing a label changes only fields 3 and 4", () => {
		const out = applyWidgetPatches(text, [{ id: 3, width: 111, height: 22 }]);
		const [[a, b]] = diffLines(text, out);
		const fa = a.trimEnd().split(",");
		const fb = b.trimEnd().split(",");
		expect(fb.length).toBe(fa.length);
		fb.forEach((f, i) => (i === 3 ? expect(f).toBe("111") : i === 4 ? expect(f).toBe("22") : expect(f).toBe(fa[i])));
	});

	it("keeps the line terminator of the patched line", () => {
		const [[a, b]] = diffLines(text, applyWidgetPatches(text, [{ id: 7, y: 9 }]));
		expect(a.endsWith("\r") && b.endsWith("\r")).toBe(true);
	});

	it("patches several widgets and leaves every other line alone", () => {
		const out = applyWidgetPatches(text, [
			{ id: 2, x: 1 },
			{ id: 4, y: 2 },
		]);
		const d = diffLines(text, out);
		expect(d.map(([a]) => a.slice(0, 7))).toEqual(["WDGT#2=", "WDGT#4="]);
	});

	it("keeps the widget line order, which is not the id order in DOLE", () => {
		const ids = (s: string) => parseRev(s).widgets.map((w) => w.id);
		const before = ids(text);
		expect(before).not.toEqual([...before].sort((a, b) => a - b));
		expect(ids(applyWidgetPatches(text, [{ id: 9, x: 5 }]))).toEqual(before);
	});

	it("handles a type 4 label whose text holds commas by patching only the leading fields", () => {
		const t = text.replace(/^(WDGT#3=4,[^,]*,[^,]*,[^,]*,[^,]*,)[^,]*/m, "$1Hello, world");
		const before = parseRev(t).widgets.find((w) => w.id === 3)!;
		expect(before.text).toBe("Hello, world");
		const out = applyWidgetPatches(t, [{ id: 3, x: 77 }]);
		const after = parseRev(out).widgets.find((w) => w.id === 3)!;
		expect(after.text).toBe("Hello, world");
		expect(after.x).toBe(77);
		expect(after.raw.slice(5)).toEqual(before.raw.slice(5));
	});

	it("only touches position for widgets that do not store a size (scale, symbol)", () => {
		const scale = parseRev(text).widgets.find((w) => w.type === 1)!;
		const out = applyWidgetPatches(text, [{ id: scale.id, x: 12, y: 34 }]);
		const after = parseRev(out).widgets.find((w) => w.id === scale.id)!;
		expect([after.x, after.y]).toEqual([12, 34]);
		expect(() => applyWidgetPatches(text, [{ id: scale.id, width: 10 }])).toThrow(RevWriteError);
	});

	it("keeps a decimal token verbatim when its value did not change", () => {
		const t = text.replace(/^(WDGT#3=4,)(\d+)(,)/m, "$110.50$3");
		const out = applyWidgetPatches(t, [{ id: 3, x: 10.5, y: 3 }]);
		expect(out.match(/^WDGT#3=4,10\.50,/m)).not.toBeNull();
	});
});

describe("applyWidgetPatches: refuses unsafe requests", () => {
	it("rejects an unknown id", () => {
		expect(() => applyWidgetPatches(text, [{ id: 99999, x: 1 }])).toThrow(/WDGT#99999/);
	});

	it("rejects a duplicated widget id in the file", () => {
		const dup = text.replace("WDGT#4=", "WDGT#3=");
		expect(() => applyWidgetPatches(dup, [{ id: 3, x: 1 }])).toThrow(/more than once/);
	});

	it("rejects non-integer, non-finite and out-of-range numbers", () => {
		for (const x of [Number.NaN, Number.POSITIVE_INFINITY, 1.5, 1e9, -1e9]) {
			expect(() => applyWidgetPatches(text, [{ id: 3, x }])).toThrow(RevWriteError);
		}
	});

	it("rejects a patch for a widget whose line is too short or has a non-numeric field", () => {
		const bad = text.replace(/^WDGT#3=.*$/m, "WDGT#3=4,a,b");
		expect(() => applyWidgetPatches(bad, [{ id: 3, x: 1 }])).toThrow(RevWriteError);
	});

	it("rejects a file without a Config element", () => {
		expect(() => applyWidgetPatches("<Indicator/>", [{ id: 1, x: 1 }])).toThrow(/Config/);
	});

	it("is atomic: a failing second patch throws and returns nothing", () => {
		expect(() =>
			applyWidgetPatches(text, [
				{ id: 3, x: 1 },
				{ id: 99999, x: 1 },
			]),
		).toThrow();
	});
});

describe("hashes", () => {
	it("computeCustomHash reproduces the CustomHash of the file (SHA-1 of the UTF-16LE Printers text)", () => {
		expect(readCustomHash(text)).toBeDefined();
		expect(computeCustomHash(text)).toBe(readCustomHash(text));
	});

	it("a widget edit leaves ConfigHash and CustomHash untouched", () => {
		const out = applyWidgetPatches(text, [{ id: 3, x: 1 }]);
		expect(out.match(/<ConfigHash[^>]*>/)![0]).toBe(text.match(/<ConfigHash[^>]*>/)![0]);
		expect(readCustomHash(out)).toBe(readCustomHash(text));
		expect(computeCustomHash(out)).toBe(readCustomHash(out));
	});
});

describe("golden: the real DOLE main.rev (skipped when the reference project is absent)", () => {
	const dole = join(process.env.USERPROFILE ?? process.env.HOME ?? "", "Documents/localdev/IPESAH/DOLE/main.rev");
	it.skipIf(!existsSync(dole))("round-trips DOLE byte for byte and a one-widget move changes one line", () => {
		const real = readFileSync(dole);
		const t = real.toString("latin1");
		expect(Buffer.from(applyWidgetPatches(t, []), "latin1").equals(real)).toBe(true);
		const w = parseRev(real.toString("utf8")).widgets.find((x) => x.typeName === "label")!;
		const out = applyWidgetPatches(t, [{ id: w.id, x: (w.x ?? 0) + 1 }]);
		expect(diffLines(t, out)).toHaveLength(1);
		expect(computeCustomHash(t)).toBe(readCustomHash(t));
	});
});
