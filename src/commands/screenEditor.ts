// irite.screenEditor: opt-in editor of the 1280 screens that writes widget geometry back into the `.rev`.
// A CustomEditorProvider, so undo/redo, dirty state, save and revert come from VS Code. Registered with
// priority "option": it is never the default editor of `.rev` (use "Open With..." or `iRite: Edit Screens`).
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { backupPath } from "../editor/backup";
import { enrichRev } from "../editor/catalogModel";
import { renderEditorHtml } from "../editor/editorHtml";
import {
	addWidget,
	changedIds,
	aliasEntries,
	deleteWidget,
	editLabel,
	effectiveGeometry,
	effectiveWidgets,
	emptyEditState,
	parseEditState,
	renameAlias,
	serializeEditState,
	setGeometry,
	setProp,
	structuralChanged,
	toOps,
	withEdits,
} from "../editor/editState";
import type { EditState } from "../editor/editState";
import { imagePickerModel } from "../editor/imagePicker";
import { loadImageCache } from "../firmware/imageCache";
import { builtinResolver, confinedFile } from "../firmware/imageResolver";
import { resolveImage } from "../rev";
import { iriHint } from "../editor/iriHint";
import type { IriHint } from "../editor/iriHint";
import { DEFAULT_GRID, parseEditorMessage } from "../editor/messages";
import { effectiveRev, planSave } from "../editor/saveRev";
import { loadIriteProject } from "../irite";
import type { IriteProjectModel } from "../irite";
import { previewState } from "../preview/previewState";
import type { PreviewState } from "../preview/previewState";
import { buildScreenView } from "../preview/screenModel";
import type { WidgetView } from "../preview/screenModel";
import { parseRev } from "../rev";
import type { RevModel } from "../rev";
import { locateRev } from "./previewScreens";
import { offerRegenerate } from "./regenerateIri";

const VIEW_TYPE = "irite.screenEditor";

const WARNING =
	"Saving writes your widget changes (edited, added and deleted widgets) into this .rev and recomputes Revolution's integrity hash (ConfigHash). " +
	"The result has not been verified in Revolution or on a 1280.";
const WARNING_DETAIL =
	"Before writing, the current file is copied next to it (main.rev.bak, or a timestamped name when that exists). " +
	"Only the WDGT lines of the edited, added or deleted widgets and the ConfigHash line change; every other byte stays as it is. " +
	"main.iri is not changed by saving: run \"iRite: Regenerate main.iri from .rev\" afterwards (a backup of main.iri is kept). " +
	"Open the saved file in Revolution before loading it on an indicator, and keep the backup until you have.";

class RevDocument implements vscode.CustomDocument {
	/** The hash/confirmation warning is shown once per document and session. */
	confirmed = false;
	/** Bytes as opened (or last reverted): the edit state is always relative to these, so undo after a save still works. */
	original: Buffer;
	readonly panels = new Set<vscode.WebviewPanel>();
	view: PreviewState = previewState.emptyState();
	/** Widget selected in the page; kept across rebuilds of the page. */
	selected: number | null = null;
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

/** File names of `sdimages/` next to the `.rev` (the image picker's list). */
function listImages(dir: string): string[] {
	try {
		return fs
			.readdirSync(path.join(dir, "sdimages"))
			.filter((f) => /\.(png|svg|jpe?g|bmp|gif)$/i.test(f))
			.sort((a, b) => a.localeCompare(b))
			.slice(0, 500);
	} catch {
		return [];
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
	constructor(private readonly storageDir: string) {}

	private readonly changeEmitter = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<RevDocument>>();
	readonly onDidChangeCustomDocument = this.changeEmitter.event;

	async openCustomDocument(uri: vscode.Uri, openContext: vscode.CustomDocumentOpenContext): Promise<RevDocument> {
		if (uri.scheme !== "file") {
			throw new Error("iRite: the screen editor only opens .rev files on disk.");
		}
		const bytes = fs.readFileSync(uri.fsPath);
		const rev = enrichRev(parseRev(bytes.toString("utf8")));
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
		panel.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.file(path.dirname(document.uri.fsPath)), vscode.Uri.file(path.join(this.storageDir, "firmware-images"))] };
		document.panels.add(panel);
		panel.onDidDispose(() => document.panels.delete(panel));
		panel.webview.onDidReceiveMessage((m: unknown) => {
			void this.onMessage(document, m).catch((e) => console.error("iRite screen editor message failed", e));
		});
		this.render(document, panel);
	}

