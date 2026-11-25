// Registers the iRite Language Model tools (Copilot Chat agent mode and other in-IDE agents). vscode-bound and
// thin: validation, path policy and the mapping to the headless CLI core live in `src/lmtools/` (pure).
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { nodeIo } from "../cli/nodeIo";
import { TOOLS, runTool } from "../lmtools/tools";
import type { LiveDiagnostic, ToolContext, ToolDef } from "../lmtools/tools";
import { findAllMainSrc } from "./locateProject";

function severity(s: vscode.DiagnosticSeverity): LiveDiagnostic["severity"] {
	switch (s) {
		case vscode.DiagnosticSeverity.Error:
			return "error";
		case vscode.DiagnosticSeverity.Warning:
			return "warning";
		case vscode.DiagnosticSeverity.Hint:
			return "hint";
		default:
			return "info";
	}
}

/** Current Problems entries of every file (the pure layer filters by `Diagnostic.source` and project). */
function liveDiagnostics(): LiveDiagnostic[] {
	const out: LiveDiagnostic[] = [];
	for (const [uri, list] of vscode.languages.getDiagnostics()) {
		if (uri.scheme !== "file") continue;
		for (const d of list) {
			out.push({
				file: uri.fsPath,
				line: d.range.start.line + 1,
				severity: severity(d.severity),
				message: d.message,
				source: d.source,
				code: typeof d.code === "object" ? String(d.code.value) : d.code === undefined ? undefined : String(d.code),
			});
		}
	}
	return out;
}

function context(): ToolContext {
	const io = nodeIo();
	return {
		roots: (vscode.workspace.workspaceFolders ?? []).filter((f) => f.uri.scheme === "file").map((f) => f.uri.fsPath),
		io,
		exists: (p) => io.exists(p),
		realpath: (p) => {
			try {
				return fs.realpathSync.native(p);
			} catch {
				return undefined;
			}
		},
		findMainSrc: () => findAllMainSrc(),
		liveDiagnostics,
	};
}

function toolImpl(def: ToolDef): vscode.LanguageModelTool<Record<string, unknown>> {
	return {
		prepareInvocation() {
			return { invocationMessage: `Running ${def.name}` };
		},
		async invoke(options, token) {
			const ctx = context();
			let destination: string | undefined;
			const canApply = () => vscode.workspace.isTrusted && (!destination || !vscode.workspace.textDocuments.some(doc =>
				doc.isDirty && doc.uri.scheme === "file" && path.relative(destination!, doc.uri.fsPath) === ""));
			ctx.cancelled = () => token.isCancellationRequested || (destination !== undefined && !canApply());
			ctx.confirmWrite = async plan => {
				destination = plan.file;
				if (ctx.cancelled!()) return false;
				const detail = `${plan.file}\n\n${JSON.stringify({ changes: plan.changes, warnings: plan.warnings }, null, 2)}`;
				if (detail.length > 16000) throw new Error("Change preview is too large to confirm in one dialog; request smaller edits");
				return await vscode.window.showWarningMessage(`Apply iRite ${plan.command}?`, { modal: true, detail }, "Apply") === "Apply";
			};
			const r = await runTool(def.name, options.input, ctx);
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(r.text)]);
		},
	};
}

export function registerLmTools(context_: vscode.ExtensionContext): void {
	// Older hosts (< 1.95) or builds without the LM API: nothing to register.
	if (typeof vscode.lm?.registerTool !== "function") return;
	for (const def of TOOLS) {
		context_.subscriptions.push(vscode.lm.registerTool(def.name, toolImpl(def)));
	}
}
