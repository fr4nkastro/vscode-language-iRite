import { describe, expect, it } from 'vitest';
import { ErdDraft } from '../../src/erd/erdDraft';
import { renderErdDraft } from '../../src/erd/erdDraftHtml';
import { ERD_DRAFT_STYLE } from '../../src/erd/erdDraftStyle';
import { renderErdHtml } from '../../src/erd/erdHtml';
import { fieldTypes } from '../../src/dbschema/fieldTypes';
import { harness } from './draftVmHarness';
import type { DbSchema } from '../../src/dbschema/model';

const f = (name: string, typeCode: number, size: number) => ({ name, typeCode, typeName: 'integer' as const, size });
const three: DbSchema = { reservedIndexes: [], tables: ['One', 'Two', 'Three'].map((name, i) => ({ index: i + 1, name, maxRecords: 10, fields: [f('Id', 3, 4)] })) };
const tags = (html: string, re: RegExp): string[] => html.match(re) ?? [];

describe('visual fidelity markup', () => {
 it('marks only the selected table row as selected', () => {
  const view = new ErdDraft(three).view();
  for (const [selected, name] of [[view.tables[1].key, 'Two'], [undefined, 'One']] as const) {
   const html = renderErdDraft(view, selected);
   const rows = tags(html, /<li class="[^"]*">/g);
   expect(rows).toHaveLength(3);
   const marked = html.match(/<li class="[^"]*is-selected[^"]*">[\s\S]*?<\/li>/g) ?? [];
   expect(marked).toHaveLength(1);
   expect(marked[0]).toContain(`<span class="t-name">${name}`);
   expect(marked[0]).toContain('aria-current="true"');
   expect(tags(html, /aria-current/g)).toHaveLength(1);
  }
 });
 it('locks size inputs of every fixed-size type and leaves strings editable', () => {
  const types = fieldTypes.filter(t => t.code !== 0);
  const schema: DbSchema = { reservedIndexes: [], tables: [{ index: 1, name: 'T', maxRecords: 1, fields: types.map(t => f(`F${t.code}`, t.code, t.defaultSize)) }] };
  const inputs = tags(renderErdDraft(new ErdDraft(schema).view()), /<input[^>]*data-property="size"[^>]*>/g);
  expect(inputs).toHaveLength(types.length);
  inputs.forEach((tag, i) => expect(/\sreadonly(\s|>)/.test(tag), types[i].name).toBe(!types[i].variable));
 });
 it('renders sidebar meta, header labels, stats and byte units', () => {
  const schema: DbSchema = { reservedIndexes: [], tables: [{ index: 1, name: 'Inbound', maxRecords: 1000, fields: [f('IdPlate', 7, 15), f('InWeight', 4, 4), f('InDT', 7, 20)] }] };
  const html = renderErdDraft(new ErdDraft(schema).view());
  expect(html).toContain('Tables <span');
  expect(html).toContain('1/128');
  expect(html).toContain('3 fields · 39.0 KB');
  expect(html).toContain('7/8 chars'); expect(html).toContain('up to 2,000,000');
  expect(html).toMatch(/Fields <b>3<\/b>\/100/); expect(html).toMatch(/Record <b>39 B<\/b>/); expect(html).toMatch(/Table <b>39\.0 KB<\/b>/);
  expect(html).toContain('or press <kbd>Enter</kbd> in the last field name');
  expect(html).not.toMatch(/duplicate/i);
  expect(html).toContain('aria-label="Remove table"');
  expect(html).toContain('aria-label="Move field up"');
 });
 it('shows footer totals, plain record total and problem counts (the validator always reports one unconfirmed-limits warning)', () => {
  const d = new ErdDraft(three); const t = d.view().tables[0];
  expect(renderErdDraft(d.view())).toMatch(/Storage[\s\S]*120 B \/ 460 MB[\s\S]*Tables[\s\S]*3 \/ 128[\s\S]*Records[\s\S]*<b>30<\/b>[\s\S]*0 errors[\s\S]*1 warnings/);
  d.apply({ kind: 'setTable', table: t.key, property: 'name', value: 'bad name' });
  expect(renderErdDraft(d.view())).toContain('1 errors');
  const big = new ErdDraft({ reservedIndexes: [], tables: [{ index: 1, name: 'B', maxRecords: 115000001, fields: [f('A', 3, 4)] }] }).view();
  expect(renderErdDraft(big)).toContain('2 warnings');
 });
 it('keeps themed CSS on vscode variables, stacked at 760px, with no inline styles', () => {
  expect(ERD_DRAFT_STYLE).toContain('max-width: 760px');
  expect(ERD_DRAFT_STYLE).toContain('260px');
  expect(ERD_DRAFT_STYLE.replace(/var\([^;{}]*?\)\)?/g, '')).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  const html = renderErdHtml({ tables: [], relations: [], diagnostics: [] }, { cspSource: 'v:', nonce: 'abc', title: 'Database diagram: DOLE', editor: { schema: three, startEditing: true } });
  expect(html).not.toMatch(/\sstyle\s*=/i); expect(html).toContain("style-src 'nonce-abc'"); expect(html).not.toContain("'unsafe-inline'");
  expect(html).toContain('<h1>'); expect(html).toContain('Database: <span class="mono">DOLE</span>');
  expect(html).toMatch(/<header[^>]*>[\s\S]*id="diagram-mode"[\s\S]*id="edit-toolbar"[\s\S]*id="edit-errors"[\s\S]*id="edit-revert"[\s\S]*id="edit-save"[\s\S]*<\/header>/);
 });
});

