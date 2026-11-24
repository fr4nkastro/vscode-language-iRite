import { DbSchema, DbTable, DbField, editDbSchema, validateDbSchema } from '../dbschema/model';
import { editableFieldType } from '../dbschema/fieldTypes';

type Key = string;
type FieldRow = { key: Key; field: DbField; original?: DbField; ordinal?: number; name: string; size: string; removed: boolean; added: boolean };
type TableRow = { key: Key; table: DbTable; name: string; maxRecords: string; fields: FieldRow[]; removed: boolean; added: boolean };
export type ErdDraftAction =
 | { kind: 'addTable'; name: string; maxRecords: string }
 | { kind: 'removeTable'; table: Key } | { kind: 'restoreTable'; table: Key }
 | { kind: 'setTable'; table: Key; property: 'name' | 'maxRecords'; value: string }
 | { kind: 'addField'; table: Key; name: string; typeCode: number }
 | { kind: 'removeField'; table: Key; field: Key } | { kind: 'restoreField'; table: Key; field: Key }
 | { kind: 'moveField'; table: Key; field: Key; to: number }
 | { kind: 'setField'; table: Key; field: Key; property: 'name' | 'size' | 'typeCode'; value: string };
export interface DraftIssue { severity: 'error' | 'warning'; message: string; table?: Key; field?: Key; property?: 'name' | 'maxRecords' | 'size' | 'typeCode' | 'fields' }
const number = (s: string): number => /^\d+$/.test(s) && Number.isSafeInteger(Number(s)) ? Number(s) : NaN;
const numericValue = (raw: string, original: number): number => raw === String(original) ? original : number(raw);
const copy = <T>(v: T): T => structuredClone(v);
const sum = (a: number | undefined, b: number): number | undefined => a !== undefined && Number.isSafeInteger(b) && b >= 0 && Number.isSafeInteger(a + b) ? a + b : undefined;

/** Host-owned draft. Keys are opaque and valid only for this instance. apply accepts only
 * typed user edits, never provenance; project returns the schema for the existing save
 * workflow. view includes tombstones, raw input, validation, estimates and change count.
 * Construct a new instance to discard or after a successful save. */
