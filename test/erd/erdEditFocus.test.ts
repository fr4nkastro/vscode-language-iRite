import { it, expect } from 'vitest';
import { harness } from './draftVmHarness';

it('restores matching keyboard focus after an acknowledgement and ignores stale replies', () => {
 const h=harness(); h.ack(); let focused=false;
 const active:any={dataset:{action:'setTable',table:'draft-1',property:'name'},tagName:'INPUT',value:'New',selectionStart:3,selectionEnd:3};
 const replacement={...active,focus(){focused=true;},setSelectionRange(){}}; h.setFocus(active,replacement);
 h.change(active); const id=h.posts.at(-1).requestId;
 h.ack({id:id+1,fragment:'stale',message:'stale'});
 expect(h.nodes['edit-view'].innerHTML).not.toBe('stale'); expect(focused).toBe(false);
 h.draft.apply(h.posts.at(-1).message.action); h.ack({id,fragment:'fresh',message:'Edit rejected'});
 expect(h.nodes['edit-notice'].textContent).toBe('Edit rejected'); expect(focused).toBe(true);
});
