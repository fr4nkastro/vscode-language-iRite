import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ commands: new Map<string, Function>(), events: [] as Function[], panels: [] as any[], names: ['main.rev'], reads: [] as string[], writes: [] as string[], revs: [] as any[], disk: Buffer.from('<Indicator><ConfigHash value="x"/><Config>\nDB.SCHEMA#1=10,0,A,3,4\nDB.ALIAS#1=T\n</Config></Indicator>'), temp: Buffer.alloc(0), corrupt: false, backups: [] as string[] }));
vi.mock('vscode', () => ({
 RelativePattern: class { constructor(..._args: unknown[]) {} },
 ViewColumn: { Beside: 2, One: 1 },
 commands: { registerCommand: (id: string, fn: Function) => { mocks.commands.set(id, fn); return { dispose() {} }; } },
 workspace: { createFileSystemWatcher: () => ({ onDidChange: (fn: Function) => mocks.events.push(fn), onDidCreate() {}, onDidDelete() {}, dispose() {} }) },
 window: { createWebviewPanel: () => {
  const panel: any = { webview: { html: '', cspSource: 'vscode:', onDidReceiveMessage(fn: Function) { panel.receive = fn; }, postMessage: vi.fn() }, onDidDispose() {}, reveal: vi.fn() };
  mocks.panels.push(panel); return panel;
 }, showWarningMessage: vi.fn(), showInformationMessage: vi.fn() },
}));
vi.mock('fs', () => ({ readdirSync: () => mocks.names, readFileSync: (file: string) => { mocks.reads.push(file); return Buffer.from(mocks.disk); }, existsSync: () => false, copyFileSync: (file: string, backup: string) => { mocks.writes.push(file); mocks.backups.push(backup); }, writeFileSync: (file: string, data: Buffer) => { mocks.writes.push(file); mocks.temp = Buffer.from(data); }, renameSync: (file: string) => { mocks.writes.push(file); if (!mocks.corrupt) mocks.disk = Buffer.from(mocks.temp); }, statSync: () => ({mode: 0o644}), constants: {COPYFILE_EXCL: 1} }));
vi.mock('../../src/commands/locateProject', () => ({ locateMainSrc: async () => '/project/main.src', readText: () => '' }));
vi.mock('../../src/irite', () => ({ loadIriteProject: () => ({ files: [], databases: [], routines: [], diagnostics: [] }) }));
vi.mock('../../src/erd/erdModel', async importOriginal => {
 const actual = await importOriginal<typeof import('../../src/erd/erdModel')>();
 return { ...actual, buildErd: (project: Parameters<typeof actual.buildErd>[0], rev: Parameters<typeof actual.buildErd>[1]) => { mocks.revs.push(rev); return actual.buildErd(project, rev); } };
});

afterEach(() => { vi.useRealTimers(); vi.resetModules(); mocks.commands.clear(); mocks.events.length = 0; mocks.panels.length = 0; mocks.reads.length = 0; mocks.writes.length = 0; mocks.revs.length = 0; mocks.names = ['main.rev']; mocks.disk = Buffer.from('<Indicator><ConfigHash value="x"/><Config>\nDB.SCHEMA#1=10,0,A,3,4\nDB.ALIAS#1=T\n</Config></Indicator>'); mocks.corrupt = false; mocks.backups.length = 0; vi.clearAllMocks(); });
it('refreshes a clean read-only ERD with a rev when the watcher fires', async () => {
 vi.useFakeTimers();
 const { registerErdCommands } = await import('../../src/commands/erd');
 registerErdCommands({ subscriptions: [] } as any);
 await mocks.commands.get('irite.showErd')!();
 const panel = mocks.panels[0];
 const initial = panel.webview.html;
 mocks.events[0]();
 vi.advanceTimersByTime(301);
 expect(panel.webview.html).not.toBe(initial);
 let refreshed = panel.webview.html;
 let generation = Number(refreshed.match(/const generation = (\d+)/)[1]);
 // Messages from the replaced document cannot enter edit mode.
 await panel.receive({type:'erd-edit-mode', generation:generation - 1, editing:true});
 expect(panel.webview.postMessage).not.toHaveBeenCalled();
 await panel.receive({type:'erd-edit-mode', generation, editing:true});
 mocks.events[0](); vi.advanceTimersByTime(301);
 expect(panel.webview.html).toBe(refreshed);
 await panel.receive({type:'erd-edit-mode', generation, editing:false});
 expect(panel.webview.html).not.toBe(refreshed); // deferred event replayed
 refreshed = panel.webview.html;
 generation = Number(refreshed.match(/const generation = (\d+)/)[1]);
 await mocks.commands.get('irite.editDatabaseSchema')!();
 expect(mocks.panels).toHaveLength(1);
 expect(panel.reveal).toHaveBeenCalled();
 mocks.events[0](); vi.advanceTimersByTime(301);
 await panel.receive({type:'erd-edit-mode', generation, editing:false});
 expect(panel.webview.html).toBe(refreshed); // alias intent survives the old mode-off acknowledgement
 await panel.receive({type:'erd-edit-mode', generation, editing:true});
 await panel.receive({type:'erd-edit-request', generation, requestId:1, message:{type:'edit', edit:{kind:'updateTable', table:1, name:'Changed'}}});
 await panel.receive({type:'erd-edit-mode', generation, editing:false});
 expect(panel.webview.html).toBe(refreshed); // staged edit survives leaving edit mode
 await panel.receive({type:'erd-edit-mode', generation, editing:true});
 let finish!: (result: string | undefined) => void;
 const vscode = await import('vscode');
 vi.mocked(vscode.window.showWarningMessage).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }) as any);
 const saving = panel.receive({type:'erd-edit-request', generation, requestId:2, message:{type:'save'}});
 mocks.events[0](); vi.advanceTimersByTime(301);
 expect(panel.webview.html).toBe(refreshed); // modal save in flight
 finish(undefined); await saving;
 expect(panel.webview.html).toBe(refreshed); // cancelled save preserves the draft while editing
 await panel.receive({type:'erd-edit-mode', generation, editing:false});
 expect(panel.webview.html).not.toBe(refreshed); // cancellation releases the deferred refresh
});

