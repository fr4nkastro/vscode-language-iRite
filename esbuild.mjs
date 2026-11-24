// Bundles the extension host code and the headless .rev CLI (Node, CommonJS). Usage: node esbuild.mjs [--production] [--watch]
import * as esbuild from "esbuild";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

const common = {
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node18",
  sourcemap: !production,
  minify: production,
  logLevel: "info",
};

const builds = [
  { ...common, entryPoints: ["src/extension.ts"], outfile: "dist/extension.js", external: ["vscode"] },
  // Headless CLI (screens / widgets / render), no vscode import and no runtime dependencies.
  { ...common, entryPoints: ["src/cli/main.ts"], outfile: "dist/rev-cli.js", banner: { js: "#!/usr/bin/env node" } },
];

if (watch) {
  for (const options of builds) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
  }
} else {
  for (const options of builds) {
    await esbuild.build(options);
  }
}
