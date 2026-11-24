/**
 * Import built-in images from a 1280 firmware into the extension cache. Pure
 * (Node fs/path/crypto only; the vscode command lives elsewhere).
 *
 * API
 *   importFirmwareImages({ source, storageDir }): Promise<ImportSummary>
 *   MAX_IMAGE_BYTES            // per-image safety bound (16 MiB; largest seen ~1 MB)
 *   interface ImportSummary { firmwareVersion, dir, counts, rejected, importedAt }
 *   interface ImportedManifest   // shape of manifest.json
 *
 * `source` is the firmware `update` folder (needs `rootfs.tar`, reads
 * `manifest.txt` there) or a `rootfs.tar` path (reads `manifest.txt` next to it).
 * Version = manifest `image_version`, else `core_version`. If there is no
 * manifest.txt (or no version key) the version is `unknown-<8 hex>`: first 8
 * hex chars of the SHA-1 over the sorted "variant/N:sha1(content)" list, so the
 * same images always land in the same directory (idempotent). A version key
 * that is present but unsafe (see sanitizeVersion) is an error.
 *
 * Layout: `<storageDir>/firmware-images/<version>/{default,7,12}/N.png` +
 * `manifest.json` { firmwareVersion, source, importedAt, counts, images:
 * { variant: { N: { width, height, bytes } } } }. The tar is streamed once,
 * only validated PNG entries are kept (non-PNG ones are counted in
 * `rejected.nonPng`, oversized ones in `rejected.tooLarge`). Files are written
 * to a temp dir inside `firmware-images/` and swapped in by rename, so a
 * failure leaves previous imports untouched (a re-import of an existing version with fewer usable images in any variant keeps the current cache: `keptExisting`, see `importMessage`) and no temp dir behind. Zero
 * images found is an error (nothing is written).
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { classifyImageEntry, isPng, pngSize, type ImageVariant } from "./imageEntries";
import { parseManifest, sanitizeVersion } from "./manifest";
import { removeBestEffort, sweepLeftovers, type RemoveOptions } from "./cacheCleanup";
import { readTar } from "./tarReader";

export const MAX_IMAGE_BYTES = 16 * 1024 * 1024;

export type VariantCounts = Record<ImageVariant, number>;
export interface ImageInfo {
	width: number;
	height: number;
	bytes: number;
}
export interface ImportedManifest {
	firmwareVersion: string;
	source: string;
	importedAt: string;
	counts: VariantCounts;
	images: Record<ImageVariant, Record<string, ImageInfo>>;
}
export interface ImportSummary {
	firmwareVersion: string;
	dir: string;
	counts: VariantCounts;
	rejected: { nonPng: number; tooLarge: number };
	importedAt: string;
	/** false when a re-import yielded fewer usable images than the current cache and the cache was kept. */
	replaced: boolean;
	keptExisting: boolean;
	/** Counts of the cache that existed before this import (only when the version already existed). */
	previousCounts?: VariantCounts;
	/** Set when the previous cache directory could not be removed after the swap (the import still succeeded). */
	leftover?: string;
}

const VARIANTS: ImageVariant[] = ["default", "7", "12"];

