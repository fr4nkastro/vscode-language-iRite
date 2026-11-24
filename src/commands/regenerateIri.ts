// `irite.regenerateIri` (vscode-bound): regenerates main.iri from a .rev, keeping a backup of the previous file.
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { generateMainIri } from "../iri/generateIri";
import { regenerateIri, targetIriPath, type RegenerateFs } from "../iri/regenerate";
import { parseRev } from "../rev";
import { locateMainSrc } from "./locateProject";

export const REGENERATE_COMMAND = "irite.regenerateIri";
export const REGENERATE_BUTTON = "Regenerate main.iri";

const nodeFs: RegenerateFs = {
	exists: (p) => fs.existsSync(p),
	readFile: (p) => {
		try {
			return fs.readFileSync(p);
		} catch {
			return undefined;
		}
	},
	writeFile: (p, data) => fs.writeFileSync(p, data, { flag: "wx" }),
	copyExcl: (from, to) => fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL),
	rename: (from, to) => fs.renameSync(from, to),
	remove: (p) => fs.rmSync(p, { force: true }),
};

async function locateRevPath(arg: unknown): Promise<string | undefined> {
	if (arg instanceof vscode.Uri && arg.scheme === "file" && /\.rev$/i.test(arg.fsPath)) {
		return arg.fsPath;
	}
	const mainSrc = await locateMainSrc(arg);
	if (!mainSrc) {
		return undefined;
	}
	const rev = path.join(path.dirname(mainSrc), "main.rev");
	return fs.existsSync(rev) ? rev : undefined;
}

export function registerRegenerateIri(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.commands.registerCommand(REGENERATE_COMMAND, async (arg?: unknown) => {
			const rev = await locateRevPath(arg);
			if (!rev) {
				void vscode.window.showErrorMessage("iRite: no .rev file found. Open a project containing main.rev.");
				return;
			}
			const target = targetIriPath(rev);
			const choice = await vscode.window.showWarningMessage(
				`Regenerate ${path.basename(target)} from ${path.basename(rev)}?`,
				{ modal: true, detail: `${path.basename(target)} is replaced with the file generated from the .rev. A backup of the previous file is kept next to it.` },
				"Regenerate",
			);
			if (choice !== "Regenerate") {
				return;
			}
			try {
				const text = generateMainIri(parseRev(fs.readFileSync(rev, "utf8")));
				const r = regenerateIri(rev, text, nodeFs, new Date());
				if (r.status === "unchanged") {
					void vscode.window.showInformationMessage(`iRite: ${path.basename(r.target)} is already up to date.`);
				} else if (r.status === "replaced") {
					void vscode.window.showInformationMessage(`iRite: regenerated ${path.basename(r.target)}. Backup: ${path.basename(r.backup as string)}.`);
				} else {
					void vscode.window.showInformationMessage(`iRite: created ${path.basename(r.target)} (no previous file, no backup).`);
				}
			} catch (e) {
				void vscode.window.showErrorMessage(`iRite: could not regenerate ${path.basename(target)}: ${e instanceof Error ? e.message : String(e)}. The existing file was not replaced.`);
			}
		}),
	);
}

/** Post-save info message with a button that runs the command for `revPath`. */
export function offerRegenerate(message: string, revPath: string): void {
	void Promise.resolve(vscode.window.showInformationMessage(message, REGENERATE_BUTTON)).then((choice) => {
		if (choice === REGENERATE_BUTTON) {
			void vscode.commands.executeCommand(REGENERATE_COMMAND, vscode.Uri.file(revPath));
		}
	});
}
