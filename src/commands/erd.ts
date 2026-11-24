import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { buildErd } from '../erd/erdModel';
import { renderErdHtml, renderErdReadonly } from '../erd/erdHtml';
import { renderErdEditState } from '../erd/erdEdit';
import { ErdEditSession, projectSource } from '../erd/erdEditSession';
import { createDbSchema } from '../dbschema/model';
import { atomicDbWrite } from '../dbschema/workflow';
import { backupPath } from '../editor/backup';
import { loadIriteProject } from '../irite';
import type { IriteProjectModel } from '../irite';
import { parseRev } from '../rev';
import { locateMainSrc, readText } from './locateProject';

const VIEW_TYPE = 'irite.showErd';

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
 private aliasPending = false;

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
  if (!this.refreshPending || this.disposed || this.staged || this.aliasPending || this.session?.editing || this.session?.busy || this.session?.unusable) return;
  this.refreshPending = false;
  this.render(false);
 }
 private selectedTarget(): string | undefined {
  const dir = path.dirname(this.mainSrc);
  const name = fs.readdirSync(dir).filter(n => /\.rev$/i.test(n)).sort((a,b) => a.toLowerCase() === 'main.rev' ? -1 : b.toLowerCase() === 'main.rev' ? 1 : a.localeCompare(b))[0];
  return name ? path.join(dir, name) : undefined;
 }
 private render(editing: boolean): void {
  this.generation++;
  try {
   const dir = path.dirname(this.mainSrc);
   this.project = loadIriteProject(this.mainSrc, readText);
   this.target = this.selectedTarget();
   let bytes: Buffer | undefined;
   try { bytes = this.target ? fs.readFileSync(this.target) : undefined; } catch { /* Keep the source-only reader available. */ }
   const rev = bytes ? parseRev(bytes.toString('utf8')) : undefined;
   this.session = undefined;
   if (bytes && rev && this.target) {
    try {
     const target = this.target;
     const read = (): Buffer => {
      if (this.disposed) throw new Error('Editor closed; nothing was written.');
      if (this.selectedTarget() !== target) throw new Error('Database target changed on disk; nothing was written. Reopen the editor.');
      return fs.readFileSync(target);
     };
     this.session = new ErdEditSession(bytes, createDbSchema(rev), {
      read,
      confirm: async () => (await vscode.window.showWarningMessage('Save database schema to .rev?', {modal:true, detail:'A backup is made first and ConfigHash is recomputed. Verify the result in Revolution and on a test indicator. main.iri is never written. Renamed, deleted or reordered fields can break existing code.'}, 'Save and keep a backup')) === 'Save and keep a backup',
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
   await this.panel.webview.postMessage({type:'erd-edit-mode-state', generation:this.generation, editing:!!this.session?.editing});
   this.refreshIfSafe();
   return;
  }
  if (msg.type !== 'erd-edit-request' || !Number.isSafeInteger(msg.requestId) || (msg.requestId as number) < 1 || !this.session) return;
  const session = this.session;
  const result = await session.request(msg.message);
  if (this.disposed || session !== this.session) return;
  const request = msg.message as {type?: unknown} | null;
  if (request?.type === 'edit' && !result.message) this.staged = true;
  if (result.saved) this.staged = false;
  const state = renderErdEditState(session.model, {hint:session.hint, message:result.message});
  const readonly = result.saved ? renderErdReadonly(buildErd(this.project, parseRev(session.readback.toString('utf8')))) : undefined;
  if (result.saved) void vscode.window.showInformationMessage(`iRite: database schema saved. Backup: ${path.basename(this.backup)}. Regenerate main.iri; see the editor.`);
  await this.panel.webview.postMessage({type:'erd-edit-state', generation:this.generation, requestId:msg.requestId, ...state, canSave:state.canSave && !session.unusable, disabled:session.unusable, readonly});
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
