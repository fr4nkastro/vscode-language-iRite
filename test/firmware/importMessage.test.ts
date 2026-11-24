import { describe, expect, it } from "vitest";
import { importMessage, type ImportSummary } from "../../src/firmware/importer";

const base = (over: Partial<ImportSummary> = {}): ImportSummary => ({
	firmwareVersion: "2.09.04",
	dir: "/x",
	counts: { default: 2, "7": 3, "12": 1 },
	rejected: { nonPng: 0, tooLarge: 0 },
	importedAt: "2024-01-01T00:00:00.000Z",
	replaced: true,
	keptExisting: false,
	...over,
});

describe("importMessage", () => {
	it("reports a clean import as info", () => {
		expect(importMessage(base())).toEqual({
			level: "info",
			text: "Imported firmware images for 2.09.04. Reopen the preview or screen editor to refresh images.",
		});
	});

	it("includes only the nonzero rejected counts", () => {
		expect(importMessage(base({ rejected: { nonPng: 2, tooLarge: 0 } })).text).toBe(
			"Imported firmware images for 2.09.04 (rejected: 2 not PNG). Reopen the preview or screen editor to refresh images.",
		);
		expect(importMessage(base({ rejected: { nonPng: 2, tooLarge: 1 } })).text).toBe(
			"Imported firmware images for 2.09.04 (rejected: 2 not PNG, 1 too large). Reopen the preview or screen editor to refresh images.",
		);
		expect(importMessage(base({ rejected: { nonPng: 0, tooLarge: 4 } })).level).toBe("info");
	});

	it("warns when the current cache was kept", () => {
		const m = importMessage(base({
			replaced: false,
			keptExisting: true,
			previousCounts: { default: 2, "7": 3, "12": 2 },
			counts: { default: 1, "7": 2, "12": 1 },
			rejected: { nonPng: 2, tooLarge: 1 },
		}));
		expect(m).toEqual({
			level: "warning",
			text: "Firmware images for 2.09.04 were not replaced: the new import has 4 usable images, fewer than the current 7 (rejected: 2 not PNG, 1 too large). The current cache was kept. Fewer images for: default (2 → 1), 7 (3 → 2), 12 (2 → 1).",
		});
	});

	it("omits the rejected part of the kept warning when nothing was rejected", () => {
		const m = importMessage(base({ replaced: false, keptExisting: true, previousCounts: { default: 5, "7": 0, "12": 0 }, counts: { default: 1, "7": 0, "12": 0 } }));
		expect(m.text).toBe("Firmware images for 2.09.04 were not replaced: the new import has 1 usable image, fewer than the current 5. The current cache was kept. Fewer images for: default (5 → 1).");
	});

	it("names the dropped variants when the total is equal", () => {
		const m = importMessage(base({ replaced: false, keptExisting: true, previousCounts: { default: 0, "7": 100, "12": 0 }, counts: { default: 100, "7": 0, "12": 0 } }));
		expect(m).toEqual({
			level: "warning",
			text: "Firmware images for 2.09.04 were not replaced: the new import has 100 usable images, no more than the current 100 but fewer in some variants. The current cache was kept. Fewer images for: 7 (100 → 0).",
		});
	});

	it("warns on keptExisting alone, even without previousCounts", () => {
		const m = importMessage(base({ replaced: false, keptExisting: true }));
		expect(m).toEqual({
			level: "warning",
			text: "Firmware images for 2.09.04 were not replaced: the new import has fewer usable images than the current cache. The current cache was kept.",
		});
	});
});
