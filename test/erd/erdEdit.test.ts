import { describe, expect, it } from 'vitest';
import { renderErdHtml } from '../../src/erd/erdHtml';
import { renderErdEditState } from '../../src/erd/erdEdit';
import type { DbSchema } from '../../src/dbschema/model';

const erd = { tables: [], relations: [], diagnostics: [] };
const opts = { cspSource: 'vscode:', nonce: 'abc', title: '<title>' };
const schema: DbSchema = { reservedIndexes: [], tables: [
 { index: 1, name: 'Dup', maxRecords: 10, fields: [{ name: 'A', typeCode: 3, typeName: 'integer', size: 4 }, { name: '<raw>', typeCode: 99, typeName: 'unknown', size: 2 }] },
 { index: 2, name: 'Dup', maxRecords: 20, fields: [] },
] };

describe('ERD editing view', () => {
 it('defaults to read-only and explains unavailable rev; preserves navigation', () => {
  const html = renderErdHtml(erd, opts);
  expect(html).toContain('Edit schema'); expect(html).toContain('No .rev');
  expect(html).toContain('disabled'); expect(html).toContain('wheel'); expect(html).toContain("type: 'open'");
  expect(html).toContain('&lt;title&gt;'); expect(html).toContain("script-src 'nonce-abc'");
 });
 it('renders duplicate invalid drafts as indexed editable cards, raw unknown fields and validation', () => {
  const state = renderErdEditState(schema, { hint: '<hint>', message: '<error>' });
  expect(state.diagram).toContain('foreignObject');
  expect(state.diagram).toContain('data-table="1"'); expect(state.diagram).toContain('data-table="2"');
  expect(state.diagram).toContain('data-action="addField"'); expect(state.diagram).toContain('data-action="deleteTable"');
  expect(state.diagram).toContain('&lt;raw&gt;'); expect(state.diagram).toContain('99');
  expect(state.diagram).not.toContain('data-field="1"');
  expect(state.feedback).toContain('duplicate name'); expect(state.feedback).toContain('&lt;hint&gt;'); expect(state.feedback).toContain('&lt;error&gt;');
  expect(state.canSave).toBe(false);
 });
 it('renders initial edit mode and protocol without replacing the full page', () => {
  const html = renderErdHtml(erd, { ...opts, editor: { schema, startEditing: true } });
  expect(html).toContain('data-editing="true"'); expect(html).toContain('data-table="1"');
  expect(html).toContain('erd-edit-state'); expect(html).toContain('requestId');
  expect(html).toContain('foreignObject'); expect(html).toContain('nonce="abc"');
 });
});
