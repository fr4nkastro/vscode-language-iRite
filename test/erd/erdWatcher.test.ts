import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ commands: new Map<string, Function>(), events: [] as Function[], panels: [] as any[], names: ['main.rev'], reads: [] as string[], writes: [] as string[], revs: [] as any[] }));
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
vi.mock('fs', () => ({ readdirSync: () => mocks.names, readFileSync: (file: string) => { mocks.reads.push(file); return Buffer.from('<Indicator><ConfigHash value="x"/><Config>\nDB.SCHEMA#1=10,0,A,3,4\nDB.ALIAS#1=T\n</Config></Indicator>'); }, existsSync: () => false, copyFileSync: (file: string) => mocks.writes.push(file), writeFileSync: (file: string) => mocks.writes.push(file), renameSync: (file: string) => mocks.writes.push(file), statSync: () => ({mode: 0o644}), constants: {COPYFILE_EXCL: 1} }));
vi.mock('../../src/commands/locateProject', () => ({ locateMainSrc: async () => '/project/main.src', readText: () => '' }));
vi.mock('../../src/irite', () => ({ loadIriteProject: () => ({ files: [], databases: [], routines: [], diagnostics: [] }) }));
vi.mock('../../src/erd/erdModel', () => ({ buildErd: (_project: unknown, rev: unknown) => { mocks.revs.push(rev); return { tables: [], relations: [], diagnostics: [] }; } }));

afterEach(() => { vi.useRealTimers(); vi.resetModules(); mocks.commands.clear(); mocks.events.length = 0; mocks.panels.length = 0; mocks.reads.length = 0; mocks.writes.length = 0; mocks.revs.length = 0; mocks.names = ['main.rev']; vi.clearAllMocks(); });
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
 expect(panel.webview.html).toBe(refreshed); // cancelled save retains staged changes
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

it('preserves the no-rev message', async () => {
 mocks.names = [];
 const { registerErdCommands } = await import('../../src/commands/erd');
 registerErdCommands({ subscriptions: [] } as any);
 await mocks.commands.get('irite.showErd')!();
 expect(mocks.panels[0].webview.html).toContain('No .rev available; schema editing is disabled.');
});
