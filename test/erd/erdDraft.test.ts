import { describe, it, expect } from 'vitest';
import { ErdDraft } from '../../src/erd/erdDraft';
import type { DbSchema } from '../../src/dbschema/model';

const base = (): DbSchema => ({reservedIndexes:[1], tables:[{index:1,sourceIndex:1,originalName:'Orders',originalMaxRecords:10,originalFieldCount:2,name:'Orders',maxRecords:10,fields:[{name:'Id',typeCode:3,typeName:'integer',size:4,source:{tableIndex:1,fieldIndex:0},originalName:'Id',originalTypeCode:3,originalSize:4},{name:'Text',typeCode:7,typeName:'string',size:20,source:{tableIndex:1,fieldIndex:1},originalName:'Text',originalTypeCode:7,originalSize:20}]}]});
describe('ErdDraft', () => {
 it('tracks stable keys, deletion, restore, reorder and undo', () => {
  const d = new ErdDraft(base()); const t = d.view().tables[0]; const [a,b] = t.fields;
  expect(d.view().count).toBe(0);
  d.apply({kind:'moveField',table:t.key,field:b.key,to:0});
  expect(d.project().tables[0].fields.map(f=>f.name)).toEqual(['Text','Id']);
  expect(d.view().count).toBeGreaterThan(0);
  d.apply({kind:'removeField',table:t.key,field:a.key});
  expect(d.project().tables[0].fields.map(f=>f.name)).toEqual(['Text']);
  d.apply({kind:'restoreField',table:t.key,field:a.key});
  d.apply({kind:'moveField',table:t.key,field:a.key,to:0});
  expect(d.view().count).toBe(0);
  d.apply({kind:'removeTable',table:t.key}); expect(d.project().tables).toHaveLength(0);
  d.apply({kind:'restoreTable',table:t.key}); expect(d.view().count).toBe(0);
 });
 it('validates raw numbers and locates actual validator issues without trusting input provenance', () => {
  const d = new ErdDraft(base()); const t=d.view().tables[0]; const f=t.fields[1];
  d.apply({kind:'setTable',table:t.key,property:'maxRecords',value:'10x'});
  d.apply({kind:'setField',table:t.key,field:f.key,property:'name',value:'Id'});
  d.apply({kind:'setField',table:t.key,field:f.key,property:'size',value:'256'});
  const v=d.view(); expect(v.issues.some(i=>i.table===t.key && i.property==='maxRecords')).toBe(true);
  expect(v.issues.some(i=>i.field===f.key && i.property==='name' && /duplicate/.test(i.message))).toBe(true);
  expect(v.issues.some(i=>i.field===f.key && i.property==='size')).toBe(true);
  expect(Number.isNaN(d.project().tables[0].maxRecords)).toBe(true);
 });
 it('uses catalog defaults and overflow-safe totals', () => {
  const d=new ErdDraft(base()); const t=d.view().tables[0]; const f=t.fields[1];
  d.apply({kind:'setField',table:t.key,field:f.key,property:'typeCode',value:'8'});
  expect(d.project().tables[0].fields[1].size).toBe(8);
  expect(d.view().budget).toMatchObject({tables:1,records:10,bytes:120});
  d.apply({kind:'setTable',table:t.key,property:'maxRecords',value:'9007199254740991'});
  expect(d.view().budget.bytes).toBeUndefined();
 });
 it('locates duplicate fields independently and counts edits without marking shifted survivors', () => {
  const d=new ErdDraft(base()); const t=d.view().tables[0]; const [a,b]=t.fields;
  d.apply({kind:'setField',table:t.key,field:b.key,property:'name',value:'Id'});
  d.apply({kind:'setTable',table:t.key,property:'name',value:'Sales'});
  expect(d.view().count).toBe(2);
  expect(d.view().issues.filter(i=>i.message.includes('duplicate')).map(i=>i.field)).toEqual([b.key]);
  d.apply({kind:'setField',table:t.key,field:b.key,property:'name',value:'Text'});
  d.apply({kind:'removeField',table:t.key,field:a.key});
  expect(d.view().count).toBe(2);
  expect(d.view().tables[0].fields[1].dirty).toBe(false);
 });
 it('adds and removes new entities without pending changes', () => {
  const d=new ErdDraft(base()); d.apply({kind:'addTable',name:'New',maxRecords:'1'}); const t=d.view().tables[1];
  d.apply({kind:'addField',table:t.key,name:'Value',typeCode:3});
  expect(d.project().tables[1].fields[0].size).toBe(4);
  d.apply({kind:'removeTable',table:t.key}); expect(d.view().count).toBe(0);
 });
});
