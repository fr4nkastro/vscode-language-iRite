import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	editLabel,
	effectiveGeometry,
	emptyEditState,
	isDirty,
	parseEditState,
	serializeEditState,
	setGeometry,
	toPatches,
	withEdits,
} from "../../src/editor/editState";
import { parseEditorMessage } from "../../src/editor/messages";
import { parseRev } from "../../src/rev";
import { applyWidgetPatches } from "../../src/rev/serialize";

const bytes = readFileSync(join(__dirname, "../fixtures/editor/main.rev"));
const rev = parseRev(bytes.toString("utf8"));
const label = rev.widgets.find((w) => w.id === 3)!;
const scale = rev.widgets.find((w) => w.type === 1)!;

describe("edit state", () => {
	it("starts clean and produces no patches", () => {
		const s = emptyEditState();
		expect(isDirty(rev, s)).toBe(false);
		expect(toPatches(rev, s)).toEqual([]);
	});

	it("records only the widgets whose geometry really differs from the file", () => {
		const moved = setGeometry(emptyEditState(), rev, 3, { x: (label.x ?? 0) + 4 });
		expect(moved.ok).toBe(true);
		if (!moved.ok) return;
		expect(isDirty(rev, moved.state)).toBe(true);
		expect(toPatches(rev, moved.state)).toEqual([{ id: 3, x: (label.x ?? 0) + 4, y: label.y, width: label.width, height: label.height }]);
		// Moving it back makes the document clean again: nothing to write.
		const back = setGeometry(moved.state, rev, 3, { x: label.x });
		expect(back.ok && isDirty(rev, back.state)).toBe(false);
	});

	it("rounds and clamps what the page sends and keeps width/height at least 1", () => {
		const r = setGeometry(emptyEditState(), rev, 3, { x: 10.6, y: 1e9, w: 0, h: -5 });
		expect(r.ok && r.geometry).toEqual({ x: 11, y: 10000, width: 1, height: 1 });
	});

	it("rejects an unknown id, non-numbers, and a size for a widget that does not store one", () => {
		expect(setGeometry(emptyEditState(), rev, 424242, { x: 1 }).ok).toBe(false);
		expect(setGeometry(emptyEditState(), rev, 3, { x: Number.NaN }).ok).toBe(false);
		expect(setGeometry(emptyEditState(), rev, 3, { x: "1" as unknown as number }).ok).toBe(false);
		expect(setGeometry(emptyEditState(), rev, scale.id, { w: 10 }).ok).toBe(false);
		expect(setGeometry(emptyEditState(), rev, scale.id, { x: 10, y: 11 }).ok).toBe(true);
	});

	it("overlays the edits on the widgets without changing the others", () => {
		const s = setGeometry(emptyEditState(), rev, 3, { x: 500 });
		if (!s.ok) throw new Error("setup");
		const ws = withEdits(rev.widgets, s.state);
		expect(ws.find((w) => w.id === 3)!.x).toBe(500);
		expect(ws.filter((w) => w.id !== 3)).toEqual(rev.widgets.filter((w) => w.id !== 3));
		expect(effectiveGeometry(label, s.state).x).toBe(500);
	});

	it("moving one widget and saving changes exactly one WDGT line (end to end with the serializer)", () => {
		const s = setGeometry(emptyEditState(), rev, 3, { x: 321, y: 123 });
		if (!s.ok) throw new Error("setup");
		const before = bytes.toString("latin1");
		const after = applyWidgetPatches(before, toPatches(rev, s.state));
		const a = before.split("\n");
		const b = after.split("\n");
		expect(b.length).toBe(a.length);
		expect(a.filter((l, i) => l !== b[i])).toHaveLength(1);
	});

	it("labels edits for the undo menu", () => {
		expect(editLabel(label, { x: 99 })).toBe("Move widget 3");
		expect(editLabel(label, { w: 99 })).toBe("Resize widget 3");
		expect(editLabel(label, { x: 1, w: 1 })).toBe("Edit widget 3");
	});

	it("round-trips through the hot-exit backup and drops junk and unknown widgets", () => {
		const s = setGeometry(emptyEditState(), rev, 3, { x: 77 });
		if (!s.ok) throw new Error("setup");
		expect(parseEditState(JSON.parse(serializeEditState(s.state)), rev)).toEqual(s.state);
		expect(parseEditState({ geom: { "424242": { x: 1, y: 1 }, "3": { x: "no", y: 1 } } }, rev)).toEqual(emptyEditState());
		expect(parseEditState("junk", rev)).toEqual(emptyEditState());
	});
});

describe("webview messages are validated on the extension side", () => {
	const ids = new Set(rev.widgets.map((w) => w.id));
	it("accepts a well-formed edit for a known widget", () => {
		expect(parseEditorMessage({ type: "edit", id: 3, x: 5, y: 6 }, ids)).toEqual({ type: "edit", id: 3, patch: { x: 5, y: 6 } });
	});
	it("rejects edits for unknown ids, non-integer ids and junk shapes", () => {
		for (const m of [{ type: "edit", id: 424242, x: 1 }, { type: "edit", id: 1.5, x: 1 }, { type: "edit", id: "3", x: 1 }, { type: "edit" }, null, "x", 5, { type: "format-disk" }]) {
			expect(parseEditorMessage(m, ids)).toBeUndefined();
		}
	});
	it("drops non-numeric fields instead of trusting them", () => {
		expect(parseEditorMessage({ type: "edit", id: 3, x: "9", y: 4, w: null }, ids)).toEqual({ type: "edit", id: 3, patch: { y: 4 } });
	});
	it("ignores an edit that carries no geometry at all", () => {
		expect(parseEditorMessage({ type: "edit", id: 3 }, ids)).toBeUndefined();
	});
	it("accepts view state and prefs, bounded", () => {
		expect(parseEditorMessage({ type: "state", state: { screen: "2", panel: "12" } }, ids)).toMatchObject({ type: "state", state: { screen: "2", panel: "12" } });
		expect(parseEditorMessage({ type: "prefs", snap: true, grid: 16 }, ids)).toEqual({ type: "prefs", snap: true, grid: 16 });
		expect(parseEditorMessage({ type: "prefs", snap: true, grid: 99999 }, ids)).toEqual({ type: "prefs", snap: true, grid: 8 });
		expect(parseEditorMessage({ type: "prefs", snap: "yes", grid: 4 }, ids)).toBeUndefined();
	});
});
