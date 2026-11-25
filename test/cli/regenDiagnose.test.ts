import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkDbAccess, DEFAULT_OPTIONS, tableDiagnostics } from "../../src/dbaccess";
import { generateMainIri } from "../../src/iri/generateIri";
import { loadIriteProject } from "../../src/irite";
import { nodeIo } from "../../src/cli/nodeIo";
import { runCli } from "../../src/cli/revCli";
import { parseRev } from "../../src/rev";
import { groupSfcDiagnostics } from "../../src/sfc/sfcDiagnostics";
import { buildSfc } from "../../src/sfc/sfcModel";
import type { CliIo } from "../../src/cli/revCli";

const FIX = join(__dirname, "../fixtures");
const DOLE = process.env.IRI_GOLDEN_DIR ?? "C:\\Users\\Allan Castro\\Documents\\localdev\\IPESAH\\DOLE";
const sha = (b: Buffer): string => createHash("sha256").update(b).digest("hex");
const dirs: string[] = [];
afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = (): string => {
	const d = mkdtempSync(join(tmpdir(), "rev-cli-regen-"));
	dirs.push(d);
	return d;
};
const run = (args: string[], io: CliIo = nodeIo()) => {
	const r = runCli(args, io);
	return { code: r.code, stdout: r.stdout, stderr: r.stderr, body: r.stdout.startsWith("{") ? (JSON.parse(r.stdout) as Record<string, any>) : {} };
};

function regenSetup(withIri: "same" | "different" | "none") {
	const dir = tmp();
	const rev = join(dir, "main.rev");
	copyFileSync(join(FIX, "editor/main.rev"), rev);
	const expected = Buffer.from(generateMainIri(parseRev(readFileSync(rev, "utf8"))), "utf8");
	const iri = join(dir, "main.iri");
	if (withIri === "same") writeFileSync(iri, expected);
	if (withIri === "different") writeFileSync(iri, "-- old\r\nfoo : constant integer := 1;\r\n");
	return { dir, rev, iri, expected, files: () => readdirSync(dir).sort() };
}

