import { describe, expect, it } from "vitest";
import { validateInput } from "../../src/lmtools/schema";
import type { ObjectSchema } from "../../src/lmtools/schema";

const schema: ObjectSchema = {
	type: "object",
	additionalProperties: false,
	required: ["name"],
	properties: {
		name: { type: "string", minLength: 1, maxLength: 5 },
		screen: { type: "integer", minimum: 0, maximum: 999 },
		panel: { type: "string", enum: ["7", "12"] },
		flag: { type: "boolean" },
	},
};

describe("validateInput", () => {
	it("accepts valid input and treats undefined/null as {}", () => {
		expect(validateInput(schema, { name: "a", screen: 3, panel: "12", flag: true })).toEqual({ ok: true, value: { name: "a", screen: 3, panel: "12", flag: true } });
		expect(validateInput({ ...schema, required: [] }, undefined)).toEqual({ ok: true, value: {} });
		expect(validateInput({ ...schema, required: [] }, null)).toEqual({ ok: true, value: {} });
	});
	it("rejects non-objects, unknown and missing properties", () => {
		expect(validateInput(schema, [1])).toEqual({ ok: false, errors: ["Input must be a JSON object"] });
		expect(validateInput(schema, "x")).toEqual({ ok: false, errors: ["Input must be a JSON object"] });
		expect(validateInput(schema, { name: "a", extra: 1 })).toEqual({ ok: false, errors: ['Unknown property "extra"'] });
		expect(validateInput(schema, {})).toEqual({ ok: false, errors: ['Missing required property "name"'] });
	});
	it("checks types, ranges, enums and lengths", () => {
		const r = validateInput(schema, { name: "toolong", screen: 1000, panel: "9", flag: "yes" });
		expect(r).toEqual({
			ok: false,
			errors: ['"name" is too long (max 5)', '"screen" must be <= 999', '"panel" must be one of "7", "12"', '"flag" must be a boolean'],
		});
		expect(validateInput(schema, { name: "", screen: 1.5 })).toEqual({ ok: false, errors: ['"name" must not be empty', '"screen" must be an integer'] });
		expect(validateInput(schema, { name: 3 })).toEqual({ ok: false, errors: ['"name" must be a string'] });
	});
	it("coerces numeric strings to integers and numbers to enum strings", () => {
		expect(validateInput(schema, { name: "a", screen: "4", panel: 12 })).toEqual({ ok: true, value: { name: "a", screen: 4, panel: "12" } });
	});
});
