import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { changedIds, emptyEditState, setGeometry } from "../../src/editor/editState";
import type { EditState } from "../../src/editor/editState";
import { planSave } from "../../src/editor/saveRev";
import { parseRev } from "../../src/rev";

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

	it("moving one widget changes exactly one line and keeps BOM and CRLF", () => {
		const plan = planSave(original, edit([3, { x: 500 }]))!;
		expect(plan.changed).toEqual([3]);
		const a = original.toString("latin1").split("\n");
		const b = plan.bytes.toString("latin1").split("\n");
		expect(a.filter((l, i) => l !== b[i])).toHaveLength(1);
		expect(plan.bytes.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
		expect(plan.model.widgets.find((w) => w.id === 3)!.x).toBe(500);
	});

	it("keeps every non-widget byte, including both hashes", () => {
		const plan = planSave(original, edit([3, { x: 500 }, ], [4, { y: 1 }]))!;
		const strip = (b: Buffer): string => b.toString("latin1").split("\n").filter((l) => !l.startsWith("WDGT#")).join("\n");
		expect(strip(plan.bytes)).toBe(strip(original));
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
