/** Backup naming for the first save of a `.rev` in a session (pure, no `vscode` import). */
import * as path from "node:path";

const pad = (n: number): string => String(n).padStart(2, "0");

/**
 * `main.rev.bak` next to the file; when that exists (an earlier session's backup is never overwritten)
 * `main.rev.<yyyymmdd-hhmmss>.bak`, then `.2.bak`, `.3.bak` ... until a free name is found.
 */
export function backupPath(revPath: string, exists: (p: string) => boolean, now: Date): string {
	const plain = `${revPath}.bak`;
	if (!exists(plain)) {
		return path.normalize(plain);
	}
	const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
	let candidate = `${revPath}.${stamp}.bak`;
	for (let n = 2; exists(candidate) && n < 10000; n++) {
		candidate = `${revPath}.${stamp}.${n}.bak`;
	}
	return path.normalize(candidate);
}
