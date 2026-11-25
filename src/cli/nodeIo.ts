// Node-backed IO for the headless CLI (no `vscode` import). Shared by `main.ts` and the tests.
import * as fs from "node:fs";
import type { CliIo } from "./revCli";

export function nodeIo(now: () => Date = () => new Date()): CliIo {
	return {
		readText: (p) => {
			try {
				return fs.readFileSync(p, "utf8");
			} catch {
				return undefined;
			}
		},
		readBinary: (p) => {
			try {
				return fs.readFileSync(p);
			} catch {
				return undefined;
			}
		},
		exists: (p) => fs.existsSync(p),
		now,
		writeFs: {
			exists: (p) => fs.existsSync(p),
			// Exclusive: never replaces an existing file.
			writeFile: (p, data) => fs.writeFileSync(p, data, { flag: "wx" }),
			copyExcl: (from, to) => fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL),
			rename: (from, to) => fs.renameSync(from, to),
			remove: (p) => fs.rmSync(p, { force: true }),
		},
	};
}
