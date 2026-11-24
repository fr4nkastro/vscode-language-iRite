/**
 * Preview-only view state: selected screen and panel, hidden widgets, z-order overrides (no `vscode` import).
 * Never written to `.rev` or to any file; it lives in the webview (`vscode.setState`) and in the extension's
 * memory for the life of the panel so it survives re-renders.
 *
 * `createPreviewState` is deliberately self-contained (no reference to anything outside its body) so the very
 * same code runs in the extension (tests, sanitizing messages) and, through `PREVIEW_STATE_SOURCE`, in the
 * webview. Never add outer references to it (types are fine: they are erased).
 */

export interface OrderOverride {
	/** Widgets sent to the back, oldest first: the most recent operation (last entry) is the bottom-most. */
	back: number[];
	/** Widgets brought to the front, oldest first: the most recent operation (last entry) is the top-most. */
	front: number[];
}

export interface PreviewState {
	/** `"all"` or a screen number as a string. */
	screen: string;
	panel: string;
	/** Screen number → hidden widget ids. */
	hidden: Record<string, number[]>;
	/** Screen number → z-order override. */
	order: Record<string, OrderOverride>;
}

export function createPreviewState(panelIds: string[], defaultPanel: string) {
	const MAX_IDS = 2000;
	const MAX_SCREENS = 1000;
	const isId = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0 && n < 1_000_000;
	const isScreenKey = (k: string): boolean => /^[0-9]{1,6}$/.test(k);
	const ids = (v: unknown): number[] => {
		const out: number[] = [];
		if (Array.isArray(v)) {
			for (const n of v) {
				if (isId(n) && !out.includes(n) && out.length < MAX_IDS) {
					out.push(n);
				}
			}
		}
		return out;
	};
	const without = (list: number[], id: number): number[] => list.filter((x) => x !== id);

	function emptyState(): PreviewState {
		return { screen: "all", panel: defaultPanel, hidden: {}, order: {} };
	}

	function sanitize(raw: unknown): PreviewState {
		const s = emptyState();
		const o = raw as Record<string, unknown> | null | undefined;
		if (!o || typeof o !== "object") {
			return s;
		}
		if (typeof o.screen === "string" && (o.screen === "all" || isScreenKey(o.screen))) {
			s.screen = o.screen;
		}
		if (typeof o.panel === "string" && panelIds.includes(o.panel)) {
			s.panel = o.panel;
		}
		const hidden = o.hidden as Record<string, unknown> | null | undefined;
		if (hidden && typeof hidden === "object" && !Array.isArray(hidden)) {
			for (const k of Object.keys(hidden).slice(0, MAX_SCREENS)) {
				const list = ids(hidden[k]);
				if (isScreenKey(k) && list.length > 0) {
					s.hidden[k] = list;
				}
			}
		}
		const order = o.order as Record<string, { back?: unknown; front?: unknown } | null> | null | undefined;
		if (order && typeof order === "object" && !Array.isArray(order)) {
			for (const k of Object.keys(order).slice(0, MAX_SCREENS)) {
				const v = order[k];
				if (!isScreenKey(k) || !v || typeof v !== "object") {
					continue;
				}
				const back = ids(v.back);
				const front = ids(v.front);
				if (back.length > 0 || front.length > 0) {
					s.order[k] = { back, front };
				}
			}
		}
		return s;
	}

	function isHidden(s: PreviewState, screen: string, id: number): boolean {
		return (s.hidden[screen] ?? []).includes(id);
	}

	function toggleHidden(s: PreviewState, screen: string, id: number): PreviewState {
		const cur = s.hidden[screen] ?? [];
		const next = cur.includes(id) ? without(cur, id) : [...cur, id];
		const hidden = { ...s.hidden };
		if (next.length > 0) {
			hidden[screen] = next;
		} else {
			delete hidden[screen];
		}
		return { ...s, hidden };
	}

	/** Shows every widget of `screen`, or of all screens when `screen` is omitted. */
	function showAll(s: PreviewState, screen?: string): PreviewState {
		if (screen === undefined) {
			return { ...s, hidden: {} };
		}
		const hidden = { ...s.hidden };
		delete hidden[screen];
		return { ...s, hidden };
	}

	function withOrder(s: PreviewState, screen: string, o: OrderOverride): PreviewState {
		const order = { ...s.order };
		if (o.back.length > 0 || o.front.length > 0) {
			order[screen] = o;
		} else {
			delete order[screen];
		}
		return { ...s, order };
	}

	function bringToFront(s: PreviewState, screen: string, id: number): PreviewState {
		const cur = s.order[screen] ?? { back: [], front: [] };
		return withOrder(s, screen, { back: without(cur.back, id), front: [...without(cur.front, id), id] });
	}

	function sendToBack(s: PreviewState, screen: string, id: number): PreviewState {
		const cur = s.order[screen] ?? { back: [], front: [] };
		return withOrder(s, screen, { back: [...without(cur.back, id), id], front: without(cur.front, id) });
	}

	function resetOrder(s: PreviewState, screen?: string): PreviewState {
		if (screen === undefined) {
			return { ...s, order: {} };
		}
		return withOrder(s, screen, { back: [], front: [] });
	}

	function hasOrderOverride(s: PreviewState, screen: string): boolean {
		return s.order[screen] !== undefined;
	}

	/**
	 * Widget ids from bottom to top. `natural` is the authored paint order (id ascending); the most recent
	 * "send to back" is the bottom-most, the most recent "bring to front" the top-most.
	 */
	function paintOrder(s: PreviewState, screen: string, natural: number[]): number[] {
		const o = s.order[screen];
		if (!o) {
			return [...natural];
		}
		const on = (id: number): boolean => natural.includes(id);
		const back = o.back.filter(on).reverse();
		const front = o.front.filter(on);
		const middle = natural.filter((id) => !back.includes(id) && !front.includes(id));
		return [...back, ...middle, ...front];
	}

	return { emptyState, sanitize, isHidden, toggleHidden, showAll, bringToFront, sendToBack, resetOrder, hasOrderOverride, paintOrder };
}

export const previewState = createPreviewState(["7", "12"], "7");

/** Expression that evaluates to the same API inside the webview. */
export const PREVIEW_STATE_SOURCE = `(${createPreviewState.toString()})(["7","12"],"7")`;
