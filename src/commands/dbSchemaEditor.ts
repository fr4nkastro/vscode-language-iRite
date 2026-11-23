import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { backupPath } from '../editor/backup';
import { createDbSchema, editDbSchema } from '../dbschema/model';
import { parseDbMessage } from '../dbschema/messages';
import { dbIriHint } from '../dbschema/iriHint';
import { renderDbHtml } from '../dbschema/webview';
import { saveDatabase } from '../dbschema/workflow';
import { parseRev } from '../rev';
import { locateMainSrc } from './locateProject';

const saving = new Set<string>();
export function registerDbSchemaEditor(context: vscode.ExtensionContext): void {
 context.subscriptions.push(vscode.commands.registerCommand('irite.editDatabaseSchema', async (arg?: unknown) => {
  try {
   const main = await locateMainSrc(arg);
   if (!main) throw new Error('No project main.src found.');
   const target = path.join(path.dirname(main), 'main.rev');
   let bytes = fs.readFileSync(target);
   let model = createDbSchema(parseRev(bytes.toString('utf8')));
   let hint = '';
   let unusable = false;
   const key = path.resolve(target).toLowerCase();
   const panel = vscode.window.createWebviewPanel('irite.dbSchemaEditor', 'iRite: Database Schema', vscode.ViewColumn.Active, {enableScripts:true, retainContextWhenHidden:true, localResourceRoots:[]});
   const render = () => { panel.webview.html = renderDbHtml(model, crypto.randomBytes(16).toString('base64'), hint); };
   render();
   panel.webview.onDidReceiveMessage((raw: unknown) => {
    if (saving.has(key) || unusable) return;
    const msg = parseDbMessage(raw, model);
    if (!msg) return;
    if (msg.type === 'edit') { model = editDbSchema(model, msg.edit); render(); return; }
    saving.add(key);
    void (async () => {
     let backup = '';
     let wrote = false;
     try {
      const saved = await saveDatabase(bytes, model, {
       read: () => fs.readFileSync(target),
       confirm: async () => (await vscode.window.showWarningMessage('Save database schema to .rev?', {modal:true, detail:'A backup is made first and ConfigHash is recomputed. Verify the result in Revolution and on a test indicator. main.iri is never written. Renamed, deleted or reordered fields can break existing code.'}, 'Save and keep a backup')) === 'Save and keep a backup',
       backup: () => { backup = backupPath(target, fs.existsSync, new Date()); fs.copyFileSync(target, backup, fs.constants.COPYFILE_EXCL); },
       write: next => { wrote = true; fs.writeFileSync(target, next); },
      });
      if (saved) { bytes = fs.readFileSync(target); model = saved; hint = dbIriHint(saved); render(); void vscode.window.showInformationMessage(`iRite: database schema saved. Backup: ${path.basename(backup)}. Regenerate main.iri; see the editor.`); }
     } catch (e) { if (wrote) unusable = true; void vscode.window.showErrorMessage(`iRite: ${e instanceof Error ? e.message : String(e)}${wrote ? ` Backup: ${backup}. Reopen the editor after recovery.` : ''}`); }
     finally { saving.delete(key); }
    })();
   }, undefined, context.subscriptions);
  } catch (e) { void vscode.window.showErrorMessage(`iRite: ${e instanceof Error ? e.message : String(e)}`); }
 }));
}
