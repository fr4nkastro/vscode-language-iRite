import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { imagePickerModel } from "../../src/editor/imagePicker";
import { loadImageCache, BUILTIN_IMAGE_HINT } from "../../src/firmware/imageCache";
import { fakeVersion } from "../firmware/cacheHelper";

let tmp: string;
beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "irite-pick-"));
});
afterEach(() => {
	rmSync(tmp, { recursive: true, force: true });
});
const toUri = (p: string): string => "u:" + p.replace(/\\/g, "/").split("firmware-images/")[1];

describe("imagePickerModel", () => {
	it("lists built-in images by number with local://N.png values, size and both panel URIs, plus sdimages files", () => {
		fakeVersion(tmp, "1.0.0", { "7": [[2, 10, 20], [1, 5, 6]], "12": [[2, 11, 21], [1, 5, 6]] });
		const m = imagePickerModel(loadImageCache(tmp), ["b.png", "a.svg"], { builtinUri: toUri, fileUri: (n) => "f:" + n });
		expect(m.builtin.map((b) => b.value)).toEqual(["local://1.png", "local://2.png"]);
		expect(m.builtin[1]).toMatchObject({ n: 2, width: 10, height: 20, uri7: "u:1.0.0/7/2.png", uri12: "u:1.0.0/12/2.png" });
		expect(m.files).toEqual([{ value: "b.png", uri: "f:b.png" }, { value: "a.svg", uri: "f:a.svg" }]);
		expect(m.hint).toBeUndefined();
	});
	it("keeps rejected builtin paths as placeholder options without blank URIs", () => {
		fakeVersion(tmp, "1.0.0", { "7": [[1, 5, 6]], "12": [[1, 5, 6]] });
		const m = imagePickerModel(loadImageCache(tmp), ["outside.png"], { builtinUri: () => "", fileUri: () => undefined });
		expect(m.builtin).toEqual([{ n: 1, value: "local://1.png", width: 5, height: 6 }]);
		expect(m.files).toEqual([{ value: "outside.png" }]);
	});
	it("shows the import hint and no built-in items when nothing is imported; sdimages still listed", () => {
		const m = imagePickerModel(loadImageCache(tmp), ["x.png"], { builtinUri: toUri, fileUri: () => undefined });
		expect(m.builtin).toEqual([]);
		expect(m.hint).toBe(BUILTIN_IMAGE_HINT);
		expect(m.files).toEqual([{ value: "x.png" }]);
	});
});
