import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Scratch copies of the reference project (outside the repo, override with REV_GOLDEN_DIR); tests that need them skip when absent. */
export const GOLDEN_DIR = process.env.REV_GOLDEN_DIR ?? join(process.env.HOME ?? "", ".cache/gentle-tasks/rea-screen-editor/golden");
export const goldenPath = (name: string): string => join(GOLDEN_DIR, name);
export const hasGolden = (name: string): boolean => existsSync(goldenPath(name));

/** Fixture as byte-per-char text with BOM + CRLF restored (git may have changed the line endings). */
export function crlfFixture(name: string): string {
	const t = readFileSync(join(__dirname, "../fixtures/rev", name), "latin1");
	return t.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
}

/** Text as the editor reads it for parsing (UTF-8). */
export const utf8 = (latin1: string): string => Buffer.from(latin1, "latin1").toString("utf8");
