import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BUILTIN_IMAGE_HINT, galleryModel, listImportedVersions, loadImageCache, resolveBuiltinImage } from "../../src/firmware/imageCache";
import type { ImportedManifest } from "../../src/firmware/importer";
import type { ImageVariant } from "../../src/firmware/imageEntries";

let tmp: string;
beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "irite-cache-"));
});
afterEach(() => {
	rmSync(tmp, { recursive: true, force: true });
});

/** Fake an imported version dir (files + manifest.json) without running the importer. */
function fake(version: string, importedAt: string, files: Partial<Record<ImageVariant, Array<[number, number, number]>>>): void {
	const dir = join(tmp, "firmware-images", version);
	const images: ImportedManifest["images"] = { default: {}, "7": {}, "12": {} };
	for (const [variant, list] of Object.entries(files) as Array<[ImageVariant, Array<[number, number, number]>]>) {
		mkdirSync(join(dir, variant), { recursive: true });
		for (const [n, width, height] of list) {
			writeFileSync(join(dir, variant, `${n}.png`), "x");
			images[variant][String(n)] = { width, height, bytes: 1 };
		}
	}
	const counts = { default: Object.keys(images.default).length, "7": Object.keys(images["7"]).length, "12": Object.keys(images["12"]).length };
	const m: ImportedManifest = { firmwareVersion: version, source: "s", importedAt, counts, images };
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "manifest.json"), JSON.stringify(m));
}

describe("imageCache version selection", () => {
	it("lists imported versions and ignores dirs without a valid manifest.json", () => {
		fake("1.0.0", "2026-01-01T00:00:00Z", { "7": [[1, 1, 1]] });
		mkdirSync(join(tmp, "firmware-images", ".tmp-abc"), { recursive: true });
		mkdirSync(join(tmp, "firmware-images", "broken"), { recursive: true });
		writeFileSync(join(tmp, "firmware-images", "broken", "manifest.json"), "{nope");
		expect(listImportedVersions(tmp).map((v) => v.version)).toEqual(["1.0.0"]);
		expect(listImportedVersions(join(tmp, "missing"))).toEqual([]);
	});

	it("picks the explicit setting when that version is imported", () => {
		fake("1.0.0", "2026-03-01T00:00:00Z", { "7": [[1, 1, 1]] });
		fake("2.0.0", "2026-01-01T00:00:00Z", { "7": [[1, 1, 1]] });
		expect(loadImageCache(tmp, "1.0.0").selected?.version).toBe("1.0.0");
	});

	it("falls back to the latest version when the setting is empty or not imported", () => {
		fake("2.9.4", "2026-01-01T00:00:00Z", { "7": [[1, 1, 1]] });
		fake("2.10.0", "2026-01-02T00:00:00Z", { "7": [[1, 1, 1]] });
		fake("1.0.0", "2026-12-31T00:00:00Z", { "7": [[1, 1, 1]] });
		expect(loadImageCache(tmp).selected?.version).toBe("2.10.0"); // numeric, not lexicographic
		expect(loadImageCache(tmp, "").selected?.version).toBe("2.10.0");
		expect(loadImageCache(tmp, "9.9.9").selected?.version).toBe("2.10.0");
	});

	it("keeps comparing after numerically equal zero-padded segments (2.09.04 < 2.9.10)", () => {
		fake("2.09.04", "2026-12-01T00:00:00Z", { "7": [[1, 1, 1]] });
		fake("2.9.10", "2026-01-01T00:00:00Z", { "7": [[1, 1, 1]] });
		expect(loadImageCache(tmp).selected?.version).toBe("2.9.10");
		expect(loadImageCache(tmp, "2.09.04").selected?.version).toBe("2.09.04");
	});

	it("breaks equal-version ties by importedAt and returns no selection when nothing is imported", () => {
		expect(loadImageCache(tmp).selected).toBeNull();
		fake("unknown-aaaaaaaa", "2026-01-01T00:00:00Z", { "7": [[1, 1, 1]] });
		fake("unknown-bbbbbbbb", "2026-02-01T00:00:00Z", { "7": [[1, 1, 1]] });
		expect(loadImageCache(tmp).selected?.version).toBe("unknown-bbbbbbbb");
	});
});

