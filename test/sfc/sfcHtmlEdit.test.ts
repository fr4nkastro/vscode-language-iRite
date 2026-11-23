import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseIriteSource } from "../../src/irite";
import type { IriteProjectModel } from "../../src/irite";
import { buildSfc } from "../../src/sfc/sfcModel";
import { layoutSfc } from "../../src/sfc/sfcLayout";
import { mergeLayout } from "../../src/sfc/sfcLayoutEdit";
import { renderSfcHtml } from "../../src/sfc/sfcHtml";
import { GEOMETRY_SOURCE } from "../../src/sfc/sfcGeometry";

function project(src: string, file = "a.iri"): IriteProjectModel {
	const m = parseIriteSource(src, file);
	return { mainSrc: file, files: [file], databases: [], enums: m.enums, records: [], constants: [], routines: m.routines, diagnostics: m.diagnostics };
}
const sfc = buildSfc(project(readFileSync(join(__dirname, "fixtures/petri.iri"), "utf8")));
const auto = layoutSfc(sfc);
const opts = { cspSource: "vscode-webview://x", nonce: "NONCE123", title: "T" };

describe("renderSfcHtml editing support", () => {
	const html = renderSfcHtml(sfc, auto, { ...opts, layoutInfo: { file: ".vscode/irite-sfc.layout.json", saved: false, ignored: [] } });
	it("offers reset, explains the gestures and names the sidecar", () => {
		expect(html).toContain('<button id="reset" type="button">Reset layout</button>');
		expect(html).toContain("Double-click (or Alt+click) a line to add a bend point");
		expect(html).toContain("<code>.vscode/irite-sfc.layout.json</code>");
		expect(html).toContain("Automatic layout.");
	});
	it("marks every step and link for the script and embeds the shared geometry", () => {
		expect((html.match(/class="step[^"]*" data-i="/g) ?? []).length).toBe(auto.nodes.length);
		expect((html.match(/class="tr" data-tr="-?\d+" data-li="/g) ?? []).length).toBe(auto.links.length);
		expect(html).toContain(GEOMETRY_SOURCE);
		expect(html).toContain("class=\"edgehit\"");
	});
	it("keeps the model block under the nonce and the CSP intact", () => {
		expect(html).toContain('<script type="application/json" id="model" nonce="NONCE123">');
		expect(html).not.toMatch(/<script(?![^>]*nonce)/);
		expect(html).toContain("script-src 'nonce-NONCE123'");
	});
	it("cannot be broken out of through names in the model block", () => {
		const evil = buildSfc(project("type STATES is (NullState, A);\ntype TRANSITIONS is (NullTransition, T);"));
		evil.steps[0].name = "</script><script>alert(1)</script>";
		const h = renderSfcHtml(evil, layoutSfc(evil), opts);
		expect(h).not.toContain("</script><script>alert(1)");
		expect(h).toContain("\\u003c/script>");
	});
	it("reports the saved layout, ignored entries and sidecar warnings", () => {
		const merged = mergeLayout(auto, { steps: { standby: { x: 300, y: 50 }, gone: { x: 1, y: 1 } }, links: {} });
		const h = renderSfcHtml(sfc, merged.layout, { ...opts, layoutInfo: { file: "f.json", saved: true, ignored: merged.ignored.steps, warning: "f.json is not valid JSON" } });
		expect(h).toContain("Saved layout applied.");
		expect(h).toContain("<code>gone</code>");
		expect(h).toContain('<p class="warning">f.json is not valid JSON</p>');
		expect(h).toContain('"moved":true');
		expect(h).toMatch(/<rect x="300" y="50"/);
	});
	it("renders the same diagram as before when no layout info is given", () => {
		expect(renderSfcHtml(sfc, auto, opts)).toContain("<h2>Layout</h2>");
		expect(renderSfcHtml(sfc, auto, opts)).not.toContain("Edits are saved to");
	});
});
