import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../../src/cli/revCli";
import type { CliIo } from "../../src/cli/revCli";
import { nodeIo } from "../../src/cli/nodeIo";
import { nextFreeId } from "../../src/editor/widgetRules";
import { parseRev } from "../../src/rev";
import { computeConfigHash, readConfigHash } from "../../src/rev/configHash";

const FIX = join(__dirname, "../fixtures/rev");
const sha = (b: Buffer): string => createHash("sha256").update(b).digest("hex");
const dirs: string[] = [];
afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function temp(name = "hashed.rev", wrap?: (base: CliIo) => CliIo) {
	const dir = mkdtempSync(join(tmpdir(), "rev-cli-write-"));
	dirs.push(dir);
	const file = join(dir, "main.rev");
	copyFileSync(join(FIX, name), file);
	const run = (args: string[]) => {
		const r = runCli(args, wrap ? wrap(nodeIo()) : nodeIo());
		return { code: r.code, body: JSON.parse(r.stdout) as Record<string, any>, stderr: r.stderr };
	};
	return { dir, file, run, bytes: () => readFileSync(file), files: () => readdirSync(dir).sort() };
}

const lines = (b: Buffer): string[] => b.toString("latin1").split("\n");
const diffLines = (a: Buffer, b: Buffer): string[] => {
	const x = lines(a);
	return lines(b).filter((l, i) => l !== x[i]);
};

describe("widget set", () => {
	it("dry-run reports the planned change and leaves the file byte-identical", () => {
		const t = temp();
		const before = t.bytes();
		const r = t.run(["widget", "set", t.file, "4", "x=200"]);
		expect(r.code).toBe(0);
		expect(r.stderr).toBe("");
		expect(r.body).toMatchObject({ ok: true, command: "widget set", file: t.file, dryRun: true, fileHash: sha(before) });
		expect(r.body.backup).toBeUndefined();
		expect(r.body.changes).toEqual([{ op: "set", id: 4, fields: { x: { from: "170", to: "200" } } }]);
		expect(Array.isArray(r.body.warnings)).toBe(true);
		expect(t.bytes().equals(before)).toBe(true);
		expect(t.files()).toEqual(["main.rev"]);
	});

	it("--write backs up, changes only the edited line and the ConfigHash, and reads back", () => {
		const t = temp();
		const before = t.bytes();
		const r = t.run(["widget", "set", t.file, "4", "x=200", "fontSize=20", "--write", "--expect-hash", sha(before)]);
		expect(r.code).toBe(0);
		expect(r.body).toMatchObject({ ok: true, dryRun: false, fileHash: sha(before) });
		const after = t.bytes();
		expect(r.body.newHash).toBe(sha(after));
		expect(r.body.backup).toBe(join(t.dir, "main.rev.bak"));
		expect(readFileSync(r.body.backup).equals(before)).toBe(true);
		expect(t.files()).toEqual(["main.rev", "main.rev.bak"]);
		expect(after.subarray(0, 3)).toEqual(before.subarray(0, 3));
		expect(lines(after).length).toBe(lines(before).length);
		const changed = diffLines(before, after);
		expect(changed.length).toBe(2);
		expect(changed.some((l) => l.startsWith("WDGT#4="))).toBe(true);
		expect(changed.some((l) => l.includes("<ConfigHash"))).toBe(true);
		const text = after.toString("latin1");
		expect(readConfigHash(text)).toBe(computeConfigHash(text));
		const w = parseRev(after.toString("utf8")).widgets.find((x) => x.id === 4);
		expect(w?.x).toBe(200);
		expect(w?.fontSize).toBe(20);
		expect(text.includes("\r\n")).toBe(true);
	});

	it("an earlier backup is never overwritten", () => {
		const t = temp();
		const first = t.bytes();
		expect(t.run(["widget", "set", t.file, "4", "x=201", "--write"]).code).toBe(0);
		const second = t.run(["widget", "set", t.file, "4", "x=202", "--write"]);
		expect(second.code).toBe(0);
		expect(readFileSync(join(t.dir, "main.rev.bak")).equals(first)).toBe(true);
		expect(second.body.backup).not.toBe(join(t.dir, "main.rev.bak"));
		expect(existsSync(second.body.backup)).toBe(true);
	});

	it("an alias change warns with the main.iri lines and never touches main.iri", () => {
		const t = temp();
		const r = t.run(["widget", "set", t.file, "4", "alias=total4", "--write"]);
		expect(r.code).toBe(0);
		const warn = (r.body.warnings as string[]).join("\n");
		expect(warn).toContain("main.iri");
		expect(warn).toContain("total4");
		expect(warn).toContain("lbl4");
		expect(t.files().some((f) => f.endsWith(".iri"))).toBe(false);
	});

	it("a no-op value writes nothing", () => {
		const t = temp();
		const before = t.bytes();
		const r = t.run(["widget", "set", t.file, "4", "x=170", "--write"]);
		expect(r.code).toBe(0);
		expect(r.body.changes).toEqual([]);
		expect(r.body.backup).toBeUndefined();
		expect(t.bytes().equals(before)).toBe(true);
		expect(t.files()).toEqual(["main.rev"]);
	});

	it("--expect-hash with the current hash is accepted", () => {
		const t = temp();
		expect(t.run(["widget", "set", t.file, "4", "x=1", "--expect-hash", sha(t.bytes())]).code).toBe(0);
	});
});

