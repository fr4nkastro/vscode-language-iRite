/**
 * Streaming tar reader (pure: no `vscode`, only Node built-ins).
 *
 * API
 *   readTar(source: string | Readable, onEntry: (entry: TarEntry) => void | Promise<void>): Promise<void>
 *   TarEntry { name, size, typeflag, mode, read(maxBytes): Promise<Buffer>, skip(): Promise<void> }
 *   TarError (typed error for malformed archives)
 *
 * Entries are delivered one at a time; the callback may `read()` the body
 * (bounded by `maxBytes`, otherwise TarError) or ignore/`skip()` it. Unread
 * bytes plus the 512-byte padding are discarded automatically, so the archive
 * is never buffered whole: memory is bounded by the stream chunk and by the
 * largest body the caller chooses to read.
 *
 * Supported: ustar (prefix + name), pax `x` (path, size; other keys ignored),
 * pax `g` (skipped), GNU `L` long names (`K` skipped). Header checksum is validated; a bad checksum, a
 * truncated header/body, or a non-octal size raise TarError. The typeflag is
 * returned raw ("0", "\0", "5", ...). Names are returned as stored (e.g.
 * "./var/node/..."): validation is the caller's job (see imageEntries.ts).
 *
 * Completeness (issue S11): an archive is complete only if an end-of-archive
 * marker (a zero block) is read where a header is expected. EOF exactly
 * between entries, or an empty stream, could be a truncated copy, so it raises
 * TarError and the importer keeps the previous cache. Decision: ONE zero block
 * is accepted (GNU tar reads it with a warning; the standard marker is two);
 * bytes after the first zero block are ignored.
 */
import { createReadStream } from "node:fs";
import type { Readable } from "node:stream";

export class TarError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "TarError";
	}
}

export interface TarEntry {
	name: string;
	size: number;
	typeflag: string;
	mode: number;
	/** Read the whole body; throws TarError if `size > maxBytes` or the archive is truncated. */
	read(maxBytes: number): Promise<Buffer>;
	/** Discard the body (optional: unread bodies are skipped automatically). */
	skip(): Promise<void>;
}

const BLOCK = 512;
const MAX_META = 1024 * 1024; // pax / long-name bodies

/** Pull-based reader over the async chunks of a stream. */
class ChunkReader {
	private it: AsyncIterator<Buffer | string>;
	private pending: Buffer[] = [];
	private have = 0;
	private done = false;

	constructor(stream: Readable) {
		this.it = (stream as AsyncIterable<Buffer | string>)[Symbol.asyncIterator]();
	}

	private async fill(n: number): Promise<void> {
		while (this.have < n && !this.done) {
			const r = await this.it.next();
			if (r.done) {
				this.done = true;
				break;
			}
			const b = typeof r.value === "string" ? Buffer.from(r.value) : r.value;
			if (b.length) {
				this.pending.push(b);
				this.have += b.length;
			}
		}
	}

	/** Up to `n` bytes (fewer only at EOF). */
	async read(n: number): Promise<Buffer> {
		await this.fill(n);
		const take = Math.min(n, this.have);
		const out: Buffer[] = [];
		let left = take;
		while (left > 0) {
			const head = this.pending[0];
			if (head.length <= left) {
				out.push(head);
				left -= head.length;
				this.pending.shift();
			} else {
				out.push(head.subarray(0, left));
				this.pending[0] = head.subarray(left);
				left = 0;
			}
		}
		this.have -= take;
		return out.length === 1 ? out[0] : Buffer.concat(out);
	}

	/** Discard up to `n` bytes without accumulating them; returns the count discarded. */
	async skip(n: number): Promise<number> {
		let left = n;
		while (left > 0) {
			if (this.have === 0) {
				await this.fill(1);
				if (this.have === 0) break;
			}
			const head = this.pending[0];
			if (head.length <= left) {
				left -= head.length;
				this.have -= head.length;
				this.pending.shift();
			} else {
				this.pending[0] = head.subarray(left);
				this.have -= left;
				left = 0;
			}
		}
		return n - left;
	}

	destroy(): void {
		void this.it.return?.();
	}
}

function cstr(buf: Buffer, off: number, len: number): string {
	const slice = buf.subarray(off, off + len);
	const nul = slice.indexOf(0);
	return slice.subarray(0, nul < 0 ? len : nul).toString("utf8");
}

function octal(buf: Buffer, off: number, len: number, what: string): number {
	const text = cstr(buf, off, len).trim();
	if (text === "") return 0;
	if (!/^[0-7]+$/.test(text)) throw new TarError(`Invalid ${what} field in tar header: "${text}" is not octal`);
	return parseInt(text, 8);
}

