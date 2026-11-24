import * as vscode from "vscode";
import { join } from "node:path";
import { sweepLeftovers } from "../firmware/cacheCleanup";
import { importFirmwareImages, importMessage } from "../firmware/importer";

/** Best-effort sweep of leftover .old-/.tmp- dirs on activation; never throws, never awaited by activation. */
export function sweepFirmwareCacheOnActivation(context: vscode.ExtensionContext): void {
  try {
    void sweepLeftovers(join(context.globalStorageUri.fsPath, "firmware-images")).catch(() => undefined);
  } catch {
    /* best-effort */
  }
}

/** In-process guard: only one import at a time in this window (other windows are covered by the sweep age rule). */
let importInFlight = false;

export function registerFirmwareImages(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand("irite.firmware.importImages", async () => {
    if (importInFlight) {
      void vscode.window.showWarningMessage("A firmware image import is already running. Wait for it to finish and try again.");
      return;
    }
    importInFlight = true;
    try {
      await runImport(context);
    } finally {
      importInFlight = false;
    }
  }));
}

async function runImport(context: vscode.ExtensionContext): Promise<void> {
  {
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
  }
}
