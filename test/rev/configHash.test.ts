import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computeConfigHash, computeCustomHashValue, readConfigHash, readCustomHashValue, rewriteConfigHash } from "../../src/rev/configHash";
import { computeCustomHash, readCustomHash } from "../../src/rev/serialize";
import { crlfFixture, goldenPath, hasGolden } from "./revFixtures";

const text = crlfFixture("hashed.rev");

// Computed by the independent Python reference (reproduce_confighash.py recipe) over test/fixtures/rev/hashed.rev.
const PYTHON_CONFIG_HASH = "147 26 103 60 228 116 218 65 57 107 188 46 184 105 62 80 252 244 176 173 ";

describe("ConfigHash (SHA-1 of the UTF-16LE decoded Config text, decimal bytes + one space each)", () => {
	it("equals the value computed by the independent Python implementation", () => {
		expect(readConfigHash(text)).toBe(PYTHON_CONFIG_HASH);
		expect(computeConfigHash(text)).toBe(PYTHON_CONFIG_HASH);
	});

	it("reproduces the stored ConfigHash of the DOLE blob 00fe873 (skipped without the scratch copy)", () => {
		if (!hasGolden("dole-00fe873.rev")) return;
		const t = readFileSync(goldenPath("dole-00fe873.rev")).toString("latin1");
		expect(readConfigHash(t)).toBeDefined();
		expect(computeConfigHash(t)).toBe(readConfigHash(t));
	});

	it("the current DOLE main.rev is a hand-patched file whose stored hash is stale", () => {
		if (!hasGolden("dole-main-current.rev")) return;
		const t = readFileSync(goldenPath("dole-main-current.rev")).toString("latin1");
		expect(computeConfigHash(t)).not.toBe(readConfigHash(t));
	});

	it("hashes the Config text with CRLF even when the file is LF-only", () => {
		expect(computeConfigHash(text.replace(/\r\n/g, "\n"))).toBe(PYTHON_CONFIG_HASH);
	});

	it("does not depend on the BOM", () => {
		expect(computeConfigHash(text.slice(3))).toBe(PYTHON_CONFIG_HASH);
	});

	it("changes when a Config byte changes and ignores the header and Printers", () => {
		expect(computeConfigHash(text.replace("lbl4", "lbl5"))).not.toBe(PYTHON_CONFIG_HASH);
		expect(computeConfigHash(text.replace("PRN#1=A", "PRN#1=B"))).toBe(PYTHON_CONFIG_HASH);
	});

	it("is undefined without a Config element", () => {
		expect(computeConfigHash("<Indicator></Indicator>")).toBeUndefined();
	});
});

describe("CustomHash value format", () => {
	it("computeCustomHashValue reproduces the stored decimal-with-spaces CustomHash", () => {
		expect(readCustomHashValue(text)).toMatch(/^(\d+ ){20}$/);
		expect(computeCustomHashValue(text)).toBe(readCustomHashValue(text));
	});

	it("is the same digest as the existing hex helpers", () => {
		const hex = Buffer.from(computeCustomHashValue(text)!.trim().split(" ").map(Number)).toString("hex");
		expect(hex).toBe(computeCustomHash(text));
		expect(hex).toBe(readCustomHash(text));
	});
});

describe("rewriteConfigHash", () => {
	it("is a no-op when the stored hash is already right", () => {
		expect(rewriteConfigHash(text)).toBe(text);
	});

	it("rewrites only the value inside the ConfigHash element", () => {
		const stale = text.replace(PYTHON_CONFIG_HASH, "1 2 3 4 ");
		expect(stale).not.toBe(text);
		expect(rewriteConfigHash(stale)).toBe(text);
	});

	it("leaves a file without a ConfigHash element untouched", () => {
		const bare = text.replace(/ *<ConfigHash[^>]*>\r\n/, "");
		expect(bare).not.toBe(text);
		expect(rewriteConfigHash(bare)).toBe(bare);
	});
});
