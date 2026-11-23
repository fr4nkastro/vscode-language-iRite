// Standard per-table DB access routines: diagnostics, opt-in scaffold (Quick Fix + command) and the
// machine-readable pending list. All rules live in `src/dbaccess` (pure); this file only does vscode IO.
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
	DEFAULT_OPTIONS,
	applyScaffold,
	buildPendingJson,
	checkDbAccess,
	formatTableMessage,
	type DbAccessOptions,
	type DbAccessReport,
	type PendingJson,
} from "../dbaccess";
import { loadIriteProject } from "../irite";
import { findAllMainSrc, locateMainSrc, readText } from "./locateProject";

const SOURCE = "iRite DB access";
const CMD_SCAFFOLD = "irite.dbAccess.scaffold";
const CMD_EXPORT = "irite.dbAccess.exportPending";

interface Settings {
	enabled: boolean;
	severity: vscode.DiagnosticSeverity;
	options: DbAccessOptions;
	exportPath: string;
}

const SEVERITIES: Record<string, vscode.DiagnosticSeverity> = {
	Error: vscode.DiagnosticSeverity.Error,
	Warning: vscode.DiagnosticSeverity.Warning,
	Information: vscode.DiagnosticSeverity.Information,
	Hint: vscode.DiagnosticSeverity.Hint,
};

function readSettings(): Settings {
	const c = vscode.workspace.getConfiguration("irite.dbAccess");
	const str = (key: string, fallback: string): string => {
		const v = c.get<string>(key);
		return typeof v === "string" && v.trim() !== "" ? v.trim() : fallback;
	};
	const exclusions = (c.get<unknown[]>("exclusions") ?? []).filter((x): x is string => typeof x === "string");
	return {
		enabled: c.get<boolean>("enabled", true),
		severity: SEVERITIES[c.get<string>("severity", "Warning")] ?? vscode.DiagnosticSeverity.Warning,
		options: {
			// An explicitly empty prefix is valid (`TransCreate`), so do not fall back on "".
			prefix: c.get<string>("routinePrefix") ?? DEFAULT_OPTIONS.prefix,
			exclusions,
			moduleFolder: str("moduleFolder", DEFAULT_OPTIONS.moduleFolder),
		},
		exportPath: str("exportPath", ".irite/db-pending.json"),
	};
}

function analyze(mainSrc: string, options: DbAccessOptions): DbAccessReport {
	return checkDbAccess(loadIriteProject(mainSrc, readText), readText, options);
}

interface DiagTarget {
	mainSrc: string;
	table: string;
	missing: number;
}

class DbAccessService implements vscode.CodeActionProvider {
	readonly collection = vscode.languages.createDiagnosticCollection("irite-db-access");
	private readonly targets = new Map<string, DiagTarget>();
	private timer: NodeJS.Timeout | undefined;

	private key(file: string, line: number): string {
		return `${path.normalize(file).toLowerCase()}:${line}`;
	}

	schedule(delay = 400): void {
		clearTimeout(this.timer);
		this.timer = setTimeout(() => void this.refresh(), delay);
	}

	async refresh(): Promise<void> {
		const settings = readSettings();
		this.collection.clear();
		this.targets.clear();
		if (!settings.enabled) {
			return;
		}
		const byFile = new Map<string, vscode.Diagnostic[]>();
		for (const mainSrc of await findAllMainSrc()) {
			let report: DbAccessReport;
			try {
				report = analyze(mainSrc, settings.options);
			} catch (e) {
				console.error("iRite DB access check failed", e);
				continue;
			}
			for (const t of report.tables) {
				const message = formatTableMessage(t);
				if (message === "") {
					continue;
				}
				const line = Math.max(0, t.line - 1);
				const d = new vscode.Diagnostic(new vscode.Range(line, 0, line, 1000), message, settings.severity);
				d.source = SOURCE;
				d.code = "irite-db-access";
				const list = byFile.get(t.file) ?? [];
				list.push(d);
				byFile.set(t.file, list);
				this.targets.set(this.key(t.file, line), { mainSrc, table: t.table, missing: t.items.filter((i) => i.status === "missing").length });
			}
		}
		for (const [file, diags] of byFile) {
			this.collection.set(vscode.Uri.file(file), diags);
		}
	}

	provideCodeActions(doc: vscode.TextDocument, _range: vscode.Range, ctx: vscode.CodeActionContext): vscode.CodeAction[] {
		const actions: vscode.CodeAction[] = [];
		for (const d of ctx.diagnostics) {
			const target = d.source === SOURCE ? this.targets.get(this.key(doc.uri.fsPath, d.range.start.line)) : undefined;
			if (!target || target.missing === 0) {
				continue; // only pending stubs left: nothing to scaffold
			}
			const a = new vscode.CodeAction(`Scaffold ${target.missing} missing DB routine(s) for table ${target.table}`, vscode.CodeActionKind.QuickFix);
			a.diagnostics = [d];
			a.command = { command: CMD_SCAFFOLD, title: a.title, arguments: [{ mainSrc: target.mainSrc, table: target.table }] };
			actions.push(a);
		}
		return actions;
	}

