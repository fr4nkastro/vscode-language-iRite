/**
 * Reader for Rice Lake Revolution `.rev` files (1280 model).
 * Pure module: no `vscode` import. This file only reads; the single, opt-in
 * write path (widget x/y/width/height) lives in `./serialize` and is lossless.
 */

import { propsOf, widgetTypeDef } from "./widgetCatalog";

export interface RevHeader {
	revision?: string;
	indicatorModel?: string;
	indicatorVersion?: string;
	childAssembly?: string;
	/** Raw space-separated byte list, untouched. */
	configHash?: string;
	codFile?: string;
}

export interface ConfigEntry {
	key: string;
	index?: number;
	value: string;
	/** 1-based line in the (BOM-stripped) file. */
	line: number;
}

export type WidgetTypeName =
	| "scale"
	| "bitmap"
	| "bargraph"
	| "label"
	| "numeric"
	| "symbol"
	| "image"
	| "chart"
	| "softkey"
	| "line"
	| "monolabel"
	| "unknown";

export interface RevWidget {
	id: number;
	/** Every token of the value as written (type code first), entity-decoded; extra and unknown tokens included. */
	tokens: string[];
	/** Named raw string tokens by catalog field name (`{}` for types the catalog does not know). */
	props: Record<string, string>;
	type: number;
	typeName: WidgetTypeName;
	screen?: number;
	x?: number;
	y?: number;
	/** Undefined for types whose size is not stored (1 scale, 6 symbol). */
	width?: number;
	height?: number;
	alias?: string;
	text?: string;
	fontSize?: number;
	color?: string;
	foreground?: string;
	background?: string;
	image?: string;
	/** Comma-split fields of the value (type number first), entity-decoded. */
	raw: string[];
	line: number;
}

export interface RevScreen {
	number: number;
	widgetIds: number[];
}

export type DbTypeName = "integer" | "real" | "string" | "datetime" | "unknown";

export interface RevDbField {
	name: string;
	typeCode: number;
	typeName: DbTypeName;
	size: number;
}

export interface RevDatabase {
	index: number;
	name: string;
	maxRecords: number;
	fields: RevDbField[];
}

export type AliasKind = "scale" | "setpoint" | "port" | "dio" | "widget";

export interface RevAlias {
	kind: AliasKind;
	name: string;
	/** Scale/setpoint/port number, DIO bit, or widget id. */
	index: number;
	/** DIO card (only for `dio`). */
	card?: number;
}

export interface RevDiagnostic {
	line: number;
	message: string;
}

export interface RevCustomData {
	hash?: string;
	/** Decoded text of `<Printers>`, CR stripped. */
	printers: string;
}

export interface RevModel {
	header: RevHeader;
	config: ConfigEntry[];
	widgets: RevWidget[];
	screens: RevScreen[];
	databases: RevDatabase[];
	aliases: RevAlias[];
	customData: RevCustomData;
	diagnostics: RevDiagnostic[];
}

const NAMED_ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
	return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, e: string) => {
		if (e[0] === "#") {
			const code = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
			try {
				return String.fromCodePoint(code);
			} catch {
				return m;
			}
		}
		return NAMED_ENTITIES[e] ?? m;
	});
}

function headerValue(text: string, name: string): string | undefined {
	const m = new RegExp(`<${name}\\s+value="([^"]*)"\\s*/?>`).exec(text);
	return m ? decodeEntities(m[1]) : undefined;
}

function lineOf(text: string, offset: number): number {
	let n = 1;
	for (let i = 0; i < offset; i++) {
		if (text.charCodeAt(i) === 10) {
			n++;
		}
	}
	return n;
}

function num(s: string | undefined): number | undefined {
	if (s === undefined || s.trim() === "" || !/^-?\d+(\.\d+)?$/.test(s.trim())) {
		return undefined;
	}
	return Number(s);
}

function parseConfigLines(text: string, firstLine: number): ConfigEntry[] {
	const out: ConfigEntry[] = [];
	text.split("\n").forEach((rawLine, i) => {
		const line = rawLine.replace(/\r$/, "");
		const eq = line.indexOf("=");
		if (eq <= 0) {
			return;
		}
		let key = line.slice(0, eq);
		let index: number | undefined;
		const hash = key.lastIndexOf("#");
		if (hash > 0) {
			index = num(key.slice(hash + 1));
			if (index !== undefined) {
				key = key.slice(0, hash);
			}
		}
		out.push({ key, ...(index !== undefined ? { index } : {}), value: decodeEntities(line.slice(eq + 1)), line: firstLine + i });
	});
	return out;
}

