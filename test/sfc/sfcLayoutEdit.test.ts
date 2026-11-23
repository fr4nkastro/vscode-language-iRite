import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseIriteSource } from "../../src/irite";
import type { IriteProjectModel } from "../../src/irite";
import { buildSfc } from "../../src/sfc/sfcModel";
import { layoutSfc } from "../../src/sfc/sfcLayout";
import { mergeLayout } from "../../src/sfc/sfcLayoutEdit";
import { geometry, GEOMETRY_SOURCE } from "../../src/sfc/sfcGeometry";
import type { RouteSpec } from "../../src/sfc/sfcGeometry";
import { diagramKey, isEmptyDiagram, linkKey, parseSidecar, sanitizeDiagram, serializeSidecar, stepKey, withDiagram } from "../../src/sfc/sfcSidecar";
import type { SavedDiagram } from "../../src/sfc/sfcSidecar";

function project(src: string, file = "a.iri"): IriteProjectModel {
	const m = parseIriteSource(src, file);
	return { mainSrc: file, files: [file], databases: [], enums: m.enums, records: [], constants: [], routines: m.routines, diagnostics: m.diagnostics };
}
const FIXTURE = readFileSync(join(__dirname, "fixtures/petri.iri"), "utf8");
const auto = layoutSfc(buildSfc(project(FIXTURE)));
const node = (l: typeof auto, n: string) => l.nodes.find((x) => x.name === n)!;
const link = (l: typeof auto, t: string, from?: string) => l.links.find((x) => x.transition === t && x.from === from)!;
const diagram = (d: Partial<SavedDiagram>): SavedDiagram => ({ steps: {}, links: {}, ...d });

describe("mergeLayout", () => {
	it("returns the automatic layout untouched when nothing is saved", () => {
		expect(mergeLayout(auto, undefined).layout).toEqual(auto);
		expect(mergeLayout(auto, diagram({})).layout).toEqual(auto);
	});
	it("applies saved step positions case-insensitively and keeps size and rank", () => {
		const { layout } = mergeLayout(auto, diagram({ steps: { [stepKey("Ask")]: { x: 500, y: 40 } } }));
		expect(node(layout, "Ask")).toMatchObject({ x: 500, y: 40, w: node(auto, "Ask").w, h: node(auto, "Ask").h, rank: node(auto, "Ask").rank, moved: true });
		expect(node(layout, "Wait")).toEqual(node(auto, "Wait"));
	});
	it("falls back to the automatic position for steps without a saved entry", () => {
		const { layout } = mergeLayout(auto, diagram({ steps: { ask: { x: 1, y: 2 } } }));
		expect(layout.nodes.filter((n) => !n.moved).map((n) => n.name)).toEqual(["Standby", "Wait", "Done", "Orphan"]);
		expect(node(layout, "Standby")).toEqual(node(auto, "Standby"));
	});
	it("carries the outgoing bars along with a moved step and re-routes its links", () => {
		const a = node(auto, "Standby");
		const { layout } = mergeLayout(auto, diagram({ steps: { standby: { x: a.x + 100, y: a.y + 20 } } }));
		const before = link(auto, "Start", "Standby");
		const after = link(layout, "Start", "Standby");
		expect(after.bar.x).toBe(before.bar.x + 100);
		expect(after.bar.y).toBe(before.bar.y + 20);
		expect(after.barFixed).toBe(false);
		expect(after.points[0].x).toBe(a.x + 100 + a.w / 2);
		const ask = node(layout, "Ask");
		expect(after.points[after.points.length - 1]).toEqual({ x: ask.x + ask.w / 2, y: ask.y });
		// a link that touches no moved step is left exactly as the auto layout drew it
		expect(link(layout, "Confirm", "Ask")).toEqual(link(auto, "Confirm", "Ask"));
	});
	it("re-routes links that arrive at a moved step without moving their bar", () => {
		const t = node(auto, "Ask");
		const { layout } = mergeLayout(auto, diagram({ steps: { ask: { x: t.x - 50, y: t.y } } }));
		const l = link(layout, "Start", "Standby");
		expect(l.bar).toEqual(link(auto, "Start", "Standby").bar);
		expect(l.points[l.points.length - 1].x).toBe(t.x - 50 + t.w / 2);
	});
	it("uses an explicit bar position and bend points on a link", () => {
		const key = linkKey("Start", "Standby");
		const { layout } = mergeLayout(auto, diagram({ links: { [key]: { bar: { x: 300, y: 200 }, before: [{ x: 10, y: 120 }], after: [{ x: 700, y: 260 }] } } }));
		const l = link(layout, "Start", "Standby");
		expect(l.bar).toMatchObject({ x: 300, y: 200 });
		expect(l.barFixed).toBe(true);
		expect(l.before).toEqual([{ x: 10, y: 120 }]);
		expect(l.after).toEqual([{ x: 700, y: 260 }]);
		expect(l.points).toContainEqual({ x: 10, y: 120 });
		expect(l.points).toContainEqual({ x: 300, y: 200 });
		expect(l.points).toContainEqual({ x: 700, y: 260 });
	});
	it("supports bend points on a global link and keeps it starting at its bar", () => {
		const { layout } = mergeLayout(auto, diagram({ links: { clear: { after: [{ x: 5, y: 5 }] } } }));
		const l = link(layout, "Clear");
		expect(l.points[0]).toEqual({ x: l.bar.x, y: l.bar.y });
		expect(l.points).toContainEqual({ x: 5, y: 5 });
	});
	it("ignores and reports saved entries whose step or link no longer exists", () => {
		const { layout, ignored } = mergeLayout(auto, diagram({ steps: { gone: { x: 1, y: 1 }, ask: { x: 9, y: 9 } }, links: { "gone@ask": { bar: { x: 1, y: 1 } }, "start@standby": { bar: { x: 2, y: 2 } } } }));
		expect(ignored).toEqual({ steps: ["gone"], links: ["gone@ask"] });
		expect(layout.nodes.map((n) => n.name)).toEqual(auto.nodes.map((n) => n.name));
		expect(layout.links).toHaveLength(auto.links.length);
	});
	it("grows the canvas to contain moved items and stays JSON-serializable", () => {
		const { layout } = mergeLayout(auto, diagram({ steps: { ask: { x: auto.width + 400, y: auto.height + 400 } } }));
		expect(layout.width).toBeGreaterThan(auto.width + 400);
		expect(layout.height).toBeGreaterThan(auto.height + 400);
		expect(JSON.parse(JSON.stringify(layout))).toEqual(layout);
	});
});

