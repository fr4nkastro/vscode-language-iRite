import * as path from "node:path";
import { expect, it, vi } from "vitest";
import { runTool } from "../../src/lmtools/tools";

const root = path.resolve("workspace");
const rev = path.join(root, "main.rev");
const src = path.join(root, "main.src");
const foreign = path.resolve("foreign.iri");
const readText = vi.fn((p: string) => p === src ? "program main;\n#include ../foreign.iri\n" : p === foreign ? "sensitive" : undefined);
const io = { exists: (p: string) => p === rev || p === src, readText, readBinary: () => undefined };
const ctx = { roots: [root], findMainSrc: () => [src], exists: io.exists, io };

it("does not read a derived main.rev that resolves outside the workspace", async () => {
	readText.mockClear();
	const r = await runTool("irite_screens", { rev: root }, { ...ctx, realpath: p => p === rev ? foreign : p });
	expect(r.ok).toBe(false);
	expect(JSON.parse(r.text).error).toContain("resolves outside");
	expect(readText).not.toHaveBeenCalled();
});

it("does not read an include outside the workspace or report a partial diagnosis as success", async () => {
	readText.mockClear();
	const r = await runTool("irite_diagnose", { rev: src }, ctx);
	expect(r.ok).toBe(false);
	expect(JSON.parse(r.text).error).toContain("outside the open workspace");
	expect(readText).not.toHaveBeenCalledWith(foreign);
});
