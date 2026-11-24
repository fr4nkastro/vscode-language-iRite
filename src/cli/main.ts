// Entry of the headless `.rev` CLI, bundled by esbuild to dist/rev-cli.js (no runtime dependencies).
import * as fs from "node:fs";
import { runCli } from "./revCli";

const result = runCli(process.argv.slice(2), {
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
});
if (result.out) {
	fs.writeFileSync(result.out.path, result.out.content, "utf8");
}
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
process.exitCode = result.code;
