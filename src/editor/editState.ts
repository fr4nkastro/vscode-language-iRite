/**
 * Document model of the screen editor (pure, no `vscode` import): the edits made on top of the `.rev` as it
 * was read (issue #6 L7: always relative to the original bytes). It is immutable; the `CustomEditorProvider`
 * keeps the state before and after each edit so VS Code's undo/redo, dirty tracking and save point work from
 * the platform.
 *
 * Edits: geometry (`geom`), any other catalog field and alias renames of widgets that are in the file
 * (`props`), widgets added in the session (`added`, full token lists) and widgets removed (`removed`). Existing
 * ids never change and the order of lines is not touched, which keeps the written diff to one line per
 * affected widget (`toOps` gives one operation per widget).
 */
import type { RevModel, RevWidget } from "../rev";
import { checkWidgetToken } from "../rev/serialize";
import type { WidgetOp, WidgetPatch } from "../rev/serialize";
import {
	WIDGET_ID_MAX,
	WIDGET_ID_MIN,
	WIDGET_VALUE_MAX,
	geometryFields,
	newWidgetTokens,
	tokenIndexOf,
	widgetFieldByName,
	widgetFieldByRole,
	widgetTypeDef,
} from "../rev/widgetCatalog";
import type { WidgetField } from "../rev/widgetCatalog";
import { editorMath } from "./editorMath";
import { displayAlias, nextFreeId, pickDefaultAlias, validateAlias } from "./widgetRules";

export interface Geometry {
	x: number;
	y: number;
	width?: number;
	height?: number;
}

/** Full effective geometry of the widgets that differ from the file, keyed by widget id. */
export interface EditState {
	geom: Record<number, Geometry>;
	/** Changed non-geometry fields of widgets in the file, by catalog field name (decoded text values). */
	props: Record<number, Record<string, string>>;
	/** Widgets added in the session: id to the whole token list (type code first). */
	added: Record<number, string[]>;
	/** Ids of widgets of the file that are deleted; ascending. */
	removed: number[];
}

/** What the page may ask for: loose numbers that are validated, rounded and clamped here. */
export interface GeometryPatch {
	x?: number;
	y?: number;
	w?: number;
	h?: number;
}

export type SetResult = { ok: true; state: EditState; geometry: Geometry } | { ok: false; reason: string };

export function emptyEditState(): EditState {
	return { geom: {}, props: {}, added: {}, removed: [] };
}

/** Widgets of these types store a size; scale (1) and symbol (6) store only a position. */
export function hasSize(w: RevWidget): boolean {
	return w.width !== undefined && w.height !== undefined;
}

export function originalGeometry(w: RevWidget): Geometry {
	return { x: w.x ?? 0, y: w.y ?? 0, ...(hasSize(w) ? { width: w.width, height: w.height } : {}) };
}

export function effectiveGeometry(w: RevWidget, state: EditState): Geometry {
	return state.geom[w.id] ?? originalGeometry(w);
}

const same = (a: Geometry, b: Geometry): boolean => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

const clampInt = (n: number): number => Math.max(editorMath.COORD_MIN, Math.min(editorMath.COORD_MAX, Math.round(n)));

