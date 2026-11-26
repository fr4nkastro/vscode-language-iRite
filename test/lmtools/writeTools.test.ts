import { resolve } from "node:path";
import { expect, it, vi } from "vitest";
import { nodeIo } from "../../src/cli/nodeIo";
import { runCli } from "../../src/cli/revCli";
import { runTool } from "../../src/lmtools/tools";

const root = resolve("test/fixtures/rev");
const rev = resolve(root, "db.rev");
const io = nodeIo();
const ctx = { roots: [root], findMainSrc: () => [], exists: io.exists, io };
const cases = [
	["widgetSet", { id: 1, fields: ["x=10"] }, ["widget", "set", rev, "1", "x=10"]],
	["widgetAdd", { type: 4, screen: 1, fields: ["caption=New"] }, ["widget", "add", rev, "4", "--screen", "1", "caption=New"]],
	["widgetRm", { id: 1, force: true }, ["widget", "rm", rev, "1", "--force"]],
	["dbAddTable", { table: "New", fields: ["Name:6:10"], records: 4 }, ["db", "add-table", rev, "New", "--records", "4", "--field", "Name:6:10"]],
	["dbRmTable", { table: "Inbound" }, ["db", "rm-table", rev, "Inbound"]],
	["dbAddField", { table: "Inbound", field: "New", type: "6", size: 12, at: 1 }, ["db", "add-field", rev, "Inbound", "New", "6", "--size", "12", "--at", "1"]],
	["dbSetField", { table: "Inbound", field: "Id", name: "New", type: "6", size: 12 }, ["db", "set-field", rev, "Inbound", "Id", "name=New", "type=6", "size=12"]],
	["dbRmField", { table: "Inbound", field: "Id" }, ["db", "rm-field", rev, "Inbound", "Id"]],
	["dbMoveField", { table: "Inbound", field: "Id", to: 2 }, ["db", "move-field", rev, "Inbound", "Id", "2"]],
	["regenIri", {}, ["regen-iri", rev]],
] as const;

it.each(cases)("maps %s to the Phase 1 dry run", async (name, input, argv) => {
	const cli = runCli([...argv], io);
	const result = await runTool(`irite_${name}`, { rev, ...input }, ctx);
	expect(result.ok).toBe(cli.code === 0);
	expect(JSON.parse(result.text)).toEqual(JSON.parse(cli.stdout));
});

it("never accepts write-control flags as model-supplied fields", async () => {
	const confirmWrite = vi.fn(async () => true);
	const result = await runTool("irite_widgetAdd", { rev, screen: 1, type: 4, fields: ["--write"], apply: true }, { ...ctx, confirmWrite });
	expect(JSON.parse(result.text)).toMatchObject({ ok: false, error: expect.stringMatching(/option|field/i) });
	expect(confirmWrite).not.toHaveBeenCalled();
});
