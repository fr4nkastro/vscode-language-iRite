import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	addWidget,
	deleteWidget,
	effectiveWidgets,
	emptyEditState,
	isDirty,
	parseEditState,
	renameAlias,
	serializeEditState,
	setGeometry,
	setProp,
	toOps,
} from "../../src/editor/editState";
import type { EditState } from "../../src/editor/editState";
import { iriHint } from "../../src/editor/iriHint";
import { planSave } from "../../src/editor/saveRev";
import { enrichRev } from "../../src/editor/catalogModel";
import { parseRev } from "../../src/rev";
import { paletteTypes } from "../../src/rev/widgetCatalog";

const original = readFileSync(join(__dirname, "../fixtures/editor/main.rev"));
const rev = parseRev(original.toString("utf8"));
const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
	if (!r.ok) throw new Error(JSON.stringify(r));
	return r as Extract<T, { ok: true }>;
};
const lines = (b: Buffer): string[] => b.toString("latin1").split("\n");
const wdgt = (b: Buffer): string[] => lines(b).filter((l) => l.startsWith("WDGT#"));

describe("set property", () => {
	it("edits one catalog field: one patch op, one changed line, dirty, and back to clean", () => {
		const r = ok(setProp(emptyEditState(), rev, 3, "fontSize", 30));
		expect(isDirty(rev, r.state)).toBe(true);
		expect(toOps(rev, r.state)).toEqual([{ kind: "patch", id: 3, fields: { fontSize: "30" } }]);
		const plan = planSave(original, r.state)!;
		expect(plan.changed).toEqual([3]);
		expect(plan.added).toEqual([]);
		expect(plan.removed).toEqual([]);
		expect(plan.model.widgets.find((w) => w.id === 3)!.props.fontSize).toBe("30");
		const back = ok(setProp(r.state, rev, 3, "fontSize", 20));
		expect(isDirty(rev, back.state)).toBe(false);
	});
	it("merges geometry and property edits of one widget into one op", () => {
		let s = ok(setProp(emptyEditState(), rev, 3, "color", "#112233")).state;
		s = ok(setGeometry(s, rev, 3, { x: 500 })).state;
		const ops = toOps(rev, s);
		expect(ops).toHaveLength(1);
		expect(ops[0]).toMatchObject({ kind: "patch", id: 3 });
		expect(planSave(original, s)!.changed).toEqual([3]);
	});
	it("routes x/y/width/height fields to the geometry state", () => {
		const r = ok(setProp(emptyEditState(), rev, 3, "width", 99));
		expect(r.state.geom[3].width).toBe(99);
	});
	it("rejects unknown fields, non-editable fields, bad values, caption rules, alias field", () => {
		const s = emptyEditState();
		expect(setProp(s, rev, 3, "nope", 1).ok).toBe(false);
		expect(setProp(s, rev, 3, "screen", 2).ok).toBe(false);
		expect(setProp(s, rev, 3, "type", 7).ok).toBe(false);
		expect(setProp(s, rev, 3, "justification", 9).ok).toBe(false);
		expect(setProp(s, rev, 3, "fontSize", 0).ok).toBe(false);
		expect(setProp(s, rev, 3, "fontSize", "x").ok).toBe(false);
		expect(setProp(s, rev, 3, "caption", "a,b").ok).toBe(false);
		expect(setProp(s, rev, 3, "caption", "a\nb").ok).toBe(false);
		expect(setProp(s, rev, 3, "caption", "x".repeat(65)).ok).toBe(false);
		expect(setProp(s, rev, 3, "caption", "x".repeat(64)).ok).toBe(true);
		expect(setProp(s, rev, 3, "alias", "abc").ok).toBe(false);
		expect(setProp(s, rev, 3, "color", "red;x").ok).toBe(false);
		expect(setProp(s, rev, 99999, "fontSize", 3).ok).toBe(false);
		expect(setProp(s, rev, 15, "size", 9).ok).toBe(false);
		expect(setProp(s, rev, 7, "refreshTime", 301).ok).toBe(false);
	});
	it("escapes special characters on save and keeps the caption text", () => {
		const s = ok(setProp(emptyEditState(), rev, 3, "caption", "A & B <1>")).state;
		const plan = planSave(original, s)!;
		expect(wdgt(plan.bytes).find((l) => l.startsWith("WDGT#3="))).toContain("A &amp; B &lt;1&gt;");
		expect(plan.model.widgets.find((w) => w.id === 3)!.props.caption).toBe("A & B <1>");
	});
});

