import { join, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { confine, resolveTarget } from "../../src/lmtools/paths";
import type { PathDeps } from "../../src/lmtools/paths";

const root = resolve("/ws/a");
const other = resolve("/ws/b");
const files = new Set<string>();
const deps = (over: Partial<PathDeps> = {}): PathDeps => ({
	roots: [root],
	exists: (p) => files.has(resolve(p)),
	findMainSrc: () => [],
	...over,
});
const add = (...p: string[]) => files.add(resolve(...p));

describe("confine", () => {
	it("accepts absolute and relative paths inside a root", () => {
		expect(confine(join(root, "x", "main.rev"), deps())).toEqual({ ok: true, path: join(root, "x", "main.rev") });
		expect(confine(`x${sep}main.rev`, deps())).toEqual({ ok: true, path: join(root, "x", "main.rev") });
	});
	it("accepts any of several roots", () => {
		expect(confine(join(other, "main.rev"), deps({ roots: [root, other] })).ok).toBe(true);
	});
	it("refuses outside, parent traversal and sibling-prefix paths", () => {
		for (const p of [join(other, "main.rev"), `..${sep}b${sep}main.rev`, join(root, "..", "b", "main.rev"), root + "-evil" + sep + "main.rev"]) {
			const r = confine(p, deps());
			expect(r.ok, p).toBe(false);
			if (!r.ok) expect(r.error).toContain("outside the open workspace");
		}
	});
	it.runIf(process.platform === "win32")("refuses another drive", () => {
		expect(confine("D:\other\main.rev", { ...deps(), roots: ["C:\ws"] }).ok).toBe(false);
	});
	it("refuses when no workspace folder is open", () => {
		const r = confine("x.rev", deps({ roots: [] }));
		expect(r.ok).toBe(false);
	});
	it("refuses a symlink that resolves outside the root", () => {
		const r = confine("link", deps({ realpath: (p) => (p.endsWith("link") ? join(other, "x") : p) }));
		expect(r).toEqual({ ok: false, error: "Path resolves outside the open workspace folders: link" });
	});
	it("refuses NUL bytes", () => {
		expect(confine("a\0b", deps()).ok).toBe(false);
	});
});

describe("resolveTarget", () => {
	it("uses an explicit .rev and a folder with main.rev", async () => {
		add(root, "p", "main.rev");
		expect(await resolveTarget(join(root, "p", "main.rev"), "rev", deps())).toEqual({ ok: true, path: join(root, "p", "main.rev") });
		expect(await resolveTarget(join(root, "p"), "rev", deps())).toEqual({ ok: true, path: join(root, "p", "main.rev") });
	});
	it("reports missing files and folders without a rev", async () => {
		const r1 = await resolveTarget(join(root, "nope.rev"), "rev", deps());
		expect(r1).toEqual({ ok: false, error: `File not found: ${join(root, "nope.rev")}` });
		const r2 = await resolveTarget(join(root, "empty"), "rev", deps());
		expect(r2.ok).toBe(false);
	});
	it("refuses explicit paths outside the workspace", async () => {
		add(other, "main.rev");
		const r = await resolveTarget(join(other, "main.rev"), "rev", deps());
		expect(r.ok).toBe(false);
	});
	it("kind project accepts main.src and a folder with only main.src", async () => {
		add(root, "q", "main.src");
		expect(await resolveTarget(join(root, "q", "main.src"), "project", deps())).toEqual({ ok: true, path: join(root, "q", "main.src") });
		expect(await resolveTarget(join(root, "q"), "project", deps())).toEqual({ ok: true, path: join(root, "q") });
		expect((await resolveTarget(join(root, "q", "main.src"), "rev", deps())).ok).toBe(false);
	});
	it("locates the single project when rev is omitted", async () => {
		add(root, "one", "main.rev");
		const d = deps({ findMainSrc: () => [join(root, "one", "main.src")] });
		expect(await resolveTarget(undefined, "rev", d)).toEqual({ ok: true, path: join(root, "one", "main.rev") });
		expect(await resolveTarget(undefined, "project", d)).toEqual({ ok: true, path: join(root, "one") });
	});
	it("errors when there is no project, and asks for rev when ambiguous", async () => {
		const none = await resolveTarget(undefined, "rev", deps());
		expect(none.ok).toBe(false);
		if (!none.ok) expect(none.error).toContain('pass "rev"');
		add(root, "m1", "main.rev");
		add(root, "m2", "main.rev");
		const d = deps({ findMainSrc: () => [join(root, "m1", "main.src"), join(root, "m2", "main.src")] });
		const many = await resolveTarget(undefined, "rev", d);
		expect(many.ok).toBe(false);
		if (!many.ok) expect(many.error).toContain("More than one iRite project");
	});
	it("ignores main.src without main.rev for kind rev and projects outside the roots", async () => {
		add(other, "x", "main.rev");
		const d = deps({ findMainSrc: () => [join(root, "norev", "main.src"), join(other, "x", "main.src")] });
		const r = await resolveTarget(undefined, "rev", d);
		expect(r.ok).toBe(false);
	});
});
