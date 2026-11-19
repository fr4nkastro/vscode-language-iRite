// Pure helpers for invoking Revolution's iRite_preprocessor.exe. No vscode import so they stay unit-testable.

export interface EngineInvocation {
  command: string;
  args: string[];
}

export type EngineAction = "build" | "deploy";

// The iRite build engine only ships for Windows. On Linux/macOS it runs through Wine.
export function engineInvocation(
  enginePath: string,
  args: string[],
  platform: NodeJS.Platform = process.platform
): EngineInvocation {
  if (platform === "win32") {
    return { command: enginePath, args };
  }
  return { command: "wine", args: [enginePath, ...args] };
}

export function engineArgs(sourceFile: string, compilerPath: string, action: EngineAction): string[] {
  return [sourceFile, compilerPath, action];
}

export function isWineMissing(
  error: { code?: string | number | null } | null,
  platform: NodeJS.Platform = process.platform
): boolean {
  return platform !== "win32" && error != null && error.code === "ENOENT";
}
