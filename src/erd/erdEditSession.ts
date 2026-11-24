import { createDbSchema } from '../dbschema/model';
import type { DbSchema } from '../dbschema/model';
import { editableFieldType } from '../dbschema/fieldTypes';
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
 constructor(private bytes: Buffer, model: DbSchema, private readonly io: DbSaveIO) { this.original = structuredClone(model); this.draft = new ErdDraft(model); }
 get model(): DbSchema { return this.draft.project(); }
 get view() { const {schema: _schema, ...view} = this.draft.view(); return view; }
 get readback(): Buffer { return Buffer.from(this.bytes); }
 get hasChanges(): boolean { return this.view.count > 0; }
 private apply(action: ErdDraftAction): void {
  if (action.kind === 'moveField') {
   const table = this.view.tables.find(t => t.key === action.table);
   const fields = table?.fields.filter(f => !f.removed) ?? [];
   const from = fields.findIndex(f => f.key === action.field);
   if (from < 0 || action.to < 0 || action.to >= fields.length || fields.slice(Math.min(from,action.to),Math.max(from,action.to)+1).some(f => !editableFieldType(f.typeCode))) throw new Error('Cannot move unknown type code field');
  }
  this.draft.apply(action);
 }
 async request(raw: unknown): Promise<{ message?: string; saved?: boolean }> {
  if (!this.editing || this.busy || this.unusable) return {message:'Editing or saving is disabled.'};
  const msg=parseErdDraftMessage(raw);
  if (!msg) return {message:'Database edit rejected; the original value was restored.'};
  if (msg.type==='draft-get') return {};
  if (msg.type==='draft-discard') { this.draft=new ErdDraft(this.original); return {}; }
  if (msg.type==='draft-action') { try { this.apply(msg.action); return {}; } catch { return {message:'Database edit rejected; the original value was restored.'}; } }
  const errors=this.view.issues.filter(i=>i.severity==='error').map(i=>i.message);
  if (errors.length) return {message:errors.join('; ')};
  this.busy=true;
  let wrote=false, readback: Buffer | undefined;
  try {
   const result=await saveDatabase(this.bytes,this.model,{...this.io,read:()=>{readback=Buffer.from(this.io.read());return readback;},write:bytes=>{wrote=true;this.io.write(bytes);}});
   if (!result) return {};
   if (!readback) throw new Error('Database readback unavailable.');
   this.original=createDbSchema(parseRev(readback.toString('utf8')));
   this.draft=new ErdDraft(this.original); this.bytes=readback; this.hint=dbIriHint(this.original);
   return {saved:true};
  } catch(e) {
   if (wrote) this.unusable=true;
   return {message:`${e instanceof Error ? e.message : String(e)}${wrote ? ' Restore the backup before continuing. Reopen the editor after recovery.' : ''}`};
  } finally { this.busy=false; }
 }
}
