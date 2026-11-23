import { describe, it, expect } from 'vitest';
import { parseDbMessage } from '../../src/dbschema/messages';
import { renderDbHtml } from '../../src/dbschema/webview';
import { dbIriHint } from '../../src/dbschema/iriHint';
import { createDbSchema } from '../../src/dbschema/model';
import { parseRev } from '../../src/rev';
const model = createDbSchema(parseRev('<Indicator><Config>\nDB.SCHEMA#1=10,0,A,3,4,Mystery,99,7\nDB.ALIAS#1=T\n</Config></Indicator>'));
describe('database editor interface', () => {
 it('validates messages and rejects unknown field edits and invalid indices', () => {
  expect(parseDbMessage({type:'save'}, model)).toEqual({type:'save'});
  expect(parseDbMessage({type:'edit',edit:{kind:'updateField',table:1,field:1,changes:{name:'X'}}}, model)).toBeUndefined();
  expect(parseDbMessage({type:'edit',edit:{kind:'deleteField',table:1,field:5}}, model)).toBeUndefined();
  expect(parseDbMessage({type:'edit',edit:{kind:'updateTable',table:1,name:'New'}}, model)).toBeDefined();
 });
 it('renders escaped data with restrictive CSP and unknown types', () => {
  const m = {...model,tables:model.tables.map(t=>({...t,name:'<img src=x onerror=alert(1)>'}))};
  const html = renderDbHtml(m, 'abc', '');
  expect(html).toContain("default-src 'none'"); expect(html).not.toContain('<img src=x'); expect(html).toContain('99');
 });
 it('shows exact known types and never guesses an unknown type', () => {
  const hint = dbIriHint(model);
  expect(hint).toContain('type TDatabase is database ("T")'); expect(hint).toContain('A: integer;');
  expect(hint).toContain('T_A : constant integer := 1;'); expect(hint).toContain('unknown');
  expect(hint).not.toContain('Mystery: integer;'); expect(hint).toContain('T_Mystery : constant integer := 2;');
  expect(dbIriHint({...model, tables: model.tables.map(t => ({...t, fields: [{name:'S',typeCode:7,typeName:'string',size:20}]}))})).toContain('S: string[20];');
 });
});
