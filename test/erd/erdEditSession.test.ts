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
 const edit = { type: 'draft-action', action: { kind: 'setTable', table: session.view.tables[0].key, property: 'name', value: 'New' } };
 expect((await session.request(edit)).message).toMatch(/disabled/i);
 session.editing = true;
 expect((await session.request({type:'draft-action', action:{kind:'removeTable',table:'draft-999'}})).message).toMatch(/rejected/i);
 expect((await session.request({type:'edit', edit:{kind:'updateTable',table:1,name:'Unsafe'}})).message).toMatch(/rejected/i);
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
 await session.request({type:'draft-action', action:{kind:'setTable',table:session.view.tables[0].key,property:'name',value:''}});
 expect((await session.request({type:'save'})).message).toMatch(/invalid/i);
 expect([writes,backups]).toEqual([0,0]);
 await session.request({type:'draft-action', action:{kind:'setTable',table:session.view.tables[0].key,property:'name',value:'New'}});
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
  expect((await h.session.request({type:'draft-action',action:{kind:'addField',table:h.session.view.tables[0].key,name:`F${initial}`,typeCode:3}})).message).toBeUndefined();
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
  expect((await h.session.request({type:'draft-action',action:{kind:'addTable',name:`T${initial + 1}`,maxRecords:'1'}})).message).toBeUndefined();
  expect((await h.session.request({type:'draft-action',action:{kind:'addField',table:h.session.view.tables.at(-1)!.key,name:'F0',typeCode:3}})).message).toBeUndefined();
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
  const table = h.session.view.tables[0];
  const action = async (action: object) => expect((await h.session.request({type:'draft-action',action})).message).toBeUndefined();
  if (kind === 'field') {
   await action({kind:'removeField',table:table.key,field:table.fields[0].key});
   await action({kind:'addField',table:table.key,name:'New',typeCode:3});
  } else {
   await action({kind:'removeTable',table:table.key});
   await action({kind:'addTable',name:'New',maxRecords:'1'});
   await action({kind:'addField',table:h.session.view.tables.at(-1)!.key,name:'F0',typeCode:3});
  }
  expect((await h.session.request({type:'save'})).message).toMatch(kind === 'field' ? /100 fields/ : /128 tables/);
  expect(h.counts()).toEqual([0,0,0]); expect(h.disk().equals(bytes)).toBe(true);
 }
});

it('allows naming blank UI additions when eight-character names already exist', async () => {
 const bytes = Buffer.from(original.toString().replace('DB.ALIAS#1=T', 'DB.ALIAS#1=NewTable').replace('A,3,4', 'NewField,3,4'));
 const h = limitSession(bytes);
 const action = async (action: object) => expect((await h.session.request({type:'draft-action',action})).message).toBeUndefined();
 const first = h.session.view.tables[0].key;
 await action({kind:'addField',table:first,name:'',typeCode:3});
 await action({kind:'setField',table:first,field:h.session.view.tables[0].fields.at(-1)!.key,property:'name',value:'Field2'});
 await action({kind:'addTable',name:'',maxRecords:'1'});
 const second = h.session.view.tables.at(-1)!.key;
 await action({kind:'setTable',table:second,property:'name',value:'Table2'});
 await action({kind:'addField',table:second,name:'',typeCode:3});
 await action({kind:'setField',table:second,field:h.session.view.tables.at(-1)!.fields[0].key,property:'name',value:'Field1'});
 expect((await h.session.request({type:'save'})).saved).toBe(true);
 expect(h.counts()).toEqual([1,1,1]);
});

it('retains the existing duplicate-alias rejection for an unchanged legacy file', async () => {
 const bytes = Buffer.from(limitFile(2, 1).toString().replace('DB.ALIAS#2=T2', 'DB.ALIAS#2=t1'));
 const h = limitSession(bytes);
 expect((await h.session.request({type:'save'})).message).toMatch(/duplicate name/i);
 expect(h.counts()).toEqual([0,0,0]); expect(h.disk().equals(bytes)).toBe(true);
});

it('validates raw intent, preserves it across cancellation, and discards without writes', async () => {
 const h = limitSession(original);
 const table = h.session.view.tables[0].key;
 expect((await h.session.request({type:'draft-action',action:{kind:'setTable',table,property:'name',value:''}})).message).toBeUndefined();
 expect(h.session.view.issues.some(i => i.severity === 'error')).toBe(true);
 expect((await h.session.request({type:'save'})).message).toBeTruthy();
 expect(h.counts()).toEqual([0,0,0]);
 expect(h.session.hasChanges).toBe(true);
 expect((await h.session.request({type:'draft-discard'})).message).toBeUndefined();
 expect(h.session.view.tables[0].name).toBe('T');
 expect(h.session.hasChanges).toBe(false);
 expect(h.disk().equals(original)).toBe(true);
});

it('disables future writes after an uncertain write', async () => {
 let writes = 0;
 const session = new ErdEditSession(original, createDbSchema(parseRev(original.toString())), {
  read: () => original, confirm: async () => true, backup: () => {}, write: () => { writes++; },
 });
 session.editing = true;
 await session.request({type:'draft-action', action:{kind:'setTable',table:session.view.tables[0].key,property:'name',value:'New'}});
 expect((await session.request({type:'save'})).message).toMatch(/post-check/i);
 expect(session.unusable).toBe(true);
 expect((await session.request({type:'save'})).message).toMatch(/disabled/i);
 expect(writes).toBe(1);
});
