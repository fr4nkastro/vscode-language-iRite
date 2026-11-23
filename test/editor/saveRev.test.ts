import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { changedIds, emptyEditState, setGeometry } from "../../src/editor/editState";
import type { EditState } from "../../src/editor/editState";
import { planSave, planSaveOps } from "../../src/editor/saveRev";
import { parseRev } from "../../src/rev";
import { computeConfigHash, readConfigHash } from "../../src/rev/configHash";
import { RevWriteError } from "../../src/rev/serialize";
import type { WidgetOp } from "../../src/rev/serialize";
import { crlfFixture, goldenPath, hasGolden } from "../rev/revFixtures";

const original = readFileSync(join(__dirname, "../fixtures/editor/main.rev"));
const rev = parseRev(original.toString("utf8"));

function edit(...steps: Array<[number, Parameters<typeof setGeometry>[3]]>): EditState {
	let s = emptyEditState();
	for (const [id, patch] of steps) {
		const r = setGeometry(s, rev, id, patch);
		if (!r.ok) throw new Error(r.reason);
		s = r.state;
	}
	return s;
}

describe("planSave", () => {
	it("open + save without edits writes nothing (the file stays byte-identical)", () => {
		expect(planSave(original, emptyEditState())).toBeUndefined();
	});

	it("an edit that is moved back produces no write either", () => {
		const w = rev.widgets.find((x) => x.id === 3)!;
		expect(planSave(original, edit([3, { x: 500 }], [3, { x: w.x }]))).toBeUndefined();
	});

	it("moving one widget changes exactly one widget line (plus the ConfigHash header) and keeps BOM and CRLF", () => {
		const plan = planSave(original, edit([3, { x: 500 }]))!;
		expect(plan.changed).toEqual([3]);
		const a = original.toString("latin1").split("\n");
		const b = plan.bytes.toString("latin1").split("\n");
		expect(a.filter((l, i) => l !== b[i] && !l.includes("<ConfigHash"))).toHaveLength(1);
		expect(plan.bytes.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
		expect(plan.model.widgets.find((w) => w.id === 3)!.x).toBe(500);
	});

	it("keeps every non-widget byte except the ConfigHash header, which is recomputed; CustomHash is untouched", () => {
		const plan = planSave(original, edit([3, { x: 500 }, ], [4, { y: 1 }]))!;
		const strip = (b: Buffer): string => b.toString("latin1").split("\n").filter((l) => !l.startsWith("WDGT#") && !l.includes("<ConfigHash")).join("\n");
		expect(strip(plan.bytes)).toBe(strip(original));
		expect(readConfigHash(plan.bytes.toString("latin1"))).toBe(computeConfigHash(plan.bytes.toString("latin1")));
		expect(plan.bytes.toString("latin1")).toContain(original.toString("latin1").match(/<CustomHash[^>]*>/)![0]);
	});

	it("saving twice from the saved bytes is stable", () => {
		const first = planSave(original, edit([3, { x: 500 }]))!;
		expect(planSave(first.bytes, emptyEditState())).toBeUndefined();
	});
});

describe("changedIds", () => {
	it("lists the widgets whose geometry differs between two states (used by undo/redo sync)", () => {
		const a = edit([3, { x: 500 }]);
		const b = edit([3, { x: 500 }], [4, { y: 9 }]);
		expect(changedIds(a, b)).toEqual([4]);
		expect(changedIds(emptyEditState(), a)).toEqual([3]);
		expect(changedIds(a, a)).toEqual([]);
	});
});

describe("planSaveOps: add, remove and edit with ConfigHash recomputed (L5)", () => {
	const crlf = crlfFixture("hashed.rev");
	const orig = Buffer.from(crlf, "latin1");
	const widgetTokens = ["4", "10", "20", "76", "20", "New", "2", "1", "12", "Black", "lbl13", "1", "1", "1", "1", "2"];
	const lines = (b: Buffer): string[] => b.toString("latin1").split("\n");
	const diff = (a: Buffer, b: Buffer) => {
		const sa = new Set(lines(a));
		const sb = new Set(lines(b));
		return { removed: lines(a).filter((l) => !sb.has(l)), added: lines(b).filter((l) => !sa.has(l)) };
	};
	const hashLine = (l: string): boolean => l.includes("<ConfigHash");

	it("no ops writes nothing", () => {
		expect(planSaveOps(orig, [])).toBeUndefined();
		expect(planSaveOps(orig, [{ kind: "patch", id: 4, fields: { alias: "lbl4" } }])).toBeUndefined();
	});

	it("adding one widget adds exactly one WDGT line plus the new ConfigHash line", () => {
		const plan = planSaveOps(orig, [{ kind: "add", id: 13, tokens: widgetTokens }])!;
		expect(plan.added).toEqual([13]);
		expect(plan.changed).toEqual([]);
		expect(plan.removed).toEqual([]);
		const d = diff(orig, plan.bytes);
		expect(d.added.filter((l) => !hashLine(l))).toHaveLength(1);
		expect(d.removed.filter((l) => !hashLine(l))).toEqual([]);
		expect(d.added.filter(hashLine)).toHaveLength(1);
		expect(readConfigHash(plan.bytes.toString("latin1"))).toBe(computeConfigHash(plan.bytes.toString("latin1")));
		expect(plan.bytes.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
		expect(plan.model.widgets.map((w) => w.id)).toContain(13);
	});

	it("deleting removes exactly one line; editing one property changes exactly one", () => {
		const del = planSaveOps(orig, [{ kind: "remove", id: 2 }])!;
		expect(del.removed).toEqual([2]);
		expect(diff(orig, del.bytes).removed.filter((l) => !hashLine(l))).toHaveLength(1);
		expect(diff(orig, del.bytes).added.filter((l) => !hashLine(l))).toHaveLength(0);
		const ed = planSaveOps(orig, [{ kind: "patch", id: 4, fields: { color: "Red" } }])!;
		expect(ed.changed).toEqual([4]);
		expect(diff(orig, ed.bytes).added.filter((l) => !hashLine(l))).toHaveLength(1);
		expect(ed.model.widgets.find((w) => w.id === 4)!.props.color).toBe("Red");
	});

	it("escaped text round-trips through the save plan", () => {
		const plan = planSaveOps(orig, [{ kind: "patch", id: 4, fields: { caption: "x & <NL> y" } }])!;
		expect(plan.model.widgets.find((w) => w.id === 4)!.props.caption).toBe("x & <NL> y");
		expect(plan.bytes.toString("latin1")).toContain("x &amp; &lt;NL&gt; y");
	});

	it("LF-only and no-BOM files keep their style; the hash is the CRLF-text hash either way", () => {
		const lf = Buffer.from(crlf.replace(/\r\n/g, "\n"), "latin1");
		const noBom = Buffer.from(crlf.slice(3), "latin1");
		const ops: WidgetOp[] = [{ kind: "add", id: 13, tokens: widgetTokens }];
		const a = planSaveOps(lf, ops)!;
		const b = planSaveOps(noBom, ops)!;
		const c = planSaveOps(orig, ops)!;
		expect(a.bytes.includes(Buffer.from("\r"))).toBe(false);
		expect(b.bytes.subarray(0, 5).toString("latin1")).toBe("<?xml");
		expect(readConfigHash(a.bytes.toString("latin1"))).toBe(readConfigHash(c.bytes.toString("latin1")));
		expect(readConfigHash(b.bytes.toString("latin1"))).toBe(readConfigHash(c.bytes.toString("latin1")));
	});

	it("an unknown-type line is patchable and removable without touching the others", () => {
		const p = planSaveOps(orig, [{ kind: "patch", id: 12, fields: { "3": 9 } }])!;
		expect(diff(orig, p.bytes).added.filter((l) => !hashLine(l))).toEqual(["WDGT#12=99,1,2,9\r"]);
		const r = planSaveOps(orig, [{ kind: "remove", id: 12 }])!;
		expect(diff(orig, r.bytes).removed.filter((l) => !hashLine(l))).toEqual(["WDGT#12=99,1,2,3\r"]);
	});

	it("refuses unsafe values and leaves the original bytes untouched", () => {
		const snapshot = Buffer.from(orig);
		const bad: WidgetOp[] = [
			{ kind: "patch", id: 4, fields: { caption: "a,b" } },
			{ kind: "patch", id: 4, fields: { caption: "a\nb" } },
			{ kind: "patch", id: 4, fields: { caption: "a\rb" } },
			{ kind: "patch", id: 7, fields: { path: "z".repeat(260) } },
			{ kind: "add", id: 4, tokens: widgetTokens },
			{ kind: "add", id: 1000, tokens: widgetTokens },
			{ kind: "remove", id: 777 },
		];
		for (const op of bad) {
			expect(() => planSaveOps(orig, [op])).toThrow(RevWriteError);
		}
		expect(orig.equals(snapshot)).toBe(true);
	});

	const name = "dole-00fe873.rev";
	it.skipIf(!hasGolden(name))("golden DOLE blob: add / delete / edit each touch one widget line plus the hash, and the hash stays valid", () => {
		const real = readFileSync(goldenPath(name));
		expect(readConfigHash(real.toString("latin1"))).toBe(computeConfigHash(real.toString("latin1")));
		expect(planSaveOps(real, [])).toBeUndefined();
		const model = parseRev(real.toString("utf8"));
		const free = [...Array(999).keys()].map((i) => i + 1).find((i) => !model.widgets.some((w) => w.id === i))!;
		for (const [ops, added, removed] of [
			[[{ kind: "add", id: free, tokens: ["10", 1, 2, 80, 1, 1, 1, "Black", 2] }], 1, 0],
			[[{ kind: "remove", id: model.widgets[3].id }], 0, 1],
			[[{ kind: "patch", id: model.widgets.find((w) => w.type === 4)!.id, fields: { color: "#010203" } }], 1, 1],
		] as Array<[WidgetOp[], number, number]>) {
			const plan = planSaveOps(real, ops)!;
			const d = diff(real, plan.bytes);
			expect(d.added.filter((l) => !hashLine(l))).toHaveLength(added);
			expect(d.removed.filter((l) => !hashLine(l))).toHaveLength(removed);
			expect(readConfigHash(plan.bytes.toString("latin1"))).toBe(computeConfigHash(plan.bytes.toString("latin1")));
		}
	});
});
