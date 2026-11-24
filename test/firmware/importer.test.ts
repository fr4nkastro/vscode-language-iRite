import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importFirmwareImages } from "../../src/firmware/importer";
import { buildTar, imgPath, makePng, type TarItem } from "./tarHelper";

let tmp: string;
beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "irite-fw-"));
});
afterEach(() => {
	rmSync(tmp, { recursive: true, force: true });
});

function updateFolder(name: string, items: TarItem[], manifest: string | null): string {
	const dir = join(tmp, name);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "rootfs.tar"), buildTar(items));
	if (manifest !== null) writeFileSync(join(dir, "manifest.txt"), manifest);
	return dir;
}

const storage = () => join(tmp, "storage");
const items = (): TarItem[] => [
	{ name: "./var/", typeflag: "5" },
	{ name: "./etc/passwd", body: "root" },
	{ name: imgPath("default", 1), body: makePng(10, 20, 5) },
	{ name: imgPath("7", 1), body: makePng(10, 20, 5) },
	{ name: imgPath("12", 2), body: makePng(30, 40), pax: { mtime: "1" } },
	{ name: imgPath("7", 3), body: "this is not a png" },
	{ name: imgPath("7", "x"), body: makePng(1, 1) },
	{ name: "./var/node/public/images7/lclimages/../../../x/9.png", body: makePng(1, 1) },
];