function checksumOk(h: Buffer): boolean {
	const stored = cstr(h, 148, 8).trim();
	if (!/^[0-7]+$/.test(stored)) return false;
	let sum = 0;
	for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : h[i];
	return sum === parseInt(stored, 8);
}

function parsePax(body: Buffer): { path?: string; size?: number } {
	const out: { path?: string; size?: number } = {};
	let pos = 0;
	while (pos < body.length) {
		const sp = body.indexOf(0x20, pos);
		if (sp < 0) break;
		const len = parseInt(body.subarray(pos, sp).toString("latin1"), 10);
		if (!Number.isFinite(len) || len <= sp - pos + 1 || pos + len > body.length) throw new TarError("Malformed pax extended header record");
		const rec = body.subarray(sp + 1, pos + len - 1).toString("utf8"); // drop trailing \n
		const eq = rec.indexOf("=");
		if (eq > 0) {
			const key = rec.slice(0, eq);
			const value = rec.slice(eq + 1);
			if (key === "path") out.path = value;
			else if (key === "size") {
				if (!/^\d+$/.test(value)) throw new TarError(`Invalid pax size "${value}"`);
				out.size = parseInt(value, 10);
			}
		}
		pos += len;
	}
	return out;
}

export async function readTar(source: string | Readable, onEntry: (entry: TarEntry) => void | Promise<void>): Promise<void> {
	const stream = typeof source === "string" ? createReadStream(source) : source;
	const reader = new ChunkReader(stream);
	try {
		await run(reader, onEntry);
	} finally {
		reader.destroy();
		if (typeof source === "string") stream.destroy();
	}
}

async function readBody(reader: ChunkReader, size: number, what: string): Promise<Buffer> {
	const body = await reader.read(size);
	if (body.length < size) throw new TarError(`Truncated tar archive: ${what} body has ${body.length} of ${size} bytes`);
	return body;
}

async function run(reader: ChunkReader, onEntry: (entry: TarEntry) => void | Promise<void>): Promise<void> {
	let paxPath: string | undefined;
	let paxSize: number | undefined;
	let longName: string | undefined;

	for (;;) {
		const h = await reader.read(BLOCK);
		if (h.length === 0) throw new TarError("Incomplete tar archive: ended without an end-of-archive marker (zero block), possibly truncated between entries");
		if (h.length < BLOCK) throw new TarError(`Truncated tar archive: header block has ${h.length} of ${BLOCK} bytes`);
		if (h.every((b) => b === 0)) return;
		if (!checksumOk(h)) throw new TarError("Invalid tar header checksum");

		const headerSize = octal(h, 124, 12, "size");
		const typeflag = h.length > 156 ? String.fromCharCode(h[156]) : "0";
		const padded = Math.ceil(headerSize / BLOCK) * BLOCK;

		if (typeflag === "x" || typeflag === "L") {
			if (headerSize > MAX_META) throw new TarError(`Tar metadata entry too large (${headerSize} bytes)`);
			const body = await readBody(reader, headerSize, typeflag === "x" ? "pax header" : "long name");
			await reader.skip(padded - headerSize);
			if (typeflag === "x") {
				const p = parsePax(body);
				if (p.path !== undefined) paxPath = p.path;
				if (p.size !== undefined) paxSize = p.size;
			} else {
				longName = cstr(body, 0, body.length);
			}
			continue;
		}
		if (typeflag === "g" || typeflag === "K") {
			const skipped = await reader.skip(padded);
			if (skipped < headerSize) throw new TarError("Truncated tar archive: metadata entry body");
			continue;
		}

		const prefix = cstr(h, 345, 155);
		const base = cstr(h, 0, 100);
		const headerName = prefix ? `${prefix}/${base}` : base;
		const name = paxPath ?? longName ?? headerName;
		const size = paxSize ?? headerSize;
		const mode = octal(h, 100, 8, "mode");
		paxPath = paxSize = longName = undefined;

		let remaining = size;
		const entry: TarEntry = {
			name,
			size,
			typeflag,
			mode,
			async read(maxBytes: number): Promise<Buffer> {
				if (remaining !== size) throw new TarError("Entry body already consumed");
				if (size > maxBytes) throw new TarError(`Entry "${name}" size ${size} exceeds the ${maxBytes} byte limit`);
				const body = await readBody(reader, size, `entry "${name}"`);
				remaining = 0;
				return body;
			},
			async skip(): Promise<void> {
				const skipped = await reader.skip(remaining);
				remaining -= skipped;
				if (remaining > 0) throw new TarError(`Truncated tar archive: entry "${name}" body has ${size - remaining} of ${size} bytes`);
			},
		};
		await onEntry(entry);
		await entry.skip();
		// Padding may be missing at EOF of a hand-made archive: tolerated.
		await reader.skip(Math.ceil(size / BLOCK) * BLOCK - size);
	}
}