it.each([['z.rev', 'a.rev'], ['main.rev', 'MAIN.REV']])('keeps ambiguous targets %s and %s readable but not writable', async (first, second) => {
 mocks.names = [first, second];
 const { registerErdCommands } = await import('../../src/commands/erd');
 registerErdCommands({ subscriptions: [] } as any);
 await mocks.commands.get('irite.editDatabaseSchema')!();
 const panel = mocks.panels[0];
 expect(mocks.revs[0]).toBeDefined();
 expect(mocks.reads[0]).toMatch(first === 'z.rev' ? /a\.rev$/ : /main\.rev$/i);
 expect(panel.webview.html).toContain('Multiple .rev files make the database write target ambiguous; schema editing is disabled.');
 expect(panel.webview.html).toMatch(/id="edit-toggle" type="checkbox" disabled/);
 const generation = Number(panel.webview.html.match(/const generation = (\d+)/)[1]);
 await panel.receive({type:'erd-edit-mode', generation, editing:true});
 await panel.receive({type:'erd-edit-request', generation, requestId:1, message:{type:'save'}});
 expect(panel.webview.postMessage).toHaveBeenCalledWith({type:'erd-edit-mode-state', generation, editing:false});
 expect(mocks.writes).toEqual([]);
});

it.each([['main.rev', 'alternate.rev'], ['alternate.rev']])('selects safe target and identifies it in confirmation: %s', async (...names) => {
 mocks.names = names;
 const { registerErdCommands } = await import('../../src/commands/erd');
 registerErdCommands({ subscriptions: [] } as any);
 await mocks.commands.get('irite.editDatabaseSchema')!();
 const panel = mocks.panels[0];
 expect(mocks.reads[0]).toMatch(new RegExp(names[0].replace('.', '\\.') + '$'));
 expect(panel.webview.html).toMatch(/id="edit-toggle" type="checkbox"\s+checked/);
 const generation = Number(panel.webview.html.match(/const generation = (\d+)/)[1]);
 await panel.receive({type:'erd-edit-request', generation, requestId:1, message:{type:'edit', edit:{kind:'updateTable', table:1, name:'Changed'}}});
 await panel.receive({type:'erd-edit-request', generation, requestId:2, message:{type:'save'}});
 const vscode = await import('vscode');
 expect(vi.mocked(vscode.window.showWarningMessage).mock.calls[0][0]).toContain(names[0]);
 expect(mocks.writes).toEqual([]); // confirmation cancelled
});

it('releases deferred refresh after reverting the model', async () => {
 vi.useFakeTimers();
 const { registerErdCommands } = await import('../../src/commands/erd');
 registerErdCommands({subscriptions:[]} as any);
 await mocks.commands.get('irite.editDatabaseSchema')!();
 const panel = mocks.panels[0], initial = panel.webview.html;
 const generation = Number(initial.match(/const generation = (\d+)/)[1]);
 const request = (requestId: number, message: unknown) => panel.receive({type:'erd-edit-request', generation, requestId, message});
 await request(1, {type:'edit', edit:{kind:'updateTable', table:1, name:'Changed'}});
 mocks.events[0](); vi.advanceTimersByTime(301);
 await request(2, {type:'edit', edit:{kind:'updateTable', table:1, name:'T'}});
 expect(panel.webview.html).toBe(initial);
 await panel.receive({type:'erd-edit-mode', generation, editing:false});
 expect(panel.webview.html).not.toBe(initial);
 expect(mocks.writes).toEqual([]);
});

