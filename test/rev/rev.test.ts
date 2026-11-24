import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRev, resolveImage } from "../../src/rev";

// Normalize checkout line endings before constructing both fixture variants.
const lf = readFileSync(join(__dirname, "../fixtures/rev/sample.rev"), "utf8").replace(/\r\n/g, "\n");
const raw = "\uFEFF" + lf.replace(/\n/g, "\r\n");
const model = parseRev(raw);
const w = (id: number) => model.widgets.find((x) => x.id === id)!;

describe("parseRev text handling", () => {
  it("gives the same model with BOM+CRLF, no BOM, and LF", () => {
    expect(parseRev(lf)).toEqual(model);
    expect(parseRev(raw.slice(1))).toEqual(model);
  });
  it("parses a CRLF database fixture without retaining line endings", () => {
    const crlf = "<Indicator>\r\n<Config>\r\nDB.SCHEMA#3=20,0,Id,3,4\r\nDB.ALIAS#3=Orders\r\n</Config>\r\n</Indicator>";
    expect(parseRev(crlf).databases).toEqual([{ index: 3, name: "Orders", maxRecords: 20, fields: [{ name: "Id", typeCode: 3, typeName: "integer", size: 4 }] }]);
    expect(parseRev(crlf)).toEqual(parseRev(crlf.replace(/\r\n/g, "\n")));
  });
  it("reads the header", () => {
    expect(model.header).toEqual({
      revision: "1.0.0.1",
      indicatorModel: "1280",
      indicatorVersion: "2.06-2.07",
      childAssembly: "rev1280.test.dll",
      configHash: "1 2 3 4 ",
      codFile: "C:\\Synthetic\\Project\\main.cod",
    });
  });
  it("parses config KEY#index=value and KEY=value with line numbers", () => {
    const e = model.config.filter((c) => c.key === "SC.ALIAS");
    expect(e).toEqual([{ key: "SC.ALIAS", index: 1, value: "SCALE_1", line: 9 }]);
    const plain = model.config.find((c) => c.key === "PLAIN")!;
    expect(plain.index).toBeUndefined();
    expect(plain.value).toBe("yes");
  });
  it("decodes XML entities", () => {
    const e = model.config.find((c) => c.key === "SKT.TEXT")!;
    expect(e.value).toBe("a <NL> b & \"c\" 'd' AB");
  });
  it("extracts CustomData", () => {
    expect(model.customData.hash).toBe("9 8 7 ");
    expect(model.customData.printers).toBe("CUSTOMCOLORS=1|2|3\nPRINTER#1=x");
  });
});