/** Records are `type,field,...`. `type 4` text may contain commas (see parseWidget). */
function parseWidget(entry: ConfigEntry, diagnostics: RevDiagnostic[]): RevWidget {
	const id = entry.index as number;
	const f = entry.value.split(",");
	const type = Number(f[0]);
	const base: RevWidget = { id, type: Number.isFinite(type) ? type : -1, typeName: "unknown", tokens: f, props: propsOf(type, f), raw: f, line: entry.line };
	const bad = (why: string): RevWidget => {
		diagnostics.push({ line: entry.line, message: `WDGT#${id}: ${why}; kept as unknown` });
		return base;
	};
	const box = (): Partial<RevWidget> => ({ x: num(f[1]), y: num(f[2]), width: num(f[3]), height: num(f[4]) });
	const need = (n: number): boolean => f.length >= n;
	const layout = (name: string, n: number) => `type ${type} (${name}) needs ${n} fields, got ${f.length}`;

	switch (type) {
		case 1:
			// 1,x,y,?,?,screen,fg,bg  (size comes from the scale format, not stored)
			if (!need(8)) {
				return bad(layout("scale", 8));
			}
			return { ...base, typeName: "scale", x: num(f[1]), y: num(f[2]), screen: num(f[5]), foreground: f[6], background: f[7] };
		case 3:
			// 3,x,y,w,h,?,?,?,?,color,alias,?,0,0,?,screen
			if (!need(16)) {
				return bad(layout("bargraph", 16));
			}
			return { ...base, typeName: "bargraph", ...box(), color: f[9], alias: f[10] || undefined, screen: num(f[15]) };
		case 4: {
			// 4,x,y,w,h,<text>,?,?,fontSize,color,alias,?,0,0,?,screen
			// Text may contain commas, so parse from both ends: 5 leading fields,
			// then text, then a fixed tail of 10 fields.
			if (!need(16)) {
				return bad(layout("label", 16));
			}
			const tail = f.slice(f.length - 10);
			const text = f.slice(5, f.length - 10).join(",");
			return { ...base, typeName: "label", ...box(), text, fontSize: num(tail[2]), color: tail[3], alias: tail[4] || undefined, screen: num(tail[9]) };
		}
		case 6:
			// 6,x,y,?,?,?,alias,screen,...  (layout partly unknown; size not stored)
			if (!need(8)) {
				return bad(layout("symbol", 8));
			}
			return { ...base, typeName: "symbol", x: num(f[1]), y: num(f[2]), alias: f[6] || undefined, screen: num(f[7]) };
		case 7:
			// 7,x,y,w,h,?,?,0,file,screen,alias
			if (!need(11)) {
				return bad(layout("image", 11));
			}
			return { ...base, typeName: "image", ...box(), image: f[8], screen: num(f[9]), alias: f[10] || undefined };
		case 10:
			// 10,x,y,w,thickness,?,?,color,screen
			if (!need(9)) {
				return bad(layout("line", 9));
			}
			return { ...base, typeName: "line", ...box(), color: f[7], screen: num(f[8]) };
		case 2:
		case 5:
		case 8:
		case 9:
		case 11:
			return fromCatalog(base, type, f, bad, layout);
		default:
			return bad(`unknown widget type ${f[0]}`);
	}
}

const CATALOG_NAMES: Record<number, WidgetTypeName> = { 2: "bitmap", 5: "numeric", 8: "chart", 9: "softkey", 11: "monolabel" };

const int = (s: string | undefined): number | undefined => (s !== undefined && /^-?\d+$/.test(s.trim()) ? Number(s) : undefined);

/** Types read through the catalog (named properties): geometry, screen, alias, caption, font and colors. */
function fromCatalog(
	base: RevWidget,
	type: number,
	f: string[],
	bad: (why: string) => RevWidget,
	layout: (name: string, n: number) => string,
): RevWidget {
	const def = widgetTypeDef(type);
	const name = CATALOG_NAMES[type];
	if (!def || !name) {
		return bad(`unknown widget type ${f[0]}`);
	}
	if (f.length < def.tokenCount) {
		return bad(layout(name, def.tokenCount));
	}
	const p = base.props;
	const out: RevWidget = {
		...base,
		typeName: name,
		x: int(p.x),
		y: int(p.y),
		width: int(p.width),
		height: int(p.height),
		screen: int(p.screen),
		alias: def.aliasPersisted ? p.alias || undefined : undefined,
	};
	if (p.caption !== undefined) {
		out.text = p.caption;
	}
	if (p.fontSize !== undefined) {
		out.fontSize = int(p.fontSize);
	}
	if (p.color !== undefined) {
		out.color = p.color;
		if (type === 9) {
			out.foreground = p.color;
			out.background = p.backgroundColor;
		}
	}
	return out;
}

export function dbTypeName(code: number): DbTypeName {
	// Observed: 2/3 Integer, 4 Real, 6/7 String. Difference within pairs and
	// the existence of a datetime code are unconfirmed.
	switch (code) {
		case 2:
		case 3:
			return "integer";
		case 4:
			return "real";
		case 6:
		case 7:
			return "string";
		default:
			return "unknown";
	}
}

