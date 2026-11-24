import type { RevDbField, RevModel } from "../rev";
import { editableFieldType } from './fieldTypes';
import { MAX_TABLES, MAX_FIELDS, MAX_RECORDS, MAX_STRING_SIZE } from './limits';

/** Original positions address the decoded DB.SCHEMA tokens, even after reorder. */
export interface FieldSource { tableIndex: number; fieldIndex: number }
export interface DbField extends RevDbField { source?: FieldSource; originalTypeCode?: number; originalSize?: number; originalName?: string }
export interface DbTable { index: number; name: string; maxRecords: number; fields: DbField[]; sourceIndex?: number; originalName?: string; originalMaxRecords?: number; originalFieldCount?: number }
export interface DbSchema { tables: DbTable[]; reservedIndexes: number[]; originalTableCount?: number }
export type DbEdit =
 | { kind: "addTable"; name: string; maxRecords: number }
 | { kind: "deleteTable"; table: number }
 | { kind: "updateTable"; table: number; name?: string; maxRecords?: number }
 | { kind: "addField"; table: number; name: string; typeCode: number; size: number }
 | { kind: "deleteField"; table: number; field: number }
 | { kind: "moveField"; table: number; from: number; to: number }
 | { kind: "updateField"; table: number; field: number; changes: { name?: string; typeCode?: number; size?: number } };

const typeName = (code: number): RevDbField['typeName'] => {
 const t = editableFieldType(code)?.iriteType;
 return t === 'integer' || t === 'real' || t === 'string' ? t : 'unknown';
};
const observed: Record<number, number[]> = { 1: [1], 2: [2], 3: [4], 4: [4], 6: [19], 7: [7, 15, 16, 19, 20] };
// Structural and word operators from syntaxes/irite.tmLanguage; its math functions are not keywords.
const keywords = new Set("and array begin builtin constant database datetime else elsif end exit for function handler if integer is loop mod not of or program real record return step string then to type var while procedure".split(" "));

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
  return { index: t.index, sourceIndex: t.index, name: t.name, maxRecords: t.maxRecords, originalName: t.name, originalMaxRecords: t.maxRecords, originalFieldCount: t.fields.length, fields: t.fields.map((f, fieldIndex) => ({ ...f, typeName: typeName(f.typeCode), originalName: f.name, originalTypeCode: f.typeCode, originalSize: f.size, source: { tableIndex: t.index, fieldIndex } })) };
 });
 if (tables.length * 2 !== entries.length) throw new Error("Malformed database schemas");
 return { tables, reservedIndexes: entries.map(e => e.index as number), originalTableCount: tables.length };
}

/** Immutable operations; deleting an unknown field/table deliberately deletes its raw tokens. */
export function editDbSchema(model: DbSchema, edit: DbEdit): DbSchema {
 const result: DbSchema = { originalTableCount: model.originalTableCount, reservedIndexes: [...model.reservedIndexes], tables: model.tables.map(t => ({ ...t, fields: t.fields.map(f => ({ ...f, source: f.source && { ...f.source } })) })) };
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
  if (!editableFieldType(edit.typeCode)) throw new Error("Cannot add unknown type code");
  table.fields.push({ name: edit.name, typeCode: edit.typeCode, typeName: typeName(edit.typeCode), size: edit.size }); return result;
 }
 const fieldAt = (index: number): DbField => {
  if (!Number.isInteger(index) || index < 0 || index >= table.fields.length) throw new Error("Field not found");
  return table.fields[index];
 };
 if (edit.kind === "moveField") { fieldAt(edit.from); fieldAt(edit.to); table.fields.splice(edit.to, 0, table.fields.splice(edit.from, 1)[0]); return result; }
 const field = fieldAt(edit.field);
 if (edit.kind === "deleteField") { table.fields.splice(edit.field, 1); return result; }
 if (!editableFieldType(field.typeCode) || (edit.changes.typeCode !== undefined && !editableFieldType(edit.changes.typeCode))) throw new Error("Cannot edit unknown type code field or assign unknown type code");
 if (edit.changes.name !== undefined) field.name = edit.changes.name;
 const changedType = edit.changes.typeCode !== undefined && edit.changes.typeCode !== field.typeCode;
 if (edit.changes.size !== undefined) field.size = edit.changes.size;
 if (changedType) { field.typeCode = edit.changes.typeCode!; field.typeName = typeName(field.typeCode); const type = editableFieldType(field.typeCode)!; field.size = type.variable && edit.changes.size !== undefined ? edit.changes.size : type.defaultSize; }
 return result;
}

