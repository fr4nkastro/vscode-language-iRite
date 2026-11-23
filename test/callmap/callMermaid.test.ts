import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadIriteProject } from "../../src/irite";
import { buildCallGraph } from "../../src/callmap/callGraph";
import { callMapToMermaid } from "../../src/callmap/callMermaid";
import { generateDocs } from "../../src/docs/generateDocs";

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

describe("callMapToMermaid (Level 2 export)", () => {
	const text = callMapToMermaid(graph);
	it("draws one subgraph per folder with one node per module", () => {
		expect(text.startsWith("flowchart LR\n")).toBe(true);
		expect(text).toContain('subgraph g0["src/utils"]');
		expect(text).toContain('subgraph g1["src/machine"]');
		expect(text).toContain('m0["math.iri"]');
		expect(text).toContain('m3["ui.iri"]');
	});
	it("draws one weighted edge per module pair", () => {
		const edges = text.split("\n").filter((l) => l.includes("-->"));
		expect(edges.map((l) => l.trim()).sort()).toEqual(["m2 -->|1| m0", "m2 -->|3| m1", "m1 -->|1| m0", "m3 -->|1| m1", "m3 -->|1| m2"].sort());
	});
	it("never emits characters that break a quoted Mermaid label", () => {
		const g = { ...graph, files: graph.files.map((f, i) => (i === 0 ? { ...f, label: 'a"b/<c>.iri', folder: 'x"y' } : f)) };
		const t = callMapToMermaid(g);
		expect(t).not.toMatch(/\["[^\]]*"[^\]\n]*"[^\]]*\]/);
		expect(t).toContain("'c'.iri");
		expect(t).toContain("x'y");
	});
});

describe("docs: callmap.md", () => {
	const out = generateDocs({ project, projectDir, version: "1.0.0", now: new Date("2026-01-02T03:04:05.000Z") });
	const get = (p: string) => out.files.find((f) => f.relPath === p)?.content;
	it("adds callmap.md with the diagram, the module edge table and the hidden-file note", () => {
		const md = get("docs/generated/callmap.md")!;
		expect(md).toBeDefined();
		expect(md).toContain("```mermaid\nflowchart LR");
		expect(md).toContain("| src/machine/scale.iri | src/utils/text.iri | 3 |");
		expect(md).toContain("3 file(s) without routines");
		expect(md).toContain("[src/machine/scale.iri:4]");
	});
	it("links the call map from routines.md and index.md", () => {
		expect(get("docs/generated/routines.md")).toContain("(callmap.md)");
		expect(get("docs/generated/index.md")).toContain("(callmap.md)");
	});
	it("says so when there are no calls between modules", () => {
		const p = { ...project, routines: [] };
		const o = generateDocs({ project: p, projectDir, version: "1", now: new Date(0) });
		expect(o.files.find((f) => f.relPath === "docs/generated/callmap.md")!.content).toContain("No routines found");
	});
});
