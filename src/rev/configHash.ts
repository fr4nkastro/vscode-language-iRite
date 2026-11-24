/**
 * `ConfigHash` and `CustomHash` of a Revolution `.rev` (pure module: no `vscode` import).
 *
 * Recipe (reproduced on every Revolution-saved file tested, see `docs/rev-format.md` section 2):
 * `value = SHA-1( UTF-16LE( XML-decoded text ) )`, the 20 digest bytes written as decimal numbers, each
 * followed by one space (the last one too). `ConfigHash` hashes the text of `<Config>` (CRLF line ends, last
 * CRLF included), `CustomHash` the text of `<CustomData><Printers>`.
 *
 * Inputs are byte-per-char strings (`buffer.toString("latin1")`, like `./serialize`); the hashed block is decoded
 * as UTF-8 first. Revolution always writes CRLF, so a LF-only copy (for example after a git checkout) is hashed
 * as its CRLF form, which is the value Revolution stored for it.
 */
import { createHash } from "node:crypto";
import { decodeEntities } from "./index";

function utf8(latin1: string): string {
	return Buffer.from(latin1, "latin1").toString("utf8");
}

/** SHA-1 of the UTF-16LE text, formatted the way Revolution stores it (`164 247 85 ... `). */
export function formatHash(text: string): string {
	return [...createHash("sha1").update(Buffer.from(text, "utf16le")).digest()].map((b) => `${b} `).join("");
}

function block(file: string, tag: string): string | undefined {
	const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(file);
	return m ? decodeEntities(utf8(m[1])) : undefined;
}

/** `ConfigHash` of the file as it should be stored; undefined when the file has no `<Config>`. */
export function computeConfigHash(file: string): string | undefined {
	const config = block(file, "Config");
	return config === undefined ? undefined : formatHash(config.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n"));
}

/** `CustomHash` as stored (decimal bytes); undefined when the file has no `<Printers>`. */
export function computeCustomHashValue(file: string): string | undefined {
	const printers = block(file, "Printers");
	return printers === undefined ? undefined : formatHash(printers);
}

/** The stored header values, raw. */
export function readConfigHash(file: string): string | undefined {
	return /<ConfigHash\s+value="([^"]*)"/.exec(file)?.[1];
}

export function readCustomHashValue(file: string): string | undefined {
	return /<CustomHash\s+value="([^"]*)"/.exec(file)?.[1];
}

/**
 * Returns `file` with the value of the `<ConfigHash value="..."/>` header replaced by the recomputed one. Only
 * the characters inside the quotes change. A file without that element (or without `<Config>`) is returned as is.
 */
export function rewriteConfigHash(file: string): string {
	const hash = computeConfigHash(file);
	if (hash === undefined) {
		return file;
	}
	return file.replace(/(<ConfigHash\s+value=")[^"]*(")/, (_m, a: string, b: string) => `${a}${hash}${b}`);
}
