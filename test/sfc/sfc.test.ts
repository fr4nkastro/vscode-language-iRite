import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseIriteSource } from "../../src/irite";
import type { IriteProjectModel } from "../../src/irite";
import { buildSfc } from "../../src/sfc/sfcModel";
import type { SfcModel } from "../../src/sfc/sfcModel";
import { layoutSfc } from "../../src/sfc/sfcLayout";
import { sfcToMermaid } from "../../src/sfc/sfcMermaid";
import { renderSfcHtml } from "../../src/sfc/sfcHtml";

function project(src: string, file = "a.iri"): IriteProjectModel {
	const m = parseIriteSource(src, file);
	return { mainSrc: file, files: [file], databases: [], enums: m.enums, records: [], constants: [], routines: m.routines, diagnostics: m.diagnostics };
}
const FIXTURE = readFileSync(join(__dirname, "fixtures/petri.iri"), "utf8");
const sfc = buildSfc(project(FIXTURE));
const tr = (n: string) => sfc.transitions.find((t) => t.name === n)!;

describe("buildSfc steps", () => {
	it("takes enum members without sentinels, case-insensitively, and flags the initial one", () => {
		expect(sfc.steps.map((s) => s.name)).toEqual(["Standby", "Ask", "Wait", "Done", "Orphan"]);
		expect(sfc.transitions.map((t) => t.name)).toEqual(["Start", "Confirm", "Capture", "Abandon", "Release", "Clear", "Unused"]);
		expect(sfc.steps.filter((s) => s.initial).map((s) => s.name)).toEqual(["Standby"]);
		const lower = buildSfc(project("type states is (NullState, A, B);\ntype transitions is (NullTransition, T);"));
		expect(lower.steps.map((s) => s.name)).toEqual(["A", "B"]);
	});
	it("returns an empty model when the enums are missing", () => {
		const m = buildSfc(project("procedure P;\nbegin\nend;"));
		expect(m.steps).toEqual([]);
		expect(m.diagnostics.length).toBeGreaterThan(0);
	});
	it("selects the initial step: option, Standby/Idle/Init, else first", () => {
		expect(buildSfc(project(FIXTURE), { initialStep: "wait" }).steps.find((s) => s.initial)!.name).toBe("Wait");
		expect(buildSfc(project("type STATES is (NullState, Foo, Idle, Bar);")).steps.find((s) => s.initial)!.name).toBe("Idle");
		expect(buildSfc(project("type STATES is (NullState, Foo, Bar);")).steps.find((s) => s.initial)!.name).toBe("Foo");
	});
	it("honours custom enum names", () => {
		const m = buildSfc(project("type ST is (NullState, A, B);\ntype TR is (NullTransition, Go);"), { statesEnum: "st", transitionsEnum: "tr" });
		expect(m.steps.map((s) => s.name)).toEqual(["A", "B"]);
		expect(m.transitions.map((t) => t.name)).toEqual(["Go"]);
	});
});

describe("buildSfc entry routines and targets", () => {
	it("maps CmdX called under GetState(...) = S", () => {
		expect(sfc.steps.map((s) => [s.name, s.entryRoutine])).toEqual([
			["Standby", "CmdStandby"],
			["Ask", "CmdAsk"],
			["Wait", "CmdWait"],
			["Done", undefined],
			["Orphan", undefined],
		]);
		expect(sfc.steps[0].source).toMatchObject({ file: "a.iri", line: 37 });
	});
	it("derives the target from SetState under `<ident> = T`", () => {
		expect(sfc.transitions.map((t) => [t.name, t.target])).toEqual([
			["Start", "Ask"], ["Confirm", "Wait"], ["Capture", "Done"], ["Abandon", "Standby"], ["Release", "Standby"], ["Clear", "Standby"], ["Unused", "Orphan"],
		]);
	});
});