export interface DbSchemaIssue { severity: 'error' | 'warning'; message: string; table?: number; field?: number; property?: 'name' | 'maxRecords' | 'size' | 'typeCode' | 'fields' }
export function validateDbSchema(model: DbSchema, baseline?: DbSchema, sink?: (issue: DbSchemaIssue) => void): { errors: string[]; warnings: string[] } {
 const errors: string[] = [];
 const warnings: string[] = [];
 type Location = Pick<DbSchemaIssue, 'table' | 'field' | 'property'>;
 const emit = (severity: DbSchemaIssue['severity'], message: string, location: Location = {}) => { (severity === 'error' ? errors : warnings).push(message); sink?.({severity, message, table: location.table, field: location.field, property: location.property}); };
 emit('warning', "Firmware enforcement, storage overhead and per-table memory limits are unconfirmed; validate in Revolution and on a test indicator before production.");
 const names = new Set<string>();
 const identifier = (name: string, what: string, seen: Set<string>, unchanged: boolean, location: Location) => {
  if (!unchanged && (!/^[A-Za-z_][A-Za-z0-9_]{0,7}$/.test(name) || /[\r\n]/.test(name) || keywords.has(name.toLowerCase()))) emit('error', `${what}: invalid or missing iRite identifier (maximum 8 ASCII characters)`, location);
  const key = name.toLowerCase(); if (seen.has(key)) emit('error', `${what}: duplicate name`, location); seen.add(key);
 };
 const positive = (n: number, what: string, location: Location) => { if (!Number.isSafeInteger(n) || n <= 0) emit('error', `${what} must be a positive safe integer`, location); };
 if (model.tables.length > MAX_TABLES && (model.tables.length > (baseline?.tables.length ?? model.originalTableCount ?? 0) || model.tables.some(t => t.sourceIndex === undefined))) emit('error', 'Database exceeds 128 tables');
 for (const [tablePosition, t] of model.tables.entries()) {
  const old = baseline && t.sourceIndex === t.index ? baseline.tables.find(table => table.index === t.index) : undefined;
  const oldName = baseline ? old?.name : t.sourceIndex === t.index ? t.originalName : undefined;
  const oldMax = baseline ? old?.maxRecords : t.sourceIndex === t.index ? t.originalMaxRecords : undefined;
  identifier(t.name, `Table ${t.index}`, names, oldName !== undefined && t.name === oldName, {table: tablePosition, property: 'name'});
  const recordsLocation: Location = {table: tablePosition, property: 'maxRecords'};
  if (t.maxRecords !== oldMax) { positive(t.maxRecords, `Table ${t.name} max records`, recordsLocation); if (t.maxRecords > MAX_RECORDS) emit('error', `Table ${t.name} max records exceeds 2000000`, recordsLocation); }
  const fieldsLocation: Location = {table: tablePosition, property: 'fields'};
  if (t.fields.length > MAX_FIELDS && (t.fields.length > (baseline ? old?.fields.length ?? 0 : t.originalFieldCount ?? 0) || t.fields.some(f => !f.source))) emit('error', `Table ${t.name} exceeds 100 fields`, fieldsLocation);
  if (!t.fields.length) emit('error', `Table ${t.name} requires at least one field`, fieldsLocation);
  const fields = new Set<string>();
  for (const [fieldPosition, f] of t.fields.entries()) {
   const previous = baseline && old && f.source?.tableIndex === old.index ? old.fields[f.source.fieldIndex] : undefined;
   const oldFieldName = baseline ? previous?.name : f.source?.tableIndex === t.sourceIndex ? f.originalName : undefined;
   identifier(f.name, `Field ${t.name}.${f.name}`, fields, oldFieldName !== undefined && f.name === oldFieldName, {table: tablePosition, field: fieldPosition, property: 'name'});
   const type = editableFieldType(f.typeCode);
   const untouched = f.source && f.typeCode === (baseline ? previous?.typeCode : f.originalTypeCode) && f.size === (baseline ? previous?.size : f.originalSize);
   if (!type) emit('warning', `Field ${t.name}.${f.name}: unknown type code preserved`, {table: tablePosition, field: fieldPosition, property: 'typeCode'});
   else {
    const sizeLocation: Location = {table: tablePosition, field: fieldPosition, property: 'size'};
    const valid = Number.isSafeInteger(f.size) && (type.variable ? f.size > 0 && f.size <= MAX_STRING_SIZE : f.size === type.defaultSize);
    if (!valid && !untouched) emit('error', `Field ${t.name}.${f.name} size ${type.variable ? 'must be a positive integer up to 255 (extension policy; designer maximum 255)' : `must be ${type.defaultSize}`}`, sizeLocation);
    if (!valid || (observed[f.typeCode] && !observed[f.typeCode].includes(f.size))) emit('warning', `Field ${t.name}.${f.name}: size combination is unconfirmed`, sizeLocation);
   }
  }
 }
 return { errors, warnings };
}
