/** Pure SFC/Grafcet model derived from the IPESAH Petri FSM. No `vscode` imports. */
import type { IriteCall, IriteProjectModel, IriteRoutine } from "../irite";

export interface SfcStep {
	name: string;
	/** Routine `CmdX` called from the `HandlerStates`-style dispatcher under `GetState(...) = Step`. */
	entryRoutine?: string;
	/** Location of the entry routine. */
	source?: { file: string; line: number };
	initial: boolean;
}

export interface SfcEmitter {
	routine: string;
	file: string;
	line: number;
	conditions: string[];
	/** Emitting call name, e.g. `CmdSetTransition`. */
	via: string;
	/** Source steps of this emitter; [] = any step. */
	sources?: string[];
}

export interface SfcTransition {
	name: string;
	target?: string;
	/** Union of the specific source steps. [] with `anyStep` = from any step; [] without = never emitted. */
	sources: string[];
	/** True when at least one emitter has no identifiable source step (global transition). */
	anyStep: boolean;
	emitters: SfcEmitter[];
}

export interface SfcDiagnostic {
	severity: "warning" | "info";
	message: string;
	file?: string;
	line?: number;
}

export interface SfcModel {
	steps: SfcStep[];
	transitions: SfcTransition[];
	diagnostics: SfcDiagnostic[];
}

export interface SfcOptions {
	statesEnum?: string;
	transitionsEnum?: string;
	initialStep?: string;
	/** Callee names that emit a transition (last argument = transition). */
	emitters?: string[];
}

const DEFAULT_EMITTERS = ["CmdSetTransition", "SetHandlerTransition", "CmdSetTransitionFromHandler"];
const SENTINELS = new Set(["nullstate", "nulltransition"]);
const INITIAL_NAMES = ["standby", "idle", "init"];

const lc = (s: string): string => s.toLowerCase();

/** Removes `not (...)` groups (balanced) so negated comparisons are not read as positive ones. */
function stripNegations(cond: string): string {
	let out = cond;
	for (;;) {
		const m = /\bnot\s*\(/i.exec(out);
		if (!m) {
			return out;
		}
		let depth = 0;
		let end = out.length;
		for (let i = m.index + m[0].length - 1; i < out.length; i++) {
			if (out[i] === "(") {
				depth++;
			} else if (out[i] === ")" && --depth === 0) {
				end = i + 1;
				break;
			}
		}
		out = out.slice(0, m.index) + " " + out.slice(end);
	}
}

/** Members of `set` compared with `=` in `cond` (a `<>` or negated comparison is excluded). */
function equalities(cond: string, set: Set<string>): string[] {
	const found: string[] = [];
	const re = /(?<![<>:])=\s*([A-Za-z_]\w*)/g;
	const text = stripNegations(cond);
	for (let m = re.exec(text); m; m = re.exec(text)) {
		if (set.has(lc(m[1]))) {
			found.push(m[1]);
		}
	}
	return found;
}

function inequalities(cond: string, set: Set<string>): string[] {
	const found: string[] = [];
	const re = /GetState\s*\([^)]*\)\s*<>\s*([A-Za-z_]\w*)/gi;
	const text = stripNegations(cond);
	for (let m = re.exec(text); m; m = re.exec(text)) {
		if (set.has(lc(m[1]))) {
			found.push(m[1]);
		}
	}
	return found;
}

