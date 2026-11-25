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

async function setName(panel: any, generation: number, requestId: number, value: string): Promise<void> {
 await panel.receive({type:'erd-edit-request', generation, requestId:10000 + requestId, message:{type:'draft-get'}});
 const table = panel.webview.postMessage.mock.calls.at(-1)[0].draft.tables[0].key;
 await panel.receive({type:'erd-edit-request', generation, requestId, message:{type:'draft-action', action:{kind:'setTable',table,property:'name',value}}});
}

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
 await setName(panel, generation, 1, 'Changed');
 await panel.receive({type:'erd-edit-mode', generation, editing:false});
 expect(panel.webview.html).not.toBe(refreshed); // deferred refresh retains the staged edit
 refreshed = panel.webview.html;
 generation = Number(refreshed.match(/const generation = (\d+)/)[1]);
 await panel.receive({type:'erd-edit-mode', generation, editing:true});
 expect(panel.webview.postMessage.mock.calls.at(-1)[0].draft.tables[0].name).toBe('Changed');
 let finish!: (result: string | undefined) => void;
 const vscode = await import('vscode');
 vi.mocked(vscode.window.showWarningMessage).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }) as any);
 const saving = panel.receive({type:'erd-edit-request', generation, requestId:2, message:{type:'save'}});
 mocks.events[0](); vi.advanceTimersByTime(301);
 expect(panel.webview.html).toBe(refreshed); // modal save in flight
 finish(undefined); await saving;
 expect(panel.webview.html).toBe(refreshed); // cancelled save preserves the draft while editing
 mocks.disk = Buffer.from(mocks.disk.toString().replace('DB.ALIAS#1=T', 'DB.ALIAS#1=Disk'));
 await panel.receive({type:'erd-edit-mode', generation, editing:false});
 expect(panel.webview.html).not.toBe(refreshed);
 expect(panel.webview.html).toContain('Disk');
 generation = Number(panel.webview.html.match(/const generation = (\d+)/)[1]);
 await panel.receive({type:'erd-edit-mode', generation, editing:true});
 expect(panel.webview.postMessage.mock.calls.at(-1)[0].draft.tables[0].name).toBe('Changed');
 await panel.receive({type:'erd-edit-request', generation, requestId:3, message:{type:'save'}});
 expect(panel.webview.postMessage.mock.calls.at(-1)[0].message).toMatch(/changed|stale/i);
 expect(mocks.writes).toEqual([]);
 await panel.receive({type:'erd-edit-request', generation, requestId:4, message:{type:'draft-discard'}});
 await panel.receive({type:'erd-edit-mode', generation, editing:false});
 expect(panel.webview.html).toContain('Disk');
 generation = Number(panel.webview.html.match(/const generation = (\d+)/)[1]);
 await panel.receive({type:'erd-edit-mode', generation, editing:true});
 expect(panel.webview.postMessage.mock.calls.at(-1)[0].draft.tables[0].name).toBe('Disk');
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
 expect(panel.webview.html).toMatch(/id="edit-mode" type="button" disabled/);
 expect(panel.webview.html).toContain('let editing = false, available = false');
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
 expect(panel.webview.html).toContain('let editing = true, available = true');
 const generation = Number(panel.webview.html.match(/const generation = (\d+)/)[1]);
 await setName(panel, generation, 1, 'Changed');
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
 await setName(panel, generation, 1, 'Changed');
 mocks.events[0](); vi.advanceTimersByTime(301);
 await setName(panel, generation, 2, 'T');
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
 await setName(panel, generation, 1, 'Changed');
 const vscode = await import('vscode');
 vi.mocked(vscode.window.showWarningMessage).mockResolvedValueOnce('Save and keep a backup' as any);
 await panel.receive({type:'erd-edit-request', generation, requestId:2, message:{type:'save'}});
 expect(panel.webview.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({disabled:true, message:expect.stringMatching(/restore the backup/i)}));
 const writes = mocks.writes.length, reads = mocks.reads.length;
 mocks.disk = Buffer.from(mocks.disk.toString().replace('DB.ALIAS#1=T', 'DB.ALIAS#1=Restored'));
 await mocks.commands.get(command)!();
 expect(mocks.panels).toHaveLength(1);
 expect(mocks.reads.length).toBeGreaterThan(reads);
 expect(panel.webview.html).not.toBe(initial);
 expect(panel.webview.html).toMatch(/restore the backup/i);
 expect(mocks.writes).toHaveLength(writes);
 expect(panel.webview.html).toContain(command === 'irite.editDatabaseSchema' ? 'let editing = true, available = true' : 'let editing = false, available = true');
 expect(panel.webview.html).toContain('Restored');
 const rebuiltGeneration = Number(panel.webview.html.match(/const generation = (\d+)/)[1]);
 if (command === 'irite.showErd') await panel.receive({type:'erd-edit-mode', generation:rebuiltGeneration, editing:true});
 await setName(panel, rebuiltGeneration, 3, 'EditedAgain');
 expect(panel.webview.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({type:'erd-edit-state', disabled:false, fragment:expect.stringContaining('EditedAgain')}));
 expect(mocks.writes).toHaveLength(writes);
});

