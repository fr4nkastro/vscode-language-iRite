import { describe, expect, it } from "vitest";
import { generateMainIri } from "../../src/iri/generateIri";
import { parseRev } from "../../src/rev";

const gen = (cfg: string[]): string => generateMainIri(parseRev(`<Indicator>\r\n<Config>\r\n${cfg.join("\r\n")}\r\n</Config>\r\n</Indicator>`));
const lines = (s: string): string[] => s.split("\r\n");
/** Lines between a header and the next header (exclusive), blank lines kept. */
const block = (s: string, header: string): string[] => {
	const l = lines(s);
	const i = l.indexOf(header);
	let j = l.findIndex((x, k) => k > i && x.startsWith("-- "));
	if (j < 0) {
		j = l.length;
	}
	return l.slice(i + 1, j);
};

const HEADERS = [
	"-- Scale Aliases",
	"-- Digital I/O Aliases",
	"-- Analog Output Aliases",
	"-- Database Type Definitions and Field Aliases",
	"-- Serial Port Aliases",
	"-- Ethernet Communication Aliases",
	"-- Setpoint Aliases",
	"-- Widget Aliases",
];

describe("generateMainIri", () => {
	it("empty config: headers in order, footer, CRLF, no BOM", () => {
		const s = gen([]);
		expect(s.charCodeAt(0)).not.toBe(0xfeff);
		expect(/(^|[^\r])\n/.test(s)).toBe(false);
		const found = lines(s).filter((x) => x.startsWith("-- "));
		expect(found).toEqual(HEADERS);
		expect(s.endsWith('USBPRN    : constant string := "USBPRN";\r\nADVPRN    : constant string := "ADVPRN";\r\n')).toBe(true);
		expect(block(s, "-- Widget Aliases")).toEqual(["", 'USBPRN    : constant string := "USBPRN";', 'ADVPRN    : constant string := "ADVPRN";', ""]);
	});

	it("scales: skips KIND NONE case-insensitively, ascending, pad 10, no truncation", () => {
		const s = gen(["SC.ALIAS#2=B", "SC.KIND#2=none", "SC.ALIAS#1=SCALE_1", "SC.KIND#1=Analog", "SC.ALIAS#3=VERYLONGNAME", "SC.KIND#3=NONE2"]);
		expect(block(s, "-- Scale Aliases")).toEqual(["SCALE_1   : constant integer := 1;", "VERYLONGNAME: constant integer := 3;", ""]);
	});

	it("digital I/O: card line, bits with empty alias, extra blank + blank per card", () => {
		const s = gen(["DIO.ALIAS.1#1=IN1", "DIO.ALIAS.2#1=", "DIO.ALIAS.1#12=X"]);
		expect(block(s, "-- Digital I/O Aliases")).toEqual([
			"DIOCRD1   : constant integer := 1;",
			"IN1       : constant integer := 1;",
			"          : constant integer := 2;",
			"",
			"",
			"DIOCRD12  : constant integer := 12;",
			"X         : constant integer := 1;",
			"",
			"",
			"",
		]);
	});

	it("analog outputs have no filter", () => {
		const s = gen(["ALG.ALIAS#2=AO2", "ALG.ALIAS#1=AO1"]);
		expect(block(s, "-- Analog Output Aliases")).toEqual(["AO1       : constant integer := 1;", "AO2       : constant integer := 2;", ""]);
	});

	it("database: right-aligned fields, type mapping, padded column constants, blank lines", () => {
		const s = gen([
			"DB.SCHEMA#2=10,0,B,3,4",
			"DB.ALIAS#2=Second",
			"DB.SCHEMA#1=10,0,Id,1,1,Name,7,20,W,5,8,T,8,8,Z,0,0,Q,99,1,F,4,4,S,6,5,L,2,2",
			"DB.ALIAS#1=First",
		]);
		expect(block(s, "-- Database Type Definitions and Field Aliases")).toEqual([
			'type FirstDatabase is database ("First")',
			"        Id: Integer;",
			"      Name: String;",
			"         W: Real;",
			"         T: DateTime;",
			"         Z: None;",
			"         Q: None;",
			"         F: Real;",
			"         S: String;",
			"         L: Integer;",
			"end database;",
			'type SecondDatabase is database ("Second")',
			"         B: Integer;",
			"end database;",
			"",
			"First_Id       : constant integer := 1;",
			"First_Name     : constant integer := 2;",
			"First_W        : constant integer := 3;",
			"First_T        : constant integer := 4;",
			"First_Z        : constant integer := 5;",
			"First_Q        : constant integer := 6;",
			"First_F        : constant integer := 7;",
			"First_S        : constant integer := 8;",
			"First_L        : constant integer := 9;",
			"",
			"Second_B        : constant integer := 1;",
			"",
			"",
			"",
		]);
	});

	it("serial ports and ethernet names (literal is always the key)", () => {
		const s = gen(["EDP.ALIAS#1=Port1", "TCPS.NAME=Srv", "TCPC2.NAME=Cli"]);
		expect(block(s, "-- Serial Port Aliases")).toEqual(["Port1     : constant integer := 1;", ""]);
		expect(block(s, "-- Ethernet Communication Aliases")).toEqual([
			'Srv       : constant string := "TCPS";',
			'          : constant string := "UDPS";',
			'          : constant string := "TCPC1";',
			'Cli       : constant string := "TCPC2";',
			'          : constant string := "TCPC3";',
			"",
		]);
	});

	it("setpoints: skips KIND OFF case-insensitively, no space before the number", () => {
		const s = gen(["SP.ALIAS#1=SP1", "SP.KIND#1=Off", "SP.ALIAS#2=SP2", "SP.KIND#2=Weight", "SP.ALIAS#3=SP3"]);
		expect(block(s, "-- Setpoint Aliases")).toEqual(["SP2       : constant integer :=2;", "SP3       : constant integer :=3;", ""]);
	});

	it("widgets: ascending id, derived sk/line aliases, types 1 and unknown skipped", () => {
		const s = gen([
			"WDGT#7=4,0,0,10,10,Hi,1,1,12,Black,lbHi,0,0,0,0,1",
			"WDGT#3=9,0,0,10,10,1",
			"WDGT#5=10,0,0,10,2,0,0,Black,1",
			"WDGT#2=1,0,0,0,0,1,Black,White",
			"WDGT#1=99,1,2,3",
		]);
		expect(block(s, "-- Widget Aliases").slice(0, 3)).toEqual([
			"sk3       : constant integer := 3;",
			"line5     : constant integer := 5;",
			"lbHi      : constant integer := 7;",
		]);
		expect(block(s, "-- Widget Aliases")[3]).toBe("");
	});
});
