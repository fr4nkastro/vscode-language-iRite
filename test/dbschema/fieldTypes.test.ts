import { describe, expect, it } from 'vitest';
import { parseRev } from '../../src/rev';
import { createDbSchema, editDbSchema, validateDbSchema } from '../../src/dbschema/model';
import { dbIriHint } from '../../src/dbschema/iriHint';
import { planDbSave } from '../../src/dbschema/save';
import { buildErd } from '../../src/erd/erdModel';
import { renderErdHtml } from '../../src/erd/erdHtml';
import { ErdDraft } from '../../src/erd/erdDraft';
import { renderErdDraft } from '../../src/erd/erdDraftHtml';
import { erdToMermaid } from '../../src/erd/erdMermaid';
import { renderDbHtml } from '../../src/dbschema/webview';
import { editableFieldType, fieldType, iriteFieldType } from '../../src/dbschema/fieldTypes';
import { saveDatabase } from '../../src/dbschema/workflow';

const bytes = Buffer.from('<Indicator><ConfigHash value="stale"/><Config>\nDB.SCHEMA#1=10,0,A,3,4,Odd,7,300,Zero,0,0,Raw,99,7\nDB.ALIAS#1=Data\n</Config></Indicator>');
const model = () => createDbSchema(parseRev(bytes.toString()));

