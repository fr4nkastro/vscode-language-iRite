import { expect, it } from 'vitest';
import { harness } from './draftVmHarness';

it('reports mode changes before enabling the edit view', () => {
 const h=harness(false); h.listeners['edit-mode'].click();
 expect(h.posts.at(-1)).toMatchObject({type:'erd-edit-mode',generation:7,editing:true});
 expect(h.nodes['edit-view'].hidden).toBe(true);
 h.listeners.window.message({data:{type:'erd-edit-mode-state',generation:7,editing:true,draft:h.draft.view(),fragment:'draft',selected:'draft-1',count:0,canSave:true}});
 expect(h.nodes['edit-view'].hidden).toBe(false);
 h.listeners['diagram-mode'].click(); expect(h.posts.at(-1)).toMatchObject({type:'erd-edit-mode',generation:7,editing:false});
});

it('replaces the read-only diagram with the saved readback', () => {
 const h=harness(); h.ack();
 const input={tagName:'INPUT',value:'New',dataset:{action:'setTable',table:'draft-1',property:'name'}};
 h.change(input); h.draft.apply(h.posts.at(-1).message.action); h.ack();
 h.listeners['edit-save'].click(); expect(h.posts.at(-1).message.type).toBe('save');
 h.ack({readonly:'saved readback'}); expect(h.nodes['readonly-view'].innerHTML).toBe('saved readback');
});

it('queues the alias request arriving during mode-off until acknowledgement', () => {
 const h=harness(); h.ack(); h.listeners['diagram-mode'].click();
 h.listeners.window.message({data:{type:'erd-enable-edit',generation:7}});
 h.listeners.window.message({data:{type:'erd-edit-mode-state',generation:7,editing:false,draft:h.draft.view(),fragment:'diagram',selected:'draft-1',count:0,canSave:true}});
 expect(h.posts.slice(1)).toMatchObject([{type:'erd-edit-mode',generation:7,editing:false},{type:'erd-edit-mode',generation:7,editing:true}]);
 expect(h.nodes['edit-view'].hidden).toBe(true);
 h.listeners.window.message({data:{type:'erd-edit-mode-state',generation:7,editing:true,draft:h.draft.view(),fragment:'edit',selected:'draft-1',count:0,canSave:true}});
 expect(h.nodes['edit-view'].hidden).toBe(false);
});
