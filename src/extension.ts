import * as vscode from "vscode";
import { checkRevolutionInstalled, registerEngineCommands } from "./commands/engine";
import { registerPreviewCommands } from "./commands/previewScreens";
import { registerScreenEditor } from "./commands/screenEditor";
import { registerErdCommands } from "./commands/erd";
import { registerSfcCommands } from "./commands/sfc";
import { registerCallMapCommands } from "./commands/callMap";
import { registerDocsCommands } from "./commands/docs";
import { registerDbAccess } from "./commands/dbAccess";
import { registerFirmwareImages, sweepFirmwareCacheOnActivation } from "./commands/firmwareImages";
import { registerDbSchemaEditor } from "./commands/dbSchemaEditor";

export function activate(context: vscode.ExtensionContext): void {
  const channel = vscode.window.createOutputChannel("iRite Information");
  context.subscriptions.push(channel);

  checkRevolutionInstalled();
  registerEngineCommands(context, channel);
  registerPreviewCommands(context);
  registerScreenEditor(context);
  registerErdCommands(context);
  registerSfcCommands(context);
  registerCallMapCommands(context);
  registerDocsCommands(context);
  registerDbAccess(context);
  registerFirmwareImages(context);
  sweepFirmwareCacheOnActivation(context);
  registerDbSchemaEditor(context);
}

export function deactivate(): void {
  // Nothing to release beyond context.subscriptions.
}
