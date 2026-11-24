// irite.showSfc: webview with the SFC/Grafcet diagram of the Petri FSM. The only file it ever writes is the
// layout sidecar (.vscode/irite-sfc.layout.json); it never touches .src/.iri/.rev.
import * as crypto from "crypto";
import * as path from "path";
import * as vscode from "vscode";
import { loadIriteProject } from "../irite";
import type { IriteProjectModel } from "../irite";
import { layoutSfc } from "../sfc/sfcLayout";
import type { SfcLayout } from "../sfc/sfcLayout";
import { knownKeys, mergeLayout, mergeSave } from "../sfc/sfcLayoutEdit";
import { describeProblem, loadDiagram, saveDiagram, sidecarPath } from "../sfc/sfcLayoutStore";
import { SIDECAR_RELATIVE_PATH, diagramKey } from "../sfc/sfcSidecar";
import type { SavedDiagram } from "../sfc/sfcSidecar";
import { buildSfc } from "../sfc/sfcModel";
import type { SfcOptions } from "../sfc/sfcModel";
import { renderSfcHtml } from "../sfc/sfcHtml";
import { groupSfcDiagnostics, toVsSeverityName } from "../sfc/sfcDiagnostics";
import type { SfcDiagnostic } from "../sfc/sfcModel";
import { locateMainSrc, readText } from "./locateProject";

const VIEW_TYPE = "irite.showSfc";
const SAVE_DELAY_MS = 250;

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

/** Sidecar file and diagram key of a project: the layout lives in its workspace folder (or next to main.src). */
function sidecarFor(mainSrc: string, opts: SfcOptions): { file: string; key: string } {
  const base = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(mainSrc))?.uri.fsPath ?? path.dirname(mainSrc);
  return { file: sidecarPath(base), key: diagramKey(base, mainSrc, opts.statesEnum, opts.transitionsEnum) };
}

class SfcPanel {
  private static panels = new Map<string, SfcPanel>();
  private readonly watchers: vscode.Disposable[] = [];
  private timer: NodeJS.Timeout | undefined;
  private saveTimer: NodeJS.Timeout | undefined;
  private project: IriteProjectModel | undefined;
  /** Layout stored for this diagram; kept in memory so a re-render never shows stale positions. */
  private saved: SavedDiagram | undefined;
  private known: ReturnType<typeof knownKeys> | undefined;
  private target: { file: string; key: string } | undefined;
  private warned = false;

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
      if (this.saveTimer) {
        this.flush(); // never lose an edit made just before the tab is closed
      }
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

  /** Deletes the saved layout of a project's diagram; refreshes its panel when it is open. */
  static reset(mainSrc: string): void {
    const open = SfcPanel.panels.get(mainSrc.toLowerCase());
    if (open) {
      open.reset();
      return;
    }
    const { file, key } = sidecarFor(mainSrc, readOptions());
    const r = saveDiagram(file, key, undefined);
    void (r.ok
      ? vscode.window.showInformationMessage("iRite: saved SFC layout removed.")
      : vscode.window.showWarningMessage(`iRite: ${SIDECAR_RELATIVE_PATH} ${describeProblem(r.reason)}; layout not reset.`));
  }

  private reset(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    const { file, key } = sidecarFor(this.mainSrc, readOptions());
    const r = saveDiagram(file, key, undefined);
    if (r.ok) {
      this.saved = undefined;
    } else {
      this.warn(`iRite: ${SIDECAR_RELATIVE_PATH} ${describeProblem(r.reason)}; layout not reset.`);
    }
    this.render();
  }

  private warn(message: string): void {
    if (!this.warned) {
      this.warned = true;
      void vscode.window.showWarningMessage(message);
    }
  }

  private render(): void {
    try {
      this.project = loadIriteProject(this.mainSrc, readText);
      const options = readOptions();
      const sfc = buildSfc(this.project, options);
      problems?.publish(this.mainSrc, sfc.diagnostics);
      const auto: SfcLayout = layoutSfc(sfc);
      this.known = knownKeys(auto);
      this.target = sidecarFor(this.mainSrc, options);
      let warning: string | undefined;
      if (!this.saveTimer) {
        const loaded = loadDiagram(this.target.file, this.target.key);
        this.saved = loaded.diagram;
        if (loaded.problem) {
          warning = `${SIDECAR_RELATIVE_PATH} ${describeProblem(loaded.problem)}; the automatic layout is shown and edits are not saved until it is fixed or deleted.`;
        }
      }
      const { layout, ignored } = mergeLayout(auto, this.saved);
      this.panel.webview.html = renderSfcHtml(sfc, layout, {
        cspSource: this.panel.webview.cspSource,
        nonce: crypto.randomBytes(16).toString("base64"),
        title: `SFC: ${path.basename(path.dirname(this.mainSrc))}`,
        layoutInfo: { file: SIDECAR_RELATIVE_PATH, saved: this.saved !== undefined, ignored: [...ignored.steps, ...ignored.links], warning },
      });
    } catch (e) {
      this.panel.webview.html = `<!DOCTYPE html><html><body>Could not render the SFC diagram.</body></html>`;
      console.error("iRite SFC failed", e);
    }
  }

  private flush(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    if (!this.target) {
      return;
    }
    const r = saveDiagram(this.target.file, this.target.key, this.saved);
    if (!r.ok) {
      this.warn(`iRite: could not save the SFC layout: ${SIDECAR_RELATIVE_PATH} ${describeProblem(r.reason)}.`);
    }
  }

  private onMessage(m: unknown): void {
    const msg = m as { type?: string; file?: unknown; line?: unknown; diagram?: unknown };
    if (msg?.type === "layout") {
      // Validated and restricted to the drawn names; written once the drag settles.
      if (this.known) {
        this.saved = mergeSave(this.saved, msg.diagram, this.known);
        clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => this.flush(), SAVE_DELAY_MS);
      }
      return;
    }
    if (msg?.type === "reset") {
      this.reset();
      return;
    }
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
  const withProject = (run: (mainSrc: string) => void) => async (arg?: unknown) => {
    const main = await locateMainSrc(arg);
    if (!main) {
      void vscode.window.showErrorMessage("iRite: no main.src found. Open a project containing main.src.");
      return;
    }
    run(main);
  };
  context.subscriptions.push(
    vscode.commands.registerCommand("irite.showSfc", withProject((main) => SfcPanel.open(main))),
    vscode.commands.registerCommand("irite.sfc.resetLayout", withProject((main) => SfcPanel.reset(main))),
  );
}
