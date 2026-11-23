/** Schema, validation and (de)serialization of the SFC layout sidecar. Pure: no `vscode` imports. */
import type { Pt } from "./sfcGeometry";

export const SIDECAR_VERSION = 1;
/** Sidecar location, relative to the workspace folder (or the project folder when there is none). */
export const SIDECAR_RELATIVE_PATH = ".vscode/irite-sfc.layout.json";

const MAX_COORD = 100000;
const MAX_ENTRIES = 5000;
const MAX_BENDS = 64;
const MAX_KEY = 200;

export interface SavedLink {
	/** Explicit bar position; absent = the bar follows its source step. */
	bar?: Pt;
	before?: Pt[];
	after?: Pt[];
}

export interface SavedDiagram {
	steps: Record<string, Pt>;
	links: Record<string, SavedLink>;
}

export interface SidecarFile {
	version: number;
	diagrams: Record<string, SavedDiagram>;
}

/** iRite identifiers are case-insensitive, so every key is lower-cased. */
export const normName = (name: string): string => name.toLowerCase();

export const stepKey = (step: string): string => normName(step);

/** `transition@source` for a link drawn from a step, `transition` for a "from any step" link. */
export const linkKey = (transition: string, from?: string): string => (from === undefined ? normName(transition) : `${normName(transition)}@${normName(from)}`);

/**
 * Identifies a diagram inside the sidecar: the project folder relative to the sidecar's base folder
 * (posix, `.` for the base itself) plus the enum pair, so two FSMs in one project do not clash.
 */
export function diagramKey(baseDir: string, mainSrc: string, statesEnum = "STATES", transitionsEnum = "TRANSITIONS"): string {
	const norm = (p: string): string => p.replace(/\\/g, "/").replace(/\/+$/, "");
	const base = norm(baseDir);
	const dir = norm(mainSrc).split("/").slice(0, -1).join("/");
	let rel = ".";
	if (dir.toLowerCase() !== base.toLowerCase()) {
		rel = dir.toLowerCase().startsWith(`${base.toLowerCase()}/`) ? dir.slice(base.length + 1) : dir;
	}
	return `${rel.toLowerCase()}::${normName(statesEnum)}/${normName(transitionsEnum)}`;
}

function sanitizePt(raw: unknown): Pt | undefined {
	const r = raw as { x?: unknown; y?: unknown } | null;
	if (!r || typeof r !== "object" || typeof r.x !== "number" || typeof r.y !== "number" || !Number.isFinite(r.x) || !Number.isFinite(r.y)) {
		return undefined;
	}
	const clamp = (n: number): number => Math.max(-MAX_COORD, Math.min(MAX_COORD, Math.round(n)));
	return { x: clamp(r.x), y: clamp(r.y) };
}

function sanitizePts(raw: unknown): Pt[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	return raw
		.slice(0, MAX_BENDS)
		.map(sanitizePt)
		.filter((p): p is Pt => p !== undefined);
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Validates untrusted data (the file, or a webview message) into a `SavedDiagram`: invalid entries are
 * dropped, coordinates are rounded and clamped, counts are capped, keys are normalized.
 */
export function sanitizeDiagram(raw: unknown): SavedDiagram {
	const out: SavedDiagram = { steps: {}, links: {} };
	if (!isRecord(raw)) {
		return out;
	}
	if (isRecord(raw.steps)) {
		for (const [k, v] of Object.entries(raw.steps).slice(0, MAX_ENTRIES)) {
			const p = sanitizePt(v);
			if (p && k.length > 0 && k.length <= MAX_KEY) {
				out.steps[normName(k)] = p;
			}
		}
	}
	if (isRecord(raw.links)) {
		for (const [k, v] of Object.entries(raw.links).slice(0, MAX_ENTRIES)) {
			if (!isRecord(v) || k.length === 0 || k.length > MAX_KEY) {
				continue;
			}
			const link: SavedLink = {};
			const bar = sanitizePt(v.bar);
			if (bar) {
				link.bar = bar;
			}
			const before = sanitizePts(v.before);
			if (before.length > 0) {
				link.before = before;
			}
			const after = sanitizePts(v.after);
			if (after.length > 0) {
				link.after = after;
			}
			if (Object.keys(link).length > 0) {
				out.links[normName(k)] = link;
			}
		}
	}
	return out;
}

export const isEmptyDiagram = (d: SavedDiagram): boolean => Object.keys(d.steps).length === 0 && Object.keys(d.links).length === 0;

export type ParseResult = { ok: true; file: SidecarFile } | { ok: false; reason: "invalid-json" | "invalid-shape" | "unsupported-version" };

/** Parses sidecar text. Blank text is an empty file; an unknown `version` is refused, never guessed. */
export function parseSidecar(text: string): ParseResult {
	if (text.trim() === "") {
		return { ok: true, file: { version: SIDECAR_VERSION, diagrams: {} } };
	}
	let raw: unknown;
	try {
		raw = JSON.parse(text.replace(/^﻿/, ""));
	} catch {
		return { ok: false, reason: "invalid-json" };
	}
	if (!isRecord(raw) || (raw.diagrams !== undefined && !isRecord(raw.diagrams))) {
		return { ok: false, reason: "invalid-shape" };
	}
	if (raw.version !== SIDECAR_VERSION) {
		return { ok: false, reason: "unsupported-version" };
	}
	const diagrams: Record<string, SavedDiagram> = {};
	const stored = isRecord(raw.diagrams) ? raw.diagrams : {};
	for (const [k, v] of Object.entries(stored)) {
		const d = sanitizeDiagram(v);
		if (!isEmptyDiagram(d)) {
			diagrams[k] = d;
		}
	}
	return { ok: true, file: { version: SIDECAR_VERSION, diagrams } };
}

const sortKeys = <T>(o: Record<string, T>): Record<string, T> => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/** Stable text (sorted keys, 2-space indent, trailing newline) so the file diffs cleanly in git. */
export function serializeSidecar(file: SidecarFile): string {
	const diagrams: Record<string, SavedDiagram> = {};
	for (const [k, d] of Object.entries(sortKeys(file.diagrams))) {
		diagrams[k] = { steps: sortKeys(d.steps), links: sortKeys(d.links) };
	}
	return `${JSON.stringify({ version: SIDECAR_VERSION, diagrams }, null, 2)}\n`;
}

/** Returns a copy of `file` with the diagram stored (or removed when `diagram` is undefined or empty). */
export function withDiagram(file: SidecarFile, key: string, diagram: SavedDiagram | undefined): SidecarFile {
	const diagrams = { ...file.diagrams };
	if (diagram && !isEmptyDiagram(diagram)) {
		diagrams[key] = diagram;
	} else {
		delete diagrams[key];
	}
	return { version: SIDECAR_VERSION, diagrams };
}
