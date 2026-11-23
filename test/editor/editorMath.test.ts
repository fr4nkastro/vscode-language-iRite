import { describe, expect, it } from "vitest";
import { EDITOR_MATH_SOURCE, createEditorMath, editorMath } from "../../src/editor/editorMath";
import { panelGeometry } from "../../src/preview/panels";

const m = editorMath;
const rect = { x: 100, y: 50, w: 80, h: 40 };

describe("snap", () => {
	it("rounds to the nearest grid multiple", () => {
		expect(m.snap(13, 8)).toBe(16);
		expect(m.snap(11, 8)).toBe(8);
		expect(m.snap(-5, 8)).toBe(-8);
	});
	it("only rounds to an integer when snapping is off or the grid is not usable", () => {
		expect(m.snap(13.4, 0)).toBe(13);
		expect(m.snap(13.6, 1)).toBe(14);
		expect(m.snap(13.4, Number.NaN)).toBe(13);
	});
});

describe("coordinates: edit in 7 inch space", () => {
	it("converts a pointer delta on screen back to authored 7 inch units", () => {
		expect(m.toAuthored(100, 1, 1)).toBe(100);
		expect(m.toAuthored(160, 1, panelGeometry("12").scale)).toBeCloseTo(100, 9);
		expect(m.toAuthored(80, 0.5, 1.6)).toBeCloseTo(100, 9);
	});
	it("a drag of 160 screen pixels on the 12 inch view moves the widget by 100 authored pixels", () => {
		const d = m.toAuthored(160, 1, panelGeometry("12").scale);
		expect(m.move(rect, d, 0, 0)).toEqual({ x: 200, y: 50 });
	});
	it("is the identity on the 7 inch panel", () => {
		expect(m.toAuthored(37, 1, panelGeometry("7").scale)).toBe(37);
	});
});

describe("move", () => {
	it("moves by the delta and rounds", () => {
		expect(m.move(rect, 10.4, -3.2, 0)).toEqual({ x: 110, y: 47 });
	});
	it("snaps the resulting position, not the delta", () => {
		expect(m.move(rect, 3, 3, 8)).toEqual({ x: 104, y: 56 });
	});
	it("never leaves the allowed coordinate range", () => {
		const r = m.move(rect, 1e9, -1e9, 0);
		expect(r).toEqual({ x: m.COORD_MAX, y: m.COORD_MIN });
	});
});

describe("resize", () => {
	it("east and south handles grow the box", () => {
		expect(m.resize(rect, "se", 10, 6, 0)).toEqual({ x: 100, y: 50, w: 90, h: 46 });
	});
	it("west and north handles move the origin and keep the opposite edge fixed", () => {
		expect(m.resize(rect, "nw", -10, -6, 0)).toEqual({ x: 90, y: 44, w: 90, h: 46 });
	});
	it("single-axis handles change a single axis", () => {
		expect(m.resize(rect, "e", 5, 99, 0)).toEqual({ x: 100, y: 50, w: 85, h: 40 });
		expect(m.resize(rect, "n", 99, -4, 0)).toEqual({ x: 100, y: 46, w: 80, h: 44 });
	});
	it("snaps the edge that moves", () => {
		expect(m.resize(rect, "e", 5, 0, 8)).toEqual({ x: 100, y: 50, w: 84, h: 40 });
	});
	it("never collapses below 1 pixel and never flips", () => {
		const r = m.resize(rect, "w", 500, 0, 0);
		expect(r.w).toBe(1);
		expect(r.x + r.w).toBe(180);
		expect(m.resize(rect, "s", 0, -500, 0).h).toBe(1);
	});
});

describe("nudge", () => {
	it("arrow keys move one pixel", () => {
		expect(m.nudge(rect, "ArrowRight", false, 8)).toEqual({ x: 101, y: 50 });
		expect(m.nudge(rect, "ArrowUp", false, 8)).toEqual({ x: 100, y: 49 });
	});
	it("shift moves one grid step, or 10 pixels when the grid is off", () => {
		expect(m.nudge(rect, "ArrowLeft", true, 8)).toEqual({ x: 92, y: 50 });
		expect(m.nudge(rect, "ArrowDown", true, 0)).toEqual({ x: 100, y: 60 });
	});
	it("ignores other keys", () => {
		expect(m.nudge(rect, "a", false, 8)).toBeUndefined();
	});
});

describe("embedding", () => {
	it("the source embedded in the webview is the same self-contained code", () => {
		const embedded = new Function(`return ${EDITOR_MATH_SOURCE}`)() as ReturnType<typeof createEditorMath>;
		expect(embedded.resize(rect, "se", 10, 6, 0)).toEqual(m.resize(rect, "se", 10, 6, 0));
		expect(embedded.snap(13, 8)).toBe(16);
		expect(embedded.nudge(rect, "ArrowDown", true, 8)).toEqual({ x: 100, y: 58 });
	});
});
