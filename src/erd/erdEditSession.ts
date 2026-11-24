import { createDbSchema, editDbSchema, validateDbSchema } from '../dbschema/model';
import type { DbSchema } from '../dbschema/model';
import { parseDbMessage } from '../dbschema/messages';
import { dbIriHint } from '../dbschema/iriHint';
import { saveDatabase } from '../dbschema/workflow';
import type { DbSaveIO } from '../dbschema/workflow';
import { parseRev } from '../rev';
import * as path from 'path';

/** Return the trusted project path, never the webview's spelling. */
export function projectSource(files: readonly string[], candidate: string): string | undefined {
 return files.find(file => path.normalize(file).toLowerCase() === path.normalize(candidate).toLowerCase());
}

/** Authoritative edit session, independent of the webview's input state. */
export class ErdEditSession {
 editing = false;
 busy = false;
 unusable = false;
 hint: string | undefined;
 constructor(private bytes: Buffer, public model: DbSchema, private readonly io: DbSaveIO) {}
 get readback(): Buffer { return Buffer.from(this.bytes); }
 async request(raw: unknown): Promise<{ message?: string; saved?: boolean }> {
  if (!this.editing || this.busy || this.unusable) return { message: 'Editing or saving is disabled.' };
  const msg = parseDbMessage(raw, this.model);
  if (!msg) return { message: 'Database edit rejected; the original value was restored.' };
  if (msg.type === 'edit') { this.model = editDbSchema(this.model, msg.edit); return {}; }
  const errors = validateDbSchema(this.model).errors;
  if (errors.length) return { message: errors.join('; ') };
  this.busy = true;
  let wrote = false;
  let readback: Buffer | undefined;
  try {
   const result = await saveDatabase(this.bytes, this.model, { ...this.io, read: () => { readback = Buffer.from(this.io.read()); return readback; }, write: bytes => { wrote = true; this.io.write(bytes); } });
   if (!result) return {};
   if (!readback) throw new Error('Database readback unavailable.');
   this.model = createDbSchema(parseRev(readback.toString('utf8')));
   this.bytes = readback;
   this.hint = dbIriHint(this.model);
   return { saved: true };
  } catch (e) {
   if (wrote) this.unusable = true;
   return { message: `${e instanceof Error ? e.message : String(e)}${wrote ? ' Reopen the editor after recovery.' : ''}` };
  } finally { this.busy = false; }
 }
}