	private render(doc: RevDocument, panel: vscode.WebviewPanel): void {
		try {
			const dir = path.dirname(doc.uri.fsPath);
			const webview = panel.webview;
			const cache = loadImageCache(this.storageDir, vscode.workspace.getConfiguration("irite.firmware").get<string>("imagesVersion", ""));
			const toUri = (p: string): string => webview.asWebviewUri(vscode.Uri.file(p)).toString();
			const builtinUri = (p: string): string => {
				const file = confinedFile(path.join(this.storageDir, "firmware-images"), p);
				return file ? toUri(file) : "";
			};
			const imageUri = (rel: string): string | undefined => {
				const file = confinedFile(path.join(dir, "sdimages"), path.join(dir, rel));
				return file ? toUri(file) : undefined;
			};
			const images = listImages(dir);
			const fileUri = (name: string): string | undefined => {
				const ref = resolveImage(name, dir);
				if (ref.kind !== "file") return undefined;
				return imageUri(ref.relPath);
			};
			webview.html = renderEditorHtml(buildScreenView(this.effective(doc), doc.project), {
				selected: doc.selected,
				images,
				builtinUri: builtinResolver(cache, builtinUri),
				gallery: imagePickerModel(cache, images, { builtinUri, fileUri }),
				hint: this.hint(doc),
				cspSource: webview.cspSource,
				nonce: crypto.randomBytes(16).toString("base64"),
				title: path.basename(doc.uri.fsPath),
				initialState: doc.view,
				prefs: doc.prefs,
				imageUri,
			});
		} catch (e) {
			panel.webview.html = `<!DOCTYPE html><html><body>Could not render the screen editor.</body></html>`;
			console.error("iRite screen editor failed", e);
		}
	}

	/** The model with every edit applied (what the page shows); falls back to geometry-only edits if it cannot be built. */
	private effective(doc: RevDocument): RevModel {
		try {
			return enrichRev(effectiveRev(doc.original, toOps(doc.rev, doc.state)));
		} catch {
			return { ...doc.rev, widgets: withEdits(doc.rev.widgets, doc.state) };
		}
	}

	private hint(doc: RevDocument): IriHint {
		return iriHint(aliasEntries(doc.rev, emptyEditState()), aliasEntries(doc.rev, doc.state));
	}

	private renderAll(doc: RevDocument): void {
		for (const p of doc.panels) {
			this.render(doc, p);
		}
	}

	private notice(doc: RevDocument, text: string): void {
		for (const p of doc.panels) {
			void p.webview.postMessage({ type: "notice", text });
		}
	}

	/** Code references of widget `id`, from the issue #5 reference index over the project of the `.rev`. */
	private refsOf(doc: RevDocument, id: number): { alias: string; total: number; groups: WidgetView["refGroups"] } {
		const widget = buildScreenView(this.effective(doc), doc.project)
			.screens.flatMap((s) => s.widgets)
			.find((w) => w.id === id);
		return { alias: widget?.alias ?? "", total: widget?.references.length ?? 0, groups: widget?.refGroups ?? [] };
	}

	private showRefs(doc: RevDocument, id: number): ReturnType<ScreenEditorProvider["refsOf"]> {
		const refs = this.refsOf(doc, id);
		for (const p of doc.panels) {
			void p.webview.postMessage({ type: "refs", id, ...refs });
		}
		return refs;
	}

