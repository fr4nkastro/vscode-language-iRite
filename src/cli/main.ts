// Entry of the headless `.rev` CLI, bundled by esbuild to dist/rev-cli.js (no runtime dependencies).
import * as fs from "node:fs";
import { nodeIo } from "./nodeIo";
import { runCli } from "./revCli";

const result = runCli(process.argv.slice(2), nodeIo());
if (result.out) {
	fs.writeFileSync(result.out.path, result.out.content, "utf8");
}
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
process.exitCode = result.code;
