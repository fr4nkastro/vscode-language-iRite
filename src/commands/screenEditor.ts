// irite.screenEditor: opt-in editor of the 1280 screens that writes widget geometry back into the `.rev`.
// A CustomEditorProvider, so undo/redo, dirty state, save and revert come from VS Code. Registered with
// priority "option": it is never the default editor of `.rev` (use "Open With..." or `iRite: Edit Screens`).
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { backupPath } from "../editor/backup";
import { renderEditorHtml } from "../editor/editorHtml";
import { changedIds, editLabel, effectiveGeometry, emptyEditState, parseEditState, serializeEditState, setGeometry, withEdits } from "../editor/editState";
import type { EditState } from "../editor/editState";
import { DEFAULT_GRID, parseEditorMessage } from "../editor/messages";
import { planSave } from "../editor/saveRev";
import { loadIriteProject } from "../irite";
import type { IriteProjectModel } from "../irite";
import { previewState } from "../preview/previewState";
import type { PreviewState } from "../preview/previewState";
import { buildScreenView } from "../preview/screenModel";
import { parseRev } from "../rev";
import type { RevModel } from "../rev";
import { locateRev } from "./previewScreens";

const VIEW_TYPE = "irite.screenEditor";

const WARNING =
	"Saving writes the new widget positions and sizes into this .rev. Revolution's integrity hash (ConfigHash) is NOT recomputed, " +
	"and the result has not been verified in Revolution or on a 1280.";
const WARNING_DETAIL =
	"Before writing, the current file is copied next to it (main.rev.bak, or a timestamped name when that exists). " +
	"Only the x, y, width and height of the edited WDGT lines change; every other byte stays as it is. " +
	"Open the saved file in Revolution before loading it on an indicator, and keep the backup until you have.";

class RevDocument implements vscode.CustomDocument {
	/** The hash/confirmation warning is shown once per document and session. */
	confirmed = false;
	/** Bytes as opened (or last reverted): the edit state is always relative to these, so undo after a save still works. */
	original: Buffer;
	readonly panels = new Set<vscode.WebviewPanel>();
	view: PreviewState = previewState.emptyState();
	prefs = { snap: true, grid: DEFAULT_GRID };

	constructor(
		readonly uri: vscode.Uri,
		public bytes: Buffer,
		public rev: RevModel,
		public state: EditState,
		public project: IriteProjectModel | undefined,
	) {
		this.original = bytes;
	}

	dispose(): void {
		this.panels.clear();
	}
}

function readText(p: string): string | undefined {
	try {
		return fs.readFileSync(p, "utf8");
	} catch {
		return undefined;
	}
}

function loadProject(revPath: string): IriteProjectModel | undefined {
	const main = path.join(path.dirname(revPath), "main.src");
	try {
		return fs.existsSync(main) ? loadIriteProject(main, readText) : undefined;
	} catch {
		return undefined;
	}
}

function writeAtomic(target: string, bytes: Buffer): void {
	const tmp = `${target}.irite-tmp`;
	try {
		fs.writeFileSync(tmp, bytes);
		fs.renameSync(tmp, target);
	} finally {
		if (fs.existsSync(tmp)) {
			fs.rmSync(tmp, { force: true });
		}
	}
}

class ScreenEditorProvider implements vscode.CustomEditorProvider<RevDocument> {
	private readonly changeEmitter = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<RevDocument>>();
	readonly onDidChangeCustomDocument = this.changeEmitter.event;

	async openCustomDocument(uri: vscode.Uri, openContext: vscode.CustomDocumentOpenContext): Promise<RevDocument> {
		if (uri.scheme !== "file") {
			throw new Error("iRite: the screen editor only opens .rev files on disk.");
		}
		const bytes = fs.readFileSync(uri.fsPath);
		const rev = parseRev(bytes.toString("utf8"));
		let state = emptyEditState();
		if (openContext.backupId) {
			try {
				state = parseEditState(JSON.parse(fs.readFileSync(vscode.Uri.parse(openContext.backupId).fsPath, "utf8")), rev);
			} catch {
				state = emptyEditState();
			}
		}
		const cfg = vscode.workspace.getConfiguration("irite.editor");
		const doc = new RevDocument(uri, bytes, rev, state, loadProject(uri.fsPath));
		const grid = cfg.get<number>("gridSize", DEFAULT_GRID);
		doc.prefs = { snap: cfg.get<boolean>("snap", true), grid: Number.isInteger(grid) && grid >= 1 && grid <= 200 ? grid : DEFAULT_GRID };
		return doc;
	}

