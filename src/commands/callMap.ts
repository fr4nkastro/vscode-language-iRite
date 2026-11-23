// irite.showCallMap: read-only webview with the C4-style call map (system -> modules -> routines).
// Never writes `.src`/`.iri`/`.rev`.
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { buildCallGraph } from "../callmap/callGraph";
import { buildSystemContext, parseOpenMessage, sanitizeViewState } from "../callmap/callContext";
import type { ViewState } from "../callmap/callContext";
import { renderCallMapHtml } from "../callmap/callMapHtml";
import { loadIriteProject } from "../irite";
import type { IriteProjectModel } from "../irite";
import { parseRev } from "../rev";
import { locateMainSrc, readText } from "./locateProject";

const VIEW_TYPE = "irite.showCallMap";

class CallMapPanel {
	private static panels = new Map<string, CallMapPanel>();
	private readonly watchers: vscode.Disposable[] = [];
	private timer: NodeJS.Timeout | undefined;
	private project: IriteProjectModel | undefined;
	/** Last view the webview reported, re-embedded when a file change refreshes the page. */
	private state: ViewState | undefined;

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
			CallMapPanel.panels.delete(mainSrc.toLowerCase());
		});
		this.render();
	}

	static open(mainSrc: string): void {
		const key = mainSrc.toLowerCase();
		const existing = CallMapPanel.panels.get(key);
		if (existing) {
			existing.panel.reveal();
			existing.render();
			return;
		}
		const panel = vscode.window.createWebviewPanel(VIEW_TYPE, `Call map: ${path.basename(path.dirname(mainSrc))}`, vscode.ViewColumn.Beside, {
			enableScripts: true,
			localResourceRoots: [],
		});
		CallMapPanel.panels.set(key, new CallMapPanel(panel, mainSrc));
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
			const graph = buildCallGraph(this.project, dir);
			const context = buildSystemContext(graph, path.basename(dir), revText !== undefined ? parseRev(revText) : undefined);
			this.panel.webview.html = renderCallMapHtml(
				{ graph, context, state: this.state },
				{ cspSource: this.panel.webview.cspSource, nonce: crypto.randomBytes(16).toString("base64"), title: `Call map: ${path.basename(dir)}` },
			);
		} catch (e) {
			this.panel.webview.html = `<!DOCTYPE html><html><body>Could not render the call map.</body></html>`;
			console.error("iRite call map failed", e);
		}
	}

	private onMessage(m: unknown): void {
		const type = (m as { type?: unknown } | null)?.type;
		if (type === "state") {
			this.state = sanitizeViewState((m as { state?: unknown }).state) ?? this.state;
			return;
		}
		const open = parseOpenMessage(this.project?.files ?? [], m);
		if (!open) {
			return;
		}
		const line = open.line - 1;
		void vscode.window.showTextDocument(vscode.Uri.file(open.file), {
			selection: new vscode.Range(line, 0, line, 0),
			viewColumn: vscode.ViewColumn.One,
		});
	}
}

export function registerCallMapCommands(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.commands.registerCommand("irite.showCallMap", async (arg?: unknown) => {
			const main = await locateMainSrc(arg);
			if (!main) {
				void vscode.window.showErrorMessage("iRite: no main.src found. Open a project containing main.src.");
				return;
			}
			CallMapPanel.open(main);
		}),
	);
}
