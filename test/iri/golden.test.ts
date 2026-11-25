import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateMainIri } from "../../src/iri/generateIri";
import { iriBytes } from "../../src/iri/regenerate";
import { parseRev } from "../../src/rev";

const DIR = process.env.IRI_GOLDEN_DIR ?? "C:\\Users\\Allan Castro\\Documents\\localdev\\IPESAH\\DOLE";
const present = existsSync(join(DIR, "main.rev")) && existsSync(join(DIR, "main.iri"));

describe("main.iri golden (S3)", () => {
	it.skipIf(!present)("regenerates DOLE main.iri byte-for-byte", () => {
		const rev = parseRev(readFileSync(join(DIR, "main.rev"), "utf8"));
		const expected = readFileSync(join(DIR, "main.iri"));
		expect(Buffer.compare(Buffer.from(iriBytes(generateMainIri(rev))), expected)).toBe(0);
	});
});
