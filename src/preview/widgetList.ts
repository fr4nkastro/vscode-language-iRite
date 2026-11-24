/** Pure list model and labels for the widget list of a screen (no `vscode` import). */
import type { ScreenView } from "./screenModel";

export interface WidgetRow {
	id: number;
	type: number;
	typeName: string;
	/** Empty when the widget has no alias. */
	alias: string;
	x?: number;
	y?: number;
	w?: number;
	h?: number;
	/** Number of code references (calls, conditions and other identifier uses). */
	refCount: number;
}

/** One row per widget of the screen, in id order (the natural paint order). */
export function buildWidgetRows(screen: ScreenView): WidgetRow[] {
	return screen.widgets.map((w) => ({
		id: w.id,
		type: w.type,
		typeName: w.typeName,
		alias: w.alias ?? "",
		x: w.x,
		y: w.y,
		w: w.width,
		h: w.height,
		refCount: w.references.length,
	}));
}

export function screenTitle(screen: ScreenView): string {
	const count = screen.widgets.length;
	const parts = [`Screen ${screen.number}`];
	if (screen.names.length > 0) {
		parts.push(screen.names.join(" / "));
	}
	parts.push(`${count} widget${count === 1 ? "" : "s"}`);
	return parts.join(" - ");
}

/** `WidgetClicked -> handlerScreenPlateEntry`, or undefined when the screen has no known click routine. */
export function entryLabel(screen: ScreenView): string | undefined {
	return screen.entry ? `${screen.entry.handler} -> ${screen.entry.routine}` : undefined;
}
