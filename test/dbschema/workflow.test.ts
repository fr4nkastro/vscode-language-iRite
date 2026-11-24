import { describe, it, expect } from 'vitest';
import { createDbSchema, editDbSchema } from '../../src/dbschema/model';
import { parseRev } from '../../src/rev';
import { saveDatabase, atomicDbWrite } from '../../src/dbschema/workflow';

const original = Buffer.from('<Indicator><ConfigHash value="x"/><Config>\nDB.SCHEMA#1=10,0,A,3,4\nDB.ALIAS#1=T\nEDP.X#1=x\n</Config></Indicator>');
const changed = () => editDbSchema(createDbSchema(parseRev(original.toString())), {kind:'updateTable',table:1,name:'New'});

describe('save workflow', () => {
 it('confirms, backs up, checks again, writes and validates real readback', async () => {
  let disk: Buffer = Buffer.from(original); const events: string[] = [];
  const result = await saveDatabase(original, changed(), { read: () => {events.push('read'); return disk;}, confirm: async () => {events.push('confirm'); return true;}, backup: () => {events.push('backup');}, write: b => {events.push('write'); disk = b;} });
  expect(result?.tables[0].name).toBe('New'); expect(events).toEqual(['read','confirm','read','backup','read','write','read']);
 });
 it('refuses stale changes before backup or after backup', async () => {
  for (const staleAt of [1,3]) { let n = 0; let writes = 0; let backups = 0;
   await expect(saveDatabase(original, changed(), {read: () => ++n === staleAt ? Buffer.from('changed') : original, confirm: async () => true, backup: () => {backups++;}, write: () => {writes++;}})).rejects.toThrow(/changed on disk/);
   expect(writes).toBe(0); expect(backups).toBe(staleAt === 3 ? 1 : 0);
  }
 });
 it('does not write on cancellation or without changes', async () => {
  let writes = 0, backups = 0; const io = {read: () => original, confirm: async () => false, backup: () => {backups++;}, write: () => {writes++;}};
  expect(await saveDatabase(original, changed(), io)).toBeUndefined();
  expect(await saveDatabase(original, createDbSchema(parseRev(original.toString())), io)).toBeUndefined();
  expect([writes, backups]).toEqual([0,0]);
 });
 it('reports only unchanged saves, not cancelled saves', async () => {
  const notices: string[] = []; let confirms = 0, backups = 0, writes = 0;
  const io = {read: () => original, confirm: async () => { confirms++; return false; }, backup: () => { backups++; }, write: () => { writes++; }, noChanges: () => notices.push('no changes')};
  await saveDatabase(original, createDbSchema(parseRev(original.toString())), io);
  expect(notices).toEqual(['no changes']); expect(confirms).toBe(0);
  await saveDatabase(original, changed(), io);
  expect(notices).toEqual(['no changes']); expect(confirms).toBe(1); expect([backups,writes]).toEqual([0,0]);
 });
 it('writes a same-directory temporary file before rename after backup and reads back', async () => {
  let disk: Buffer = Buffer.from(original), temp: Buffer = Buffer.alloc(0); const events: string[] = [];
  await saveDatabase(original, changed(), {read: () => {events.push('read'); return disk;}, confirm: async () => {events.push('confirm'); return true;}, backup: () => {events.push('backup');}, write: bytes => atomicDbWrite('/project/main.rev', '/project/.main.rev.tmp', bytes, {
   writeTemp: (p, b) => {events.push(`temp:${p}`); temp = b;}, rename: (a, b) => {events.push(`rename:${a}:${b}`); disk = temp;},
  })});
  expect(events).toEqual(['read','confirm','read','backup','read','temp:/project/.main.rev.tmp','rename:/project/.main.rev.tmp:/project/main.rev','read']);
  expect(disk.toString()).toContain('DB.ALIAS#1=New');
 });
 it('rejects unrelated disk corruption and retains the backup', async () => {
  let disk = Buffer.from(original); let backup: Buffer | undefined; let writes = 0;
  await expect(saveDatabase(original, changed(), {
   read: () => disk, confirm: async () => true, backup: () => { backup = Buffer.from(disk); },
   write: bytes => { writes++; disk = Buffer.from(bytes.toString().replace('EDP.X#1=x', 'EDP.X#1=corrupt')); },
  })).rejects.toThrow('Database post-check failed after writing; restore the backup before continuing.');
  expect(writes).toBe(1); expect(backup?.equals(original)).toBe(true);
  expect(disk.toString()).toContain('DB.ALIAS#1=New'); expect(disk.toString()).toContain('EDP.X#1=corrupt');
 });
 it('rejects incorrect real readback', async () => {
  await expect(saveDatabase(original, changed(), {read: () => original, confirm: async () => true, backup: () => {}, write: () => {}})).rejects.toThrow(/post-check/);
 });
});
