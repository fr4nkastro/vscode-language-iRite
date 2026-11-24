import { describe, expect, it } from 'vitest';
import { renderErdHtml } from '../../src/erd/erdHtml';
import { ErdDraft } from '../../src/erd/erdDraft';
import { canSaveErdDraft, renderErdDraft } from '../../src/erd/erdDraftHtml';
import type { DbSchema } from '../../src/dbschema/model';

const erd = { tables: [], relations: [], diagnostics: [] };
const opts = { cspSource: 'vscode:', nonce: 'abc', title: '<title>' };
const schema: DbSchema = { reservedIndexes: [], tables: [
 { index: 1, name: 'Dup', maxRecords: 10, fields: [{ name: 'A', typeCode: 3, typeName: 'integer', size: 4 }, { name: '<raw>', typeCode: 99, typeName: 'unknown', size: 2 }] },
 { index: 2, name: 'Dup', maxRecords: 20, fields: [] },
] };

describe('ERD editing view', () => {
 it('shows safe estimates and warns only above the designer threshold', () => {
  const make = (count: number): DbSchema => ({reservedIndexes: [], tables:[{index:1,name:'T',maxRecords:count,fields:[{name:'A',typeCode:3,typeName:'integer',size:4}]}]});
  let view = new ErdDraft(make(115000000)).view();
  let html = renderErdDraft(view);
  expect(html).toMatch(/Record <b>4 B<\/b>[\s\S]*Table <b>460 MB<\/b>/);
  expect(html).toContain('<b>460 MB / 460 MB</b>');
  expect(html).not.toContain('Designer byte threshold exceeded');
  view = new ErdDraft(make(115000001)).view(); html = renderErdDraft(view);
  expect(html).toContain('Designer byte threshold exceeded');
  view = new ErdDraft(make(Number.MAX_SAFE_INTEGER)).view(); html = renderErdDraft(view);
  expect(html).toContain('<b>Unknown / 460 MB</b>');
 });
 it('defaults to read-only and explains unavailable rev; preserves navigation', () => {
  const html = renderErdHtml(erd, opts);
  expect(html).toContain('Edit schema'); expect(html).toContain('No .rev');
  expect(html).toContain('disabled'); expect(html).toContain('wheel'); expect(html).toContain("type: 'open'");
  expect(html).toContain('&lt;title&gt;'); expect(html).toContain("script-src 'nonce-abc'");
 });
 it('renders duplicate invalid drafts as indexed editable cards, raw unknown fields and validation', () => {
  const view = new ErdDraft(schema).view();
  const html = renderErdDraft(view);
  expect(html).not.toContain('foreignObject');
  expect(html).toContain(`data-table="${view.tables[0].key}"`); expect(html).toContain(`data-table="${view.tables[1].key}"`);
  expect(html).toContain('data-action="addField"'); expect(html).toContain('data-action="removeTable"');
  expect(html).toContain('&lt;raw&gt;'); expect(html).toContain('Unknown (99)');
  expect(html).toMatch(/data-property="typeCode" disabled><option value="99"/);
  expect(view.issues.some(issue => issue.message.includes('duplicate name'))).toBe(true);
  expect(canSaveErdDraft(view)).toBe(false);
 });
 it('renders initial edit mode and protocol without replacing the full page', () => {
  const html = renderErdHtml(erd, { ...opts, editor: { schema, startEditing: true } });
  expect(html).toContain('let editing = true, available = true'); expect(html).toContain('data-table="draft-1"');
  expect(html).toContain('erd-edit-state'); expect(html).toContain('requestId');
  expect(html).toContain("kind:'addField', table, name:'', typeCode:DEFAULT_NEW_FIELD_TYPE");
  expect(html).toContain("kind:'addTable', name:'', maxRecords:'1'");
  expect(html).not.toContain('foreignObject'); expect(html).toContain('nonce="abc"');
 });
});
