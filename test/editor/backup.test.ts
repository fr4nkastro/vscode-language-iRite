import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { backupPath } from "../../src/editor/backup";

const now = new Date(2026, 10, 23, 15, 30, 12);
const rev = path.join("proj", "main.rev");
const at = (name: string): string => path.join("proj", name);

describe("backupPath", () => {
	it("uses main.rev.bak next to the file when it is free", () => {
		expect(backupPath(rev, () => false, now)).toBe(at("main.rev.bak"));
	});
	it("never overwrites an existing backup: it adds a timestamp", () => {
		const taken = new Set<string>();
		const p1 = backupPath(rev, (p) => taken.has(path.normalize(p)), now);
		taken.add(p1);
		const p2 = backupPath(rev, (p) => taken.has(path.normalize(p)), now);
		expect(p2).toBe(at("main.rev.20261123-153012.bak"));
		expect(p2).not.toBe(p1);
	});
	it("keeps counting when even the timestamped name exists", () => {
		const free = (p: string): boolean => path.basename(p) === "main.rev.20261123-153012.2.bak" || path.basename(p).endsWith(".3.bak");
		const exists = (p: string): boolean => !free(p);
		expect(backupPath(rev, exists, now)).toBe(at("main.rev.20261123-153012.2.bak"));
	});
});
