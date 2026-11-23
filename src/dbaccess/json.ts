/**
 * Machine-readable hand-off for an MCP / agent: schema `irite.dbAccess.pending`, version 1.
 * Paths are project-relative with `/`. No `vscode` imports.
 */
import * as path from 'node:path';
import type { DbAccessReport } from './check';
import { PENDING_MARKER_TEXT, type DbAccessOptions } from './convention';
import { modulePath } from './scaffold';

export interface PendingItemJson {
	table: string;
	typeName: string;
	/** Field for getters/setters, else null. */
	field: string | null;
	group: string;
	operation: string;
	/** Routine name to implement. */
	routine: string;
	/** Expected declaration. */
	signature: string;
	/** What the routine must do. */
	description: string;
	status: 'missing' | 'pending';
	/** Existing stub (pending), null when the routine does not exist yet. */
	stub: { file: string; line: number } | null;
	/** Module where the scaffold would write the stub. */
	scaffoldTarget: string;
}

export interface PendingJson {
	schema: 'irite.dbAccess.pending';
	version: 1;
	/** Absolute path of the project's main.src. */
	mainSrc: string;
	convention: { prefix: string; moduleFolder: string; pendingMarker: string };
	tables: { table: string; typeName: string; file: string; line: number; excluded: boolean; expected: number; missing: number; pending: number }[];
	items: PendingItemJson[];
}

export function buildPendingJson(report: DbAccessReport, ctx: { mainSrcPath: string; options: DbAccessOptions }): PendingJson {
	const root = path.dirname(ctx.mainSrcPath);
	const rel = (p: string): string => path.relative(root, p).split(path.sep).join('/');
	const items: PendingItemJson[] = [];
	for (const t of report.tables) {
		for (const i of t.items) {
			items.push({
				table: t.table,
				typeName: t.typeName,
				field: i.expected.field ?? null,
				group: i.expected.group,
				operation: i.expected.operation,
				routine: i.expected.name,
				signature: i.expected.signature,
				description: i.expected.description,
				status: i.status,
				stub: i.stub ? { file: rel(i.stub.file), line: i.stub.line } : null,
				scaffoldTarget: modulePath(t.table, ctx.options.moduleFolder, '/'),
			});
		}
	}
	return {
		schema: 'irite.dbAccess.pending',
		version: 1,
		mainSrc: ctx.mainSrcPath,
		convention: { prefix: ctx.options.prefix, moduleFolder: ctx.options.moduleFolder, pendingMarker: PENDING_MARKER_TEXT },
		tables: report.tables.map(t => ({
			table: t.table,
			typeName: t.typeName,
			file: rel(t.file),
			line: t.line,
			excluded: t.excluded,
			expected: t.expected,
			missing: t.items.filter(i => i.status === 'missing').length,
			pending: t.items.filter(i => i.status === 'pending').length,
		})),
		items,
	};
}
