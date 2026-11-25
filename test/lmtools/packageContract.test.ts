import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TOOLS } from "../../src/lmtools/tools";

const pkg = JSON.parse(readFileSync(join(__dirname, "../../package.json"), "utf8"));
const declared: any[] = pkg.contributes.languageModelTools ?? [];

describe("package.json languageModelTools contract", () => {
	it("requires VS Code 1.95+", () => {
		const [maj, min] = String(pkg.engines.vscode).replace(/^[^\d]*/, "").split(".").map(Number);
		expect(maj === 1 && min >= 95).toBe(true);
		expect(pkg.devDependencies["@types/vscode"]).toMatch(/1\.95/);
	});
	it("declares exactly the tools of the registration table", () => {
		expect(declared.map((t) => t.name).sort()).toEqual(TOOLS.map((t) => t.name).sort());
	});
	it("has the required fields on every tool", () => {
		expect(declared.length).toBeGreaterThan(0);
		for (const t of declared) {
			expect(t.name).toMatch(/^irite_[A-Za-z0-9]+$/);
			expect(t.displayName).toBeTruthy();
			expect(t.toolReferenceName).toMatch(/^[A-Za-z0-9_-]+$/);
			expect(t.canBeReferencedInPrompt).toBe(true);
			expect(t.userDescription).toBeTruthy();
			expect(t.modelDescription.length).toBeGreaterThan(60);
			expect(t.tags).toContain("irite");
			expect(t.inputSchema.type).toBe("object");
			expect(typeof t.inputSchema.properties).toBe("object");
			for (const p of Object.values<any>(t.inputSchema.properties)) {
				expect(["string", "integer", "boolean", "array"]).toContain(p.type);
				expect(p.description).toBeTruthy();
			}
		}
	});
	it("keeps the schema in package.json identical to the validator's schema", () => {
		for (const def of TOOLS) {
			expect(declared.find((t) => t.name === def.name)?.inputSchema, def.name).toEqual(def.inputSchema);
		}
	});
	it("read tools declare no required input", () => {
		for (const def of TOOLS.filter((t) => t.kind === "read")) {
			expect(def.inputSchema.required ?? []).toEqual([]);
		}
	});
});
