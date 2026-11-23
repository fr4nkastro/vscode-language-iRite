// irite.showSfc: read-only webview with the SFC/Grafcet diagram of the Petri FSM. Never writes sources.
import * as crypto from "crypto";
import * as path from "path";
import * as vscode from "vscode";
import { loadIriteProject } from "../irite";
import type { IriteProjectModel } from "../irite";
import { layoutSfc } from "../sfc/sfcLayout";
import { buildSfc } from "../sfc/sfcModel";
import type { SfcOptions } from "../sfc/sfcModel";
import { renderSfcHtml } from "../sfc/sfcHtml";
import { groupSfcDiagnostics, toVsSeverityName } from "../sfc/sfcDiagnostics";
import type { SfcDiagnostic } from "../sfc/sfcModel";
import { locateMainSrc, readText } from "./locateProject";

const VIEW_TYPE = "irite.showSfc";

/**
 * Publishes the SFC diagnostics of each open panel to the Problems view (collection `irite-sfc`).
 * A project's entries live while its panel is open: they are replaced on every refresh and removed
 * when the panel is closed (disposed). Only entries this class published are ever deleted.
 */
class SfcProblems {
  private readonly collection = vscode.languages.createDiagnosticCollection("irite-sfc");
  private readonly published = new Map<string, vscode.Uri[]>();

  publish(mainSrc: string, diagnostics: SfcDiagnostic[]): void {
    this.clear(mainSrc);
    const uris: vscode.Uri[] = [];
    for (const [file, items] of groupSfcDiagnostics(diagnostics, mainSrc)) {
      const uri = vscode.Uri.file(file);
      this.collection.set(
        uri,
        items.map((i) => {
          const line = Math.max(0, i.line - 1);
          const d = new vscode.Diagnostic(new vscode.Range(line, 0, line, 1000), i.message, vscode.DiagnosticSeverity[toVsSeverityName(i.severity)]);
          d.source = "iRite SFC";
          d.code = i.code;
          return d;
        }),
      );
      uris.push(uri);
    }
    this.published.set(mainSrc.toLowerCase(), uris);
  }

  clear(mainSrc: string): void {
    for (const uri of this.published.get(mainSrc.toLowerCase()) ?? []) {
      this.collection.delete(uri);
    }
    this.published.delete(mainSrc.toLowerCase());
  }

  dispose(): void {
    this.collection.dispose();
  }
}

let problems: SfcProblems | undefined;

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
      problems?.clear(mainSrc);
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
      problems?.publish(this.mainSrc, sfc.diagnostics);
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
  problems = new SfcProblems();
  context.subscriptions.push({ dispose: () => problems?.dispose() });
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
