/** Mermaid `erDiagram` text from an Erd. Pure. */
import type { Erd } from "./erdModel";
import { fieldType } from '../dbschema/fieldTypes';

const ident = (s: string): string => {
	const r = s.replace(/[^A-Za-z0-9_]/g, "_");
	return r === "" || /^[0-9]/.test(r) ? `_${r}` : r;
};

export function erdToMermaid(erd: Erd): string {
	const lines = ["erDiagram"];
	for (const t of erd.tables) {
		lines.push(`    ${ident(t.name)} {`);
		for (const f of t.fields) {
			lines.push(`        ${ident(f.typeCode !== undefined ? (fieldType(f.typeCode)?.name ?? `Unknown_${f.typeCode}`) : (f.type || "unknown"))} ${ident(f.name)}`);
		}
		lines.push("    }");
	}
	for (const r of erd.relations) {
		lines.push(`    ${ident(r.from.table)} }o--|| ${ident(r.to.table)} : "${r.from.field.replace(/"/g, "'")}"`);
	}
	return lines.join("\n") + "\n";
}
