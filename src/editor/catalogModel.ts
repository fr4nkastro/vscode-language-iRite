/**
 * Kept for the editor's call sites. The `.rev` reader (`src/rev/index.ts`) now fills geometry, screen, alias,
 * caption, font and colors of every catalog type (2, 5, 8, 9, 11 included), so this is a pass-through
 * (pure, no `vscode` import).
 */
import type { RevModel } from "../rev";

export function enrichRev(rev: RevModel): RevModel {
	return rev;
}
