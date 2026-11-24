import { describe, expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';
import { renderErdHtml } from '../../src/erd/erdHtml';
import { editDbSchema, validateDbSchema, type DbSchema } from '../../src/dbschema/model';

const schema: DbSchema = { reservedIndexes: [], tables: [{ index: 1, name: 'Table1', maxRecords: 1, fields: [{ name: 'Field1', typeCode: 3, typeName: 'integer', size: 4 }] }] };

function harness() {
 const listeners: Record<string, Record<string, (e: any) => void>> = {};
 const nodes: Record<string, any> = {};
 for (const id of ['erd', 'vp', 'edit-toggle', 'readonly-view', 'edit-view', 'edit-feedback', 'edit-save', 'edit-toolbar', 'add-table', 'edit-revert', 'edit-notice']) nodes[id] = { style: {}, checked: true, setAttribute() {}, addEventListener(type: string, cb: (e: any) => void) { (listeners[id] ??= {})[type] = cb; } };
 const html = renderErdHtml({ tables: [], relations: [], diagnostics: [] }, { cspSource: 'vscode:', nonce: 'abc', title: 'x', editor: { schema, startEditing: true } });
 const options = [...html.matchAll(/<option value="(\d+)" data-size="(\d+)" data-variable="(?:true|false)"( selected)?>/g)].map(m => ({ value: m[1], dataset: { size: m[2] }, selected: !!m[3] }));
 class FakeEvent { constructor(public type: string, public init: { bubbles: boolean }) {} }
 runInNewContext(html.match(/<script nonce="abc">([\s\S]*?)<\/script>/)![1], { document: { getElementById: (id: string) => nodes[id] }, window: { addEventListener() {} }, Event: FakeEvent });
 const events: string[] = [];
 const size = { tagName: 'INPUT', value: '4', defaultValue: '4', matches: () => true, dispatchEvent(e: FakeEvent) { events.push('size:' + e.type + ':' + e.init.bubbles); listeners['edit-view'][e.type]({ target: size }); } };
 const row = { querySelector: (s: string) => s === '[data-value=size]' ? size : null };
 const select = { tagName: 'SELECT', value: '3', defaultValue: undefined, selectedOptions: [options.find(o => o.value === '3')!], matches: () => true, closest: () => row as typeof row | null, querySelector: () => options.find(o => o.selected), dispatchEvent(e: FakeEvent) { events.push('select:' + e.type + ':' + e.init.bubbles); listeners['edit-view'][e.type]({ target: select }); } };
 function change(code: number) { select.value = String(code); select.selectedOptions = [options.find(o => o.value === select.value)!]; listeners['edit-view'].change({ target: select }); }
 return { listeners, nodes, events, size, select, change };
}

describe('generated ERD type change handler', () => {
 it.each([[1, 1], [6, 20], [7, 20]])('resets type %i to default %i and preserves subsequent valid string size in the model', (code, expected) => {
  const h = harness();
  h.size.value = '37';
  h.change(code);
  expect(h.size.value).toBe(String(expected));
  expect(h.events).toEqual(['size:input:true', 'select:input:true']);
  let model = editDbSchema(schema, { kind: 'updateField', table: 1, field: 0, changes: { typeCode: code, size: Number(h.size.value) } });
  expect(model.tables[0].fields[0].size).toBe(expected);
  if (code === 6 || code === 7) {
   h.size.value = '37';
   model = editDbSchema(model, { kind: 'updateField', table: 1, field: 0, changes: { size: Number(h.size.value) } });
   expect(model.tables[0].fields[0].size).toBe(37);
   expect(validateDbSchema(model).errors).toEqual([]);
  }
  h.listeners['edit-revert'].click({});
  expect(h.select.value).toBe('3');
  expect(h.size.value).toBe('4');
 });
 it('ignores a select outside a field row and non-select changes', () => {
  const h = harness();
  h.select.closest = () => null;
  expect(() => h.listeners['edit-view'].change({ target: h.select })).not.toThrow();
  expect(() => h.listeners['edit-view'].change({ target: h.size })).not.toThrow();
  expect(h.events).toEqual([]);
  expect(h.size.value).toBe('4');
 });
});
