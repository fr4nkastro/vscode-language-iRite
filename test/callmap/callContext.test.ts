import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadIriteProject } from "../../src/irite";
import { parseRev } from "../../src/rev";
import { buildCallGraph } from "../../src/callmap/callGraph";
import { buildSystemContext, parseOpenMessage } from "../../src/callmap/callContext";

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
const rev = parseRev(readFileSync(join(__dirname, "../fixtures/rev/sample.rev"), "utf8"));

describe("buildSystemContext (Level 1)", () => {
	it("is the program alone without a .rev", () => {
		const c = buildSystemContext(graph, "demo");
		expect(c.hasRev).toBe(false);
		expect(c.groups).toEqual([]);
		expect(c.program).toEqual({ name: "demo", modules: 4, routines: 7, calls: 10, builtinCalls: 4, hiddenFiles: 3 });
	});
	it("adds scales, ports, DIO and databases from the .rev as context neighbours", () => {
		const c = buildSystemContext(graph, "demo", rev);
		expect(c.hasRev).toBe(true);
		const kinds = c.groups.map((g) => g.kind);
		expect(kinds.length).toBeGreaterThan(0);
		for (const g of c.groups) {
			expect(g.names.length).toBeGreaterThan(0);
			expect(new Set(g.names).size).toBe(g.names.length);
		}
		expect(c.groups.find((g) => g.kind === "scale")!.names).toEqual(rev.aliases.filter((a) => a.kind === "scale").map((a) => a.name));
		expect(c.groups.find((g) => g.kind === "database")!.names).toEqual(rev.databases.map((d) => d.name));
	});
});

describe("parseOpenMessage", () => {
	const files = ["C:\\p\\main.src", "C:\\p\\src\\a.iri"];
	it("accepts project files (case and slash insensitive) and returns the project's spelling", () => {
		expect(parseOpenMessage(files, { type: "open", file: "c:/P/SRC/a.iri", line: 7 })).toEqual({ file: "C:\\p\\src\\a.iri", line: 7 });
	});
	it("rejects other files, bad lines and other message types", () => {
		expect(parseOpenMessage(files, { type: "open", file: "C:\\p\\secret.txt", line: 1 })).toBeUndefined();
		expect(parseOpenMessage(files, { type: "open", file: files[0], line: 0 })).toBeUndefined();
		expect(parseOpenMessage(files, { type: "open", file: files[0], line: 1.5 })).toBeUndefined();
		expect(parseOpenMessage(files, { type: "open", file: files[0], line: Infinity })).toBeUndefined();
		expect(parseOpenMessage(files, { type: "open", file: files[0], line: "3" })).toBeUndefined();
		expect(parseOpenMessage(files, { type: "write", file: files[0], line: 3 })).toBeUndefined();
		expect(parseOpenMessage(files, null)).toBeUndefined();
		expect(parseOpenMessage(files, "open")).toBeUndefined();
	});
});