it('posts readback state and backup name on success, then refreshes after editing ends', async () => {
 vi.useFakeTimers();
 const { registerErdCommands } = await import('../../src/commands/erd');
 registerErdCommands({subscriptions:[]} as any);
 await mocks.commands.get('irite.editDatabaseSchema')!();
 const panel = mocks.panels[0], initial = panel.webview.html;
 const generation = Number(initial.match(/const generation = (\d+)/)[1]);
 await setName(panel, generation, 1, 'Changed');
 mocks.events[0](); vi.advanceTimersByTime(301);
 const vscode = await import('vscode');
 vi.mocked(vscode.window.showWarningMessage).mockResolvedValueOnce('Save and keep a backup' as any);
 await panel.receive({type:'erd-edit-request', generation, requestId:2, message:{type:'save'}});
 expect(mocks.disk.toString()).toContain('DB.ALIAS#1=Changed');
 expect(panel.webview.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({type:'erd-edit-state', requestId:2, fragment:expect.stringContaining('Changed'), readonly:expect.stringContaining('Changed')}));
 expect(vi.mocked(vscode.window.showInformationMessage)).toHaveBeenCalledWith(expect.stringContaining(mocks.backups[0].split(/[\\/]/).pop()!), 'Regenerate main.iri');
 expect(panel.webview.html).toBe(initial);
 await panel.receive({type:'erd-edit-mode', generation, editing:false});
 expect(panel.webview.html).not.toBe(initial);
});

it('bootstraps a trusted draft and keeps invalid intent across diagram toggles', async () => {
 const { registerErdCommands } = await import('../../src/commands/erd');
 registerErdCommands({subscriptions:[]} as any);
 await mocks.commands.get('irite.editDatabaseSchema')!();
 const panel = mocks.panels[0], generation = Number(panel.webview.html.match(/const generation = (\d+)/)[1]);
 const request = (requestId: number, message: unknown) => panel.receive({type:'erd-edit-request',generation,requestId,message});
 await request(1,{type:'draft-get'});
 const draft = panel.webview.postMessage.mock.calls.at(-1)[0].draft;
 expect(draft.schema).toBeUndefined();
 await request(2,{type:'draft-action',action:{kind:'setTable',table:draft.tables[0].key,property:'name',value:''}});
 const response = panel.webview.postMessage.mock.calls.at(-1)[0];
 expect(response.canSave).toBe(false); expect(response.draft.count).toBeGreaterThan(0);
 await panel.receive({type:'erd-edit-mode',generation,editing:false});
 await panel.receive({type:'erd-edit-mode',generation,editing:true});
 expect(panel.webview.postMessage.mock.calls.at(-1)[0].draft.tables[0].name).toBe('');
 await request(3,{type:'draft-discard'});
 expect(panel.webview.postMessage.mock.calls.at(-1)[0].draft.tables[0].name).toBe('T');
 expect(mocks.writes).toEqual([]);
});

it('replies with trusted selected draft fragments and save metadata', async () => {
 mocks.disk = Buffer.from('<Indicator><ConfigHash value="x"/><Config>\nDB.SCHEMA#1=10,0,A,3,4\nDB.ALIAS#1=T\nDB.SCHEMA#2=10,0,B,3,4\nDB.ALIAS#2=Second\n</Config></Indicator>');
 const { registerErdCommands } = await import('../../src/commands/erd');
 registerErdCommands({subscriptions:[]} as any);
 await mocks.commands.get('irite.editDatabaseSchema')!();
 const panel = mocks.panels[0], generation = 1;
 await panel.receive({type:'erd-edit-request',generation,requestId:1,message:{type:'draft-get'}});
 const first = panel.webview.postMessage.mock.calls.at(-1)[0];
 const selected = first.draft.tables[1].key;
 await panel.receive({type:'erd-edit-mode',generation,editing:true,selected});
 let reply = panel.webview.postMessage.mock.calls.at(-1)[0];
 expect(reply).toMatchObject({selected,count:0,canSave:true,disabled:false,fragment:expect.stringContaining(`data-detail data-table="${selected}"`)});
 await panel.receive({type:'erd-edit-request',generation,requestId:2,selected,message:{type:'draft-action',action:{kind:'setTable',table:selected,property:'name',value:''}}});
 reply = panel.webview.postMessage.mock.calls.at(-1)[0];
 expect(reply).toMatchObject({selected,count:1,canSave:false,disabled:false,fragment:expect.stringContaining('data-detail'),draft:expect.objectContaining({tables:expect.any(Array)})});
 await panel.receive({type:'erd-edit-request',generation,requestId:3,selected:'<untrusted>',message:{type:'draft-get'}});
 reply = panel.webview.postMessage.mock.calls.at(-1)[0];
 expect(reply.selected).toBe(first.draft.tables[0].key);
 expect(reply.fragment).not.toContain('<untrusted>');
});

it('preserves the no-rev message', async () => {
 mocks.names = [];
 const { registerErdCommands } = await import('../../src/commands/erd');
 registerErdCommands({ subscriptions: [] } as any);
 await mocks.commands.get('irite.showErd')!();
 expect(mocks.panels[0].webview.html).toContain('No .rev available; schema editing is disabled.');
});