export function buildSfc(project: IriteProjectModel, opts: SfcOptions = {}): SfcModel {
	const statesName = lc(opts.statesEnum || "STATES");
	const transName = lc(opts.transitionsEnum || "TRANSITIONS");
	const emitterNames = new Set((opts.emitters ?? DEFAULT_EMITTERS).map(lc));
	const diagnostics: SfcDiagnostic[] = [];

	const statesEnum = project.enums.find((e) => lc(e.name) === statesName);
	const transEnum = project.enums.find((e) => lc(e.name) === transName);
	if (!statesEnum) {
		diagnostics.push({ severity: "warning", message: `Enum ${opts.statesEnum || "STATES"} not found` });
	}
	if (!transEnum) {
		diagnostics.push({ severity: "warning", message: `Enum ${opts.transitionsEnum || "TRANSITIONS"} not found` });
	}
	const stepNames = (statesEnum?.members ?? []).filter((m) => !SENTINELS.has(lc(m)));
	const transNames = (transEnum?.members ?? []).filter((m) => !SENTINELS.has(lc(m)));
	const stepSet = new Set(stepNames.map(lc));
	const transSet = new Set(transNames.map(lc));
	const canon = (names: string[], n: string): string => names.find((x) => lc(x) === lc(n)) ?? n;

	const routineByName = new Map<string, IriteRoutine>();
	for (const r of project.routines) {
		if (!r.forward && !routineByName.has(lc(r.name))) {
			routineByName.set(lc(r.name), r);
		}
	}

	// Entry routines: CmdX(...) called under GetState(...) = S.
	const entry = new Map<string, string>();
	for (const r of project.routines) {
		for (const c of r.calls) {
			if (!/^cmd/i.test(c.callee) || emitterNames.has(lc(c.callee)) || !routineByName.has(lc(c.callee))) {
				continue;
			}
			const last = c.conditions[c.conditions.length - 1];
			if (last === undefined || !/GetState\s*\(/i.test(last)) {
				continue;
			}
			for (const s of equalities(last, stepSet)) {
				if (!entry.has(lc(s))) {
					entry.set(lc(s), routineByName.get(lc(c.callee))!.name);
				}
			}
		}
	}

	// Targets: SetState(m, s, X) under `<ident> = T`.
	const target = new Map<string, string>();
	for (const r of project.routines) {
		for (const c of r.calls) {
			if (lc(c.callee) !== "setstate" || c.args.length < 3 || !stepSet.has(lc(c.args[c.args.length - 1]))) {
				continue;
			}
			const x = canon(stepNames, c.args[c.args.length - 1]);
			for (let i = c.conditions.length - 1; i >= 0; i--) {
				const ts = equalities(c.conditions[i], transSet);
				if (ts.length === 0) {
					continue;
				}
				for (const t of ts) {
					const prev = target.get(lc(t));
					if (prev === undefined) {
						target.set(lc(t), x);
					} else if (lc(prev) !== lc(x)) {
						diagnostics.push({ severity: "warning", message: `Transition ${t} has conflicting targets ${prev} and ${x}`, file: r.file, line: c.line });
					}
				}
				break;
			}
		}
	}

	const sourcesFor = (r: IriteRoutine, c: IriteCall): string[] => {
		// (a) entry routine of a step
		const entered = stepNames.filter((s) => {
			const e = entry.get(lc(s));
			return e !== undefined && lc(e) === lc(r.name);
		});
		if (entered.length > 0) {
			return entered;
		}
		// (b) states in the conditions, narrowed across nesting levels
		let acc: Set<string> | undefined;
		for (const cond of c.conditions) {
			const eq = equalities(cond, stepSet).map(lc);
			if (eq.length === 0) {
				continue;
			}
			const next = new Set(eq);
			if (!acc) {
				acc = next;
			} else {
				const inter = new Set([...acc].filter((x) => next.has(x)));
				acc = inter.size > 0 ? inter : next;
			}
		}
		if (acc && acc.size > 0) {
			const keep = acc;
			return stepNames.filter((s) => keep.has(lc(s)));
		}
		// (c) earlier guard `GetState(...) <> S` (followed by return) in the same routine
		const guards = new Set<string>();
		for (const other of r.calls) {
			if (other.line >= c.line) {
				continue;
			}
			for (const cond of other.conditions) {
				if (c.conditions.includes(cond)) {
					continue;
				}
				for (const s of inequalities(cond, stepSet)) {
					guards.add(lc(s));
				}
			}
		}
		if (guards.size > 0) {
			return stepNames.filter((s) => guards.has(lc(s)));
		}
		return [];
	};

	const emittersByTransition = new Map<string, SfcEmitter[]>();
	for (const r of project.routines) {
		for (const c of r.calls) {
			if (!emitterNames.has(lc(c.callee)) || c.args.length === 0) {
				continue;
			}
			const t = c.args[c.args.length - 1];
			if (!transSet.has(lc(t))) {
				continue;
			}
			const list = emittersByTransition.get(lc(t)) ?? [];
			list.push({ routine: r.name, file: r.file, line: c.line, conditions: [...c.conditions], via: c.callee, sources: sourcesFor(r, c) });
			emittersByTransition.set(lc(t), list);
		}
	}

	const transitions: SfcTransition[] = transNames.map((name) => {
		const emitters = emittersByTransition.get(lc(name)) ?? [];
		const specific = new Set(emitters.flatMap((e) => (e.sources ?? []).map(lc)));
		return {
			name,
			target: target.get(lc(name)),
			sources: stepNames.filter((s) => specific.has(lc(s))),
			anyStep: emitters.some((e) => (e.sources ?? []).length === 0),
			emitters,
		};
	});

	let initialName = opts.initialStep ? stepNames.find((s) => lc(s) === lc(opts.initialStep!)) : undefined;
	initialName ??= stepNames.find((s) => INITIAL_NAMES.includes(lc(s)));
	initialName ??= stepNames[0];

	const steps: SfcStep[] = stepNames.map((name) => {
		const entryRoutine = entry.get(lc(name));
		const routine = entryRoutine ? routineByName.get(lc(entryRoutine)) : undefined;
		return {
			name,
			entryRoutine,
			source: routine ? { file: routine.file, line: routine.line } : undefined,
			initial: name === initialName,
		};
	});

	// Diagnostics
	if (initialName) {
		const reach = new Set<string>([lc(initialName)]);
		let changed = true;
		while (changed) {
			changed = false;
			for (const t of transitions) {
				if (!t.target || reach.has(lc(t.target))) {
					continue;
				}
				// A global emitter can fire from any (reachable) step, so its target is reachable.
				if (t.anyStep || t.sources.some((s) => reach.has(lc(s)))) {
					reach.add(lc(t.target));
					changed = true;
				}
			}
		}
		for (const s of steps) {
			if (!reach.has(lc(s.name))) {
				diagnostics.push({ severity: "warning", message: `Step ${s.name} is unreachable from the initial step ${initialName}`, ...s.source });
			}
		}
	}
	for (const t of transitions) {
		if (!t.target) {
			diagnostics.push({ severity: "warning", message: `Transition ${t.name} has no target (no SetState found)` });
		}
		if (t.emitters.length === 0) {
			diagnostics.push({ severity: "warning", message: `Transition ${t.name} is never emitted` });
		}
	}
	for (const s of steps) {
		if (!s.entryRoutine) {
			diagnostics.push({ severity: "info", message: `Step ${s.name} has no entry routine` });
		}
	}
	return { steps, transitions, diagnostics };
}
