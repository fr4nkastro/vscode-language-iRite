import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli, USAGE } from "../../src/cli/revCli";
import { nodeIo } from "../../src/cli/nodeIo";
import { parseRev } from "../../src/rev";
import { computeConfigHash, readConfigHash } from "../../src/rev/configHash";

const FIX = join(__dirname, "../fixtures/rev");
const sha = (b: Buffer): string => createHash("sha256").update(b).digest("hex");
const dirs: string[] = [];
afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function temp(src = join(FIX, "db.rev")) {
	const dir = mkdtempSync(join(tmpdir(), "rev-cli-db-"));
	dirs.push(dir);
	const file = join(dir, "main.rev");
	copyFileSync(src, file);
	const run = (args: string[]) => {
		const r = runCli(args, nodeIo());
		return { code: r.code, body: JSON.parse(r.stdout) as Record<string, any>, stderr: r.stderr };
	};
	return { dir, file, run, bytes: () => readFileSync(file), files: () => readdirSync(dir).sort() };
}

const lines = (b: Buffer): string[] => b.toString("latin1").split("\n");
const isDb = (l: string): boolean => /^DB\.(SCHEMA|ALIAS)#/.test(l);
const isHash = (l: string): boolean => l.includes("<ConfigHash");
/** Every line that is neither a DB line nor the ConfigHash header, in order. */
const rest = (b: Buffer): string[] => lines(b).filter((l) => !isDb(l) && !isHash(l));
const dbLines = (b: Buffer): string[] => lines(b).filter(isDb).map((l) => l.replace(/\r$/, ""));

const BASE = [
	"DB.SCHEMA#1=1000,0,Id,7,15,Weight,4,4,Count,2,2",
	"DB.ALIAS#1=Inbound",
	"DB.SCHEMA#2=100,0,Code,6,10",
	"DB.ALIAS#2=Product",
	"DB.SCHEMA#3=50,0,Tag,6,8,Mystery,9,3",
	"DB.ALIAS#3=Legacy",
];

interface Case {
	name: string;
	args: string[];
	db: string[];
	op: string;
}
const WRITES: Case[] = [
	{ name: "add-table with a field", args: ["add-table", "Lot", "--records", "50", "--field", "Num:Long Integer"], op: "addTable", db: [...BASE, "DB.SCHEMA#4=50,0,Num,3,4", "DB.ALIAS#4=Lot"] },
	{ name: "rm-table", args: ["rm-table", "Product"], op: "rmTable", db: [BASE[0], BASE[1], BASE[4], BASE[5]] },
	{ name: "add-field by numeric code", args: ["add-field", "Product", "Qty", "3"], op: "addField", db: [BASE[0], BASE[1], "DB.SCHEMA#2=100,0,Code,6,10,Qty,3,4", BASE[3], BASE[4], BASE[5]] },
	{ name: "add-field by name, size and position", args: ["add-field", "Inbound", "Note", "variable length string", "--size", "30", "--at", "1"], op: "addField", db: ["DB.SCHEMA#1=1000,0,Note,7,30,Id,7,15,Weight,4,4,Count,2,2", ...BASE.slice(1)] },
	{ name: "set-field type resets the size to the default", args: ["set-field", "Inbound", "Weight", "type=Double Precision Real"], op: "setField", db: ["DB.SCHEMA#1=1000,0,Id,7,15,Weight,5,8,Count,2,2", ...BASE.slice(1)] },
	{ name: "set-field name and size", args: ["set-field", "Inbound", "Id", "name=Ident", "size=40"], op: "setField", db: ["DB.SCHEMA#1=1000,0,Ident,7,40,Weight,4,4,Count,2,2", ...BASE.slice(1)] },
	{ name: "rm-field", args: ["rm-field", "Inbound", "Count"], op: "rmField", db: ["DB.SCHEMA#1=1000,0,Id,7,15,Weight,4,4", ...BASE.slice(1)] },
	{ name: "move-field", args: ["move-field", "Inbound", "Count", "1"], op: "moveField", db: ["DB.SCHEMA#1=1000,0,Count,2,2,Id,7,15,Weight,4,4", ...BASE.slice(1)] },
];

