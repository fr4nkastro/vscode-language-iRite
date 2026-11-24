import { it, expect } from 'vitest';
import { harness } from './draftVmHarness';

it('queues destructive actions behind pending edits, gates save and discards the acknowledged draft', () => {
 const h=harness(); h.ack();
 const input={tagName:'INPUT',value:'pending',dataset:{action:'setTable',table:'draft-1',property:'name'}};
 h.change(input);
 expect(h.posts.at(-1).message.action).toMatchObject({kind:'setTable',table:'draft-1',property:'name',value:'pending'});
 const button:any={dataset:{action:'removeField',table:'draft-1',field:'draft-2'},closest(){return this;}};
 h.listeners['edit-view'].click({target:button}); h.listeners['edit-save'].click();
 expect(h.posts).toHaveLength(2); expect(input.value).toBe('pending'); expect(h.nodes['edit-save'].disabled).toBe(true);
 h.draft.apply(h.posts.at(-1).message.action); h.ack();
 expect(h.posts.at(-1).message.action).toMatchObject({kind:'removeField',table:'draft-1',field:'draft-2'});
 h.draft.apply(h.posts.at(-1).message.action); h.ack();
 expect(h.nodes['edit-revert'].disabled).toBe(false); h.listeners['edit-revert'].click();
 expect(h.posts.at(-1).message.type).toBe('draft-discard'); expect(h.nodes['edit-view'].disabled).toBe(true);
});
