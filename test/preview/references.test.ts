import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadIriteProject } from "../../src/irite";
import { parseRev } from "../../src/rev";
import { buildScreenView } from "../../src/preview/screenModel";
import { groupReferences } from "../../src/preview/refGroups";

const dir = join(__dirname, "../fixtures/preview");
const read = (p: string): string | undefined => {
	try {
		return readFileSync(p, "utf8");
	} catch {
		return undefined;
	}
};
const project = loadIriteProject(join(dir, "main.src"), read);
const rev = parseRev(read(join(dir, "main.rev")) ?? "");
const view = buildScreenView(rev, project);
const widget = (alias: string) => view.screens.flatMap((s) => s.widgets).find((w) => w.alias === alias)!;
const file = (rel: string) => project.files.find((f) => f.replace(/\\/g, "/").endsWith(rel))!;

describe("widget references", () => {
	it("keeps call-argument references and names the routine that holds them", () => {
		const ref = widget("lblPlaca").references.find((r) => r.callee === "SetLabelText")!;
		expect(ref).toMatchObject({ line: 19, routine: "uiShowPlate" });
		expect(ref.file).toBe(file("ui/main.iri"));
	});
	it("includes plain comparisons and assignments outside calls", () => {
		const refs = widget("lblPlaca").references;
		expect(refs).toContainEqual(expect.objectContaining({ callee: "(reference)", routine: "handlerScreenPlateEntry", line: 35 }));
		const btn = widget("btnOk").references;
		expect(btn).toContainEqual(expect.objectContaining({ callee: "(reference)", routine: "handlerScreenPlateEntry", line: 32 }));
	});
	it("does not report the same place twice when a call already covers it", () => {
		const refs = widget("imLoad").references.filter((r) => r.routine === "uiShowPlate");
		expect(refs.map((r) => [r.line, r.callee])).toEqual([[20, "SetWidgetVisibility"]]);
	});
	it("attributes an alias on a continuation line to the multi-line call, not to a second reference", () => {
		const refs = widget("lblTitle").references.filter((r) => r.routine === "handlerScreenNotification");
		expect(refs.map((r) => [r.line, r.callee])).toEqual([[40, "SetWidgetVisibility"]]);
	});
});

describe("groupReferences", () => {
	it("groups by file, then routine, with project-relative labels and sorted sites", () => {
		const groups = groupReferences(widget("lblPlaca").references, join(dir));
		expect(groups.map((g) => g.label)).toEqual(["ui/main.iri"]);
		expect(groups[0].routines.map((r) => r.routine)).toEqual(["uiShowPlate", "handlerScreenPlateEntry"]);
		expect(groups[0].routines[0].sites).toEqual([{ line: 19, callee: "SetLabelText" }]);
		expect(groups[0].count).toBe(widget("lblPlaca").references.length);
	});
	it("is exposed on every widget view", () => {
		expect(widget("lblPlaca").refGroups.length).toBe(1);
		expect(widget("bgWelcome").refGroups).toEqual([]);
	});
});
