/**
 * Best-effort deletion helpers for the firmware image cache (vscode-free).
 *
 * removeBestEffort(dir, opts) never throws. EBUSY / EPERM / ENOTEMPTY (typical
 * on Windows with an antivirus scanner or an open webview) are retried with a
 * short linear backoff; any other error is not retried. Either way the failure
 * is returned as `{ removed: false, error }` so a completed import is never
 * turned into a failure by cleanup.
 *
 * sweepLeftovers(root, opts) only looks at direct children of `root` named
 * `.tmp-*` or `.old-*`; version directories and everything else are left alone.
 * A missing root is a no-op. Rules (a swap is two renames, so a crash or a
 * concurrent window must never lose data):
 *  - AGE: an entry is touched only when its newest mtime (the entry itself and
 *    its direct children) is older than `minAgeMs` (default 24 h; `now` is
 *    injectable). A fresh entry belongs to an import that may still be running
 *    in another window or in this one. The importer refreshes the `.old-*`
 *    mtime right after renaming it.
 *  - `.tmp-*`: stale ones are removed.
 *  - `.old-<version>-<12 hex>` (the importer's name for the previous cache):
 *    if `<version>` directory is MISSING the swap was interrupted and this is
 *    the only copy, so it is renamed back to `<version>` (listed in `restored`);
 *    if `<version>` exists it is removed.
 *  - legacy `.old-<hex>` without a parseable version is KEPT, never deleted
 *    (cannot tell what it belongs to).
 */
import { existsSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

export interface RemoveOptions {
	rm?: (path: string) => void;
	sleep?: (ms: number) => Promise<void>;
	/** Total attempts (default 4). */
	attempts?: number;
	/** Base backoff in ms, multiplied by the attempt number (default 100). */
	backoffMs?: number;
}
export interface RemoveResult {
	removed: boolean;
	error?: string;
}
export interface SweepOptions extends RemoveOptions {
	/** Clock for the age rule (default Date.now). */
	now?: () => number;
	/** Minimum age before an entry may be swept (default 24 h). */
	minAgeMs?: number;
}
export const DEFAULT_MIN_AGE_MS = 24 * 60 * 60 * 1000;
export interface SweepResult {
	removed: string[];
	/** Versions restored from a stranded `.old-<version>-*` directory. */
	restored: string[];
	failed: { name: string; error: string }[];
}

const RETRYABLE = new Set(["EBUSY", "EPERM", "ENOTEMPTY"]);
const defaultRm = (p: string): void => rmSync(p, { recursive: true, force: true });
const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function removeBestEffort(dir: string, opts: RemoveOptions = {}): Promise<RemoveResult> {
	const rm = opts.rm ?? defaultRm;
	const sleep = opts.sleep ?? defaultSleep;
	const attempts = Math.max(1, opts.attempts ?? 4);
	const backoff = opts.backoffMs ?? 100;
	let last = "";
	for (let i = 1; i <= attempts; i++) {
		try {
			rm(dir);
			return { removed: true };
		} catch (e) {
			const code = (e as NodeJS.ErrnoException)?.code ?? "";
			last = `${code ? code + ": " : ""}${e instanceof Error ? e.message : String(e)}`;
			if (!RETRYABLE.has(code)) break;
			if (i < attempts) await sleep(backoff * i);
		}
	}
	return { removed: false, error: last };
}

export const isLeftoverName = (name: string): boolean => name.startsWith(".old-") || name.startsWith(".tmp-");

/** `.old-<version>-<12 hex>` -> version (a safe directory name), else null. */
export function oldDirVersion(name: string): string | null {
	const m = /^\.old-([0-9A-Za-z._-]+)-[0-9a-f]{12}$/.exec(name);
	return m && !m[1].startsWith(".") ? m[1] : null;
}

/** Newest mtime (ms) of a directory and its direct children; Infinity when unreadable (treated as fresh). */
export function newestMtimeMs(path: string): number {
	try {
		let newest = statSync(path).mtimeMs;
		if (statSync(path).isDirectory()) {
			for (const c of readdirSync(path)) {
				try {
					newest = Math.max(newest, statSync(join(path, c)).mtimeMs);
				} catch {
					/* child vanished */
				}
			}
		}
		return newest;
	} catch {
		return Number.POSITIVE_INFINITY;
	}
}

export async function sweepLeftovers(root: string, opts: SweepOptions = {}): Promise<SweepResult> {
	const out: SweepResult = { removed: [], failed: [], restored: [] };
	const now = (opts.now ?? Date.now)();
	const minAge = opts.minAgeMs ?? DEFAULT_MIN_AGE_MS;
	let names: string[];
	try {
		names = readdirSync(root);
	} catch {
		return out;
	}
	for (const name of names) {
		if (!isLeftoverName(name)) continue;
		if (now - newestMtimeMs(join(root, name)) < minAge) continue;
		if (name.startsWith(".old-")) {
			const version = oldDirVersion(name);
			if (!version) continue; // legacy / unparseable: keep
			if (!existsSync(join(root, version))) {
				try {
					renameSync(join(root, name), join(root, version));
					out.restored.push(version);
				} catch (e) {
					out.failed.push({ name, error: e instanceof Error ? e.message : String(e) });
				}
				continue;
			}
		}
		const r = await removeBestEffort(join(root, name), opts);
		if (r.removed) out.removed.push(name);
		else out.failed.push({ name, error: r.error ?? "unknown error" });
	}
	return out;
}
