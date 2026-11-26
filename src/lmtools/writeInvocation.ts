import { runCli } from "../cli/revCli";
import type { CliIo, CliResult } from "../cli/revCli";
import { sha256 } from "../cli/writeCore";
import { confine } from "./paths";
import type { ToolContext, ToolOutput } from "./tools";

export interface WritePlan {
	file: string;
	command: string;
	fileHash: string | null;
	changes: { op?: string }[];
	warnings: string[];
}

const fail = (error: string): ToolOutput => ({ ok: false, text: JSON.stringify({ ok: false, error }) });
const output = (r: CliResult): ToolOutput => {
	try { return { ok: r.code === 0, text: JSON.stringify(JSON.parse(r.stdout)) }; }
	catch { return fail(r.stderr.trim() || "rev-cli did not return a JSON result"); }
};

/** One invocation owns its preview, snapshots and human approval. No state flows between tool calls. */
export async function runWriteInvocation(
	argv: readonly string[], ctx: ToolContext, apply: boolean,
	confirm?: (plan: WritePlan) => Promise<boolean>, cancelled: () => boolean = () => false,
): Promise<ToolOutput> {
	if (argv.includes("--write") || argv.includes("--expect-hash")) return fail("Unexpected write-control option");
	const raw = ctx.io;
	const checked = (p: string) => {
		const r = confine(p, ctx);
		if (!r.ok) throw new Error(r.error);
		return r.path;
	};
	const snapshots = new Map<string, (current?: { value: unknown; real?: string }) => void>();
	let violation: string | undefined;
	let phase: "plan" | "apply" | "written" = "plan";
	const read = <T>(kind: string, p: string, fn: (p: string) => T, compare: (v: T) => unknown = v => v): T => {
		try {
			p = checked(p);
			const data = fn(p);
			if (phase !== "written") {
				const key = `${kind}:${p}`;
				const existing = snapshots.get(key);
				if (existing) existing({ value: compare(data), real: ctx.realpath?.(p) });
				else if (phase === "apply") throw new Error(`Stale plan: a new dependency appeared at ${p}`);
				else {
					const before = compare(data);
					const real = ctx.realpath?.(p);
					snapshots.set(key, (current = { value: compare(fn(checked(p))), real: ctx.realpath?.(p) }) => {
						if (current.real !== real || current.value !== before) throw new Error(`Stale plan: ${p} changed`);
					});
				}
			}
			return data;
		} catch (e) {
			violation ??= e instanceof Error ? e.message : String(e);
			throw e;
		}
	};
	const io: CliIo = {
		readText: p => read("text", p, raw.readText),
		readBinary: p => read("bytes", p, at => {
			const value = raw.readBinary(at);
			if (value === undefined && raw.exists(at)) throw new Error(`Cannot read ${at}`);
			return value;
		}, b => b === undefined ? null : sha256(b)),
		exists: p => read("exists", p, raw.exists),
		now: raw.now,
	};
	const unchanged = () => {
		if (violation) throw new Error(violation);
		if (cancelled()) throw new Error("Write cancelled; the target was not replaced");
		for (const check of snapshots.values()) check();
	};
	try {
		if (cancelled()) return fail("Tool cancelled");
		// Regeneration's CLI fileHash covers the .iri target. Bind the source bytes separately.
		if (argv[0] === "regen-iri") io.readBinary(argv[1]);
		const dryRun = runCli([...argv], io);
		if (violation) return fail(violation);
		if (dryRun.code !== 0 || !apply) return output(dryRun);
		const plan = JSON.parse(dryRun.stdout) as WritePlan;
		if (!plan.changes.some(change => change.op !== "unchanged")) return output(dryRun);
		const fs = raw.writeFs;
		if (!fs) return fail("Writing is not available");
		if (!confirm || !await confirm(plan) || cancelled()) return fail("Write cancelled; nothing was written");
		unchanged();
		phase = "apply";
		io.writeFs = {
			exists: p => fs.exists(checked(p)),
			copyExcl: (from, to) => { unchanged(); fs.copyExcl(checked(from), checked(to)); },
			writeFile: (p, b) => { unchanged(); fs.writeFile(checked(p), b); },
			rename: (from, to) => { unchanged(); fs.rename(checked(from), checked(to)); phase = "written"; },
			remove: p => fs.remove(checked(p)),
		};
		const written = runCli([...argv, "--write", ...(plan.fileHash === null ? [] : ["--expect-hash", plan.fileHash])], io);
		return violation && written.code === 0 ? fail(violation) : output(written);
	} catch (e) {
		return fail(violation ?? (e instanceof Error ? e.message : String(e)));
	}
}
