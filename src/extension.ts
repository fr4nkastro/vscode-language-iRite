import * as vscode from "vscode";
import { checkRevolutionInstalled, registerEngineCommands } from "./commands/engine";
import { registerPreviewCommands } from "./commands/previewScreens";
import { registerErdCommands } from "./commands/erd";
import { registerSfcCommands } from "./commands/sfc";
import { registerDocsCommands } from "./commands/docs";

export function activate(context: vscode.ExtensionContext): void {
  const channel = vscode.window.createOutputChannel("iRite Information");
  context.subscriptions.push(channel);

  checkRevolutionInstalled();
  registerEngineCommands(context, channel);
  registerPreviewCommands(context);
  registerErdCommands(context);
  registerSfcCommands(context);
  registerDocsCommands(context);
}

export function deactivate(): void {
  // Nothing to release beyond context.subscriptions.
}
