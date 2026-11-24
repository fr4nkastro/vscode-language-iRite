import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { buildErd } from '../erd/erdModel';
import { renderErdHtml, renderErdReadonly } from '../erd/erdHtml';
import { canSaveErdDraft, renderErdDraft } from '../erd/erdDraftHtml';
import { ErdEditSession, projectSource } from '../erd/erdEditSession';
import { createDbSchema } from '../dbschema/model';
import { atomicDbWrite } from '../dbschema/workflow';
import { backupPath } from '../editor/backup';
import { loadIriteProject } from '../irite';
import type { IriteProjectModel } from '../irite';
import { parseRev } from '../rev';
import { locateMainSrc, readText } from './locateProject';

const VIEW_TYPE = 'irite.showErd';

/** Only host-owned table keys may select a detail; otherwise use the renderer's first-table fallback. */
function draftReply(session: ErdEditSession, requested: unknown) {
 const draft = session.view;
 const selected = draft.tables.find(t => t.key === requested)?.key ?? draft.tables[0]?.key;
 const disabled = session.unusable || session.busy;
 return {draft, selected, fragment:renderErdDraft(draft, selected), count:draft.count, canSave:canSaveErdDraft(draft) && !disabled, disabled, hint:session.hint};
}

class ErdPanel {
 private static panels = new Map<string, ErdPanel>();
 private readonly watchers: vscode.Disposable[] = [];
 private timer: NodeJS.Timeout | undefined;
 private project: IriteProjectModel | undefined;
 private session: ErdEditSession | undefined;
 private target: string | undefined;
 private disposed = false;
 private backup = '';
 private generation = 0;
 private staged = false;
 private refreshPending = false;
 private refreshedWithDraft = false;
 private aliasPending = false;
 private recoveryMessage: string | undefined;

