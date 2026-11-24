/** Reads and writes the SFC layout sidecar (`.vscode/irite-sfc.layout.json`). Node `fs` only: no `vscode` imports. */
import * as fs from "fs";
import * as path from "path";
import { SIDECAR_RELATIVE_PATH, SIDECAR_VERSION, parseSidecar, serializeSidecar, withDiagram } from "./sfcSidecar";
import type { SavedDiagram, SidecarFile } from "./sfcSidecar";

export const sidecarPath = (baseDir: string): string => path.join(baseDir, ...SIDECAR_RELATIVE_PATH.split("/"));

export type StoreProblem = "invalid-json" | "invalid-shape" | "unsupported-version" | "io-error";

export type StoreRead = { ok: true; file: SidecarFile; exists: boolean } | { ok: false; reason: StoreProblem };

export function readSidecar(file: string): StoreRead {
	let text: string;
	try {
		text = fs.readFileSync(file, "utf8");
	} catch (e) {
		return (e as NodeJS.ErrnoException).code === "ENOENT" ? { ok: true, file: { version: SIDECAR_VERSION, diagrams: {} }, exists: false } : { ok: false, reason: "io-error" };
	}
	const parsed = parseSidecar(text);
	return parsed.ok ? { ok: true, file: parsed.file, exists: true } : parsed;
}

export const describeProblem = (r: StoreProblem): string =>
	r === "invalid-json"
		? "is not valid JSON"
		: r === "invalid-shape"
			? "does not have the expected shape"
			: r === "unsupported-version"
				? "was written by a newer version of the extension"
				: "could not be read or written";

/** Layout stored for `key`, if any. */
export function loadDiagram(file: string, key: string): { diagram?: SavedDiagram; problem?: StoreProblem } {
	const r = readSidecar(file);
	return r.ok ? { diagram: r.file.diagrams[key] } : { problem: r.reason };
}

/**
 * Stores (or, with `undefined`, removes) the diagram for `key`, keeping every other diagram. A sidecar
 * that cannot be parsed is never overwritten. The file is deleted when no diagram is left.
 */
export function saveDiagram(file: string, key: string, diagram: SavedDiagram | undefined): { ok: true } | { ok: false; reason: StoreProblem } {
	const current = readSidecar(file);
	if (!current.ok) {
		return current;
	}
	const next = withDiagram(current.file, key, diagram);
	try {
		if (Object.keys(next.diagrams).length === 0) {
			if (current.exists) {
				fs.rmSync(file, { force: true });
			}
			return { ok: true };
		}
		fs.mkdirSync(path.dirname(file), { recursive: true });
		const tmp = `${file}.${process.pid}.tmp`;
		fs.writeFileSync(tmp, serializeSidecar(next), "utf8");
		fs.renameSync(tmp, file);
		return { ok: true };
	} catch {
		return { ok: false, reason: "io-error" };
	}
}
