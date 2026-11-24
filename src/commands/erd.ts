// irite.showErd: read-only webview ERD of the project's databases (iRite sources + optional `.rev`).
// Never writes `.rev` or sources.
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { buildErd } from "../erd/erdModel";
import { renderErdHtml } from "../erd/erdHtml";
import { loadIriteProject } from "../irite";
import type { IriteProjectModel } from "../irite";
import { parseRev } from "../rev";

const VIEW_TYPE = "irite.showErd";

function readText(p: string): string | undefined {
	try {
		return fs.readFileSync(p, "utf8");
	} catch {
		return undefined;
	}
}

async function locateMainSrc(arg: unknown): Promise<string | undefined> {
	if (arg instanceof vscode.Uri && arg.scheme === "file") {
		const dir = path.dirname(arg.fsPath);
		const main = path.join(dir, "main.src");
		if (fs.existsSync(main)) {
			return main;
		}
	}
	const active = vscode.window.activeTextEditor?.document.uri;
	if (active?.scheme === "file") {
		let dir = path.dirname(active.fsPath);
		for (;;) {
			const main = path.join(dir, "main.src");
			if (fs.existsSync(main)) {
				return main;
			}
			const parent = path.dirname(dir);
			if (parent === dir) {
				break;
			}
			dir = parent;
		}
	}
	const found = (await vscode.workspace.findFiles("**/main.src", "**/node_modules/**", 20)).map((f) => f.fsPath);
	if (found.length <= 1) {
		return found[0];
	}
	const pick = await vscode.window.showQuickPick(
		found.map((f) => ({ label: path.relative(path.dirname(path.dirname(f)), f), description: path.dirname(f), file: f })),
		{ placeHolder: "Select the project (main.src)" },
	);
	return pick?.file;
}

class ErdPanel {
	private static panels = new Map<string, ErdPanel>();
	private readonly watchers: vscode.Disposable[] = [];
	private timer: NodeJS.Timeout | undefined;
	private project: IriteProjectModel | undefined;

	private constructor(
		private readonly panel: vscode.WebviewPanel,
		private readonly mainSrc: string,
	) {
		const dir = path.dirname(mainSrc);
		const schedule = (): void => {
			clearTimeout(this.timer);
			this.timer = setTimeout(() => this.render(), 300);
		};
		for (const glob of ["*.rev", "**/*.iri", "**/*.src"]) {
			const w = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(dir, glob));
			w.onDidChange(schedule);
			w.onDidCreate(schedule);
			w.onDidDelete(schedule);
			this.watchers.push(w);
		}
		panel.webview.onDidReceiveMessage((m: unknown) => this.onMessage(m));
		panel.onDidDispose(() => {
			clearTimeout(this.timer);
			this.watchers.forEach((w) => w.dispose());
			ErdPanel.panels.delete(mainSrc.toLowerCase());
		});
		this.render();
	}

	static open(mainSrc: string): void {
		const key = mainSrc.toLowerCase();
		const existing = ErdPanel.panels.get(key);
		if (existing) {
			existing.panel.reveal();
			existing.render();
			return;
		}
		const panel = vscode.window.createWebviewPanel(VIEW_TYPE, `ERD: ${path.basename(path.dirname(mainSrc))}`, vscode.ViewColumn.Beside, {
			enableScripts: true,
		});
		ErdPanel.panels.set(key, new ErdPanel(panel, mainSrc));
	}

	private render(): void {
		try {
			const dir = path.dirname(this.mainSrc);
			this.project = loadIriteProject(this.mainSrc, readText);
			const revFile = fs
				.readdirSync(dir)
				.filter((n) => /\.rev$/i.test(n))
				.sort((a, b) => (a.toLowerCase() === "main.rev" ? -1 : b.toLowerCase() === "main.rev" ? 1 : a.localeCompare(b)))[0];
			const revText = revFile ? readText(path.join(dir, revFile)) : undefined;
			const erd = buildErd(this.project, revText !== undefined ? parseRev(revText) : undefined);
			this.panel.webview.html = renderErdHtml(erd, {
				cspSource: this.panel.webview.cspSource,
				nonce: crypto.randomBytes(16).toString("base64"),
				title: `Database diagram: ${path.basename(dir)}`,
			});
		} catch (e) {
			this.panel.webview.html = `<!DOCTYPE html><html><body>Could not render the database diagram.</body></html>`;
			console.error("iRite ERD failed", e);
		}
	}

	private onMessage(m: unknown): void {
		const msg = m as { type?: string; file?: unknown; line?: unknown };
		if (msg?.type !== "open" || typeof msg.file !== "string" || typeof msg.line !== "number") {
			return;
		}
		// Only open files that belong to the loaded project.
		const known = this.project?.files.some((f) => path.normalize(f).toLowerCase() === path.normalize(msg.file as string).toLowerCase());
		if (!known) {
			return;
		}
		const line = Math.max(0, Math.floor(msg.line) - 1);
		void vscode.window.showTextDocument(vscode.Uri.file(msg.file), {
			selection: new vscode.Range(line, 0, line, 0),
			viewColumn: vscode.ViewColumn.One,
		});
	}
}

export function registerErdCommands(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.commands.registerCommand("irite.showErd", async (arg?: unknown) => {
			const main = await locateMainSrc(arg);
			if (!main) {
				void vscode.window.showErrorMessage("iRite: no main.src found. Open a project containing main.src.");
				return;
			}
			ErdPanel.open(main);
		}),
	);
}
