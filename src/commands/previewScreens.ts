// irite.previewScreens: read-only webview of every 1280 screen in a Revolution `.rev`.
// Never writes `.rev` or sources.
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { parseOpenMessage } from "../callmap/callContext";
import { loadIriteProject } from "../irite";
import type { IriteProjectModel } from "../irite";
import { previewState } from "../preview/previewState";
import type { PreviewState } from "../preview/previewState";
import { renderScreensHtml } from "../preview/screenHtml";
import { buildScreenView } from "../preview/screenModel";
import { parseRev } from "../rev";

const VIEW_TYPE = "irite.previewScreens";

function readText(p: string): string | undefined {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return undefined;
  }
}

async function locateRev(arg: unknown): Promise<string | undefined> {
  if (arg instanceof vscode.Uri && arg.scheme === "file" && /\.rev$/i.test(arg.fsPath)) {
    return arg.fsPath;
  }
  const found: string[] = [];
  const active = vscode.window.activeTextEditor?.document.uri;
  if (active?.scheme === "file") {
    let dir = path.dirname(active.fsPath);
    for (;;) {
      const here = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => /\.rev$/i.test(n)) : [];
      if (here.length > 0) {
        found.push(...here.map((n) => path.join(dir, n)));
        break;
      }
      const parent = path.dirname(dir);
      if (parent === dir) {
        break;
      }
      dir = parent;
    }
  }
  if (found.length === 0) {
    for (const f of await vscode.workspace.findFiles("**/*.rev", "**/node_modules/**", 20)) {
      found.push(f.fsPath);
    }
  }
  if (found.length === 0) {
    return undefined;
  }
  if (found.length === 1) {
    return found[0];
  }
  const pick = await vscode.window.showQuickPick(
    found.map((f) => ({ label: path.basename(f), description: path.dirname(f), file: f })),
    { placeHolder: "Select the .rev to preview" },
  );
  return pick?.file;
}

class ScreenPreview {
  private static panels = new Map<string, ScreenPreview>();
  private readonly watchers: vscode.Disposable[] = [];
  private timer: NodeJS.Timeout | undefined;
  private project: IriteProjectModel | undefined;
  /** Preview-only state (screen, panel, hidden widgets, z-order): kept for the life of the panel, never written anywhere. */
  private state: PreviewState = previewState.emptyState();

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly revPath: string,
  ) {
    const dir = path.dirname(revPath);
    const schedule = (): void => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.render(), 300);
    };
    for (const glob of ["*.rev", "**/*.iri", "**/*.src", "sdimages/*"]) {
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
      ScreenPreview.panels.delete(revPath.toLowerCase());
    });
    this.render();
  }

  static open(revPath: string): void {
    const key = revPath.toLowerCase();
    const existing = ScreenPreview.panels.get(key);
    if (existing) {
      existing.panel.reveal();
      existing.render();
      return;
    }
    const dir = path.dirname(revPath);
    const panel = vscode.window.createWebviewPanel(VIEW_TYPE, `Screens: ${path.basename(revPath)}`, vscode.ViewColumn.Beside, {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.file(dir)],
    });
    ScreenPreview.panels.set(key, new ScreenPreview(panel, revPath));
  }

  private render(): void {
    try {
      const dir = path.dirname(this.revPath);
      const rev = parseRev(readText(this.revPath) ?? "");
      const mainSrc = path.join(dir, "main.src");
      this.project = fs.existsSync(mainSrc) ? loadIriteProject(mainSrc, readText) : undefined;
      const view = buildScreenView(rev, this.project);
      const webview = this.panel.webview;
      this.panel.webview.html = renderScreensHtml(view, {
        cspSource: webview.cspSource,
        nonce: crypto.randomBytes(16).toString("base64"),
        title: path.basename(this.revPath),
        initialState: this.state,
        imageUri: (rel) => {
          const abs = path.join(dir, rel);
          return fs.existsSync(abs) ? webview.asWebviewUri(vscode.Uri.file(abs)).toString() : undefined;
        },
      });
    } catch (e) {
      this.panel.webview.html = `<!DOCTYPE html><html><body>Could not render preview.</body></html>`;
      console.error("iRite preview failed", e);
    }
  }

  private onMessage(m: unknown): void {
    const msg = m as { type?: unknown; state?: unknown } | null | undefined;
    if (msg?.type === "state") {
      this.state = previewState.sanitize(msg.state);
      return;
    }
    // Only open files that belong to the loaded project, at a validated line.
    const target = parseOpenMessage(this.project?.files ?? [], m);
    if (!target) {
      return;
    }
    const line = target.line - 1;
    void vscode.window.showTextDocument(vscode.Uri.file(target.file), {
      selection: new vscode.Range(line, 0, line, 0),
      viewColumn: vscode.ViewColumn.One,
    });
  }
}

export function registerPreviewCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("irite.previewScreens", async (arg?: unknown) => {
      const rev = await locateRev(arg);
      if (!rev) {
        void vscode.window.showErrorMessage("iRite: no .rev file found. Open a project containing main.rev.");
        return;
      }
      ScreenPreview.open(rev);
    }),
  );
}
