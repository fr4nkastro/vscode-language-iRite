/** Static CSS: insert into the existing nonce-bearing style element. Colors come only from
 * `--vscode-*` variables (fallbacks inside var()); layout rules are scoped to the shell
 * (`.erd-*`), the draft (`.erd-draft`) and the edit-mode body, so Diagram mode keeps its page. */
export const ERD_DRAFT_STYLE = `
/* Shell: top bar */
.erd-topbar { display: flex; align-items: center; gap: 12px; padding: 8px 16px; border-bottom: 1px solid var(--vscode-panel-border); flex-wrap: wrap; font-size: var(--vscode-font-size, 13px); }
.erd-topbar h1 { font-size: 13px; font-weight: 600; margin: 0; }
.erd-topbar .mono { font-family: var(--vscode-editor-font-family, monospace); }
.erd-unavailable { color: var(--vscode-descriptionForeground); }
.erd-seg { display: inline-flex; border: 1px solid var(--vscode-panel-border); border-radius: 4px; overflow: hidden; }
.erd-seg button { font: inherit; background: none; border: 0; color: var(--vscode-descriptionForeground); padding: 3px 10px; cursor: pointer; }
.erd-seg button:hover:not(:disabled) { background: var(--vscode-list-hoverBackground); }
.erd-seg button:disabled { opacity: .45; cursor: default; }
.erd-seg button[aria-pressed="true"] { outline: 1px solid var(--vscode-contrastActiveBorder, transparent); outline-offset: -1px; background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground, var(--vscode-foreground)); opacity: 1; }
.erd-status { margin-left: auto; align-items: center; gap: 12px; color: var(--vscode-descriptionForeground); }
.erd-status:not([hidden]) { display: flex; }
.erd-errors { background: var(--vscode-errorForeground); color: var(--vscode-editor-background); border-radius: 10px; padding: 0 8px; font-size: 11px; }
.erd-errors[hidden] { display: none; }
.erd-primary, .erd-secondary { font: inherit; border: 1px solid var(--vscode-button-border, transparent); border-radius: 2px; padding: 4px 12px; cursor: pointer; }
.erd-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
.erd-primary:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
.erd-secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
.erd-secondary:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-secondaryBackground)); }
.erd-primary:disabled, .erd-secondary:disabled { opacity: .45; cursor: default; }
.erd-topbar :focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }

/* Edit mode fills the webview height: lists scroll, footer stays pinned. */
body:has(#edit-view:not([hidden])) { display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
body:has(#edit-view:not([hidden])) #edit-view { display: flex; flex: 1; min-height: 0; }
#edit-view { border: 0; padding: 0; margin: 0; min-width: 0; }

.erd-draft { color: var(--vscode-foreground); background: var(--vscode-editor-background); font-size: var(--vscode-font-size, 13px); line-height: 1.4; box-sizing: border-box; flex: 1; min-height: 0; min-width: 0; display: grid; grid-template-rows: minmax(0, 1fr) auto auto; }
.erd-draft *, .erd-draft *::before, .erd-draft *::after { box-sizing: border-box; }
.draft-layout { display: grid; grid-template-columns: 260px minmax(0, 1fr); min-height: 0; }
.draft-layout aside { display: flex; flex-direction: column; min-height: 0; min-width: 0; background: var(--vscode-sideBar-background, var(--vscode-editor-background)); border-right: 1px solid var(--vscode-panel-border); }
.draft-side-head { display: flex; align-items: center; justify-content: space-between; padding: 8px 8px 8px 12px; text-transform: uppercase; font-size: 11px; font-weight: 600; letter-spacing: .04em; color: var(--vscode-descriptionForeground); }
.draft-pill { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); border-radius: 10px; padding: 0 7px; font-size: 11px; letter-spacing: 0; }
.draft-filter { padding: 0 8px 8px; }
.draft-list { list-style: none; margin: 0; padding: 0; overflow-y: auto; flex: 1; font-size: inherit; }
.draft-list li { border-left: 2px solid transparent; }
.draft-list li:hover { background: var(--vscode-list-hoverBackground); }
.draft-list li.is-selected { outline: 1px solid var(--vscode-contrastActiveBorder, transparent); outline-offset: -1px; background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground, var(--vscode-foreground)); border-left-color: var(--vscode-focusBorder); }
.draft-list button { width: 100%; text-align: left; display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; padding: 6px 12px; background: none; border: 0; color: inherit; font: inherit; cursor: pointer; }
.draft-list .t-name { font-family: var(--vscode-editor-font-family, monospace); display: flex; align-items: center; gap: 6px; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.draft-list .t-meta { font-size: 11px; color: var(--vscode-descriptionForeground); text-align: right; white-space: nowrap; }
.draft-list li.is-selected .t-meta { color: inherit; opacity: .8; }
.draft-list .t-bar { grid-column: 1 / -1; height: 3px; }
.draft-dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; background: var(--vscode-gitDecoration-modifiedResourceForeground); flex: none; }
.draft-dot.is-added { background: var(--vscode-gitDecoration-addedResourceForeground); }
.draft-dot.is-removed { background: var(--vscode-gitDecoration-deletedResourceForeground); }
.draft-dot.is-error { background: var(--vscode-errorForeground); }

.draft-detail { min-width: 0; overflow: auto; padding: 16px 24px 32px; }
.draft-thead { display: grid; grid-template-columns: minmax(140px, 220px) minmax(140px, 200px) 1fr auto; gap: 12px; align-items: start; margin-bottom: 6px; }
.draft-field label { display: block; font-size: 11px; color: var(--vscode-descriptionForeground); }
.draft-field label input { margin-top: 3px; }
.draft-note { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 3px; }
.draft-stats { display: flex; gap: 20px; flex-wrap: wrap; align-self: center; padding-top: 14px; color: var(--vscode-descriptionForeground); font-size: 12px; }
.draft-stats b { color: var(--vscode-foreground); font-weight: 600; font-family: var(--vscode-editor-font-family, monospace); }
.draft-tbl-actions { display: flex; gap: 4px; align-self: center; padding-top: 14px; }

.draft-cols { border-collapse: collapse; width: 100%; margin-top: 12px; }
.draft-cols th { font-size: 11px; font-weight: 600; color: var(--vscode-descriptionForeground); text-align: left; padding: 4px 6px; border-bottom: 1px solid var(--vscode-panel-border); text-transform: uppercase; letter-spacing: .03em; }
.draft-cols td { height: 36px; padding: 4px 6px; border-bottom: 1px solid var(--vscode-panel-border); vertical-align: top; }
.draft-cols tbody tr:hover td { background: var(--vscode-list-hoverBackground); }
.draft-cols .col-grip { width: 20px; padding-top: 10px; color: var(--vscode-descriptionForeground); cursor: grab; }
.draft-cols .col-grip svg { width: 14px; height: 14px; display: block; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
.draft-cols th:nth-child(3) { width: 26%; }
.draft-cols th:nth-child(4) { width: 30%; }
.draft-cols .col-idx { width: 28px; padding-top: 8px; color: var(--vscode-descriptionForeground); font-family: var(--vscode-editor-font-family, monospace); }
.draft-cols .col-num { text-align: right; width: 12%; font-family: var(--vscode-editor-font-family, monospace); white-space: nowrap; }
.draft-cols td.col-num input { text-align: right; }
.draft-cols td.col-bytes { padding-top: 8px; width: 80px; }
.draft-cols .col-acts { width: 96px; white-space: nowrap; text-align: right; }
.draft-cols tr.is-changed td.col-idx { box-shadow: inset 2px 0 0 var(--vscode-gitDecoration-modifiedResourceForeground); }
.draft-cols tr.is-added td.col-idx { box-shadow: inset 2px 0 0 var(--vscode-gitDecoration-addedResourceForeground); }
.draft-cols tr.is-removed td.col-idx { box-shadow: inset 2px 0 0 var(--vscode-gitDecoration-deletedResourceForeground); }
.draft-cols tr.is-removed td:not(.col-acts) { opacity: .6; color: var(--vscode-gitDecoration-deletedResourceForeground); }
.cell-name { display: flex; align-items: center; gap: 6px; }
.draft-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

.draft-addrow { margin-top: 8px; display: flex; gap: 12px; align-items: center; color: var(--vscode-descriptionForeground); font-size: 12px; }
.draft-hint kbd { font: 11px var(--vscode-editor-font-family, monospace); border: 1px solid var(--vscode-panel-border); border-bottom-width: 2px; border-radius: 3px; padding: 0 4px; }

.erd-draft input, .erd-draft select { font: inherit; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 2px; padding: 3px 6px; height: 26px; width: 100%; min-width: 0; }
.erd-draft select { background: var(--vscode-dropdown-background, var(--vscode-input-background)); color: var(--vscode-dropdown-foreground, var(--vscode-input-foreground)); border-color: var(--vscode-dropdown-border, var(--vscode-input-border, var(--vscode-panel-border))); }
.erd-draft input:focus, .erd-draft select:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; border-color: var(--vscode-focusBorder); }
.erd-draft input.is-invalid { border-color: var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground)); }
.erd-draft input[readonly] { color: var(--vscode-descriptionForeground); opacity: .75; }
.erd-draft input:disabled, .erd-draft select:disabled { opacity: .55; }
.erd-draft .draft-icon { width: 24px; height: 24px; padding: 0; display: inline-grid; place-items: center; background: none; border: 1px solid transparent; border-radius: 4px; color: var(--vscode-icon-foreground, var(--vscode-descriptionForeground)); cursor: pointer; }
.erd-draft .draft-icon:hover:not(:disabled) { background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); color: var(--vscode-foreground); }
.erd-draft .draft-icon:disabled { opacity: .3; cursor: default; }
.erd-draft .draft-icon svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.erd-draft .draft-link { display: inline-flex; align-items: center; gap: 4px; font: inherit; background: none; border: 0; padding: 4px 0; color: var(--vscode-textLink-foreground); cursor: pointer; }
.erd-draft .draft-link:hover:not(:disabled) { text-decoration: underline; }
.erd-draft .draft-link:disabled { opacity: .45; cursor: default; }
.erd-draft .draft-link svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; }
.erd-draft :focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
.draft-status { color: var(--vscode-descriptionForeground); font-size: 11px; white-space: nowrap; }
.draft-cols tr.is-removed input, .draft-cols tr.is-removed select, .draft-list li.is-removed .t-name { text-decoration: line-through; }
.is-added .draft-status { color: var(--vscode-gitDecoration-addedResourceForeground); }
.is-changed .draft-status { color: var(--vscode-gitDecoration-modifiedResourceForeground); }
.is-removed .draft-status { color: var(--vscode-gitDecoration-deletedResourceForeground); }
.draft-issue { font-size: 11px; margin-top: 3px; }
.draft-issue.is-error { color: var(--vscode-errorForeground); }
.draft-issue.is-warning { color: var(--vscode-editorWarning-foreground); }
.draft-global-issues:empty { display: none; }
.draft-global-issues { padding: 4px 24px; border-top: 1px solid var(--vscode-panel-border); }

.erd-draft progress { appearance: none; -webkit-appearance: none; border: 0; border-radius: 3px; overflow: hidden; background: var(--vscode-panel-border); }
.erd-draft progress::-webkit-progress-bar { background: var(--vscode-panel-border); }
.erd-draft progress::-webkit-progress-value { background: var(--vscode-progressBar-background); }
.erd-draft progress::-moz-progress-bar { background: var(--vscode-progressBar-background); }
.draft-budget { display: flex; flex-wrap: wrap; gap: 8px 24px; align-items: center; padding: 6px 16px; border-top: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background, var(--vscode-editor-background)); font-size: 12px; }
.draft-meter { display: flex; align-items: center; gap: 8px; color: var(--vscode-descriptionForeground); }
.draft-meter progress { width: 140px; height: 6px; }
.draft-meter b { color: var(--vscode-foreground); font-family: var(--vscode-editor-font-family, monospace); font-weight: 600; }
.draft-meter.is-over progress::-webkit-progress-value { background: var(--vscode-editorWarning-foreground); }
.draft-meter.is-over progress::-moz-progress-bar { background: var(--vscode-editorWarning-foreground); }
.draft-problems { margin-left: auto; display: flex; gap: 10px; }
.draft-problems .is-error { color: var(--vscode-errorForeground); }
.draft-problems .is-warning { color: var(--vscode-editorWarning-foreground); }

@media (max-width: 760px) {
 .draft-layout { grid-template-columns: 1fr; grid-template-rows: minmax(0, 200px) minmax(0, 1fr); }
 .draft-layout aside { border-right: 0; border-bottom: 1px solid var(--vscode-panel-border); }
 .draft-thead { grid-template-columns: 1fr 1fr; }
 .draft-detail { padding: 12px 16px; }
 .draft-cols .col-bytes, .draft-cols .col-grip { display: none; }
}
`;