describe("widgets", () => {
  it("type 7 image", () => {
    expect(w(1)).toMatchObject({ type: 7, typeName: "image", screen: 4, x: 112, y: 242, width: 260, height: 60, image: "buttonG.png", alias: "imIn" });
    expect(w(2).image).toBe("local://9.png");
  });
  it("type 4 label", () => {
    expect(w(4)).toMatchObject({ typeName: "label", x: 10, y: 20, width: 100, height: 30, text: "Plain <NL>", fontSize: 12, color: "Black", alias: "lbl4", screen: 3 });
  });
  it("type 4 label text containing commas is parsed from both ends", () => {
    expect(w(3)).toMatchObject({ text: "Hello, world", fontSize: 18, color: "#BB0000", alias: "lbl3", screen: 7 });
  });
  it("type 3 bargraph", () => {
    expect(w(5)).toMatchObject({ typeName: "bargraph", x: 618, y: 106, width: 161, height: 62, color: "Black", alias: "barSet5", screen: 8 });
  });
  it("type 10 line", () => {
    expect(w(6)).toMatchObject({ typeName: "line", x: 9, y: 253, width: 675, height: 1, color: "Silver", screen: 2 });
    expect(w(6).alias).toBeUndefined();
  });
  it("type 1 scale display", () => {
    expect(w(7)).toMatchObject({ typeName: "scale", x: 119, y: 2, screen: 9, foreground: "#393939", background: "#F0EEEE" });
  });
  it("type 6 symbol", () => {
    expect(w(8)).toMatchObject({ typeName: "symbol", x: 46, y: 90, alias: "sym8", screen: 4 });
  });
  it("keeps raw fields and line", () => {
    expect(w(6).raw).toEqual(["10", "9", "253", "675", "1", "1", "1", "Silver", "2"]);
    expect(w(1).line).toBe(model.config.find((c) => c.key === "WDGT" && c.index === 1)!.line);
  });
  it("tolerates unknown types and short records with diagnostics", () => {
    expect(w(9)).toMatchObject({ typeName: "unknown", type: 99, raw: ["99", "1", "2", "3"] });
    expect(w(9).screen).toBeUndefined();
    expect(w(10)).toMatchObject({ typeName: "unknown", type: 4 });
    expect(w(10).screen).toBeUndefined();
    const lines = model.diagnostics.map((d) => d.line);
    expect(lines).toContain(w(9).line);
    expect(lines).toContain(w(10).line);
    expect(model.diagnostics.every((d) => d.message.length > 0)).toBe(true);
  });
  it("does not throw on garbage", () => {
    expect(() => parseRev("")).not.toThrow();
    expect(() => parseRev("<Indicator><Config>WDGT#x=1\nWDGT#3=\nDB.SCHEMA#1=a</Config>")).not.toThrow();
    expect(parseRev("").diagnostics.length).toBeGreaterThan(0);
  });
});

describe("screens", () => {
  it("groups widgets by screen number, sorted, skipping unknown", () => {
    expect(model.screens).toEqual([
      { number: 2, widgetIds: [2, 6] },
      { number: 3, widgetIds: [4] },
      { number: 4, widgetIds: [1, 8] },
      { number: 7, widgetIds: [3] },
      { number: 8, widgetIds: [5] },
      { number: 9, widgetIds: [7] },
    ]);
  });
});

describe("databases", () => {
  it("pairs DB.SCHEMA with DB.ALIAS", () => {
    expect(model.databases).toEqual([
      {
        index: 1, name: "Inbound", maxRecords: 1000,
        fields: [
          { name: "Id", typeCode: 7, typeName: "string", size: 15 },
          { name: "Weight", typeCode: 4, typeName: "real", size: 4 },
          { name: "Count", typeCode: 2, typeName: "integer", size: 2 },
        ],
      },
      { index: 2, name: "Product", maxRecords: 100, fields: [{ name: "Code", typeCode: 6, typeName: "string", size: 10 }] },
    ]);
  });
});

describe("aliases", () => {
  const of = (k: string) => model.aliases.filter((a) => a.kind === k);
  it("scales", () => expect(of("scale")).toEqual([{ kind: "scale", name: "SCALE_1", index: 1 }]));
  it("setpoints skip empty names", () => expect(of("setpoint")).toEqual([{ kind: "setpoint", name: "SP_ONE", index: 1 }]));
  it("ports", () => expect(of("port")).toEqual([{ kind: "port", name: "Port1", index: 1 }]));
  it("digital I/O uses bit as index and card", () =>
    expect(of("dio")).toEqual([
      { kind: "dio", name: "BIT1", index: 1, card: 0 },
      { kind: "dio", name: "BIT2", index: 2, card: 1 },
    ]));
  it("widgets use the widget id as index", () => {
    expect(of("widget")).toContainEqual({ kind: "widget", name: "lbl3", index: 3 });
    expect(of("widget")).toContainEqual({ kind: "widget", name: "imIn", index: 1 });
  });
});

describe("resolveImage", () => {
  it("maps file names to sdimages", () => {
    expect(resolveImage("buttonG.png", "/p")).toEqual({ kind: "file", relPath: "sdimages/buttonG.png" });
  });
  it("maps local:// to builtin", () => {
    expect(resolveImage("local://9.png", "/p")).toEqual({ kind: "builtin", id: "9.png" });
  });
});
