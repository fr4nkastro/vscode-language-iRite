import { it, expect } from 'vitest';
import { runInNewContext } from 'node:vm';
import { renderErdHtml } from '../../src/erd/erdHtml';

it('restores keyboard focus to the matching action after acknowledgement', () => {
 const listeners: Record<string, Record<string, (e: any) => void>> = {};
 const posts: any[] = [];
 let focused = false;
 const table = { dataset: { table: '1' } };
 const field = { dataset: { field: '0' } };
 const button = { dataset: { action: 'addField' }, closest: (s: string) => s === 'button[data-action]' ? button : s === '[data-table]' ? table : s === '[data-field]' ? field : null };
 const elements: Record<string, any> = {};
 for (const id of ['erd','vp','edit-toggle','readonly-view','edit-view','edit-feedback','edit-save','edit-toolbar','add-table','edit-revert','edit-notice']) {
  elements[id] = { style: {}, checked: true, disabled: false, setAttribute() {}, addEventListener(type: string, cb: (e: any) => void) { (listeners[id] ??= {})[type] = cb; }, querySelector: () => ({ focus() { focused = true; } }) };
 }
 const doc = { getElementById: (id: string) => elements[id], querySelectorAll: () => [], activeElement: button };
 const win = { addEventListener(type: string, cb: (e: any) => void) { (listeners.window ??= {})[type] = cb; } };
 const html = renderErdHtml({ tables: [], relations: [], diagnostics: [] }, { cspSource: 'vscode:', nonce: 'abc', title: 'x' });
 const script = html.match(/<script nonce="abc">([\s\S]*?)<\/script>/)![1];
 runInNewContext(script, { document: doc, window: win, acquireVsCodeApi: () => ({ postMessage: (m: any) => posts.push(m) }) });
 listeners['edit-view'].click({ target: button });
 expect(posts).toHaveLength(1);
 listeners.window.message({ data: { type: 'erd-edit-state', requestId: posts[0].requestId + 1, diagram: 'stale', feedback: 'stale', canSave: true } });
 expect(elements['edit-feedback'].innerHTML).not.toBe('stale');
 expect(focused).toBe(false);
 listeners.window.message({ data: { type: 'erd-edit-state', requestId: posts[0].requestId, diagram: '', feedback: 'Edit rejected', canSave: true } });
 expect(elements['edit-feedback'].innerHTML).toBe('Edit rejected');
 expect(focused).toBe(true);
});
