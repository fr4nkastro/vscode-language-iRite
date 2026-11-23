/**
 * Classify firmware tar entries as built-in (`local://N.png`) images. Pure.
 *
 * API
 *   type ImageVariant = "default" | "7" | "12"
 *   classifyImageEntry(name, typeflag): { variant, n } | null
 *   isPng(buf): boolean            // 8-byte PNG signature
 *   pngSize(buf): { width, height } | null   // IHDR; null if not a PNG / too short
 *
 * Evidence (odd/reports/firmware-local-images.md, T1): the device serves
 * `local://N.png` as `/images/lclimages/N.png`, and the tar holds
 * `./var/node/public/{images,images7,images12}/lclimages/N.png` (N = 1..68,
 * no leading zeros, regular files). Accepted names are exactly that shape.
 *
 * Decisions: N must match `[1-9][0-9]{0,2}` (1..999, matching the widget id
 * range): leading zeros are rejected because `local://007.png` is a different
 * URL than `local://7.png`, so `007.png` would never be referenced. Only a
 * leading `./` is stripped; absolute names, `..` segments, backslashes and
 * extra directories are rejected. Only typeflag "0" / NUL (regular file).
 */

export type ImageVariant = "default" | "7" | "12";

export interface ImageEntryId {
	variant: ImageVariant;
	n: number;
}

const VARIANT_BY_DIR: Record<string, ImageVariant> = { images: "default", images7: "7", images12: "12" };
const ENTRY_RE = /^var\/node\/public\/(images|images7|images12)\/lclimages\/([1-9][0-9]{0,2})\.png$/;

export function classifyImageEntry(name: string, typeflag: string): ImageEntryId | null {
	if (typeflag !== "0" && typeflag !== "\0") return null;
	if (name.includes("\\") || name.startsWith("/")) return null;
	const rel = name.startsWith("./") ? name.slice(2) : name;
	if (rel.split("/").some((seg) => seg === ".." || seg === ".")) return null;
	const m = ENTRY_RE.exec(rel);
	if (!m) return null;
	return { variant: VARIANT_BY_DIR[m[1]], n: parseInt(m[2], 10) };
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function isPng(buf: Buffer): boolean {
	return buf.length >= PNG_SIG.length && buf.subarray(0, PNG_SIG.length).equals(PNG_SIG);
}

export function pngSize(buf: Buffer): { width: number; height: number } | null {
	if (!isPng(buf) || buf.length < 24) return null;
	if (buf.subarray(12, 16).toString("latin1") !== "IHDR") return null;
	return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}