export class ErdDraft {
 private readonly original: DbSchema;
 private rows: TableRow[];
 private serial = 0;
 private key(): string { return `draft-${++this.serial}`; }
 constructor(original: DbSchema) {
  this.original = copy(original);
  this.rows = this.original.tables.map(t => ({ key:this.key(), table:copy(t), name:t.name, maxRecords:String(t.maxRecords), removed:false, added:false, fields:t.fields.map((f, ordinal) => ({key:this.key(),field:copy(f),original:copy(f),ordinal,name:f.name,size:String(f.size),removed:false,added:false})) }));
 }
 apply(action: ErdDraftAction): void {
  if (action.kind === 'addTable') {
   const model = { ...this.original, tables:this.rows.map(r=>r.table) };
   const table = editDbSchema(model,{kind:'addTable',name:action.name,maxRecords:number(action.maxRecords)}).tables.at(-1)!;
   this.rows.push({key:this.key(),table,name:action.name,maxRecords:action.maxRecords,fields:[],removed:false,added:true}); return;
  }
  const t = this.rows.find(r=>r.key===action.table); if (!t) throw new Error('Table not found');
  if (action.kind === 'removeTable' || action.kind === 'restoreTable') { if (t.added && action.kind === 'removeTable') this.rows.splice(this.rows.indexOf(t),1); else t.removed=action.kind==='removeTable'; return; }
  if (t.removed) throw new Error('Table removed');
  if (action.kind === 'setTable') { t[action.property]=action.value; return; }
  if (action.kind === 'addField') {
   const type=editableFieldType(action.typeCode); if (!type) throw new Error('Cannot add unknown type code');
   const m=editDbSchema({...this.original,tables:[{...t.table,fields:[]}]},{kind:'addField',table:t.table.index,name:action.name,typeCode:type.code,size:type.defaultSize});
   t.fields.push({key:this.key(),field:m.tables[0].fields[0],name:action.name,size:String(type.defaultSize),removed:false,added:true}); return;
  }
  const f=t.fields.find(r=>r.key===action.field); if (!f) throw new Error('Field not found');
  if (action.kind === 'removeField' || action.kind === 'restoreField') { if (f.added && action.kind==='removeField') t.fields.splice(t.fields.indexOf(f),1); else f.removed=action.kind==='removeField'; return; }
  if (f.removed) throw new Error('Field removed');
  if (action.kind === 'moveField') {
   const live=t.fields.filter(x=>!x.removed); if (!Number.isInteger(action.to) || action.to<0 || action.to>=live.length) throw new Error('Field not found');
   const target=live[action.to]; if (target!==f) { const from=t.fields.indexOf(f), to=t.fields.indexOf(target); t.fields.splice(from,1); t.fields.splice(to,0,f); } return;
  }
  if (!editableFieldType(f.field.typeCode)) throw new Error('Cannot edit unknown type code field');
  if (action.property==='typeCode') { const type=editableFieldType(number(action.value)); if (!type) throw new Error('Cannot assign unknown type code'); if (type.code!==f.field.typeCode) { f.field.typeCode=type.code; f.field.typeName=type.iriteType==='integer'||type.iriteType==='real'||type.iriteType==='string' ? type.iriteType : 'unknown'; f.size=String(type.defaultSize); } }
  else if (action.property==='size') { if (!editableFieldType(f.field.typeCode)!.variable) throw new Error('Fixed size'); f.size=action.value; }
  else f.name=action.value;
 }
 project(): DbSchema {
  return { ...copy(this.original), tables:this.rows.filter(t=>!t.removed).map(t=>({...copy(t.table),name:t.name,maxRecords:numericValue(t.maxRecords,t.table.maxRecords),fields:t.fields.filter(f=>!f.removed).map(f=>({...copy(f.field),name:f.name,size:numericValue(f.size,f.original?.size ?? NaN)}))})) };
 }
 view() {
  const schema=this.project();
  const issues: DraftIssue[]=[];
  const liveTables=this.rows.filter(t=>!t.removed);
  validateDbSchema(schema,this.original, issue => {
   const t=issue.table === undefined ? undefined : liveTables[issue.table];
   const f=issue.field === undefined ? undefined : t?.fields.filter(row=>!row.removed)[issue.field];
   issues.push({severity:issue.severity,message:issue.message,table:t?.key,field:f?.key,property:issue.property});
  });
  let records: number | undefined=0, bytes: number | undefined=0;
  const tables=this.rows.map(t=>{
   const surviving=t.fields.filter(f=>!f.removed && !f.added);
   const originalOrder=surviving.map(f=>f.ordinal!).sort((a,b)=>a-b);
   const fields=t.fields.map(f=>({key:f.key,name:f.name,size:f.size,typeCode:f.field.typeCode,removed:f.removed,added:f.added,reordered:!f.removed && !f.added && originalOrder[surviving.indexOf(f)]!==f.ordinal,dirty:!!f.original && (f.name!==f.original.name || f.size!==String(f.original.size) || f.field.typeCode!==f.original.typeCode)}));
   let record: number | undefined=0; for (const f of t.fields.filter(f=>!f.removed)) record=sum(record,number(f.size));
   const n=number(t.maxRecords); const total=record!==undefined && Number.isSafeInteger(n) && n>=0 && Number.isSafeInteger(record*n) ? record*n : undefined;
   if (!t.removed) { records=sum(records,n); bytes=total===undefined?undefined:sum(bytes,total); }
   const propertiesDirty=t.name!==t.table.name || t.maxRecords!==String(t.table.maxRecords);
   const dirty=!t.added && (propertiesDirty || fields.some(f=>f.added||f.removed||f.dirty||f.reordered));
   return {key:t.key,index:t.table.index,name:t.name,maxRecords:t.maxRecords,removed:t.removed,added:t.added,dirty,propertiesDirty,fields,recordBytes:record,totalBytes:total};
  });
  let count=0;
  for (const t of tables) { if (t.added || t.removed) { count++; continue; } if (t.propertiesDirty) count++; count+=t.fields.filter(f=>f.added||f.removed||f.dirty||f.reordered).length; }
  return {tables,issues,count,budget:{tables:schema.tables.length,records,bytes,threshold:460000000,overThreshold:bytes!==undefined && bytes>460000000},schema};
 }
}