describe("db write commands: dry-run and --write round trip", () => {
	it.each(WRITES)("$name: dry-run leaves the file byte-identical and plans the change", (c) => {
		const t = temp();
		const before = t.bytes();
		const r = t.run(["db", c.args[0], t.file, ...c.args.slice(1)]);
		expect(r.code).toBe(0);
		expect(r.stderr).toBe("");
		expect(r.body).toMatchObject({ ok: true, command: `db ${c.args[0]}`, file: t.file, dryRun: true, fileHash: sha(before) });
		expect(r.body.backup).toBeUndefined();
		expect(r.body.changes.length).toBe(1);
		expect(r.body.changes[0].op).toBe(c.op);
		const warn = (r.body.warnings as string[]).join("\n");
		expect(warn).toContain("main.iri");
		expect(warn).toContain("regen-iri");
		expect(t.bytes().equals(before)).toBe(true);
		expect(t.files()).toEqual(["main.rev"]);
	});

	it.each(WRITES)("$name: --write backs up, changes only DB lines and the ConfigHash, reads back", (c) => {
		const t = temp();
		const before = t.bytes();
		expect(dbLines(before)).toEqual(BASE);
		const r = t.run(["db", c.args[0], t.file, ...c.args.slice(1), "--write", "--expect-hash", sha(before)]);
		expect(r.code).toBe(0);
		expect(r.body).toMatchObject({ ok: true, dryRun: false, fileHash: sha(before) });
		const after = t.bytes();
		expect(r.body.newHash).toBe(sha(after));
		expect(r.body.backup).toBe(join(t.dir, "main.rev.bak"));
		expect(readFileSync(r.body.backup).equals(before)).toBe(true);
		expect(t.files()).toEqual(["main.rev", "main.rev.bak"]);
		expect(dbLines(after)).toEqual(c.db);
		expect(rest(after)).toEqual(rest(before));
		expect(after.subarray(0, 3)).toEqual(before.subarray(0, 3));
		expect(after.toString("latin1").split("\n").every((l, i, a) => i === a.length - 1 || l.endsWith("\r"))).toBe(true);
		const text = after.toString("latin1");
		expect(readConfigHash(text)).not.toBe(readConfigHash(before.toString("latin1")));
		expect(readConfigHash(text)).toBe(computeConfigHash(text));
		expect(parseRev(after.toString("utf8")).databases.length).toBe(c.db.length / 2);
	});

	it("a no-op move writes nothing", () => {
		const t = temp();
		const before = t.bytes();
		const r = t.run(["db", "move-field", t.file, "Inbound", "Count", "3", "--write"]);
		expect(r.code).toBe(0);
		expect(r.body.changes).toEqual([]);
		expect(r.body.backup).toBeUndefined();
		expect(t.bytes().equals(before)).toBe(true);
		expect(t.files()).toEqual(["main.rev"]);
	});

	it("never writes main.iri and the change report names the affected field", () => {
		const t = temp();
		const r = t.run(["db", "set-field", t.file, "inbound", "weight", "name=Net", "--write"]);
		expect(r.code).toBe(0);
		expect(r.body.changes).toEqual([{ op: "setField", table: "Inbound", field: "Weight", position: 2, changes: { name: { from: "Weight", to: "Net" } } }]);
		expect(t.files().some((f) => f.endsWith(".iri"))).toBe(false);
		expect(String(r.body.iriHint)).toContain("Inbound_Net");
	});
});

