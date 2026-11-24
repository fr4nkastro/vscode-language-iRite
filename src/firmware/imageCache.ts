/**
 * Read side of the imported firmware image cache. Pure (fs/path only).
 *
 * API
 *   BUILTIN_IMAGE_HINT                        // placeholder hint text
 *   listImportedVersions(storageDir): CachedVersion[]
 *   pickVersion(versions, setting?): CachedVersion | null
 *   loadImageCache(storageDir, setting?): ImageCache   // { storageDir, versions, selected }
 *   resolveBuiltinImage(cache, id: "N.png", panel: "7" | "12"): string | null
 *   galleryModel(cache, panel): GalleryItem[]          // sorted by n
 *
 * Version selection: the explicit setting (`irite.firmware.imagesVersion`) if
 * that version is imported; otherwise the latest. "Latest" = highest version
 * by a numeric-aware compare of dot/dash separated segments (2.10.0 > 2.9.4),
 * ties broken by `importedAt` (later wins). Firmware version, not import time,
 * defines "latest" so re-importing an old firmware does not demote the newest.
 *
 * Variant fallback (T1 evidence): the device boots `S11graphicsetup`, which
 * links `/var/node/public/images/*` to `images12/*` (fb0 mode 1280x800) or
 * `images7/*`, so the panel's own variant is what the device shows. The plain
 * `images/` copy in the tar is the pre-boot default (deleted on a real
 * device), so it is the nearest neutral substitute; the other panel's variant
 * is the last resort (in 2.09.04 all three are byte-identical).
 *   12" -> 12, default, 7      7" -> 7, default, 12
 * Unknown N, malformed id or no import -> null (the caller keeps its
 * placeholder and may show BUILTIN_IMAGE_HINT).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ImageVariant } from "./imageEntries";
import type { ImportedManifest } from "./importer";

export const BUILTIN_IMAGE_HINT = "Import the built-in images from the 1280 firmware";

export interface CachedVersion {
	version: string;
	dir: string;
	manifest: ImportedManifest;
}
export interface ImageCache {
	storageDir: string;
	versions: CachedVersion[];
	selected: CachedVersion | null;
}
export interface GalleryItem {
	n: number;
	ref: string;
	path: string;
	width: number;
	height: number;
}
export type Panel = "7" | "12";

const FALLBACK: Record<Panel, ImageVariant[]> = {
	"12": ["12", "default", "7"],
	"7": ["7", "default", "12"],
};

export function listImportedVersions(storageDir: string): CachedVersion[] {
	const root = join(storageDir, "firmware-images");
	let names: string[];
	try {
		names = readdirSync(root);
	} catch {
		return [];
	}
	const out: CachedVersion[] = [];
	for (const name of names) {
		if (name.startsWith(".")) continue;
		const dir = join(root, name);
		try {
			const m = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as ImportedManifest;
			if (!m || typeof m !== "object" || !m.images || typeof m.images !== "object") continue;
			out.push({ version: name, dir, manifest: m });
		} catch {
			continue;
		}
	}
	return out;
}

function compareVersions(a: string, b: string): number {
	const pa = a.split(/[.\-_]/);
	const pb = b.split(/[.\-_]/);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const x = pa[i] ?? "";
		const y = pb[i] ?? "";
		if (x === y) continue;
		const nx = /^\d+$/.test(x);
		const ny = /^\d+$/.test(y);
		if (nx && ny) {
			const d = parseInt(x, 10) - parseInt(y, 10);
			if (d !== 0) return d;
			continue;
		}
		return x < y ? -1 : 1;
	}
	return 0;
}

export function pickVersion(versions: CachedVersion[], setting?: string): CachedVersion | null {
	const wanted = setting?.trim();
	if (wanted) {
		const hit = versions.find((v) => v.version === wanted);
		if (hit) return hit;
	}
	let best: CachedVersion | null = null;
	for (const v of versions) {
		if (!best) {
			best = v;
			continue;
		}
		const c = compareVersions(v.version, best.version);
		if (c > 0 || (c === 0 && String(v.manifest.importedAt) > String(best.manifest.importedAt))) best = v;
	}
	return best;
}

export function loadImageCache(storageDir: string, setting?: string): ImageCache {
	const versions = listImportedVersions(storageDir);
	return { storageDir, versions, selected: pickVersion(versions, setting) };
}

function locate(v: CachedVersion, n: number, panel: Panel): { path: string; width: number; height: number } | null {
	for (const variant of FALLBACK[panel]) {
		const info = v.manifest.images[variant]?.[String(n)];
		if (!info) continue;
		const path = join(v.dir, variant, `${n}.png`);
		if (existsSync(path)) return { path, width: info.width, height: info.height };
	}
	return null;
}

export function resolveBuiltinImage(cache: ImageCache | null | undefined, id: string, panel: Panel): string | null {
	const sel = cache?.selected;
	if (!sel) return null;
	const m = /^([1-9][0-9]{0,2})\.png$/.exec(id);
	if (!m) return null;
	return locate(sel, parseInt(m[1], 10), panel)?.path ?? null;
}

export function galleryModel(cache: ImageCache | null | undefined, panel: Panel): GalleryItem[] {
	const sel = cache?.selected;
	if (!sel) return [];
	const ns = new Set<number>();
	for (const variant of Object.keys(sel.manifest.images) as ImageVariant[]) {
		for (const k of Object.keys(sel.manifest.images[variant] ?? {})) {
			if (/^[1-9][0-9]{0,2}$/.test(k)) ns.add(parseInt(k, 10));
		}
	}
	const out: GalleryItem[] = [];
	for (const n of [...ns].sort((a, b) => a - b)) {
		const hit = locate(sel, n, panel);
		if (hit) out.push({ n, ref: `local://${n}.png`, ...hit });
	}
	return out;
}
