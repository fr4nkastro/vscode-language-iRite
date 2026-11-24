import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
		for (const d of [".old-a", ".tmp-b", "2.09.04", ".oldish", "tmp-c", join("2.09.04", ".old-nested")]) mkdirSync(join(root, d), { recursive: true });
		writeFileSync(join(root, ".tmp-file"), "x");
		const r = await sweepLeftovers(root, { sleep: async () => {} });
		expect(r.removed.sort()).toEqual([".old-a", ".tmp-b", ".tmp-file"]);
		expect(r.failed).toEqual([]);
		expect(existsSync(join(root, ".old-a"))).toBe(false);
		expect(existsSync(join(root, ".tmp-b"))).toBe(false);
		for (const d of ["2.09.04", ".oldish", "tmp-c", join("2.09.04", ".old-nested")]) expect(existsSync(join(root, d))).toBe(true);
	});
	it("is a no-op when the root is missing", async () => {
		expect(await sweepLeftovers(join(tmp, "nope"), {})).toEqual({ removed: [], failed: [] });
		expect(existsSync(join(tmp, "nope"))).toBe(false);
	});
	it("reports failures instead of throwing", async () => {
		const root = join(tmp, "firmware-images");
		mkdirSync(join(root, ".old-a"), { recursive: true });
		const r = await sweepLeftovers(root, { rm: () => { throw err("EBUSY"); }, sleep: async () => {}, attempts: 2 });
		expect(r.removed).toEqual([]);
		expect(r.failed.map((f) => f.name)).toEqual([".old-a"]);
		expect(r.failed[0].error).toContain("EBUSY");
	});
});
