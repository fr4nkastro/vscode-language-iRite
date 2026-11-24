import type { ErdDraftAction } from './erdDraft';

export type ErdDraftMessage = {type:'save'} | {type:'draft-discard'} | {type:'draft-get'} | {type:'draft-action'; action:ErdDraftAction};
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const text = (v: unknown) => typeof v === 'string' && v.length <= 255;
const key = (v: unknown) => typeof v === 'string' && /^draft-[1-9]\d{0,15}$/.test(v);
const integer = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v);
/** Parse the entire untrusted payload; raw schemas and provenance are never accepted. */
export function parseErdDraftMessage(raw: unknown): ErdDraftMessage | undefined {
 if (!object(raw)) return;
 if ((raw.type === 'save' || raw.type === 'draft-discard' || raw.type === 'draft-get') && exact(raw,['type'])) return {type:raw.type};
 if (raw.type !== 'draft-action' || !exact(raw,['type','action']) || !object(raw.action)) return;
 const a = raw.action;
 let valid = false;
 switch (a.kind) {
  case 'addTable': valid=exact(a,['kind','name','maxRecords']) && text(a.name) && text(a.maxRecords); break;
  case 'removeTable': case 'restoreTable': valid=exact(a,['kind','table']) && key(a.table); break;
  case 'setTable': valid=exact(a,['kind','table','property','value']) && key(a.table) && (a.property==='name'||a.property==='maxRecords') && text(a.value); break;
  case 'addField': valid=exact(a,['kind','table','name','typeCode']) && key(a.table) && text(a.name) && integer(a.typeCode); break;
  case 'removeField': case 'restoreField': valid=exact(a,['kind','table','field']) && key(a.table) && key(a.field); break;
  case 'moveField': valid=exact(a,['kind','table','field','to']) && key(a.table) && key(a.field) && integer(a.to); break;
  case 'setField': valid=exact(a,['kind','table','field','property','value']) && key(a.table) && key(a.field) && (a.property==='name'||a.property==='size'||a.property==='typeCode') && text(a.value); break;
 }
 return valid ? {type:'draft-action',action:a as unknown as ErdDraftAction} : undefined;
}

/** Integer type code given to every new field (Add field button and Enter shortcut). */
export const DEFAULT_NEW_FIELD_TYPE = 3;
