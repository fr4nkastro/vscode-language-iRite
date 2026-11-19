import * as vscode from "vscode";
import { checkRevolutionInstalled, registerEngineCommands } from "./commands/engine";

export function activate(context: vscode.ExtensionContext): void {
  const channel = vscode.window.createOutputChannel("iRite Information");
  context.subscriptions.push(channel);

  checkRevolutionInstalled();
  registerEngineCommands(context, channel);
}

export function deactivate(): void {
  // Nothing to release beyond context.subscriptions.
}
