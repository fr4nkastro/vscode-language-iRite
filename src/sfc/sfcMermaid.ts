/** Mermaid `flowchart TD` approximation of the SFC (steps = rectangles, transitions = small nodes). Pure. */
import type { SfcModel } from "./sfcModel";

const id = (prefix: string, name: string): string => `${prefix}_${name.replace(/\W/g, "_")}`;
const text = (s: string): string => s.replace(/"/g, "'");

export function sfcToMermaid(sfc: SfcModel): string {
	const out: string[] = ["flowchart TD"];
	for (const s of sfc.steps) {
		out.push(s.initial ? `  ${id("S", s.name)}[["${text(s.name)}"]]` : `  ${id("S", s.name)}["${text(s.name)}"]`);
	}
	for (const t of sfc.transitions) {
		out.push(`  ${id("T", t.name)}(["${text(t.name)}"])`);
	}
	const anyNeeded = sfc.transitions.some((t) => t.anyStep);
	if (anyNeeded) {
		out.push('  ANY(("any step"))');
	}
	for (const t of sfc.transitions) {
		const tid = id("T", t.name);
		for (const s of t.sources) {
			out.push(`  ${id("S", s)} --> ${tid}`);
		}
		if (t.anyStep) {
			out.push(`  ANY --> ${tid}`);
		}
		if (t.target) {
			out.push(`  ${tid} --> ${id("S", t.target)}`);
		}
	}
	return out.join("\n") + "\n";
}
