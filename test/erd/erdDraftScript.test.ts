import { expect, it } from 'vitest';
import { harness } from './draftVmHarness';
import type { DbSchema } from '../../src/dbschema/model';

it('ignores unknown rows for drag, move buttons and Alt arrows', () => {
 const schema: DbSchema={reservedIndexes:[],tables:[{index:1,name:'Orders',maxRecords:10,fields:[{name:'A',typeCode:3,typeName:'integer',size:4},{name:'U',typeCode:99,typeName:'unknown',size:5}]}]};
 for (const method of ['drag','keyboard','button']) {
  const h=harness(true,schema); h.ack(); const row=h.row('draft-3');
  if (method==='drag') { h.listeners['edit-view'].dragstart({target:row}); h.listeners['edit-view'].drop({target:h.row('draft-2'),preventDefault(){}}); }
  if (method==='keyboard') h.keyboard('ArrowUp',{altKey:true,target:row});
  if (method==='button') { const button={dataset:{action:'moveField',table:'draft-1',field:'draft-3',direction:'up'},closest(){return this;}}; h.listeners['edit-view'].click({target:button}); }
  expect(h.posts,method).toHaveLength(1);
 }
});

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
