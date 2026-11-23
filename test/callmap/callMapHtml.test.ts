import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadIriteProject } from "../../src/irite";
import { buildCallGraph } from "../../src/callmap/callGraph";
import { buildSystemContext, sanitizeViewState } from "../../src/callmap/callContext";
import { jsonForScript, renderCallMapHtml } from "../../src/callmap/callMapHtml";
import { CALL_VIEWS_SOURCE, createCallViews } from "../../src/callmap/callViews";

const projectDir = resolve(__dirname, "../fixtures/callmap");
const read = (p: string): string | undefined => {
	try {
		return readFileSync(p, "utf8");
	} catch {
		return undefined;
	}
};
const graph = buildCallGraph(loadIriteProject(join(projectDir, "main.src"), read), projectDir);
const context = buildSystemContext(graph, "demo");
const opts = { cspSource: "vscode-webview://x", nonce: "NONCE123", title: "Call map: demo" };
const html = renderCallMapHtml({ graph, context }, opts);

describe("renderCallMapHtml", () => {
	it("locks the page down with a nonce CSP and no inline event handlers or external resources", () => {
		expect(html).toContain("default-src 'none'");
		expect(html).toContain("script-src 'nonce-NONCE123'");
		expect(html).toContain('<script nonce="NONCE123">');
		expect(html).not.toMatch(/\son[a-z]+\s*=/i);
		expect(html).not.toMatch(/(src|href)\s*=\s*["']https?:/i);
		expect(html).not.toContain("innerHTML");
	});
	it("offers breadcrumb, search, folder collapse and built-in toggles", () => {
		expect(html).toContain('id="crumbs"');
		expect(html).toContain('id="q"');
		expect(html).toContain('id="optFolders"');
		expect(html).toContain('id="optBuiltins"');
		expect(html).toContain("Collapse to folders");
		expect(html).toContain("Show built-ins");
	});
	it("embeds the graph as JSON that cannot close the script element", () => {
		const evil = { ...graph, routines: [{ ...graph.routines[0], name: "</script><img src=x onerror=alert(1)>" }] };
		const out = renderCallMapHtml({ graph: evil, context }, opts);
		expect(out).not.toContain("</script><img");
		const m = /<script type="application\/json" id="cm-data">([\s\S]*?)<\/script>/.exec(out)!;
		expect(JSON.parse(m[1]).graph.routines[0].name).toBe("</script><img src=x onerror=alert(1)>");
		expect(jsonForScript({ a: " <>&" })).toBe('{"a":"\\u2028\\u003c\\u003e\\u0026"}');
	});
	it("embeds the very same view functions the extension uses", () => {
		expect(html).toContain(CALL_VIEWS_SOURCE);
		const viaSource = (0, eval)(CALL_VIEWS_SOURCE) as ReturnType<typeof createCallViews>;
		expect(viaSource.moduleView(graph, "file")).toEqual(createCallViews().moduleView(graph, "file"));
		expect(viaSource.search(graph, "scale")).toEqual(createCallViews().search(graph, "scale"));
	});
	it("escapes the title and escapes graph diagnostics", () => {
		const out = renderCallMapHtml({ graph: { ...graph, diagnostics: ["<b>dup</b>"] }, context }, { ...opts, title: "<x>" });
		expect(out).toContain("<title>&lt;x&gt;</title>");
		expect(out).toContain("<li>&lt;b&gt;dup&lt;/b&gt;</li>");
	});
	it("reports a project without routines", () => {
		const out = renderCallMapHtml({ graph: { ...graph, files: [], routines: [], sites: [] }, context }, opts);
		expect(out).toContain("No routines found");
	});
});

describe("sanitizeViewState", () => {
	it("keeps a valid view and clamps everything else", () => {
		expect(sanitizeViewState({ level: 3, module: "src/a.iri", routine: 4, gran: "folder", builtins: true })).toEqual({ level: 3, module: "src/a.iri", routine: 4, gran: "folder", builtins: true });
		expect(sanitizeViewState({ level: 3, module: null, routine: -1, gran: "x", builtins: "yes" })).toEqual({ level: 2, module: null, routine: null, gran: "file", builtins: false });
		expect(sanitizeViewState({ level: 9, module: "x".repeat(501), routine: 1.5 })).toEqual({ level: 1, module: null, routine: null, gran: "file", builtins: false });
		expect(sanitizeViewState("nope")).toBeUndefined();
		expect(sanitizeViewState(null)).toBeUndefined();
	});
});
