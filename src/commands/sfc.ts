// irite.showSfc: read-only webview with the SFC/Grafcet diagram of the Petri FSM. Never writes sources.
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { loadIriteProject } from "../irite";
import type { IriteProjectModel } from "../irite";
import { layoutSfc } from "../sfc/sfcLayout";
import { buildSfc } from "../sfc/sfcModel";
import type { SfcOptions } from "../sfc/sfcModel";
import { renderSfcHtml } from "../sfc/sfcHtml";

const VIEW_TYPE = "irite.showSfc";

function readText(p: string): string | undefined {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return undefined;
  }
}

const isMainSrc = (p: string): boolean => path.basename(p).toLowerCase() === "main.src";

async function locateMainSrc(arg: unknown): Promise<string | undefined> {
  if (arg instanceof vscode.Uri && arg.scheme === "file" && isMainSrc(arg.fsPath)) {
    return arg.fsPath;
  }
  const found: string[] = [];
  const active = vscode.window.activeTextEditor?.document.uri;
  if (active?.scheme === "file") {
    let dir = path.dirname(active.fsPath);
    for (;;) {
      const candidate = path.join(dir, "main.src");
      if (fs.existsSync(candidate)) {
        found.push(candidate);
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
    for (const f of await vscode.workspace.findFiles("**/main.src", "**/node_modules/**", 20)) {
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
    found.map((f) => ({ label: path.basename(path.dirname(f)), description: f, file: f })),
    { placeHolder: "Select the iRite project (main.src)" },
  );
  return pick?.file;
}

function readOptions(): SfcOptions {
  const cfg = vscode.workspace.getConfiguration("irite.sfc");
  const str = (k: string): string | undefined => {
    const v = cfg.get<string>(k);
    return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
  };
  return { statesEnum: str("statesEnum"), transitionsEnum: str("transitionsEnum"), initialStep: str("initialStep") };
}

class SfcPanel {
  private static panels = new Map<string, SfcPanel>();
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
    for (const glob of ["**/*.iri", "**/*.src"]) {
      const w = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(dir, glob));
      w.onDidChange(schedule);
      w.onDidCreate(schedule);
      w.onDidDelete(schedule);
      this.watchers.push(w);
    }
    this.watchers.push(vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration("irite.sfc") && schedule()));
    panel.webview.onDidReceiveMessage((m: unknown) => this.onMessage(m));
    panel.onDidDispose(() => {
      clearTimeout(this.timer);
      this.watchers.forEach((w) => w.dispose());
      SfcPanel.panels.delete(mainSrc.toLowerCase());
    });
    this.render();
  }

  static open(mainSrc: string): void {
    const key = mainSrc.toLowerCase();
    const existing = SfcPanel.panels.get(key);
    if (existing) {
      existing.panel.reveal();
      existing.render();
      return;
    }
    const title = `SFC: ${path.basename(path.dirname(mainSrc))}`;
    const panel = vscode.window.createWebviewPanel(VIEW_TYPE, title, vscode.ViewColumn.Beside, {
      enableScripts: true,
      localResourceRoots: [],
    });
    SfcPanel.panels.set(key, new SfcPanel(panel, mainSrc));
  }

  private render(): void {
    try {
      this.project = loadIriteProject(this.mainSrc, readText);
      const sfc = buildSfc(this.project, readOptions());
      this.panel.webview.html = renderSfcHtml(sfc, layoutSfc(sfc), {
        cspSource: this.panel.webview.cspSource,
        nonce: crypto.randomBytes(16).toString("base64"),
        title: `SFC: ${path.basename(path.dirname(this.mainSrc))}`,
      });
    } catch (e) {
      this.panel.webview.html = `<!DOCTYPE html><html><body>Could not render the SFC diagram.</body></html>`;
      console.error("iRite SFC failed", e);
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

export function registerSfcCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("irite.showSfc", async (arg?: unknown) => {
      const main = await locateMainSrc(arg);
      if (!main) {
        void vscode.window.showErrorMessage("iRite: no main.src found. Open a project containing main.src.");
        return;
      }
      SfcPanel.open(main);
    }),
  );
}
