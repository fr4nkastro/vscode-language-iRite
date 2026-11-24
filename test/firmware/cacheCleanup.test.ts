import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { removeBestEffort, sweepLeftovers } from "../../src/firmware/cacheCleanup";

let tmp: string;
beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "irite-fwc-"));
});
afterEach(() => {
	rmSync(tmp, { recursive: true, force: true });
});
const err = (code: string) => Object.assign(new Error(code), { code });

describe("removeBestEffort", () => {
	it("retries EBUSY/EPERM/ENOTEMPTY with backoff and then succeeds", async () => {
		let n = 0;
		const sleeps: number[] = [];
		const r = await removeBestEffort("x", {
			rm: () => {
				if (++n === 1) throw err("EPERM");
				if (n === 2) throw err("ENOTEMPTY");
			},
			sleep: async (ms) => void sleeps.push(ms),
			attempts: 4,
		});
		expect(r).toEqual({ removed: true });
		expect(n).toBe(3);
		expect(sleeps.length).toBe(2);
	});
	it("reports a persistent EBUSY after the configured attempts without throwing", async () => {
		let n = 0;
		const r = await removeBestEffort("x", { rm: () => { n++; throw err("EBUSY"); }, sleep: async () => {}, attempts: 3 });
		expect(n).toBe(3);
		expect(r.removed).toBe(false);
		expect(r.error).toContain("EBUSY");
	});
	it("does not retry or throw on other errors", async () => {
		let n = 0;
		const r = await removeBestEffort("x", { rm: () => { n++; throw err("EIO"); }, sleep: async () => {}, attempts: 3 });
		expect(n).toBe(1);
		expect(r.removed).toBe(false);
		expect(r.error).toContain("EIO");
	});
});

describe("sweepLeftovers", () => {
	it("removes only .old-/.tmp- direct children and keeps everything else", async () => {
		const root = join(tmp, "firmware-images");
		for (const d of [".old-2.09.04-aaaaaaaaaaaa", ".tmp-b", "2.09.04", ".oldish", "tmp-c", join("2.09.04", ".old-nested")]) mkdirSync(join(root, d), { recursive: true });
		writeFileSync(join(root, ".tmp-file"), "x");
		const r = await sweepLeftovers(root, { now: () => Date.now() + 48 * 3600_000, sleep: async () => {} });
		expect(r.removed.sort()).toEqual([".old-2.09.04-aaaaaaaaaaaa", ".tmp-b", ".tmp-file"]);
		expect(r.failed).toEqual([]);
		expect(existsSync(join(root, ".old-2.09.04-aaaaaaaaaaaa"))).toBe(false);
		expect(existsSync(join(root, ".tmp-b"))).toBe(false);
		for (const d of ["2.09.04", ".oldish", "tmp-c", join("2.09.04", ".old-nested")]) expect(existsSync(join(root, d))).toBe(true);
	});
	it("is a no-op when the root is missing", async () => {
		expect(await sweepLeftovers(join(tmp, "nope"), {})).toEqual({ removed: [], failed: [], restored: [] });
		expect(existsSync(join(tmp, "nope"))).toBe(false);
	});
	it("reports failures instead of throwing", async () => {
		const root = join(tmp, "firmware-images");
		mkdirSync(join(root, ".old-2.09.04-aaaaaaaaaaaa"), { recursive: true });
		mkdirSync(join(root, "2.09.04"));
		const r = await sweepLeftovers(root, { now: () => Date.now() + 48 * 3600_000, rm: () => { throw err("EBUSY"); }, sleep: async () => {}, attempts: 2 });
		expect(r.removed).toEqual([]);
		expect(r.failed.map((f) => f.name)).toEqual([".old-2.09.04-aaaaaaaaaaaa"]);
		expect(r.failed[0].error).toContain("EBUSY");
	});
});

describe("sweepLeftovers age and restore rules (B1/B2)", () => {
	const HOUR = 3600_000;
	const mk = (root: string, d: string, mtimeMs?: number) => {
		mkdirSync(join(root, d), { recursive: true });
		writeFileSync(join(root, d, "f.txt"), "x");
		if (mtimeMs !== undefined) {
			utimesSync(join(root, d, "f.txt"), mtimeMs / 1000, mtimeMs / 1000);
			utimesSync(join(root, d), mtimeMs / 1000, mtimeMs / 1000);
		}
	};
	it("keeps a fresh .tmp-*/.old-* and removes a stale one", async () => {
		const root = join(tmp, "firmware-images");
		const now = Date.now();
		mk(root, ".tmp-fresh", now - HOUR);
		mk(root, ".tmp-stale", now - 48 * HOUR);
		mk(root, "1.0", now - 48 * HOUR);
		mk(root, ".old-1.0-aaaaaaaaaaaa", now - 48 * HOUR);
		mk(root, ".old-1.0-bbbbbbbbbbbb", now - HOUR);
		mk(root, "2.0", now - 48 * HOUR);
		mk(root, ".old-2.0-cccccccccccc", now - 48 * HOUR);
		const r = await sweepLeftovers(root, { now: () => now, sleep: async () => {} });
		expect(r.removed.sort()).toEqual([".old-1.0-aaaaaaaaaaaa", ".old-2.0-cccccccccccc", ".tmp-stale"]);
		expect(existsSync(join(root, ".tmp-fresh"))).toBe(true);
		expect(existsSync(join(root, ".old-1.0-bbbbbbbbbbbb"))).toBe(true);
	});
	it("a stale .tmp-* with a recently written child is kept (newest mtime of entry and children)", async () => {
		const root = join(tmp, "firmware-images");
		const now = Date.now();
		mk(root, ".tmp-busy", now - 48 * HOUR);
		utimesSync(join(root, ".tmp-busy", "f.txt"), (now - HOUR) / 1000, (now - HOUR) / 1000);
		const r = await sweepLeftovers(root, { now: () => now });
		expect(r.removed).toEqual([]);
		expect(existsSync(join(root, ".tmp-busy"))).toBe(true);
	});
	it("restores a stranded .old-<version>-x when the version dir is missing", async () => {
		const root = join(tmp, "firmware-images");
		const now = Date.now();
		mk(root, ".old-2.09.04-abcdef012345", now - 48 * HOUR);
		const r = await sweepLeftovers(root, { now: () => now });
		expect(r.restored).toEqual(["2.09.04"]);
		expect(r.removed).toEqual([]);
		expect(readFileSync(join(root, "2.09.04", "f.txt"), "utf8")).toBe("x");
		expect(existsSync(join(root, ".old-2.09.04-abcdef012345"))).toBe(false);
	});
	it("keeps look-alike names and legacy .old-<hex> without a version", async () => {
		const root = join(tmp, "firmware-images");
		const now = Date.now();
		for (const d of ["old-1", ".oldx", "tmp-1", ".old-abcdef012345"]) mk(root, d, now - 48 * HOUR);
		const r = await sweepLeftovers(root, { now: () => now });
		expect(r).toEqual({ removed: [], failed: [], restored: [] });
		for (const d of ["old-1", ".oldx", "tmp-1", ".old-abcdef012345"]) expect(existsSync(join(root, d))).toBe(true);
	});
});