describe("db rejected input leaves the file byte-identical", () => {
	const REJECT: Array<[string, string[], number, string]> = [
		["unknown table", ["rm-table", "Nope"], 3, 'Table "Nope" does not exist'],
		["unknown table on add-field", ["add-field", "Nope", "A", "3"], 3, 'Table "Nope" does not exist'],
		["unknown field", ["rm-field", "Inbound", "Nope"], 3, 'Field "Nope" does not exist'],
		["duplicate table name", ["add-table", "product", "--field", "A:3"], 3, "already exists"],
		["duplicate field name", ["add-field", "Inbound", "weight", "3"], 3, "already exists"],
		["rename onto an existing field", ["set-field", "Inbound", "Id", "name=Count"], 3, "already exists"],
		["bad type name", ["add-field", "Inbound", "A", "Bogus"], 3, 'Unknown type "Bogus"'],
		["unknown type code", ["add-field", "Inbound", "A", "9"], 3, "Unknown type code 9"],
		["type None cannot be added", ["add-field", "Inbound", "A", "0"], 3, "cannot be added"],
		["reserved word", ["add-field", "Inbound", "begin", "3"], 3, "invalid or missing iRite identifier"],
		["name over 8 characters", ["add-field", "Inbound", "Ninechars", "3"], 3, "maximum 8"],
		["string size over 255", ["add-field", "Inbound", "A", "6", "--size", "256"], 3, "up to 255"],
		["size on a fixed-size type", ["add-field", "Inbound", "A", "3", "--size", "9"], 3, "must be 4"],
		["size ignored by a type change", ["set-field", "Inbound", "Id", "type=3", "size=9"], 3, "does not apply"],
		["records over the limit", ["add-table", "Big", "--records", "2000001", "--field", "A:3"], 3, "exceeds 2000000"],
		["zero records", ["add-table", "Zero", "--records", "0", "--field", "A:3"], 3, "positive"],
		["a table needs a field", ["add-table", "Empty"], 3, "requires at least one field"],
		["bad --field spec", ["add-table", "Lot", "--field", "oops"], 3, "Name:type[:size]"],
		["position past the end (--at)", ["add-field", "Inbound", "A", "3", "--at", "5"], 3, "out of range (1..4)"],
		["position zero (--at)", ["add-field", "Inbound", "A", "3", "--at", "0"], 3, "out of range"],
		["move position past the end", ["move-field", "Inbound", "Id", "4"], 3, "out of range (1..3)"],
		["move position zero", ["move-field", "Inbound", "Id", "0"], 3, "out of range"],
		["unknown type code field is read-only (size)", ["set-field", "Legacy", "Mystery", "size=5"], 3, "unknown type code"],
		["unknown type code field is read-only (type)", ["set-field", "Legacy", "Mystery", "type=3"], 3, "unknown type code"],
		["usage: missing argument", ["add-field", "Inbound", "A"], 2, "Missing <type>"],
		["usage: extra argument", ["rm-table", "Product", "x"], 2, "Unexpected argument"],
		["usage: set-field without changes", ["set-field", "Inbound", "Id"], 2, "at least one"],
		["usage: bad set-field key", ["set-field", "Inbound", "Id", "color=1"], 2, "Expected name="],
		["usage: non numeric --size", ["add-field", "Inbound", "A", "6", "--size", "x"], 2, "--size must be"],
		["usage: non numeric position", ["move-field", "Inbound", "Id", "x"], 2, "1-based integer"],
		["usage: option of another command", ["rm-table", "Product", "--size", "3"], 2, "Unknown option --size"],
		["usage: bad --expect-hash", ["rm-table", "Product", "--expect-hash", "abc"], 2, "SHA-256"],
		["usage: unknown subcommand", ["drop-table", "Product"], 2, "Unknown db subcommand"],
	];
	it.each(REJECT)("%s", (_n, args, code, text) => {
		const t = temp();
		const before = t.bytes();
		for (const write of [false, true]) {
			const r = t.run(["db", args[0], t.file, ...args.slice(1), ...(write ? ["--write"] : [])]);
			expect(r.code).toBe(code);
			expect(r.stderr).toBe("");
			expect(r.body.ok).toBe(false);
			expect(String(r.body.error)).toContain(text);
			expect(t.bytes().equals(before)).toBe(true);
			expect(t.files()).toEqual(["main.rev"]);
		}
	});

	it("--write with --dry-run is a usage error", () => {
		const t = temp();
		const r = t.run(["db", "rm-table", t.file, "Product", "--write", "--dry-run"]);
		expect(r.code).toBe(2);
		expect(String(r.body.error)).toContain("cannot be used together");
		expect(t.files()).toEqual(["main.rev"]);
	});

	it("a stale hash is refused with exit 4 and nothing is written", () => {
		const t = temp();
		const before = t.bytes();
		const r = t.run(["db", "rm-table", t.file, "Product", "--write", "--expect-hash", "0".repeat(64)]);
		expect(r.code).toBe(4);
		expect(r.body).toMatchObject({ ok: false, command: "db rm-table", fileHash: sha(before), expectedHash: "0".repeat(64) });
		expect(String(r.body.error)).toContain("Stale file");
		expect(t.bytes().equals(before)).toBe(true);
		expect(t.files()).toEqual(["main.rev"]);
	});

	it("a missing file is exit 1 and a missing file argument is exit 2", () => {
		const t = temp();
		const r = t.run(["db", "rm-table", join(t.dir, "nope.rev"), "Product"]);
		expect(r.code).toBe(1);
		expect(r.body.ok).toBe(false);
		const u = runCli(["db", "rm-table"], nodeIo());
		expect(u.code).toBe(2);
		expect(JSON.parse(u.stdout).error).toContain("Missing <file.rev>");
	});
});

