import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ImageVariant } from "../../src/firmware/imageEntries";
import type { ImportedManifest } from "../../src/firmware/importer";

/** Fakes an imported version dir (placeholder bytes + manifest.json) under `<root>/firmware-images/<version>`. Synthetic only. */
export function fakeVersion(root: string, version: string, files: Partial<Record<ImageVariant, Array<[number, number, number]>>>): string {
	const dir = join(root, "firmware-images", version);
	const images: ImportedManifest["images"] = { default: {}, "7": {}, "12": {} };
	for (const [variant, list] of Object.entries(files) as Array<[ImageVariant, Array<[number, number, number]>]>) {
		mkdirSync(join(dir, variant), { recursive: true });
		for (const [n, width, height] of list) {
			writeFileSync(join(dir, variant, `${n}.png`), "x");
			images[variant][String(n)] = { width, height, bytes: 1 };
		}
	}
	const counts = { default: Object.keys(images.default).length, "7": Object.keys(images["7"]).length, "12": Object.keys(images["12"]).length };
	const m: ImportedManifest = { firmwareVersion: version, source: "s", importedAt: "2026-01-01T00:00:00Z", counts, images };
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "manifest.json"), JSON.stringify(m));
	return dir;
}
