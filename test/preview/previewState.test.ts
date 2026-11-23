import { describe, expect, it } from "vitest";
import { PREVIEW_STATE_SOURCE, previewState as ps } from "../../src/preview/previewState";

describe("hide / show", () => {
	const s0 = ps.emptyState();
	it("starts empty on the 7 inch panel showing every screen", () => {
		expect(s0).toEqual({ screen: "all", panel: "7", hidden: {}, order: {} });
	});
	it("toggles one widget per screen without touching the others", () => {
		const s1 = ps.toggleHidden(ps.toggleHidden(s0, "1", 7), "1", 9);
		expect(s1.hidden).toEqual({ "1": [7, 9] });
		expect(ps.isHidden(s1, "1", 7)).toBe(true);
		expect(ps.isHidden(s1, "2", 7)).toBe(false);
		const s2 = ps.toggleHidden(s1, "1", 7);
		expect(s2.hidden).toEqual({ "1": [9] });
		expect(ps.toggleHidden(s2, "1", 9).hidden).toEqual({});
	});
	it("does not mutate the previous state", () => {
		const s1 = ps.toggleHidden(s0, "1", 7);
		expect(s0.hidden).toEqual({});
		expect(s1).not.toBe(s0);
	});
	it("shows all widgets of one screen, or of every screen when none is given", () => {
		let s = ps.toggleHidden(ps.toggleHidden(s0, "1", 7), "2", 8);
		expect(ps.showAll(s, "1").hidden).toEqual({ "2": [8] });
		expect(ps.showAll(s).hidden).toEqual({});
	});
});

describe("z-order override", () => {
	const ids = [1, 2, 3, 4, 5];
	const s0 = ps.emptyState();
	it("keeps the natural id order without overrides", () => {
		expect(ps.paintOrder(s0, "1", ids)).toEqual(ids);
		expect(ps.hasOrderOverride(s0, "1")).toBe(false);
	});
	it("brings a widget to the front (painted last)", () => {
		expect(ps.paintOrder(ps.bringToFront(s0, "1", 2), "1", ids)).toEqual([1, 3, 4, 5, 2]);
	});
	it("sends a widget to the back (painted first)", () => {
		expect(ps.paintOrder(ps.sendToBack(s0, "1", 4), "1", ids)).toEqual([4, 1, 2, 3, 5]);
	});
	it("the latest operation wins at each end and an opposite operation replaces the earlier one", () => {
		let s = ps.bringToFront(ps.bringToFront(s0, "1", 1), "1", 2);
		expect(ps.paintOrder(s, "1", ids)).toEqual([3, 4, 5, 1, 2]);
		s = ps.sendToBack(s, "1", 1);
		expect(ps.paintOrder(s, "1", ids)).toEqual([1, 3, 4, 5, 2]);
		s = ps.sendToBack(ps.sendToBack(s0, "1", 3), "1", 5);
		expect(ps.paintOrder(s, "1", ids)).toEqual([5, 3, 1, 2, 4]);
	});
	it("ignores overridden ids that are no longer on the screen", () => {
		const s = ps.bringToFront(s0, "1", 99);
		expect(ps.paintOrder(s, "1", ids)).toEqual(ids);
	});
	it("is per screen and resettable on demand", () => {
		const s = ps.bringToFront(s0, "1", 2);
		expect(ps.paintOrder(s, "2", ids)).toEqual(ids);
		expect(ps.hasOrderOverride(s, "1")).toBe(true);
		const reset = ps.resetOrder(s, "1");
		expect(ps.paintOrder(reset, "1", ids)).toEqual(ids);
		expect(reset.order).toEqual({});
	});
});

describe("sanitize (state reported by the webview and re-embedded by the extension)", () => {
	it("keeps a valid state", () => {
		const s = ps.bringToFront(ps.toggleHidden({ ...ps.emptyState(), screen: "12", panel: "12" }, "12", 3), "12", 4);
		expect(ps.sanitize(JSON.parse(JSON.stringify(s)))).toEqual(s);
	});
	it("falls back to defaults for junk", () => {
		expect(ps.sanitize(undefined)).toEqual(ps.emptyState());
		expect(ps.sanitize("x")).toEqual(ps.emptyState());
		expect(ps.sanitize({ screen: 5, panel: "9", hidden: [], order: 3 })).toEqual(ps.emptyState());
	});
	it("drops invalid screens, ids and duplicates", () => {
		const s = ps.sanitize({
			screen: "../x",
			panel: "12",
			hidden: { "1": [3, 3, "4", -1, 1.5, 2], bad: [1], "2": "no" },
			order: { "1": { back: [7, 7, "a"], front: [8] }, x: { back: [1], front: [] } },
		});
		expect(s.screen).toBe("all");
		expect(s.panel).toBe("12");
		expect(s.hidden).toEqual({ "1": [3, 2] });
		expect(s.order).toEqual({ "1": { back: [7], front: [8] } });
	});
	it("bounds the amount of data it accepts", () => {
		const huge = Array.from({ length: 5000 }, (_, i) => i);
		expect(ps.sanitize({ hidden: { "1": huge } }).hidden["1"]?.length).toBeLessThanOrEqual(2000);
	});
});

describe("one step back / forward", () => {
	const nat = [1, 2, 3, 4];
	it("swaps with the neighbour and keeps the rest", () => {
		const s = ps.stepForward(ps.emptyState(), "1", 2, nat);
		expect(ps.paintOrder(s, "1", nat)).toEqual([1, 3, 2, 4]);
		expect(ps.paintOrder(ps.stepBack(s, "1", 4, nat), "1", nat)).toEqual([1, 3, 4, 2]);
	});
	it("does nothing at the ends and for unknown ids", () => {
		const e = ps.emptyState();
		expect(ps.stepBack(e, "1", 1, nat)).toBe(e);
		expect(ps.stepForward(e, "1", 4, nat)).toBe(e);
		expect(ps.stepForward(e, "1", 99, nat)).toBe(e);
	});
	it("steps compose with send to back / bring to front", () => {
		const s = ps.stepForward(ps.sendToBack(ps.emptyState(), "1", 3), "1", 3, nat);
		expect(ps.paintOrder(s, "1", nat)).toEqual([1, 3, 2, 4]);
	});
	it("returning to the natural order drops the override", () => {
		const s = ps.stepBack(ps.stepForward(ps.emptyState(), "1", 2, nat), "1", 2, nat);
		expect(ps.hasOrderOverride(s, "1")).toBe(false);
	});
});

describe("embedded source", () => {
	it("is self-contained and behaves like the exported instance", () => {
		const embedded = new Function(`return ${PREVIEW_STATE_SOURCE};`)();
		const s = embedded.bringToFront(embedded.toggleHidden(embedded.emptyState(), "1", 2), "1", 1);
		expect(s).toEqual(ps.bringToFront(ps.toggleHidden(ps.emptyState(), "1", 2), "1", 1));
		expect(embedded.paintOrder(s, "1", [1, 2, 3])).toEqual([2, 3, 1]);
	});
});
