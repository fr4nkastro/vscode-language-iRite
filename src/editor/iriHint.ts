/**
 * What the user must do in `main.iri` after adding, renaming or deleting widgets (pure, no `vscode` import).
 * The extension never edits `main.iri`: Revolution regenerates it, and this shows the exact lines of its format
 * (`-- Widget Aliases` block, alias padded to 10, then `: constant integer := <id>;`).
 */
export interface AliasEntry {
	id: number;
	alias: string;
}

export interface IriHint {
	/** Lines to add to the block. */
	add: string[];
	/** Lines whose alias changed. */
	change: Array<{ old: string; new: string }>;
	/** Lines to remove. */
	remove: string[];
}

export function constantLine(alias: string, id: number): string {
	return `${alias.padEnd(10)}: constant integer := ${id};`;
}

/** `before`/`after`: the widgets that have an alias in `main.iri`, before and after the session's edits. */
export function iriHint(before: readonly AliasEntry[], after: readonly AliasEntry[]): IriHint {
	const b = new Map(before.map((e) => [e.id, e.alias]));
	const a = new Map(after.map((e) => [e.id, e.alias]));
	const hint: IriHint = { add: [], change: [], remove: [] };
	for (const id of [...a.keys()].sort((x, y) => x - y)) {
		const now = a.get(id) as string;
		if (!b.has(id)) {
			hint.add.push(constantLine(now, id));
		} else if (b.get(id) !== now) {
			hint.change.push({ old: constantLine(b.get(id) as string, id), new: constantLine(now, id) });
		}
	}
	for (const id of [...b.keys()].sort((x, y) => x - y)) {
		if (!a.has(id)) {
			hint.remove.push(constantLine(b.get(id) as string, id));
		}
	}
	return hint;
}