describe("add widget (S6, S9, S15)", () => {
	it("every palette type can be added: one new line, defaults, position, screen, lowest free id", () => {
		for (const t of paletteTypes()) {
			const r = ok(addWidget(emptyEditState(), rev, { type: t.type, x: 40, y: 50, screen: 1 }));
			const taken = new Set(rev.widgets.map((w) => w.id));
			let low = 1;
			while (taken.has(low)) low++;
			expect(r.id).toBe(low);
			const plan = planSave(original, r.state)!;
			expect(plan.added).toEqual([low]);
			expect(plan.changed).toEqual([]);
			expect(plan.removed).toEqual([]);
			expect(wdgt(plan.bytes)).toHaveLength(wdgt(original).length + 1);
			const w = plan.model.widgets.find((x) => x.id === low)!;
			expect(w.type).toBe(t.type);
			expect(w.props.x).toBe("40");
			expect(w.props.y).toBe("50");
			expect(w.props.screen).toBe("1");
		}
	});
	it("a second add takes the next free id, counting the one added in the session", () => {
		const a = ok(addWidget(emptyEditState(), rev, { type: 4, x: 0, y: 0, screen: 1 }));
		const b = ok(addWidget(a.state, rev, { type: 4, x: 0, y: 0, screen: 1 }));
		expect(b.id).toBe(a.id + 1);
		expect(effectiveWidgets(rev, b.state).filter((w) => w.id === a.id || w.id === b.id)).toHaveLength(2);
	});
	it("a deleted id stays occupied in the session (never renumbers)", () => {
		const d = ok(deleteWidget(emptyEditState(), rev, 1)).state;
		expect(ok(addWidget(d, rev, { type: 4, x: 0, y: 0, screen: 1 })).id).not.toBe(1);
	});
	it("gets the default alias prefix+id, and a type 1 has none", () => {
		const r = ok(addWidget(emptyEditState(), rev, { type: 4, x: 0, y: 0, screen: 1 }));
		expect(r.tokens[10]).toBe(`lbl${r.id}`);
		expect(effectiveWidgets(rev, ok(addWidget(emptyEditState(), rev, { type: 1, x: 0, y: 0, screen: 1 })).state).pop()!.alias).toBeUndefined();
	});
	it("rejects legacy/unknown types, bad screens, a second softkey on a screen", () => {
		const s = emptyEditState();
		expect(addWidget(s, rev, { type: 5, x: 0, y: 0, screen: 1 }).ok).toBe(false);
		expect(addWidget(s, rev, { type: 99, x: 0, y: 0, screen: 1 }).ok).toBe(false);
		expect(addWidget(s, rev, { type: 4, x: 0, y: 0, screen: 0 }).ok).toBe(false);
		expect(addWidget(s, rev, { type: 4, x: 0, y: 0, screen: 100 }).ok).toBe(false);
		const sk = ok(addWidget(s, rev, { type: 9, x: 0, y: 0, screen: 2 }));
		expect(addWidget(sk.state, rev, { type: 9, x: 0, y: 0, screen: 2 }).ok).toBe(false);
		expect(addWidget(sk.state, rev, { type: 9, x: 0, y: 0, screen: 3 }).ok).toBe(true);
	});
	it("moving an added widget edits its tokens, still one added line", () => {
		const a = ok(addWidget(emptyEditState(), rev, { type: 4, x: 0, y: 0, screen: 1 }));
		const m = ok(setGeometry(a.state, rev, a.id, { x: 77, y: 33, w: 90 }));
		const plan = planSave(original, m.state)!;
		expect(plan.added).toEqual([a.id]);
		const w = plan.model.widgets.find((x) => x.id === a.id)!;
		expect([w.x, w.y, w.width]).toEqual([77, 33, 90]);
	});
});

describe("delete widget", () => {
	it("removes exactly one line", () => {
		const s = ok(deleteWidget(emptyEditState(), rev, 3)).state;
		const plan = planSave(original, s)!;
		expect(plan.removed).toEqual([3]);
		expect(wdgt(plan.bytes)).toHaveLength(wdgt(original).length - 1);
	});
	it("deleting an added widget cancels it (clean again); unknown ids fail", () => {
		const a = ok(addWidget(emptyEditState(), rev, { type: 4, x: 0, y: 0, screen: 1 }));
		expect(isDirty(rev, ok(deleteWidget(a.state, rev, a.id)).state)).toBe(false);
		expect(deleteWidget(emptyEditState(), rev, 424242).ok).toBe(false);
	});
	it("drops pending edits of the deleted widget, and nothing can edit it afterwards", () => {
		let s = ok(setProp(emptyEditState(), rev, 3, "fontSize", 30)).state;
		s = ok(deleteWidget(s, rev, 3)).state;
		expect(toOps(rev, s)).toEqual([{ kind: "remove", id: 3 }]);
		expect(setProp(s, rev, 3, "fontSize", 31).ok).toBe(false);
	});
});

