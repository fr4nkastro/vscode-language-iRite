// irite.build (F7) and irite.deploy (F8): hand the active .src file to Revolution's iRite_preprocessor.exe.
import * as cp from "child_process";
import * as fs from "fs";
import * as vscode from "vscode";
import { EngineAction, engineArgs, engineInvocation, isWineMissing } from "../engine/invocation";

const REVOLUTION_DOWNLOAD_URL =
  "https://www.ricelake.com/en-us/products/product-details/revolution-scale-software#/resources-downloads";
const WINE_MISSING =
  "'wine' was not found. Install Wine to run the iRite compiler on Linux/macOS (e.g. `sudo apt install wine`).";

function config() {
  const cfg = vscode.workspace.getConfiguration("irite");
  return {
    engine: cfg.get<string>("build.engine", ""),
    enginePath: cfg.get<string>("build.enginePath", ""),
    compilerPath: cfg.get<string>("build.compilerPath", ""),
  };
}

function openExternal(url: string): void {
  void vscode.env.openExternal(vscode.Uri.parse(url));
}

// On activation, offer the Revolution download when the configured engine is not on disk.
export function checkRevolutionInstalled(): void {
  const { enginePath } = config();
  fs.stat(enginePath, (err) => {
    if (err == null) {
      console.log("Revolution exists");
    } else if (err.code === "ENOENT") {
      const optionRev: vscode.MessageItem = { title: "Get Revolution" };
      void vscode.window
        .showInformationMessage("Revolution can not be located, would you like to download it?", optionRev)
        .then((option) => {
          if (option?.title === optionRev.title) {
            openExternal(REVOLUTION_DOWNLOAD_URL);
          }
        });
    } else {
      console.log("Revolution Checker: ", err.code);
    }
  });
}

function checkEngineDefined(): Promise<string> {
  return new Promise((resolve, reject) => {
    const { engine } = config();
    if (engine !== "") {
      resolve(engine);
      return;
    }
    const optionRev: vscode.MessageItem = { title: "revolution" };
    const optionTest: vscode.MessageItem = { title: "Test" };
    void vscode.window
      .showErrorMessage(
        'The "irite.build.engine" setting is not defined. Do you want to download Revolution?',
        optionRev,
        optionTest
      )
      .then((option) => {
        if (option === undefined) {
          reject("undefined");
          return;
        }
        if (option.title === optionRev.title) {
          openExternal(REVOLUTION_DOWNLOAD_URL);
        } else if (option.title === optionTest.title) {
          openExternal("http://www.ricelake.com");
        }
        reject("hyperlink");
      });
  });
}

function checkEnginePathDefined(): Promise<string> {
  const { enginePath } = config();
  if (enginePath === "") {
    return Promise.reject('The "irite.build.enginePath" setting is not defined. Please configure.');
  }
  return Promise.resolve(enginePath);
}

function runEngine(
  filePath: string,
  action: EngineAction,
  onResult: (error: cp.ExecFileException | null, stdout: string, stderr: string) => void
): void {
  const { enginePath, compilerPath } = config();
  const invocation = engineInvocation(enginePath, engineArgs(filePath, compilerPath, action));
  cp.execFile(invocation.command, invocation.args, onResult);
}

async function build(channel: vscode.OutputChannel): Promise<void> {
  channel.clear();
  let saved: boolean;
  try {
    saved = await vscode.workspace.saveAll();
  } catch (reason) {
    void vscode.window.showErrorMessage(reason + "\nUnable to Save!\n\n");
    vscode.window.setStatusBarMessage(reason + "\nUnable to Save!\n\n");
    channel.append(
      "*************************************\n*************************************\nUnable to Save!" +
        "*************************************\n*************************************\n"
    );
    channel.append("\nError 171: Please open folder(workspace).\n");
    return;
  }
  if (!saved) {
    vscode.window.setStatusBarMessage("Error Saving Files SBMsg", 5000);
    void vscode.window.showErrorMessage("Error Saving Files EM");
    channel.append(
      "\n\n*************************************\nError Saving Files.  Rectify and rebuild.\n*************************************\n\n"
    );
    return;
  }
  channel.appendLine("All Files Saved");

  const doc = vscode.window.activeTextEditor?.document;
  if (doc === undefined) {
    void vscode.window.showErrorMessage("Open an iRite source file to build.");
    return;
  }
  channel.appendLine("Open File: " + doc.fileName);
  channel.show();

  try {
    await vscode.window.showTextDocument(doc);
  } catch (err) {
    void vscode.window.showErrorMessage("Error 124: " + err);
    vscode.window.setStatusBarMessage("Error 125: " + err, 5000);
    channel.appendLine("Error 126: " + err);
    return;
  }

  try {
    await checkEngineDefined();
  } catch (error) {
    void vscode.window.showErrorMessage("Error 118: " + error);
    vscode.window.setStatusBarMessage("Error 119:  + checkEngineDefined: " + error, 5000);
    channel.appendLine("Error 120: checkEngineDefined: " + error);
    return;
  }
  try {
    await checkEnginePathDefined();
  } catch (error) {
    vscode.window.setStatusBarMessage("Error 112: " + error, 5000);
    void vscode.window.showErrorMessage("Open Folder to Build Properly");
    channel.appendLine("Error 114:  checkEnginePathDefined: " + error);
    return;
  }

  channel.appendLine("Building: " + doc.fileName);
  runEngine(doc.fileName, "build", (error, data, stderr) => {
    if (error != null) {
      if (isWineMissing(error)) {
        channel.appendLine("Compile Function ERROR: " + WINE_MISSING);
      }
      channel.appendLine("Compile Function ERROR: " + error + "  stderr:" + stderr + "|");
      console.log(error);
      console.log(stderr);
    } else {
      channel.appendLine(data);
    }
  });
}

async function deploy(channel: vscode.OutputChannel): Promise<void> {
  try {
    await checkEngineDefined();
  } catch (error) {
    vscode.window.setStatusBarMessage("checkEngineDefined: " + error, 5000);
    channel.appendLine("checkEngineDefined: " + error);
    return;
  }
  try {
    await checkEnginePathDefined();
  } catch (error) {
    void vscode.window.showErrorMessage(String(error));
    channel.appendLine(String(error));
    return;
  }

  const doc = vscode.window.activeTextEditor?.document;
  if (doc === undefined) {
    void vscode.window.showErrorMessage("Open an iRite source file to deploy.");
    return;
  }
  channel.append(
    "*************************************\n*************************************\niRite Deploying: " + doc.fileName + "\n"
  );
  runEngine(doc.fileName, "deploy", (error, data, stderr) => {
    if (error != null && isWineMissing(error)) {
      channel.appendLine("Deploy Function ERROR: " + WINE_MISSING);
    }
    if (stderr != null) {
      console.log(error);
      console.log(stderr);
    }
    channel.append(data);
  });
}

export function registerEngineCommands(context: vscode.ExtensionContext, channel: vscode.OutputChannel): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("irite.build", () => build(channel)),
    vscode.commands.registerCommand("irite.deploy", () => deploy(channel))
  );
}
