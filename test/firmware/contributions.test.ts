import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));

describe("firmware image contributions", () => {
	it("contributes the import command with its exact title", () => {
		expect(manifest.contributes.commands).toContainEqual(expect.objectContaining({
			command: "irite.firmware.importImages",
			title: "iRite: Import 1280 Built-in Images from Firmware",
		}));
	});

	it("defaults the version setting to the latest imported version", () => {
		expect(manifest.contributes.configuration.properties["irite.firmware.imagesVersion"]).toMatchObject({
			type: "string", default: "",
		});
	});

	it("preserves the existing preview command contribution", () => {
		expect(manifest.contributes.commands).toContainEqual(expect.objectContaining({
			command: "irite.previewScreens", title: "iRite: Preview Screens",
		}));
	});
});