describe("buildSfc emitter sources", () => {
	it("(a) entry routine is the source", () => {
		expect(tr("Start").sources).toEqual(["Standby"]);
		expect(tr("Start").emitters).toMatchObject([{ routine: "CmdStandby", file: "a.iri", conditions: ["GetWeight(1) > 10"], via: "CmdSetTransition" }]);
	});
	it("(b) state conditions, narrowed across nested levels", () => {
		expect(tr("Abandon").sources).toEqual(["Ask", "Wait"]);
		expect(tr("Capture").sources).toEqual(["Wait"]);
		expect(tr("Release").sources).toEqual(["Done"]);
		expect(tr("Release").emitters[0].via).toBe("SetHandlerTransition");
	});
	it("(c) guard `GetState <> S` earlier in the routine", () => {
		expect(tr("Confirm").sources).toEqual(["Ask"]);
	});
	it("(d) otherwise global", () => {
		expect(tr("Clear").sources).toEqual([]);
		expect(tr("Clear").anyStep).toBe(true);
		expect(tr("Start").anyStep).toBe(false);
	});
	it("does not treat negated conditions as sources", () => {
		const m = buildSfc(project([
			"type STATES is (NullState, A, B);", "type TRANSITIONS is (NullTransition, T);",
			"procedure P(m: integer; s: integer);", "begin",
			"  if GetState(m, s) = A then", "    Beep;", "  else", "    CmdSetTransition(m, s, T);", "  end if;", "end;",
		].join("\n")));
		expect(m.transitions[0].sources).toEqual([]);
		expect(m.transitions[0].anyStep).toBe(true);
	});
});

describe("buildSfc diagnostics", () => {
	it("reports unreachable steps, missing targets, never emitted transitions and steps without entry", () => {
		const msgs = sfc.diagnostics.map((d) => `${d.severity}: ${d.message}`);
		expect(msgs).toContain("warning: Step Orphan is unreachable from the initial step Standby");
		expect(msgs).toContain("warning: Transition Unused is never emitted");
		expect(msgs).toContain("info: Step Done has no entry routine");
		expect(msgs.some((m) => m.includes("has no target"))).toBe(false);
		const nt = buildSfc(project("type STATES is (NullState, A);\ntype TRANSITIONS is (NullTransition, T);"));
		expect(nt.diagnostics.map((d) => d.message)).toContain("Transition T has no target (no SetState found)");
	});
});

describe("layoutSfc", () => {
	const layout = layoutSfc(sfc);
	it("is deterministic and JSON-serializable", () => {
		expect(layoutSfc(buildSfc(project(FIXTURE)))).toEqual(layout);
		expect(JSON.parse(JSON.stringify(layout))).toEqual(layout);
	});
	it("ranks steps by BFS from the initial step", () => {
		const rank = Object.fromEntries(layout.nodes.map((n) => [n.name, n.rank]));
		expect(rank).toMatchObject({ Standby: 0, Ask: 1, Wait: 2, Done: 3 });
		const y = (n: string) => layout.nodes.find((x) => x.name === n)!.y;
		expect(y("Ask")).toBeGreaterThan(y("Standby"));
		expect(layout.nodes.find((n) => n.name === "Orphan")!.rank).toBeGreaterThan(3);
	});
	it("draws one bar per source link, back-edges and the global lane", () => {
		const links = layout.links;
		expect(links.filter((l) => l.transition === "Abandon").map((l) => [l.from, l.to, l.back])).toEqual([["Ask", "Standby", true], ["Wait", "Standby", true]]);
		const start = links.find((l) => l.transition === "Start")!;
		expect(start.back).toBe(false);
		expect(start.label).toContain("Start");
		const clear = links.find((l) => l.transition === "Clear")!;
		expect(clear.from).toBeUndefined();
		expect(clear.global).toBe(true);
		expect(layout.notes.map((n) => n.text)).toContain("from any step");
		expect(clear.bar.x).toBeGreaterThan(Math.max(...layout.nodes.map((n) => n.x + n.w)));
		expect(clear.bar.x).toBeLessThan(layout.width);
	});
	it("truncates long labels but keeps the full text in the tooltip", () => {
		const long = buildSfc(project([
			"type STATES is (NullState, A, B);", "type TRANSITIONS is (NullTransition, T);",
			"procedure H;", "begin", "  if X = T then", "    SetState(m, s, B);", "  end if;", "end;",
			"procedure CmdA(m: integer);", "begin", "  if SomeVeryLongConditionName(1) > AnotherVeryLongValueName(2) then", "    CmdSetTransition(m, s, T);", "  end if;", "end;",
			"procedure HS;", "begin", "  if GetState(m, s) = A then", "    CmdA(m);", "  end if;", "end;",
		].join("\n")));
		const l = layoutSfc(long).links[0];
		expect(l.label.length).toBeLessThanOrEqual(40);
		expect(l.label.endsWith("…")).toBe(true);
		expect(l.tooltip).toContain("SomeVeryLongConditionName(1) > AnotherVeryLongValueName(2)");
	});
});

