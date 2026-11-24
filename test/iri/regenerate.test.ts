import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { regenerateIri, targetIriPath, type RegenerateFs } from "../../src/iri/regenerate";

const REV = path.join("proj", "main.rev");
const TARGET = path.join("proj", "main.iri");
const NOW = new Date(2024, 0, 2, 3, 4, 5);

/** In-memory fs recording every call. */
function memFs(files: Record<string, string>, opts: { failCopy?: boolean; failRename?: boolean } = {}) {
	const store = new Map<string, Buffer>(Object.entries(files).map(([k, v]) => [k, Buffer.from(v, "latin1")]));
	const calls: string[] = [];
	const fs: RegenerateFs = {
		exists: (p) => store.has(p),
		readFile: (p) => store.get(p),
		writeFile: (p, data) => {
			calls.push(`write ${p}`);
			store.set(p, Buffer.from(data));
		},
		copyExcl: (from, to) => {
			calls.push(`copy ${from} ${to}`);
			if (opts.failCopy) {
				throw new Error("copy failed");
			}
			if (store.has(to)) {
				throw new Error("EEXIST");
			}
			store.set(to, store.get(from) as Buffer);
		},
		rename: (from, to) => {
			calls.push(`rename ${from} ${to}`);
			if (opts.failRename) {
				throw new Error("rename failed");
			}
			store.set(to, store.get(from) as Buffer);
			store.delete(from);
		},
		remove: (p) => {
			calls.push(`remove ${p}`);
			store.delete(p);
		},
	};
	return { fs, store, calls };
}

describe("targetIriPath", () => {
	it("maps main.rev to main.iri beside it", () => {
		expect(targetIriPath(REV)).toBe(TARGET);
		expect(targetIriPath(path.join("a", "Other.REV"))).toBe(path.join("a", "Other.iri"));
	});
});

describe("regenerateIri (S4)", () => {
	it("backs up the previous file then replaces it atomically", () => {
		const m = memFs({ [TARGET]: "old\r\n" });
		const r = regenerateIri(REV, "new\r\n", m.fs, NOW);
		expect(r).toEqual({ status: "replaced", target: TARGET, backup: `${TARGET}.bak` });
		expect(m.store.get(`${TARGET}.bak`)?.toString("latin1")).toBe("old\r\n");
		expect(m.store.get(TARGET)?.toString("latin1")).toBe("new\r\n");
		const tmpWrite = m.calls.find((c) => c.startsWith("write "));
		expect(tmpWrite).toBeDefined();
		expect(tmpWrite).not.toBe(`write ${TARGET}`);
		expect(path.dirname(tmpWrite!.slice(6))).toBe("proj");
		expect(m.calls.some((c) => c.startsWith("rename ") && c.endsWith(` ${TARGET}`))).toBe(true);
		expect([...m.store.keys()].sort()).toEqual([TARGET, `${TARGET}.bak`].sort());
	});

	it("never overwrites an existing backup (timestamped name)", () => {
		const m = memFs({ [TARGET]: "old", [`${TARGET}.bak`]: "first" });
		const r = regenerateIri(REV, "new", m.fs, NOW);
		expect(r.status).toBe("replaced");
		expect(r.backup).toBe(`${TARGET}.20240102-030405.bak`);
		expect(m.store.get(`${TARGET}.bak`)?.toString("latin1")).toBe("first");
		expect(m.store.get(r.backup as string)?.toString("latin1")).toBe("old");
	});

	it("writes nothing and makes no backup when the content is identical", () => {
		const m = memFs({ [TARGET]: "same\r\n" });
		const r = regenerateIri(REV, "same\r\n", m.fs, NOW);
		expect(r).toEqual({ status: "unchanged", target: TARGET });
		expect(m.calls).toEqual([]);
		expect([...m.store.keys()]).toEqual([TARGET]);
	});

	it("creates a missing target without a backup", () => {
		const m = memFs({});
		const r = regenerateIri(REV, "new", m.fs, NOW);
		expect(r).toEqual({ status: "created", target: TARGET });
		expect(m.store.get(TARGET)?.toString("latin1")).toBe("new");
		expect(m.calls.some((c) => c.startsWith("copy "))).toBe(false);
		expect([...m.store.keys()]).toEqual([TARGET]);
	});

	it("leaves the target untouched when the backup fails", () => {
		const m = memFs({ [TARGET]: "old" }, { failCopy: true });
		expect(() => regenerateIri(REV, "new", m.fs, NOW)).toThrow("copy failed");
		expect(m.store.get(TARGET)?.toString("latin1")).toBe("old");
		expect(m.calls.some((c) => c.startsWith("write ") || c.startsWith("rename "))).toBe(false);
	});

	it("writes UTF-8 without a BOM, like Revolution's StreamWriter", () => {
		const m = memFs({});
		regenerateIri(REV, "Señal\r\n", m.fs, NOW);
		expect([...(m.store.get(TARGET) as Buffer)]).toEqual([...Buffer.from("Señal\r\n", "utf8")]);
	});

	it("removes the temp file when the rename fails", () => {
		const m = memFs({ [TARGET]: "old" }, { failRename: true });
		expect(() => regenerateIri(REV, "new", m.fs, NOW)).toThrow("rename failed");
		expect([...m.store.keys()].sort()).toEqual([TARGET, `${TARGET}.bak`].sort());
	});

	it("leaves the target untouched when the rename fails", () => {
		const m = memFs({ [TARGET]: "old" }, { failRename: true });
		expect(() => regenerateIri(REV, "new", m.fs, NOW)).toThrow("rename failed");
		expect(m.store.get(TARGET)?.toString("latin1")).toBe("old");
	});
});
