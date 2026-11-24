import type { ErdDraft, DraftIssue } from './erdDraft';
import { editableFieldType, fieldTypes } from '../dbschema/fieldTypes';
import { MAX_FIELDS, MAX_NAME_LENGTH, MAX_RECORDS, MAX_TABLES } from '../dbschema/limits';
import { plural } from './erdPlural';
import { formatBytes } from './erdByteFormat';

type View = Omit<ReturnType<ErdDraft['view']>, 'schema'>;
type Table = View['tables'][number];
type Field = Table['fields'][number];
const esc = (value: unknown): string => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const count = (value: number | undefined): string => value === undefined ? 'Unknown' : value.toLocaleString('en-US');
const state = (row: { removed: boolean; added: boolean; dirty: boolean; reordered?: boolean }): string => row.removed ? 'removed' : row.added ? 'added' : row.dirty || row.reordered ? 'changed' : '';
const messages = (issues: DraftIssue[]): string => issues.map(i => `<div class="draft-issue is-${esc(i.severity)}">${esc(i.message)}</div>`).join('');
const issuesAt = (view: View, table: string, field: string | undefined, property?: DraftIssue['property']): DraftIssue[] => view.issues.filter(i => i.table === table && i.field === field && i.property === property);
const attrs = (table: string, field?: string): string => `data-table="${esc(table)}"${field === undefined ? '' : ` data-field="${esc(field)}"`}`;
const button = (action: string, label: string, keys = '', extra = ''): string => `<button type="button" data-action="${action}"${keys ? ` ${keys}` : ''}${extra}>${label}</button>`;
const ICONS: Record<string, string> = {
 add: '<path d="M8 3v10M3 8h10"/>',
 remove: '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M7 7v4M9 7v4"/>',
 restore: '<path d="M3.5 8a4.5 4.5 0 1 0 1.4-3.3M3.5 2.5v2.5H6"/>',
 up: '<path d="M8 13V3M4 7l4-4 4 4"/>',
 down: '<path d="M8 3v10M4 9l4 4 4-4"/>',
 grip: '<path d="M6 4v.01M10 4v.01M6 8v.01M10 8v.01M6 12v.01M10 12v.01"/>',
};
const icon = (name: string): string => `<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;
const iconButton = (action: string, label: string, glyph: string, keys: string, extra = ''): string => `<button type="button" class="draft-icon" data-action="${action}"${keys ? ` ${keys}` : ''} aria-label="${label}" title="${label}"${extra}>${icon(glyph)}</button>`;
const sizeNumber = (raw: string): number | undefined => /^\d+$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : undefined;
/** The shell owns Save and may use this predicate for both button and shortcut. */
export const canSaveErdDraft = (view: Pick<View, 'issues'>): boolean => !view.issues.some(i => i.severity === 'error');

function fieldRow(view: View, table: Table, field: Field, ordinal: number): string {
 const keys = attrs(table.key, field.key), status = state(field), type = editableFieldType(field.typeCode);
 const disabled = table.removed || field.removed || !type ? ' disabled' : '';
 const options = (type ? '' : `<option value="${esc(field.typeCode)}" selected>Unknown (${esc(field.typeCode)})</option>`) + fieldTypes.filter(t => t.code !== 0).map(t => `<option value="${t.code}"${t.code === field.typeCode ? ' selected' : ''}>${esc(t.name)}</option>`).join('');
 const found = { name: issuesAt(view, table.key, field.key, 'name'), size: issuesAt(view, table.key, field.key, 'size') };
 const input = (property: 'name' | 'size', value: string, readonly = false) => {
  const bad = found[property].some(i => i.severity === 'error');
  return `<input aria-label="Field ${property}" data-action="setField" ${keys} data-property="${property}" value="${esc(value)}"${bad ? ' aria-invalid="true" class="is-invalid"' : ''}${readonly ? ' readonly' : ''}${disabled}>`;
 };
 const moveOff = table.removed || !type ? ' disabled' : '';
 const actions = field.removed
  ? iconButton('restoreField', 'Restore field', 'restore', keys, table.removed ? ' disabled' : '')
  : iconButton('moveField', 'Move field up', 'up', keys, ` data-direction="up"${moveOff}`) + iconButton('moveField', 'Move field down', 'down', keys, ` data-direction="down"${moveOff}`) + iconButton('removeField', 'Remove field', 'remove', keys, table.removed ? ' disabled' : '');
 return `<tr class="${status ? `is-${status}` : ''}" data-field-row ${keys} draggable="${!table.removed && !field.removed && !!type}"><td class="col-grip" aria-hidden="true">${icon('grip')}</td><td class="col-idx">${field.removed ? '' : ordinal}</td><td><div class="cell-name">${input('name', field.name)}${status ? `<span class="draft-status">${esc(status)}</span>` : ''}</div>${messages(found.name)}</td><td><select aria-label="Field type" data-action="setField" ${keys} data-property="typeCode"${disabled}>${options}</select>${messages(issuesAt(view, table.key, field.key, 'typeCode'))}</td><td class="col-num">${input('size', field.size, !type?.variable)}${messages(found.size)}</td><td class="col-num col-bytes">${esc(formatBytes(sizeNumber(field.size)))}</td><td class="col-acts">${actions}</td></tr>`;
}
function detail(view: View, table: Table): string {
 const keys = attrs(table.key), disabled = table.removed ? ' disabled' : '';
 const input = (property: 'name' | 'maxRecords', label: string, value: string, note: string) => {
  const found = issuesAt(view, table.key, undefined, property), bad = found.some(i => i.severity === 'error');
  return `<div class="draft-field"><label>${label}<input data-action="setTable" ${keys} data-property="${property}" value="${esc(value)}"${bad ? ' aria-invalid="true" class="is-invalid"' : ''}${disabled}></label><div class="draft-note">${note}</div>${messages(found)}</div>`;
 };
 const live = table.fields.filter(f => !f.removed).length;
 let ordinal = 0;
 const stats = `<div class="draft-stats"><span>Fields <b>${live}</b>/${MAX_FIELDS}</span><span>Record <b>${esc(formatBytes(table.recordBytes))}</b></span><span>Table <b>${esc(formatBytes(table.totalBytes))}</b></span></div>`;
 const tableAction = table.removed ? iconButton('restoreTable', 'Restore table', 'restore', keys) : iconButton('removeTable', 'Remove table', 'remove', keys);
 return `<section class="draft-detail" data-detail ${keys}><div class="draft-thead">${input('name', 'Table name', table.name, `${table.name.length}/${MAX_NAME_LENGTH} chars`)}${input('maxRecords', 'Max records', table.maxRecords, `up to ${count(MAX_RECORDS)}`)}${stats}<div class="draft-tbl-actions">${tableAction}</div></div>${messages(issuesAt(view, table.key, undefined, 'fields'))}<table class="draft-cols"><thead><tr><th class="col-grip"></th><th class="col-idx">#</th><th>Name</th><th>Type</th><th class="col-num">Size</th><th class="col-num col-bytes">Bytes</th><th class="col-acts"><span class="draft-sr">Actions</span></th></tr></thead><tbody>${table.fields.map(f => fieldRow(view, table, f, f.removed ? 0 : ++ordinal)).join('')}</tbody></table><div class="draft-addrow">${button('addField', `${icon('add')}<span>Add field</span>`, keys, ` class="draft-link"${disabled}`)}<span class="draft-hint">or press <kbd>Enter</kbd> in the last field name</span></div></section>`;
}
/** Fragment only: host owns event handling, filter persistence, and the outer CSP. */
export function renderErdDraft(view: View, selected?: string): string {
 const current = view.tables.find(t => t.key === selected) ?? view.tables[0];
 const biggest = Math.max(1, ...view.tables.map(t => t.totalBytes ?? 0));
 const list = view.tables.map(t => {
  const status = state(t), live = t.fields.filter(f => !f.removed).length, errors = view.issues.filter(i => i.table === t.key && i.severity === 'error').length, isCurrent = current?.key === t.key;
  const dot = errors ? `<span class="draft-dot is-error" role="img" aria-label="${plural(errors, 'error')}"></span>` : status ? `<span class="draft-dot is-${status}" role="img" aria-label="${status}"></span>` : '';
  const bar = t.totalBytes === undefined ? '' : `<progress class="t-bar" value="${esc(t.totalBytes)}" max="${biggest}" aria-hidden="true"></progress>`;
  return `<li class="${[status ? `is-${status}` : '', isCurrent ? 'is-selected' : ''].filter(Boolean).join(' ')}"><button type="button" data-action="selectTable" ${attrs(t.key)}${isCurrent ? ' aria-current="true"' : ''}><span class="t-name">${esc(t.name)}${dot}</span><span class="t-meta">${live} fields · ${esc(formatBytes(t.totalBytes))}</span>${bar}</button></li>`;
 }).join('');
 const meter = (label: string, text: string, value: number | undefined, max: number, over = false) => `<div class="draft-meter${over ? ' is-over' : ''}"><span>${label}</span>${value === undefined ? '' : `<progress value="${esc(Math.min(value, max))}" max="${max}"></progress>`}<b>${esc(text)}</b></div>`;
 const b = view.budget, errors = view.issues.filter(i => i.severity === 'error').length, warnings = view.issues.filter(i => i.severity === 'warning').length + (b.overThreshold ? 1 : 0);
 return `<div class="erd-draft"><div class="draft-layout"><aside><div class="draft-side-head"><span>Tables <span class="draft-pill">${view.budget.tables}/${MAX_TABLES}</span></span>${iconButton('addTable', 'Add table', 'add', '')}</div><div class="draft-filter"><input type="search" data-action="filterTables" aria-label="Filter tables" placeholder="Filter tables"></div><ul class="draft-list">${list}</ul></aside>${current ? detail(view, current) : '<section class="draft-detail">No table selected.</section>'}</div><div class="draft-global-issues">${messages(view.issues.filter(i => i.table === undefined))}</div><footer class="draft-budget">${meter('Storage', `${formatBytes(b.bytes)} / ${formatBytes(b.threshold)}`, b.bytes, b.threshold, b.overThreshold)}${meter('Tables', `${b.tables} / ${MAX_TABLES}`, b.tables, MAX_TABLES)}<div class="draft-meter"><span>Records (all tables)</span><b>${esc(count(b.records))}</b></div>${b.overThreshold ? '<span class="draft-issue is-warning">Designer byte threshold exceeded (warning).</span>' : ''}<span class="draft-problems"><span class="is-error">● ${plural(errors, 'error')}</span><span class="is-warning">▲ ${plural(warnings, 'warning')}</span></span></footer></div>`;
}
