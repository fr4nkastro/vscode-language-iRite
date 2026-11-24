import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadIriteProject, parseIriteSource } from "../../src/irite";
import type { IriteProjectModel } from "../../src/irite";
import { buildCallGraph } from "../../src/callmap/callGraph";
import { callViews } from "../../src/callmap/callViews";

const projectDir = resolve(__dirname, "../fixtures/callmap");
const read = (p: string): string | undefined => {
	try {
		return readFileSync(p, "utf8");
	} catch {
		return undefined;
	}
};
const project = loadIriteProject(join(projectDir, "main.src"), read);
const graph = buildCallGraph(project, projectDir);
const id = (name: string): number => graph.routines.find((r) => r.name === name)!.id;
const name = (i: number): string => graph.routines[i].name;

function single(src: string): IriteProjectModel {
	const m = parseIriteSource(src, "a.iri");
	return { mainSrc: "a.iri", files: ["a.iri"], databases: [], enums: [], records: [], constants: [], routines: m.routines, diagnostics: [] };
}

describe("buildCallGraph", () => {
	it("keeps only files that hold routines, labelled project-relative with forward slashes", () => {
		expect(graph.files.map((f) => f.label)).toEqual(["src/utils/math.iri", "src/utils/text.iri", "src/machine/scale.iri", "src/machine/ui.iri"]);
		expect(graph.files.map((f) => f.folder)).toEqual(["src/utils", "src/utils", "src/machine", "src/machine"]);
		expect(graph.hiddenFiles).toBe(3); // main.src, main.iri, decls.iri (forward declarations only)
	});
	it("resolves forward declarations to their implementation (one node, implementation location)", () => {
		const tare = graph.routines.filter((r) => r.name === "ScaleTare");
		expect(tare).toHaveLength(1);
		expect(graph.files[tare[0].file].label).toBe("src/machine/scale.iri");
		expect(tare[0].forward).toBeUndefined();
	});
	it("matches callees case-insensitively and marks calls to undeclared names as built-ins", () => {
		const from = id("ScaleTare");
		const calls = graph.sites.filter((s) => s.from === from).map((s) => [s.name, s.to >= 0 ? name(s.to) : null, s.line]);
		expect(calls).toEqual([
			["ScaleReset", "ScaleReset", 3],
			["SHOWTEXT", "ShowText", 4],
			["ScaleTare", "ScaleTare", 5],
		]);
		const builtin = graph.sites.filter((s) => s.to < 0).map((s) => s.name).sort();
		expect(builtin).toEqual(["GetWeight", "SelectScreen", "SelectScreen", "SetLabelText"]);
	});
	it("keeps an unresolved forward declaration as a node flagged forward", () => {
		const g = buildCallGraph(single("procedure Ext(a: integer);\nprocedure Caller;\nbegin\n  Ext(1);\nend;\n"), ".");
		const ext = g.routines.find((r) => r.name === "Ext")!;
		expect(ext.forward).toBe(true);
		expect(g.sites.find((s) => s.name === "Ext")!.to).toBe(ext.id);
	});
	it("reports duplicate definitions and resolves calls to the first one", () => {
		const g = buildCallGraph(single("procedure A;\nbegin\nend;\nprocedure a;\nbegin\nend;\nprocedure C;\nbegin\n  A;\nend;\n"), ".");
		expect(g.diagnostics.some((d) => /duplicate/i.test(d))).toBe(true);
		expect(g.sites[0].to).toBe(0);
	});
});

describe("moduleView (Level 2)", () => {
	it("aggregates caller module -> callee module with counts and internal calls", () => {
		const v = callViews.moduleView(graph, "file");
		const e = (a: string, b: string) => v.edges.find((x) => x.from === a && x.to === b);
		expect(v.edges.map((x) => `${x.from}>${x.to}:${x.count}`).sort()).toEqual([
			"src/machine/scale.iri>src/utils/math.iri:1",
			"src/machine/scale.iri>src/utils/text.iri:3",
			"src/machine/ui.iri>src/machine/scale.iri:1",
			"src/machine/ui.iri>src/utils/text.iri:1",
			"src/utils/text.iri>src/utils/math.iri:1",
		]);
		expect(e("src/machine/scale.iri", "src/utils/text.iri")!.sites.map((s) => graph.sites[s].line)).toEqual([4, 11, 13]);
		const scale = v.nodes.find((n) => n.id === "src/machine/scale.iri")!;
		expect(scale).toMatchObject({ label: "machine/scale.iri", group: "src/machine", routines: 2, internal: 2, outgoing: 4, incoming: 1 });
	});
	it("collapses to one node per folder when asked", () => {
		const v = callViews.moduleView(graph, "folder");
		expect(v.nodes.map((n) => n.id)).toEqual(["src/utils", "src/machine"]);
		expect(v.edges.map((x) => `${x.from}>${x.to}:${x.count}`)).toEqual(["src/machine>src/utils:5"]);
		expect(v.nodes.find((n) => n.id === "src/machine")!.internal).toBe(4);
	});
	it("lists built-in calls apart from the module edges", () => {
		const v = callViews.moduleView(graph, "file");
		expect(v.builtins.map((b) => `${b.from}:${b.count}`).sort()).toEqual(["src/machine/scale.iri:1", "src/machine/ui.iri:1", "src/utils/math.iri:1", "src/utils/text.iri:1"]);
		expect(v.edges.every((x) => v.nodes.some((n) => n.id === x.to))).toBe(true);
	});
});

