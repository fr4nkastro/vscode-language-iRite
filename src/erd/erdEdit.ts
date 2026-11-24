import type { DbSchema } from '../dbschema/model';
import { validateDbSchema } from '../dbschema/model';
import { editableFieldType, fieldType, fieldTypes } from '../dbschema/fieldTypes';

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const known = (n: number): boolean => !!editableFieldType(n);
const button = (action: string, label: string, attrs = ''): string => `<button type="button" data-action="${action}" ${attrs}>${label}</button>`;
/** Legacy test-only renderer; retained until its external tests are migrated. */
export function renderErdEditState(schema: DbSchema, options: { hint?: string; message?: string } = {}): { diagram: string; feedback: string; canSave: boolean } {
 const validation = validateDbSchema(schema);
 const sizes = schema.tables.map(table => {
  let record = 0;
  for (const field of table.fields) {
   if (!Number.isSafeInteger(field.size) || field.size < 0 || !Number.isSafeInteger(record + field.size)) return undefined;
   record += field.size;
  }
  const total = Number.isSafeInteger(table.maxRecords) && table.maxRecords >= 0 && Number.isSafeInteger(record * table.maxRecords) ? record * table.maxRecords : undefined;
  return { record, total };
 });
 let total: number | undefined = 0;
 for (const size of sizes) {
  if (!size || size.total === undefined || total === undefined || !Number.isSafeInteger(total + size.total)) { total = undefined; break; }
  total += size.total;
 }
 const width = 350, gap = 40, cols = Math.max(1, Math.ceil(Math.sqrt(schema.tables.length)));
 let y = 0;
 const cards: string[] = [];
 for (let start = 0; start < schema.tables.length; start += cols) {
  const row = schema.tables.slice(start, start + cols);
  let rowHeight = 0;
  row.forEach((table, col) => {
   const height = 205 + table.fields.length * 115;
   const size = sizes[start + col];
   rowHeight = Math.max(rowHeight, height);
   const fields = table.fields.map((field, index) => {
    if (!known(field.typeCode)) return `<div class="raw">${esc(field.name)} — ${fieldType(field.typeCode) ? `${esc(fieldType(field.typeCode)!.name)} (` : ''}raw type ${field.typeCode}${fieldType(field.typeCode) ? ')' : ''}, size ${field.size}</div>`;
    const options = fieldTypes.filter(t => t.code !== 0).map(t => `<option value="${t.code}" data-size="${t.defaultSize}" data-variable="${t.variable}"${t.code === field.typeCode ? ' selected' : ''}>${esc(t.name)}</option>`).join('');
    return `<div class="field" data-field="${index}"><label>Name <input data-value="name" value="${esc(field.name)}"></label><label>Type <select data-value="typeCode">${options}</select></label><label>Size <input data-value="size" value="${field.size}"></label>${button('updateField','Apply column')}${button('moveUp','↑', index === 0 || !known(table.fields[index - 1].typeCode) ? 'disabled' : '')}${button('moveDown','↓', index === table.fields.length - 1 || !known(table.fields[index + 1].typeCode) ? 'disabled' : '')}${button('deleteField','Delete column')}</div>`;
   }).join('');
   cards.push(`<foreignObject class="edit-card" x="${col * (width + gap)}" y="${y}" width="${width}" height="${height}"><div xmlns="http://www.w3.org/1999/xhtml" class="edit-body" data-table="${table.index}"><strong>Table #${table.index}</strong><p>Estimated record: ${size ? `${size.record} bytes; table: ${size.total === undefined ? 'unavailable' : `${size.total} bytes`}` : 'unavailable; table: unavailable'}</p><label>Name <input data-table-value="name" value="${esc(table.name)}"></label><label>Max records <input data-table-value="maxRecords" value="${table.maxRecords}"></label>${button('updateTable','Apply table')}${button('deleteTable','Delete table')}${fields}${button('addField','Add column')}</div></foreignObject>`);
  });
  y += rowHeight + gap;
 }
 const feedback = `<section aria-live="polite"><p>Estimated database total: ${total === undefined ? 'unavailable' : `${total} bytes`} / 460000000 bytes (Revolution row-color threshold; not a proven indicator limit).${total !== undefined && total > 460000000 ? ' Warning: estimate exceeds the designer threshold.' : ''}</p>${options.message ? `<p>${esc(options.message)}</p>` : ''}<ul>${validation.errors.map(e => `<li class="error">${esc(e)}</li>`).join('')}${validation.warnings.map(w => `<li class="warning">${esc(w)}</li>`).join('')}</ul>${options.hint !== undefined ? `<h2>main.iri hint</h2><p>Renamed or deleted fields can break existing code and dbaccess routines. Regenerate main.iri in Revolution.</p><pre>${esc(options.hint)}</pre>` : ''}</section>`;
 return { diagram: cards.join(''), feedback, canSave: validation.errors.length === 0 };
}
