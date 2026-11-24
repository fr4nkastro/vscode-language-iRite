import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderEditorHtml } from "../../src/editor/editorHtml";
import { renderScreensHtml } from "../../src/preview/screenHtml";
import { buildScreenView } from "../../src/preview/screenModel";
import { parseRev } from "../../src/rev";

const rev = parseRev(readFileSync(join(__dirname, "../fixtures/editor/main.rev"), "utf8"));
const view = buildScreenView(rev);
const opts = { cspSource: "vscode-webview://x", nonce: "NONCE", title: "main.rev", imageUri: () => undefined, prefs: { snap: true, grid: 8 } };
const html = renderEditorHtml(view, opts);
const script = /<script nonce="NONCE">([\s\S]*)<\/script>/.exec(html)![1];

describe("editor page", () => {
	it("keeps the CSP pattern: no default source, scripts only by nonce, one script element", () => {
		expect(html).toContain("default-src 'none'");
		expect(html).toContain("script-src 'nonce-NONCE'");
		expect(html.match(/<script/g)).toHaveLength(1);
		expect(html).not.toContain("innerHTML");
	});

	it("has every placeholder replaced and a script that compiles", () => {
		expect(script).not.toMatch(/__[A-Z]+__/);
		expect(() => new Function(script)).not.toThrow();
	});

	it("renders every widget of every screen once, with a list row each and the resize handles", () => {
		const total = view.screens.reduce((n, s) => n + s.widgets.length, 0);
		expect(html.match(/class="w[ "]/g)?.length).toBe(total);
		expect(html.match(/<tr class="row"/g)).toHaveLength(total);
		expect(html.match(/class="ovl sel"/g)).toHaveLength(view.screens.length);
		expect(html.match(/data-h="se"/g)).toHaveLength(view.screens.length);
	});

	it("paints exactly like the preview: same widget boxes", () => {
		const preview = renderScreensHtml(view, { ...opts, initialState: undefined });
		const boxes = (h: string): string[] => [...h.matchAll(/class="(w [^"]*)" data-id="(\d+)" style="([^"]*)"/g)].map((m) => `${m[2]}|${m[1]}|${m[3]}`);
		expect(boxes(html)).toEqual(boxes(preview));
	});

	it("offers one step back/forward, front/back, hide and reset as view-only controls", () => {
		for (const act of ["front", "forward", "backward", "back", "eye", "showall", "resetorder"]) {
			expect(html).toContain(`data-act="${act}"`);
		}
		expect(html).toContain("not saved");
	});

	it("embeds snap and grid preferences and sanitizes the initial view state", () => {
		expect(script).toContain('{"snap":true,"grid":8}');
		const hostile = renderEditorHtml(view, { ...opts, prefs: { snap: false, grid: 99999 }, initialState: { screen: "</script><b>", panel: "9" } });
		const s = /<script nonce="NONCE">([\s\S]*)<\/script>/.exec(hostile)![1];
		expect(hostile.match(/<script/g)).toHaveLength(1);
		expect(s).toContain('"grid":8');
		expect(s).not.toContain("</script>");
	});

	it("escapes names and aliases", () => {
		const evil = { ...view, screens: view.screens.map((s) => ({ ...s, names: ['"><img src=x>'] })) };
		const out = renderEditorHtml(evil, opts);
		expect(out).not.toContain('"><img src=x>');
	});

	it("tells the user that z-order and hiding are not saved", () => {
		expect(html).toMatch(/view only, not saved/i);
	});
});

describe("editor page: palette, inspector, hint", () => {
	it("lists every non-legacy widget type as a draggable palette item, and says why type 5 is missing", () => {
		const types = [...html.matchAll(/<button type="button" draggable="true" data-wtype="(\d+)"/g)].map((m) => Number(m[1]));
		expect(types).toEqual([1, 2, 3, 4, 6, 7, 8, 9, 10, 11]);
		expect(html).toMatch(/Numeric widget \(type 5, legacy/);
	});
	it("embeds the catalog, the property tokens of every widget and an inspector container per screen", () => {
		expect(script).toContain('"fontSize"');
		expect(script).toMatch(/const PROPS = \{"/);
		expect(html.match(/class="insp"/g)).toHaveLength(view.screens.length);
		expect(script).toContain("type: 'setProp'");
		expect(script).toContain("type: 'renameAlias'");
		expect(script).toContain("e.key === 'Delete'");
		expect(script).toContain("'dragstart'");
		expect(script).toContain("'drop'");
	});
	it("shows the main.iri lines as escaped text and never offers to write the file", () => {
		const out = renderEditorHtml(view, { ...opts, hint: { add: ["a<b>     : constant integer := 1;"], change: [{ old: "x         : constant integer := 2;", new: "y         : constant integer := 2;" }], remove: [] } });
		expect(out).toContain("+ a&lt;b&gt;");
		expect(out).toContain("- x         : constant integer := 2;");
		expect(out).toContain("never edited by this extension");
		expect(html).not.toContain('id="irihint"');
	});
	it("escapes image names and keeps a hostile selection or image list out of the script", () => {
		const out = renderEditorHtml(view, { ...opts, images: ['"><b>.png', "ok.png"], selected: 3 });
		expect(out).not.toContain('"><b>.png');
		expect(out).toContain('<option value="ok.png">');
		expect(/<script nonce="NONCE">([\s\S]*)<\/script>/.exec(out)![1]).toContain("const INITSEL = 3;");
		expect(out.match(/<script/g)).toHaveLength(1);
	});
});