 private constructor(private readonly panel: vscode.WebviewPanel, private readonly mainSrc: string, editing: boolean) {
  const dir = path.dirname(mainSrc);
  const schedule = (): void => {
   clearTimeout(this.timer);
   this.timer = setTimeout(() => { this.refreshPending = true; this.refreshIfSafe(); }, 300);
  };
  for (const glob of ['*.rev', '**/*.iri', '**/*.src']) {
   const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(dir, glob));
   watcher.onDidChange(schedule); watcher.onDidCreate(schedule); watcher.onDidDelete(schedule);
   this.watchers.push(watcher);
  }
  panel.webview.onDidReceiveMessage((m: unknown) => this.onMessage(m));
  panel.onDidDispose(() => {
   this.disposed = true; clearTimeout(this.timer); this.watchers.forEach(w => w.dispose());
   ErdPanel.panels.delete(mainSrc.toLowerCase());
  });
  this.render(editing);
 }
 static open(mainSrc: string, editing: boolean): void {
  const key = mainSrc.toLowerCase();
  const existing = ErdPanel.panels.get(key);
  if (existing) {
   existing.panel.reveal();
   if (existing.session?.unusable) {
    existing.staged = false;
    existing.aliasPending = false;
    existing.refreshPending = false;
    existing.render(editing);
    return;
   }
   if (editing) {
    if (existing.session && !existing.session.unusable) existing.aliasPending = true;
    void existing.panel.webview.postMessage({type:'erd-enable-edit', generation:existing.generation});
   }
   return;
  }
  const panel = vscode.window.createWebviewPanel(VIEW_TYPE, `ERD: ${path.basename(path.dirname(mainSrc))}`, vscode.ViewColumn.Beside, { enableScripts:true, retainContextWhenHidden:true });
  ErdPanel.panels.set(key, new ErdPanel(panel, mainSrc, editing));
 }
 private refreshIfSafe(): void {
  if (this.disposed || this.aliasPending || this.session?.editing || this.session?.busy || this.session?.unusable) return;
  if (!this.refreshPending && !(this.refreshedWithDraft && !this.staged)) return;
  this.refreshPending = false;
  this.refreshedWithDraft = this.staged;
  this.render(false, this.staged);
 }
 private selectedTarget(): { readable?: string; writable?: string; ambiguous: boolean } {
  const dir = path.dirname(this.mainSrc);
  const names = fs.readdirSync(dir).filter(n => /\.rev$/i.test(n)).sort((a,b) => a.toLowerCase() === 'main.rev' ? -1 : b.toLowerCase() === 'main.rev' ? 1 : a.localeCompare(b));
  const preferred = names.filter(n => n.toLowerCase() === 'main.rev');
  const writable = preferred.length === 1 ? preferred[0] : preferred.length === 0 && names.length === 1 ? names[0] : undefined;
  return { readable: names[0] ? path.join(dir, names[0]) : undefined, writable: writable ? path.join(dir, writable) : undefined, ambiguous: names.length > 0 && !writable };
 }
 private render(editing: boolean, preserveSession = false): void {
  this.generation++;
  try {
   const dir = path.dirname(this.mainSrc);
   this.project = loadIriteProject(this.mainSrc, readText);
   const selection = this.selectedTarget();
   this.target = selection.readable;
   let bytes: Buffer | undefined;
   try { bytes = this.target ? fs.readFileSync(this.target) : undefined; } catch { /* Keep the source-only reader available. */ }
   const rev = bytes ? parseRev(bytes.toString('utf8')) : undefined;
   if (!preserveSession) this.session = undefined;
   if (!preserveSession && bytes && rev && this.target && selection.writable === this.target) {
    try {
     const target = this.target;
     const read = (): Buffer => {
      if (this.disposed) throw new Error('Editor closed; nothing was written.');
      if (this.selectedTarget().writable !== target) throw new Error('Database target changed on disk; nothing was written. Reopen the editor.');
      return fs.readFileSync(target);
     };
     this.session = new ErdEditSession(bytes, createDbSchema(rev), {
      read,
      confirm: async () => (await vscode.window.showWarningMessage(`Save database schema to ${path.basename(target)}?`, {modal:true, detail:'A backup is made first and ConfigHash is recomputed. Firmware enforcement, storage overhead and per-table memory limits are unconfirmed. Verify the result in Revolution and on a test indicator. main.iri is never written. Renamed, deleted or reordered fields can break existing code.'}, 'Save and keep a backup')) === 'Save and keep a backup',
      backup: () => { this.backup = backupPath(target, fs.existsSync, new Date()); fs.copyFileSync(target, this.backup, fs.constants.COPYFILE_EXCL); },
      noChanges: () => { void vscode.window.showInformationMessage('iRite: No database schema changes to save.'); },
      write: next => {
       const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${crypto.randomBytes(16).toString('hex')}.tmp`);
       atomicDbWrite(target, temporary, next, {
        writeTemp: (file, data) => fs.writeFileSync(file, data, {flag:'wx', mode:fs.statSync(target).mode}),
        rename: (from, to) => fs.renameSync(from, to),
       });
      },
     });
     this.session.editing = editing;
    } catch (e) { void vscode.window.showWarningMessage(`iRite: Database editing unavailable: ${e instanceof Error ? e.message : String(e)}`); }
   }
   this.panel.webview.html = renderErdHtml(buildErd(this.project, rev), {
    cspSource:this.panel.webview.cspSource, nonce:crypto.randomBytes(16).toString('base64'), title:`Database diagram: ${path.basename(dir)}`,
    editor:this.session ? {schema:this.session.model, startEditing:editing} : undefined, generation:this.generation,
    recoveryMessage:this.recoveryMessage,
    disabledReason:selection.ambiguous ? 'Multiple .rev files make the database write target ambiguous; schema editing is disabled.' : undefined,
   });
  } catch (e) {
   this.panel.webview.html = '<!DOCTYPE html><html><body>Could not render the database diagram.</body></html>';
   console.error('iRite ERD failed', e);
  }
 }
 private async onMessage(raw: unknown): Promise<void> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
  const msg = raw as Record<string, unknown>;
  if (msg.type === 'open' && typeof msg.file === 'string' && typeof msg.line === 'number' && Number.isFinite(msg.line)) {
   const file = projectSource(this.project?.files ?? [], msg.file);
   if (!file) return;
   const line = Math.max(0, Math.floor(msg.line) - 1);
   await vscode.window.showTextDocument(vscode.Uri.file(file), {selection:new vscode.Range(line,0,line,0), viewColumn:vscode.ViewColumn.One});
   return;
  }
  if (msg.generation !== this.generation) return;
  if (msg.type === 'erd-edit-mode' && typeof msg.editing === 'boolean') {
   if (this.session && !this.session.busy && !this.session.unusable) {
    this.session.editing = msg.editing;
    if (msg.editing) this.aliasPending = false;
   }
   await this.panel.webview.postMessage({type:'erd-edit-mode-state', generation:this.generation, editing:!!this.session?.editing, ...(this.session ? draftReply(this.session, msg.selected) : {})});
   this.refreshIfSafe();
   return;
  }
  if (msg.type !== 'erd-edit-request' || !Number.isSafeInteger(msg.requestId) || (msg.requestId as number) < 1 || !this.session) return;
  const session = this.session;
  const result = await session.request(msg.message);
  if (this.disposed || session !== this.session) return;
  this.staged = session.hasChanges;
  if (session.unusable && result.message) this.recoveryMessage = result.message;
  const readonly = result.saved ? renderErdReadonly(buildErd(this.project, parseRev(session.readback.toString('utf8')))) : undefined;
  if (result.saved) void vscode.window.showInformationMessage(`iRite: database schema saved. Backup: ${path.basename(this.backup)}. Regenerate main.iri; see the editor.`);
  await this.panel.webview.postMessage({type:'erd-edit-state', generation:this.generation, requestId:msg.requestId, ...draftReply(session, msg.selected), message:result.message, readonly});
  this.refreshIfSafe();
 }
}

export function registerErdCommands(context: vscode.ExtensionContext): void {
 for (const [id, editing] of [['irite.showErd', false], ['irite.editDatabaseSchema', true]] as const) {
  context.subscriptions.push(vscode.commands.registerCommand(id, async (arg?: unknown) => {
   const main = await locateMainSrc(arg);
   if (!main) { void vscode.window.showErrorMessage('iRite: no main.src found. Open a project containing main.src.'); return; }
   ErdPanel.open(main, editing);
  }));
 }
}
