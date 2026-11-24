/**
 * `main.iri` generator (pure, no `vscode` import): reproduces the file Revolution writes with
 * File > "Generate iRite Import File" from the `Config` lines of a `.rev`. Rules and evidence: `docs/rev-format.md`.
 * Output is CRLF text; it is written as UTF-8 without a BOM.
 */
import type { RevModel } from "../rev";
import { widgetTypeDef } from "../rev/widgetCatalog";

const NL = "\r\n";

const DB_TYPES: Record<number, string> = { 1: "Integer", 2: "Integer", 3: "Integer", 4: "Real", 5: "Real", 6: "String", 7: "String", 8: "DateTime" };

const pad = (s: string, n: number): string => s.padEnd(n);

/** First value of each config line (a repeated line keeps its first occurrence). */
function lookup(rev: RevModel): { get: (name: string, index?: number) => string | undefined; indexes: (name: string) => number[] } {
	const map = new Map<string, string>();
	for (const c of rev.config) {
		const id = c.index === undefined ? c.key : `${c.key}#${c.index}`;
		if (!map.has(id)) {
			map.set(id, c.value);
		}
	}
	return {
		get: (name, index) => map.get(index === undefined ? name : `${name}#${index}`),
		indexes: (name) => [...new Set(rev.config.filter((c) => c.key === name && c.index !== undefined).map((c) => c.index as number))].sort((a, b) => a - b),
	};
}

export function generateMainIri(rev: RevModel): string {
	const { get, indexes } = lookup(rev);
	const out: string[] = [];
	const constant = (alias: string, n: number, space = " "): string => `${pad(alias, 10)}: constant integer :=${space}${n};`;
	const section = (header: string, lines: string[]): void => {
		out.push(header, ...lines, "");
	};

	section(
		"-- Scale Aliases",
		indexes("SC.ALIAS")
			.filter((n) => (get("SC.KIND", n) ?? "").toUpperCase() !== "NONE")
			.map((n) => constant(get("SC.ALIAS", n) ?? "", n)),
	);

	// Digital I/O: cards are the distinct `#c` of `DIO.ALIAS.<bit>#<c>`.
	const dio = new Map<number, Map<number, string>>();
	for (const c of rev.config) {
		const m = /^DIO\.ALIAS\.(\d+)$/.exec(c.key);
		if (m && c.index !== undefined) {
			const bits = dio.get(c.index) ?? new Map<number, string>();
			if (!bits.has(Number(m[1]))) {
				bits.set(Number(m[1]), c.value);
			}
			dio.set(c.index, bits);
		}
	}
	const dioLines: string[] = [];
	for (const card of [...dio.keys()].sort((a, b) => a - b)) {
		const bits = dio.get(card) as Map<number, string>;
		dioLines.push(`DIOCRD${pad(String(card), 4)}: constant integer := ${card};`);
		for (let bit = 1; bit <= bits.size; bit++) {
			dioLines.push(constant(bits.get(bit) ?? "", bit));
		}
		dioLines.push("", "");
	}
	section("-- Digital I/O Aliases", dioLines);

	section("-- Analog Output Aliases", indexes("ALG.ALIAS").map((n) => constant(get("ALG.ALIAS", n) ?? "", n)));

	// Database: type declarations, then the column-index constants.
	const tables = indexes("DB.SCHEMA").map((n) => {
		const tokens = (get("DB.SCHEMA", n) ?? "").split(",");
		const fields: { name: string; code: string }[] = [];
		for (let j = 2; j + 1 < tokens.length; j += 3) {
			fields.push({ name: tokens[j], code: tokens[j + 1] });
		}
		return { alias: get("DB.ALIAS", n) ?? "", fields };
	});
	const db: string[] = [];
	for (const t of tables) {
		db.push(`type ${t.alias}Database is database ("${t.alias}")`);
		for (const f of t.fields) {
			db.push(`${f.name.padStart(10)}: ${DB_TYPES[Number(f.code)] ?? "None"};`);
		}
		db.push("end database;");
	}
	db.push("");
	for (const t of tables) {
		t.fields.forEach((f, k) => db.push(`${t.alias}_${pad(f.name, 9)}: constant integer := ${k + 1};`));
		db.push("");
	}
	db.push("");
	section("-- Database Type Definitions and Field Aliases", db);

	section("-- Serial Port Aliases", indexes("EDP.ALIAS").map((n) => constant(get("EDP.ALIAS", n) ?? "", n)));

	section(
		"-- Ethernet Communication Aliases",
		["TCPS", "UDPS", "TCPC1", "TCPC2", "TCPC3"].map((k) => `${pad(get(`${k}.NAME`) ?? "", 10)}: constant string := "${k}";`),
	);

	section(
		"-- Setpoint Aliases",
		indexes("SP.ALIAS")
			.filter((n) => (get("SP.KIND", n) ?? "").toUpperCase() !== "OFF")
			.map((n) => constant(get("SP.ALIAS", n) ?? "", n, "")),
	);

	const widgetLines: string[] = [];
	for (const w of [...rev.widgets].sort((a, b) => a.id - b.id)) {
		if (!widgetTypeDef(w.type)?.hasAlias) {
			continue;
		}
		const alias = w.type === 9 ? `sk${w.id}` : w.type === 10 ? `line${w.id}` : (w.alias ?? "");
		widgetLines.push(constant(alias, w.id));
	}
	section("-- Widget Aliases", widgetLines);

	out.push(`${pad("USBPRN", 10)}: constant string := "USBPRN";`, `${pad("ADVPRN", 10)}: constant string := "ADVPRN";`, "");
	return out.join(NL);
}
