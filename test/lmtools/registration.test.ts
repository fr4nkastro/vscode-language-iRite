import * as path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LanguageModelTool, LanguageModelToolResult } from "vscode";
import { registerLmTools } from "../../src/commands/lmTools";
import { nodeIo } from "../../src/cli/nodeIo";

const host = vi.hoisted(() => ({
	register: vi.fn(),
	warning: vi.fn(),
	workspace: { isTrusted: true, workspaceFolders: [] as unknown[], textDocuments: [] as unknown[] },
}));
const files = vi.hoisted(() => ({ write: vi.fn(), rename: vi.fn(), copy: vi.fn() }));
vi.mock("vscode", () => ({
	lm: { registerTool: host.register }, workspace: host.workspace, window: { showWarningMessage: host.warning },
	LanguageModelTextPart: class { constructor(public value: string) {} },
	LanguageModelToolResult: class { constructor(public content: unknown[]) {} },
}));
vi.mock("../../src/cli/nodeIo", async importOriginal => {
	const original = await importOriginal<typeof import("../../src/cli/nodeIo")>();
	return { nodeIo: () => {
		const io = original.nodeIo();
		return { ...io, writeFs: { ...io.writeFs, writeFile: files.write, rename: files.rename, copyExcl: files.copy } };
	} };
});

const root = path.resolve("test/fixtures/rev");
const rev = path.join(root, "db.rev");
const iri = path.join(root, "db.iri");
const token = { isCancellationRequested: false, onCancellationRequested: vi.fn() };

async function regen(apply: boolean) {
	const tool = host.register.mock.calls.find(([name]) => name === "irite_regenIri")?.[1] as LanguageModelTool<unknown>;
	const r: LanguageModelToolResult | undefined | null = await tool.invoke!({ input: { rev, apply }, toolInvocationToken: undefined }, token);
	return JSON.parse((r?.content[0] as { value: string }).value);
}

beforeEach(() => {
	vi.clearAllMocks();
	host.workspace.isTrusted = true;
	host.workspace.workspaceFolders = [{ uri: { scheme: "file", fsPath: root } }];
	host.workspace.textDocuments = [];
	host.register.mockReturnValue({ dispose() {} });
	const subscriptions: never[] = [];
	registerLmTools({ subscriptions } as never);
	expect(subscriptions).toHaveLength(14);
});

describe("VS Code Copilot tool adapter", () => {
	it("can preview directly without prompting for a disk write", async () => {
		expect(await regen(false)).toMatchObject({ ok: true, dryRun: true, file: iri });
		expect(host.warning).not.toHaveBeenCalled();
		expect(files.write).not.toHaveBeenCalled();
	});

	it("requires a modal even with no prepareInvocation and does not write when it is dismissed", async () => {
		host.warning.mockResolvedValueOnce(undefined);
		expect(await regen(true)).toMatchObject({ ok: false, error: expect.stringMatching(/cancel/i) });
		expect(host.warning).toHaveBeenCalledWith(expect.stringMatching(/regen-iri/), { modal: true, detail: expect.stringContaining(iri) }, "Apply");
		expect(files.write).not.toHaveBeenCalled();
		expect(files.rename).not.toHaveBeenCalled();
	});

	it.each(["untrusted", "dirty"])("refuses a disk write when %s", async reason => {
		host.workspace.isTrusted = reason !== "untrusted";
		if (reason === "dirty") host.workspace.textDocuments = [{ isDirty: true, uri: { scheme: "file", fsPath: iri } }];
		expect(await regen(true)).toMatchObject({ ok: false });
		expect(host.warning).not.toHaveBeenCalled();
		expect(nodeIo().writeFs?.writeFile).not.toHaveBeenCalled();
	});
});