describe("sfcToMermaid", () => {
	it("renders a tiny model exactly", () => {
		const tiny: SfcModel = {
			steps: [{ name: "A", initial: true }, { name: "B", initial: false }],
			transitions: [
				{ name: "Go", target: "B", sources: ["A"], anyStep: false, emitters: [] },
				{ name: "Reset", target: "A", sources: [], anyStep: true, emitters: [] },
			],
			diagnostics: [],
		};
		expect(sfcToMermaid(tiny)).toBe(
			[
				"flowchart TD",
				'  S_A[["A"]]',
				'  S_B["B"]',
				'  T_Go(["Go"])',
				'  T_Reset(["Reset"])',
				'  ANY(("any step"))',
				"  S_A --> T_Go",
				"  T_Go --> S_B",
				"  ANY --> T_Reset",
				"  T_Reset --> S_A",
				"",
			].join("\n"),
		);
	});
});

describe("renderSfcHtml", () => {
	const opts = { cspSource: "vscode-webview://x", nonce: "NONCE123", title: "<b>T</b>" };
	const html = renderSfcHtml(sfc, layoutSfc(sfc), opts);
	it("sets a strict CSP with the nonce", () => {
		expect(html).toContain("default-src 'none'");
		expect(html).toContain("style-src vscode-webview://x 'unsafe-inline'");
		expect(html).toContain("script-src 'nonce-NONCE123'");
		expect(html).toContain('<script nonce="NONCE123">');
		expect(html).toContain("typeof acquireVsCodeApi === 'function'");
		expect(html).not.toMatch(/<script(?![^>]*nonce)/);
	});
	it("escapes titles and names", () => {
		expect(html).toContain("&lt;b&gt;T&lt;/b&gt;");
		expect(html).not.toContain("<b>T</b>");
		const evil = buildSfc(project("type STATES is (NullState, A);\ntype TRANSITIONS is (NullTransition, T);"));
		evil.steps[0].name = '"><script>alert(1)</script>';
		const h = renderSfcHtml(evil, layoutSfc(evil), opts);
		expect(h).not.toContain("<script>alert(1)");
		expect(h).toContain("&lt;script&gt;alert(1)");
	});
	it("lists diagnostics with their severity class and makes located ones clickable", () => {
		expect(html).toContain('<li class="warning hasfile" data-file="a.iri" data-line="1">Step Orphan is unreachable');
		expect(html).toContain('<li class="info hasfile" data-file="a.iri" data-line="1">Step Done has no entry routine');
		const nt = buildSfc(project("type STATES is (NullState, A);\ntype TRANSITIONS is (NullTransition, T);"));
		expect(renderSfcHtml(nt, layoutSfc(nt), opts)).toContain('<li class="error hasfile" data-file="a.iri" data-line="2">Transition T has no target');
		expect(html).toContain(".error {");
	});
	it("wires step click to the entry routine and lists emitters per transition", () => {
		expect(html).toContain('data-file="a.iri" data-line="37"');
		expect(html).toContain("CmdStandby");
		expect(html).toContain("GetWeight(1) &gt; 10");
	});
});
