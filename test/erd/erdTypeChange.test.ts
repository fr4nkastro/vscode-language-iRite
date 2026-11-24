import { describe, expect, it } from 'vitest';
import { ErdDraft } from '../../src/erd/erdDraft';
import { renderErdDraft } from '../../src/erd/erdDraftHtml';
import type { DbSchema } from '../../src/dbschema/model';

const schema: DbSchema = {reservedIndexes:[],tables:[{index:1,name:'Table1',maxRecords:1,fields:[{name:'Field1',typeCode:3,typeName:'integer',size:4}]}]};

describe('draft field type change', () => {
 it.each([[1,1],[6,20],[7,20]])('applies catalog default %i -> %i and allows later variable sizes', (code, expected) => {
  const draft=new ErdDraft(schema), table=draft.view().tables[0], field=table.fields[0];
  draft.apply({kind:'setField',table:table.key,field:field.key,property:'typeCode',value:String(code)});
  expect(draft.view().tables[0].fields[0].size).toBe(String(expected));
  expect(renderErdDraft(draft.view())).toMatch(code===1 ? /data-property="size"[^>]*readonly/ : /data-property="size"[^>]*value="20"(?![^>]*readonly)/);
  if (code===6 || code===7) {
   draft.apply({kind:'setField',table:table.key,field:field.key,property:'size',value:'37'});
   expect(draft.project().tables[0].fields[0].size).toBe(37);
  }
 });
});
