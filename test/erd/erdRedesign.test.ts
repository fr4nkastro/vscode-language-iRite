import { describe, expect, it } from 'vitest';
import { ErdDraft } from '../../src/erd/erdDraft';
import { renderErdDraft, canSaveErdDraft } from '../../src/erd/erdDraftHtml';
import { ERD_DRAFT_STYLE } from '../../src/erd/erdDraftStyle';
import type { DbSchema } from '../../src/dbschema/model';

const schema: DbSchema = { reservedIndexes: [], tables: [{ index: 1, name: 'Orders', maxRecords: 10, fields: [{ name: 'Id', typeCode: 3, typeName: 'integer', size: 4 }, { name: 'Text', typeCode: 7, typeName: 'string', size: 20 }] }] };

describe('schema editor draft presentation', () => {
 it('renders master-detail, catalog size controls, totals and no per-row apply', () => {
  const view = new ErdDraft(schema).view(); const html = renderErdDraft(view);
  expect(html).toContain('Filter tables'); expect(html).toContain('data-action="addTable"');
  expect(html).toContain('Orders'); expect(html).toContain('240');
  expect(html).toMatch(/data-property="size"[^>]*readonly/);
  expect(html).toMatch(/data-property="size"[^>]*value="20"(?![^>]*readonly)/);
  expect(html).toContain('<progress'); expect(html).not.toContain('Apply column'); expect(html).not.toContain('Apply table');
  expect(ERD_DRAFT_STYLE).toContain('--vscode-'); expect(html).not.toContain('style=');
 });
 it('escapes data, locates diagnostics, exposes tombstones and gates save on errors', () => {
  const d = new ErdDraft(schema); const t = d.view().tables[0]; const f = t.fields[0];
  d.apply({kind:'setTable',table:t.key,property:'name',value:'<bad"&'});
  d.apply({kind:'setField',table:t.key,field:f.key,property:'name',value:'bad name'});
  d.apply({kind:'removeField',table:t.key,field:t.fields[1].key});
  const view = d.view(); const html = renderErdDraft(view, t.key);
  expect(canSaveErdDraft(view)).toBe(false); expect(canSaveErdDraft(new ErdDraft(schema).view())).toBe(true);
  expect(html).toContain('&lt;bad&quot;&amp;'); expect(html).not.toContain('<bad"&');
  expect(html).toContain('data-property="name"'); expect(html).toContain('invalid or missing iRite identifier');
  expect(html).toContain('data-action="restoreField"'); expect(html).toContain('is-removed');
  expect(html).toContain('data-action="moveField"');
 });
});