describe("rename alias (S9)", () => {
	it("renames one alias: one changed line", () => {
		const s = ok(renameAlias(emptyEditState(), rev, 3, "lbNEW")).state;
		const plan = planSave(original, s)!;
		expect(plan.changed).toEqual([3]);
		expect(plan.model.widgets.find((w) => w.id === 3)!.alias).toBe("lbNEW");
	});
	it("rejects empty, invalid, too long and duplicate (case-insensitive) aliases, and unstored aliases", () => {
		const s = emptyEditState();
		expect(renameAlias(s, rev, 3, "").ok).toBe(false);
		expect(renameAlias(s, rev, 3, "9x").ok).toBe(false);
		expect(renameAlias(s, rev, 3, "toolongalias").ok).toBe(false);
		expect(renameAlias(s, rev, 3, "LBL4").ok).toBe(false);
		expect(renameAlias(s, rev, 3, "LBIN").ok).toBe(true);
		expect(renameAlias(s, rev, 22, "x").ok).toBe(false); // line: alias not stored
		expect(renameAlias(s, rev, 15, "x").ok).toBe(false); // scale: no alias
	});
	it("a derived alias (line22) counts for uniqueness", () => {
		expect(renameAlias(emptyEditState(), rev, 3, "line22").ok).toBe(false);
	});
});

describe("hint from the state and hot exit", () => {
	it("produces add/change/remove lines for the session", () => {
		let s = ok(renameAlias(emptyEditState(), rev, 3, "lbNEW")).state;
		s = ok(deleteWidget(s, rev, 4)).state;
		const a = ok(addWidget(s, rev, { type: 4, x: 0, y: 0, screen: 1 }));
		const aliases = (list: ReturnType<typeof effectiveWidgets>) => list.filter((w) => w.alias).map((w) => ({ id: w.id, alias: w.alias! }));
		const h = iriHint(aliases(effectiveWidgets(rev, emptyEditState())), aliases(effectiveWidgets(rev, a.state)));
		expect(h.change.map((c) => c.new.trim())).toEqual(["lbNEW     : constant integer := 3;"]);
		expect(h.remove).toEqual(["lbl4      : constant integer := 4;"]);
		expect(h.add).toHaveLength(1);
	});
	it("round-trips through serialize/parse and drops hostile entries", () => {
		let s: EditState = ok(renameAlias(emptyEditState(), rev, 3, "lbNEW")).state;
		s = ok(addWidget(s, rev, { type: 7, x: 1, y: 2, screen: 1 })).state;
		s = ok(deleteWidget(s, rev, 4)).state;
		s = ok(setProp(s, rev, 5, "fontSize", 30)).state;
		expect(parseEditState(JSON.parse(serializeEditState(s)), rev)).toEqual(s);
		const hostile = { geom: {}, props: { "3": { fontSize: "-5", nope: "1" }, "424242": { x: "1" } }, added: { "5": ["4"], "1000": ["4"] }, removed: [424242, "x"] };
		expect(parseEditState(hostile, rev)).toEqual(emptyEditState());
	});
});

describe("catalog model (types the reader leaves unknown)", () => {
	it("gives types 2, 8, 9, 11 a position and screen so they can be shown and moved", () => {
		let s = emptyEditState();
		for (const t of [2, 8, 9, 11]) s = ok(addWidget(s, rev, { type: t, x: 40, y: 50, screen: 1 })).state;
		const m = enrichRev(planSave(original, s)!.model);
		for (const w of m.widgets.filter((x) => [2, 8, 9, 11].includes(x.type))) {
			expect([w.x, w.y, w.screen]).toEqual([40, 50, 1]);
		}
		expect(m.widgets.find((w) => w.type === 9)!.width).toBeUndefined();
		const moved = setGeometry(emptyEditState(), m, m.widgets.find((w) => w.type === 8)!.id, { x: 5 });
		expect(moved.ok).toBe(true);
	});
	it("leaves known types untouched", () => {
		const m = enrichRev(rev);
		expect(m.widgets).toEqual(rev.widgets);
	});
});
