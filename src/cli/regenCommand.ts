/**
 * `regen-iri <file.rev> [--write] [--expect-hash h]` of the headless CLI (pure: no `vscode` import, IO injected).
 * Uses the extension's generator (`generateMainIri`) and its backup-then-replace plan (`regenerateIri`):
 * target `<rev dir>/<rev basename>.iri`, backup `main.iri.bak` (else timestamped), identical content writes
 * nothing, a missing target is created, a failed backup leaves the target untouched. The `.rev` is never written.
 * `fileHash` / `--expect-hash` are the SHA-256 (hex) of the `.iri` target bytes (null when it does not exist).
 */
import { generateMainIri } from "../iri/generateIri";
import { iriBytes, regenerateIri, targetIriPath } from "../iri/regenerate";
import type { RegenerateFs } from "../iri/regenerate";
import { parseRev } from "../rev";
import type { CliIo, CliResult } from "./revCli";
import { EXIT, sha256, usageFailure } from "./writeCore";

const COMMAND = "regen-iri";
const SAMPLE = 20;

const json = (code: number, body: Record<string, unknown>): CliResult => ({ code, stdout: JSON.stringify(body, null, 2) + "\n", stderr: "" });
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

interface Opts {
	file?: string;
	write: boolean;
	dryRun: boolean;
	expectHash?: string;
}

function parseOpts(rest: string[]): Opts | string {
	const o: Opts = { write: false, dryRun: false };
	for (let i = 0; i < rest.length; i++) {
		const a = rest[i];
		if (a === "--write") {
			o.write = true;
		} else if (a === "--dry-run") {
			o.dryRun = true;
		} else if (a === "--expect-hash") {
			const v = rest[++i];
			if (v === undefined || !/^[0-9a-fA-F]{64}$/.test(v)) {
				return "--expect-hash needs a SHA-256 as 64 hexadecimal characters";
			}
			o.expectHash = v.toLowerCase();
		} else if (a.startsWith("--")) {
			return `Unknown option ${a}`;
		} else if (o.file === undefined) {
			o.file = a;
		} else {
			return `Unexpected argument "${a}"`;
		}
	}
	if (o.file === undefined) {
		return "Missing <file.rev>";
	}
	if (o.write && o.dryRun) {
		return "--write and --dry-run cannot be used together";
	}
	return o;
}

const toLines = (b: Uint8Array | undefined): string[] => (b ? Buffer.from(b).toString("utf8").split(/\r?\n/) : []);

/** Line multiset diff (order-insensitive): how many lines were added and removed, with a bounded sample. */
export function lineDiff(before: Uint8Array | undefined, after: Uint8Array): { added: number; removed: number; addedLines: string[]; removedLines: string[] } {
	const counts = new Map<string, number>();
	for (const l of toLines(before)) counts.set(l, (counts.get(l) ?? 0) + 1);
	const addedLines: string[] = [];
	let added = 0;
	for (const l of toLines(after)) {
		const n = counts.get(l) ?? 0;
		if (n > 0) {
			counts.set(l, n - 1);
		} else {
			added++;
			if (addedLines.length < SAMPLE) addedLines.push(l);
		}
	}
	const removedLines: string[] = [];
	let removed = 0;
	for (const l of toLines(before)) {
		const n = counts.get(l) ?? 0;
		if (n > 0) {
			counts.set(l, n - 1);
			removed++;
			if (removedLines.length < SAMPLE) removedLines.push(l);
		}
	}
	return { added, removed, addedLines, removedLines };
}

export function runRegenIri(argv: string[], io: CliIo): CliResult {
	const opts = parseOpts(argv.slice(1));
	if (typeof opts === "string") {
		return usageFailure(COMMAND, undefined, opts);
	}
	const rev = opts.file as string;
	const revText = io.readText(rev);
	if (revText === undefined) {
		return json(EXIT.READ, { ok: false, command: COMMAND, file: rev, error: `Cannot read ${rev}` });
	}
	const target = targetIriPath(rev);
	let next: Uint8Array;
	try {
		next = iriBytes(generateMainIri(parseRev(revText)));
	} catch (e) {
		return json(EXIT.REFUSED, { ok: false, command: COMMAND, file: target, error: `Cannot generate ${target}: ${message(e)}` });
	}
	const current = io.readBinary(target);
	const fileHash = current ? sha256(current) : null;
	const fail = (code: number, error: string, extra: Record<string, unknown> = {}): CliResult => json(code, { ok: false, command: COMMAND, file: target, fileHash, ...extra, error });
	if (opts.expectHash !== undefined && opts.expectHash !== fileHash) {
		return fail(EXIT.STALE, `Stale file: ${fileHash === null ? `${target} does not exist` : `its SHA-256 is ${fileHash}`}, expected ${opts.expectHash}; nothing was written`, { expectedHash: opts.expectHash });
	}
	const newHash = sha256(next);
	const unchanged = current !== undefined && sha256(current) === newHash;
	const changes = unchanged ? [{ op: "unchanged" }] : [{ op: current ? "replace" : "create", ...lineDiff(current, next) }];
	const warnings: string[] = [];
	const ok = (extra: Record<string, unknown>): CliResult =>
		json(EXIT.OK, { ok: true, command: COMMAND, file: target, dryRun: !opts.write, fileHash, ...(unchanged ? {} : { newHash }), ...extra, changes, warnings });
	if (!opts.write || unchanged) {
		return ok({});
	}

	const wfs = io.writeFs;
	if (!wfs) {
		return fail(EXIT.WRITE, "Writing is not available in this environment");
	}
	// Stale re-check right before touching anything.
	const again = io.readBinary(target);
	if ((again ? sha256(again) : null) !== fileHash) {
		return fail(EXIT.STALE, "Stale file: it changed while the change was being planned; nothing was written");
	}
	const fs: RegenerateFs = { ...wfs, readFile: (p) => io.readBinary(p) };
	let backup: string | undefined;
	try {
		backup = regenerateIri(rev, Buffer.from(next).toString("utf8"), fs, (io.now ?? (() => new Date()))()).backup;
	} catch (e) {
		return fail(EXIT.WRITE, `Write failed, ${current ? "the file was not replaced" : "the file was not created"}: ${message(e)}`);
	}
	const back = io.readBinary(target);
	if (!back || sha256(back) !== newHash) {
		return fail(EXIT.WRITE, `Readback validation failed (the bytes on disk differ from the generated bytes)${backup ? `; restore the backup ${backup} over ${target}` : ""}`, backup ? { backup } : {});
	}
	warnings.push("Written; Revolution and 1280 acceptance of the regenerated file is UNVERIFIED (compile the project before loading it on an indicator).");
	return ok(backup ? { backup } : {});
}