describe('designer database field types', () => {
 it('looks up designer names, default sizes, fixed rules and iRite types', () => {
  const expected = [
   [0, 'None', undefined, 0, false], [1, 'Byte', 'integer', 1, false],
   [2, 'Short Integer', 'integer', 2, false], [3, 'Long Integer', 'integer', 4, false],
   [4, 'Single Precision Real', 'real', 4, false], [5, 'Double Precision Real', 'real', 8, false],
   [6, 'Fixed Length String', 'string', 20, true], [7, 'Variable Length String', 'string', 20, true],
   [8, 'DateTime', 'DateTime', 8, false],
  ] as const;
  for (const [code, name, iriteType, defaultSize, variable] of expected) {
   expect(fieldType(code)).toEqual({code, name, iriteType, defaultSize, variable});
   expect(editableFieldType(code)).toEqual(code === 0 ? undefined : fieldType(code));
   expect(iriteFieldType(code, 15)).toBe(iriteType === 'string' ? 'string[15]' : iriteType);
  }
  expect(fieldType(99)).toBeUndefined();
  expect(editableFieldType(99)).toBeUndefined();
  expect(iriteFieldType(99, 15)).toBeUndefined();
 });
 it('supports all editable types, defaults on change and iRite hints', () => {
  const expected = [[1,1,'integer'],[2,2,'integer'],[3,4,'integer'],[4,4,'real'],[5,8,'real'],[6,20,'string[20]'],[7,20,'string[20]'],[8,8,'DateTime']] as const;
  for (const [code, size, type] of expected) {
   const changed = editDbSchema(model(), {kind:'updateField',table:1,field:0,changes:{typeCode:code === 3 ? 1 : code}});
   const final = code === 3 ? editDbSchema(changed, {kind:'updateField',table:1,field:0,changes:{typeCode:3}}) : changed;
   expect(final.tables[0].fields[0].size).toBe(size);
   expect(dbIriHint(final)).toContain(`A: ${type};`);
  }
  for (const code of [0,99]) expect(() => editDbSchema(model(), {kind:'addField',table:1,name:'X',typeCode:code,size:1})).toThrow();
  for (const field of [2,3]) expect(() => editDbSchema(model(), {kind:'updateField',table:1,field,changes:{name:'X'}})).toThrow();
 });
 it('preserves untouched unusual values and rejects invalid new sizes', () => {
  expect(planDbSave(bytes, model())).toBeUndefined();
  const renamed = editDbSchema(model(), {kind:'updateTable',table:1,name:'Renamed'});
  expect(planDbSave(bytes, renamed)!.bytes.toString()).toContain('Odd,7,300,Zero,0,0,Raw,99,7');
  for (const size of [0,256]) {
   const changed = editDbSchema(model(), {kind:'addField',table:1,name:'New',typeCode:7,size});
   expect(validateDbSchema(changed).errors.join(' ')).toMatch(/size/i);
   expect(() => planDbSave(bytes, changed)).toThrow();
  }
  const fixed = editDbSchema(model(), {kind:'addField',table:1,name:'New',typeCode:5,size:7});
  expect(validateDbSchema(fixed).errors.join(' ')).toMatch(/size/i);
 });
 it('enforces the extension positive-size policy and designer cap on changed string sizes before persistence', async () => {
  for (const code of [6, 7]) for (const size of [-1, 0, 1, 255, 256]) {
   let disk = Buffer.from(bytes), backups = 0, writes = 0, confirms = 0;
   const changedType = editDbSchema(model(), {kind:'updateField',table:1,field:0,changes:{typeCode:code}});
   const changed = editDbSchema(changedType, {kind:'updateField',table:1,field:0,changes:{size}});
   const io = { read: () => disk, confirm: async () => { confirms++; return true; }, backup: () => { backups++; }, write: (next: Buffer) => { writes++; disk = Buffer.from(next); } };
   if (size <= 0 || size > 255) {
    expect(validateDbSchema(changed).errors.join(' ')).toContain('positive integer up to 255 (extension policy; designer maximum 255)');
    await expect(saveDatabase(bytes, changed, io)).rejects.toThrow(/size/);
    expect([confirms, backups, writes]).toEqual([0, 0, 0]);
    expect(disk.equals(bytes)).toBe(true);
   } else {
    expect(validateDbSchema(changed).errors).toEqual([]);
    await expect(saveDatabase(bytes, changed, io)).resolves.toBeDefined();
    expect([confirms, backups, writes]).toEqual([1, 1, 1]);
    expect(disk.toString()).toContain(`A,${code},${size},Odd,7,300,Zero,0,0,Raw,99,7`);
   }
  }
 });
 it('keeps every byte on an unchanged persistence request', async () => {
  let disk = Buffer.from(bytes), backups = 0, writes = 0;
  const before = Buffer.from(disk);
  expect(await saveDatabase(bytes, model(), {read: () => disk, confirm: async () => true, backup: () => { backups++; }, write: next => { writes++; disk = Buffer.from(next); }})).toBeUndefined();
  expect(disk.equals(before)).toBe(true);
  expect([backups, writes]).toEqual([0, 0]);
 });
 it('escapes untrusted field and table text in both editor HTML surfaces', () => {
  const draft = model();
  draft.tables[0].name = '<img src=x onerror="x">';
  draft.tables[0].fields[0].name = '\"><script>alert(1)</script>&';
  const editor = renderErdDraft(new ErdDraft(draft).view());
  const legacy = renderDbHtml(draft, 'abc', '<script>hint</script>');
  for (const html of [editor, legacy]) {
   expect(html).not.toContain('<img src=x');
   expect(html).not.toContain('<script>alert(1)</script>');
   expect(html).not.toContain('<script>hint</script>');
   expect(html).toContain('&lt;img src=x onerror=&quot;x&quot;&gt;');
   expect(html).toContain('&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;&amp;');
  }
  // The draft fragment has no hint; the separate legacy surface still renders it.
  expect(legacy).toContain('&lt;script&gt;hint&lt;/script&gt;');
 });
 it('shows named types in editable and read-only views and Mermaid while escaping', () => {
  const edit = renderErdDraft(new ErdDraft(model()).view());
  expect(edit).toContain('Long Integer');
  expect(edit).toContain('Double Precision Real');
  expect(edit).toContain('DateTime');
  expect(edit).toContain('Unknown (0)');
  expect(edit).toContain('Unknown (99)');
  const legacy = renderDbHtml(model(), 'abc', '<hint>');
  expect(legacy).toContain('Double Precision Real');
  expect(legacy).toContain('None (raw type 0)');
  expect(legacy).toContain('&lt;hint&gt;');
  const erd = buildErd(undefined, parseRev(bytes.toString()));
  const html = renderErdHtml(erd, {cspSource:'vscode:',nonce:'abc',title:'<x>'});
  expect(html).toContain('Long Integer');
  expect(html).toContain('&lt;x&gt;');
  expect(html).toContain("script-src 'nonce-abc'");
  expect(erdToMermaid(erd)).toContain('Long_Integer A');
 });
});
