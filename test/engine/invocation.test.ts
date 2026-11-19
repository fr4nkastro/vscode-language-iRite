import { describe, expect, it } from "vitest";
import { engineArgs, engineInvocation, isWineMissing } from "../../src/engine/invocation";

const exe = "C:\\Program Files (x86)\\Rice Lake Weighing Systems\\Revolution\\iRite Editor\\iRite_preprocessor.exe";

describe("engineInvocation", () => {
  it("runs the engine directly on Windows", () => {
    expect(engineInvocation(exe, ["main.src", "C:\\Compilers", "build"], "win32")).toEqual({
      command: exe,
      args: ["main.src", "C:\\Compilers", "build"],
    });
  });

  it("runs the engine through wine elsewhere", () => {
    expect(engineInvocation("/wine/iRite_preprocessor.exe", ["main.src", "C:\\Compilers", "deploy"], "linux")).toEqual({
      command: "wine",
      args: ["/wine/iRite_preprocessor.exe", "main.src", "C:\\Compilers", "deploy"],
    });
  });
});

describe("engineArgs", () => {
  it("passes source file, compiler folder and action in that order", () => {
    expect(engineArgs("D:\\p\\main.src", "C:\\Compilers", "build")).toEqual(["D:\\p\\main.src", "C:\\Compilers", "build"]);
    expect(engineArgs("D:\\p\\main.src", "C:\\Compilers", "deploy")).toEqual(["D:\\p\\main.src", "C:\\Compilers", "deploy"]);
  });
});

describe("isWineMissing", () => {
  it("is true only for ENOENT outside Windows", () => {
    expect(isWineMissing({ code: "ENOENT" }, "linux")).toBe(true);
    expect(isWineMissing({ code: "ENOENT" }, "win32")).toBe(false);
    expect(isWineMissing({ code: 1 }, "darwin")).toBe(false);
    expect(isWineMissing(null, "linux")).toBe(false);
  });
});