describe('Enter in the last field name', () => {
 const nameInput = (field: string) => ({ dataset: { action: 'setField', table: 'draft-1', field, property: 'name' }, tagName: 'INPUT' });
 const press = (h: ReturnType<typeof harness>, target: unknown, options: object = {}) => { let prevented = false; h.listeners['edit-view'].keydown({ key: 'Enter', isComposing: false, target, preventDefault() { prevented = true; }, ...options }); return prevented; };
 it('adds a field only from the last live field name', () => {
  const h = harness(); h.ack(); const [a, , c] = h.draft.view().tables[0].fields;
  expect(press(h, nameInput(a.key))).toBe(false); expect(h.posts).toHaveLength(1);
  expect(press(h, nameInput(c.key))).toBe(true);
  expect(h.posts).toHaveLength(2);
  expect(h.posts[1].message).toEqual({ type: 'draft-action', action: { kind: 'addField', table: 'draft-1', name: '', typeCode: 3 } });
 });
 it('ignores IME composition, other keys, other controls and disabled editing', () => {
  const h = harness(); h.ack(); const c = h.draft.view().tables[0].fields[2];
  press(h, nameInput(c.key), { isComposing: true }); press(h, nameInput(c.key), { key: 'a' });
  press(h, { ...nameInput(c.key), dataset: { ...nameInput(c.key).dataset, property: 'size' } });
  expect(h.posts).toHaveLength(1);
  const off = harness(false); expect(off.posts).toHaveLength(0); press(off, nameInput('draft-4')); expect(off.posts).toHaveLength(0);
 });
 it('shows the error count in the toolbar badge', () => {
  const h = harness(); h.draft.apply({ kind: 'setTable', table: 'draft-1', property: 'name', value: 'bad name' }); h.ack();
  expect(h.nodes['edit-errors'].textContent).toBe('1 error'); expect(h.nodes['edit-errors'].hidden).toBe(false);
  expect(h.nodes['edit-count'].textContent).toBe('1 pending change');
 });
 it('says there are no unsaved changes when clean', () => {
  const h = harness(); h.ack(); expect(h.nodes['edit-count'].textContent).toBe('No unsaved changes'); expect(h.nodes['edit-errors'].hidden).toBe(true);
 });
});
