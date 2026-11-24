import { decodeEntities, parseRev } from "../rev";
import { computeConfigHash, readConfigHash, rewriteConfigHash } from "../rev/configHash";
import { createDbSchema, validateDbSchema } from "./model";
import type { DbSchema, DbTable } from "./model";

export interface DbSavePlan { bytes: Buffer; model: DbSchema; hashChanged: boolean }

/** Verify the persisted database values, independently of source provenance and table ordering. */
export function validateDbReadback(bytes: Buffer, intended: DbSchema): void {
 const actual = createDbSchema(parseRev(bytes.toString("utf8")));
 const projection = (m: DbSchema) => m.tables.map(t => ({ index: t.index, name: t.name, maxRecords: t.maxRecords,
  fields: t.fields.map(f => ({ name: f.name, typeCode: f.typeCode, size: f.size })) })).sort((a, b) => a.index - b.index);
 if (JSON.stringify(projection(actual)) !== JSON.stringify(projection(intended))) throw new Error("Database post-check failed; nothing was written");
}

/** Plan an in-memory, byte-preserving update; callers must back up before writing. */
export function planDbSave(original: Buffer, intended: DbSchema): DbSavePlan | undefined {
 const text = original.toString("latin1");
 const before = createDbSchema(parseRev(original.toString("utf8")));
 const errors = validateDbSchema(intended).errors;
 if (errors.length) throw new Error(errors.join("; "));
 const indices = new Set<number>();
 for (const table of intended.tables) {
  if (!Number.isSafeInteger(table.index) || table.index < 1 || indices.has(table.index)) throw new Error("Ambiguous database index");
  indices.add(table.index);
 }
 const configs = [...text.matchAll(/<Config>([\s\S]*?)<\/Config>/g)];
 if (configs.length !== 1) throw new Error("Ambiguous Config boundary");
 const match = configs[0];
 const body = match[1];
 const lines = body.match(/[^\n]*\n|[^\n]+$/g) ?? [];
 const db = new Map<number, { schema?: number; alias?: number }>();
 for (let i = 0; i < lines.length; i++) {
  const m = /^(DB\.(SCHEMA|ALIAS))#(\d+)=/.exec(lines[i]);
  if (!m) continue;
  const id = Number(m[3]); const entry = db.get(id) ?? {};
  const key = m[2] === "SCHEMA" ? "schema" : "alias";
  if (entry[key] !== undefined) throw new Error("Ambiguous database entry");
  entry[key] = i; db.set(id, entry);
 }
 const oldTables = new Map(before.tables.map(t => [t.index, t]));
 const rawValue = (line: string) => line.slice(line.indexOf("=") + 1).replace(/\r?\n$/, "");
 const ending = (line: string) => /\r\n$/.test(line) ? "\r\n" : /\n$/.test(line) ? "\n" : "";
 const rawTokens = new Map<number, string[]>();
 for (const [id, entry] of db) {
  if (entry.schema === undefined || entry.alias === undefined) throw new Error("Unpaired database entry");
  rawTokens.set(id, rawValue(lines[entry.schema]).split(","));
 }
 const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
 const value = (table: DbTable) => {
  const old = table.sourceIndex === undefined ? undefined : oldTables.get(table.sourceIndex);
  if (table.sourceIndex !== undefined && (!old || table.sourceIndex !== table.index)) throw new Error("Invalid table provenance");
  const tokens = old ? rawTokens.get(old.index)! : undefined;
  const result = [old && old.maxRecords === table.maxRecords ? tokens![0] : String(table.maxRecords), tokens?.[1] ?? "0"];
  const used = new Set<number>();
  for (const field of table.fields) {
   if (field.source) {
    if (!old || field.source.tableIndex !== old.index || used.has(field.source.fieldIndex)) throw new Error("Invalid field provenance");
    const previous = old.fields[field.source.fieldIndex];
    if (!previous) throw new Error("Invalid field provenance");
    used.add(field.source.fieldIndex);
    if (![1, 2, 3, 4, 6, 7].includes(previous.typeCode) && (field.name !== previous.name || field.typeCode !== previous.typeCode || field.size !== previous.size)) throw new Error("Cannot edit unknown type code field");
    const raw = tokens!.slice(2 + field.source.fieldIndex * 3, 5 + field.source.fieldIndex * 3);
    result.push(field.name === previous.name ? raw[0] : esc(field.name), field.typeCode === previous.typeCode ? raw[1] : String(field.typeCode), field.size === previous.size ? raw[2] : String(field.size));
   } else {
    if (![1, 2, 3, 4, 6, 7].includes(field.typeCode)) throw new Error("Cannot add unknown type code field");
    result.push(esc(field.name), String(field.typeCode), String(field.size));
   }
  }
  return result.join(",");
 };
 const replacements = new Map<number, string>();
 for (const [id, entry] of db) {
  const table = intended.tables.find(t => t.index === id && t.sourceIndex === id);
  if (!table) { replacements.set(entry.schema!, ""); replacements.set(entry.alias!, ""); continue; }
  const schemaLine = lines[entry.schema!]; const aliasLine = lines[entry.alias!];
  replacements.set(entry.schema!, schemaLine.slice(0, schemaLine.indexOf("=") + 1) + value(table) + ending(schemaLine));
  const oldName = decodeEntities(Buffer.from(rawValue(aliasLine), "latin1").toString("utf8"));
  replacements.set(entry.alias!, aliasLine.slice(0, aliasLine.indexOf("=") + 1) + (oldName === table.name ? rawValue(aliasLine) : esc(table.name)) + ending(aliasLine));
 }
 const added = intended.tables.filter(t => t.sourceIndex === undefined);
 if (added.length) {
  const positions = [...db.values()].flatMap(e => [e.schema!, e.alias!]).sort((a, b) => a - b);
  let at: number;
  if (positions.length) {
   if (positions.some((p, i) => i > 0 && p !== positions[i - 1] + 1)) throw new Error("Ambiguous database block");
   at = positions[positions.length - 1] + 1;
  } else {
   // Unknown families are retained in place; use the first recognized later family.
   const afterDb = /^(?:(?:EDP|SP|SKT|LC|STRM|GFMT|NFMT|AUXFMT)\.[A-Z0-9.]+|SK\.OP|WDGT|GFMT|NFMT|AUXFMT)(?:#\d+)?=/;
   const first = lines.findIndex(line => afterDb.test(line));
   at = first < 0 ? lines.length : first;
  }
  const newline = lines[at]?.endsWith("\r\n") || (at > 0 && lines[at - 1].endsWith("\r\n")) ? "\r\n" : "\n";
  const separator = at > 0 && !lines[at - 1].endsWith("\n") ? newline : "";
  const insertion = separator + added.map(t => `DB.SCHEMA#${t.index}=${value(t)}${newline}DB.ALIAS#${t.index}=${esc(t.name)}${newline}`).join("");
  // Replacements index the original lines, so apply them before inserting.
  const patched = lines.map((l, i) => replacements.get(i) ?? l);
  patched.splice(at, 0, insertion);
  return finish(patched.join(""));
 }
 return finish(lines.map((l, i) => replacements.get(i) ?? l).join(""));

 function finish(nextBody: string): DbSavePlan | undefined {
  if (nextBody === body) { validateDbReadback(original, intended); return undefined; }
  if (readConfigHash(text) === undefined) throw new Error("Missing ConfigHash");
  const start = match.index! + "<Config>".length;
  const patched = text.slice(0, start) + nextBody + text.slice(start + body.length);
  const output = rewriteConfigHash(patched);
  if (readConfigHash(output) !== computeConfigHash(output)) throw new Error("ConfigHash post-check failed");
  const bytes = Buffer.from(output, "latin1");
  validateDbReadback(bytes, intended);
  return { bytes, model: createDbSchema(parseRev(bytes.toString("utf8"))), hashChanged: output !== patched };
 }
}