describe("geometry", () => {
	const from = { x: 0, y: 0, w: 100, h: 40 };
	const to = { x: 0, y: 200, w: 100, h: 40 };
	const spec: RouteSpec = { from, to, bar: { x: 50, y: 100 }, before: [], after: [] };
	it("routes straight when the points are aligned", () => {
		expect(geometry.route(spec).points).toEqual([{ x: 50, y: 40 }, { x: 50, y: 100 }, { x: 50, y: 200 }]);
	});
	it("uses Z-shaped automatic segments and straight segments next to bends", () => {
		const z = geometry.route({ ...spec, bar: { x: 150, y: 100 } }).points;
		expect(z).toEqual([{ x: 50, y: 40 }, { x: 50, y: 70 }, { x: 150, y: 70 }, { x: 150, y: 100 }, { x: 150, y: 150 }, { x: 50, y: 150 }, { x: 50, y: 200 }]);
		const bent = geometry.route({ ...spec, after: [{ x: 120, y: 160 }] }).points;
		expect(bent).toEqual([{ x: 50, y: 40 }, { x: 50, y: 100 }, { x: 120, y: 160 }, { x: 50, y: 200 }]);
	});
	it("leaves a step through its top and enters a target through its bottom when the route goes upwards", () => {
		const up = geometry.route({ from: to, to: from, bar: { x: 50, y: 120 }, before: [], after: [] }).points;
		expect(up[0]).toEqual({ x: 50, y: 200 });
		expect(up[up.length - 1]).toEqual({ x: 50, y: 40 });
	});
	it("inserts a bend on the nearest segment, before or after the bar", () => {
		expect(geometry.insertBend(spec, { x: 60, y: 60 })).toEqual({ before: [{ x: 60, y: 60 }], after: [] });
		expect(geometry.insertBend(spec, { x: 60, y: 160 })).toEqual({ before: [], after: [{ x: 60, y: 160 }] });
		const withBend: RouteSpec = { ...spec, after: [{ x: 120, y: 160 }] };
		expect(geometry.insertBend(withBend, { x: 50, y: 190 }).after).toEqual([{ x: 120, y: 160 }, { x: 50, y: 190 }]);
		expect(geometry.insertBend(withBend, { x: 100, y: 130 }).after).toEqual([{ x: 100, y: 130 }, { x: 120, y: 160 }]);
	});
	it("keeps global links starting at their bar", () => {
		const g: RouteSpec = { to, bar: { x: 400, y: 20 }, before: [{ x: 1, y: 1 }], after: [] };
		expect(geometry.route(g).points[0]).toEqual({ x: 400, y: 20 });
		expect(geometry.insertBend(g, { x: 200, y: 20 })).toEqual({ before: [], after: [{ x: 200, y: 20 }] });
	});
	it("ships a self-contained copy for the webview that behaves identically", () => {
		const shipped = new Function(`return ${GEOMETRY_SOURCE};`)() as typeof geometry;
		const s: RouteSpec = { ...spec, bar: { x: 150, y: 100 }, after: [{ x: 120, y: 160 }] };
		expect(shipped.route(s)).toEqual(geometry.route(s));
		expect(shipped.insertBend(s, { x: 90, y: 90 })).toEqual(geometry.insertBend(s, { x: 90, y: 90 }));
	});
});

