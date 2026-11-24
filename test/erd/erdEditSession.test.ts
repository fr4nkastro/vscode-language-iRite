import { expect, it } from 'vitest';
import { ErdEditSession, projectSource } from '../../src/erd/erdEditSession';
import { createDbSchema } from '../../src/dbschema/model';
import { parseRev } from '../../src/rev';

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
