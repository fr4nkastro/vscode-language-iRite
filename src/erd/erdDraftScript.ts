/** Browser controller; appended after the diagram navigation script in the nonce-bearing tag. */
export const ERD_DRAFT_SCRIPT = `
const diagramView = document.getElementById('diagram-view');
const editView = document.getElementById('edit-view');
const toolbar = document.getElementById('edit-toolbar');
const diagramMode = document.getElementById('diagram-mode');
const editMode = document.getElementById('edit-mode');
const save = document.getElementById('edit-save');
const discard = document.getElementById('edit-revert');
const countNode = document.getElementById('edit-count');
const notice = document.getElementById('edit-notice');
const feedback = document.getElementById('edit-feedback');
const readonlyView = document.getElementById('readonly-view');
let editing = __ERD_EDITING__, available = __ERD_AVAILABLE__, hardDisabled = false;
let pending = null, modePending = false, aliasPending = false, requestId = 0;
let queue = [], selected = editView.querySelector('[data-detail]')?.dataset.table, filter = '';
let draft = null, canSave = false, count = 0, dragging = null;
const keyOk = key => typeof key === 'string' && /^draft-[1-9][0-9]{0,15}$/.test(key);
function updateControls() {
 const busy = !!pending || modePending || queue.length > 0;
 diagramView.hidden = editing; editView.hidden = !editing; toolbar.hidden = !editing;
 diagramMode.disabled = modePending || !!pending || queue.length > 0 || !editing;
 editMode.disabled = !available || hardDisabled || modePending || !!pending || queue.length > 0 || editing;
 diagramMode.setAttribute('aria-pressed', String(!editing)); editMode.setAttribute('aria-pressed', String(editing));
 editView.disabled = !available || hardDisabled || modePending || !!pending && (pending.message.type === 'save' || pending.message.type === 'draft-discard');
 save.disabled = !editing || hardDisabled || busy || !canSave || count === 0;
 discard.disabled = !editing || hardDisabled || busy || count === 0;
 countNode.textContent = count + ' pending changes';
}
function applyFilter() {
 const input = editView.querySelector('[data-action="filterTables"]');
 if (input) input.value = filter;
 editView.querySelectorAll('.draft-list [data-action="selectTable"]').forEach(button => {
  button.parentElement.hidden = !button.textContent.toLowerCase().includes(filter.toLowerCase());
 });
}
function captureFocus() {
 const node = document.activeElement;
 if (!node || !editView.contains(node) || !node.dataset.action) return null;
 const d = node.dataset;
 if (d.table && !keyOk(d.table) || d.field && !keyOk(d.field)) return null;
 return {action:d.action, table:d.table, field:d.field, property:d.property, start:node.selectionStart, end:node.selectionEnd, direction:node.selectionDirection};
}
function restoreFocus(focus) {
 if (!focus) return;
 const node = [...editView.querySelectorAll('[data-action]')].find(n => n.dataset.action === focus.action && n.dataset.table === focus.table && n.dataset.field === focus.field && n.dataset.property === focus.property);
 if (!node || node.disabled) return;
 node.focus();
 if (focus.start !== null && typeof focus.start === 'number' && node.setSelectionRange) node.setSelectionRange(focus.start, focus.end, focus.direction || 'none');
}
function accept(m, render) {
 draft = m.draft || draft; canSave = !!m.canSave; count = typeof m.count === 'number' ? m.count : count;
 hardDisabled = !!m.disabled;
 if (typeof m.readonly === 'string') readonlyView.innerHTML = m.readonly;
 if (typeof m.message === 'string') notice.textContent = m.message; else notice.textContent = '';
 feedback.textContent = typeof m.hint === 'string' ? 'main.iri hint (regenerate in Revolution):\\n' + m.hint : '';
 if (render && typeof m.fragment === 'string') {
  const focus = captureFocus();
  selected = keyOk(m.selected) ? m.selected : undefined;
  editView.innerHTML = m.fragment; applyFilter(); restoreFocus(focus);
 }
}
function sendNext() {
 if (pending || modePending || hardDisabled || !editing || !queue.length) { updateControls(); return; }
 const message = queue.shift(); pending = {id:++requestId, message};
 vscode.postMessage({type:'erd-edit-request', generation, requestId:pending.id, selected, message});
 updateControls();
}
function enqueue(message) { if (!editing || hardDisabled || modePending) return; queue.push(message); sendNext(); }
function requestMode(next, force = false) {
 if (!available || hardDisabled || pending || modePending || queue.length || next === editing && !force) return;
 modePending = true; updateControls();
 vscode.postMessage({type:'erd-edit-mode', generation, editing:next, selected});
}
diagramMode.addEventListener('click', () => requestMode(false));
editMode.addEventListener('click', () => requestMode(true));
save.addEventListener('click', () => { if (!save.disabled) enqueue({type:'save'}); });
discard.addEventListener('click', () => { if (!discard.disabled) enqueue({type:'draft-discard'}); });
function edit(action) { enqueue({type:'draft-action', action}); }
function input(e) {
 const node = e.target, d = node.dataset;
 if (d.action === 'filterTables') { filter = node.value; applyFilter(); return; }
 if (node.tagName === 'SELECT' && e.type !== 'change' || node.tagName !== 'SELECT' && e.type !== 'input') return;
 if ((d.action !== 'setTable' && d.action !== 'setField') || !keyOk(d.table) || d.action === 'setField' && !keyOk(d.field)) return;
 const action = {kind:d.action, table:d.table, property:d.property, value:node.value};
 if (d.action === 'setField') action.field = d.field;
 edit(action);
}
editView.addEventListener('input', input); editView.addEventListener('change', input);
function live(table) { return draft?.tables.find(t => t.key === table && !t.removed)?.fields.filter(f => !f.removed) || []; }
function move(table, field, to) {
 if (pending || queue.length || modePending) return;
 const fields = live(table), from = fields.findIndex(f => f.key === field);
 if (from < 0 || to < 0 || to >= fields.length || from === to) return;
 edit({kind:'moveField', table, field, to});
}
editView.addEventListener('click', e => {
 const node = e.target.closest('button[data-action]'); if (!node || node.disabled || !editing || hardDisabled) return;
 const d = node.dataset, table = d.table, field = d.field;
 if (d.action === 'selectTable' && keyOk(table)) { selected = table; enqueue({type:'draft-get'}); return; }
 if (d.action === 'addTable') { edit({kind:'addTable', name:'', maxRecords:'1'}); return; }
 if (!keyOk(table)) return;
 if (d.action === 'addField') edit({kind:'addField', table, name:'', typeCode:3});
 else if (d.action === 'removeTable' || d.action === 'restoreTable') edit({kind:d.action, table});
 else if ((d.action === 'removeField' || d.action === 'restoreField') && keyOk(field)) edit({kind:d.action, table, field});
 else if (d.action === 'moveField' && keyOk(field)) { const fields = live(table), from = fields.findIndex(f => f.key === field); move(table, field, from + (d.direction === 'up' ? -1 : 1)); }
});
editView.addEventListener('dragstart', e => { const row = e.target.closest('[data-field-row]'); dragging = row && row.draggable ? {table:row.dataset.table, field:row.dataset.field} : null; });
editView.addEventListener('dragover', e => { if (dragging && e.target.closest('[data-field-row]')) e.preventDefault(); });
editView.addEventListener('drop', e => {
 const row = e.target.closest('[data-field-row]');
 if (dragging && row && row.dataset.table === dragging.table) { e.preventDefault(); move(dragging.table, dragging.field, live(dragging.table).findIndex(f => f.key === row.dataset.field)); }
 dragging = null;
});
editView.addEventListener('dragend', () => { dragging = null; });
window.addEventListener('keydown', e => {
 if (!editing) return;
 if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 's') { e.preventDefault(); if (!save.disabled) enqueue({type:'save'}); return; }
 if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
 const row = e.target.closest && e.target.closest('[data-field-row]'); if (!row) return;
 e.preventDefault(); const fields = live(row.dataset.table), from = fields.findIndex(f => f.key === row.dataset.field);
 move(row.dataset.table, row.dataset.field, from + (e.key === 'ArrowUp' ? -1 : 1));
});
window.addEventListener('message', e => {
 const m = e.data; if (!m || m.generation !== generation) return;
 if (m.type === 'erd-enable-edit') { if (pending || modePending || queue.length) aliasPending = true; else requestMode(true, true); return; }
 if (m.type === 'erd-edit-mode-state' && modePending) {
  modePending = false; editing = !!m.editing; if (m.draft) accept(m, true); updateControls();
  if (aliasPending) { aliasPending = false; requestMode(true, true); }
  return;
 }
 if (m.type !== 'erd-edit-state' || !pending || m.requestId !== pending.id) return;
 pending = null; accept(m, !queue.length); if (hardDisabled) queue = [];
 sendNext();
 if (!pending && !queue.length && aliasPending) { aliasPending = false; requestMode(true, true); }
});
updateControls();
if (available && editing) enqueue({type:'draft-get'});
`;