/** Applies `patch` to widget `id`. Dropping back to the file's geometry removes the entry (document clean again). */
export function setGeometry(state: EditState, rev: RevModel, id: number, patch: GeometryPatch): SetResult {
	for (const [k, v] of Object.entries(patch)) {
		if (v !== undefined && !isNum(v)) {
			return { ok: false, reason: `${k} is not a number` };
		}
	}
	if (state.added[id]) {
		return setGeometryAdded(state, id, patch);
	}
	const w = rev.widgets.find((x) => x.id === id);
	if (!w || w.x === undefined || w.y === undefined || state.removed.includes(id)) {
		return { ok: false, reason: `Widget ${id} cannot be edited` };
	}
	if ((patch.w !== undefined || patch.h !== undefined) && !hasSize(w)) {
		return { ok: false, reason: `Widget ${id} (type ${w.type}) does not store a size` };
	}
	const cur = effectiveGeometry(w, state);
	const next: Geometry = {
		x: patch.x !== undefined ? clampInt(patch.x) : cur.x,
		y: patch.y !== undefined ? clampInt(patch.y) : cur.y,
		...(hasSize(w)
			? {
					width: patch.w !== undefined ? Math.max(editorMath.MIN_SIZE, clampInt(patch.w)) : cur.width,
					height: patch.h !== undefined ? Math.max(editorMath.MIN_SIZE, clampInt(patch.h)) : cur.height,
				}
			: {}),
	};
	const geom = { ...state.geom };
	if (same(next, originalGeometry(w))) {
		delete geom[id];
	} else {
		geom[id] = next;
	}
	return { ok: true, state: { ...state, geom }, geometry: next };
}

function setGeometryAdded(state: EditState, id: number, patch: GeometryPatch): SetResult {
	const tokens = [...state.added[id]];
	const type = Number(tokens[0]);
	const gf = geometryFields(type);
	if (!gf) {
		return { ok: false, reason: `Widget ${id} cannot be edited` };
	}
	if ((patch.w !== undefined || patch.h !== undefined) && gf.width === undefined) {
		return { ok: false, reason: `Widget ${id} (type ${type}) does not store a size` };
	}
	if (patch.x !== undefined) tokens[gf.x] = String(clampInt(patch.x));
	if (patch.y !== undefined) tokens[gf.y] = String(clampInt(patch.y));
	if (patch.w !== undefined && gf.width !== undefined) tokens[gf.width] = String(Math.max(editorMath.MIN_SIZE, clampInt(patch.w)));
	if (patch.h !== undefined && gf.height !== undefined) tokens[gf.height] = String(Math.max(editorMath.MIN_SIZE, clampInt(patch.h)));
	const geometry: Geometry = {
		x: Number(tokens[gf.x]),
		y: Number(tokens[gf.y]),
		...(gf.width !== undefined && gf.height !== undefined ? { width: Number(tokens[gf.width]), height: Number(tokens[gf.height]) } : {}),
	};
	return { ok: true, state: { ...state, added: { ...state.added, [id]: tokens } }, geometry };
}

export function isDirty(rev: RevModel, state: EditState): boolean {
	return toOps(rev, state).length > 0;
}

/** Serializer patches for the widgets whose geometry differs from the file; ascending by id. */
export function toPatches(rev: RevModel, state: EditState): WidgetPatch[] {
	const out: WidgetPatch[] = [];
	for (const w of rev.widgets) {
		const g = state.geom[w.id];
		if (g && !same(g, originalGeometry(w))) {
			out.push({ id: w.id, x: g.x, y: g.y, ...(g.width !== undefined ? { width: g.width } : {}), ...(g.height !== undefined ? { height: g.height } : {}) });
		}
	}
	return out.sort((a, b) => a.id - b.id);
}

/** The widgets as they look with the edits applied (same order as `widgets`). */
export function withEdits<T extends RevWidget>(widgets: readonly T[], state: EditState): T[] {
	return widgets.map((w) => {
		const g = state.geom[w.id];
		return g ? { ...w, x: g.x, y: g.y, ...(g.width !== undefined ? { width: g.width } : {}), ...(g.height !== undefined ? { height: g.height } : {}) } : w;
	});
}

export function editLabel(w: Pick<RevWidget, "id">, patch: GeometryPatch): string {
	const moves = patch.x !== undefined || patch.y !== undefined;
	const sizes = patch.w !== undefined || patch.h !== undefined;
	return `${moves && sizes ? "Edit" : sizes ? "Resize" : "Move"} widget ${w.id}`;
}

export type EditResult = { ok: true; state: EditState } | { ok: false; reason: string };

