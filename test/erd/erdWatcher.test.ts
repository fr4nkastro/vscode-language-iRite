import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ commands: new Map<string, Function>(), events: [] as Function[], panels: [] as any[] }));
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
vi.mock('fs', () => ({ readdirSync: () => ['main.rev'], readFileSync: () => Buffer.from('<Indicator><ConfigHash value="x"/><Config>\nDB.SCHEMA#1=10,0,A,3,4\nDB.ALIAS#1=T\n</Config></Indicator>') }));
vi.mock('../../src/commands/locateProject', () => ({ locateMainSrc: async () => '/project/main.src', readText: () => '' }));
vi.mock('../../src/irite', () => ({ loadIriteProject: () => ({ files: [], databases: [], routines: [], diagnostics: [] }) }));
vi.mock('../../src/erd/erdModel', () => ({ buildErd: () => ({ tables: [], relations: [], diagnostics: [] }) }));

afterEach(() => vi.useRealTimers());
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