describe("db: existing commands and usage text", () => {
	it("USAGE documents every db command", () => {
		for (const s of ["add-table", "rm-table", "add-field", "set-field", "rm-field", "move-field"]) expect(USAGE).toContain(`db ${s}`);
	});
	it("read commands still work on the same file", () => {
		const t = temp();
		const r = runCli(["screens", t.file], nodeIo());
		expect(r.code).toBe(0);
		expect(JSON.parse(r.stdout).screens.length).toBeGreaterThan(0);
	});
});

describe("DOLE golden db round trip (copy in a temp dir)", () => {
	const DIR = process.env.IRI_GOLDEN_DIR ?? "C:\\Users\\Allan Castro\\Documents\\localdev\\IPESAH\\DOLE";
	const src = join(DIR, "main.rev");
	it.skipIf(!existsSync(src))("db add-field changes only DB lines and the ConfigHash", () => {
		const t = temp(src);
		const before = t.bytes();
		const model = parseRev(before.toString("utf8")).databases.find((d) => d.fields.length < 99 && !d.fields.some((f) => f.typeCode === 0 || f.typeCode > 8));
		expect(model).toBeDefined();
		const name = (model as { name: string }).name;
		const r = t.run(["db", "add-field", t.file, name, "ZZNew", "Long Integer", "--write", "--expect-hash", sha(before)]);
		expect(r.code).toBe(0);
		const after = t.bytes();
		expect(rest(after)).toEqual(rest(before));
		expect(lines(after).filter(isDb).length).toBe(lines(before).filter(isDb).length);
		expect(after.subarray(0, 3)).toEqual(before.subarray(0, 3));
		const text = after.toString("latin1");
		expect(readConfigHash(text)).toBe(computeConfigHash(text));
		const f = parseRev(after.toString("utf8")).databases.find((d) => d.name === name)?.fields.at(-1);
		expect(f).toMatchObject({ name: "ZZNew", typeCode: 3, size: 4 });
		expect(readFileSync(join(t.dir, "main.rev.bak")).equals(before)).toBe(true);
		expect(existsSync(src)).toBe(true);
	});
});
