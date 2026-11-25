import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { escapeHtml, renderWidget } from "../../src/preview/screenHtml";
import { buildScreenView } from "../../src/preview/screenModel";
import type { WidgetView } from "../../src/preview/screenModel";
import { renderScreenSvg } from "../../src/preview/screenSvg";
import { parseRev } from "../../src/rev";

const rev = parseRev(readFileSync(join(__dirname, "../fixtures/rev/hashed.rev"), "utf8"));
const screen = buildScreenView(rev).screens.find((s) => s.number === 1)!;
const opts = { cspSource: "x", nonce: "n", title: "t", imageUri: () => undefined };
const base = (type: number) => screen.widgets.find((w) => w.type === type)!;
const withProps = (w: WidgetView, p: Record<string, string>): WidgetView => ({ ...w, props: { ...w.props, ...p } });
const svgOf = (w: WidgetView) => {
	const s = renderScreenSvg({ ...screen, widgets: [w] }, { panel: "7" });
	return new RegExp(`data-id="${w.id}"[^>]*>(.*?)</svg>`, "s").exec(s)![1];
};

describe.each([4, 11])("label type %i previews justification and border", (type) => {
	it.each([
		["1", "flex-start"],
		["2", "flex-end"],
		["3", "center"],
	])("HTML: justification %s aligns %s and always centers vertically", (j, justify) => {
		const html = renderWidget(withProps(base(type), { justification: j }), opts);
		expect(html).toContain(`justify-content:${justify};`);
		expect(html).toContain("align-items:center;");
		expect(html).toContain(`>${escapeHtml(base(type).text ?? "")}</span>`);
	});
	it("HTML: border 2 (Fixed single) draws a 1px border, border 1 (None) draws none", () => {
		expect(renderWidget(withProps(base(type), { border: "2" }), opts)).toContain("border:1px solid Black;");
		expect(renderWidget(withProps(base(type), { border: "1" }), opts)).not.toContain("border:1px solid");
	});
	it.each([
		["1", "start", 0],
		["2", "end", "w"],
		["3", "middle", "w/2"],
	])("SVG: justification %s uses text-anchor %s, vertically centered", (j, anchor, xKind) => {
		const w = withProps(base(type), { justification: j });
		const width = w.width!;
		const x = xKind === 0 ? 0 : xKind === "w" ? width : width / 2;
		expect(svgOf(w)).toMatch(new RegExp(`<text x="${x}" y="${w.height! / 2}" [^>]*text-anchor="${anchor}" dominant-baseline="central"`));
	});
	it("SVG: border 2 adds a stroke rect, border 1 none", () => {
		const w = base(type);
		expect(svgOf(withProps(w, { border: "2" }))).toContain(`<rect x="0.5" y="0.5" width="${w.width! - 1}" height="${w.height! - 1}" fill="none" stroke="Black"/>`);
		expect(svgOf(withProps(w, { border: "1" }))).not.toContain("<rect");
	});
});
