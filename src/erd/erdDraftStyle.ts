/** Static CSS: insert into the existing nonce-bearing style element. */
export const ERD_DRAFT_STYLE = `
.erd-draft { color: var(--vscode-foreground); background: var(--vscode-editor-background); }
.draft-layout { display: grid; grid-template-columns: minmax(180px, 260px) minmax(0, 1fr); gap: 1rem; }
.draft-layout aside, .draft-detail { min-width: 0; }
.draft-list { list-style: none; padding: 0; max-height: 60vh; overflow-y: auto; }
.draft-list button { width: 100%; text-align: left; display: grid; gap: .2rem; }
.draft-list button[aria-current] { outline: 1px solid var(--vscode-focusBorder); }
.draft-detail { overflow-x: auto; }
.draft-detail table { border-collapse: collapse; width: 100%; }
.draft-detail th, .draft-detail td { border-bottom: 1px solid var(--vscode-panel-border); padding: .25rem; text-align: left; vertical-align: top; }
.erd-draft input, .erd-draft select { color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); max-width: 100%; }
.erd-draft button { color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 1px solid var(--vscode-button-border); cursor: pointer; }
.erd-draft button:hover { background: var(--vscode-button-hoverBackground); }
.erd-draft :focus-visible { outline: 1px solid var(--vscode-focusBorder); }
.draft-status { color: var(--vscode-descriptionForeground); font-size: .85em; }
.is-removed input, .is-removed select, .is-removed > button span, tr.is-removed td:not(:last-child) { text-decoration: line-through; }
.is-added .draft-status { color: var(--vscode-gitDecoration-addedResourceForeground); }
.is-changed .draft-status { color: var(--vscode-gitDecoration-modifiedResourceForeground); }
.draft-issue.is-error { color: var(--vscode-errorForeground); }
.draft-issue.is-warning { color: var(--vscode-editorWarning-foreground); }
.draft-budget { display: flex; flex-wrap: wrap; gap: 1rem; border-top: 1px solid var(--vscode-panel-border); padding-top: .5rem; }
.draft-budget label { display: grid; gap: .25rem; }
.draft-budget progress { accent-color: var(--vscode-progressBar-background); }
@media (max-width: 650px) { .draft-layout { grid-template-columns: 1fr; } }
`;
