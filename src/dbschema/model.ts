import type { RevDbField, RevModel } from "../rev";

/** Original positions address the decoded DB.SCHEMA tokens, even after reorder. */
export interface FieldSource { tableIndex: number; fieldIndex: number }
export interface DbField extends RevDbField { source?: FieldSource }
export interface DbTable { index: number; name: string; maxRecords: number; fields: DbField[]; sourceIndex?: number }
export interface DbSchema { tables: DbTable[]; reservedIndexes: number[] }
export type DbEdit =
 | { kind: "addTable"; name: string; maxRecords: number }
 | { kind: "deleteTable"; table: number }
 | { kind: "updateTable"; table: number; name?: string; maxRecords?: number }
 | { kind: "addField"; table: number; name: string; typeCode: number; size: number }
 | { kind: "deleteField"; table: number; field: number }
 | { kind: "moveField"; table: number; from: number; to: number }
 | { kind: "updateField"; table: number; field: number; changes: { name?: string; typeCode?: number; size?: number } };

const types: Record<number, RevDbField["typeName"]> = { 1: "integer", 2: "integer", 3: "integer", 4: "real", 6: "string", 7: "string" };
const observed: Record<number, number[]> = { 1: [1], 2: [2], 3: [4], 4: [4], 6: [19], 7: [7, 15, 16, 19, 20] };
// Structural and word operators from syntaxes/irite.tmLanguage; its math functions are not keywords.
const keywords = new Set("begin end for loop to while return var if else elsif then and exit is mod not of or record type function procedure program handler".split(" "));

/** Reject ambiguous input rather than assigning the wrong raw token provenance. */
export function createDbSchema(rev: RevModel): DbSchema {
 for (const e of rev.config) {
  if (/^DB\.(SCHEMA|ALIAS)#/.test(e.key)) throw new Error(`Malformed database entry ${e.key}`);
 }
 const entries = rev.config.filter(e => e.key === "DB.SCHEMA" || e.key === "DB.ALIAS");
 const keys = new Set<string>();
 for (const e of entries) {
  const key = `${e.key}#${e.index}`;
  if (e.index === undefined || !Number.isSafeInteger(e.index) || e.index < 1 || keys.has(key)) throw new Error(`Ambiguous database entry ${key}`);
  keys.add(key);
 }
 for (const e of entries) {
  if (!keys.has(`${e.key === "DB.SCHEMA" ? "DB.ALIAS" : "DB.SCHEMA"}#${e.index}`)) throw new Error(`Unpaired database entry #${e.index}`);
 }
 const tables = rev.databases.map(t => {
  const entry = entries.find(e => e.key === "DB.SCHEMA" && e.index === t.index);
  const tokens = entry?.value.split(",");
  if (!tokens || tokens.length !== 2 + t.fields.length * 3 || t.fields.some((f, i) => tokens[2 + i * 3] !== f.name || Number(tokens[3 + i * 3]) !== f.typeCode || Number(tokens[4 + i * 3]) !== f.size)) throw new Error(`Ambiguous database schema #${t.index}`);
  return { index: t.index, sourceIndex: t.index, name: t.name, maxRecords: t.maxRecords, fields: t.fields.map((f, fieldIndex) => ({ ...f, typeName: types[f.typeCode] ?? f.typeName, source: { tableIndex: t.index, fieldIndex } })) };
 });
 if (tables.length * 2 !== entries.length) throw new Error("Malformed database schemas");
 return { tables, reservedIndexes: entries.map(e => e.index as number) };
}

/** Immutable operations; deleting an unknown field/table deliberately deletes its raw tokens. */
export function editDbSchema(model: DbSchema, edit: DbEdit): DbSchema {
 const result: DbSchema = { reservedIndexes: [...model.reservedIndexes], tables: model.tables.map(t => ({ ...t, fields: t.fields.map(f => ({ ...f, source: f.source && { ...f.source } })) })) };
 if (edit.kind === "addTable") {
  let index = 1;
  while (result.tables.some(t => t.index === index)) index++;
  result.tables.push({ index, name: edit.name, maxRecords: edit.maxRecords, fields: [] });
  return result;
 }
 const pos = result.tables.findIndex(t => t.index === edit.table);
 if (pos < 0) throw new Error("Table not found");
 const table = result.tables[pos];
 if (edit.kind === "deleteTable") { result.tables.splice(pos, 1); return result; }
 if (edit.kind === "updateTable") { if (edit.name !== undefined) table.name = edit.name; if (edit.maxRecords !== undefined) table.maxRecords = edit.maxRecords; return result; }
 if (edit.kind === "addField") {
  if (!types[edit.typeCode]) throw new Error("Cannot add unknown type code");
  table.fields.push({ name: edit.name, typeCode: edit.typeCode, typeName: types[edit.typeCode], size: edit.size }); return result;
 }
 const fieldAt = (index: number): DbField => {
  if (!Number.isInteger(index) || index < 0 || index >= table.fields.length) throw new Error("Field not found");
  return table.fields[index];
 };
 if (edit.kind === "moveField") { fieldAt(edit.from); fieldAt(edit.to); table.fields.splice(edit.to, 0, table.fields.splice(edit.from, 1)[0]); return result; }
 const field = fieldAt(edit.field);
 if (edit.kind === "deleteField") { table.fields.splice(edit.field, 1); return result; }
 if (!types[field.typeCode] || (edit.changes.typeCode !== undefined && !types[edit.changes.typeCode])) throw new Error("Cannot edit unknown type code field or assign unknown type code");
 if (edit.changes.name !== undefined) field.name = edit.changes.name;
 if (edit.changes.size !== undefined) field.size = edit.changes.size;
 if (edit.changes.typeCode !== undefined) { field.typeCode = edit.changes.typeCode; field.typeName = types[field.typeCode]; }
 return result;
}

export function validateDbSchema(model: DbSchema): { errors: string[]; warnings: string[] } {
 const errors: string[] = [];
 const warnings = ["Database name lengths, field counts, record limits and device size rules are unconfirmed; validate in Revolution and on a test indicator before production."];
 const names = new Set<string>();
 const identifier = (name: string, what: string, seen: Set<string>) => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || keywords.has(name.toLowerCase())) errors.push(`${what}: invalid or missing iRite identifier`);
  const key = name.toLowerCase(); if (seen.has(key)) errors.push(`${what}: duplicate name`); seen.add(key);
 };
 const positive = (n: number, what: string) => { if (!Number.isSafeInteger(n) || n <= 0) errors.push(`${what} must be a positive safe integer`); };
 for (const t of model.tables) {
  identifier(t.name, `Table ${t.index}`, names); positive(t.maxRecords, `Table ${t.name} max records`);
  if (!t.fields.length) errors.push(`Table ${t.name} requires at least one field`);
  const fields = new Set<string>();
  for (const f of t.fields) {
   identifier(f.name, `Field ${t.name}.${f.name}`, fields); positive(f.size, `Field ${t.name}.${f.name} size`);
   if (!types[f.typeCode]) warnings.push(`Field ${t.name}.${f.name}: unknown type code preserved`);
   else if (!observed[f.typeCode].includes(f.size)) warnings.push(`Field ${t.name}.${f.name}: size combination is unconfirmed`);
  }
 }
 return { errors, warnings };
}
