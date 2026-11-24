import { expect, it } from 'vitest';
import { ErdEditSession, projectSource } from '../../src/erd/erdEditSession';
import { createDbSchema } from '../../src/dbschema/model';
import { parseRev } from '../../src/rev';

function limitFile(tables: number, fields: number): Buffer {
 const schema = Array.from({length: fields}, (_, i) => `F${i},3,4`).join(',');
 const body = Array.from({length: tables}, (_, i) => `DB.SCHEMA#${i + 1}=1,0,${schema}\nDB.ALIAS#${i + 1}=T${i + 1}\n`).join('');
 return Buffer.from(`<Indicator><ConfigHash value="x"/><Config>\n${body}EDP.X#1=x\n</Config></Indicator>`);
}

function limitSession(bytes: Buffer) {
 let disk: Buffer = Buffer.from(bytes), confirms = 0, backups = 0, writes = 0;
 const session = new ErdEditSession(bytes, createDbSchema(parseRev(bytes.toString())), {
  read: () => disk, confirm: async () => { confirms++; return true; },
  backup: () => { backups++; }, write: data => { writes++; disk = data; },
 });
 session.editing = true;
 return { session, counts: () => [confirms, backups, writes], disk: () => disk };
}

it('only resolves links to a trusted project file and returns its stored spelling', () => {
 expect(projectSource(['project/main.iri'], 'project/./MAIN.iri')).toBe('project/main.iri');
 expect(projectSource(['project/main.iri'], 'project/other.iri')).toBeUndefined();
});

const original = Buffer.from('<Indicator><ConfigHash value="x"/><Config>\nDB.SCHEMA#1=10,0,A,3,4\nDB.ALIAS#1=T\nEDP.X#1=x\n</Config></Indicator>');

it('gates requests, acknowledges invalid input, and saves the edited schema through readback', async () => {
 let disk: Buffer = Buffer.from(original), backups = 0, writes = 0;
 const session = new ErdEditSession(original, createDbSchema(parseRev(original.toString())), {
  read: () => disk, confirm: async () => true, backup: () => { backups++; }, write: b => { writes++; disk = b; },
 });
 const edit = { type: 'edit', edit: { kind: 'updateTable', table: 1, name: 'New' } };
 expect((await session.request(edit)).message).toMatch(/disabled/i);
 session.editing = true;
 expect((await session.request({type:'edit', edit:{kind:'deleteTable',table:99}})).message).toMatch(/rejected/i);
 await session.request(edit);
 expect(session.model.tables[0].name).toBe('New');
 expect((await session.request({type:'save'})).saved).toBe(true);
 expect(disk.toString()).toContain('DB.ALIAS#1=New');
 expect([backups,writes]).toEqual([1,1]);
 expect(session.hint).toContain('New');
});

it('blocks invalid and concurrent saves and rejects disk drift after confirmation', async () => {
 let disk: Buffer = Buffer.from(original), writes = 0, backups = 0;
 let resolveConfirm!: (value: boolean) => void;
 const session = new ErdEditSession(original, createDbSchema(parseRev(original.toString())), {
  read: () => disk, confirm: () => new Promise(resolve => { resolveConfirm = resolve; }),
  backup: () => { backups++; }, write: b => { writes++; disk = b; },
 });
 session.editing = true;
 await session.request({type:'edit', edit:{kind:'updateTable',table:1,name:''}});
 expect((await session.request({type:'save'})).message).toMatch(/invalid/i);
 expect([writes,backups]).toEqual([0,0]);
 await session.request({type:'edit', edit:{kind:'updateTable',table:1,name:'New'}});
 const first = session.request({type:'save'});
 expect((await session.request({type:'save'})).message).toMatch(/disabled/i);
 disk = Buffer.from('external change'); resolveConfirm(true);
 expect((await first).message).toMatch(/changed on disk/i);
 expect([writes,backups]).toEqual([0,0]);
 expect(session.model.tables[0].name).toBe('New');
});

it('saves 100 fields and rejects 101 before confirmation, backup or write', async () => {
 for (const initial of [99, 100]) {
  const bytes = limitFile(1, initial), h = limitSession(bytes);
  expect((await h.session.request({type:'edit',edit:{kind:'addField',table:1,name:`F${initial}`,typeCode:3,size:4}})).message).toBeUndefined();
  const result = await h.session.request({type:'save'});
  if (initial === 99) {
   expect(result.saved).toBe(true); expect(h.counts()).toEqual([1,1,1]);
   expect(createDbSchema(parseRev(h.disk().toString())).tables[0].fields).toHaveLength(100);
  } else {
   expect(result.message).toMatch(/100 fields/); expect(h.counts()).toEqual([0,0,0]); expect(h.disk().equals(bytes)).toBe(true);
  }
 }
});