describe("regen-iri", () => {
	it("dry-run reports a replace and never writes", () => {
		const t = regenSetup("different");
		const before = readFileSync(t.iri);
		const revBefore = readFileSync(t.rev);
		const r = run(["regen-iri", t.rev]);
		expect(r.code).toBe(0);
		expect(r.stderr).toBe("");
		expect(r.body).toMatchObject({ ok: true, command: "regen-iri", file: t.iri, dryRun: true, fileHash: sha(before), newHash: sha(t.expected) });
		expect(r.body.changes[0]).toMatchObject({ op: "replace" });
		expect(r.body.changes[0].added).toBeGreaterThan(0);
		expect(r.body.changes[0].removed).toBe(2);
		expect(r.body.backup).toBeUndefined();
		expect(Array.isArray(r.body.warnings)).toBe(true);
		expect(readFileSync(t.iri).equals(before)).toBe(true);
		expect(readFileSync(t.rev).equals(revBefore)).toBe(true);
		expect(t.files()).toEqual(["main.iri", "main.rev"]);
	});

	it("--write backs up main.iri and replaces it; the .rev is untouched", () => {
		const t = regenSetup("different");
		const before = readFileSync(t.iri);
		const revBefore = readFileSync(t.rev);
		const r = run(["regen-iri", t.rev, "--write", "--expect-hash", sha(before)]);
		expect(r.code).toBe(0);
		expect(r.body).toMatchObject({ ok: true, dryRun: false, fileHash: sha(before), newHash: sha(t.expected) });
		expect(r.body.backup).toBe(join(t.dir, "main.iri.bak"));
		expect(readFileSync(r.body.backup).equals(before)).toBe(true);
		expect(readFileSync(t.iri).equals(t.expected)).toBe(true);
		expect(readFileSync(t.rev).equals(revBefore)).toBe(true);
		expect(t.files()).toEqual(["main.iri", "main.iri.bak", "main.rev"]);
	});

	it("up to date: reports unchanged and writes nothing, even with --write", () => {
		const t = regenSetup("same");
		const r = run(["regen-iri", t.rev, "--write"]);
		expect(r.code).toBe(0);
		expect(r.body).toMatchObject({ ok: true, fileHash: sha(t.expected), dryRun: false });
		expect(r.body.changes).toEqual([{ op: "unchanged" }]);
		expect(r.body.backup).toBeUndefined();
		expect(t.files()).toEqual(["main.iri", "main.rev"]);
	});

	it("missing target: dry-run reports create with fileHash null; --write creates it without a backup", () => {
		const t = regenSetup("none");
		const d = run(["regen-iri", t.rev]);
		expect(d.body).toMatchObject({ ok: true, dryRun: true, fileHash: null });
		expect(d.body.changes[0]).toMatchObject({ op: "create" });
		expect(existsSync(t.iri)).toBe(false);
		const w = run(["regen-iri", t.rev, "--write"]);
		expect(w.code).toBe(0);
		expect(w.body.backup).toBeUndefined();
		expect(readFileSync(t.iri).equals(t.expected)).toBe(true);
		expect(t.files()).toEqual(["main.iri", "main.rev"]);
	});

	it("stale --expect-hash: exit 4, nothing written (dry-run and --write)", () => {
		const t = regenSetup("different");
		const before = readFileSync(t.iri);
		for (const extra of [[], ["--write"]]) {
			const r = run(["regen-iri", t.rev, "--expect-hash", "0".repeat(64), ...extra]);
			expect(r.code).toBe(4);
			expect(r.body).toMatchObject({ ok: false, command: "regen-iri", fileHash: sha(before) });
			expect(readFileSync(t.iri).equals(before)).toBe(true);
			expect(t.files()).toEqual(["main.iri", "main.rev"]);
		}
	});

	it("--expect-hash on a missing target is stale (exit 4)", () => {
		const t = regenSetup("none");
		const r = run(["regen-iri", t.rev, "--expect-hash", "0".repeat(64), "--write"]);
		expect(r.code).toBe(4);
		expect(existsSync(t.iri)).toBe(false);
	});

	it("failed backup leaves the target untouched (exit 5)", () => {
		const t = regenSetup("different");
		const before = readFileSync(t.iri);
		const base = nodeIo();
		const io: CliIo = {
			...base,
			writeFs: {
				...base.writeFs!,
				copyExcl: () => {
					throw new Error("disk full");
				},
			},
		};
		const r = run(["regen-iri", t.rev, "--write"], io);
		expect(r.code).toBe(5);
		expect(r.body.ok).toBe(false);
		expect(readFileSync(t.iri).equals(before)).toBe(true);
		expect(t.files()).toEqual(["main.iri", "main.rev"]);
	});

	it("usage and unreadable exit codes", () => {
		const t = regenSetup("none");
		expect(run(["regen-iri"]).code).toBe(2);
		expect(run(["regen-iri", t.rev, "--bogus"]).code).toBe(2);
		expect(run(["regen-iri", t.rev, "--write", "--dry-run"]).code).toBe(2);
		expect(run(["regen-iri", t.rev, "--expect-hash", "xyz"]).code).toBe(2);
		const r = run(["regen-iri", join(t.dir, "nope.rev")]);
		expect(r.code).toBe(1);
		expect(r.body).toMatchObject({ ok: false, command: "regen-iri" });
	});

	it.skipIf(!existsSync(join(DOLE, "main.rev")) || !existsSync(join(DOLE, "main.iri")))("DOLE golden: a copy reports up to date (DOLE itself is never touched)", () => {
		const dir = tmp();
		copyFileSync(join(DOLE, "main.rev"), join(dir, "main.rev"));
		copyFileSync(join(DOLE, "main.iri"), join(dir, "main.iri"));
		const r = run(["regen-iri", join(dir, "main.rev")]);
		expect(r.code).toBe(0);
		expect(r.body.changes).toEqual([{ op: "unchanged" }]);
		expect(readdirSync(dir).sort()).toEqual(["main.iri", "main.rev"]);
	});
});

