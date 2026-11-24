/** Level 1 of the call map (C4 "system context") and webview message validation. Pure: no `vscode` imports. */
import type { RevModel } from "../rev";
import type { CallGraph } from "./callGraph";

export type ContextKind = "scale" | "port" | "dio" | "database";

export interface ContextGroup {
	kind: ContextKind;
	label: string;
	names: string[];
}

export interface SystemContext {
	program: { name: string; modules: number; routines: number; calls: number; builtinCalls: number; hiddenFiles: number };
	/** Equipment around the program, read from the `.rev`; empty without one. */
	groups: ContextGroup[];
	hasRev: boolean;
}

const unique = (xs: string[]): string[] => [...new Set(xs.filter((x) => x !== ""))];

/** The program node plus, when a `.rev` is present, the indicator's scales, EDP ports, DIO and databases. */
export function buildSystemContext(graph: CallGraph, programName: string, rev?: RevModel): SystemContext {
	const builtinCalls = graph.sites.filter((s) => s.to < 0).length;
	const groups: ContextGroup[] = [];
	if (rev) {
		const named = (kind: ContextKind): string[] => unique(rev.aliases.filter((a) => a.kind === kind).map((a) => a.name));
		const add = (kind: ContextKind, label: string, names: string[]): void => {
			if (names.length > 0) {
				groups.push({ kind, label, names });
			}
		};
		add("scale", "Scales", named("scale"));
		add("port", "EDP ports", named("port"));
		add("dio", "Digital I/O", named("dio"));
		add("database", "Databases", unique(rev.databases.map((d) => d.name)));
	}
	return {
		program: {
			name: programName,
			modules: graph.files.length,
			routines: graph.routines.length,
			calls: graph.sites.length - builtinCalls,
			builtinCalls,
			hiddenFiles: graph.hiddenFiles,
		},
		groups,
		hasRev: rev !== undefined,
	};
}

const MAX_LINE = 10_000_000;
const norm = (p: string): string => p.replace(/\\/g, "/").toLowerCase();

/**
 * Validates an `open` message from the webview. Only files of the loaded project can be opened and the
 * line must be a positive integer; the returned path is the project's own spelling, never the message's.
 */
export function parseOpenMessage(projectFiles: string[], msg: unknown): { file: string; line: number } | undefined {
	const m = msg as { type?: unknown; file?: unknown; line?: unknown } | null | undefined;
	if (!m || m.type !== "open" || typeof m.file !== "string" || typeof m.line !== "number") {
		return undefined;
	}
	if (!Number.isInteger(m.line) || m.line < 1 || m.line > MAX_LINE) {
		return undefined;
	}
	const wanted = norm(m.file);
	const file = projectFiles.find((f) => norm(f) === wanted);
	return file === undefined ? undefined : { file, line: m.line };
}

export interface ViewState {
	level: 1 | 2 | 3;
	module: string | null;
	routine: number | null;
	gran: "file" | "folder";
	builtins: boolean;
}

/** Validates the view state a webview reports (and that the extension later re-embeds). */
export function sanitizeViewState(raw: unknown): ViewState | undefined {
	const m = raw as Record<string, unknown> | null | undefined;
	if (!m || typeof m !== "object") {
		return undefined;
	}
	const level = m.level === 2 || m.level === 3 ? m.level : 1;
	const module = typeof m.module === "string" && m.module.length <= 500 ? m.module : null;
	const routine = typeof m.routine === "number" && Number.isInteger(m.routine) && m.routine >= 0 && m.routine < 1_000_000 ? m.routine : null;
	return { level: level === 3 && module === null ? 2 : level, module, routine, gran: m.gran === "folder" ? "folder" : "file", builtins: m.builtins === true };
}
