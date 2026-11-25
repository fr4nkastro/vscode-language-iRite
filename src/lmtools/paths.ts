/**
 * Path policy of the LM tools (pure: no `vscode` import). Only paths inside the open workspace folders are
 * accepted (no `..` escapes, no other drives, no symlinks leaving the folder when `realpath` is given).
 * Without an explicit path the project is located like the extension does: `main.rev` next to `main.src`.
 */
import * as path from "node:path";

export interface PathDeps {
	/** Workspace folder paths (absolute). */
	roots: readonly string[];
	exists(p: string): boolean;
	/** Optional symlink resolution; return undefined when the path does not exist. */
	realpath?(p: string): string | undefined;
	/** Every `main.src` in the workspace folders (absolute paths). */
	findMainSrc(): Promise<string[]> | string[];
}

export type PathResult = { ok: true; path: string } | { ok: false; error: string };

const fold = (p: string): string => (process.platform === "win32" ? p.toLowerCase() : p);

/** True when `child` is `root` or inside it (case-insensitive on Windows). */
export function isInside(root: string, child: string): boolean {
	const rel = path.relative(fold(path.resolve(root)), fold(path.resolve(child)));
	return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** Resolves `input` (absolute, or relative to the first workspace folder) and checks it is inside a workspace folder. */
export function confine(input: string, deps: PathDeps): PathResult {
	if (deps.roots.length === 0) {
		return { ok: false, error: "No workspace folder is open; iRite tools only work on files inside an open workspace folder" };
	}
	if (input.includes("\0")) {
		return { ok: false, error: "Invalid path" };
	}
	const abs = path.resolve(deps.roots[0], input);
	const root = deps.roots.find((r) => isInside(r, abs));
	if (!root) {
		return { ok: false, error: `Path is outside the open workspace folders: ${input}` };
	}
	if (deps.realpath) {
		let ancestor = abs;
		let real = deps.realpath(ancestor);
		while (real === undefined && ancestor !== path.resolve(root) && path.dirname(ancestor) !== ancestor) {
			ancestor = path.dirname(ancestor);
			real = deps.realpath(ancestor);
		}
		const realRoot = deps.realpath(root) ?? root;
		if (real !== undefined && !isInside(realRoot, real)) {
			return { ok: false, error: `Path resolves outside the open workspace folders: ${input}` };
		}
	}
	return { ok: true, path: abs };
}

export type ProjectKind = "rev" | "project";

/**
 * Resolves the target of a tool call to a file or folder inside the workspace.
 * - `rev` given: a `.rev` file, a folder holding `main.rev` (kind "rev"), or for kind "project" also a
 *   folder/`main.src` (the CLI `diagnose` accepts these).
 * - `rev` omitted: the single `main.src` project of the workspace; error when none or several.
 */
export async function resolveTarget(rev: string | undefined, kind: ProjectKind, deps: PathDeps): Promise<PathResult> {
	if (rev !== undefined) {
		const c = confine(rev, deps);
		if (!c.ok) return c;
		const lower = c.path.toLowerCase();
		if (lower.endsWith(".rev")) {
			return deps.exists(c.path) ? c : { ok: false, error: `File not found: ${rev}` };
		}
		if (kind === "project" && lower.endsWith(".src")) {
			return deps.exists(c.path) ? c : { ok: false, error: `File not found: ${rev}` };
		}
		const mainRev = confine(path.join(c.path, "main.rev"), deps);
		if (!mainRev.ok) return mainRev;
		if (deps.exists(mainRev.path)) return mainRev;
		if (kind === "project") {
			const source = confine(path.join(c.path, "main.src"), deps);
			if (!source.ok) return source;
			if (deps.exists(source.path)) return c;
		}
		return { ok: false, error: `No main.rev${kind === "project" ? " or main.src" : ""} found at ${rev}; pass "rev" as a .rev file or a project folder` };
	}
	const found = (await deps.findMainSrc()).filter((f) => confine(f, deps).ok);
	const projects = [...new Set(found.map((f) => path.dirname(path.resolve(f))))].sort();
	const candidates: { dir: string; rev: string }[] = [];
	for (const dir of projects) {
		const candidate = confine(path.join(dir, "main.rev"), deps);
		if (!candidate.ok) return candidate;
		if (kind === "project" || deps.exists(candidate.path)) candidates.push({ dir, rev: candidate.path });
	}
	if (candidates.length === 0) {
		return { ok: false, error: `No iRite project found in the workspace (looked for ${kind === "rev" ? "main.rev next to main.src" : "main.src"}); pass "rev" with the path of a .rev or project folder` };
	}
	if (candidates.length > 1) {
		const list = candidates.map((c) => (kind === "rev" ? c.rev : c.dir)).join(", ");
		return { ok: false, error: `More than one iRite project in the workspace (${list}); pass "rev" explicitly` };
	}
	return confine(kind === "rev" ? candidates[0].rev : candidates[0].dir, deps);
}