describe("rejected input leaves the file byte-identical, no backup, pinned exit code", () => {
	const cases: Array<[string, (f: string) => string[], number, RegExp]> = [
		["unknown field", (f) => ["widget", "set", f, "4", "nope=1", "--write"], 3, /nope/],
		["read-only field (type)", (f) => ["widget", "set", f, "4", "type=3", "--write"], 3, /type/],
		["out-of-range value", (f) => ["widget", "set", f, "4", "x=99999", "--write"], 3, /x/],
		["not a number", (f) => ["widget", "set", f, "4", "x=abc", "--write"], 3, /x/],
		["alias with a bad character", (f) => ["widget", "set", f, "4", "alias=bad-name", "--write"], 3, /alias/],
		["alias too long", (f) => ["widget", "set", f, "4", "alias=abcdefghi", "--write"], 3, /alias/],
		["alias already used", (f) => ["widget", "set", f, "4", "alias=bar3", "--write"], 3, /already used/],
		["unknown id", (f) => ["widget", "set", f, "777", "x=1", "--write"], 3, /777/],
		["comma in a value", (f) => ["widget", "set", f, "4", "caption=a,b", "--write"], 3, /caption/],
		["stale --expect-hash", (f) => ["widget", "set", f, "4", "x=1", "--write", "--expect-hash", "0".repeat(64)], 4, /stale/i],
		["stale --expect-hash in dry-run", (f) => ["widget", "set", f, "4", "x=1", "--expect-hash", "0".repeat(64)], 4, /stale/i],
		["unknown widget type on add", (f) => ["widget", "add", f, "99", "--screen", "1", "--write"], 3, /99/],
		["add without --screen", (f) => ["widget", "add", f, "4", "--write"], 2, /--screen/],
		["add type not a number", (f) => ["widget", "add", f, "label", "--screen", "1", "--write"], 2, /type/],
		["set without a field", (f) => ["widget", "set", f, "4", "--write"], 2, /field/],
		["field without =", (f) => ["widget", "set", f, "4", "x", "--write"], 2, /x/],
		["unknown widget subcommand", (f) => ["widget", "zap", f, "4"], 2, /zap/],
		["--write with --dry-run", (f) => ["widget", "set", f, "4", "x=1", "--write", "--dry-run"], 2, /dry-run/],
		["unknown option", (f) => ["widget", "set", f, "4", "x=1", "--frob"], 2, /--frob/],
		["bad --expect-hash format", (f) => ["widget", "set", f, "4", "x=1", "--expect-hash", "zz"], 2, /expect-hash/],
		["rm unknown id", (f) => ["widget", "rm", f, "777", "--write"], 3, /777/],
		["rm id not a number", (f) => ["widget", "rm", f, "abc", "--write"], 2, /id/],
	];
	for (const [name, args, code, re] of cases) {
		it(name, () => {
			const t = temp();
			const before = t.bytes();
			const r = t.run(args(t.file));
			expect(r.code).toBe(code);
			expect(r.body.ok).toBe(false);
			expect(String(r.body.error)).toMatch(re);
			expect(t.bytes().equals(before)).toBe(true);
			expect(t.files()).toEqual(["main.rev"]);
		});
	}

	it("a missing file is exit 1", () => {
		const t = temp();
		const r = t.run(["widget", "set", join(t.dir, "none.rev"), "4", "x=1"]);
		expect(r.code).toBe(1);
		expect(r.body).toMatchObject({ ok: false });
	});
});

