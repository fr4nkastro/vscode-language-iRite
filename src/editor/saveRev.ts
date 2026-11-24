/**
 * The save pipeline of the screen editor as a pure function (no `vscode` import): original bytes plus the
 * edit state (or widget operations) in, new bytes out, with a post-condition check so a bug can never reach the
 * disk.
 *
 * Every save that changes the Config text recomputes the `ConfigHash` header (Revolution compares it on load).
 * That header line is the only non-WDGT line that may change.
 */
import { parseRev } from "../rev";
import type { RevModel } from "../rev";
import { computeConfigHash, readConfigHash, rewriteConfigHash } from "../rev/configHash";
import { RevWriteError, applyWidgetOps } from "../rev/serialize";
import type { WidgetOp } from "../rev/serialize";
import { tokenIndexOf } from "../rev/widgetCatalog";
import { toOps, toPatches } from "./editState";
import type { EditState } from "./editState";

export interface SavePlan {
	/** Bytes to write (BOM, line endings and every untouched byte identical to the original). */
	bytes: Buffer;
	/** Ids of the widgets whose line changed. */
	changed: number[];
	/** Ids of the widgets whose line was appended. */
	added: number[];
	/** Ids of the widgets whose line was removed. */
	removed: number[];
	/** The ConfigHash header was rewritten (false when it already had the right value). */
	hashChanged: boolean;
	/** The model of `bytes`. */
	model: RevModel;
}

const WDGT = /^WDGT#(\d+)=/;

function widgetLines(lines: readonly string[]): Map<number, string> {
	const m = new Map<number, string>();
	for (const l of lines) {
		const id = WDGT.exec(l)?.[1];
		if (id !== undefined) {
			m.set(Number(id), l);
		}
	}
	return m;
}

/**
 * Returns undefined when there is nothing to write (the file must then stay byte-identical, so the caller
 * must not touch it). Throws `RevWriteError` when the result would not be exactly what was requested.
 */
export function planSaveOps(original: Buffer, ops: readonly WidgetOp[]): SavePlan | undefined {
	const originalText = original.toString("latin1");
	const patched = applyWidgetOps(originalText, ops);
	if (patched === originalText) {
		return undefined;
	}
	const text = rewriteConfigHash(patched);
	const bytes = Buffer.from(text, "latin1");

	// What the operations should have done to the set of ids.
	const before = parseRev(original.toString("utf8"));
	const present = new Set(before.widgets.map((w) => w.id));
	const started = new Set(present);
	const patchedIds = new Set<number>();
	const addedAny = new Set<number>();
	for (const op of ops) {
		if (op.kind === "add") {
			present.add(op.id);
			addedAny.add(op.id);
		} else if (op.kind === "remove") {
			present.delete(op.id);
		} else {
			patchedIds.add(op.id);
		}
	}

	const a = originalText.split("\n");
	const b = text.split("\n");
	const wa = widgetLines(a);
	const wb = widgetLines(b);
	const removed = [...wa.keys()].filter((id) => !wb.has(id)).sort((x, y) => x - y);
	const added = [...wb.keys()].filter((id) => !wa.has(id)).sort((x, y) => x - y);
	const changed = [...wb.keys()].filter((id) => wa.has(id) && wa.get(id) !== wb.get(id)).sort((x, y) => x - y);
	const fail = (why: string): never => {
		throw new RevWriteError(`Post-check failed: ${why}; nothing was written`);
	};
	if (removed.join() !== [...started].filter((id) => !present.has(id)).sort((x, y) => x - y).join()) {
		fail("the removed widget lines are not the requested ones");
	}
	if (added.join() !== [...present].filter((id) => !started.has(id)).sort((x, y) => x - y).join()) {
		fail("the added widget lines are not the requested ones");
	}
	if (changed.some((id) => !patchedIds.has(id) && !addedAny.has(id))) {
		fail("a widget line changed that was not edited");
	}
	// Everything but the touched widget lines and the ConfigHash header must be identical, in the same order.
	const touched = new Set([...removed, ...added, ...changed]);
	const skeleton = (lines: readonly string[]): string =>
		lines.filter((l) => !l.includes("<ConfigHash") && !(WDGT.test(l) && touched.has(Number(WDGT.exec(l)?.[1])))).join("\n");
	if (skeleton(a) !== skeleton(b)) {
		fail("a line other than the edited widgets and the ConfigHash header changed");
	}
	if (readConfigHash(text) !== undefined && readConfigHash(text) !== computeConfigHash(text)) {
		fail("the ConfigHash header does not match the new Config text");
	}

	// The model must show exactly the requested values.
	const after = parseRev(bytes.toString("utf8"));
	if (after.widgets.length !== present.size || after.widgets.some((w) => !present.has(w.id))) {
		fail("the widget set is not the expected one");
	}
	for (const op of ops) {
		const w = after.widgets.find((x) => x.id === op.id);
		if (op.kind === "remove") {
			if (w && !ops.some((o) => o.kind === "add" && o.id === op.id)) {
				fail(`WDGT#${op.id} is still there`);
			}
		} else if (op.kind === "add") {
			if (w && w.tokens.join(",") !== op.tokens.map(String).join(",")) {
				fail(`WDGT#${op.id} was not written as requested`);
			}
		} else if (w) {
			for (const [key, value] of Object.entries(op.fields)) {
				const idx = /^\d+$/.test(key) ? tokenIndexOf(w.type, w.tokens.length, Number(key)) : undefined;
				const got = idx === undefined ? w.props[key] : w.tokens[idx];
				if (got !== String(value)) {
					fail(`WDGT#${op.id} "${key}" was not written as requested`);
				}
			}
		}
	}
	return { bytes, changed, added, removed, hashChanged: patched !== text, model: after };
}

/** Geometry edits as widget operations (`x`, `y`, and `width`/`height` for sized widgets). */
export function geometryOps(rev: RevModel, state: EditState): WidgetOp[] {
	return toPatches(rev, state).map((p) => ({
		kind: "patch" as const,
		id: p.id,
		fields: { ...(p.x !== undefined ? { x: p.x } : {}), ...(p.y !== undefined ? { y: p.y } : {}), ...(p.width !== undefined ? { width: p.width } : {}), ...(p.height !== undefined ? { height: p.height } : {}) },
	}));
}

/**
 * Returns undefined when there is nothing to write (the file must then stay byte-identical, so the caller
 * must not touch it). Throws `RevWriteError` when the result would not be exactly what the user edited.
 */
export function planSave(original: Buffer, state: EditState): SavePlan | undefined {
	const before = parseRev(original.toString("utf8"));
	return planSaveOps(original, toOps(before, state));
}

/** The model of the file as it would be written (no hash, nothing on disk): what the editor page shows. */
export function effectiveRev(original: Buffer, ops: readonly WidgetOp[]): RevModel {
	const text = applyWidgetOps(original.toString("latin1"), ops);
	return parseRev(Buffer.from(text, "latin1").toString("utf8"));
}
