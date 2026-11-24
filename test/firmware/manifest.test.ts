import { describe, expect, it } from "vitest";
import { firmwareVersionOf, parseManifest, sanitizeVersion } from "../../src/firmware/manifest";

const TEXT = [
	"#[Image_File_Info]",
	"image_name=update",
	"image_version=2.09.04",
	"#image_zip_size=1",
	"image_zip_size=2",
	"",
	"#[Core_Info]",
	"core_version=2.09.03",
	"image_hash = abc=def ",
].join("\r\n");

describe("manifest", () => {
	it("parses key=value lines, skipping comments/section headers; later key wins; splits at first '='", () => {
		const m = parseManifest(TEXT);
		expect(m.image_name).toBe("update");
		expect(m.image_zip_size).toBe("2");
		expect(m.image_hash).toBe("abc=def");
		expect(Object.keys(m)).not.toContain("#[Core_Info]");
	});

	it("version = image_version, falling back to core_version", () => {
		expect(firmwareVersionOf(parseManifest(TEXT))).toBe("2.09.04");
		expect(firmwareVersionOf(parseManifest("core_version=1.2.3\n"))).toBe("1.2.3");
		expect(firmwareVersionOf(parseManifest("image_version=\ncore_version=1.2.3\n"))).toBe("1.2.3");
		expect(firmwareVersionOf(parseManifest("x=1"))).toBeNull();
	});

	it("sanitizes versions to a safe directory name and rejects unsafe ones", () => {
		expect(sanitizeVersion(" 2.09.04 ")).toBe("2.09.04");
		expect(sanitizeVersion("v1_2-rc.1")).toBe("v1_2-rc.1");
		for (const bad of ["", "   ", "..", ".", "a/b", "a\\b", "..\\x", "1 2", "é", ".hidden", "a:b"]) {
			expect(sanitizeVersion(bad)).toBeNull();
		}
		expect(firmwareVersionOf(parseManifest("image_version=../evil"))).toBeNull();
	});
});
