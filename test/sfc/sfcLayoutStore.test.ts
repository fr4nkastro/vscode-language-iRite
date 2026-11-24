import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadDiagram, saveDiagram, sidecarPath } from "../../src/sfc/sfcLayoutStore";

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "irite-sfc-store-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const d1 = { steps: { a: { x: 1, y: 2 } }, links: {} };
const d2 = { steps: { b: { x: 3, y: 4 } }, links: { "t@b": { bar: { x: 5, y: 6 } } } };

describe("sfc layout store", () => {
	it("locates the sidecar under .vscode of the base folder", () => {
		expect(sidecarPath(dir)).toBe(join(dir, ".vscode", "irite-sfc.layout.json"));
	});
	it("reads nothing from a missing file", () => {
		expect(loadDiagram(sidecarPath(dir), "k")).toEqual({ diagram: undefined });
	});
	it("saves, reloads and keeps other diagrams when one is replaced or removed", () => {
		const f = sidecarPath(dir);
		expect(saveDiagram(f, "one", d1)).toEqual({ ok: true });
		expect(saveDiagram(f, "two", d2)).toEqual({ ok: true });
		expect(loadDiagram(f, "one").diagram).toEqual(d1);
		expect(loadDiagram(f, "two").diagram).toEqual(d2);
		expect(saveDiagram(f, "one", undefined)).toEqual({ ok: true });
		expect(loadDiagram(f, "one").diagram).toBeUndefined();
		expect(loadDiagram(f, "two").diagram).toEqual(d2);
		expect(readdirSync(join(dir, ".vscode"))).toEqual(["irite-sfc.layout.json"]);
	});
	it("deletes the file when the last diagram is reset", () => {
		const f = sidecarPath(dir);
		saveDiagram(f, "one", d1);
		saveDiagram(f, "one", undefined);
		expect(existsSync(f)).toBe(false);
		expect(saveDiagram(f, "one", undefined)).toEqual({ ok: true });
	});
	it("never overwrites a sidecar it cannot understand", () => {
		const f = sidecarPath(dir);
		mkdirSync(join(dir, ".vscode"));
		writeFileSync(f, "{ not json", "utf8");
		expect(saveDiagram(f, "one", d1)).toEqual({ ok: false, reason: "invalid-json" });
		expect(readFileSync(f, "utf8")).toBe("{ not json");
		writeFileSync(f, '{"version":9,"diagrams":{}}', "utf8");
		expect(loadDiagram(f, "one")).toEqual({ problem: "unsupported-version" });
		expect(saveDiagram(f, "one", d1)).toEqual({ ok: false, reason: "unsupported-version" });
	});
});