	dispose(): void {
		clearTimeout(this.timer);
		this.collection.dispose();
	}
}

function write(file: string, text: string): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, text, "utf8");
}

interface ScaffoldArg {
	mainSrc?: string;
	table?: string;
}

async function scaffold(service: DbAccessService, arg: unknown): Promise<void> {
	const a = (arg && typeof arg === "object" && !(arg instanceof vscode.Uri) ? arg : {}) as ScaffoldArg;
	const mainSrc = typeof a.mainSrc === "string" ? a.mainSrc : await locateMainSrc(arg);
	if (!mainSrc) {
		void vscode.window.showErrorMessage("iRite: no main.src found. Open a project containing main.src.");
		return;
	}
	const settings = readSettings();
	const report = analyze(mainSrc, settings.options);
	let tables = report.tables.filter((t) => t.items.some((i) => i.status === "missing")).map((t) => t.table);
	if (typeof a.table === "string") {
		tables = tables.filter((t) => t.toLowerCase() === a.table!.toLowerCase());
	} else if (tables.length > 1) {
		const picked = await vscode.window.showQuickPick(tables.map((t) => ({ label: t, picked: true })), {
			canPickMany: true,
			placeHolder: "Tables to scaffold (stubs are appended to their modules; existing code is never changed)",
		});
		tables = picked?.map((p) => p.label) ?? [];
	}
	if (tables.length === 0) {
		void vscode.window.showInformationMessage("iRite: no missing DB access routines to scaffold.");
		return;
	}
	const added: string[] = [];
	const touched: string[] = [];
	for (const table of tables) {
		// Edits are planned from the current disk state, so a table's main.src include is seen by the next one.
		const edits = applyScaffold({ report, table, mainSrcPath: mainSrc, readText, options: settings.options });
		for (const f of edits.files) {
			write(f.path, f.text);
			touched.push(path.relative(path.dirname(mainSrc), f.path));
		}
		if (edits.mainSrc) {
			write(edits.mainSrc.path, edits.mainSrc.text);
			touched.push("main.src (new #include)");
		}
		added.push(...edits.added);
	}
	await service.refresh();
	void vscode.window.showInformationMessage(
		`iRite: scaffolded ${added.length} stub(s). Changed: ${[...new Set(touched)].join(", ")}. Each stub returns SysInvalidRequest until implemented; remove its TODO(irite-db) line when done.`,
	);
}

async function exportPending(arg: unknown): Promise<PendingJson | undefined> {
	const a = (arg && typeof arg === "object" && !(arg instanceof vscode.Uri) ? arg : {}) as { mainSrc?: string; write?: boolean };
	const mainSrc = typeof a.mainSrc === "string" ? a.mainSrc : await locateMainSrc(arg);
	if (!mainSrc) {
		void vscode.window.showErrorMessage("iRite: no main.src found. Open a project containing main.src.");
		return undefined;
	}
	const settings = readSettings();
	const json = buildPendingJson(analyze(mainSrc, settings.options), { mainSrcPath: mainSrc, options: settings.options });
	// Palette / menu invocation writes the file; a programmatic call with an object only returns the JSON unless `write: true`.
	const shouldWrite = a.write ?? (arg === undefined || arg instanceof vscode.Uri);
	if (shouldWrite) {
		const out = path.resolve(path.dirname(mainSrc), settings.exportPath);
		write(out, JSON.stringify(json, null, 2) + "\n");
		void vscode.window
			.showInformationMessage(`iRite: ${json.items.length} pending DB routine(s) written to ${out}`, "Open")
			.then((c) => (c ? vscode.window.showTextDocument(vscode.Uri.file(out)) : undefined));
	}
	return json;
}

export function registerDbAccess(context: vscode.ExtensionContext): void {
	const service = new DbAccessService();
	const watcher = vscode.workspace.createFileSystemWatcher("**/*.{iri,src}");
	context.subscriptions.push(
		service,
		watcher,
		watcher.onDidChange(() => service.schedule()),
		watcher.onDidCreate(() => service.schedule()),
		watcher.onDidDelete(() => service.schedule()),
		vscode.workspace.onDidSaveTextDocument(() => service.schedule(150)),
		vscode.workspace.onDidOpenTextDocument((d) => (d.languageId === "irite" ? service.schedule(150) : undefined)),
		vscode.workspace.onDidChangeConfiguration((e) => (e.affectsConfiguration("irite.dbAccess") ? service.schedule(50) : undefined)),
		vscode.languages.registerCodeActionsProvider({ language: "irite" }, service, { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }),
		vscode.commands.registerCommand(CMD_SCAFFOLD, (arg?: unknown) => scaffold(service, arg)),
		vscode.commands.registerCommand(CMD_EXPORT, (arg?: unknown) => exportPending(arg)),
	);
	service.schedule(0);
}
