import type { DbSchema } from './model';
import { planDbSave, validateDbReadback } from './save';

export interface DbSaveIO { read(): Buffer; confirm(): Promise<boolean>; backup(): void; write(bytes: Buffer): void; noChanges?(): void }

/** Filesystem operations are injected so the ordering can be tested without a real .rev. */
export function atomicDbWrite(target: string, temporary: string, bytes: Buffer, io: { writeTemp(path: string, bytes: Buffer): void; rename(from: string, to: string): void }): void {
 io.writeTemp(temporary, bytes);
 io.rename(temporary, target);
}
/** The caller serializes saves and prevents edits while confirmation is pending. */
export async function saveDatabase(original: Buffer, model: DbSchema, io: DbSaveIO): Promise<DbSchema | undefined> {
 const check = () => { if (!io.read().equals(original)) throw new Error('Database file changed on disk; nothing was written. Reopen the editor.'); };
 check();
 const plan = planDbSave(original, model);
 if (!plan) { io.noChanges?.(); return undefined; }
 if (!(await io.confirm())) return undefined;
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