describe("failures while writing", () => {
	it("a failed backup leaves the target untouched (exit 5)", () => {
		const t = temp("hashed.rev", (base) => ({
			...base,
			writeFs: {
				...(base.writeFs as NonNullable<CliIo["writeFs"]>),
				copyExcl: () => {
					throw new Error("disk full");
				},
			},
		}));
		const before = t.bytes();
		const r = t.run(["widget", "set", t.file, "4", "x=1", "--write"]);
		expect(r.code).toBe(5);
		expect(r.body).toMatchObject({ ok: false });
		expect(String(r.body.error)).toContain("disk full");
		expect(t.bytes().equals(before)).toBe(true);
		expect(t.files()).toEqual(["main.rev"]);
	});

	it("a failed rename removes the temp file and keeps the target (exit 5)", () => {
		const t = temp("hashed.rev", (base) => ({
			...base,
			writeFs: {
				...(base.writeFs as NonNullable<CliIo["writeFs"]>),
				rename: () => {
					throw new Error("locked");
				},
			},
		}));
		const before = t.bytes();
		const r = t.run(["widget", "set", t.file, "4", "x=1", "--write"]);
		expect(r.code).toBe(5);
		expect(String(r.body.error)).toContain("locked");
		expect(t.bytes().equals(before)).toBe(true);
		expect(t.files()).toEqual(["main.rev", "main.rev.bak"]);
	});

	it("a file that changed after planning is refused as stale (exit 4)", () => {
		let reads = 0;
		const t = temp("hashed.rev", (base) => ({
			...base,
			readBinary: (p) => {
				const b = base.readBinary(p);
				if (b && p.endsWith("main.rev") && ++reads === 2) {
					const c = Buffer.from(b);
					c[c.length - 1] ^= 1;
					return c;
				}
				return b;
			},
		}));
		const before = t.bytes();
		const r = t.run(["widget", "set", t.file, "4", "x=1", "--write"]);
		expect(r.code).toBe(4);
		expect(t.bytes().equals(before)).toBe(true);
		expect(t.files()).toEqual(["main.rev"]);
	});
});

describe("widget add", () => {
	it("uses the lowest free id, the default tokens and alias, appends after the last WDGT line", () => {
		const t = temp("hashed.rev");
		const before = t.bytes();
		const used = parseRev(before.toString("utf8")).widgets.map((w) => w.id);
		const id = nextFreeId(used) as number;
		const r = t.run(["widget", "add", t.file, "4", "--screen", "2", "x=5", "y=6", "caption=Hi", "--write"]);
		expect(r.code).toBe(0);
		expect(r.body.changes).toHaveLength(1);
		expect(r.body.changes[0]).toMatchObject({ op: "add", id, type: 4, alias: `lbl${id}` });
		const after = t.bytes();
		const w = parseRev(after.toString("utf8")).widgets.find((x) => x.id === id);
		expect(w).toMatchObject({ type: 4, screen: 2, x: 5, y: 6, alias: `lbl${id}`, text: "Hi" });
		const l = lines(after);
		const last = l.map((x, i) => (x.startsWith("WDGT#") ? i : -1)).reduce((a, b) => Math.max(a, b));
		expect(l[last].startsWith(`WDGT#${id}=`)).toBe(true);
		expect((r.body.warnings as string[]).join("\n")).toContain(`lbl${id}`);
		const text = after.toString("latin1");
		expect(readConfigHash(text)).toBe(computeConfigHash(text));
		expect(diffLines(before, after).some((x) => x.startsWith("WDGT#"))).toBe(true);
	});

	it("dry-run does not write", () => {
		const t = temp("hashed.rev");
		const before = t.bytes();
		const r = t.run(["widget", "add", t.file, "4", "--screen", "2"]);
		expect(r.code).toBe(0);
		expect(r.body.dryRun).toBe(true);
		expect(r.body.changes[0].op).toBe("add");
		expect(t.bytes().equals(before)).toBe(true);
	});
});

