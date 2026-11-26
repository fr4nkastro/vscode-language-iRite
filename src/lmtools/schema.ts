/**
 * Minimal JSON Schema validator for the LM tool inputs (pure). Supports the subset the tool schemas use:
 * `type: object` with `properties`, `required`, `additionalProperties: false`, and per property
 * `type` (string | integer | boolean), `enum`, `minimum`, `maximum`, `minLength`, `maxLength`.
 * Returns the sanitized input or a list of human-readable errors; never throws.
 */
export interface PropertySchema {
	type: "string" | "integer" | "boolean" | "array";
	items?: { type: "string"; minLength?: number; maxLength?: number };
	minItems?: number;
	maxItems?: number;
	description?: string;
	enum?: readonly (string | number)[];
	minimum?: number;
	maximum?: number;
	minLength?: number;
	maxLength?: number;
}

export interface ObjectSchema {
	type: "object";
	properties: Record<string, PropertySchema>;
	required?: readonly string[];
	additionalProperties?: boolean;
}

export type Validated = { ok: true; value: Record<string, unknown> } | { ok: false; errors: string[] };

export function validateInput(schema: ObjectSchema, input: unknown): Validated {
	const raw = input === undefined || input === null ? {} : input;
	if (typeof raw !== "object" || Array.isArray(raw)) {
		return { ok: false, errors: ["Input must be a JSON object"] };
	}
	const obj = raw as Record<string, unknown>;
	const errors: string[] = [];
	const value: Record<string, unknown> = {};
	for (const key of Object.keys(obj)) {
		if (!(key in schema.properties) && schema.additionalProperties === false) {
			errors.push(`Unknown property "${key}"`);
		}
	}
	for (const key of schema.required ?? []) {
		if (obj[key] === undefined) errors.push(`Missing required property "${key}"`);
	}
	for (const [key, prop] of Object.entries(schema.properties)) {
		let v = obj[key];
		if (v === undefined) continue;
		// Models often send numbers as strings or enum numbers as numbers: coerce only these lossless cases.
		if (prop.type === "integer" && typeof v === "string" && /^-?\d+$/.test(v.trim())) v = Number(v);
		if (prop.type === "string" && typeof v === "number" && prop.enum?.some((e) => String(e) === String(v))) v = String(v);
		if (prop.type === "string" && typeof v !== "string") {
			errors.push(`"${key}" must be a string`);
			continue;
		}
		if (prop.type === "integer" && (typeof v !== "number" || !Number.isInteger(v))) {
			errors.push(`"${key}" must be an integer`);
			continue;
		}
		if (prop.type === "array" && (!Array.isArray(v) || v.length < (prop.minItems ?? 0) ||
			v.length > (prop.maxItems ?? Infinity) || v.some(item => typeof item !== "string" ||
			item.length < (prop.items?.minLength ?? 0) || item.length > (prop.items?.maxLength ?? Infinity)))) {
			errors.push(`"${key}" must be a list of strings within its declared limits`);
			continue;
		}
		if (prop.type === "boolean" && typeof v !== "boolean") {
			errors.push(`"${key}" must be a boolean`);
			continue;
		}
		if (prop.enum && !prop.enum.includes(v as string | number)) {
			errors.push(`"${key}" must be one of ${prop.enum.map((e) => JSON.stringify(e)).join(", ")}`);
			continue;
		}
		if (typeof v === "number") {
			if (prop.minimum !== undefined && v < prop.minimum) errors.push(`"${key}" must be >= ${prop.minimum}`);
			if (prop.maximum !== undefined && v > prop.maximum) errors.push(`"${key}" must be <= ${prop.maximum}`);
		}
		if (typeof v === "string") {
			if (prop.minLength !== undefined && v.length < prop.minLength) errors.push(`"${key}" must not be empty`);
			if (prop.maxLength !== undefined && v.length > prop.maxLength) errors.push(`"${key}" is too long (max ${prop.maxLength})`);
		}
		value[key] = v;
	}
	return errors.length > 0 ? { ok: false, errors } : { ok: true, value };
}