/** A widget as it is with the edits applied: tokens (type code first), screen and the alias `main.iri` gets. */
export interface EffectiveWidget {
	id: number;
	type: number;
	tokens: string[];
	screen?: number;
	/** Stored alias, or the derived `line<id>`/`sk<id>`; undefined for scale and unknown types. */
	alias?: string;
	added: boolean;
}

const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

/** Sets catalog fields (by name) in `tokens`; a caption spread over several tokens is replaced as a whole. */
function applyFields(type: number, tokens: string[], fields: Record<string, string>): void {
	const def = widgetTypeDef(type);
	for (const [name, value] of Object.entries(fields)) {
		const idx = tokenIndexOf(type, tokens.length, name);
		if (idx === undefined || idx < 1) {
			continue;
		}
		const extra = def && (type === 4 || type === 11) ? tokens.length - def.tokenCount : 0;
		if (name === "caption" && extra > 0) {
			tokens.splice(5, 1 + extra, value);
		} else if (idx < tokens.length) {
			tokens[idx] = value;
		}
	}
}

function geomFields(type: number, g: Geometry): Record<string, string> {
	const out: Record<string, string> = { x: String(g.x), y: String(g.y) };
	if (g.width !== undefined) out[widgetFieldByRole(type, "width")?.name ?? "width"] = String(g.width);
	if (g.height !== undefined) out[widgetFieldByRole(type, "height")?.name ?? "height"] = String(g.height);
	return out;
}

function describe(id: number, type: number, tokens: string[], added: boolean): EffectiveWidget {
	const ai = widgetTypeDef(type)?.aliasPersisted ? tokenIndexOf(type, tokens.length, "alias") : undefined;
	const si = tokenIndexOf(type, tokens.length, "screen");
	const screen = si !== undefined && /^\d+$/.test(tokens[si] ?? "") ? Number(tokens[si]) : undefined;
	return { id, type, tokens, ...(screen !== undefined ? { screen } : {}), alias: displayAlias(type, id, ai === undefined ? undefined : tokens[ai]), added };
}

/** Every widget with the edits applied: widgets of the file (file order, deleted ones left out), then added ones by id. */
export function effectiveWidgets(rev: RevModel, state: EditState): EffectiveWidget[] {
	const out: EffectiveWidget[] = [];
	for (const w of rev.widgets) {
		if (state.removed.includes(w.id)) {
			continue;
		}
		const tokens = [...w.tokens];
		const g = state.geom[w.id];
		applyFields(w.type, tokens, { ...(g ? geomFields(w.type, g) : {}), ...(state.props[w.id] ?? {}) });
		out.push(describe(w.id, w.type, tokens, false));
	}
	for (const id of Object.keys(state.added).map(Number).sort((a, b) => a - b)) {
		const t = state.added[id];
		out.push(describe(id, Number(t[0]), t, true));
	}
	return out;
}

/** The widget list as `main.iri` sees it: widgets that have an alias there (shared by the screen editor and the CLI). */
export function aliasEntries(rev: RevModel, state: EditState): Array<{ id: number; alias: string }> {
	return effectiveWidgets(rev, state).flatMap((w) => (w.alias ? [{ id: w.id, alias: w.alias }] : []));
}

function lineTooLong(id: number, tokens: readonly string[]): string | undefined {
	const n = tokens.join(",").length;
	return n > WIDGET_VALUE_MAX ? `Widget ${id}: the line would have ${n} characters, the maximum is ${WIDGET_VALUE_MAX}` : undefined;
}

