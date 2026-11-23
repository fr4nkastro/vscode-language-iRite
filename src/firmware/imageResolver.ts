import { basename, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import type { ScreensView } from "../preview/screenModel";
import { loadImageCache, resolveBuiltinImage } from "./imageCache";
import type { ImageCache, Panel } from "./imageCache";

export function builtinResolver(cache: ImageCache | null, convert: (path: string) => string): (id: string, panel: Panel) => string | undefined {
	return (id, panel) => {
		const path = resolveBuiltinImage(cache, id, panel);
		return path ? convert(path) : undefined;
	};
}

export function fileUri(path: string): string { return pathToFileURL(path).toString(); }

export function loadCacheFromDir(dir: string): ImageCache | null {
	const parent = basename(dir) === "firmware-images" ? dirname(dir) : dirname(dirname(dir));
	const cache = loadImageCache(parent, basename(dir) === "firmware-images" ? undefined : basename(dir));
	if (basename(dir) !== "firmware-images" && cache.selected?.dir !== dir) return null;
	return cache.selected ? cache : null;
}

export function needsImportHint(view: ScreensView, cache: ImageCache | null, panel: Panel = "7"): boolean {
	return view.screens.some((s) => s.widgets.some((w) => {
		if (w.type !== 7 || !w.image?.startsWith("local://")) return false;
		return !resolveBuiltinImage(cache, w.image.slice("local://".length), panel);
	}));
}
