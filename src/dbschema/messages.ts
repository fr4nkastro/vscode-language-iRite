import { editDbSchema } from './model';
import type { DbEdit, DbSchema } from './model';
export type DbMessage = { type: 'save' } | { type: 'edit'; edit: DbEdit };
/** Check the complete payload and apply the same model invariants as the editor. */
export function parseDbMessage(raw: unknown, model: DbSchema): DbMessage | undefined {
 if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
 const m = raw as Record<string, unknown>;
 if (m.type === 'save') return { type: 'save' };
 if (m.type !== 'edit' || !m.edit || typeof m.edit !== 'object' || Array.isArray(m.edit)) return;
 const e = m.edit as Record<string, unknown>;
 const str = (v: unknown) => typeof v === 'string' && v.length <= 255;
 const num = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v);
 const table = num(e.table) && model.tables.some(t => t.index === e.table);
 let edit: DbEdit | undefined;
 switch (e.kind) {
  case 'addTable': if (str(e.name) && num(e.maxRecords)) edit = {kind:'addTable',name:e.name as string,maxRecords:e.maxRecords as number}; break;
  case 'deleteTable': if (table) edit = {kind:'deleteTable',table:e.table as number}; break;
  case 'updateTable': if (table && (e.name === undefined || str(e.name)) && (e.maxRecords === undefined || num(e.maxRecords)) && (e.name !== undefined || e.maxRecords !== undefined)) edit = {kind:'updateTable',table:e.table as number,name:e.name as string | undefined,maxRecords:e.maxRecords as number | undefined}; break;
  case 'addField': if (table && str(e.name) && num(e.typeCode) && num(e.size)) edit = {kind:'addField',table:e.table as number,name:e.name as string,typeCode:e.typeCode as number,size:e.size as number}; break;
  case 'deleteField': if (table && num(e.field)) edit = {kind:'deleteField',table:e.table as number,field:e.field as number}; break;
  case 'moveField': if (table && num(e.from) && num(e.to)) edit = {kind:'moveField',table:e.table as number,from:e.from as number,to:e.to as number}; break;
  case 'updateField': {
   if (!table || !num(e.field) || !e.changes || typeof e.changes !== 'object' || Array.isArray(e.changes)) break;
   const c = e.changes as Record<string, unknown>;
   if (Object.keys(c).some(k => !['name','typeCode','size'].includes(k)) || !Object.keys(c).length || (c.name !== undefined && !str(c.name)) || (c.typeCode !== undefined && !num(c.typeCode)) || (c.size !== undefined && !num(c.size))) break;
   edit = {kind:'updateField',table:e.table as number,field:e.field as number,changes:{name:c.name as string | undefined,typeCode:c.typeCode as number | undefined,size:c.size as number | undefined}}; break;
  }
 }
 if (!edit) return;
 try { editDbSchema(model, edit); return {type:'edit',edit}; } catch { return; }
}
