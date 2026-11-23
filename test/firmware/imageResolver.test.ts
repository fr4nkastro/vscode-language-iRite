import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadImageCache } from "../../src/firmware/imageCache";
import { builtinResolver, confinedFile, fileUri, loadCacheFromDir, needsImportHint } from "../../src/firmware/imageResolver";
import { buildScreenView } from "../../src/preview/screenModel";
import { parseRev } from "../../src/rev";
import { fakeVersion } from "./cacheHelper";

let tmp: string;
beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "irite-res-"));
});
afterEach(() => {
	rmSync(tmp, { recursive: true, force: true });
});

describe("confinedFile", () => {
	it("accepts files inside the root and rejects missing, outside and symlinked-outside targets", () => {
		const root = join(tmp, "sdimages");
		const outside = join(tmp, "outside");
		mkdirSync(root);
		mkdirSync(outside);
		writeFileSync(join(root, "inside.png"), "inside");
		writeFileSync(join(outside, "outside.png"), "outside");
		symlinkSync(outside, join(root, "link"), process.platform === "win32" ? "junction" : "dir");
		expect(confinedFile(root, join(root, "inside.png"))).toBe(join(root, "inside.png"));
		expect(confinedFile(root, join(root, "missing.png"))).toBeUndefined();
		expect(confinedFile(root, join(outside, "outside.png"))).toBeUndefined();
		expect(confinedFile(root, join(root, "link", "outside.png"))).toBeUndefined();
		expect(confinedFile(root, root)).toBeUndefined();
	});
});

describe("builtinResolver", () => {
	it("maps N.png + panel to the converted reference of the panel's own variant", () => {
		fakeVersion(tmp, "1.0.0", { "7": [[9, 10, 10]], "12": [[9, 20, 20]] });
		const r = builtinResolver(loadImageCache(tmp), (p) => `uri:${p.replace(/\\/g, "/").split("firmware-images/")[1]}`);
		expect(r("9.png", "7")).toBe("uri:1.0.0/7/9.png");
		expect(r("9.png", "12")).toBe("uri:1.0.0/12/9.png");
	});
	it("returns undefined for an unknown N, a malformed id and when nothing is imported", () => {
		fakeVersion(tmp, "1.0.0", { "7": [[9, 10, 10]] });
		const r = builtinResolver(loadImageCache(tmp), (p) => p);
		expect(r("10.png", "7")).toBeUndefined();
		expect(r("../9.png", "7")).toBeUndefined();
		expect(builtinResolver(loadImageCache(join(tmp, "none")), (p) => p)("9.png", "7")).toBeUndefined();
		expect(builtinResolver(null, (p) => p)("9.png", "12")).toBeUndefined();
	});
});

describe("loadCacheFromDir (CLI --firmware-images)", () => {
	it("accepts a version dir and the firmware-images root; null when there is nothing", () => {
		const vdir = fakeVersion(tmp, "2.0.0", { default: [[1, 5, 5]] });
		expect(loadCacheFromDir(vdir)?.selected?.version).toBe("2.0.0");
		expect(loadCacheFromDir(join(tmp, "firmware-images"))?.selected?.version).toBe("2.0.0");
		expect(loadCacheFromDir(join(tmp, "nope"))).toBeNull();
		expect(loadCacheFromDir(tmp)).toBeNull();
	});
});

describe("fileUri", () => {
	it("gives an absolute file URI", () => {
		expect(fileUri(join(tmp, "a b.png"))).toMatch(/^file:\/\/\/.*a%20b\.png$/);
	});
});

describe("needsImportHint", () => {
	const rev = parseRev("<Indicator><Config>WDGT#1=7,0,0,10,10,1,1,0,local://3.png,1,im\r\nWDGT#2=7,0,0,10,10,1,1,0,a.png,1,im2\r\n</Config></Indicator>");
	const view = buildScreenView(rev);
	it("is true when a local:// image cannot be resolved, false when all resolve or none is referenced", () => {
		expect(needsImportHint(view, loadImageCache(tmp))).toBe(true);
		fakeVersion(tmp, "1.0.0", { "7": [[3, 1, 1]] });
		expect(needsImportHint(view, loadImageCache(tmp))).toBe(false);
		expect(needsImportHint(buildScreenView(parseRev("<Indicator><Config>WDGT#2=7,0,0,10,10,1,1,0,a.png,1,im2\r\n</Config></Indicator>")), null)).toBe(false);
	});
});
