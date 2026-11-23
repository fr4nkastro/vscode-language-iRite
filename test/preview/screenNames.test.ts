import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadIriteProject, parseIriteSource } from "../../src/irite";
import type { IriteProjectModel } from "../../src/irite";
import { parseRev } from "../../src/rev";
import { buildScreenView } from "../../src/preview/screenModel";
import { resolveScreenEntries, resolveScreenNames } from "../../src/preview/screenNames";

const dir = join(__dirname, "../fixtures/preview");
const read = (p: string): string | undefined => {
	try {
		return readFileSync(p, "utf8");
	} catch {
		return undefined;
	}
};
const project = loadIriteProject(join(dir, "main.src"), read);

function inline(src: string): IriteProjectModel {
	const m = parseIriteSource(src, "a.iri");
	return { mainSrc: "a.iri", files: ["a.iri"], databases: [], enums: [], records: m.records, constants: [], routines: m.routines, diagnostics: [] };
}

describe("resolveScreenNames", () => {
	it("maps screen numbers to UiScreen field names from the literal assignments of uiLoadSettingsUi", () => {
		const names = resolveScreenNames(project);
		expect(names.get(1)).toEqual(["Welcome"]);
		expect(names.get(12)).toEqual(["PlateEntry"]);
	});
	it("lists every name that shares a number, in assignment order", () => {
		expect(resolveScreenNames(project).get(6)).toEqual(["Error", "Notification"]);
	});
	it("ignores assignments to fields that are not UiScreen members", () => {
		const p = inline("type UiScreen is record A: integer; end record;\nprocedure uiLoadSettingsUi;\nbegin\n t.A := 1;\n t.Other := 2;\n x.y.A := 3;\nend;");
		expect([...resolveScreenNames(p)]).toEqual([[1, ["A"]]]);
	});
	it("returns nothing without a UiScreen record or without a project", () => {
		expect(resolveScreenNames(inline("procedure P;\nbegin\n t.A := 1;\nend;")).size).toBe(0);
		expect(resolveScreenNames(undefined).size).toBe(0);
	});
	it("finds the assignments in any routine when uiLoadSettingsUi does not exist", () => {
		const p = inline("type UiScreen is record A: integer; end record;\nprocedure Other;\nbegin\n t.A := 4;\nend;");
		expect(resolveScreenNames(p).get(4)).toEqual(["A"]);
	});
});

describe("resolveScreenEntries", () => {
	const entries = resolveScreenEntries(project, resolveScreenNames(project));
	it("finds the per-screen click handler dispatched by WidgetClicked", () => {
		const e = entries.get(12)!;
		expect(e).toMatchObject({ handler: "WidgetClicked", routine: "handlerScreenPlateEntry" });
		expect(e.file.replace(/\\/g, "/")).toMatch(/ui\/main\.iri$/);
		expect(e.line).toBe(30);
		expect(e.dispatchFile.replace(/\\/g, "/")).toMatch(/ui\/handler\.iri$/);
		expect(e.dispatchLine).toBe(9);
	});
	it("resolves each dispatched screen and leaves screens without a branch undefined", () => {
		expect(entries.get(1)?.routine).toBe("handlerScreenWelcome");
		expect(entries.has(99)).toBe(false);
	});
	it("resolves an entry for a screen reached through any of its names", () => {
		expect(entries.get(6)?.routine).toBe("handlerScreenNotification");
	});
	it("ignores branches whose callee is not a routine of the project", () => {
		const p = inline(
			[
				"type UiScreen is record A: integer; end record;",
				"procedure uiLoadSettingsUi;",
				"begin",
				"  t.A := 2;",
				"end;",
				"handler WidgetClicked;",
				"begin",
				"  if g.CurrentScreen = g.Screen.A then",
				"    BuiltIn(1);",
				"  end if;",
				"end;",
			].join("\n"),
		);
		expect(resolveScreenEntries(p, resolveScreenNames(p)).size).toBe(0);
	});
});

describe("buildScreenView with names", () => {
	const rev = parseRev(read(join(dir, "main.rev")) ?? "");
	const view = buildScreenView(rev, project);
	it("carries the screen names and the entry point on every screen", () => {
		const s12 = view.screens.find((s) => s.number === 12)!;
		expect(s12.names).toEqual(["PlateEntry"]);
		expect(s12.entry?.routine).toBe("handlerScreenPlateEntry");
		expect(view.screens.find((s) => s.number === 6)!.names).toEqual(["Error", "Notification"]);
	});
	it("leaves names empty when the project is unknown", () => {
		const bare = buildScreenView(rev);
		expect(bare.screens.every((s) => s.names.length === 0 && s.entry === undefined)).toBe(true);
	});
});
