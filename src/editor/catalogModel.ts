/**
 * Fills the geometry, screen and alias of widgets the `.rev` reader does not interpret (types 2, 8, 9, 11:
 * `typeName` "unknown") from the catalog's named properties, so the editor can show and move them (pure, no
 * `vscode` import). Only undefined fields are filled; known types and values the reader already has are left alone.
 */
import type { RevModel, RevWidget } from "../rev";
import { widgetFieldByRole, widgetTypeDef } from "../rev/widgetCatalog";

const int = (s: string | undefined): number | undefined => (s !== undefined && /^-?\d+$/.test(s.trim()) ? Number(s) : undefined);

function enrichWidget(w: RevWidget): RevWidget {
	const def = widgetTypeDef(w.type);
	if (!def || w.typeName !== "unknown") {
		return w;
	}
	const p = (role: string): string | undefined => {
		const f = widgetFieldByRole(w.type, role);
		return f ? w.props[f.name] : undefined;
	};
	const alias = def.aliasPersisted ? p("alias") || undefined : undefined;
	return {
		...w,
		x: w.x ?? int(p("x")),
		y: w.y ?? int(p("y")),
		width: w.width ?? int(p("width")),
		height: w.height ?? int(p("height")),
		screen: w.screen ?? int(p("screen")),
		alias: w.alias ?? alias,
		text: w.text ?? p("caption"),
		fontSize: w.fontSize ?? int(p("font")),
		color: w.color ?? p("color"),
	};
}

export function enrichRev(rev: RevModel): RevModel {
	return { ...rev, widgets: rev.widgets.map(enrichWidget) };
}
