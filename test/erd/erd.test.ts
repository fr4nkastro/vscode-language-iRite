import { describe, expect, it } from "vitest";
import { parseRev } from "../../src/rev";
import type { IriteDatabase, IriteProjectModel } from "../../src/irite";
import { buildErd } from "../../src/erd/erdModel";
import { erdToMermaid } from "../../src/erd/erdMermaid";
import { renderErdHtml } from "../../src/erd/erdHtml";

function db(alias: string, fields: [string, string][], line = 1, typeName = `t${alias}`): IriteDatabase {
	return { file: "main.iri", line, typeName, alias, fields: fields.map(([name, type]) => ({ name, type })) };
}
function project(databases: IriteDatabase[]): IriteProjectModel {
	return { mainSrc: "main.src", files: ["main.iri"], databases, enums: [], records: [], constants: [], routines: [], diagnostics: [] };
}
const revText = (lines: string[]) => `<Indicator><Config>\n${lines.join("\n")}\n</Config></Indicator>`;

describe("buildErd merge", () => {
	it("merges source and rev by alias case-insensitively and reports drift", () => {
		const p = project([db("Product", [["Id", "Integer"], ["Name", "String"], ["OnlySrc", "Integer"]], 7)]);
		const rev = parseRev(revText(["DB.SCHEMA#1=100,0,id,3,4,Name,6,10,OnlyRev,4,4", "DB.ALIAS#1=PRODUCT", "DB.SCHEMA#2=5,0,Code,6,10", "DB.ALIAS#2=Extra"]));
		const erd = buildErd(p, rev);
		const t = erd.tables.find((x) => x.alias === "Product")!;
		expect(t.origin).toBe("both");
		expect(t.maxRecords).toBe(100);
		expect(t.source).toEqual({ file: "main.iri", line: 7 });
		expect(t.fields.map((f) => f.name)).toEqual(["Id", "Name", "OnlySrc", "OnlyRev"]);
		expect(t.fields[1]).toMatchObject({ type: "String", size: 10, typeCode: 6 });
		expect(erd.tables.find((x) => x.alias === "Extra")!.origin).toBe("rev");
		const msgs = erd.diagnostics.map((d) => d.message);
		expect(msgs).toContain('Product: field "OnlySrc" exists in source but not in .rev');
		expect(msgs).toContain('Product: field "OnlyRev" exists in .rev but not in source');
		expect(msgs).toContain('Table "Extra" exists in .rev but not in source');
	});
	it("reports source-only tables only when rev given", () => {
		const p = project([db("A", [["Id", "Integer"]])]);
		expect(buildErd(p).diagnostics).toEqual([]);
		expect(buildErd(p).tables[0].origin).toBe("source");
		expect(buildErd(p, parseRev(revText([]))).diagnostics.map((d) => d.message)).toContain('Table "A" exists in source but not in .rev');
	});
	it("handles no input", () => {
		expect(buildErd()).toEqual({ tables: [], relations: [], diagnostics: [] });
	});
});

describe("relation heuristics", () => {
	const tables = project([
		db("Vehicles", [["Id", "Integer"], ["Plate", "String"]]),
		db("Customer", [["CustomerCode", "String"], ["Name", "String"]]),
		db("Weighing", [["Id", "Integer"], ["VehicleId", "Integer"], ["CustId", "Integer"], ["IdVehicles", "Integer"], ["Valid", "Integer"], ["WeighingId", "Integer"], ["Plate", "String"]]),
	]);
	const erd = buildErd(tables);
	const rel = erd.relations.map((r) => `${r.from.table}.${r.from.field}->${r.to.table}.${r.to.field}`);
	it("infers <X>Id, singular/plural, prefix and Id<X>", () => {
		expect(rel).toContain("Weighing.VehicleId->Vehicles.Id");
		expect(rel).toContain("Weighing.CustId->Customer.CustomerCode");
		expect(rel).toContain("Weighing.IdVehicles->Vehicles.Id");
		expect(erd.relations.every((r) => r.kind === "inferred")).toBe(true);
	});
	it("infers identical non-key field matching another table key", () => {
		const e = buildErd(project([db("A", [["Code", "String"]]), db("B", [["Id", "Integer"], ["Code", "String"]])]));
		expect(e.relations.map((r) => `${r.from.table}.${r.from.field}->${r.to.table}.${r.to.field}`)).toEqual(["B.Code->A.Code"]);
	});
	it("negative cases: no self relation, no lowercase id, no unknown table, no ambiguity", () => {
		expect(rel.some((r) => r.startsWith("Weighing.Valid"))).toBe(false);
		expect(rel.some((r) => r.startsWith("Weighing.WeighingId"))).toBe(false);
		expect(rel.some((r) => r.startsWith("Weighing.Plate"))).toBe(false); // Plate is not a key of Vehicles
		const e = buildErd(project([db("Customer", [["Id", "Integer"]]), db("CustomerType", [["Id", "Integer"]]), db("X", [["Id", "Integer"], ["CustId", "Integer"], ["NopeId", "Integer"]])]));
		expect(e.relations).toEqual([]);
		for (const r of erd.relations) {
			expect(r.from.table).not.toBe(r.to.table);
		}
	});
});

describe("erdToMermaid", () => {
	it("emits exact text", () => {
		const erd = buildErd(project([db("Vehicles", [["Id", "Integer"], ["Plate", "String"]]), db("Weighing", [["Id", "Integer"], ["VehicleId", "Integer"]])]));
		expect(erdToMermaid(erd)).toBe(
			[
				"erDiagram",
				"    Vehicles {",
				"        Integer Id",
				"        String Plate",
				"    }",
				"    Weighing {",
				"        Integer Id",
				"        Integer VehicleId",
				"    }",
				'    Weighing }o--|| Vehicles : "VehicleId"',
				"",
			].join("\n"),
		);
	});
	it("sanitizes identifiers", () => {
		const erd = buildErd(project([db("My Table-1", [["a b", "Str(ing)"]])]));
		const out = erdToMermaid(erd);
		expect(out).toContain("My_Table_1 {");
		expect(out).toContain("Str_ing_ a_b");
	});
});

describe("renderErdHtml", () => {
	const opts = { cspSource: "vscode-resource:", nonce: "N0NCE", title: "T <x>" };
	it("escapes names, sets CSP and draws one card per table", () => {
		const p = project([db("<script>alert(1)</script>", [["a\"b", "Integer"]], 3), db("B", [["Id", "Integer"]])]);
		const html = renderErdHtml(buildErd(p), opts);
		expect(html).not.toContain("<script>alert(1)</script>");
		expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
		expect(html).toContain("script-src 'nonce-N0NCE'");
		expect(html).toContain("default-src 'none'");
		expect(html).toContain("style-src 'nonce-N0NCE'");
		expect(html).not.toContain("'unsafe-inline'");
		expect(html).toContain('<script nonce="N0NCE">');
		expect(html).toContain("typeof acquireVsCodeApi");
		expect(html.match(/class="card"/g)).toHaveLength(2);
		expect(html).toContain('data-line="3"');
	});
	it("draws dashed relations and diagnostics", () => {
		const p = project([db("Vehicles", [["Id", "Integer"]]), db("W", [["VehicleId", "Integer"]])]);
		const html = renderErdHtml(buildErd(p, parseRev(revText([]))), opts);
		expect(html).toContain("stroke-dasharray");
		expect(html).toContain("exists in source but not in .rev");
	});
});
