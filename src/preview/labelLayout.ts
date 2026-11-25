/**
 * Text layout of label widgets (types 4, 11 and the legacy 5) shared by the HTML preview and the SVG render.
 * Pure: no `vscode` import.
 *
 * - Horizontal alignment follows the `justification` token (1 Left, 2 Right, 3 Center; anything else is Left).
 * - Vertical alignment is automatic on the device, so the preview always centers the text vertically.
 * - `border` 2 (Fixed single) draws a 1 px black frame inside the widget box; 1 (None) draws none.
 *   Color and inside/outside placement are UNCONFIRMED on a real 1280.
 */
import type { RevWidget } from "../rev";

export type LabelAlign = "left" | "right" | "center";

export function labelAlign(w: Pick<RevWidget, "props">): LabelAlign {
	const j = (w.props?.justification ?? "").trim();
	return j === "2" ? "right" : j === "3" ? "center" : "left";
}

export function labelHasBorder(w: Pick<RevWidget, "props">): boolean {
	return (w.props?.border ?? "").trim() === "2";
}

/** Color of the Fixed single border (assumption, see the module comment). */
export const LABEL_BORDER_COLOR = "Black";
