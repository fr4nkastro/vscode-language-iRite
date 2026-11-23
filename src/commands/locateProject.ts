// Shared project-locating helpers (vscode-bound). New code uses these; the older webview commands
// still carry their own copy (candidate for a later cleanup).
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

export function readText(p: string): string | undefined {
	try {
		return fs.readFileSync(p, "utf8");
	} catch {
		return undefined;
	}
}

/** Every `main.src` in the workspace (capped). */
export async function findAllMainSrc(limit = 50): Promise<string[]> {
	return (await vscode.workspace.findFiles("**/main.src", "**/node_modules/**", limit)).map((f) => f.fsPath);
}

/**
 * Resolves the project for a command: an explicit file/folder argument, else the nearest `main.src`
 * above the active editor, else the workspace's `main.src` (asking when there are several).
 */
export async function locateMainSrc(arg?: unknown): Promise<string | undefined> {
	if (arg instanceof vscode.Uri && arg.scheme === "file") {
		const main = path.join(path.dirname(arg.fsPath), "main.src");
		if (fs.existsSync(main)) {
			return main;
		}
	}
	const active = vscode.window.activeTextEditor?.document.uri;
	if (active?.scheme === "file") {
		let dir = path.dirname(active.fsPath);
		for (;;) {
			const main = path.join(dir, "main.src");
			if (fs.existsSync(main)) {
				return main;
			}
			const parent = path.dirname(dir);
			if (parent === dir) {
				break;
			}
			dir = parent;
		}
	}
	const found = await findAllMainSrc(20);
	if (found.length <= 1) {
		return found[0];
	}
	const pick = await vscode.window.showQuickPick(
		found.map((f) => ({ label: path.relative(path.dirname(path.dirname(f)), f), description: path.dirname(f), file: f })),
		{ placeHolder: "Select the project (main.src)" },
	);
	return pick?.file;
}