describe("diagnose", () => {
	const project = join(FIX, "diagnose");
	const mainSrc = join(project, "main.src");

	it("reports SFC, DB access and widget diagnostics with counts", () => {
		const r = run(["diagnose", project]);
		expect(r.code).toBe(0);
		expect(r.stderr).toBe("");
		expect(r.body).toMatchObject({ ok: true, command: "diagnose", project: mainSrc, rev: join(project, "main.rev") });
		const by = (s: string) => r.body.diagnostics.filter((d: any) => d.source === s);
		expect(by("irite-sfc").length).toBeGreaterThan(0);
		expect(by("irite-db-access").length).toBeGreaterThan(0);
		const widgets = by("widgets");
		expect(widgets.map((d: any) => d.code).sort()).toEqual(["out-of-bounds", "overlap"]);
		expect(widgets.find((d: any) => d.code === "overlap")).toMatchObject({ severity: "warning", file: join(project, "main.rev"), line: expect.any(Number) });
		expect(r.body.counts.total).toBe(r.body.diagnostics.length);
		expect(r.body.counts.bySource["widgets"]).toBe(2);
		expect(r.body.counts.bySeverity.warning).toBeGreaterThan(0);
	});

	it("accepts a directory, main.src and main.rev alike", () => {
		const a = run(["diagnose", project]).stdout;
		expect(run(["diagnose", mainSrc]).stdout).toBe(a);
		expect(run(["diagnose", join(project, "main.rev")]).stdout).toBe(a);
	});

	it("SFC and DB-access diagnostics equal the pure producers' output for the same input", () => {
		const read = (p: string) => {
			try {
				return readFileSync(p, "utf8");
			} catch {
				return undefined;
			}
		};
		const model = loadIriteProject(mainSrc, read);
		const sfc = [...groupSfcDiagnostics(buildSfc(model, {}).diagnostics, mainSrc)].flatMap(([file, list]) =>
			list.map((d) => ({ source: "irite-sfc", severity: d.severity, file, line: d.line, message: d.message, code: d.code })),
		);
		const db = tableDiagnostics(checkDbAccess(model, read, DEFAULT_OPTIONS)).map((t) => ({ source: "irite-db-access", severity: "warning", file: t.file, line: t.line, message: t.message, code: "irite-db-access" }));
		expect(sfc.length).toBeGreaterThan(0);
		expect(db.length).toBeGreaterThan(0);
		const got = run(["diagnose", project]).body.diagnostics;
		expect(got.filter((d: any) => d.source === "irite-sfc")).toEqual(sfc);
		expect(got.filter((d: any) => d.source === "irite-db-access")).toEqual(db);
	});

	it("is read-only", () => {
		const dir = tmp();
		cpSync(project, dir, { recursive: true });
		const snap = () => readdirSync(dir, { recursive: true } as any).map((f) => String(f)).sort().join("|");
		const before = snap();
		run(["diagnose", dir]);
		expect(snap()).toBe(before);
	});

	it("a .rev without main.src yields only widget diagnostics", () => {
		const dir = tmp();
		copyFileSync(join(project, "main.rev"), join(dir, "main.rev"));
		const r = run(["diagnose", join(dir, "main.rev")]);
		expect(r.code).toBe(0);
		expect(r.body.project).toBeNull();
		expect(new Set(r.body.diagnostics.map((d: any) => d.source))).toEqual(new Set(["widgets"]));
	});

	it("usage and unreadable exit codes", () => {
		expect(run(["diagnose"]).code).toBe(2);
		expect(run(["diagnose", project, "--bogus"]).code).toBe(2);
		const r = run(["diagnose", join(tmp(), "nothing")]);
		expect(r.code).toBe(1);
		expect(r.body).toMatchObject({ ok: false, command: "diagnose" });
		expect(run(["diagnose", tmp()]).code).toBe(1);
	});
});
