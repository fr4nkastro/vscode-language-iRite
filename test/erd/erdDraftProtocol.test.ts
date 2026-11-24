import { expect, it } from 'vitest';
import { parseErdDraftMessage } from '../../src/erd/erdDraftProtocol';

it('accepts invalid intent strings but rejects extra provenance and malformed payloads', () => {
 expect(parseErdDraftMessage({type:'draft-action',action:{kind:'setTable',table:'draft-1',property:'name',value:''}})).toEqual({type:'draft-action',action:{kind:'setTable',table:'draft-1',property:'name',value:''}});
 expect(parseErdDraftMessage({type:'draft-action',action:{kind:'setTable',table:'draft-1',property:'name',value:'X',original:{}}})).toBeUndefined();
 expect(parseErdDraftMessage({type:'save',schema:{tables:[]}})).toBeUndefined();
 expect(parseErdDraftMessage({type:'draft-action',action:{kind:'moveField',table:'draft-1',field:'draft-2',to:NaN}})).toBeUndefined();
});
