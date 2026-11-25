import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { nodeIo } from "../../src/cli/nodeIo";
import { runCli } from "../../src/cli/revCli";
import { MAX_RESULT_CHARS, TOOLS, runTool } from "../../src/lmtools/tools";
import type { LiveDiagnostic, ToolContext } from "../../src/lmtools/tools";

const FIX = resolve(__dirname, "../fixtures");
const DIAG = join(FIX, "diagnose");
const io = nodeIo();
const ctx = (over: Partial<ToolContext> = {}): ToolContext => ({
	roots: [FIX],
	io,
	exists: (p) => io.exists(p),
	findMainSrc: () => [join(DIAG, "main.src")],
	...over,
});
const cli = (args: string[]) => JSON.parse(runCli(args, io).stdout);
const call = async (name: string, input: unknown, c: ToolContext = ctx()) => {
	const r = await runTool(name, input, c);
	return { ok: r.ok, text: r.text, body: JSON.parse(r.text) as Record<string, any> };
};

describe("tool table", () => {
	it("lists the read tools", () => {
		const names = TOOLS.filter(t => t.kind === "read").map(t => t.name);
		expect(names).toEqual(["irite_screens", "irite_widgets", "irite_diagnose", "irite_dbSchema"]);
	});
	it("rejects unknown tools", async () => {
		const r = await call("irite_nope", {});
		expect(r.ok).toBe(false);
		expect(r.body.error).toContain("Unknown tool");
	});
});

describe("input validation", () => {
	it("returns structured errors for bad input without touching files", async () => {
		const r = await call("irite_widgets", { screen: "abc", panel: "9", extra: 1 });
		expect(r.ok).toBe(false);
		expect(r.body.ok).toBe(false);
		expect(r.body.error).toContain('Unknown property "extra"');
		expect(r.body.error).toContain('"screen" must be an integer');
		expect(r.body.error).toContain('"panel" must be one of');
	});
});

describe("path policy", () => {
	it("refuses a rev outside the workspace folders", async () => {
		for (const rev of [join(FIX, "..", "cli", "x.rev"), "..", "..\\..\\x.rev", "D:\\x\\main.rev"]) {
			const r = await call("irite_screens", { rev }, ctx({ roots: [DIAG] }));
			expect(r.ok, rev).toBe(false);
		}
	});
	it("asks for an explicit rev when none or several projects exist", async () => {
		const none = await call("irite_screens", {}, ctx({ findMainSrc: () => [] }));
		expect(none.ok).toBe(false);
		expect(none.body.error).toContain('pass "rev"');
		const many = await call("irite_screens", {}, ctx({ findMainSrc: () => [join(DIAG, "main.src"), join(FIX, "editor", "main.src")], exists: () => true }));
		expect(many.ok).toBe(false);
		expect(many.body.error).toContain("More than one iRite project");
	});
});

describe("irite_screens", () => {
	it("equals the CLI JSON for an explicit rev and for the located project", async () => {
		const expected = cli(["screens", join(DIAG, "main.rev")]);
		expect((await call("irite_screens", { rev: join(DIAG, "main.rev") })).body).toEqual(expected);
		expect((await call("irite_screens", {})).body).toEqual(expected);
		expect((await call("irite_screens", { rev: DIAG })).body).toEqual(expected);
	});
	it("reports an unreadable rev as a structured error", async () => {
		const r = await call("irite_screens", { rev: join(FIX, "rev", "missing.rev") });
		expect(r.ok).toBe(false);
		expect(r.body.ok).toBe(false);
	});
});

describe("irite_widgets", () => {
	const rev = join(DIAG, "main.rev");
	const screens: number[] = cli(["screens", rev]).screens.map((s: any) => s.number);
	it("equals the CLI JSON for a screen and panel", async () => {
		const n = screens[0];
		expect((await call("irite_widgets", { rev, screen: n, panel: "12" })).body).toEqual(cli(["widgets", rev, "--screen", String(n), "--panel", "12"]));
		expect((await call("irite_widgets", { rev, screen: n })).body).toEqual(cli(["widgets", rev, "--screen", String(n), "--panel", "7"]));
	});
	it("defaults to the lowest screen with a note listing the others", async () => {
		const r = await call("irite_widgets", { rev });
		expect(r.ok).toBe(true);
		const lowest = Math.min(...screens);
		expect(r.body.screens.map((s: any) => s.number)).toEqual([lowest]);
		expect(r.body.note).toContain("screen");
		expect(r.body.note).toContain(String(screens.length));
		expect(r.body.screens[0]).toEqual(cli(["widgets", rev, "--screen", String(lowest)]).screens[0]);
	});
	it("reports an unknown screen", async () => {
		const r = await call("irite_widgets", { rev, screen: 998 });
		expect(r.ok).toBe(false);
		expect(r.body.error).toContain("Screen 998 not found");
	});
	it("truncates very large results and says so", async () => {
		const big = cli(["screens", rev]).screens.sort((a: any, b: any) => b.widgetCount - a.widgetCount)[0].number;
		const r = await call("irite_widgets", { rev, screen: big }, ctx({ maxChars: 1500 }));
		expect(r.ok).toBe(true);
		expect(r.text.length).toBeLessThanOrEqual(1500 + 600);
		expect(r.body.truncated.shown).toBeLessThan(r.body.truncated.total);
		expect(r.body.truncated.note).toContain("irite_widgets");
		expect(r.body.screens[0].widgets.length).toBe(r.body.truncated.shown);
	});
	it("does not truncate normal results", async () => {
		const r = await call("irite_widgets", { rev, screen: screens[0] });
		expect(r.body.truncated).toBeUndefined();
		expect(MAX_RESULT_CHARS).toBeGreaterThan(10000);
	});
});

