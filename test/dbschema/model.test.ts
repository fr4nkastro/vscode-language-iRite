import { describe, expect, it } from "vitest";
import { parseRev } from "../../src/rev";
import { createDbSchema, editDbSchema, validateDbSchema } from "../../src/dbschema/model";

const rev = () => parseRev('<Indicator><Config>\nDB.SCHEMA#2=0010,00,A,03,04,Mystery,99,007\nDB.ALIAS#2=Table_1\n</Config></Indicator>');

describe("database schema model", () => {
 it("maps observed type 1 on read and after type edits", () => {
  const parsed = createDbSchema(parseRev('<Indicator><Config>\nDB.SCHEMA#1=1,0,Weight,1,1\nDB.ALIAS#1=Weights\n</Config></Indicator>'));
  expect(parsed.tables[0].fields[0].typeName).toBe('integer');
  const changed = editDbSchema(parsed, { kind: 'updateField', table: 1, field: 0, changes: { typeCode: 3, size: 4 } });
  expect(changed.tables[0].fields[0].typeName).toBe('integer');
  expect(editDbSchema(changed, { kind: 'updateField', table: 1, field: 0, changes: { typeCode: 1, size: 1 } }).tables[0].fields[0].typeName).toBe('integer');
 });
 it('refuses malformed DB family keys', () => {
  for (const key of ['DB.SCHEMA#bad', 'DB.ALIAS#bad', 'DB.SCHEMA#', 'DB.ALIAS#1x']) {
   expect(() => createDbSchema(parseRev(`<Indicator><Config>\n${key}=x\n</Config></Indicator>`))).toThrow(/database/i);
  }
 });
 it('rejects case-insensitive reserved words in table and field names', () => {
  for (const name of ['begin', 'END', 'if', 'Type', 'procedure']) {
   const table = editDbSchema(createDbSchema(rev()), { kind: 'updateTable', table: 2, name });
   expect(validateDbSchema(table).errors.join(' ')).toMatch(/identifier/i);
   const field = editDbSchema(createDbSchema(rev()), { kind: 'updateField', table: 2, field: 0, changes: { name } });
   expect(validateDbSchema(field).errors.join(' ')).toMatch(/identifier/i);
  }
  expect(validateDbSchema(createDbSchema(rev())).errors).toEqual([]);
 });
 it("retains source identity through edits and reorder and rejects unknown-field edits/additions", () => {
  let m = createDbSchema(rev());
  m = editDbSchema(m, { kind: "moveField", table: 2, from: 1, to: 0 });
  m = editDbSchema(m, { kind: "updateField", table: 2, field: 1, changes: { name: "Renamed", size: 8 } });
  expect(m.tables[0].fields.map(f => f.source)).toEqual([{ tableIndex: 2, fieldIndex: 1 }, { tableIndex: 2, fieldIndex: 0 }]);
  expect(() => editDbSchema(m, { kind: "updateField", table: 2, field: 0, changes: { name: "No" } })).toThrow(/unknown/i);
  expect(() => editDbSchema(m, { kind: "addField", table: 2, name: "No", typeCode: 99, size: 1 })).toThrow(/unknown/i);
  m = editDbSchema(m, { kind: "deleteField", table: 2, field: 0 });
  expect(m.tables[0].fields).toHaveLength(1);
 });
 it("adds, edits and deletes tables and fields without changing original", () => {
  const base = createDbSchema(rev());
  let m = editDbSchema(base, { kind: "addTable", name: "New", maxRecords: 2 });
  expect(m.tables[1].index).toBe(1);
  m = editDbSchema(m, { kind: "addField", table: 1, name: "X", typeCode: 7, size: 20 });
  m = editDbSchema(m, { kind: "updateTable", table: 1, name: "New_2", maxRecords: 3 });
  m = editDbSchema(m, { kind: "deleteTable", table: 2 });
  expect(m.tables[0]).toMatchObject({ index: 1, name: "New_2", maxRecords: 3, fields: [{ name: "X" }] });
  expect(base.tables).toHaveLength(1);
 });
 it("reports identifier, duplicate, required and positive errors and unconfirmed warnings", () => {
  let m = createDbSchema(rev());
  m = editDbSchema(m, { kind: "updateTable", table: 2, name: "1bad", maxRecords: 0 });
  m = editDbSchema(m, { kind: "addField", table: 2, name: "a", typeCode: 7, size: 0 });
  let v = validateDbSchema(m);
  expect(v.errors.join(" ")).toMatch(/identifier/i);
  expect(v.errors.join(" ")).toMatch(/duplicate/i);
  expect(v.errors.join(" ")).toMatch(/positive/i);
  expect(v.warnings.join(" ")).toMatch(/unconfirmed/i);
  m = editDbSchema(createDbSchema(rev()), { kind: "addTable", name: "table_1", maxRecords: 1 });
  v = validateDbSchema(m);
  expect(v.errors.join(" ")).toMatch(/duplicate/i);
  expect(v.errors.join(" ")).toMatch(/at least one field/i);
 });
 it("warns for unobserved sizes but accepts observed code 1 and code 6", () => {
  let m = editDbSchema(createDbSchema(rev()), { kind: "addTable", name: "OK", maxRecords: 1 });
  m = editDbSchema(m, { kind: "addField", table: 1, name: "_one", typeCode: 1, size: 1 });
  m = editDbSchema(m, { kind: "addField", table: 1, name: "Two", typeCode: 6, size: 19 });
  expect(validateDbSchema(m).errors).toEqual([]);
  m = editDbSchema(m, { kind: "updateField", table: 1, field: 0, changes: { size: 2 } });
  expect(validateDbSchema(m).warnings.join(" ")).toMatch(/size.*unconfirmed/i);
 });
});
