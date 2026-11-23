/**
 * The save pipeline of the screen editor as a pure function (no `vscode` import): original bytes plus the
 * edit state in, new bytes out, with a post-condition check so a bug can never reach the disk.
 */
import { parseRev } from "../rev";
import type { RevModel } from "../rev";
import { applyWidgetPatches, RevWriteError } from "../rev/serialize";
import { effectiveGeometry, toPatches, withEdits } from "./editState";
import type { EditState } from "./editState";

export interface SavePlan {
	/** Bytes to write (BOM, CRLF and every untouched byte identical to the original). */
	bytes: Buffer;
	/** Ids of the widgets whose line changed. */
	changed: number[];
	/** The model of `bytes`. */
	model: RevModel;
}

/**
 * Returns undefined when there is nothing to write (the file must then stay byte-identical, so the caller
 * must not touch it). Throws `RevWriteError` when the result would not be exactly what the user edited.
 */
export function planSave(original: Buffer, state: EditState): SavePlan | undefined {
	const before = parseRev(original.toString("utf8"));
	const patches = toPatches(before, state);
	if (patches.length === 0) {
		return undefined;
	}
	const bytes = Buffer.from(applyWidgetPatches(original.toString("latin1"), patches), "latin1");
	const after = parseRev(bytes.toString("utf8"));
	const expected = withEdits(before.widgets, state);
	if (after.widgets.length !== expected.length) {
		throw new RevWriteError("Post-check failed: the widget count changed");
	}
	const edited = new Set(patches.map((p) => p.id));
	for (const [i, w] of after.widgets.entries()) {
		const e = expected[i];
		const g = effectiveGeometry(e, state);
		const ok = edited.has(w.id)
			? w.id === e.id && w.x === g.x && w.y === g.y && w.width === g.width && w.height === g.height && JSON.stringify(w.raw.slice(5)) === JSON.stringify(e.raw.slice(5))
			: JSON.stringify(w) === JSON.stringify(before.widgets[i]);
		if (!ok) {
			throw new RevWriteError(`Post-check failed for WDGT#${e.id}; nothing was written`);
		}
	}
	const a = original.toString("latin1").split("\n");
	const b = bytes.toString("latin1").split("\n");
	if (a.length !== b.length || a.filter((l, i) => l !== b[i]).length !== edited.size) {
		throw new RevWriteError("Post-check failed: more lines changed than widgets edited; nothing was written");
	}
	return { bytes, changed: [...edited], model: after };
}
