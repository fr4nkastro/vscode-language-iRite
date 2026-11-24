import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseIriteSource } from "../../src/irite";
import type { IriteProjectModel } from "../../src/irite";
import { buildSfc } from "../../src/sfc/sfcModel";
import { groupSfcDiagnostics, toVsSeverityName } from "../../src/sfc/sfcDiagnostics";

function project(src: string, file = "a.iri"): IriteProjectModel {
	const m = parseIriteSource(src, file);
	return { mainSrc: file, files: [file], databases: [], enums: m.enums, records: [], constants: [], routines: m.routines, diagnostics: m.diagnostics };
}
const FIXTURE = readFileSync(join(__dirname, "fixtures/petri.iri"), "utf8");
const sfc = buildSfc(project(FIXTURE));
const find = (code: string, text: string) => sfc.diagnostics.find((d) => d.code === code && d.message.includes(text));

describe("SFC diagnostic severities and codes", () => {
	it("maps each diagnostic kind to its severity", () => {
		expect(find("unreachable-step", "Orphan")!.severity).toBe("warning");
		expect(find("never-emitted", "Unused")!.severity).toBe("warning");
		expect(find("no-entry-routine", "Done")!.severity).toBe("info");
		const nt = buildSfc(project("type STATES is (NullState, A);\ntype TRANSITIONS is (NullTransition, T);"));
		expect(nt.diagnostics.find((d) => d.code === "no-target")!.severity).toBe("error");
		expect(buildSfc(project("procedure P;\nbegin\nend;")).diagnostics.every((d) => d.severity === "warning" && d.code === "missing-enum")).toBe(true);
	});
	it("names the editor severity for each level without importing vscode", () => {
		expect(toVsSeverityName("error")).toBe("Error");
		expect(toVsSeverityName("warning")).toBe("Warning");
		expect(toVsSeverityName("info")).toBe("Information");
	});
});

describe("SFC diagnostic locations", () => {
	it("points a step without entry routine and a never-emitted transition at the enum declaration", () => {
		expect(find("no-entry-routine", "Done")).toMatchObject({ file: "a.iri", line: 1 });
		expect(find("never-emitted", "Unused")).toMatchObject({ file: "a.iri", line: 2 });
	});
	it("points an unreachable step at its entry routine when it has one, else at the enum", () => {
		expect(find("unreachable-step", "Orphan")).toMatchObject({ file: "a.iri", line: 1 });
		const src = [
			"type STATES is (NullState, A, B);", "type TRANSITIONS is (NullTransition, T);",
			"procedure CmdB(m: integer);", "begin", "  Beep;", "end;",
			"procedure HS;", "begin", "  if GetState(m, s) = B then", "    CmdB(m);", "  end if;", "end;",
		].join("\n");
		const d = buildSfc(project(src)).diagnostics.find((x) => x.code === "unreachable-step")!;
		expect(d).toMatchObject({ file: "a.iri", line: 3 });
	});
	it("points a transition without target at its first emitter call site, else at the enum", () => {
		const src = [
			"type STATES is (NullState, A);", "type TRANSITIONS is (NullTransition, T);",
			"procedure CmdA(m: integer);", "begin", "  CmdSetTransition(m, s, T);", "end;",
		].join("\n");
		expect(buildSfc(project(src)).diagnostics.find((d) => d.code === "no-target")).toMatchObject({ file: "a.iri", line: 5 });
		const bare = buildSfc(project("type STATES is (NullState, A);\ntype TRANSITIONS is (NullTransition, T);"));
		expect(bare.diagnostics.find((d) => d.code === "no-target")).toMatchObject({ file: "a.iri", line: 2 });
	});
	it("keeps the SetState call site for conflicting targets", () => {
		const src = [
			"type STATES is (NullState, A, B);", "type TRANSITIONS is (NullTransition, T);",
			"procedure H;", "begin", "  if X = T then", "    SetState(m, s, A);", "    SetState(m, s, B);", "  end if;", "end;",
		].join("\n");
		expect(buildSfc(project(src)).diagnostics.find((d) => d.code === "conflicting-targets")).toMatchObject({ file: "a.iri", line: 7 });
	});
});

describe("groupSfcDiagnostics", () => {
	it("groups by file, sorts by line and attaches location-less diagnostics to the fallback file", () => {
		const grouped = groupSfcDiagnostics(
			[
				{ severity: "warning", message: "late", file: "b.iri", line: 9, code: "no-target" },
				{ severity: "error", message: "early", file: "b.iri", line: 2 },
				{ severity: "warning", message: "none" },
				{ severity: "info", message: "no line", file: "c.iri" },
			],
			"main.src",
		);
		expect([...grouped.keys()]).toEqual(["b.iri", "main.src", "c.iri"]);
		expect(grouped.get("b.iri")!.map((d) => [d.line, d.message])).toEqual([[2, "early"], [9, "late"]]);
		expect(grouped.get("main.src")![0]).toMatchObject({ line: 1, severity: "warning", message: "none" });
		expect(grouped.get("c.iri")![0].line).toBe(1);
	});
});

describe("purity", () => {
	it("keeps src/sfc free of vscode imports", () => {
		const dir = join(__dirname, "../../src/sfc");
		for (const f of readdirSync(dir).filter((n) => n.endsWith(".ts"))) {
			expect(readFileSync(join(dir, f), "utf8"), f).not.toMatch(/from\s+["']vscode["']|require\(["']vscode["']\)/);
		}
	});
});
