import { describe, expect, it } from "vitest";
import { classifyImageEntry, isPng, pngSize } from "../../src/firmware/imageEntries";
import { imgPath, makePng } from "./tarHelper";

describe("imageEntries.classifyImageEntry", () => {
	it("maps each variant directory to default / 7 / 12 with its number", () => {
		expect(classifyImageEntry(imgPath("default", 1), "0")).toEqual({ variant: "default", n: 1 });
		expect(classifyImageEntry(imgPath("7", 68), "0")).toEqual({ variant: "7", n: 68 });
		expect(classifyImageEntry(imgPath("12", 999), "0")).toEqual({ variant: "12", n: 999 });
	});

	it("accepts names with or without the leading ./ and typeflag NUL", () => {
		expect(classifyImageEntry(imgPath("7", 9, ""), "\0")).toEqual({ variant: "7", n: 9 });
		expect(classifyImageEntry(imgPath("7", 9, "/"), "0")).toBeNull();
	});

	it("rejects path traversal, absolute and backslash names", () => {
		expect(classifyImageEntry("./var/node/public/images7/lclimages/../../../../etc/1.png", "0")).toBeNull();
		expect(classifyImageEntry("../var/node/public/images7/lclimages/1.png", "0")).toBeNull();
		expect(classifyImageEntry("/var/node/public/images7/lclimages/1.png", "0")).toBeNull();
		expect(classifyImageEntry("var\\node\\public\\images7\\lclimages\\1.png", "0")).toBeNull();
	});

	it("rejects non-digit names, non-png extensions, leading zeros, 0 and > 999", () => {
		for (const n of ["a", "1a", "1.5", "01", "007", "0", "1000", "-1", ""]) {
			expect(classifyImageEntry(imgPath("default", n), "0")).toBeNull();
		}
		expect(classifyImageEntry("./var/node/public/images7/lclimages/5.jpg", "0")).toBeNull();
		expect(classifyImageEntry("./var/node/public/images7/lclimages/5.PNG", "0")).toBeNull();
	});

	it("rejects other directories and nested paths", () => {
		expect(classifyImageEntry("./var/node/public/images7/sdimages/1.png", "0")).toBeNull();
		expect(classifyImageEntry("./var/node/public/images5/lclimages/1.png", "0")).toBeNull();
		expect(classifyImageEntry("./var/node/public/images7/lclimages/sub/1.png", "0")).toBeNull();
	});

	it("rejects non-regular entries (dir, symlink, hardlink)", () => {
		for (const t of ["5", "2", "1"]) expect(classifyImageEntry(imgPath("7", 1), t)).toBeNull();
	});
});

describe("imageEntries.isPng / pngSize", () => {
	it("recognises the PNG signature and reads IHDR width/height", () => {
		const png = makePng(250, 94, 10);
		expect(isPng(png)).toBe(true);
		expect(pngSize(png)).toEqual({ width: 250, height: 94 });
	});

	it("rejects non-PNG content and truncated PNGs", () => {
		expect(isPng(Buffer.from("GIF89a....................."))).toBe(false);
		expect(isPng(Buffer.alloc(0))).toBe(false);
		expect(pngSize(Buffer.from("not a png at all, really not"))).toBeNull();
		expect(pngSize(makePng(1, 1).subarray(0, 16))).toBeNull();
	});
});