describe("importFirmwareImages", () => {
	it("writes <storage>/firmware-images/<version>/{default,7,12}/N.png and manifest.json", async () => {
		const src = updateFolder("update", items(), "image_version=2.09.04\n");
		const r = await importFirmwareImages({ source: src, storageDir: storage() });
		const dir = join(storage(), "firmware-images", "2.09.04");
		expect(r.firmwareVersion).toBe("2.09.04");
		expect(r.dir).toBe(dir);
		expect(r.counts).toEqual({ default: 1, "7": 1, "12": 1 });
		expect(r.rejected.nonPng).toBe(1);
		expect(readFileSync(join(dir, "7", "1.png")).equals(makePng(10, 20, 5))).toBe(true);
		expect(existsSync(join(dir, "12", "2.png"))).toBe(true);
		expect(existsSync(join(dir, "7", "3.png"))).toBe(false);
		expect(existsSync(join(dir, "7", "x.png"))).toBe(false);
		expect(existsSync(join(storage(), "firmware-images", "x"))).toBe(false);
		const mf = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
		expect(mf.firmwareVersion).toBe("2.09.04");
		expect(mf.source).toBe(src);
		expect(typeof mf.importedAt).toBe("string");
		expect(mf.counts).toEqual({ default: 1, "7": 1, "12": 1 });
		expect(mf.images["12"]["2"]).toEqual({ width: 30, height: 40, bytes: makePng(30, 40).length });
		expect(mf.images["7"]["1"]).toEqual({ width: 10, height: 20, bytes: makePng(10, 20, 5).length });
	});

	it("accepts a rootfs.tar path directly and reads manifest.txt next to it", async () => {
		const src = updateFolder("update", items(), "core_version=3.0.1\n");
		const r = await importFirmwareImages({ source: join(src, "rootfs.tar"), storageDir: storage() });
		expect(r.firmwareVersion).toBe("3.0.1");
	});

	it("without manifest.txt derives unknown-<hash of the images>, stable across imports", async () => {
		const a = updateFolder("a", items(), null);
		const r1 = await importFirmwareImages({ source: join(a, "rootfs.tar"), storageDir: storage() });
		expect(r1.firmwareVersion).toMatch(/^unknown-[0-9a-f]{8}$/);
		const b = updateFolder("b", items(), null);
		const r2 = await importFirmwareImages({ source: join(b, "rootfs.tar"), storageDir: storage() });
		expect(r2.firmwareVersion).toBe(r1.firmwareVersion);
	});

	it("rejects an unsafe version in manifest.txt without writing anything", async () => {
		const src = updateFolder("update", items(), "image_version=../evil\n");
		await expect(importFirmwareImages({ source: src, storageDir: storage() })).rejects.toThrow(/version/i);
		expect(existsSync(join(storage(), "firmware-images", "evil"))).toBe(false);
	});

	it("fails when the archive has no built-in images and leaves no version dir", async () => {
		const src = updateFolder("update", [{ name: "./etc/passwd", body: "x" }], "image_version=1.0\n");
		await expect(importFirmwareImages({ source: src, storageDir: storage() })).rejects.toThrow(/no built-in images/i);
		const fi = join(storage(), "firmware-images");
		expect(existsSync(fi) ? readdirSync(fi) : []).toEqual([]);
	});

	it("fails on a malformed tar and cleans its temp dir", async () => {
		const src = updateFolder("update", [{ name: imgPath("7", 1), body: makePng(1, 1), badChecksum: true }], "image_version=1.0\n");
		await expect(importFirmwareImages({ source: src, storageDir: storage() })).rejects.toThrow(/checksum/i);
		const fi = join(storage(), "firmware-images");
		expect(existsSync(fi) ? readdirSync(fi) : []).toEqual([]);
	});

	it("is idempotent: re-import replaces the version dir cleanly and keeps other versions", async () => {
		const v1 = updateFolder("v1", items(), "image_version=1.0.0\n");
		const v2 = updateFolder("v2", [{ name: imgPath("7", 5), body: makePng(5, 5) }], "image_version=2.0.0\n");
		await importFirmwareImages({ source: v1, storageDir: storage() });
		await importFirmwareImages({ source: v2, storageDir: storage() });
		// re-import v1 with different content: old files must not linger
		const v1b = updateFolder("v1b", [7, 8, 9].map((n) => ({ name: imgPath("12", n), body: makePng(n, n) })), "image_version=1.0.0\n");
		const r = await importFirmwareImages({ source: v1b, storageDir: storage() });
		const fi = join(storage(), "firmware-images");
		expect(readdirSync(fi).sort()).toEqual(["1.0.0", "2.0.0"]);
		expect(r.counts).toEqual({ default: 0, "7": 0, "12": 3 });
		expect(existsSync(join(fi, "1.0.0", "7", "1.png"))).toBe(false);
		expect(existsSync(join(fi, "1.0.0", "12", "7.png"))).toBe(true);
		expect(existsSync(join(fi, "2.0.0", "7", "5.png"))).toBe(true);
		// same-content re-import twice is stable
		const again = await importFirmwareImages({ source: v1b, storageDir: storage() });
		expect(again.counts).toEqual(r.counts);
		expect(readdirSync(fi).sort()).toEqual(["1.0.0", "2.0.0"]);
	});

	it("keeps the previous cache and leaves no temp dir when a re-import archive has no end-of-archive marker", async () => {
		const good = updateFolder("good", items(), "image_version=3.0.0\n");
		await importFirmwareImages({ source: good, storageDir: storage() });
		const fi = join(storage(), "firmware-images");
		const snap = () => {
			const d = join(fi, "3.0.0");
			return readdirSync(d, { recursive: true, withFileTypes: false }).map(String).sort().map((f) => {
				const p = join(d, f);
				return [f, statSync(p).isFile() ? readFileSync(p).toString("base64") : "dir"];
			});
		};
		const before = snap();
		const dir = join(tmp, "cut");
		mkdirSync(dir);
		writeFileSync(join(dir, "rootfs.tar"), buildTar([{ name: imgPath("default", 9), body: makePng(5, 5) }], { terminator: false }));
		writeFileSync(join(dir, "manifest.txt"), "image_version=3.0.0\n");
		await expect(importFirmwareImages({ source: dir, storageDir: storage() })).rejects.toThrow(/end-of-archive/i);
		expect(snap()).toEqual(before);
		expect(readdirSync(fi)).toEqual(["3.0.0"]);
	});

	describe("re-import of an existing version", () => {
		const good = (): TarItem[] => [
			{ name: imgPath("default", 1), body: makePng(10, 20, 5) },
			{ name: imgPath("7", 1), body: makePng(10, 20, 6) },
			{ name: imgPath("12", 2), body: makePng(30, 40) },
		];
		const snapshot = (dir: string): Record<string, string> => {
			const out: Record<string, string> = {};
			const walk = (d: string, rel: string): void => {
				for (const n of readdirSync(d)) {
					const p = join(d, n);
					if (statSync(p).isDirectory()) walk(p, `${rel}${n}/`);
					else out[`${rel}${n}`] = readFileSync(p).toString("base64");
				}
			};
			walk(dir, "");
			return out;
		};

		it("keeps the current cache untouched when the re-import yields fewer usable images", async () => {
			const first = updateFolder("a", good(), "image_version=2.0\n");
			await importFirmwareImages({ source: first, storageDir: storage() });
			const dir = join(storage(), "firmware-images", "2.0");
			const before = snapshot(dir);
			const degraded: TarItem[] = [
				{ name: imgPath("default", 1), body: makePng(10, 20, 5) },
				{ name: imgPath("7", 1), body: "not a png" },
				{ name: imgPath("12", 2), body: "also not a png" },
			];
			const second = updateFolder("b", degraded, "image_version=2.0\n");
			const r = await importFirmwareImages({ source: second, storageDir: storage() });
			expect(r.replaced).toBe(false);
			expect(r.keptExisting).toBe(true);
			expect(r.previousCounts).toEqual({ default: 1, "7": 1, "12": 1 });
			expect(r.counts).toEqual({ default: 1, "7": 0, "12": 0 });
			expect(r.rejected).toEqual({ nonPng: 2, tooLarge: 0 });
			expect(r.dir).toBe(dir);
			expect(snapshot(dir)).toEqual(before);
			expect(readdirSync(join(storage(), "firmware-images"))).toEqual(["2.0"]);
		});

		it("still replaces when the re-import yields an equal or larger number of images", async () => {
			await importFirmwareImages({ source: updateFolder("a", good(), "image_version=2.0\n"), storageDir: storage() });
			const same = good();
			same[0] = { name: imgPath("default", 1), body: makePng(11, 21) };
			const r = await importFirmwareImages({ source: updateFolder("b", same, "image_version=2.0\n"), storageDir: storage() });
			expect(r.replaced).toBe(true);
			expect(r.keptExisting).toBe(false);
			const dir = join(storage(), "firmware-images", "2.0");
			expect(readFileSync(join(dir, "default", "1.png")).equals(makePng(11, 21))).toBe(true);
			const more = [...good(), { name: imgPath("12", 3), body: makePng(2, 2) }];
			const r2 = await importFirmwareImages({ source: updateFolder("c", more, "image_version=2.0\n"), storageDir: storage() });
			expect(r2.replaced).toBe(true);
			expect(existsSync(join(dir, "12", "3.png"))).toBe(true);
		});

		it("a new version is reported as replaced without previous counts", async () => {
			const r = await importFirmwareImages({ source: updateFolder("a", good(), "image_version=9.9\n"), storageDir: storage() });
			expect(r.replaced).toBe(true);
			expect(r.keptExisting).toBe(false);
			expect(r.previousCounts).toBeUndefined();
		});
	});
});
