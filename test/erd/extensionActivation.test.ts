import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as path from 'node:path';

const state = vi.hoisted(() => ({ handlers: new Map<string, (...args: any[]) => any>(), render: vi.fn(), panels: [] as string[], disposePanel: () => {} }));
vi.mock('vscode', () => ({
 commands: { registerCommand(id: string, handler: (...args: any[]) => any) {
  if (state.handlers.has(id)) throw new Error(`command '${id}' already exists`);
  state.handlers.set(id, handler); return {dispose() {}};
 } },
 window: {
  createOutputChannel: () => ({dispose() {}}),
  createWebviewPanel: (id: string) => { state.panels.push(id); return {webview:{cspSource:'vscode:', onDidReceiveMessage() {}}, onDidDispose(callback: () => void) { state.disposePanel = callback; }}; },
 },
 workspace: {createFileSystemWatcher: () => ({onDidChange() {}, onDidCreate() {}, onDidDelete() {}, dispose() {}})},
 RelativePattern: class {}, ViewColumn: {Beside: 2},
}), {virtual:true});
vi.mock('../../src/commands/engine', () => ({checkRevolutionInstalled() {}, registerEngineCommands() {}}));
vi.mock('../../src/commands/previewScreens', () => ({registerPreviewCommands() {}}));
vi.mock('../../src/commands/screenEditor', () => ({registerScreenEditor() {}}));
vi.mock('../../src/commands/sfc', () => ({registerSfcCommands() {}}));
vi.mock('../../src/commands/callMap', () => ({registerCallMapCommands() {}}));
vi.mock('../../src/commands/docs', () => ({registerDocsCommands() {}}));
vi.mock('../../src/commands/dbAccess', () => ({registerDbAccess() {}}));
vi.mock('../../src/commands/firmwareImages', () => ({registerFirmwareImages() {}, sweepFirmwareCacheOnActivation() {}}));
vi.mock('../../src/commands/locateProject', () => ({locateMainSrc: async () => path.resolve('test/fixtures/editor/main.src'), readText() { return ''; }}));
vi.mock('../../src/irite', () => ({loadIriteProject: () => ({files: []})}));
vi.mock('../../src/erd/erdModel', () => ({buildErd: () => ({tables: [], relations: [], diagnostics: []})}));
vi.mock('../../src/erd/erdHtml', () => ({renderErdHtml: state.render, renderErdReadonly: vi.fn()}));

import { activate } from '../../src/extension';

beforeEach(() => { state.handlers.clear(); state.panels.length = 0; state.render.mockReset().mockReturnValue(''); });
afterEach(() => { state.disposePanel(); });

it('activates without duplicate commands and routes schema editing to the ERD in edit mode', async () => {
 activate({subscriptions: []} as any);
 expect([...state.handlers.keys()]).toEqual(['irite.showErd', 'irite.editDatabaseSchema']);
 await state.handlers.get('irite.editDatabaseSchema')!();
 expect(state.panels).toEqual(['irite.showErd']);
 expect(state.render).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({editor: expect.objectContaining({startEditing: true})}));
});

it('preserves the read-only ERD command', async () => {
 activate({subscriptions: []} as any);
 await state.handlers.get('irite.showErd')!();
 expect(state.panels).toEqual(['irite.showErd']);
 expect(state.render).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({editor: expect.objectContaining({startEditing: false})}));
});