describe("moduleDetail (Level 3)", () => {
	const d = callViews.moduleDetail(graph, "file", "src/machine/scale.iri");
	it("lists the module routines in source order with internal edges", () => {
		expect(d.routines.map(name)).toEqual(["ScaleTare", "ScaleReset"]);
		expect(d.internal.map((e) => `${name(e.from)}>${name(e.to)}:${e.count}`).sort()).toEqual(["ScaleTare>ScaleReset:1", "ScaleTare>ScaleTare:1"]);
	});
	it("collapses calls to and from other modules per module", () => {
		expect(d.outgoing.map((e) => `${name(e.from)}>${e.to}:${e.count}`).sort()).toEqual([
			"ScaleReset>src/utils/math.iri:1",
			"ScaleReset>src/utils/text.iri:2",
			"ScaleTare>src/utils/text.iri:1",
		]);
		expect(d.incoming.map((e) => `${e.from}>${name(e.to)}:${e.count}`)).toEqual(["src/machine/ui.iri>ScaleTare:1"]);
		expect(d.builtins.map((b) => `${name(b.from)}:${b.count}`)).toEqual(["ScaleReset:1"]);
	});
	it("works on folder granularity (internal = same folder)", () => {
		const f = callViews.moduleDetail(graph, "folder", "src/utils");
		expect(f.routines.map(name).sort()).toEqual(["Beep2", "Clamp", "ShowText"]);
		expect(f.incoming.map((e) => `${e.from}>${name(e.to)}:${e.count}`).sort()).toEqual(["src/machine>Clamp:1", "src/machine>ShowText:4"]);
		expect(f.internal.map((e) => `${name(e.from)}>${name(e.to)}`)).toEqual(["ShowText>Beep2"]);
	});
});

describe("neighborhood and search", () => {
	it("returns callers, callees and the modules involved for a routine", () => {
		const n = callViews.neighborhood(graph, id("ShowText"));
		expect(n.callers.map((c) => `${name(c.id)}:${c.count}`)).toEqual(["ScaleTare:1", "ScaleReset:2", "UiRefresh:1"]);
		expect(n.callees.map((c) => name(c.id))).toEqual(["Beep2"]);
		expect(n.builtins).toEqual([{ name: "SetLabelText", count: 1 }]);
		expect(n.modules).toEqual(["src/utils/text.iri", "src/machine/scale.iri", "src/machine/ui.iri", "src/utils/math.iri"]);
	});
	it("searches case-insensitively: exact, then prefix, then substring", () => {
		expect(callViews.search(graph, "scaletare").map(name)).toEqual(["ScaleTare"]);
		expect(callViews.search(graph, "SCALE").map(name)).toEqual(["ScaleTare", "ScaleReset"]);
		expect(callViews.search(graph, "text").map(name)).toEqual(["ShowText"]);
		expect(callViews.search(graph, "  ")).toEqual([]);
		expect(callViews.search(graph, "e", 3)).toHaveLength(3);
	});
});

describe("layouts", () => {
	it("places grouped items inside non-overlapping group frames", () => {
		const l = callViews.layoutGrouped([
			{ id: "a", group: "g1" },
			{ id: "b", group: "g1" },
			{ id: "c", group: "g2" },
			{ id: "d", group: "" },
		]);
		expect(Object.keys(l.pos).sort()).toEqual(["a", "b", "c", "d"]);
		const inside = (pid: string, g: { x: number; y: number; w: number; h: number }) =>
			l.pos[pid].x >= g.x && l.pos[pid].y >= g.y && l.pos[pid].x + l.pos[pid].w <= g.x + g.w && l.pos[pid].y + l.pos[pid].h <= g.y + g.h;
		const g1 = l.groups.find((g) => g.name === "g1")!;
		expect(inside("a", g1) && inside("b", g1)).toBe(true);
		expect(l.groups.map((g) => g.name)).toEqual(["g1", "g2"]);
		const g2 = l.groups.find((g) => g.name === "g2")!;
		expect(g1.x + g1.w <= g2.x || g1.y + g1.h <= g2.y || g2.x + g2.w <= g1.x || g2.y + g2.h <= g1.y).toBe(true);
	});
	it("puts incoming on the left, routines in the middle and outgoing on the right", () => {
		const l = callViews.layoutColumns(["i1"], ["r1", "r2", "r3"], ["o1", "o2"]);
		expect(l.pos.i1.x).toBeLessThan(l.pos.r1.x);
		expect(l.pos.r1.x).toBeLessThan(l.pos.o1.x);
		expect(l.pos.o2.y).toBeGreaterThan(l.pos.o1.y);
	});
});
