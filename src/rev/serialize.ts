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
 * Beyond geometry (`applyWidgetPatches`), `applyWidgetOps` can patch any field of a `WDGT` line, append a new
 * line and remove one (screen editor, issue `screen-editor-widgets`). Rules: Config text is XML-escaped with
 * `&` `<` `>` only; a `WDGT` value is a plain comma split/join with no escaping, so a token with a comma, CR or
 * LF, or a value over 255 characters, is refused. A new line goes right after the last existing `WDGT` line
 * (Revolution sorts by id when it loads, so the placement is cosmetic).
 *
 * Hashes: this module never touches `<Printers>`, so `CustomHash` stays valid. `ConfigHash` covers the Config
 * text, so a save that changes it must rewrite the header with `./configHash` (the save plan does).
 */
import { createHash } from "node:crypto";
import { decodeEntities } from "./index";
import { WIDGET_ID_MAX, WIDGET_ID_MIN, WIDGET_VALUE_MAX, tokenIndexOf, widgetFieldAt, widgetFieldByName, widgetTypeDef } from "./widgetCatalog";

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

const escapeXml = (v: string): string => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const toBytes = (v: string): string => Buffer.from(v, "utf8").toString("latin1");
const toText = (latin1: string): string => Buffer.from(latin1, "latin1").toString("utf8");

/** Field values by catalog name, or by token index written as a string (`"5"`). */
export type FieldValues = Record<string, string | number>;

export type WidgetOp =
	| { kind: "patch"; id: number; fields: FieldValues }
	/** `tokens` hold the whole value, type code first. */
	| { kind: "add"; id: number; tokens: ReadonlyArray<string | number> }
	| { kind: "remove"; id: number };

/**
 * Why `value` cannot be written to `field` (name or catalog index) of a widget of `type`; undefined when it can.
 * Checks the L6 rules (no comma, CR, LF) and, for catalog fields, integer/enum/range rules.
 */
