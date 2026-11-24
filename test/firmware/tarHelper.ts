// Test helpers: build tiny synthetic tar archives and PNGs in memory.
// No firmware file is ever used as a fixture.
import { createHash } from "node:crypto";

export interface TarItem {
	name: string;
	body?: Buffer | string;
	typeflag?: string;
	mode?: number;
	/** Write `prefix` (ustar) + `name` split instead of a plain name. */
	prefix?: string;
	/** Emit a pax `x` header before the entry with these records. */
	pax?: Record<string, string>;
	/** Emit a GNU `L` long-name entry before the entry. */
	gnuLongName?: string;
	/** Corrupt the checksum. */
	badChecksum?: boolean;
	/** Override the raw size field text. */
	rawSize?: string;
}

function field(buf: Buffer, off: number, len: number, text: string): void {
	buf.write(text, off, Math.min(len, Buffer.byteLength(text)), "latin1");
}

export function header(name: string, size: number, typeflag: string, opts: { mode?: number; prefix?: string; badChecksum?: boolean; rawSize?: string } = {}): Buffer {
	const h = Buffer.alloc(512);
	field(h, 0, 100, name);
	field(h, 100, 8, (opts.mode ?? 0o644).toString(8).padStart(7, "0"));
	field(h, 108, 8, "0000000");
	field(h, 116, 8, "0000000");
	field(h, 124, 12, opts.rawSize ?? size.toString(8).padStart(11, "0"));
	field(h, 136, 12, "00000000000");
	h.fill(0x20, 148, 156);
	h.write(typeflag, 156, 1, "latin1");
	field(h, 257, 6, "ustar");
	field(h, 263, 2, "00");
	if (opts.prefix) field(h, 345, 155, opts.prefix);
	let sum = 0;
	for (const b of h) sum += b;
	if (opts.badChecksum) sum += 1;
	field(h, 148, 8, sum.toString(8).padStart(6, "0") + "\0 ");
	return h;
}

function pad(body: Buffer): Buffer {
	const rem = body.length % 512;
	return rem === 0 ? body : Buffer.concat([body, Buffer.alloc(512 - rem)]);
}

function paxBody(rec: Record<string, string>): Buffer {
	const parts: Buffer[] = [];
	for (const [k, v] of Object.entries(rec)) {
		const rest = ` ${k}=${v}\n`;
		let len = Buffer.byteLength(rest) + 1;
		while (String(len).length + Buffer.byteLength(rest) !== len) len = String(len).length + Buffer.byteLength(rest);
		parts.push(Buffer.from(`${len}${rest}`));
	}
	return Buffer.concat(parts);
}

export function buildTar(items: TarItem[], opts: { terminator?: boolean } = {}): Buffer {
	const out: Buffer[] = [];
	for (const it of items) {
		const body = typeof it.body === "string" ? Buffer.from(it.body) : (it.body ?? Buffer.alloc(0));
		if (it.pax) {
			const pb = paxBody(it.pax);
			out.push(header("PaxHeaders/x", pb.length, "x"), pad(pb));
		}
		if (it.gnuLongName !== undefined) {
			const lb = Buffer.from(it.gnuLongName + "\0");
			out.push(header("././@LongLink", lb.length, "L"), pad(lb));
		}
		out.push(header(it.name, body.length, it.typeflag ?? "0", it), pad(body));
	}
	if (opts.terminator !== false) out.push(Buffer.alloc(1024));
	return Buffer.concat(out);
}

/** Minimal PNG: signature + IHDR chunk (CRC not computed; readers here only check the signature and IHDR). */
export function makePng(width: number, height: number, extra = 0): Buffer {
	const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	const ihdr = Buffer.alloc(25);
	ihdr.writeUInt32BE(13, 0);
	ihdr.write("IHDR", 4, "latin1");
	ihdr.writeUInt32BE(width, 8);
	ihdr.writeUInt32BE(height, 12);
	ihdr[16] = 8;
	ihdr[17] = 6;
	return Buffer.concat([sig, ihdr, Buffer.alloc(extra, 7)]);
}

export function sha1(b: Buffer): string {
	return createHash("sha1").update(b).digest("hex");
}

export const IMG_DIR = { default: "images", "7": "images7", "12": "images12" } as const;
export function imgPath(variant: "default" | "7" | "12", n: number | string, dot = "./"): string {
	return `${dot}var/node/public/${IMG_DIR[variant]}/lclimages/${n}.png`;
}
