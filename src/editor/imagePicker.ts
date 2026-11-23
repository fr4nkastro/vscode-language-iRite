import { BUILTIN_IMAGE_HINT, galleryModel } from "../firmware/imageCache";
import type { ImageCache } from "../firmware/imageCache";

export function imagePickerModel(cache: ImageCache | null, files: string[], uri: { builtinUri: (path: string) => string; fileUri: (name: string) => string | undefined }): {
	builtin: Array<{ n: number; value: string; width: number; height: number; uri7?: string; uri12?: string }>;
	files: Array<{ value: string; uri?: string }>;
	hint?: string;
} {
	const seven = galleryModel(cache, "7");
	const twelve = galleryModel(cache, "12");
	const numbers = [...new Set([...seven, ...twelve].map((item) => item.n))].sort((a, b) => a - b);
	return {
		builtin: numbers.map((n) => {
			const a = seven.find((item) => item.n === n);
			const b = twelve.find((item) => item.n === n);
			const item = a ?? b!;
			return { n, value: item.ref, width: item.width, height: item.height, ...(a ? { uri7: uri.builtinUri(a.path) } : {}), ...(b ? { uri12: uri.builtinUri(b.path) } : {}) };
		}),
		files: files.map((value) => { const path = uri.fileUri(value); return path ? { value, uri: path } : { value }; }),
		...(!cache?.selected ? { hint: BUILTIN_IMAGE_HINT } : {}),
	};
}
