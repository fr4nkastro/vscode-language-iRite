/**
 * Id and alias rules of the screen editor (pure, no `vscode` import). Facts: `odd/tasks/screen-editor-widgets.md`
 * L6/L7 (Revolution assigns the lowest free id from 1 and the default alias `<prefix><id>`; aliases are cut at 8
 * characters; scale has no alias; line and softkey aliases are derived from the id and not stored).
 */
import { ALIAS_MAX, WIDGET_ID_MAX, WIDGET_ID_MIN, defaultAlias, widgetTypeDef } from "../rev/widgetCatalog";

/** Lowest id in 1..999 that is not in `used`; undefined when all are taken. */
export function nextFreeId(used: Iterable<number>): number | undefined {
	const taken = new Set(used);
	for (let id = WIDGET_ID_MIN; id <= WIDGET_ID_MAX; id++) {
		if (!taken.has(id)) {
			return id;
		}
	}
	return undefined;
}

/** Why `alias` cannot be used; undefined when it can. `taken` are the other widgets' aliases (any case). */
export function validateAlias(alias: string, taken: Iterable<string>): string | undefined {
	if (alias === "") {
		return "an alias is required";
	}
	if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(alias)) {
		return "an alias must be a letter followed by letters, digits or underscore";
	}
	if (alias.length > ALIAS_MAX) {
		return `an alias is at most ${ALIAS_MAX} characters (Revolution cuts it)`;
	}
	const low = alias.toLowerCase();
	for (const t of taken) {
		if (t.toLowerCase() === low) {
			return `the alias "${alias}" is already used by another widget`;
		}
	}
	return undefined;
}

/** `lbl7`; on a collision `lbl7b`, `lbl7c`... while it fits in 8 characters. Undefined for types without alias. */
export function pickDefaultAlias(type: number, id: number, taken: Iterable<string>): string | undefined {
	const base = defaultAlias(type, id);
	if (!base) {
		return undefined;
	}
	const used = new Set([...taken].map((t) => t.toLowerCase()));
	for (const suffix of ["", ..."bcdefghijklmnopqrstuvwxyz"]) {
		const candidate = base + suffix;
		if (candidate.length <= ALIAS_MAX && !used.has(candidate.toLowerCase())) {
			return candidate;
		}
	}
	return undefined;
}

/** The alias `main.iri` gets for a widget: the stored one, or the derived `line<id>`/`sk<id>`; none for scale. */
export function displayAlias(type: number, id: number, stored: string | undefined): string | undefined {
	const def = widgetTypeDef(type);
	if (!def || !def.hasAlias) {
		return undefined;
	}
	if (def.aliasPersisted) {
		return stored ? stored : undefined;
	}
	return defaultAlias(type, id);
}
