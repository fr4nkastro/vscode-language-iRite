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
			const uri7 = a && uri.builtinUri(a.path);
			const uri12 = b && uri.builtinUri(b.path);
			return { n, value: item.ref, width: item.width, height: item.height, ...(uri7 ? { uri7 } : {}), ...(uri12 ? { uri12 } : {}) };
		}),
		files: files.map((value) => { const path = uri.fileUri(value); return path ? { value, uri: path } : { value }; }),
		...(!cache?.selected ? { hint: BUILTIN_IMAGE_HINT } : {}),
	};
}
