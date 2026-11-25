/**
 * Shared WRITE core of the headless `.rev` CLI (pure: no `vscode` import, IO injected). Every write command
 * (widgets now, database and `regen-iri` later) plans its change as bytes and hands it to `runWriteCommand`,
 * which applies the safety rules:
 *   - dry-run by default; `--write` applies; `--expect-hash <sha256>` refuses a stale file (also in dry-run);
 *   - on `--write`: stale re-check, backup first (`src/editor/backup.ts` naming, never overwritten), atomic
 *     replace (temp file + rename, temp removed on failure), readback validation (bytes, ConfigHash, parse);
 *   - JSON result `{ ok, command, file, dryRun, fileHash, newHash?, backup?, changes, warnings, ... }`;
 *     errors `{ ok:false, error, command, file, fileHash?, ... }`.
 * `fileHash` is the SHA-256 (hex) of the raw bytes of the file before the change.
 */
import { createHash } from "node:crypto";
import * as path from "node:path";
import { backupPath } from "../editor/backup";
import { parseRev } from "../rev";
import { computeConfigHash, readConfigHash } from "../rev/configHash";
import { RevWriteError } from "../rev/serialize";

/** Exit codes of the CLI (read commands keep using 0, 1 and 2 as before). */
export const EXIT = {
	/** Success (a dry-run that plans a change is also 0). */
	OK: 0,
	/** The file cannot be read / does not exist. */
	READ: 1,
	/** Usage error: unknown command or option, missing or malformed argument. */
	USAGE: 2,
	/** Validation error or refusal: the input is rejected, nothing was written. */
	REFUSED: 3,
	/** Stale file: its SHA-256 differs from `--expect-hash` (or it changed while planning); nothing was written. */
	STALE: 4,
	/** I/O failure while backing up, writing or reading back. */
	WRITE: 5,
} as const;

/** The fs operations a write needs; Node's `fs` backs them in `nodeIo`, tests may override single calls. */
export interface WriteFs {
	exists(p: string): boolean;
	/** Creates a new file (exclusive: never replaces an existing one). */
	writeFile(p: string, data: Uint8Array): void;
	/** Copy that fails when the destination exists. */
	copyExcl(from: string, to: string): void;
	rename(from: string, to: string): void;
	/** Best-effort delete of the temp file after a failed rename. */
	remove(p: string): void;
}

/** A rejection decided while planning: the input is wrong or unsafe. `extra` is merged into the JSON error. */
export class Refusal extends Error {
	constructor(
		message: string,
		readonly extra: Record<string, unknown> = {},
	) {
		super(message);
		this.name = "Refusal";
	}
}

export interface Planned {
	/** New file bytes; undefined when there is nothing to change (the file is not touched). */
	bytes?: Buffer;
	changes: unknown[];
	warnings: string[];
	/** Extra fields for the JSON result. */
	extra?: Record<string, unknown>;
}

export interface WriteRequest {
	/** For example `widget set`. */
	command: string;
	file: string;
	write: boolean;
	expectHash?: string;
	io: { readBinary(p: string): Buffer | undefined; writeFs?: WriteFs; now?: () => Date };
	/** Pure planning from the original bytes. Throws `Refusal` or `RevWriteError` to reject. */
	plan(original: Buffer): Planned;
}

export interface WriteResult {
	code: number;
	stdout: string;
	stderr: string;
}

export const sha256 = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");

const json = (code: number, body: Record<string, unknown>): WriteResult => ({ code, stdout: JSON.stringify(body, null, 2) + "\n", stderr: "" });

/** Usage error as JSON (exit 2). */
export function usageFailure(command: string, file: string | undefined, error: string): WriteResult {
	return json(EXIT.USAGE, { ok: false, command, ...(file !== undefined ? { file } : {}), error });
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function runWriteCommand(req: WriteRequest): WriteResult {
	const { command, file } = req;
	const original = req.io.readBinary(file);
	if (!original) {
		return json(EXIT.READ, { ok: false, command, file, error: `Cannot read ${file}` });
	}
	const fileHash = sha256(original);
	const fail = (code: number, error: string, extra: Record<string, unknown> = {}): WriteResult => json(code, { ok: false, command, file, fileHash, ...extra, error });
	if (req.expectHash !== undefined && req.expectHash.toLowerCase() !== fileHash) {
		return fail(EXIT.STALE, `Stale file: its SHA-256 is ${fileHash}, expected ${req.expectHash.toLowerCase()}; nothing was written`, { expectedHash: req.expectHash.toLowerCase() });
	}
	let plan: Planned;
	try {
		plan = req.plan(original);
	} catch (e) {
		if (e instanceof Refusal) {
			return fail(EXIT.REFUSED, e.message, e.extra);
		}
		if (e instanceof RevWriteError) {
			return fail(EXIT.REFUSED, e.message);
		}
		throw e;
	}
	const ok = (extra: Record<string, unknown>, more: string[] = []): WriteResult =>
		json(EXIT.OK, { ok: true, command, file, dryRun: !req.write, fileHash, ...extra, changes: plan.changes, warnings: [...plan.warnings, ...more], ...(plan.extra ?? {}) });
	if (!req.write || !plan.bytes) {
		return ok({});
	}

	const wfs = req.io.writeFs;
	if (!wfs) {
		return fail(EXIT.WRITE, "Writing is not available in this environment");
	}
	const next = plan.bytes;
	// Stale re-check right before touching anything (the file may have changed while planning).
	const again = req.io.readBinary(file);
	if (!again || sha256(again) !== fileHash) {
		return fail(EXIT.STALE, "Stale file: it changed while the change was being planned; nothing was written");
	}
	const now = (req.io.now ?? (() => new Date()))();
	const backup = backupPath(file, (p) => wfs.exists(p), now);
	try {
		wfs.copyExcl(file, backup);
	} catch (e) {
		return fail(EXIT.WRITE, `Backup failed, the file was not touched: ${message(e)}`);
	}
	const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${now.getTime()}.tmp`);
	try {
		wfs.writeFile(tmp, next);
		wfs.rename(tmp, file);
	} catch (e) {
		try {
			wfs.remove(tmp);
		} catch {
			// keep the original error
		}
		return fail(EXIT.WRITE, `Write failed, the file was not replaced (backup: ${backup}): ${message(e)}`, { backup });
	}
	const back = req.io.readBinary(file);
	const why = readbackProblem(back, next);
	if (why) {
		return fail(EXIT.WRITE, `Readback validation failed (${why}); restore the backup ${backup} over ${file}`, { backup });
	}
	return ok({ newHash: sha256(next), backup }, [UNVERIFIED]);
}

const UNVERIFIED = "Written; Revolution and 1280 acceptance of this file is UNVERIFIED (open it in Revolution before loading it on an indicator).";

/** Why the bytes on disk are not what was planned; undefined when the readback is good. */
function readbackProblem(back: Buffer | undefined, expected: Buffer): string | undefined {
	if (!back) {
		return "the file cannot be read back";
	}
	if (!back.equals(expected)) {
		return "the bytes on disk differ from the planned bytes";
	}
	const latin = back.toString("latin1");
	const stored = readConfigHash(latin);
	if (stored !== undefined && stored !== computeConfigHash(latin)) {
		return "the ConfigHash does not match the Config text";
	}
	try {
		parseRev(back.toString("utf8"));
	} catch (e) {
		return `the file does not parse: ${message(e)}`;
	}
	return undefined;
}
