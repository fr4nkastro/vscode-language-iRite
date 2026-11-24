import { expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';
import { renderErdHtml } from '../../src/erd/erdHtml';

it('reports edit mode changes to the host before accepting edit requests', () => {
 const listeners: Record<string, Record<string, (event: any) => void>> = {};
 const posts: any[] = [];
 const nodes: Record<string, any> = {};
 for (const id of ['erd','vp','edit-toggle','readonly-view','edit-view','edit-feedback','edit-save','edit-toolbar','add-table','edit-revert','edit-notice']) {
  nodes[id] = { style: {}, checked: false, setAttribute() {}, addEventListener(type: string, callback: (event: any) => void) { (listeners[id] ??= {})[type] = callback; } };
 }
 const html = renderErdHtml({ tables: [], relations: [], diagnostics: [] }, { cspSource: 'vscode:', nonce: 'abc', title: 'x', editor: { schema: { tables: [], reservedIndexes: [] } } });
 runInNewContext(html.match(/<script nonce="abc">([\s\S]*?)<\/script>/)![1], {
  document: { getElementById: (id: string) => nodes[id], querySelectorAll: () => [] },
  window: { addEventListener(type: string, callback: (event: any) => void) { (listeners.window ??= {})[type] = callback; } },
  acquireVsCodeApi: () => ({ postMessage: (message: any) => posts.push(message) }),
 });
 nodes['edit-toggle'].checked = true;
 listeners['edit-toggle'].change({});
 expect(posts).toContainEqual({ type: 'erd-edit-mode', generation: 0, editing: true });
 expect(nodes['edit-view'].style.display).toBe('none');
 listeners.window.message({data: {type:'erd-edit-mode-state', generation:0, editing:true}});
 expect(nodes['edit-view'].style.display).toBe('');
 nodes['edit-toggle'].checked = false;
 listeners['edit-toggle'].change({});
 expect(posts).toContainEqual({ type: 'erd-edit-mode', generation: 0, editing: false });
});

it('replaces the read-only diagram with the saved readback', () => {
 const listeners: Record<string, Record<string, (event: any) => void>> = {};
 const posts: any[] = [], nodes: Record<string, any> = {};
 for (const id of ['erd','vp','edit-toggle','readonly-view','edit-view','edit-feedback','edit-save','edit-toolbar','add-table','edit-revert','edit-notice']) {
  nodes[id] = {style:{}, checked:true, setAttribute() {}, addEventListener(type: string, cb: (event: any) => void) { (listeners[id] ??= {})[type] = cb; }};
 }
 const html = renderErdHtml({tables:[], relations:[], diagnostics:[]}, {cspSource:'vscode:', nonce:'abc', title:'x', editor:{schema:{tables:[], reservedIndexes:[]}, startEditing:true}});
 runInNewContext(html.match(/<script nonce="abc">([\s\S]*?)<\/script>/)![1], {
  document:{getElementById:(id: string) => nodes[id], querySelectorAll:() => []},
  window:{addEventListener(type: string, cb: (event: any) => void) { (listeners.window ??= {})[type] = cb; }},
  acquireVsCodeApi:() => ({postMessage:(message: any) => posts.push(message)}),
 });
 listeners['edit-save'].click({});
 listeners.window.message({data:{type:'erd-edit-state', generation:0, requestId:posts[0].requestId, diagram:'edited', feedback:'', readonly:'saved readback', canSave:true}});
 expect(nodes['readonly-view'].innerHTML).toBe('saved readback');
});

it('queues the alias request arriving during mode-off until acknowledgement', () => {
 const listeners: Record<string, Record<string, (event: any) => void>> = {};
 const posts: any[] = [];
 const nodes: Record<string, any> = {};
 for (const id of ['erd','vp','edit-toggle','readonly-view','edit-view','edit-feedback','edit-save','edit-toolbar','add-table','edit-revert','edit-notice']) {
  nodes[id] = { style: {}, checked: true, setAttribute() {}, addEventListener(type: string, cb: (event: any) => void) { (listeners[id] ??= {})[type] = cb; } };
 }
 const html = renderErdHtml({ tables: [], relations: [], diagnostics: [] }, {cspSource:'vscode:', nonce:'abc', title:'x', editor:{schema:{tables:[], reservedIndexes:[]}, startEditing:true}});
 runInNewContext(html.match(/<script nonce="abc">([\s\S]*?)<\/script>/)![1], {
  document:{getElementById:(id: string) => nodes[id], querySelectorAll:() => []},
  window:{addEventListener(type: string, cb: (event: any) => void) { (listeners.window ??= {})[type] = cb; }},
  acquireVsCodeApi:() => ({postMessage:(message: any) => posts.push(message)}),
 });
 nodes['edit-toggle'].checked = false;
 listeners['edit-toggle'].change({});
 listeners.window.message({data:{type:'erd-enable-edit', generation:0}});
 listeners.window.message({data:{type:'erd-edit-mode-state', generation:0, editing:false}});
 expect(posts).toEqual([{type:'erd-edit-mode', generation:0, editing:false}, {type:'erd-edit-mode', generation:0, editing:true}]);
 expect(nodes['edit-view'].style.display).toBe('none');
 listeners.window.message({data:{type:'erd-edit-mode-state', generation:0, editing:true}});
 expect(nodes['edit-view'].style.display).toBe('');
});