function parseSchema(entry: ConfigEntry, diagnostics: RevDiagnostic[]): { maxRecords: number; fields: RevDbField[] } | undefined {
	const f = entry.value.split(",");
	const maxRecords = num(f[0]);
	if (maxRecords === undefined || (f.length - 2) % 3 !== 0 || f.length < 2) {
		diagnostics.push({ line: entry.line, message: `DB.SCHEMA#${entry.index}: malformed schema "${entry.value}"` });
		return undefined;
	}
	const fields: RevDbField[] = [];
	for (let i = 2; i + 2 < f.length; i += 3) {
		const typeCode = num(f[i + 1]);
		const size = num(f[i + 2]);
		if (typeCode === undefined || size === undefined) {
			diagnostics.push({ line: entry.line, message: `DB.SCHEMA#${entry.index}: bad field "${f[i]}"` });
			continue;
		}
		fields.push({ name: f[i], typeCode, typeName: dbTypeName(typeCode), size });
	}
	return { maxRecords, fields };
}

export function parseRev(input: string): RevModel {
	const text = input.replace(/^\uFEFF/, "");
	const diagnostics: RevDiagnostic[] = [];
	const header: RevHeader = {
		revision: headerValue(text, "Revision"),
		indicatorModel: headerValue(text, "IndicatorModel"),
		indicatorVersion: headerValue(text, "IndicatorVersion"),
		childAssembly: headerValue(text, "ChildAssembly"),
		configHash: headerValue(text, "ConfigHash"),
		codFile: headerValue(text, "CODFile"),
	};
	for (const k of Object.keys(header) as (keyof RevHeader)[]) {
		if (header[k] === undefined) {
			delete header[k];
		}
	}

	let config: ConfigEntry[] = [];
	const cfg = /<Config>([\s\S]*?)<\/Config>/.exec(text);
	if (cfg) {
		config = parseConfigLines(cfg[1], lineOf(text, cfg.index));
	} else {
		diagnostics.push({ line: 1, message: "No <Config> element found" });
	}

	const customData: RevCustomData = { printers: "" };
	const hash = /<CustomHash\s+value="([^"]*)"/.exec(text);
	if (hash) {
		customData.hash = hash[1];
	}
	const printers = /<Printers>([\s\S]*?)<\/Printers>/.exec(text);
	if (printers) {
		customData.printers = decodeEntities(printers[1].replace(/\r/g, ""));
	}

	const widgets: RevWidget[] = [];
	const aliases: RevAlias[] = [];
	const schemas = new Map<number, { maxRecords: number; fields: RevDbField[] }>();
	const dbNames = new Map<number, string>();
	const simple: Record<string, AliasKind> = { "SC.ALIAS": "scale", "SP.ALIAS": "setpoint", "EDP.ALIAS": "port" };

	for (const e of config) {
		if (e.key === "WDGT") {
			if (e.index === undefined) {
				diagnostics.push({ line: e.line, message: "WDGT entry without numeric id" });
				continue;
			}
			widgets.push(parseWidget(e, diagnostics));
		} else if (e.key === "DB.SCHEMA" && e.index !== undefined) {
			const s = parseSchema(e, diagnostics);
			if (s) {
				schemas.set(e.index, s);
			}
		} else if (e.key === "DB.ALIAS" && e.index !== undefined) {
			dbNames.set(e.index, e.value);
		} else if (simple[e.key] && e.index !== undefined && e.value !== "") {
			aliases.push({ kind: simple[e.key], name: e.value, index: e.index });
		} else if (e.key.startsWith("DIO.ALIAS.") && e.index !== undefined && e.value !== "") {
			const bit = num(e.key.slice("DIO.ALIAS.".length));
			if (bit !== undefined) {
				aliases.push({ kind: "dio", name: e.value, index: bit, card: e.index });
			}
		}
	}
	for (const w of widgets) {
		if (w.alias) {
			aliases.push({ kind: "widget", name: w.alias, index: w.id });
		}
	}

	const byScreen = new Map<number, number[]>();
	for (const w of widgets) {
		if (w.screen !== undefined) {
			const ids = byScreen.get(w.screen) ?? [];
			ids.push(w.id);
			byScreen.set(w.screen, ids);
		}
	}
	const screens = [...byScreen.entries()].sort((a, b) => a[0] - b[0]).map(([number, widgetIds]) => ({ number, widgetIds }));

	const databases: RevDatabase[] = [];
	for (const [index, s] of [...schemas.entries()].sort((a, b) => a[0] - b[0])) {
		const name = dbNames.get(index);
		if (name === undefined) {
			diagnostics.push({ line: config.find((c) => c.key === "DB.SCHEMA" && c.index === index)?.line ?? 1, message: `DB.SCHEMA#${index} has no DB.ALIAS` });
		}
		databases.push({ index, name: name ?? "", maxRecords: s.maxRecords, fields: s.fields });
	}

	return { header, config, widgets, screens, databases, aliases, customData, diagnostics };
}

/**
 * Widget image reference → where to find it. `local://N.png` is a device
 * built-in (no file in the project); anything else lives in `sdimages/`.
 * `projectDir` is accepted for API symmetry; the result is project-relative.
 */
export function resolveImage(image: string, _projectDir: string): { kind: "file"; relPath: string } | { kind: "builtin"; id: string } {
	if (image.startsWith("local://")) {
		return { kind: "builtin", id: image.slice("local://".length) };
	}
	const name = image.split(/[\\/]/).pop() ?? image;
	return { kind: "file", relPath: `sdimages/${name}` };
}