describe("sidecar", () => {
	it("builds stable, case-insensitive keys", () => {
		expect(stepKey("Standby")).toBe("standby");
		expect(linkKey("Start", "Standby")).toBe("start@standby");
		expect(linkKey("Clear")).toBe("clear");
		expect(diagramKey("C:\\ws", "C:\\ws\\main.src")).toBe(".::states/transitions");
		expect(diagramKey("C:\\ws", "C:\\ws\\Plant\\A\\main.src", "St", "Tr")).toBe("plant/a::st/tr");
		expect(diagramKey("/ws", "/other/main.src")).toBe("/other::states/transitions");
	});
	it("round-trips through a stable serialization", () => {
		const d: SavedDiagram = { steps: { b: { x: 1, y: 2 }, a: { x: 3, y: 4 } }, links: { "start@a": { bar: { x: 5, y: 6 }, after: [{ x: 7, y: 8 }] } } };
		const text = serializeSidecar(withDiagram({ version: 1, diagrams: {} }, ".::states/transitions", d));
		expect(text.endsWith("\n")).toBe(true);
		expect(Object.keys(JSON.parse(text).diagrams[".::states/transitions"].steps)).toEqual(["a", "b"]);
		const back = parseSidecar(text);
		expect(back).toEqual({ ok: true, file: { version: 1, diagrams: { ".::states/transitions": d } } });
		expect(serializeSidecar((back as { ok: true; file: never }).file)).toBe(text);
	});
	it("treats blank text as empty and refuses invalid json, wrong shape and unknown versions", () => {
		expect(parseSidecar("  \n")).toEqual({ ok: true, file: { version: 1, diagrams: {} } });
		expect(parseSidecar("{ nope")).toEqual({ ok: false, reason: "invalid-json" });
		expect(parseSidecar("[]")).toEqual({ ok: false, reason: "invalid-shape" });
		expect(parseSidecar('{"version":1,"diagrams":[]}')).toEqual({ ok: false, reason: "invalid-shape" });
		expect(parseSidecar('{"version":2,"diagrams":{}}')).toEqual({ ok: false, reason: "unsupported-version" });
		expect(parseSidecar('\uFEFF{"version":1}')).toEqual({ ok: true, file: { version: 1, diagrams: {} } });
	});
	it("sanitizes untrusted data: drops bad entries, rounds, clamps, lowercases and caps bends", () => {
		const d = sanitizeDiagram({
			steps: { Ask: { x: 10.6, y: -3.2 }, bad: { x: "1", y: 2 }, nan: { x: NaN, y: 1 }, huge: { x: 1e12, y: -1e12 }, "": { x: 1, y: 1 } },
			links: { "Start@Standby": { bar: { x: 1, y: 2 }, before: [{ x: 1, y: 1 }, "x", { x: 2 }], after: Array.from({ length: 100 }, (_, i) => ({ x: i, y: i })) }, empty: {}, junk: 7 },
		});
		expect(d.steps).toEqual({ ask: { x: 11, y: -3 }, huge: { x: 100000, y: -100000 } });
		expect(Object.keys(d.links)).toEqual(["start@standby"]);
		expect(d.links["start@standby"].before).toEqual([{ x: 1, y: 1 }]);
		expect(d.links["start@standby"].after).toHaveLength(64);
		expect(sanitizeDiagram(null)).toEqual({ steps: {}, links: {} });
		expect(isEmptyDiagram(sanitizeDiagram({ steps: "x" }))).toBe(true);
	});
	it("drops a diagram from the file when its layout is empty", () => {
		const f = withDiagram({ version: 1, diagrams: { k: { steps: { a: { x: 1, y: 1 } }, links: {} } } }, "k", { steps: {}, links: {} });
		expect(f.diagrams).toEqual({});
	});
});
