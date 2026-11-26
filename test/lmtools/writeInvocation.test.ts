import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { nodeIo } from "../../src/cli/nodeIo";
import { runWriteInvocation } from "../../src/lmtools/writeInvocation";
import { computeConfigHash, readConfigHash } from "../../src/rev/configHash";
import type { ToolContext } from "../../src/lmtools/tools";

const root = path.resolve("test/fixtures/rev");
const rev = path.join(root, "db.rev");
const iri = path.join(root, "db.iri");
const argv = ["regen-iri", rev];

function fixture() {
	const files = new Map([[rev, nodeIo().readBinary(rev)!]]);
	const exists = (p: string) => files.has(p);
	const write = vi.fn((p: string, bytes: Uint8Array) => { files.set(p, Buffer.from(bytes)); });
	const copy = vi.fn((from: string, to: string) => { files.set(to, files.get(from)!); });
	const rename = vi.fn((from: string, to: string) => { files.set(to, files.get(from)!); files.delete(from); });
	const ctx: ToolContext = { roots: [root], exists, findMainSrc: () => [], io: { exists,
		readText: p => files.get(p)?.toString("utf8"), readBinary: p => files.get(p),
		writeFs: { exists, writeFile: write, copyExcl: copy, rename, remove: p => { files.delete(p); } },
	} };
	return { files, ctx, write, copy, rename };
}

describe("Copilot write invocation", () => {
	it("defaults to a dry run and never reaches write IO", async () => {
		const f = fixture();
		const confirm = vi.fn(async () => true);
		const result = await runWriteInvocation(argv, f.ctx, false, confirm);
		expect(JSON.parse(result.text)).toMatchObject({ ok: true, dryRun: true, file: iri, fileHash: null });
		expect(confirm).not.toHaveBeenCalled();
		expect(f.write).not.toHaveBeenCalled();
	});

	it("requires its own approval, including concurrent identical invocations", async () => {
		const f = fixture();
		const confirmNo = vi.fn(async () => false);
		const confirmYes = vi.fn(async () => true);
		const [no, yes] = await Promise.all([
			runWriteInvocation(argv, f.ctx, true, confirmNo),
			runWriteInvocation(argv, f.ctx, true, confirmYes),
		]);
		expect(JSON.parse(no.text)).toMatchObject({ ok: false, error: expect.stringMatching(/cancel/i) });
		expect(JSON.parse(yes.text)).toMatchObject({ ok: true, dryRun: false });
		expect(confirmNo).toHaveBeenCalledTimes(1);
		expect(confirmYes).toHaveBeenCalledTimes(1);
		expect(f.rename).toHaveBeenCalledTimes(1);
	});

	it.each([rev, iri])("refuses when %s changes during approval, without a backup or write", async changed => {
		const f = fixture();
		const result = await runWriteInvocation(argv, f.ctx, true, async () => {
			f.files.set(changed, Buffer.from("edited elsewhere"));
			return true;
		});
		expect(JSON.parse(result.text)).toMatchObject({ ok: false, error: expect.stringMatching(/stale/i) });
		expect(f.files.get(changed)?.toString()).toBe("edited elsewhere");
		expect(f.write).not.toHaveBeenCalled();
		expect(f.copy).not.toHaveBeenCalled();
	});

	it("applies a database operation through the core, backs up exact bytes and leaves .iri alone", async () => {
		const f = fixture();
		const before = f.files.get(rev)!;
		f.files.set(iri, Buffer.from("hand-edited .iri"));
		const r = await runWriteInvocation(["db", "add-table", rev, "New", "--field", "Name:6:12"], f.ctx, true, async () => true);
		const body = JSON.parse(r.text);
		expect(body).toMatchObject({ ok: true, dryRun: false, backup: expect.any(String) });
		expect(f.files.get(body.backup)).toEqual(before);
		const after = f.files.get(rev)!.toString("latin1");
		expect(after).toContain("DB.ALIAS#4=New\r\n");
		expect(readConfigHash(after)).toBe(computeConfigHash(after));
		expect(f.files.get(iri)?.toString()).toBe("hand-edited .iri");
	});

	it("rejects a derived .iri symlink outside the workspace before approval", async () => {
		const f = fixture();
		const confirm = vi.fn(async () => true);
		const result = await runWriteInvocation(argv, { ...f.ctx, realpath: p => p === iri ? path.resolve("external.iri") : p }, true, confirm);
		expect(JSON.parse(result.text)).toMatchObject({ ok: false, error: expect.stringMatching(/outside/) });
		expect(confirm).not.toHaveBeenCalled();
		expect(f.write).not.toHaveBeenCalled();
	});
});
