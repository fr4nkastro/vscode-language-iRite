/** Backup-then-replace of `main.iri` (pure plan + injected fs, no `vscode` import). */
import * as path from "node:path";
import { backupPath } from "../editor/backup";

/** The fs operations the regeneration needs; Node's `fs` backs them in the command, tests use memory. */
export interface RegenerateFs {
	exists(p: string): boolean;
	/** Bytes of the file, or undefined when it does not exist. */
	readFile(p: string): Uint8Array | undefined;
	/** Creates a new file (exclusive: never replaces an existing one). */
	writeFile(p: string, data: Uint8Array): void;
	/** Copy that fails when the destination exists (`COPYFILE_EXCL`). */
	copyExcl(from: string, to: string): void;
	rename(from: string, to: string): void;
	/** Best-effort delete of the temp file after a failed rename. */
	remove(p: string): void;
}

export interface RegenerateResult {
	status: "created" | "replaced" | "unchanged";
	target: string;
	/** Present only when `status` is `replaced`. */
	backup?: string;
}

/** `<rev dir>/<rev basename>.iri` (`main.rev` -> `main.iri`). */
export function targetIriPath(revPath: string): string {
	const parsed = path.parse(revPath);
	return path.join(parsed.dir, `${parsed.name}.iri`);
}

/** The bytes written: UTF-8 without a BOM, as Revolution's `StreamWriter(path)` writes them. */
export const iriBytes = (text: string): Uint8Array => Buffer.from(text, "utf8");

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && Buffer.compare(a, b) === 0;

/**
 * Writes `text` as the `.iri` of `revPath`. Identical content: nothing is written. Existing different content:
 * copied to a never-overwritten backup first (a failure there leaves the target untouched), then replaced
 * atomically through a temp file in the same folder and a rename. Missing target: created, no backup.
 */
export function regenerateIri(revPath: string, text: string, fs: RegenerateFs, now: Date): RegenerateResult {
	const target = targetIriPath(revPath);
	const next = iriBytes(text);
	const current = fs.readFile(target);
	if (current && sameBytes(current, next)) {
		return { status: "unchanged", target };
	}
	let backup: string | undefined;
	if (current) {
		backup = backupPath(target, (p) => fs.exists(p), now);
		fs.copyExcl(target, backup);
	}
	const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${now.getTime()}.tmp`);
	fs.writeFile(temporary, next);
	try {
		fs.rename(temporary, target);
	} catch (e) {
		try {
			fs.remove(temporary);
		} catch {
			// keep the original error; the stray temp file is harmless
		}
		throw e;
	}
	return backup ? { status: "replaced", target, backup } : { status: "created", target };
}