it('reports a clean no-change save and refreshes after editing ends', async () => {
 vi.useFakeTimers();
 const { registerErdCommands } = await import('../../src/commands/erd');
 registerErdCommands({subscriptions:[]} as any);
 await mocks.commands.get('irite.editDatabaseSchema')!();
 const panel = mocks.panels[0], initial = panel.webview.html;
 const generation = Number(initial.match(/const generation = (\d+)/)[1]);
 mocks.events[0](); vi.advanceTimersByTime(301);
 await panel.receive({type:'erd-edit-request', generation, requestId:1, message:{type:'save'}});
 const vscode = await import('vscode');
 expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('iRite: No database schema changes to save.');
 expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
 expect(mocks.writes).toEqual([]);
 expect(panel.webview.html).toBe(initial);
 await panel.receive({type:'erd-edit-mode', generation, editing:false});
 expect(panel.webview.html).not.toBe(initial);
});

it.each(['irite.showErd', 'irite.editDatabaseSchema'])('rebuilds an unusable panel via %s and retains recovery guidance', async command => {
 mocks.corrupt = true;
 const { registerErdCommands } = await import('../../src/commands/erd');
 registerErdCommands({subscriptions:[]} as any);
 await mocks.commands.get('irite.editDatabaseSchema')!();
 const panel = mocks.panels[0], initial = panel.webview.html;
 const generation = Number(initial.match(/const generation = (\d+)/)[1]);
 await panel.receive({type:'erd-edit-request', generation, requestId:1, message:{type:'edit', edit:{kind:'updateTable', table:1, name:'Changed'}}});
 const vscode = await import('vscode');
 vi.mocked(vscode.window.showWarningMessage).mockResolvedValueOnce('Save and keep a backup' as any);
 await panel.receive({type:'erd-edit-request', generation, requestId:2, message:{type:'save'}});
 expect(panel.webview.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({disabled:true, feedback:expect.stringMatching(/restore the backup/i)}));
 const writes = mocks.writes.length, reads = mocks.reads.length;
 mocks.disk = Buffer.from(mocks.disk.toString().replace('DB.ALIAS#1=T', 'DB.ALIAS#1=Restored'));
 await mocks.commands.get(command)!();
 expect(mocks.panels).toHaveLength(1);
 expect(mocks.reads.length).toBeGreaterThan(reads);
 expect(panel.webview.html).not.toBe(initial);
 expect(panel.webview.html).toMatch(/restore the backup/i);
 expect(mocks.writes).toHaveLength(writes);
 expect(panel.webview.html).toMatch(command === 'irite.editDatabaseSchema' ? /id="edit-toggle" type="checkbox"\s+checked/ : /id="edit-toggle" type="checkbox"\s*>/);
 expect(panel.webview.html).toContain('Restored');
 const rebuiltGeneration = Number(panel.webview.html.match(/const generation = (\d+)/)[1]);
 if (command === 'irite.showErd') await panel.receive({type:'erd-edit-mode', generation:rebuiltGeneration, editing:true});
 await panel.receive({type:'erd-edit-request', generation:rebuiltGeneration, requestId:3, message:{type:'edit', edit:{kind:'updateTable', table:1, name:'EditedAgain'}}});
 expect(panel.webview.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({type:'erd-edit-state', disabled:false, diagram:expect.stringContaining('EditedAgain')}));
 expect(mocks.writes).toHaveLength(writes);
});

it('posts readback state and backup name on success, then refreshes after editing ends', async () => {
 vi.useFakeTimers();
 const { registerErdCommands } = await import('../../src/commands/erd');
 registerErdCommands({subscriptions:[]} as any);
 await mocks.commands.get('irite.editDatabaseSchema')!();
 const panel = mocks.panels[0], initial = panel.webview.html;
 const generation = Number(initial.match(/const generation = (\d+)/)[1]);
 await panel.receive({type:'erd-edit-request', generation, requestId:1, message:{type:'edit', edit:{kind:'updateTable', table:1, name:'Changed'}}});
 mocks.events[0](); vi.advanceTimersByTime(301);
 const vscode = await import('vscode');
 vi.mocked(vscode.window.showWarningMessage).mockResolvedValueOnce('Save and keep a backup' as any);
 await panel.receive({type:'erd-edit-request', generation, requestId:2, message:{type:'save'}});
 expect(mocks.disk.toString()).toContain('DB.ALIAS#1=Changed');
 expect(panel.webview.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({type:'erd-edit-state', requestId:2, diagram:expect.stringContaining('Changed'), readonly:expect.stringContaining('Changed')}));
 expect(vi.mocked(vscode.window.showInformationMessage)).toHaveBeenCalledWith(expect.stringContaining(mocks.backups[0].split(/[\\/]/).pop()!));
 expect(panel.webview.html).toBe(initial);
 await panel.receive({type:'erd-edit-mode', generation, editing:false});
 expect(panel.webview.html).not.toBe(initial);
});

it('preserves the no-rev message', async () => {
 mocks.names = [];
 const { registerErdCommands } = await import('../../src/commands/erd');
 registerErdCommands({ subscriptions: [] } as any);
 await mocks.commands.get('irite.showErd')!();
 expect(mocks.panels[0].webview.html).toContain('No .rev available; schema editing is disabled.');
});
