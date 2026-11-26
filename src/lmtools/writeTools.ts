import { resolveTarget } from "./paths";
import type { PropertySchema } from "./schema";
import type { ToolDef } from "./tools";
import { runWriteInvocation } from "./writeInvocation";

const integer = (description: string, minimum = 1): PropertySchema => ({ type: "integer", minimum, maximum: 999999, description });
const text = (description: string): PropertySchema => ({ type: "string", minLength: 1, maxLength: 255, description });
const list = (description: string, minItems = 0): PropertySchema => ({ type: "array", minItems, maxItems: 128, items: { type: "string", minLength: 1, maxLength: 512 }, description });
const table = text("Existing table alias, or the alias to create for Add Table.");
const field = text("Column name (case-insensitive for an existing field).");
const dbType = text("Revolution field type name or type code 1–8 as a string.");
const size = integer("Size for a string field, when applicable.");
const id = integer("Numeric widget ID; list widgets first if unknown.");
const fields = list("Widget property assignments as individual key=value strings.");
const value = (input: Record<string, unknown>, k: string) => String(input[k]);
const opt = (input: Record<string, unknown>, k: string) => input[k] === undefined ? [] : [`--${k}`, value(input, k)];
const assign = (input: Record<string, unknown>, k: string) => input[k] === undefined ? [] : [`${k}=${value(input, k)}`];
const args = (input: Record<string, unknown>) => (input.fields ?? []) as string[];

function def(name: string, label: string, description: string, command: string[], properties: Record<string, PropertySchema>,
	required: string[], extra: (input: Record<string, unknown>) => string[] = () => []): ToolDef & { label: string; description: string } {
	return {
		name: `irite_${name}`, label, description, kind: "write",
		inputSchema: { type: "object", additionalProperties: false, properties: {
			rev: text("Path to a .rev or iRite project folder inside the workspace; omit for a single project."),
			apply: { type: "boolean", description: "Default false: preview only. True requests a native VS Code confirmation and then applies only if approved." },
			...properties,
		}, ...(required.length ? { required } : {}) },
		async run(input, ctx) {
			// The CLI parses option-looking tokens anywhere in argv. Only this adapter may supply flags.
			for (const [key, raw] of Object.entries(input)) {
				if ((Array.isArray(raw) ? raw : [raw]).some(v => typeof v === "string" && v.startsWith("--"))) {
					return { ok: false, text: JSON.stringify({ ok: false, error: `${key} must not contain CLI option tokens` }) };
				}
			}
			const target = await resolveTarget(input.rev as string | undefined, "rev", ctx);
			if (!target.ok) return { ok: false, text: JSON.stringify({ ok: false, error: target.error }) };
			return runWriteInvocation([...command, target.path, ...extra(input)], ctx, input.apply === true, ctx.confirmWrite, ctx.cancelled);
		},
	};
}

export const WRITE_TOOLS = [
	def("widgetSet", "Set Widget Properties", "Change properties on an existing .rev widget by numeric ID.", ["widget", "set"], { id, fields: { ...fields, minItems: 1 } }, ["id", "fields"], i => [value(i,"id"), ...args(i)]),
	def("widgetAdd", "Add Widget", "Add a widget of a Revolution type to an iRite screen.", ["widget", "add"], { type: integer("Revolution widget type code 1–11."), screen: integer("Target screen number.", 0), fields }, ["type", "screen"], i => [value(i,"type"), ...opt(i,"screen"), ...args(i)]),
	def("widgetRm", "Remove Widget", "Remove a .rev widget by numeric ID. References cause refusal unless force is requested.", ["widget", "rm"], { id, force: { type: "boolean", description: "Only set true when the user explicitly asks to remove a referenced widget." } }, ["id"], i => [value(i,"id"), ...(i.force === true ? ["--force"] : [])]),
	def("dbAddTable", "Add Database Table", "Add a .rev database table with at least one field; use the database schema tool for context.", ["db", "add-table"], { table, records: integer("Maximum record count."), fields: list("Column declarations in Name:type[:size] format.", 1) }, ["table", "fields"], i => [value(i,"table"), ...opt(i,"records"), ...args(i).flatMap(f => ["--field", f])]),
	def("dbRmTable", "Remove Database Table", "Remove an entire table from the .rev database schema, including all its fields.", ["db", "rm-table"], { table }, ["table"], i => [value(i,"table")]),
	def("dbAddField", "Add Database Field", "Add a field to an existing .rev database table.", ["db", "add-field"], { table, field, type: dbType, size, at: integer("Optional 1-based insertion position.") }, ["table", "field", "type"], i => [value(i,"table"), value(i,"field"), value(i,"type"), ...opt(i,"size"), ...opt(i,"at")]),
	def("dbSetField", "Set Database Field", "Change the name, type or string size of an existing database field.", ["db", "set-field"], { table, field, name: text("New column name."), type: dbType, size }, ["table", "field"], i => [value(i,"table"), value(i,"field"), ...assign(i,"name"), ...assign(i,"type"), ...assign(i,"size")]),
	def("dbRmField", "Remove Database Field", "Remove a column from a table in the .rev database schema.", ["db", "rm-field"], { table, field }, ["table", "field"], i => [value(i,"table"), value(i,"field")]),
	def("dbMoveField", "Move Database Field", "Move a column to a different position in its .rev database table.", ["db", "move-field"], { table, field, to: integer("New 1-based position.") }, ["table", "field", "to"], i => [value(i,"table"), value(i,"field"), value(i,"to")]),
	def("regenIri", "Regenerate iRite Aliases", "Explicitly regenerate the sibling .iri from the .rev. Never edits the .rev itself.", ["regen-iri"], {}, []),
];