export async function importFirmwareImages(opts: {
	source: string;
	storageDir: string;
	/** Removal knobs (injectable rm/sleep for tests). */
	cleanup?: RemoveOptions;
	/** Receives cleanup warnings (default console.warn). */
	logger?: (message: string) => void;
}): Promise<ImportSummary> {
	const { source, storageDir } = opts;
	const log = opts.logger ?? ((m: string) => console.warn(m));
	const isDir = statSync(source).isDirectory();
	const tarPath = isDir ? join(source, "rootfs.tar") : source;
	if (!existsSync(tarPath)) throw new Error(`rootfs.tar not found in "${source}"`);
	const manifestPath = join(isDir ? source : dirname(tarPath), "manifest.txt");
	const manifest = existsSync(manifestPath) ? parseManifest(readFileSync(manifestPath, "utf8")) : {};
	const rawVersion = manifest.image_version || manifest.core_version || "";
	let version: string | null = null;
	if (rawVersion) {
		version = sanitizeVersion(rawVersion);
		if (!version) throw new Error(`Unsafe firmware version in manifest.txt: "${rawVersion}"`);
	}

	const root = join(storageDir, "firmware-images");
	mkdirSync(root, { recursive: true });
	// Sweep before creating this import's temp dir so it can never be swept.
	for (const f of (await sweepLeftovers(root, opts.cleanup)).failed) log(`Could not remove leftover firmware cache directory ${f.name}: ${f.error}`);
	const tmp = join(root, `.tmp-${randomBytes(6).toString("hex")}`);
	mkdirSync(tmp);

	try {
		const images: ImportedManifest["images"] = { default: {}, "7": {}, "12": {} };
		const digests: string[] = [];
		const rejected = { nonPng: 0, tooLarge: 0 };

		await readTar(tarPath, async (entry) => {
			const id = classifyImageEntry(entry.name, entry.typeflag);
			if (!id) return;
			if (entry.size > MAX_IMAGE_BYTES) {
				rejected.tooLarge++;
				return;
			}
			const body = await entry.read(MAX_IMAGE_BYTES);
			const size = isPng(body) ? pngSize(body) : null;
			if (!size) {
				rejected.nonPng++;
				return;
			}
			const vdir = join(tmp, id.variant);
			mkdirSync(vdir, { recursive: true });
			writeFileSync(join(vdir, `${id.n}.png`), body);
			images[id.variant][String(id.n)] = { width: size.width, height: size.height, bytes: body.length };
			digests.push(`${id.variant}/${id.n}:${createHash("sha1").update(body).digest("hex")}`);
		});

		const counts = Object.fromEntries(VARIANTS.map((v) => [v, Object.keys(images[v]).length])) as VariantCounts;
		if (VARIANTS.every((v) => counts[v] === 0)) {
			throw new Error(`No built-in images found in "${basename(tarPath)}" (expected var/node/public/images*/lclimages/N.png)`);
		}
		if (!version) {
			const h = createHash("sha1").update([...new Set(digests)].sort().join("\n")).digest("hex");
			version = `unknown-${h.slice(0, 8)}`;
		}

		const importedAt = new Date().toISOString();
		const out: ImportedManifest = { firmwareVersion: version, source, importedAt, counts, images };
		writeFileSync(join(tmp, "manifest.json"), JSON.stringify(out, null, 2) + "\n");

		const target = join(root, version);
		const old = join(root, `.old-${randomBytes(6).toString("hex")}`);
		const hadOld = existsSync(target);
		const previousCounts = hadOld ? readCounts(join(target, "manifest.json")) : undefined;
		if (previousCounts && VARIANTS.some((v) => counts[v] < previousCounts[v])) {
			return { firmwareVersion: version, dir: target, counts, rejected, importedAt, replaced: false, keptExisting: true, previousCounts };
		}
		if (hadOld) renameSync(target, old);
		try {
			renameSync(tmp, target);
		} catch (e) {
			if (hadOld) renameSync(old, target);
			throw e;
		}
		let leftover: string | undefined;
		if (hadOld) {
			const r = await removeBestEffort(old, opts.cleanup);
			if (!r.removed) {
				leftover = old;
				log(`Firmware images for ${version} imported, but the previous cache could not be removed (${r.error}); it will be swept later: ${old}`);
			}
		}
		return { firmwareVersion: version, dir: target, counts, rejected, importedAt, replaced: true, keptExisting: false, ...(previousCounts ? { previousCounts } : {}), ...(leftover ? { leftover } : {}) };
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}
}

const total = (c: VariantCounts): number => VARIANTS.reduce((n, v) => n + c[v], 0);

function readCounts(manifestPath: string): VariantCounts | undefined {
	try {
		const c = JSON.parse(readFileSync(manifestPath, "utf8")).counts;
		if (VARIANTS.every((v) => Number.isInteger(c?.[v]) && c[v] >= 0)) return { default: c.default, "7": c["7"], "12": c["12"] };
	} catch {
		/* unreadable manifest: treat as no usable previous cache */
	}
	return undefined;
}

/** Notification for an import result (vscode-free): info, or warning when the current cache was kept. */
export function importMessage(r: ImportSummary): { level: "info" | "warning"; text: string } {
	const parts: string[] = [];
	if (r.rejected.nonPng) parts.push(`${r.rejected.nonPng} not PNG`);
	if (r.rejected.tooLarge) parts.push(`${r.rejected.tooLarge} too large`);
	const rejected = parts.length ? ` (rejected: ${parts.join(", ")})` : "";
	if (r.keptExisting) {
		const prefix = `Firmware images for ${r.firmwareVersion} were not replaced: the new import has`;
		const prev = r.previousCounts;
		if (!prev) return { level: "warning", text: `${prefix} fewer usable images than the current cache${rejected}. The current cache was kept.` };
		const n = total(r.counts);
		const t = total(prev);
		const cmp = n < t ? `fewer than the current ${t}` : `no more than the current ${t} but fewer in some variants`;
		const dropped = VARIANTS.filter((v) => r.counts[v] < prev[v]).map((v) => `${v} (${prev[v]} → ${r.counts[v]})`);
		return {
			level: "warning",
			text: `${prefix} ${n} usable ${n === 1 ? "image" : "images"}, ${cmp}${rejected}. The current cache was kept.${dropped.length ? ` Fewer images for: ${dropped.join(", ")}.` : ""}`,
		};
	}
	return { level: "info", text: `Imported firmware images for ${r.firmwareVersion}${rejected}. Reopen the preview or screen editor to refresh images.` };
}
