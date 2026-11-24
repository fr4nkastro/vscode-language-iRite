import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRev } from "../../src/rev";
import { buildScreenView } from "../../src/preview/screenModel";
import { renderScreensHtml } from "../../src/preview/screenHtml";

const rev = parseRev(readFileSync(join(__dirname, "../fixtures/preview/main.rev"), "utf8"));
const view = buildScreenView(rev);
const base = { cspSource: "x:", nonce: "N", imageUri: () => undefined, title: "T" };

function initial(html: string): unknown {
	const m = /const INIT = (\{.*?\});\n/.exec(html);
	return JSON.parse(m![1]);
}

describe("per-widget controls", () => {
	const html = renderScreensHtml(view, base);
	it("gives every list row an eye toggle and front/back buttons labelled as preview only", () => {
		const rows = html.match(/<tr class="row"/g)?.length ?? 0;
		expect(rows).toBe(view.screens.reduce((n, s) => n + s.widgets.length, 0));
		expect(html.match(/data-act="eye"/g)?.length).toBe(rows);
		expect(html.match(/data-act="front"/g)?.length).toBe(rows);
		expect(html.match(/data-act="back"/g)?.length).toBe(rows);
		expect(html).toMatch(/data-act="front" title="[^"]*not saved/);
		expect(html).toMatch(/data-act="eye" title="[^"]*not saved/);
	});
	it("has show-all and reset-order buttons and a not-saved note on every screen", () => {
		expect(html.match(/data-act="showall"/g)?.length).toBe(view.screens.length);
		expect(html.match(/data-act="resetorder"/g)?.length).toBe(view.screens.length);
		expect(html.match(/Preview only, not saved to \.rev\./g)?.length).toBeGreaterThanOrEqual(view.screens.length);
	});
});

describe("initial state", () => {
	it("defaults to the empty state", () => {
		expect(initial(renderScreensHtml(view, base))).toEqual({ screen: "all", panel: "7", hidden: {}, order: {} });
	});
	it("restores a valid state (hidden widgets, z-order, panel) so a re-render keeps it", () => {
		const state = { screen: "12", panel: "12", hidden: { "12": [3] }, order: { "12": { back: [7], front: [3] } } };
		expect(initial(renderScreensHtml(view, { ...base, initialState: state }))).toEqual(state);
	});
	it("sanitizes junk and cannot break out of the script element", () => {
		const html = renderScreensHtml(view, { ...base, initialState: { screen: "</script><img onerror=x>", hidden: { "1": [2, "</script>"] }, panel: "</script>" } });
		expect(initial(html)).toEqual({ screen: "all", panel: "7", hidden: { "1": [2] }, order: {} });
		expect(html.match(/<script/g)?.length).toBe(1); // only the nonce script, nothing injected
		expect(html).not.toContain("<img onerror");
	});
	it("keeps the strict CSP", () => {
		const html = renderScreensHtml(view, base);
		expect(html).toContain("default-src 'none'");
		expect(html).toContain("script-src 'nonce-N'");
	});
});
