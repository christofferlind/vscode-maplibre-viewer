import * as assert from 'assert';
import type * as vscode from 'vscode';
import { MockWebview } from '../testUtils/mockWebview';
import { loadWithStubbedVscode, type VscodeStubState, type StubWebviewPanel } from '../testUtils/loadWithStubbedVscode';

/**
 * Loads the real MapEditorProvider / MapViewProvider (and their base
 * MapWebviewController) with the `vscode` module stubbed, exercising the
 * provider lifecycle: resolveWebviewView, createPanel, panel disposal, and
 * webview message wiring.
 */

function makeUri(): vscode.Uri {
    return { fsPath: process.cwd(), joinPath: () => makeUri() } as unknown as vscode.Uri;
}

interface ViewProviderCtor {
    new (uri: vscode.Uri, bookmarkManager: never, styleUrl?: string, baseMapId?: string): {
        resolveWebviewView(webviewView: vscode.WebviewView): void;
    };
}

suite('MapViewProvider real module', () => {
    const loaded = loadWithStubbedVscode<{ MapViewProvider: ViewProviderCtor }>('../../map/mapViewProvider');

    function stubWebviewView(): MockWebview {
        return new MockWebview();
    }

    test('resolveWebviewView enables scripts and generates html', () => {
        const provider = new loaded.module.MapViewProvider(makeUri(), undefined as never);
        const mock = stubWebviewView();
        const view = { webview: mock } as unknown as vscode.WebviewView;

        provider.resolveWebviewView(view);

        assert.strictEqual(mock.options.enableScripts, true);
        assert.strictEqual(mock.options.enableCommandUris, true);
        assert.ok(mock.html.length > 0, 'html should be generated');
        assert.ok(mock.html.includes('initialViewState'), 'html should contain map placeholders');
        assert.deepStrictEqual(
            mock.options.localResourceRoots?.length as number,
            1,
            'resource roots should restrict to resources'
        );
    });

    test('resolveWebviewView wires the message listener', () => {
        const provider = new loaded.module.MapViewProvider(makeUri(), undefined as never);
        const mock = stubWebviewView();
        const view = { webview: mock } as unknown as vscode.WebviewView;

        provider.resolveWebviewView(view);

        assert.doesNotThrow(() => {
            mock.simulateMessage({ type: 'viewStateChanged', zoom: 1 });
        });
    });
});

interface EditorProviderCtor {
    new (uri: vscode.Uri, bookmarkManager: never, styleUrl?: string, baseMapId?: string): {
        createPanel(column?: number): Promise<vscode.WebviewPanel>;
    };
}

suite('MapEditorProvider real module', () => {
    const editorLoaded = loadWithStubbedVscode<{ MapEditorProvider: EditorProviderCtor }>('../../map/mapEditorProvider');
    const { MapEditorProvider } = editorLoaded.module;

    function createdPanels(state: VscodeStubState): StubWebviewPanel[] {
        return state.createdPanels;
    }

    test('createPanel creates a panel with html and options', async () => {
        const provider = new MapEditorProvider(makeUri(), undefined as never);
        const before = createdPanels(editorLoaded.vscodeState).length;

        const panel = await provider.createPanel(1);
        assert.ok(panel);

        const created = createdPanels(editorLoaded.vscodeState);
        assert.strictEqual(created.length, before + 1, 'a panel should be created');
        const createdPanel = created[before];
        assert.strictEqual(createdPanel.viewType, 'mapEditor');
        assert.strictEqual(createdPanel.title.match(/Map Viewer/)?.[0], 'Map Viewer');
        assert.strictEqual(createdPanel.webview.options.enableScripts, true);
        assert.ok(createdPanel.webview.html.includes('initialViewState'));
    });

    test('createPanel reuses the existing panel', async () => {
        const provider = new MapEditorProvider(makeUri(), undefined as never);
        await provider.createPanel(1);
        const count = createdPanels(editorLoaded.vscodeState).length;

        await provider.createPanel(2);
        assert.strictEqual(
            createdPanels(editorLoaded.vscodeState).length,
            count,
            'no second panel should be created when one already exists'
        );
    });

    test('createPanel recreates the panel when reveal fails', async () => {
        const provider = new MapEditorProvider(makeUri(), undefined as never);
        await provider.createPanel(1);
        const count = createdPanels(editorLoaded.vscodeState).length;

        // Patch the existing panel so reveal throws (simulating a disposed panel).
        const existing = createdPanels(editorLoaded.vscodeState)[count - 1];
        (existing as unknown as { reveal: () => void }).reveal = () => {
            throw new Error('disposed');
        };

        const panel2 = await provider.createPanel(1);
        assert.ok(panel2);
        assert.strictEqual(
            createdPanels(editorLoaded.vscodeState).length,
            count + 1,
            'a fresh panel should be created after reveal failure'
        );
    });

    test('createPanel wires webview message handling', async () => {
        const provider = new MapEditorProvider(makeUri(), undefined as never);
        const panel = await provider.createPanel(1);
        assert.ok(panel);

        let fired = false;
        (provider as unknown as { onMapReady: (cb: () => void) => void }).onMapReady(() => {
            fired = true;
        });

        const created = createdPanels(editorLoaded.vscodeState);
        created[created.length - 1].webview.simulateMessage({ type: 'mapReady' });
        // mapReady is handled async; wait a tick
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        assert.strictEqual(fired, true, 'mapReady should be handled by the controller');
    });

    test('createPanel disposes the internal reference on panel disposal', async () => {
        const provider = new MapEditorProvider(makeUri(), undefined as never);
        const listenersBefore = editorLoaded.vscodeState.disposeListeners.length;
        await provider.createPanel(1);
        const disposeListeners = editorLoaded.vscodeState.disposeListeners;
        assert.strictEqual(
            disposeListeners.length,
            listenersBefore + 1,
            'one dispose listener should be registered'
        );
        // Firing dispose should clear the panel; a subsequent createPanel makes a new panel.
        disposeListeners[disposeListeners.length - 1]();
        const count = createdPanels(editorLoaded.vscodeState).length;
        await provider.createPanel(1);
        assert.strictEqual(
            createdPanels(editorLoaded.vscodeState).length,
            count + 1,
            'after disposal a new panel is created on next call'
        );
    });
});
