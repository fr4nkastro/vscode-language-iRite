/** Mermaid `flowchart` of the Level 2 module graph (modules in folder subgraphs, edges weighted by call count). Pure. */
import type { CallGraph } from "./callGraph";
import { callViews } from "./callViews";

const text = (s: string): string => s.replace(/["\[\]<>]/g, "'");

export function callMapToMermaid(graph: CallGraph): string {
	const view = callViews.moduleView(graph, "file");
	const index = new Map(view.nodes.map((n, i) => [n.id, i]));
	const out: string[] = ["flowchart LR"];
	const folders: string[] = [];
	for (const n of view.nodes) {
		if (!folders.includes(n.group)) {
			folders.push(n.group);
		}
	}
	folders.forEach((folder, gi) => {
		out.push(`  subgraph g${gi}["${text(folder)}"]`);
		for (const n of view.nodes) {
			if (n.group === folder) {
				out.push(`    m${index.get(n.id)}["${text(n.id.slice(n.id.lastIndexOf("/") + 1))}"]`);
			}
		}
		out.push("  end");
	});
	for (const e of view.edges) {
		out.push(`  m${index.get(e.from)} -->|${e.count}| m${index.get(e.to)}`);
	}
	return out.join("\n") + "\n";
}
