import { runInNewContext } from 'node:vm';
import { renderErdHtml } from '../../src/erd/erdHtml';
import { ErdDraft } from '../../src/erd/erdDraft';
import { renderErdDraft, canSaveErdDraft } from '../../src/erd/erdDraftHtml';
import type { DbSchema } from '../../src/dbschema/model';

const schema: DbSchema = {reservedIndexes:[],tables:[{index:1,name:'Orders',maxRecords:10,fields:['A','B','C'].map(name=>({name,typeCode:3,typeName:'integer',size:4}))}]};
export function harness(startEditing = true, inputSchema: DbSchema = schema) {
 const listeners: Record<string, Record<string, Function>> = {}, posts: any[] = [], nodes: Record<string, any> = {};
 const doc: any = {activeElement:null, getElementById:(id:string)=>nodes[id]};
 for (const id of ['erd','vp','diagram-view','edit-view','edit-toolbar','diagram-mode','edit-mode','edit-save','edit-revert','edit-count','edit-notice','edit-feedback','readonly-view']) nodes[id] = {disabled:false,hidden:false,innerHTML:'',textContent:'',setAttribute(){},addEventListener(type:string,fn:Function){(listeners[id] ??= {})[type]=fn;}};
 const filter={dataset:{action:'filterTables'},value:'',tagName:'INPUT'};
 const list=[{textContent:'Orders',parentElement:{hidden:false}},{textContent:'Other',parentElement:{hidden:false}}];
 let focusable: any[]=[];
 nodes['edit-view'].querySelector=(s:string)=>s==='[data-detail]' ? {dataset:{table:'draft-1'}} : s.includes('filterTables') ? filter : null;
 nodes['edit-view'].querySelectorAll=(s:string)=>s==='[data-action]' ? focusable : s.startsWith('.draft-list') ? list : [];
 nodes['edit-view'].contains=(node:any)=>!!node?.dataset;
 const window={addEventListener(type:string,fn:Function){(listeners.window ??= {})[type]=fn;}};
 const html=renderErdHtml({tables:[],relations:[],diagnostics:[]},{cspSource:'vscode:',nonce:'abc',title:'x',generation:7,editor:{schema:inputSchema,startEditing}});
 runInNewContext(html.match(/<script nonce="abc">([\s\S]*?)<\/script>/)![1],{document:doc,window,acquireVsCodeApi:()=>({postMessage:(m:any)=>posts.push(m)})});
 const draft=new ErdDraft(inputSchema);
 const ack=(opts:{id?:number;generation?:number;canSave?:boolean;fragment?:string;selected?:string;disabled?:boolean;message?:string;readonly?:string}={})=>{
  const view=draft.view(); listeners.window.message({data:{type:'erd-edit-state',generation:opts.generation ?? 7,requestId:opts.id ?? posts.at(-1).requestId,draft:view,selected:opts.selected ?? view.tables[0].key,fragment:opts.fragment ?? renderErdDraft(view),count:view.count,canSave:opts.canSave ?? canSaveErdDraft(view),disabled:opts.disabled ?? false,message:opts.message,readonly:opts.readonly}});
 };
 const setFocus=(old:any,replacement:any)=>{doc.activeElement=old;focusable=[replacement];};
 const change=(node:any)=>listeners['edit-view'].input({type:'input',target:node});
 const row=(field:string,draggable=true)=>({dataset:{table:'draft-1',field},draggable,closest(){return this;}});
 const keyboard=(key:string,options:any={})=>{let prevented=false;listeners.window.keydown({key,altKey:false,ctrlKey:false,metaKey:false,target:{},preventDefault(){prevented=true;},...options});return prevented;};
 return {nodes,listeners,posts,draft,ack,setFocus,change,row,keyboard,filter,list};
}