	/** Modal warning when the alias is used in code; true when there is nothing to warn about or the user accepts. */
	private async confirmUse(doc: RevDocument, id: number, verb: "Delete" | "Rename"): Promise<boolean> {
		const refs = this.showRefs(doc, id);
		if (refs.total === 0) {
			return true;
		}
		const sites = refs.groups.flatMap((g) => g.routines.flatMap((r) => r.sites.map((s) => `${g.label}:${s.line}  ${r.routine}  (${s.callee})`)));
		const more = sites.length > 12 ? `\n... and ${sites.length - 12} more (see the references panel)` : "";
		const ok = `${verb} anyway`;
		const pick = await vscode.window.showWarningMessage(
			`The alias "${refs.alias}" is used in ${refs.total} place${refs.total === 1 ? "" : "s"} of the code.`,
			{ modal: true, detail: `${sites.slice(0, 12).join("\n")}${more}\n\nThe code will not compile until it is updated and main.iri has the matching constants.` },
			ok,
		);
		return pick === ok;
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

	/** Records `after` as one undoable edit and brings the pages up to date. */
	private commit(doc: RevDocument, label: string, after: EditState, selected?: number | null): void {
		const before = doc.state;
		if (selected !== undefined) {
			doc.selected = selected;
		}
		if (JSON.stringify(before) === JSON.stringify(after)) {
			this.notice(doc, "");
			return;
		}
		doc.state = after;
		this.changeEmitter.fire({
			document: doc,
			label,
			undo: () => {
				doc.state = before;
				this.refresh(doc, after, before);
			},
			redo: () => {
				doc.state = after;
				this.refresh(doc, before, after);
			},
		});
		this.refresh(doc, before, after);
	}

	/** Geometry-only changes of widgets in the file are synced in place; anything else rebuilds the page. */
	private refresh(doc: RevDocument, a: EditState, b: EditState): void {
		if (structuralChanged(a, b)) {
			this.renderAll(doc);
		} else {
			this.sync(doc, changedIds(a, b));
		}
	}

	private reject(doc: RevDocument, id: number, reason: string): void {
		this.notice(doc, reason);
		this.sync(doc, [id]);
	}

	private async onMessage(doc: RevDocument, raw: unknown): Promise<void> {
		const widgets = effectiveWidgets(doc.rev, doc.state);
		const msg = parseEditorMessage(raw, new Set(widgets.map((w) => w.id)), new Map(widgets.map((w) => [w.id, w.type])));
		if (!msg) {
			return;
		}
		switch (msg.type) {
			case "state":
				doc.view = msg.state;
				return;
			case "prefs":
				doc.prefs = { snap: msg.snap, grid: msg.grid };
				return;
			case "select":
				doc.selected = msg.id;
				return;
			case "requestRefs":
				this.showRefs(doc, msg.id);
				return;
			case "edit": {
				const r = setGeometry(doc.state, doc.rev, msg.id, msg.patch);
				if (!r.ok) {
					this.reject(doc, msg.id, r.reason);
					return;
				}
				if (JSON.stringify(r.state) === JSON.stringify(doc.state)) {
					this.sync(doc, [msg.id]); // nothing changed: put the page back on the real value
					return;
				}
				this.commit(doc, editLabel({ id: msg.id }, msg.patch), r.state);
				return;
			}
			case "setProp": {
				const r = setProp(doc.state, doc.rev, msg.id, msg.field, msg.value);
				if (!r.ok) {
					this.reject(doc, msg.id, r.reason);
					return;
				}
				this.notice(doc, "");
				this.commit(doc, `Set ${msg.field} of widget ${msg.id}`, r.state);
				return;
			}
			case "add": {
				const r = addWidget(doc.state, doc.rev, { type: msg.widgetType, x: msg.x, y: msg.y, screen: msg.screen });
				if (!r.ok) {
					this.notice(doc, r.reason);
					return;
				}
				this.commit(doc, `Add widget ${r.id}`, r.state, r.id);
				this.notice(doc, "");
				return;
			}
			case "renameAlias": {
				const check = renameAlias(doc.state, doc.rev, msg.id, msg.alias);
				if (!check.ok) {
					this.reject(doc, msg.id, check.reason);
					return;
				}
				if (JSON.stringify(check.state) !== JSON.stringify(doc.state) && !(await this.confirmUse(doc, msg.id, "Rename"))) {
					this.notice(doc, "Rename cancelled.");
					return;
				}
				const r = renameAlias(doc.state, doc.rev, msg.id, msg.alias);
				if (!r.ok) {
					this.reject(doc, msg.id, r.reason);
					return;
				}
				this.notice(doc, "");
				this.commit(doc, `Rename alias of widget ${msg.id}`, r.state);
				return;
			}
			case "delete": {
				if (!(await this.confirmUse(doc, msg.id, "Delete"))) {
					return;
				}
				const r = deleteWidget(doc.state, doc.rev, msg.id);
				if (!r.ok) {
					this.notice(doc, r.reason);
					return;
				}
				this.notice(doc, "");
				this.commit(doc, `Delete widget ${msg.id}`, r.state, null);
				return;
			}
		}
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
		const parts = plan ? [`${plan.changed.length} edited`, `${plan.added.length} added`, `${plan.removed.length} removed`] : [];
		const h = this.hint(doc);
		const iri = h.add.length + h.change.length + h.remove.length > 0 ? " main.iri needs constant changes: regenerate it (button below) or see the panel of the editor." : "";
		offerRegenerate(`iRite: saved ${path.basename(target)} (widget lines: ${parts.join(", ")}). Backup: ${path.basename(backup)}. ConfigHash recomputed.${iri}`, target);
	}

	async saveCustomDocumentAs(doc: RevDocument, destination: vscode.Uri): Promise<void> {
		const plan = planSave(doc.original, doc.state);
		await this.confirm(doc);
		writeAtomic(destination.fsPath, plan ? plan.bytes : doc.original);
	}

	async revertCustomDocument(doc: RevDocument): Promise<void> {
		doc.bytes = fs.readFileSync(doc.uri.fsPath);
		doc.original = doc.bytes;
		doc.rev = enrichRev(parseRev(doc.bytes.toString("utf8")));
		doc.project = loadProject(doc.uri.fsPath);
		doc.state = emptyEditState();
		doc.selected = null;
		this.renderAll(doc);
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
		vscode.window.registerCustomEditorProvider(VIEW_TYPE, new ScreenEditorProvider(context.globalStorageUri.fsPath), {
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