const COLOR = /^(#[0-9A-Fa-f]{6}|[A-Za-z]+)$/;
const IMAGE = /^(local:\/\/\d+\.(png|svg)|[^\\/:*?"<>|]*)$/i;

/** Validated, normalized token text for `f`, or the reason it cannot be written. */
function fieldValue(type: number, f: WidgetField, value: string | number): { v: string } | { error: string } {
	let v = String(value);
	const numeric = f.kind === "int" || f.kind === "enum" || f.kind === "screen";
	if (numeric) {
		v = v.trim();
	}
	const why = checkWidgetToken(type, f.name, v);
	if (why) {
		return { error: why };
	}
	if (numeric) {
		return { v: String(Number(v)) };
	}
	if (f.maxLength !== undefined && v.length > f.maxLength) {
		return { error: `"${f.name}" is at most ${f.maxLength} characters` };
	}
	if (f.kind === "color" && !COLOR.test(v)) {
		return { error: `"${f.name}" must be a color name or #RRGGBB` };
	}
	if (f.kind === "image" && !IMAGE.test(v)) {
		return { error: `"${f.name}" must be a file name of sdimages/ or local://N.png` };
	}
	return { v };
}

function withField(state: EditState, rev: RevModel, w: EffectiveWidget, name: string, v: string): EditResult {
	if (w.added) {
		const tokens = [...state.added[w.id]];
		applyFields(w.type, tokens, { [name]: v });
		const long = lineTooLong(w.id, tokens);
		return long ? fail(long) : { ok: true, state: { ...state, added: { ...state.added, [w.id]: tokens } } };
	}
	const orig = rev.widgets.find((x) => x.id === w.id);
	const props = { ...(state.props[w.id] ?? {}) };
	if (orig && orig.props[name] === v) {
		delete props[name];
	} else {
		props[name] = v;
	}
	const all = { ...state.props };
	if (Object.keys(props).length === 0) {
		delete all[w.id];
	} else {
		all[w.id] = props;
	}
	const next = { ...state, props: all };
	const eff = effectiveWidgets(rev, next).find((x) => x.id === w.id);
	const long = eff ? lineTooLong(w.id, eff.tokens) : undefined;
	return long ? fail(long) : { ok: true, state: next };
}

const GEOM_KEY: Record<string, "x" | "y" | "w" | "h"> = { x: "x", y: "y", width: "w", height: "h" };

/** Sets one editable catalog field (by name) of widget `id`. Aliases go through `renameAlias`. */
export function setProp(state: EditState, rev: RevModel, id: number, field: string, value: string | number): SetResult | EditResult {
	const w = effectiveWidgets(rev, state).find((x) => x.id === id);
	if (!w) {
		return fail(`Widget ${id} does not exist`);
	}
	const f = widgetFieldByName(w.type, field);
	if (!f || !f.editable) {
		return fail(`"${field}" is not an editable field of type ${w.type}`);
	}
	if (f.kind === "alias") {
		return fail("use renameAlias to change an alias");
	}
	const key = f.role ? GEOM_KEY[f.role] : undefined;
	if (key) {
		const n = typeof value === "number" ? value : Number(String(value).trim());
		return typeof value === "string" && value.trim() === "" ? fail(`"${field}" is not a number`) : setGeometry(state, rev, id, { [key]: n });
	}
	const r = fieldValue(w.type, f, value);
	return "error" in r ? fail(r.error) : withField(state, rev, w, f.name, r.v);
}

/** Changes the alias of widget `id`: iRite identifier, at most 8 characters, unique ignoring case. */
export function renameAlias(state: EditState, rev: RevModel, id: number, alias: string): EditResult {
	const all = effectiveWidgets(rev, state);
	const w = all.find((x) => x.id === id);
	if (!w) {
		return fail(`Widget ${id} does not exist`);
	}
	const def = widgetTypeDef(w.type);
	if (!def?.aliasPersisted) {
		return fail(def?.hasAlias ? `The alias of type ${w.type} is derived from the id and not stored in the .rev` : `A widget of type ${w.type} has no alias`);
	}
	const why = validateAlias(alias, all.filter((x) => x.id !== id && x.alias).map((x) => x.alias as string));
	return why ? fail(why) : withField(state, rev, w, "alias", alias);
}

export interface NewWidget {
	type: number;
	/** Authored 7" pixels. */
	x: number;
	y: number;
	screen: number;
}

/** Why `tokens` is not a writable new widget line; undefined when it is. Alias uniqueness is checked against `taken`. */
function tokensError(id: number, tokens: readonly string[], taken: readonly string[]): string | undefined {
	const type = Number(tokens[0]);
	const def = widgetTypeDef(type);
	if (!def || def.legacy || String(type) !== tokens[0]) {
		return `Widgets of type ${String(tokens[0])} cannot be added`;
	}
	if (tokens.length !== def.tokenCount) {
		return `Type ${type} needs ${def.tokenCount} tokens`;
	}
	for (const f of def.fields) {
		if (f.index === 0) continue;
		const t = tokens[f.index];
		let why: string | undefined;
		if (f.kind === "alias") {
			why = validateAlias(t, taken);
		} else if (f.editable) {
			const r = fieldValue(type, f, t);
			why = "error" in r ? r.error : undefined;
		} else {
			why = checkWidgetToken(type, f.index, t);
		}
		if (why) {
			return why;
		}
	}
	return lineTooLong(id, tokens);
}

export type AddResult = { ok: true; state: EditState; id: number; tokens: string[] } | { ok: false; reason: string };

/** Adds a widget with the catalog defaults at (x, y) of `screen`, with the lowest free id (ids of deleted widgets stay taken). */
export function addWidget(state: EditState, rev: RevModel, n: NewWidget): AddResult {
	const def = widgetTypeDef(n.type);
	if (!def || def.legacy) {
		return fail(`Widgets of type ${n.type} cannot be added`);
	}
	if (!Number.isInteger(n.screen) || n.screen < 1 || n.screen > 99 || !isNum(n.x) || !isNum(n.y)) {
		return fail("A new widget needs a screen from 1 to 99 and a position");
	}
	const all = effectiveWidgets(rev, state);
	if (n.type === 9 && all.some((w) => w.type === 9 && w.screen === n.screen)) {
		return fail(`Screen ${n.screen} already has a softkey widget (one per screen)`);
	}
	const id = nextFreeId([...rev.widgets.map((w) => w.id), ...Object.keys(state.added).map(Number)]);
	if (id === undefined) {
		return fail(`All widget ids ${WIDGET_ID_MIN}..${WIDGET_ID_MAX} are used`);
	}
	const taken = all.flatMap((w) => (w.alias ? [w.alias] : []));
	const tokens = newWidgetTokens(n.type, { id, screen: n.screen, x: clampInt(n.x), y: clampInt(n.y) });
	if (!tokens) {
		return fail(`Widgets of type ${n.type} cannot be added`);
	}
	if (def.aliasPersisted) {
		const alias = pickDefaultAlias(n.type, id, taken);
		if (!alias) {
			return fail(`No free default alias for id ${id}; rename an existing alias first`);
		}
		tokens[tokenIndexOf(n.type, tokens.length, "alias") as number] = alias;
	}
	const why = tokensError(id, tokens, taken);
	return why ? fail(why) : { ok: true, state: { ...state, added: { ...state.added, [id]: tokens } }, id, tokens };
}

/** Deletes widget `id` (an added one just disappears); pending edits of it are dropped. */
export function deleteWidget(state: EditState, rev: RevModel, id: number): EditResult {
	if (state.added[id]) {
		const added = { ...state.added };
		delete added[id];
		return { ok: true, state: { ...state, added } };
	}
	if (!rev.widgets.some((w) => w.id === id) || state.removed.includes(id)) {
		return fail(`Widget ${id} does not exist`);
	}
	const geom = { ...state.geom };
	const props = { ...state.props };
	delete geom[id];
	delete props[id];
	return { ok: true, state: { geom, props, added: state.added, removed: [...state.removed, id].sort((a, b) => a - b) } };
}

/**
 * Widget operations for the serializer, one per affected widget: patches (geometry and fields merged) by id,
 * then removals, then additions.
 */
export function toOps(rev: RevModel, state: EditState): WidgetOp[] {
	const ops: WidgetOp[] = [];
	const patches = new Map(toPatches(rev, state).map((p) => [p.id, p]));
	for (const w of rev.widgets) {
		const p = patches.get(w.id);
		const fields: Record<string, string | number> = {
			...(p ? { x: p.x as number, y: p.y as number, ...(p.width !== undefined ? { width: p.width } : {}), ...(p.height !== undefined ? { height: p.height } : {}) } : {}),
			...(state.props[w.id] ?? {}),
		};
		if (!state.removed.includes(w.id) && Object.keys(fields).length > 0) {
			ops.push({ kind: "patch", id: w.id, fields });
		}
	}
	ops.sort((a, b) => a.id - b.id);
	for (const id of state.removed) {
		ops.push({ kind: "remove", id });
	}
	for (const id of Object.keys(state.added).map(Number).sort((a, b) => a - b)) {
		ops.push({ kind: "add", id, tokens: state.added[id] });
	}
	return ops;
}

export function serializeEditState(state: EditState): string {
	return JSON.stringify(state);
}

/** Restores a hot-exit backup by replaying it through the same operations; entries that no longer apply are dropped. */
export function parseEditState(raw: unknown, rev: RevModel): EditState {
	let state = emptyEditState();
	const r = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as { geom?: unknown; props?: unknown; added?: unknown; removed?: unknown };
	const entries = (v: unknown): Array<[string, unknown]> => (v && typeof v === "object" && !Array.isArray(v) ? Object.entries(v as Record<string, unknown>) : []);
	for (const [key, tokens] of entries(r.added)) {
		const id = Number(key);
		const taken = effectiveWidgets(rev, state).flatMap((w) => (w.alias ? [w.alias] : []));
		if (
			Array.isArray(tokens) &&
			tokens.every((t) => typeof t === "string") &&
			Number.isInteger(id) &&
			id >= WIDGET_ID_MIN &&
			id <= WIDGET_ID_MAX &&
			!rev.widgets.some((w) => w.id === id) &&
			!tokensError(id, tokens as string[], taken)
		) {
			state = { ...state, added: { ...state.added, [id]: tokens as string[] } };
		}
	}
	for (const [key, fields] of entries(r.props)) {
		for (const [name, value] of entries(fields)) {
			if (typeof value !== "string") continue;
			const res = name === "alias" ? renameAlias(state, rev, Number(key), value) : setProp(state, rev, Number(key), name, value);
			if (res.ok) state = res.state;
		}
	}
	for (const [key, value] of entries(r.geom)) {
		const v = value as Record<string, unknown> | null;
		if (!v || typeof v !== "object") {
			continue;
		}
		const res = setGeometry(state, rev, Number(key), { x: v.x as number, y: v.y as number, w: v.width as number | undefined, h: v.height as number | undefined });
		if (res.ok) {
			state = res.state;
		}
	}
	for (const id of Array.isArray(r.removed) ? r.removed : []) {
		const res = typeof id === "number" ? deleteWidget(state, rev, id) : undefined;
		if (res?.ok) state = res.state;
	}
	return state;
}

/** Ids whose effective geometry differs between two states; ascending. Used to sync the page after undo/redo. */
export function changedIds(a: EditState, b: EditState): number[] {
	const ids = new Set([...Object.keys(a.geom), ...Object.keys(b.geom)].map(Number));
	return [...ids].filter((id) => JSON.stringify(a.geom[id]) !== JSON.stringify(b.geom[id])).sort((x, y) => x - y);
}

/** True when fields, added widgets or deletions differ: the page must be rebuilt, a geometry `sync` is not enough. */
export function structuralChanged(a: EditState, b: EditState): boolean {
	return JSON.stringify([a.props, a.added, a.removed]) !== JSON.stringify([b.props, b.added, b.removed]);
}
