/**
 * Lossless writer for Rice Lake Revolution `.rev` files (pure module: no `vscode` import).
 *
 * The only write the extension ever performs on a `.rev` is changing the x, y, width and height tokens of
 * existing `WDGT#<id>=` lines. Everything else (BOM, CRLF, XML, key order, every other line, the hashes) is
 * returned byte for byte, so a save produces a minimal, reviewable diff.
 *
 * Callers pass the file as a *byte-per-char* string (`buffer.toString("latin1")`) and write the result back
 * with `Buffer.from(result, "latin1")`: nothing is ever decoded, so even bytes that are not valid UTF-8 survive.
 * Only ASCII structure (`WDGT#`, commas, digits, `<Config>`) is inspected.
 *
 * Hashes: `ConfigHash` is NOT recomputed (its algorithm could not be reproduced, see `odd/reports/
 * issue-6-screen-editor.md`). `CustomHash` is the SHA-1 of the UTF-16LE `<Printers>` text; this writer never
 * touches `<Printers>`, so it stays valid. `computeCustomHash` exists to prove that.
 */
import { createHash } from "node:crypto";

export class RevWriteError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RevWriteError";
	}
}

/** New geometry of one widget. Omitted fields are left untouched; width/height only for sized widget types. */
export interface WidgetPatch {
	id: number;
	x?: number;
	y?: number;
	width?: number;
	height?: number;
}

/** Widget types whose line stores width and height (fields 3 and 4); types 1 and 6 store x and y only. */
const SIZED_TYPES = new Set([3, 4, 7, 10]);
const POSITIONED_TYPES = new Set([1, 3, 4, 6, 7, 10]);
/** Coordinates and sizes are integers inside this range; anything else is a bug or an attack, never a layout. */
export const COORD_MIN = -10000;
export const COORD_MAX = 10000;

const WDGT_LINE = /^WDGT#(\d+)=/;
const NUMBER_TOKEN = /^-?\d+(\.\d+)?$/;

function checkValue(label: string, id: number, v: number): void {
	if (!Number.isInteger(v) || v < COORD_MIN || v > COORD_MAX) {
		throw new RevWriteError(`WDGT#${id}: ${label}=${String(v)} is not an integer between ${COORD_MIN} and ${COORD_MAX}`);
	}
}

/** Returns `token` itself when it already holds `value` (a decimal such as `10.50` is kept verbatim). */
function patchToken(token: string, label: string, id: number, value: number): string {
	if (!NUMBER_TOKEN.test(token.trim())) {
		throw new RevWriteError(`WDGT#${id}: field ${label} is "${token}", not a number; refusing to rewrite the line`);
	}
	if (Number(token) === value) {
		return token;
	}
	checkValue(label, id, value);
	return String(value);
}

function patchLine(line: string, patch: WidgetPatch): string {
	const cr = line.endsWith("\r") ? "\r" : "";
	const body = cr ? line.slice(0, -1) : line;
	const eq = body.indexOf("=");
	const head = body.slice(0, eq + 1);
	const fields = body.slice(eq + 1).split(",");
	const id = patch.id;
	const type = Number(fields[0]);
	if (!POSITIONED_TYPES.has(type)) {
		throw new RevWriteError(`WDGT#${id}: widget type ${fields[0]} is not known, cannot edit it`);
	}
	const sized = SIZED_TYPES.has(type);
	if (!sized && (patch.width !== undefined || patch.height !== undefined)) {
		throw new RevWriteError(`WDGT#${id}: type ${type} does not store a size, only x and y can be changed`);
	}
	if (fields.length < 5) {
		throw new RevWriteError(`WDGT#${id}: the line has ${fields.length} fields, expected at least 5`);
	}
	const targets: Array<[number, string, number | undefined]> = [
		[1, "x", patch.x],
		[2, "y", patch.y],
		[3, "width", patch.width],
		[4, "height", patch.height],
	];
	for (const [i, label, value] of targets) {
		if (value !== undefined) {
			fields[i] = patchToken(fields[i], label, id, value);
		}
	}
	return head + fields.join(",") + cr;
}

/**
 * Applies geometry patches to the `WDGT#` lines of `text` (byte-per-char string, see the module header).
 * Throws `RevWriteError`, returning nothing, when any patch is unsafe: the caller never gets a half-written file.
 */
export function applyWidgetPatches(text: string, patches: readonly WidgetPatch[]): string {
	const open = text.indexOf("<Config>");
	const close = text.indexOf("</Config>");
	if (open < 0 || close < open) {
		throw new RevWriteError("The file has no <Config> element");
	}
	if (patches.length === 0) {
		return text;
	}
	const merged = new Map<number, WidgetPatch>();
	for (const p of patches) {
		merged.set(p.id, { ...merged.get(p.id), ...p });
	}
	const start = open + "<Config>".length;
	const lines = text.slice(start, close).split("\n");
	const seen = new Map<number, number>();
	lines.forEach((l, i) => {
		const m = WDGT_LINE.exec(l);
		if (m && merged.has(Number(m[1]))) {
			if (seen.has(Number(m[1]))) {
				throw new RevWriteError(`WDGT#${m[1]} appears more than once; refusing to guess which one to edit`);
			}
			seen.set(Number(m[1]), i);
		}
	});
	for (const id of merged.keys()) {
		if (!seen.has(id)) {
			throw new RevWriteError(`WDGT#${id} does not exist in the file`);
		}
	}
	for (const [id, i] of seen) {
		lines[i] = patchLine(lines[i], merged.get(id) as WidgetPatch);
	}
	return text.slice(0, start) + lines.join("\n") + text.slice(close);
}

/** `CustomHash` as stored (20 decimal bytes separated by spaces), normalized to lower-case hex. */
export function readCustomHash(text: string): string | undefined {
	const m = /<CustomHash\s+value="([^"]*)"/.exec(text);
	if (!m) {
		return undefined;
	}
	const bytes = m[1].trim().split(/\s+/).map(Number);
	return bytes.length === 20 && bytes.every((b) => Number.isInteger(b) && b >= 0 && b <= 255) ? Buffer.from(bytes).toString("hex") : undefined;
}

function decodeXml(s: string): string {
	return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

/**
 * SHA-1 of the UTF-16LE `<Printers>` text (CRLF kept), lower-case hex. Reproduces `CustomHash` on DOLE.
 * `text` is byte-per-char; the Printers block is decoded as UTF-8 first.
 */
export function computeCustomHash(text: string): string | undefined {
	const m = /<Printers>([\s\S]*?)<\/Printers>/.exec(text);
	if (!m) {
		return undefined;
	}
	const printers = decodeXml(Buffer.from(m[1], "latin1").toString("utf8"));
	return createHash("sha1").update(Buffer.from(printers, "utf16le")).digest("hex");
}
