import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRev } from "../../src/rev";
import { parseIriteSource } from "../../src/irite";
import type { IriteProjectModel } from "../../src/irite";
import { buildScreenView } from "../../src/preview/screenModel";
import { renderScreensHtml, CANVAS_WIDTH, CANVAS_HEIGHT } from "../../src/preview/screenHtml";

const rev = parseRev(readFileSync(join(__dirname, "../fixtures/rev/sample.rev"), "utf8"));

function project(src: string, file = "a.iri"): IriteProjectModel {
	const m = parseIriteSource(src, file);
	return { mainSrc: file, files: [file], databases: [], enums: [], records: [], constants: [], routines: m.routines, diagnostics: m.diagnostics };
}

const SRC = [
	"procedure P;",
	"begin",
	"  SetLabelText(LBL3, \"x\");",
	"  SetLabelText(lbl3_2, \"y\");",
	"  SetLabelText(lbl4, \"lbl3\");",
	"  if iWidget = IMIN then",
	"    Foo(1);",
	"  end if;",
	"end;",
].join("\n");

describe("buildScreenView", () => {
	it("groups widgets by screen, ordered by screen and ascending id", () => {
		const v = buildScreenView(rev);
		expect(v.screens.map((s) => s.number)).toEqual([...v.screens.map((s) => s.number)].sort((a, b) => a - b));
		for (const s of v.screens) {
			const ids = s.widgets.map((w) => w.id);
			expect(ids).toEqual([...ids].sort((a, b) => a - b));
		}
		const s4 = v.screens.find((s) => s.number === 4)!;
		expect(s4.widgets.find((w) => w.id === 1)?.alias).toBe("imIn");
	});
	it("matches alias references case-insensitively as whole identifiers", () => {
		const v = buildScreenView(rev, project(SRC));
		const all = v.screens.flatMap((s) => s.widgets);
		const lbl3 = all.find((w) => w.alias === "lbl3")!;
		expect(lbl3.references).toEqual([{ file: "a.iri", line: 3, callee: "SetLabelText" }]);
		const lbl4 = all.find((w) => w.alias === "lbl4")!;
		expect(lbl4.references).toEqual([{ file: "a.iri", line: 5, callee: "SetLabelText" }]);
	});
	it("includes condition references and none without a project", () => {
		const v = buildScreenView(rev, project(SRC.replace("IMIN", "imIn")));
		const w = v.screens.flatMap((s) => s.widgets).find((x) => x.alias === "imIn")!;
		expect(w.references).toContainEqual({ file: "a.iri", line: 7, callee: "(condition)" });
		const none = buildScreenView(rev);
		expect(none.screens.every((s) => s.widgets.every((x) => x.references.length === 0))).toBe(true);
	});
	it("forwards rev diagnostics", () => {
		expect(buildScreenView(rev).diagnostics.length).toBe(rev.diagnostics.length);
	});
});

const opts = {
	cspSource: "vscode-resource:",
	nonce: "N0NCE",
	imageUri: (rel: string) => (rel === "sdimages/buttonG.png" ? "vscode-resource:/p/buttonG.png" : undefined),
	title: "T",
};

describe("renderScreensHtml", () => {
	const html = renderScreensHtml(buildScreenView(rev, project(SRC)), opts);
	it("has strict CSP with nonce", () => {
		expect(html).toContain("default-src 'none'");
		expect(html).toContain("img-src vscode-resource:");
		expect(html).toContain("script-src 'nonce-N0NCE'");
		expect(html).toContain('<script nonce="N0NCE">');
	});
	it("uses a canvas size constant", () => {
		expect(CANVAS_WIDTH).toBe(800);
		expect(CANVAS_HEIGHT).toBe(388);
	});
	it("renders one section per screen", () => {
		const n = buildScreenView(rev).screens.length;
		expect(html.match(/<section class="screen"/g)?.length).toBe(n);
	});
	it("positions widgets with rev coordinates", () => {
		expect(html).toMatch(/data-id="1"[^>]*style="[^"]*left:112px;top:242px;width:260px;height:60px/);
	});
	it("uses image uri when available, placeholder for builtin/missing", () => {
		expect(html).toContain('src="vscode-resource:/p/buttonG.png"');
		expect(html).toMatch(/class="w placeholder"[^>]*data-id="2"[^>]*>[^<]*local:\/\/9\.png/);
	});
	it("escapes label text and aliases", () => {
		const evil = parseRev(
			readFileSync(join(__dirname, "../fixtures/rev/sample.rev"), "utf8").replace("Hello, world", "<script>alert(1)</script>").replace("lbl3", "a\"><img src=x>"),
		);
		const h = renderScreensHtml(buildScreenView(evil), opts);
		expect(h).not.toContain("<script>alert(1)");
		expect(h).not.toContain("<img src=x>");
		expect(h).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
		expect(h.match(/<script/g)?.length).toBe(1);
	});
});