describe("irite_diagnose", () => {
	const cliBody = cli(["diagnose", DIAG]);
	it("equals the CLI JSON plus an empty live section", async () => {
		const r = await call("irite_diagnose", {});
		const { live, ...rest } = r.body;
		expect(rest).toEqual(cliBody);
		expect(live).toMatchObject({ diagnostics: [], counts: { total: 0, bySource: { "irite-sfc": 0, "irite-db-access": 0 }, bySeverity: { error: 0, warning: 0, info: 0 } } });
		expect(live.note).toContain("Problems");
	});
	it("accepts a folder, a .rev and main.src", async () => {
		for (const rev of [DIAG, join(DIAG, "main.rev"), join(DIAG, "main.src")]) {
			expect((await call("irite_diagnose", { rev })).ok, rev).toBe(true);
		}
	});
	it("merges live Problems of the iRite collections inside the project, nothing else", async () => {
		const live: LiveDiagnostic[] = [
			{ file: join(DIAG, "src", "a.iri"), line: 4, severity: "error", message: "no target", source: "iRite SFC", code: "no-target" },
			{ file: join(DIAG, "main.iri"), line: 2, severity: "warning", message: "missing dbX", source: "iRite DB access" },
			{ file: join(DIAG, "main.src"), line: 1, severity: "error", message: "ts error", source: "ts" },
			{ file: join(DIAG, "main.src"), line: 1, severity: "info", message: "no source" },
			{ file: join(FIX, "rev", "x.iri"), line: 1, severity: "warning", message: "other project", source: "iRite SFC" },
		];
		const r = await call("irite_diagnose", {}, ctx({ liveDiagnostics: () => live }));
		expect(r.body.live.diagnostics).toEqual([
			{ source: "irite-sfc", severity: "error", file: join(DIAG, "src", "a.iri"), line: 4, message: "no target", code: "no-target" },
			{ source: "irite-db-access", severity: "warning", file: join(DIAG, "main.iri"), line: 2, message: "missing dbX" },
		]);
		expect(r.body.live.counts).toEqual({ total: 2, bySource: { "irite-sfc": 1, "irite-db-access": 1 }, bySeverity: { error: 1, warning: 1, info: 0 } });
		expect(r.body.diagnostics).toEqual(cliBody.diagnostics);
	});
	it("truncates a huge diagnostics list with a note", async () => {
		const live: LiveDiagnostic[] = Array.from({ length: 200 }, (_, i) => ({ file: join(DIAG, "main.iri"), line: i + 1, severity: "warning" as const, message: "m".repeat(40) + i, source: "iRite SFC" }));
		const r = await call("irite_diagnose", {}, ctx({ liveDiagnostics: () => live, maxChars: 4000 }));
		expect(r.ok).toBe(true);
		expect(r.body.truncated.note).toContain("irite_diagnose");
		expect(r.text.length).toBeLessThan(4000 + 800);
		expect(r.body.live.counts.total).toBe(200);
	});
});

describe("irite_dbSchema", () => {
	it("lists tables and fields of the .rev database", async () => {
		const r = await call("irite_dbSchema", { rev: join(FIX, "rev", "db.rev") });
		expect(r.ok).toBe(true);
		expect(r.body.file).toBe("db.rev");
		expect(r.body.tables.length).toBeGreaterThan(0);
		const t = r.body.tables[0];
		expect(t).toMatchObject({ index: expect.any(Number), name: expect.any(String), maxRecords: expect.any(Number) });
		expect(t.fields[0]).toMatchObject({ name: expect.any(String), typeCode: expect.any(Number), size: expect.any(Number), type: expect.any(String) });
	});
	it("gives an empty list for a rev without database tables", async () => {
		const r = await call("irite_dbSchema", { rev: join(FIX, "rev", "sample.rev") });
		expect(r.ok).toBe(true);
		expect(Array.isArray(r.body.tables)).toBe(true);
	});
});
