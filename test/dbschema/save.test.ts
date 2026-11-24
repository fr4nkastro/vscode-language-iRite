import { describe, expect, it } from "vitest";
import { parseRev } from "../../src/rev";
import { createDbSchema, editDbSchema } from "../../src/dbschema/model";
import { planDbSave, validateDbReadback } from "../../src/dbschema/save";
import { computeConfigHash, formatHash, readConfigHash } from '../../src/rev/configHash';

const original = Buffer.from('\ufeff<Indicator>\r\n<ConfigHash value="stale"/>\r\n<Config>\r\nDB.SCHEMA#2=0010,00,A,03,04,Mystery,99,007\r\nDB.ALIAS#2=Table_1\r\nEDP.ADDRESS#1=x &amp; y\r\n</Config>\r\n</Indicator>', 'utf8');
const model = () => createDbSchema(parseRev(original.toString('utf8')));

describe('database save plan', () => {
 it('preserves legacy limits on no-op and rejects changed invalid input without changing bytes', () => {
  const bytes = Buffer.from(original.toString().replace('0010,00,A', '2000001,00,LegacyLong').replace('Table_1', 'LegacyTable'));
  const legacy = createDbSchema(parseRev(bytes.toString()));
  const snapshot = Buffer.from(bytes);
  expect(planDbSave(bytes, legacy)).toBeUndefined();
  for (const change of [{name:'TooLongName'}, {maxRecords:2000002}]) {
   const edited = editDbSchema(legacy, {kind:'updateTable',table:2,...change});
   expect(() => planDbSave(bytes, edited)).toThrow();
   expect(bytes.equals(snapshot)).toBe(true);
  }
 });
 it('preserves LF edited bytes and hashes the CRLF-normalized decoded Config', () => {
  const bytes = Buffer.from(original.toString('utf8').replace(/\r\n/g, '\n'));
  const m = editDbSchema(createDbSchema(parseRev(bytes.toString('utf8'))), { kind: 'updateTable', table: 2, name: 'Renamed' });
  const output = planDbSave(bytes, m)!.bytes;
  const text = output.toString('utf8');
  expect(text.replace(/<ConfigHash value="[^"]*"\/>/, '<ConfigHash value="stale"/>')).toBe(bytes.toString('utf8').replace('DB.ALIAS#2=Table_1', 'DB.ALIAS#2=Renamed'));
  expect(text).not.toContain('\r');
  const config = /<Config>([\s\S]*?)<\/Config>/.exec(text)![1].replace(/&amp;/g, '&').replace(/\n/g, '\r\n');
  expect(readConfigHash(output.toString('latin1'))).toBe(formatHash(config));
  expect(readConfigHash(output.toString('latin1'))).toBe(computeConfigHash(output.toString('latin1')));
  expect(() => validateDbReadback(output, m)).not.toThrow();
 });
 it('refuses malformed DB keys and reserved names without changing input bytes', () => {
  for (const key of ['DB.SCHEMA#bad', 'DB.ALIAS#bad']) {
   const bytes = Buffer.from(original.toString().replace('EDP.ADDRESS', `${key}=x\r\nEDP.ADDRESS`));
   const snapshot = Buffer.from(bytes);
   expect(() => planDbSave(bytes, model())).toThrow(/database/i);
   expect(bytes.equals(snapshot)).toBe(true);
  }
  const snapshot = Buffer.from(original);
  const m = editDbSchema(model(), { kind: 'updateTable', table: 2, name: 'begin' });
  expect(() => planDbSave(original, m)).toThrow(/identifier/i);
  expect(original.equals(snapshot)).toBe(true);
 });
 it('leaves a stale hash and all bytes untouched without edits', () => {
  expect(planDbSave(original, model())).toBeUndefined();
 });
 it('reorders exact triples and preserves all unrelated CRLF bytes', () => {
  const m = editDbSchema(model(), { kind: 'moveField', table: 2, from: 1, to: 0 });
  const plan = planDbSave(original, m)!;
  const text = plan.bytes.toString('utf8');
  expect(text.replace(/<ConfigHash value="[^"]*"\/>/, '<ConfigHash value="stale"/>')).toBe(original.toString('utf8').replace('A,03,04,Mystery,99,007', 'Mystery,99,007,A,03,04'));
  expect(() => validateDbReadback(plan.bytes, m)).not.toThrow();
  expect(() => validateDbReadback(original, m)).toThrow();
 });
 it('inserts multiple tables ahead of communication lines', () => {
  let m = model();
  for (const name of ['New', 'Other']) {
   m = editDbSchema(m, { kind: 'addTable', name, maxRecords: 5 });
   const index = m.tables[m.tables.length - 1].index;
   m = editDbSchema(m, { kind: 'addField', table: index, name: 'X', typeCode: 3, size: 4 });
  }
  const text = planDbSave(original, m)!.bytes.toString('utf8');
  expect(text).toContain('DB.SCHEMA#1=5,0,X,3,4\r\n');
  expect(text).toContain('DB.ALIAS#3=Other\r\nEDP.ADDRESS');
 });
 it('updates individual tokens, deletes tables and preserves unrelated pairs', () => {
  const bytes = Buffer.from(original.toString().replace('EDP.ADDRESS', 'DB.SCHEMA#4=20,0,Y,3,4\r\nDB.ALIAS#4=Keep\r\nEDP.ADDRESS'));
  let m = createDbSchema(parseRev(bytes.toString()));
  m = editDbSchema(m, { kind: 'updateTable', table: 2, name: 'Renamed', maxRecords: 11 });
  m = editDbSchema(m, { kind: 'updateField', table: 2, field: 0, changes: { name: 'B' } });
  const text = planDbSave(bytes, m)!.bytes.toString();
  expect(text).toContain('DB.SCHEMA#2=11,00,B,03,04,Mystery,99,007\r\nDB.ALIAS#2=Renamed\r\nDB.SCHEMA#4=20,0,Y,3,4\r\nDB.ALIAS#4=Keep\r\n');
  m = editDbSchema(m, { kind: 'deleteTable', table: 2 });
  const removed = planDbSave(bytes, m)!.bytes.toString();
  expect(removed).not.toContain('DB.SCHEMA#2=');
  expect(removed).not.toContain('DB.ALIAS#2=');
  expect(removed).toContain('DB.SCHEMA#4=20,0,Y,3,4\r\nDB.ALIAS#4=Keep\r\n');
 });
 it('inserts interleaved pairs before the first proven port when no DB exists', () => {
  const bytes = Buffer.from('<Indicator><ConfigHash value="x"/><Config>\r\nDIO.X#1=x\r\nEDP.ADDRESS#1=x\r\n</Config></Indicator>');
  let m = createDbSchema(parseRev(bytes.toString()));
  m = editDbSchema(m, { kind: 'addTable', name: 'New', maxRecords: 1 });
  m = editDbSchema(m, { kind: 'addField', table: 1, name: 'X', typeCode: 3, size: 4 });
  const plan = planDbSave(bytes, m)!;
  expect(plan.bytes.toString()).toContain('DIO.X#1=x\r\nDB.SCHEMA#1=1,0,X,3,4\r\nDB.ALIAS#1=New\r\nEDP.ADDRESS#1=x');
  expect(() => validateDbReadback(plan.bytes, m)).not.toThrow();
 });
 it('places the first database before widgets or at the end of a proven preceding or empty Config', () => {
  for (const [body, expected] of [
   ['\r\nDIO.X#1=x\r\nWDGT#1=4,x\r\n', '\r\nDIO.X#1=x\r\nDB.SCHEMA#1=1,0,X,3,4\r\nDB.ALIAS#1=New\r\nWDGT#1=4,x\r\n'],
   ['\nDIO.X#1=x\n', '\nDIO.X#1=x\nDB.SCHEMA#1=1,0,X,3,4\nDB.ALIAS#1=New\n'],
   ['', 'DB.SCHEMA#1=1,0,X,3,4\nDB.ALIAS#1=New\n'],
   ['\r\n', '\r\nDB.SCHEMA#1=1,0,X,3,4\r\nDB.ALIAS#1=New\r\n'],
  ]) {
   const bytes = Buffer.from(`<Indicator><ConfigHash value="x"/><Config>${body}</Config></Indicator>`);
   let m = createDbSchema(parseRev(bytes.toString()));
   m = editDbSchema(m, { kind: 'addTable', name: 'New', maxRecords: 1 });
   m = editDbSchema(m, { kind: 'addField', table: 1, name: 'X', typeCode: 3, size: 4 });
   expect(planDbSave(bytes, m)!.bytes.toString()).toContain(`<Config>${expected}</Config>`);
  }
 });
 it('inserts before later families in a realistic CRLF Config and falls back to the end', () => {
  for (const [body, boundary] of [
   ['DISPLAY.X#1=x\r\nSC.X#1=x\r\nDIO.X#1=x\r\nEDP.X#1=x\r\nSKT.TEXT#1=x\r\nSK.OP#1=x\r\nGFMT#1=x\r\nNFMT#1=x\r\nLC.X#1=x\r\n', 'EDP.X#1=x'],
   ['DISPLAY.X#1=x\r\nSKT.TEXT#1=x\r\nSK.OP#1=x\r\nGFMT#1=x\r\nNFMT#1=x\r\nLC.X#1=x\r\n', 'SKT.TEXT#1=x'],
   ['DISPLAY.X#1=x\r\nSTRM.CUSTOM#1=x\r\n', 'STRM.CUSTOM#1=x'],
   ['DISPLAY.X#1=x\r\nGFMT.PRN=2\r\n', 'GFMT.PRN=2'],
   ['DISPLAY.X#1=x\r\nSK.OP#1=x\r\n', 'SK.OP#1=x'],
   ['DISPLAY.X#1=x\r\nUNKNOWN#1=x\r\n', ''],
  ]) {
   const bytes = Buffer.from(`<Indicator><ConfigHash value="x"/><Config>\r\n${body}</Config></Indicator>`);
   let m = createDbSchema(parseRev(bytes.toString()));
   m = editDbSchema(m, {kind:'addTable',name:'New',maxRecords:1});
   m = editDbSchema(m, {kind:'addField',table:1,name:'X',typeCode:3,size:4});
   const output = planDbSave(bytes, m)!.bytes.toString();
   expect(output).toContain(`DB.SCHEMA#1=1,0,X,3,4\r\nDB.ALIAS#1=New\r\n${boundary || '</Config>'}`);
   expect(() => validateDbReadback(Buffer.from(output), m)).not.toThrow();
  }
 });
 it('preserves unknown families before a following widget', () => {
  const bytes = Buffer.from('<Indicator><ConfigHash value="x"/><Config>\nUNKNOWN#1=x\nWDGT#1=4,x\n</Config></Indicator>');
  let m = createDbSchema(parseRev(bytes.toString()));
  m = editDbSchema(m, { kind: 'addTable', name: 'New', maxRecords: 1 });
  m = editDbSchema(m, { kind: 'addField', table: 1, name: 'X', typeCode: 3, size: 4 });
  expect(planDbSave(bytes, m)!.bytes.toString()).toContain('UNKNOWN#1=x\nDB.SCHEMA#1=1,0,X,3,4\nDB.ALIAS#1=New\nWDGT#1=4,x');
 });
 it('appends after unknown families and rejects duplicate DB entries', () => {
  const empty = Buffer.from('<Indicator><ConfigHash value="x"/><Config>\nUNKNOWN#1=x\n</Config></Indicator>');
  let m = createDbSchema(parseRev(empty.toString()));
  m = editDbSchema(m, { kind: 'addTable', name: 'New', maxRecords: 1 });
  m = editDbSchema(m, { kind: 'addField', table: 1, name: 'X', typeCode: 3, size: 4 });
  expect(planDbSave(empty, m)!.bytes.toString()).toContain('UNKNOWN#1=x\nDB.SCHEMA#1=1,0,X,3,4\nDB.ALIAS#1=New\n</Config>');
  const duplicate = Buffer.from(original.toString().replace('DB.ALIAS#2=Table_1', 'DB.ALIAS#2=Table_1\r\nDB.ALIAS#2=Table_1'));
  expect(() => planDbSave(duplicate, model())).toThrow();
 });
});