describe("widget rm", () => {
	it("removes an unreferenced widget; without a project it warns instead of guessing", () => {
		const t = temp("hashed.rev");
		const before = t.bytes();
		const r = t.run(["widget", "rm", t.file, "3", "--write"]);
		expect(r.code).toBe(0);
		expect(r.body.changes).toEqual([{ op: "rm", id: 3, alias: "bar3" }]);
		const warn = (r.body.warnings as string[]).join("\n");
		expect(warn).toContain("main.src");
		expect(warn).toContain("bar3");
		expect(parseRev(t.bytes().toString("utf8")).widgets.some((w) => w.id === 3)).toBe(false);
		expect(lines(before).length - lines(t.bytes()).length).toBe(1);
	});

	function withProject() {
		const t = temp("hashed.rev");
		writeFileSync(join(t.dir, "main.src"), "program main;\r\n#include ui.iri\r\n");
		writeFileSync(join(t.dir, "ui.iri"), 'procedure Show;\r\nbegin\r\n  SetLabelText(lbl4, "x");\r\nend;\r\n');
		return t;
	}

	it("refuses a widget used in code unless --force", () => {
		const t = withProject();
		const before = t.bytes();
		const r = t.run(["widget", "rm", t.file, "4", "--write"]);
		expect(r.code).toBe(3);
		expect(r.body.ok).toBe(false);
		expect(String(r.body.error)).toMatch(/lbl4/);
		expect(r.body.references.length).toBe(1);
		expect(t.bytes().equals(before)).toBe(true);
		expect(t.files()).toEqual(["main.rev", "main.src", "ui.iri"]);
	});

	it("--force removes it and keeps the references in warnings", () => {
		const t = withProject();
		const r = t.run(["widget", "rm", t.file, "4", "--force", "--write"]);
		expect(r.code).toBe(0);
		expect((r.body.warnings as string[]).join("\n")).toContain("lbl4");
		expect(parseRev(t.bytes().toString("utf8")).widgets.some((w) => w.id === 4)).toBe(false);
	});
});

describe("DOLE golden round trip (copy in a temp dir)", () => {
	const DIR = process.env.IRI_GOLDEN_DIR ?? "C:\\Users\\Allan Castro\\Documents\\localdev\\IPESAH\\DOLE";
	const src = join(DIR, "main.rev");
	it.skipIf(!existsSync(src))("widget set x changes only that WDGT line and the ConfigHash", () => {
		const dir = mkdtempSync(join(tmpdir(), "rev-cli-dole-"));
		dirs.push(dir);
		const file = join(dir, "main.rev");
		copyFileSync(src, file);
		const before = readFileSync(file);
		const w = parseRev(before.toString("utf8")).widgets.find((x) => x.x !== undefined && x.type === 4);
		expect(w).toBeDefined();
		const id = (w as { id: number }).id;
		const x = (w as { x: number }).x;
		const r = runCli(["widget", "set", file, String(id), `x=${x + 1}`, "--write", "--expect-hash", sha(before)], nodeIo());
		expect(r.code).toBe(0);
		const after = readFileSync(file);
		const a = lines(before);
		const b = lines(after);
		expect(b.length).toBe(a.length);
		const idx = b.flatMap((l, i) => (l !== a[i] ? [i] : []));
		expect(idx.length).toBe(2);
		expect(idx.filter((i) => b[i].startsWith(`WDGT#${id}=`)).length).toBe(1);
		expect(idx.filter((i) => b[i].includes("<ConfigHash")).length).toBe(1);
		expect(parseRev(after.toString("utf8")).widgets.find((v) => v.id === id)?.x).toBe(x + 1);
		expect(after.subarray(0, 3)).toEqual(before.subarray(0, 3));
		expect(readFileSync(join(dir, "main.rev.bak")).equals(before)).toBe(true);
		expect(existsSync(src)).toBe(true);
	});
});
