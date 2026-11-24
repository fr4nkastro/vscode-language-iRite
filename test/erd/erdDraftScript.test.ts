import { expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';
import { renderErdHtml } from '../../src/erd/erdHtml';
import { ErdDraft } from '../../src/erd/erdDraft';
import { renderErdDraft, canSaveErdDraft } from '../../src/erd/erdDraftHtml';
import type { DbSchema } from '../../src/dbschema/model';

const schema: DbSchema = {reservedIndexes:[],tables:[{index:1,name:'Orders',maxRecords:10,fields:['A','B','C'].map(name=>({name,typeCode:3,typeName:'integer',size:4}))}]};
function harness() {
 const listeners: Record<string, Record<string, Function>> = {}, posts: any[] = [], nodes: Record<string, any> = {};
 const doc: any = {activeElement:null, getElementById:(id:string)=>nodes[id]};
 for (const id of ['erd','vp','diagram-view','edit-view','edit-toolbar','diagram-mode','edit-mode','edit-save','edit-revert','edit-count','edit-notice','edit-feedback','readonly-view']) {
  nodes[id] = {disabled:false, hidden:false, innerHTML:'', textContent:'', setAttribute() {}, addEventListener(type:string, fn:Function) { (listeners[id] ??= {})[type] = fn; }};
 }
 const filter = {dataset:{action:'filterTables'},value:'',tagName:'INPUT'};
 const list = [{textContent:'Orders',parentElement:{hidden:false}},{textContent:'Other',parentElement:{hidden:false}}];
 let focusable: any[] = [];
 nodes['edit-view'].querySelector = (s:string) => s === '[data-detail]' ? {dataset:{table:'draft-1'}} : s.includes('filterTables') ? filter : null;
 nodes['edit-view'].querySelectorAll = (s:string) => s === '[data-action]' ? focusable : s.startsWith('.draft-list') ? list : [];
 nodes['edit-view'].contains = (node:any) => !!node?.dataset;
 const window = {addEventListener(type:string, fn:Function) { (listeners.window ??= {})[type]=fn; }};
 const html = renderErdHtml({tables:[],relations:[],diagnostics:[]},{cspSource:'vscode:',nonce:'abc',title:'x',generation:7,editor:{schema,startEditing:true}});
 runInNewContext(html.match(/<script nonce="abc">([\s\S]*?)<\/script>/)![1],{document:doc,window,acquireVsCodeApi:()=>({postMessage:(m:any)=>posts.push(m)})});
 const draft = new ErdDraft(schema);
 const ack = (opts: {id?:number; generation?:number; canSave?:boolean; fragment?:string; selected?:string; disabled?:boolean} = {}) => {
  const view=draft.view(); listeners.window.message({data:{type:'erd-edit-state',generation:opts.generation ?? 7,requestId:opts.id ?? posts.at(-1).requestId,draft:view,selected:opts.selected ?? view.tables[0].key,fragment:opts.fragment ?? renderErdDraft(view),count:view.count,canSave:opts.canSave ?? canSaveErdDraft(view),disabled:opts.disabled ?? false}});
 };
 const row = (field:string) => ({dataset:{table:'draft-1',field},draggable:true,closest() {return this;}});
 const keyboard = (key:string, options:any={}) => {let prevented=false; listeners.window.keydown({key,altKey:false,ctrlKey:false,metaKey:false,target:{},preventDefault(){prevented=true;},...options}); return prevented;};
 const change = (node:any) => listeners['edit-view'].input({type:'input',target:node});
 const setFocus = (old:any, replacement:any) => {doc.activeElement=old; focusable=[replacement];};
 return {nodes,listeners,posts,draft,ack,row,keyboard,change,filter,list,setFocus};
}

it('uses live field indexes for drag and Alt arrows around tombstones', () => {
 const h=harness(), fields=h.draft.view().tables[0].fields; h.draft.apply({kind:'removeField',table:'draft-1',field:fields[1].key}); h.ack();
 const a=h.row(fields[0].key), c=h.row(fields[2].key);
 h.listeners['edit-view'].dragstart({target:a}); h.listeners['edit-view'].drop({target:c,preventDefault(){}});
 expect(h.posts.at(-1).message.action).toMatchObject({kind:'moveField',field:fields[0].key,to:1});
 h.draft.apply(h.posts.at(-1).message.action); h.ack();
 expect(h.keyboard('ArrowUp',{altKey:true,target:a})).toBe(true);
 expect(h.posts.at(-1).message.action).toMatchObject({kind:'moveField',field:fields[0].key,to:0});
});

it.each(['ctrlKey','metaKey'])('gates %s+S on authoritative validity, changes and pending requests', modifier => {
 const h=harness(); h.ack(); expect(h.nodes['edit-save'].disabled).toBe(true);
 expect(h.keyboard('s',{[modifier]:true})).toBe(true); expect(h.posts).toHaveLength(1);
 h.draft.apply({kind:'setTable',table:'draft-1',property:'name',value:''});
 h.listeners['edit-view'].input({type:'input',target:{dataset:{action:'setTable',table:'draft-1',property:'name'},tagName:'INPUT',value:''}}); h.ack();
 expect(h.nodes['edit-save'].disabled).toBe(true); h.keyboard('s',{[modifier]:true}); expect(h.posts).toHaveLength(2);
 h.draft.apply({kind:'setTable',table:'draft-1',property:'name',value:'New'});
 h.change({dataset:{action:'setTable',table:'draft-1',property:'name'},tagName:'INPUT',value:'New'});
 h.keyboard('s',{[modifier]:true}); expect(h.posts).toHaveLength(3); h.ack();
 expect(h.nodes['edit-save'].disabled).toBe(false); h.keyboard('s',{[modifier]:true});
 expect(h.posts.at(-1).message.type).toBe('save'); expect(h.nodes['edit-save'].disabled).toBe(true);
});

it('serializes rapid input, rejects stale acknowledgements and keeps filter, focus and caret', () => {
 const h=harness(); h.ack();
 h.filter.value='ord'; h.change(h.filter); expect(h.list[1].parentElement.hidden).toBe(true);
 const node:any={dataset:{action:'setTable',table:'draft-1',property:'name'},tagName:'INPUT',value:'N',selectionStart:1,selectionEnd:1,selectionDirection:'none'};
 let focus=false, caret:any; const replacement={...node,focus(){focus=true;},setSelectionRange(...args:any[]){caret=args;}}; h.setFocus(node,replacement);
 h.change(node); const first=h.posts.at(-1).requestId; node.value='New'; node.selectionStart=3; node.selectionEnd=3; h.change(node);
 expect(h.posts).toHaveLength(2); expect(h.nodes['edit-save'].disabled).toBe(true);
 const previous=h.nodes['edit-view'].innerHTML; h.ack({id:first+1}); h.ack({id:first,generation:8}); expect(h.posts).toHaveLength(2);
 h.draft.apply({kind:'setTable',table:'draft-1',property:'name',value:'N'}); h.ack({id:first,fragment:'old'});
 expect(h.nodes['edit-view'].innerHTML).toBe(previous); expect(h.posts.at(-1).message.action.value).toBe('New');
 h.draft.apply({kind:'setTable',table:'draft-1',property:'name',value:'New'}); h.ack({fragment:'new'});
 expect(h.nodes['edit-view'].innerHTML).toBe('new'); expect(h.filter.value).toBe('ord'); expect(focus).toBe(true); expect(caret).toEqual([3,3,'none']);
});

it('sends a type selection once and ignores unrelated change events', () => {
 const h=harness(); h.ack();
 const select={tagName:'SELECT',value:'6',dataset:{action:'setField',table:'draft-1',field:'draft-2',property:'typeCode'}};
 h.listeners['edit-view'].input({type:'input',target:select});
 expect(h.posts).toHaveLength(1);
 h.listeners['edit-view'].change({type:'change',target:select});
 expect(h.posts.at(-1).message.action).toMatchObject({kind:'setField',table:'draft-1',field:'draft-2',property:'typeCode',value:'6'});
 h.draft.apply(h.posts.at(-1).message.action); h.ack();
 expect(h.draft.view().tables[0].fields[0].size).toBe('20');
 h.listeners['edit-view'].change({type:'change',target:{tagName:'SELECT',dataset:{},value:'7'}});
 expect(h.posts).toHaveLength(2);
});

it('waits for mode acknowledgement and does not consume save shortcut in diagram mode', () => {
 const h=harness(); h.ack(); h.listeners['diagram-mode'].click(); expect(h.nodes['diagram-view'].hidden).toBe(true);
 h.listeners.window.message({data:{type:'erd-edit-mode-state',generation:7,editing:false,draft:h.draft.view(),fragment:'diagram',count:0,canSave:true}});
 expect(h.nodes['diagram-view'].hidden).toBe(false); expect(h.keyboard('s',{ctrlKey:true})).toBe(false);
 h.listeners['edit-mode'].click(); expect(h.nodes['edit-view'].hidden).toBe(true);
 h.listeners.window.message({data:{type:'erd-edit-mode-state',generation:7,editing:true,draft:h.draft.view(),fragment:'edit',count:0,canSave:true}});
 expect(h.nodes['edit-view'].hidden).toBe(false);
});