export function checkWidgetToken(type: number, field: string | number, value: string | number): string | undefined {
	const v = String(value);
	if (/[,\r\n]/.test(v)) {
		return `"${field}" must not contain a comma or a line break`;
	}
	const f = typeof field === "number" ? widgetFieldAt(type, field) : widgetFieldByName(type, field);
	if (!f) {
		return widgetTypeDef(type) && typeof field === "string" ? `unknown field "${field}" for type ${type}` : undefined;
	}
	if (f.kind === "int" || f.kind === "enum" || f.kind === "screen") {
		if (!/^-?\d+$/.test(v)) {
			return `"${f.name}" must be an integer, got "${v}"`;
		}
		const n = Number(v);
		if (f.values) {
			if (!f.values.some((e) => e.value === n)) {
				return `"${f.name}" must be one of ${f.values.map((e) => e.value).join(", ")}, got ${n}`;
			}
		} else {
			const lowerBounded = f.role !== "x" && f.role !== "y";
			if ((lowerBounded && f.min !== undefined && n < f.min) || (f.max !== undefined && n > f.max)) {
				return `"${f.name}" is out of range${f.min !== undefined && lowerBounded ? ` (min ${f.min}` : " ("}${f.max !== undefined ? ` max ${f.max}` : ""})`;
			}
		}
	}
	return undefined;
}

const fail = (id: number, why: string): never => {
	throw new RevWriteError(`WDGT#${id}: ${why}`);
};

function checkValueLength(id: number, tokens: readonly string[]): void {
	const n = toText(decodeEntities(tokens.join(","))).length;
	if (n > WIDGET_VALUE_MAX) {
		fail(id, `the value would have ${n} characters, the maximum is ${WIDGET_VALUE_MAX}`);
	}
}

function checkId(id: number): void {
	if (!Number.isInteger(id) || id < WIDGET_ID_MIN || id > WIDGET_ID_MAX) {
		throw new RevWriteError(`WDGT#${String(id)}: the id must be an integer between ${WIDGET_ID_MIN} and ${WIDGET_ID_MAX}`);
	}
}

function patchFields(id: number, line: string, fields: FieldValues): string {
	const cr = line.endsWith("\r") ? "\r" : "";
	const body = cr ? line.slice(0, -1) : line;
	const eq = body.indexOf("=");
	const head = body.slice(0, eq + 1);
	const tokens = body.slice(eq + 1).split(",");
	const type = Number(tokens[0]);
	const def = widgetTypeDef(type);
	const extra = tokens.length - (def?.tokenCount ?? tokens.length);
	const todo = new Map<number, string>();
	for (const [key, value] of Object.entries(fields)) {
		const byIndex = /^\d+$/.test(key);
		if (!byIndex && !def) {
			fail(id, `type ${tokens[0]} is not in the catalog, fields can only be addressed by index`);
		}
		const idx = tokenIndexOf(type, tokens.length, byIndex ? Number(key) : key);
		if (idx === undefined || idx < 0 || idx >= tokens.length) {
			return fail(id, `field "${key}" is not in the line (${tokens.length} tokens)`);
		}
		if (idx === 0) {
			fail(id, "the widget type cannot be changed");
		}
		const why = checkWidgetToken(type, byIndex ? Number(key) : key, value);
		if (why) {
			fail(id, why);
		}
		if (todo.has(idx)) {
			fail(id, `field "${key}" is given twice`);
		}
		todo.set(idx, toBytes(escapeXml(String(value))));
	}
	let changed = false;
	for (const [idx, v] of [...todo.entries()].sort((a, b) => b[0] - a[0])) {
		// A caption spread over several tokens by a comma (written by another tool) is replaced as a whole.
		const span = idx === 5 && extra > 0 && (type === 4 || type === 11) ? 1 + extra : 1;
		const old = tokens.slice(idx, idx + span).join(",");
		if (old !== v) {
			tokens.splice(idx, span, v);
			changed = true;
		}
	}
	if (!changed) {
		return line;
	}
	checkValueLength(id, tokens);
	return head + tokens.join(",") + cr;
}

/**
 * Applies patch / add / remove operations to the `WDGT#` lines of `text` (byte-per-char string, see the module
 * header), in order. Every other byte is returned unchanged. Throws `RevWriteError`, returning nothing, when any
 * operation is unsafe, so the caller never gets a half-written file.
 */
export function applyWidgetOps(text: string, ops: readonly WidgetOp[]): string {
	const open = text.indexOf("<Config>");
	const close = text.indexOf("</Config>");
	if (open < 0 || close < open) {
		throw new RevWriteError("The file has no <Config> element");
	}
	if (ops.length === 0) {
		return text;
	}
	const start = open + "<Config>".length;
	const lines = text.slice(start, close).split("\n");
	const cr = text.slice(start, close).includes("\r\n") ? "\r" : "";
	const indexesOf = (id: number): number[] => lines.flatMap((l, i) => (Number(WDGT_LINE.exec(l)?.[1]) === id ? [i] : []));
	const unique = (id: number): number => {
		const at = indexesOf(id);
		if (at.length === 0) {
			return fail(id, "does not exist in the file");
		}
		if (at.length > 1) {
			return fail(id, "appears more than once; refusing to guess which one to edit");
		}
		return at[0];
	};

	for (const op of ops) {
		if (op.kind === "patch") {
			const i = unique(op.id);
			lines[i] = patchFields(op.id, lines[i], op.fields);
		} else if (op.kind === "remove") {
			const i = unique(op.id);
			lines.splice(i, 1);
			if (i === lines.length && i > 0) {
				// The removed line had no terminator of its own: the one before it was the previous line's.
				lines[i - 1] = lines[i - 1].replace(/\r$/, "");
			}
		} else {
			checkId(op.id);
			if (indexesOf(op.id).length > 0) {
				fail(op.id, "the id is already used");
			}
			const type = Number(op.tokens[0]);
			const def = widgetTypeDef(type);
			if (!def || def.legacy) {
				fail(op.id, `cannot add a widget of type ${String(op.tokens[0])}`);
			}
			if (op.tokens.length !== def!.tokenCount) {
				fail(op.id, `type ${type} needs ${def!.tokenCount} tokens, got ${op.tokens.length}`);
			}
			const tokens = op.tokens.map(String);
			tokens.forEach((t, i) => {
				const why = i === 0 ? undefined : checkWidgetToken(type, i, t);
				if (why) {
					fail(op.id, why);
				}
			});
			const written = tokens.map((t) => toBytes(escapeXml(t)));
			checkValueLength(op.id, written);
			const row = `WDGT#${op.id}=${written.join(",")}`;
			const last = lines.reduce((acc, l, i) => (WDGT_LINE.test(l) ? i : acc), -1);
			const at = last >= 0 ? last : lines.length - 1;
			if (at === lines.length - 1 && (last >= 0 || lines[at].trim() !== "")) {
				lines[at] += cr;
				lines.push(row);
			} else if (last >= 0) {
				lines.splice(last + 1, 0, row + cr);
			} else {
				lines.splice(lines.length - 1, 0, row + cr);
			}
		}
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