	resolveCustomEditor(document: RevDocument, panel: vscode.WebviewPanel): void {
		panel.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.file(path.dirname(document.uri.fsPath))] };
		document.panels.add(panel);
		panel.onDidDispose(() => document.panels.delete(panel));
		panel.webview.onDidReceiveMessage((m: unknown) => this.onMessage(document, m));
		this.render(document, panel);
	}

	private render(doc: RevDocument, panel: vscode.WebviewPanel): void {
		try {
			const dir = path.dirname(doc.uri.fsPath);
			const rev: RevModel = { ...doc.rev, widgets: withEdits(doc.rev.widgets, doc.state) };
			const webview = panel.webview;
			webview.html = renderEditorHtml(buildScreenView(rev, doc.project), {
				cspSource: webview.cspSource,
				nonce: crypto.randomBytes(16).toString("base64"),
				title: path.basename(doc.uri.fsPath),
				initialState: doc.view,
				prefs: doc.prefs,
				imageUri: (rel) => {
					const abs = path.join(dir, rel);
					return fs.existsSync(abs) ? webview.asWebviewUri(vscode.Uri.file(abs)).toString() : undefined;
				},
			});
		} catch (e) {
			panel.webview.html = `<!DOCTYPE html><html><body>Could not render the screen editor.</body></html>`;
			console.error("iRite screen editor failed", e);
		}
	}

	/** Tells every page of the document the effective geometry of `ids` (after an edit, undo, redo). */
	private sync(doc: RevDocument, ids: number[]): void {
		const geom: Record<number, ReturnType<typeof effectiveGeometry>> = {};
		for (const id of ids) {
			const w = doc.rev.widgets.find((x) => x.id === id);
			if (w) {
				geom[id] = effectiveGeometry(w, doc.state);
			}
		}
		const edited = Object.keys(doc.state.geom).map(Number);
		for (const p of doc.panels) {
			void p.webview.postMessage({ type: "sync", geom, edited });
		}
	}

	private onMessage(doc: RevDocument, raw: unknown): void {
		const msg = parseEditorMessage(raw, new Set(doc.rev.widgets.map((w) => w.id)));
		if (!msg) {
			return;
		}
		if (msg.type === "state") {
			doc.view = msg.state;
			return;
		}
		if (msg.type === "prefs") {
			doc.prefs = { snap: msg.snap, grid: msg.grid };
			return;
		}
		const widget = doc.rev.widgets.find((w) => w.id === msg.id);
		const r = widget ? setGeometry(doc.state, doc.rev, msg.id, msg.patch) : undefined;
		if (!widget || !r || !r.ok) {
			// Rejected: put the page back on the real value.
			this.sync(doc, [msg.id]);
			return;
		}
		const before = doc.state;
		const after = r.state;
		const touched = changedIds(before, after);
		if (touched.length === 0) {
			this.sync(doc, [msg.id]);
			return;
		}
		doc.state = after;
		this.changeEmitter.fire({
			document: doc,
			label: editLabel(widget, msg.patch),
			undo: () => {
				doc.state = before;
				this.sync(doc, touched);
			},
			redo: () => {
				doc.state = after;
				this.sync(doc, touched);
			},
		});
		this.sync(doc, touched);
	}

	private async confirm(doc: RevDocument): Promise<void> {
		if (doc.confirmed) {
			return;
		}
		const ok = "Save and keep a backup";
		const pick = await vscode.window.showWarningMessage(WARNING, { modal: true, detail: WARNING_DETAIL }, ok);
		if (pick !== ok) {
			throw new Error("iRite: save cancelled, the .rev was not modified.");
		}
		doc.confirmed = true;
	}

	async saveCustomDocument(doc: RevDocument): Promise<void> {
		const target = doc.uri.fsPath;
		const disk = fs.readFileSync(target);
		if (!disk.equals(doc.bytes)) {
			throw new Error(`iRite: ${path.basename(target)} changed on disk since it was opened (Revolution or git?). Nothing was written; use Revert File to reload it.`);
		}
		const plan = planSave(doc.original, doc.state);
		const next = plan ? plan.bytes : doc.original;
		if (next.equals(doc.bytes)) {
			return; // nothing to write: the file stays byte-identical
		}
		await this.confirm(doc);
		const backup = backupPath(target, fs.existsSync, new Date());
		fs.copyFileSync(target, backup);
		writeAtomic(target, next);
		doc.bytes = next;
		const n = plan ? plan.changed.length : 0;
		void vscode.window.showInformationMessage(`iRite: saved ${path.basename(target)} (${n} edited widget line${n === 1 ? "" : "s"}). Backup: ${path.basename(backup)}. ConfigHash was not recomputed.`);
	}

	async saveCustomDocumentAs(doc: RevDocument, destination: vscode.Uri): Promise<void> {
		const plan = planSave(doc.original, doc.state);
		await this.confirm(doc);
		writeAtomic(destination.fsPath, plan ? plan.bytes : doc.original);
	}

	async revertCustomDocument(doc: RevDocument): Promise<void> {
		doc.bytes = fs.readFileSync(doc.uri.fsPath);
		doc.original = doc.bytes;
		doc.rev = parseRev(doc.bytes.toString("utf8"));
		doc.project = loadProject(doc.uri.fsPath);
		doc.state = emptyEditState();
		for (const p of doc.panels) {
			this.render(doc, p);
		}
	}

	async backupCustomDocument(doc: RevDocument, context: vscode.CustomDocumentBackupContext): Promise<vscode.CustomDocumentBackup> {
		await vscode.workspace.fs.writeFile(context.destination, Buffer.from(serializeEditState(doc.state), "utf8"));
		return {
			id: context.destination.toString(),
			delete: async () => {
				try {
					await vscode.workspace.fs.delete(context.destination);
				} catch {
					// already gone
				}
			},
		};
	}
}

export function registerScreenEditor(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.window.registerCustomEditorProvider(VIEW_TYPE, new ScreenEditorProvider(), {
			webviewOptions: { retainContextWhenHidden: true },
			supportsMultipleEditorsPerDocument: false,
		}),
		vscode.commands.registerCommand("irite.editScreens", async (arg?: unknown) => {
			const rev = await locateRev(arg);
			if (!rev) {
				void vscode.window.showErrorMessage("iRite: no .rev file found. Open a project containing main.rev.");
				return;
			}
			await vscode.commands.executeCommand("vscode.openWith", vscode.Uri.file(rev), VIEW_TYPE);
		}),
	);
}
