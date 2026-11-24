import { createDbSchema } from '../dbschema/model';
import type { DbSchema } from '../dbschema/model';
import { dbIriHint } from '../dbschema/iriHint';
import { saveDatabase } from '../dbschema/workflow';
import type { DbSaveIO } from '../dbschema/workflow';
import { parseRev } from '../rev';
import { ErdDraft } from './erdDraft';
import type { ErdDraftAction } from './erdDraft';
import { parseErdDraftMessage } from './erdDraftProtocol';
import * as path from 'path';

export function projectSource(files: readonly string[], candidate: string): string | undefined {
 return files.find(file => path.normalize(file).toLowerCase() === path.normalize(candidate).toLowerCase());
}

export class ErdEditSession {
 editing = false;
 busy = false;
 unusable = false;
 hint: string | undefined;
 private original: DbSchema;
 private draft: ErdDraft;
 private snapshot?: Omit<ReturnType<ErdDraft['view']>, 'schema'>;
 private getSnapshot() { if (!this.snapshot) { const {schema: _schema, ...view} = this.draft.view(); this.snapshot = view; } return this.snapshot; }
 constructor(private bytes: Buffer, model: DbSchema, private readonly io: DbSaveIO) { this.original = structuredClone(model); this.draft = new ErdDraft(model); }
 get model(): DbSchema { return this.draft.project(); }
 get view() { return structuredClone(this.getSnapshot()); }
 get readback(): Buffer { return Buffer.from(this.bytes); }
 get hasChanges(): boolean { return this.getSnapshot().count > 0; }
 private apply(action: ErdDraftAction): void {
  this.draft.apply(action);
  this.snapshot=undefined;
 }
 async request(raw: unknown): Promise<{ message?: string; saved?: boolean }> {
  if (!this.editing || this.busy || this.unusable) return {message:'Editing or saving is disabled.'};
  const msg=parseErdDraftMessage(raw);
  if (!msg) return {message:'Database edit rejected; the original value was restored.'};
  if (msg.type==='draft-get') return {};
  if (msg.type==='draft-discard') { this.draft=new ErdDraft(this.original); this.snapshot=undefined; return {}; }
  if (msg.type==='draft-action') { try { this.apply(msg.action); return {}; } catch (e) { const moveErrors=['Field not found','Field index out of range','Cannot move unknown type code field']; return {message:msg.action.kind==='moveField' && e instanceof Error && moveErrors.includes(e.message) ? e.message : 'Database edit rejected; the original value was restored.'}; } }
  const errors=this.view.issues.filter(i=>i.severity==='error').map(i=>i.message);
  if (errors.length) return {message:errors.join('; ')};
  this.busy=true;
  let wrote=false, readback: Buffer | undefined;
  try {
   const result=await saveDatabase(this.bytes,this.model,{...this.io,read:()=>{readback=Buffer.from(this.io.read());return readback;},write:bytes=>{wrote=true;this.io.write(bytes);}});
   if (!result) return {};
   if (!readback) throw new Error('Database readback unavailable.');
   this.original=createDbSchema(parseRev(readback.toString('utf8')));
   this.draft=new ErdDraft(this.original); this.snapshot=undefined; this.bytes=readback; this.hint=dbIriHint(this.original);
   return {saved:true};
  } catch(e) {
   if (wrote) this.unusable=true;
   return {message:`${e instanceof Error ? e.message : String(e)}${wrote ? ' Restore the backup before continuing. Reopen the editor after recovery.' : ''}`};
  } finally { this.busy=false; }
 }
}
