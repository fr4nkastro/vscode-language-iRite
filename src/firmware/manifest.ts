/**
 * Firmware `manifest.txt` parsing. Pure.
 *
 * API
 *   parseManifest(text): Record<string, string>
 *   firmwareVersionOf(manifest): string | null   // image_version, else core_version, sanitized
 *   sanitizeVersion(v): string | null            // safe directory name or null
 *
 * Format (T1 evidence): `key=value` lines; `#` starts a comment, and the
 * `#[Section]` headers are themselves comments. A later uncommented key wins.
 * Keys are lower-cased; the value is everything after the first `=`, trimmed.
 *
 * sanitizeVersion: trimmed, must match `[0-9A-Za-z._-]+`, must not start with
 * "." (rejects ".", "..", hidden dirs) so it is always a plain directory name.
 */

export function parseManifest(text: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const raw of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
		const line = raw.trim();
		if (line === "" || line.startsWith("#")) continue;
		const eq = line.indexOf("=");
		if (eq <= 0) continue;
		out[line.slice(0, eq).trim().toLowerCase()] = line.slice(eq + 1).trim();
	}
	return out;
}

export function sanitizeVersion(v: string): string | null {
	const t = v.trim();
	if (!/^[0-9A-Za-z._-]+$/.test(t) || t.startsWith(".")) return null;
	return t;
}

export function firmwareVersionOf(manifest: Record<string, string>): string | null {
	for (const key of ["image_version", "core_version"]) {
		const v = manifest[key];
		if (v) return sanitizeVersion(v);
	}
	return null;
}
