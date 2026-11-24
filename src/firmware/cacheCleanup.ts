/**
 * Best-effort deletion helpers for the firmware image cache (vscode-free).
 *
 * removeBestEffort(dir, opts) never throws. EBUSY / EPERM / ENOTEMPTY (typical
 * on Windows with an antivirus scanner or an open webview) are retried with a
 * short linear backoff; any other error is not retried. Either way the failure
 * is returned as `{ removed: false, error }` so a completed import is never
 * turned into a failure by cleanup.
 *
 * sweepLeftovers(root, opts) removes only direct children of `root` whose name
 * starts with `.old-` or `.tmp-`; version directories and everything else are
 * left alone. A missing root is a no-op.
 */
import { readdirSync, rmSync } from "node:fs";
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
export interface SweepResult {
	removed: string[];
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

export async function sweepLeftovers(root: string, opts: RemoveOptions = {}): Promise<SweepResult> {
	const out: SweepResult = { removed: [], failed: [] };
	let names: string[];
	try {
		names = readdirSync(root);
	} catch {
		return out;
	}
	for (const name of names) {
		if (!isLeftoverName(name)) continue;
		const r = await removeBestEffort(join(root, name), opts);
		if (r.removed) out.removed.push(name);
		else out.failed.push({ name, error: r.error ?? "unknown error" });
	}
	return out;
}
