import { describe, expect, it } from 'vitest';
import { formatBytes } from '../../src/erd/erdByteFormat';
import { plural } from '../../src/erd/erdPlural';
import { DEFAULT_NEW_FIELD_TYPE } from '../../src/erd/erdDraftProtocol';
import { MAX_NAME_LENGTH } from '../../src/dbschema/limits';
import { validateDbSchema } from '../../src/dbschema/model';
import { ErdDraft } from '../../src/erd/erdDraft';
import { renderErdDraft } from '../../src/erd/erdDraftHtml';
import { renderErdHtml } from '../../src/erd/erdHtml';
import { harness } from './draftVmHarness';
import type { DbSchema } from '../../src/dbschema/model';

const f = (name: string) => ({ name, typeCode: 3, typeName: 'integer' as const, size: 4 });
const mk = (tableName: string): DbSchema => ({ reservedIndexes: [], tables: [{ index: 1, name: tableName, maxRecords: 10, fields: [f('A')] }] });
const lastField = (h: ReturnType<typeof harness>) => h.draft.view().tables[0].fields[2].key;
const nameTarget = (field: string) => ({ dataset: { action: 'setField', table: 'draft-1', field, property: 'name' } });
const clickOn = (h: ReturnType<typeof harness>, dataset: Record<string, string>) => h.listeners['edit-view'].click({ target: { dataset, closest() { return this; } } });

describe('byte formatter decimals follow the rounded value', () => {
 it('renders values that round to 100 without decimals', () => {
  expect(formatBytes(99_999_999)).toBe('100 MB');
  expect(formatBytes(99_999_999_999)).toBe('100 GB');
  expect(formatBytes(99_994_999)).toBe('99.99 MB');
  expect(formatBytes(100_000_000)).toBe('100 MB');
  expect(formatBytes(99_995_000)).toBe('100 MB');
  expect(formatBytes(99_949)).toBe('99.9 KB');
  expect(formatBytes(999_960)).toBe('1.00 MB');
  expect(formatBytes(999_999_999)).toBe('1.00 GB');
 });
});

describe('shared name limit', () => {
 it('is 8 and the validator and the counter use it', () => {
  expect(MAX_NAME_LENGTH).toBe(8);
  const ok = 'A'.repeat(MAX_NAME_LENGTH), bad = 'A'.repeat(MAX_NAME_LENGTH + 1);
  expect(validateDbSchema(mk(ok)).errors).toEqual([]);
  expect(validateDbSchema(mk(bad)).errors.join()).toContain('maximum 8 ASCII characters');
  expect(renderErdDraft(new ErdDraft(mk(ok)).view())).toContain(`${MAX_NAME_LENGTH}/${MAX_NAME_LENGTH} chars`);
 });
});

describe('one pluralization helper', () => {
 it('pluralizes', () => { expect(plural(0, 'error')).toBe('0 errors'); expect(plural(1, 'error')).toBe('1 error'); expect(plural(2, 'warning')).toBe('2 warnings'); });
 it('footer and initial toolbar badge say 1 error / 1 warning', () => {
  const view = new ErdDraft(mk('bad name')).view();
  expect(view.issues.filter(i => i.severity === 'error')).toHaveLength(1);
  expect(renderErdDraft(view)).toMatch(/● 1 error<[\s\S]*▲ 1 warning</);
  const html = renderErdHtml({ tables: [], relations: [], diagnostics: [] }, { cspSource: 'x', nonce: 'n', title: 't', editor: { schema: mk('bad name'), startEditing: true } });
  expect(html).toMatch(/id="edit-errors"[^>]*>1 error</);
  expect(html).not.toMatch(/1 errors|1 warnings/);
 });
 it('post-ack badge matches the initial wording', () => {
  const h = harness(); h.draft.apply({ kind: 'setTable', table: 'draft-1', property: 'name', value: 'bad name' }); h.ack();
  expect(h.nodes['edit-errors'].textContent).toBe('1 error');
 });
});

describe('default new-field type', () => {
 it('is the integer type and both add-field paths send it', () => {
  expect(DEFAULT_NEW_FIELD_TYPE).toBe(3);
  const h = harness(); h.ack();
  clickOn(h, { action: 'addField', table: 'draft-1' });
  expect(h.posts.at(-1).message.action).toEqual({ kind: 'addField', table: 'draft-1', name: '', typeCode: DEFAULT_NEW_FIELD_TYPE });
  h.ack();
  h.listeners['edit-view'].keydown({ key: 'Enter', isComposing: false, preventDefault() {}, target: nameTarget(lastField(h)) });
  expect(h.posts.at(-1).message.action).toEqual({ kind: 'addField', table: 'draft-1', name: '', typeCode: DEFAULT_NEW_FIELD_TYPE });
 });
});

describe('Enter-to-add queueing and focus', () => {
 const enter = (h: ReturnType<typeof harness>, field: string) => h.listeners['edit-view'].keydown({ key: 'Enter', isComposing: false, preventDefault() {}, target: nameTarget(field) });
 const withRows = (h: ReturnType<typeof harness>) => {
  const focused: string[] = [], base = h.nodes['edit-view'].querySelectorAll;
  const rows = ['draft-2', 'draft-3', 'draft-4'].map(field => ({ dataset: { table: 'draft-1', field }, querySelector: () => ({ disabled: false, focus() { focused.push(field); } }) }));
  h.nodes['edit-view'].querySelectorAll = (s: string) => s === '[data-field-row]' ? rows : base(s);
  return focused;
 };
 it('queues Enter while a request is pending instead of dropping it', () => {
  const h = harness(); h.ack(); const last = lastField(h);
  h.change({ ...nameTarget(last), tagName: 'INPUT', value: 'Zed' });
  const before = h.posts.length; enter(h, last);
  expect(h.posts).toHaveLength(before);
  h.ack();
  expect(h.posts).toHaveLength(before + 1);
  expect(h.posts.at(-1).message.action).toMatchObject({ kind: 'addField', table: 'draft-1' });
 });
 it('moves focus to the last name after the add renders', () => {
  const h = harness(); h.ack(); const focused = withRows(h);
  enter(h, lastField(h)); h.draft.apply(h.posts.at(-1).message.action); h.ack();
  expect(focused).toEqual(['draft-4']);
 });
 it('does not focus after a rejected add nor on a later unrelated render', () => {
  const h = harness(); h.ack(); const focused = withRows(h);
  enter(h, lastField(h)); h.ack({ message: 'Database edit rejected; the original value was restored.' });
  expect(focused).toEqual([]);
  clickOn(h, { action: 'selectTable', table: 'draft-1' }); h.ack();
  expect(focused).toEqual([]);
 });
 it('does not focus on a non-render acknowledgement and clears the intent', () => {
  const h = harness(); h.ack(); const focused = withRows(h); const last = lastField(h);
  enter(h, last);
  h.change({ ...nameTarget(last), tagName: 'INPUT', value: 'Q' });
  h.draft.apply(h.posts[1].message.action); h.ack(); // add acked while another edit is queued: no render
  expect(focused).toEqual([]);
  h.ack(); clickOn(h, { action: 'selectTable', table: 'draft-1' }); h.ack();
  expect(focused).toEqual([]);
 });
});
