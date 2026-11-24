// irite.generateDocs: writes Markdown + SVG documentation under <project>/docs/generated/.
// Never writes `.rev` or iRite sources; never overwrites files that lack the generated marker.
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { generateDocs, shouldWrite } from "../docs/generateDocs";
import { loadIriteProject } from "../irite";
import { parseRev } from "../rev";
import type { SfcOptions } from "../sfc/sfcModel";

function readText(p: string): string | undefined {
	try {
		return fs.readFileSync(p, "utf8");
	} catch {
		return undefined;
	}
}

async function locateMainSrc(arg: unknown): Promise<string | undefined> {
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
	const found = (await vscode.workspace.findFiles("**/main.src", "**/node_modules/**", 20)).map((f) => f.fsPath);
	if (found.length <= 1) {
		return found[0];
	}
	const pick = await vscode.window.showQuickPick(
		found.map((f) => ({ label: path.relative(path.dirname(path.dirname(f)), f), description: path.dirname(f), file: f })),
		{ placeHolder: "Select the project (main.src)" },
	);
	return pick?.file;
}

function sfcOptions(): SfcOptions {
	const cfg = vscode.workspace.getConfiguration("irite.sfc");
	const str = (k: string): string | undefined => {
		const v = cfg.get<string>(k);
		return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
	};
	return { statesEnum: str("statesEnum"), transitionsEnum: str("transitionsEnum"), initialStep: str("initialStep") };
}

async function readExisting(uri: vscode.Uri): Promise<string | undefined> {
	try {
		return new TextDecoder("utf-8").decode(await vscode.workspace.fs.readFile(uri));
	} catch {
		return undefined;
	}
}

async function run(context: vscode.ExtensionContext, mainSrc: string): Promise<void> {
	const dir = path.dirname(mainSrc);
	const project = loadIriteProject(mainSrc, readText);
	const revFile = fs
		.readdirSync(dir)
		.filter((n) => /\.rev$/i.test(n))
		.sort((a, b) => (a.toLowerCase() === "main.rev" ? -1 : b.toLowerCase() === "main.rev" ? 1 : a.localeCompare(b)))[0];
	const revText = revFile ? readText(path.join(dir, revFile)) : undefined;
	const version = String((context.extension.packageJSON as { version?: string }).version ?? "unknown");
	const out = generateDocs({
		project,
		rev: revText !== undefined ? parseRev(revText) : undefined,
		projectDir: dir,
		version,
		now: new Date(),
		sfcOptions: sfcOptions(),
	});
	const enc = new TextEncoder();
	let written = 0;
	const skipped: string[] = [];
	for (const f of out.files) {
		const uri = vscode.Uri.file(path.join(dir, ...f.relPath.split("/")));
		if (!shouldWrite(await readExisting(uri))) {
			skipped.push(f.relPath);
			continue;
		}
		await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(uri.fsPath)));
		await vscode.workspace.fs.writeFile(uri, enc.encode(f.content));
		written++;
	}
	const index = vscode.Uri.file(path.join(dir, "docs", "generated", "index.md"));
	let msg = `iRite: generated ${written} documentation file(s) in docs/generated/.`;
	if (skipped.length > 0) {
		msg += ` Skipped ${skipped.length} hand-written file(s) without the generated marker: ${skipped.join(", ")}.`;
	}
	const open = "Open index.md";
	const choice = skipped.includes("docs/generated/index.md") ? undefined : await vscode.window.showInformationMessage(msg, open);
	if (skipped.includes("docs/generated/index.md")) {
		void vscode.window.showWarningMessage(msg);
	}
	if (choice === open) {
		await vscode.commands.executeCommand("markdown.showPreview", index);
	}
}

export function registerDocsCommands(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.commands.registerCommand("irite.generateDocs", async (arg?: unknown) => {
			const main = await locateMainSrc(arg);
			if (!main) {
				void vscode.window.showErrorMessage("iRite: no main.src found. Open a project containing main.src.");
				return;
			}
			try {
				await vscode.window.withProgress(
					{ location: vscode.ProgressLocation.Notification, title: "iRite: generating project docs..." },
					() => run(context, main),
				);
			} catch (e) {
				void vscode.window.showErrorMessage(`iRite: could not generate docs: ${e instanceof Error ? e.message : String(e)}`);
			}
		}),
	);
}
