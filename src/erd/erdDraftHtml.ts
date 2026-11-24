import type { ErdDraft, DraftIssue } from './erdDraft';
import { editableFieldType, fieldTypes } from '../dbschema/fieldTypes';
import { MAX_TABLES } from '../dbschema/limits';

type View = Omit<ReturnType<ErdDraft['view']>, 'schema'>;
type Table = View['tables'][number];
type Field = Table['fields'][number];
const esc = (value: unknown): string => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const display = (value: number | undefined): string => value === undefined ? 'Unknown' : String(value);
const state = (row: { removed: boolean; added: boolean; dirty: boolean; reordered?: boolean }): string => row.removed ? 'removed' : row.added ? 'added' : row.dirty || row.reordered ? 'changed' : '';
const messages = (issues: DraftIssue[]): string => issues.map(i => `<div class="draft-issue is-${esc(i.severity)}">${esc(i.message)}</div>`).join('');
const issuesAt = (view: View, table: string, field: string | undefined, property?: DraftIssue['property']): DraftIssue[] => view.issues.filter(i => i.table === table && i.field === field && i.property === property);
const attrs = (table: string, field?: string): string => `data-table="${esc(table)}"${field === undefined ? '' : ` data-field="${esc(field)}"`}`;
const button = (action: string, label: string, keys = '', extra = ''): string => `<button type="button" data-action="${action}"${keys ? ` ${keys}` : ''}${extra}>${label}</button>`;
/** The shell owns Save and may use this predicate for both button and shortcut. */
export const canSaveErdDraft = (view: Pick<View, 'issues'>): boolean => !view.issues.some(i => i.severity === 'error');

function fieldRow(view: View, table: Table, field: Field, ordinal: number): string {
 const keys = attrs(table.key, field.key), status = state(field), type = editableFieldType(field.typeCode);
 const disabled = table.removed || field.removed || !type ? ' disabled' : '';
 const options = (type ? '' : `<option value="${esc(field.typeCode)}" selected>Unknown (${esc(field.typeCode)})</option>`) + fieldTypes.filter(t => t.code !== 0).map(t => `<option value="${t.code}"${t.code === field.typeCode ? ' selected' : ''}>${esc(t.name)}</option>`).join('');
 const input = (property: 'name' | 'size', value: string, readonly = false) => `<input aria-label="Field ${property}" data-action="setField" ${keys} data-property="${property}" value="${esc(value)}"${readonly ? ' readonly' : ''}${disabled}>${messages(issuesAt(view, table.key, field.key, property))}`;
 return `<tr class="${status ? `is-${status}` : ''}" data-field-row ${keys} draggable="${!table.removed && !field.removed}"><td>${ordinal}</td><td>${input('name', field.name)}${status ? `<span class="draft-status">${esc(status)}</span>` : ''}</td><td><select aria-label="Field type" data-action="setField" ${keys} data-property="typeCode"${disabled}>${options}</select>${messages(issuesAt(view, table.key, field.key, 'typeCode'))}</td><td>${input('size', field.size, !type?.variable)}</td><td>${esc(field.size)}</td><td>${field.removed ? button('restoreField', 'Restore', keys, table.removed ? ' disabled' : '') : button('removeField', 'Remove', keys, table.removed ? ' disabled' : '')}${!field.removed ? button('moveField', 'Move up', keys, ` data-direction="up"${table.removed ? ' disabled' : ''}`) + button('moveField', 'Move down', keys, ` data-direction="down"${table.removed ? ' disabled' : ''}`) : ''}</td></tr>`;
}
function detail(view: View, table: Table): string {
 const keys = attrs(table.key), disabled = table.removed ? ' disabled' : '';
 const input = (property: 'name' | 'maxRecords', label: string, value: string) => `<label>${label}<input data-action="setTable" ${keys} data-property="${property}" value="${esc(value)}"${disabled}></label>${messages(issuesAt(view, table.key, undefined, property))}`;
 let ordinal = 0;
 return `<section class="draft-detail" data-detail ${keys}><h2>${esc(table.name)}</h2>${input('name', 'Table name', table.name)}${input('maxRecords', 'Maximum records', table.maxRecords)}${table.removed ? button('restoreTable', 'Restore table', keys) : button('removeTable', 'Remove table', keys)}${messages(issuesAt(view, table.key, undefined, 'fields'))}<table><thead><tr><th>#</th><th>Name</th><th>Type</th><th>Size</th><th>Bytes</th><th>Actions</th></tr></thead><tbody>${table.fields.map(f => fieldRow(view, table, f, f.removed ? 0 : ++ordinal)).join('')}</tbody></table>${button('addField', 'Add field', keys, disabled)}<p>Bytes per record: ${esc(display(table.recordBytes))} · Bytes per table: ${esc(display(table.totalBytes))}</p></section>`;
}
/** Fragment only: host owns event handling, filter persistence, and the outer CSP. */
export function renderErdDraft(view: View, selected?: string): string {
 const current = view.tables.find(t => t.key === selected) ?? view.tables[0];
 const list = view.tables.map(t => { const status = state(t), count = t.fields.filter(f => !f.removed).length, errors = view.issues.filter(i => i.table === t.key && i.severity === 'error').length; return `<li class="${status ? `is-${status}` : ''}"><button type="button" data-action="selectTable" ${attrs(t.key)}${current?.key === t.key ? ' aria-current="true"' : ''}><span>${esc(t.name)}</span> <span>${count} fields · ${esc(display(t.totalBytes))} bytes</span>${status ? ` <span class="draft-status">${esc(status)}</span>` : ''}${errors ? ` <span>${errors} errors</span>` : ''}</button></li>`; }).join('');
 const meter = (label: string, value: number | undefined, max: number) => `<label>${label}: ${esc(display(value))} / ${max}${value === undefined ? '' : `<progress value="${esc(value)}" max="${max}"></progress>`}</label>`;
 return `<div class="erd-draft"><div class="draft-layout"><aside><label>Filter tables<input type="search" data-action="filterTables" aria-label="Filter tables"></label>${button('addTable', 'Add table')}<ul class="draft-list">${list}</ul></aside>${current ? detail(view, current) : '<section class="draft-detail">No table selected.</section>'}</div><div class="draft-global-issues">${messages(view.issues.filter(i => i.table === undefined))}</div><footer class="draft-budget">${meter('Tables', view.budget.tables, MAX_TABLES)}<label>Total records: ${esc(display(view.budget.records))}</label>${meter('Total bytes', view.budget.bytes, view.budget.threshold)}${view.budget.overThreshold ? '<p>Designer byte threshold exceeded (warning).</p>' : ''}<p>${view.count} pending changes</p></footer></div>`;
}
