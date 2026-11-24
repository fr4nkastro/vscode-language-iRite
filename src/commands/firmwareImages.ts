import * as vscode from "vscode";
import { importFirmwareImages, importMessage } from "../firmware/importer";

export function registerFirmwareImages(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand("irite.firmware.importImages", async () => {
    const kind = await vscode.window.showQuickPick(["Firmware update folder", "rootfs.tar file"], {
      placeHolder: "Select the firmware source type",
    });
    if (!kind) return;
    const folder = kind === "Firmware update folder";
    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: !folder,
      canSelectFolders: folder,
      canSelectMany: false,
      openLabel: "Import Images",
      title: folder ? "Select firmware update folder" : "Select rootfs.tar",
      ...(folder ? {} : { filters: { "Tar archives": ["tar"] } }),
    });
    if (!selected?.length) return;
    try {
      const result = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "Importing 1280 built-in images from firmware",
      }, () => importFirmwareImages({ source: selected[0].fsPath, storageDir: context.globalStorageUri.fsPath }));
      const msg = importMessage(result);
      void (msg.level === "warning" ? vscode.window.showWarningMessage(msg.text) : vscode.window.showInformationMessage(msg.text));
    } catch (error) {
      void vscode.window.showErrorMessage(`Could not import firmware images: ${error instanceof Error ? error.message : String(error)}`);
    }
  }));
}