describe("imageCache.resolveBuiltinImage", () => {
	it("12\" prefers variant 12, then default, then 7", () => {
		fake("1.0", "2026-01-01T00:00:00Z", { default: [[1, 1, 1], [2, 1, 1], [3, 1, 1]], "7": [[1, 1, 1], [2, 1, 1], [4, 1, 1]], "12": [[1, 1, 1]] });
		const c = loadImageCache(tmp);
		const dir = join(tmp, "firmware-images", "1.0");
		expect(resolveBuiltinImage(c, "1.png", "12")).toBe(join(dir, "12", "1.png"));
		expect(resolveBuiltinImage(c, "2.png", "12")).toBe(join(dir, "default", "2.png"));
		expect(resolveBuiltinImage(c, "4.png", "12")).toBe(join(dir, "7", "4.png"));
	});

	it("7\" prefers variant 7, then default, then 12", () => {
		fake("1.0", "2026-01-01T00:00:00Z", { default: [[2, 1, 1]], "7": [[1, 1, 1]], "12": [[1, 1, 1], [2, 1, 1], [5, 1, 1]] });
		const c = loadImageCache(tmp);
		const dir = join(tmp, "firmware-images", "1.0");
		expect(resolveBuiltinImage(c, "1.png", "7")).toBe(join(dir, "7", "1.png"));
		expect(resolveBuiltinImage(c, "2.png", "7")).toBe(join(dir, "default", "2.png"));
		expect(resolveBuiltinImage(c, "5.png", "7")).toBe(join(dir, "12", "5.png"));
	});

	it("returns null for unknown N, malformed ids and a missing import, with a hint constant", () => {
		fake("1.0", "2026-01-01T00:00:00Z", { "7": [[1, 1, 1]] });
		const c = loadImageCache(tmp);
		expect(resolveBuiltinImage(c, "99.png", "7")).toBeNull();
		for (const bad of ["1", "x.png", "01.png", "../1.png", "1.png/", "1.PNG"]) expect(resolveBuiltinImage(c, bad, "7")).toBeNull();
		expect(resolveBuiltinImage(loadImageCache(join(tmp, "nothing")), "1.png", "7")).toBeNull();
		expect(resolveBuiltinImage(null, "1.png", "12")).toBeNull();
		expect(BUILTIN_IMAGE_HINT).toBe("Import the built-in images from the 1280 firmware");
	});
});

describe("imageCache.galleryModel", () => {
	it("lists every N available for the panel, numerically sorted, with ref, path and size", () => {
		fake("1.0", "2026-01-01T00:00:00Z", { default: [[10, 5, 6]], "7": [[2, 20, 30], [1, 10, 11]], "12": [[2, 99, 98], [30, 7, 8]] });
		const c = loadImageCache(tmp);
		const dir = join(tmp, "firmware-images", "1.0");
		expect(galleryModel(c, "7")).toEqual([
			{ n: 1, ref: "local://1.png", path: join(dir, "7", "1.png"), width: 10, height: 11 },
			{ n: 2, ref: "local://2.png", path: join(dir, "7", "2.png"), width: 20, height: 30 },
			{ n: 10, ref: "local://10.png", path: join(dir, "default", "10.png"), width: 5, height: 6 },
			{ n: 30, ref: "local://30.png", path: join(dir, "12", "30.png"), width: 7, height: 8 },
		]);
		expect(galleryModel(c, "12").find((g) => g.n === 2)).toMatchObject({ width: 99, height: 98 });
		expect(galleryModel(null, "7")).toEqual([]);
	});
});
