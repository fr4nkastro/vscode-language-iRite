import type { DbSchema } from './model';
import { planDbSave, validateDbReadback } from './save';

export interface DbSaveIO { read(): Buffer; confirm(): Promise<boolean>; backup(): void; write(bytes: Buffer): void }
/** The caller serializes saves and prevents edits while confirmation is pending. */
export async function saveDatabase(original: Buffer, model: DbSchema, io: DbSaveIO): Promise<DbSchema | undefined> {
 const check = () => { if (!io.read().equals(original)) throw new Error('Database file changed on disk; nothing was written. Reopen the editor.'); };
 check();
 const plan = planDbSave(original, model);
 if (!plan || !(await io.confirm())) return undefined;
 check();
 io.backup();
 check();
 io.write(plan.bytes);
 const actual = io.read();
 try {
  if (!actual.equals(plan.bytes)) throw new Error('Written bytes differ from the save plan');
  validateDbReadback(actual, model);
 } catch { throw new Error('Database post-check failed after writing; restore the backup before continuing.'); }
 return plan.model;
}
