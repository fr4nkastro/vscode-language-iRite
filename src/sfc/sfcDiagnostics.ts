/** Pure helpers that turn SFC diagnostics into editor-ready data. No `vscode` imports. */
import type { SfcDiagnostic } from "./sfcModel";

/** Name of the matching `vscode.DiagnosticSeverity` member; the command layer resolves it. */
export type VsSeverityName = "Error" | "Warning" | "Information";

export function toVsSeverityName(severity: SfcDiagnostic["severity"]): VsSeverityName {
	switch (severity) {
		case "error":
			return "Error";
		case "warning":
			return "Warning";
		default:
			return "Information";
	}
}

export interface FileDiagnostic {
	/** 1-based line. */
	line: number;
	severity: SfcDiagnostic["severity"];
	message: string;
	code?: string;
}

/**
 * Groups diagnostics by file (insertion order), sorted by line. A diagnostic without a file goes to
 * `fallbackFile`; one without a line goes to line 1.
 */
export function groupSfcDiagnostics(diagnostics: SfcDiagnostic[], fallbackFile: string): Map<string, FileDiagnostic[]> {
	const out = new Map<string, FileDiagnostic[]>();
	for (const d of diagnostics) {
		const file = d.file ?? fallbackFile;
		const list = out.get(file) ?? [];
		list.push({ line: d.line !== undefined && d.line >= 1 ? d.line : 1, severity: d.severity, message: d.message, code: d.code });
		out.set(file, list);
	}
	for (const list of out.values()) {
		list.sort((a, b) => a.line - b.line);
	}
	return out;
}