it('saves 128 tables and rejects 129 before confirmation, backup or write', async () => {
 for (const initial of [127, 128]) {
  const bytes = limitFile(initial, 1), h = limitSession(bytes);
  expect((await h.session.request({type:'edit',edit:{kind:'addTable',name:`T${initial + 1}`,maxRecords:1}})).message).toBeUndefined();
  expect((await h.session.request({type:'edit',edit:{kind:'addField',table:initial + 1,name:'F0',typeCode:3,size:4}})).message).toBeUndefined();
  const result = await h.session.request({type:'save'});
  if (initial === 127) {
   expect(result.saved).toBe(true); expect(h.counts()).toEqual([1,1,1]);
   expect(createDbSchema(parseRev(h.disk().toString())).tables).toHaveLength(128);
  } else {
   expect(result.message).toMatch(/128 tables/); expect(h.counts()).toEqual([0,0,0]); expect(h.disk().equals(bytes)).toBe(true);
  }
 }
});

it('rejects replacing a field or table while a legacy file remains above its count limit', async () => {
 for (const kind of ['field','table'] as const) {
  const bytes = kind === 'field' ? limitFile(1,101) : limitFile(129,1), h = limitSession(bytes);
  const edits = kind === 'field' ? [
   {kind:'deleteField',table:1,field:0}, {kind:'addField',table:1,name:'New',typeCode:3,size:4},
  ] : [
   {kind:'deleteTable',table:1}, {kind:'addTable',name:'New',maxRecords:1}, {kind:'addField',table:1,name:'F0',typeCode:3,size:4},
  ];
  for (const edit of edits) expect((await h.session.request({type:'edit',edit})).message).toBeUndefined();
  expect((await h.session.request({type:'save'})).message).toMatch(kind === 'field' ? /100 fields/ : /128 tables/);
  expect(h.counts()).toEqual([0,0,0]); expect(h.disk().equals(bytes)).toBe(true);
 }
});

it('allows naming blank UI additions when eight-character names already exist', async () => {
 const bytes = Buffer.from(original.toString().replace('DB.ALIAS#1=T', 'DB.ALIAS#1=NewTable').replace('A,3,4', 'NewField,3,4'));
 const h = limitSession(bytes);
 for (const edit of [
  {kind:'addField',table:1,name:'',typeCode:3,size:4},
  {kind:'updateField',table:1,field:1,changes:{name:'Field2'}},
  {kind:'addTable',name:'',maxRecords:1},
  {kind:'updateTable',table:2,name:'Table2'},
  {kind:'addField',table:2,name:'',typeCode:3,size:4},
  {kind:'updateField',table:2,field:0,changes:{name:'Field1'}},
 ]) expect((await h.session.request({type:'edit',edit})).message).toBeUndefined();
 expect((await h.session.request({type:'save'})).saved).toBe(true);
 expect(h.counts()).toEqual([1,1,1]);
});

it('retains the existing duplicate-alias rejection for an unchanged legacy file', async () => {
 const bytes = Buffer.from(limitFile(2, 1).toString().replace('DB.ALIAS#2=T2', 'DB.ALIAS#2=t1'));
 const h = limitSession(bytes);
 expect((await h.session.request({type:'save'})).message).toMatch(/duplicate name/i);
 expect(h.counts()).toEqual([0,0,0]); expect(h.disk().equals(bytes)).toBe(true);
});

it('disables future writes after an uncertain write', async () => {
 let writes = 0;
 const session = new ErdEditSession(original, createDbSchema(parseRev(original.toString())), {
  read: () => original, confirm: async () => true, backup: () => {}, write: () => { writes++; },
 });
 session.editing = true;
 await session.request({type:'edit', edit:{kind:'updateTable',table:1,name:'New'}});
 expect((await session.request({type:'save'})).message).toMatch(/post-check/i);
 expect(session.unusable).toBe(true);
 expect((await session.request({type:'save'})).message).toMatch(/disabled/i);
 expect(writes).toBe(1);
});
