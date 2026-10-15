import * as assert from 'assert';
import { createRequire } from 'module';
import type * as vscode from 'vscode';

/**
 * Unit tests for the overlay layer toggle service, which wraps
 * toggleLayerVisibility with the extension-side back-fills for the
 * "Selected file" and clipboard layers. The vscode module, extensionUtils,
 * and selectionHandler modules are stubbed so the service can run without
 * a real VS Code host.
 */

const nodeRequire = createRequire(__filename);
const ModuleCtor = nodeRequire('module') as typeof import('module');
const originalPrototypeRequire = ModuleCtor.prototype.require;

const calls: string[] = [];

interface FakeLayer {
    id: string;
    name: string;
    type: string;
    visible: boolean;
}

interface FakeProvider {
    toggleLayerVisibility: (layerId: string) => Promise<void>;
    getSelectedFileLayer: () => FakeLayer | undefined;
    toggleError?: Error;
}

function makeVscodeStub() {
    return {
        window: {
            get activeTextEditor(): unknown {
                calls.push('activeTextEditor');
                return { document: 'fake-editor' };
            }
        }
    };
}

const { createToggleOverlayLayerWithBackfill } = ((): {
    createToggleOverlayLayerWithBackfill: typeof import('../../layers/layerToggleService').createToggleOverlayLayerWithBackfill;
} => {
    ModuleCtor.prototype.require = function (id: string): unknown {
        if (id === 'vscode') {
            return makeVscodeStub();
        }
        if (id === '../extensionUtils') {
            return {
                showOperationError: (): void => {
                    calls.push('showOperationError');
                }
            };
        }
        if (id === '../selectionHandler') {
            return {
                resetFileSelectionState: (): void => {
                    calls.push('resetFileSelectionState');
                },
                handleFileSelection: (): Promise<void> => {
                    calls.push('handleFileSelection');
                    return Promise.resolve();
                }
            };
        }
        return originalPrototypeRequire.call(this, id);
    };
    try {
        const moduleCache = (ModuleCtor as unknown as { _cache: Record<string, NodeModule | undefined> })._cache;
        for (const cached of [
            nodeRequire.resolve('../../layers/layerToggleService'),
            nodeRequire.resolve('../../extensionUtils'),
            nodeRequire.resolve('../../selectionHandler')
        ]) {
            delete moduleCache[cached];
        }
        return nodeRequire('../../layers/layerToggleService') as {
            createToggleOverlayLayerWithBackfill: typeof import('../../layers/layerToggleService').createToggleOverlayLayerWithBackfill;
        };
    } finally {
        ModuleCtor.prototype.require = originalPrototypeRequire;
    }
})();

function makeFakeProvider(initialVisible: boolean): { provider: FakeProvider; layer: FakeLayer } {
    const layer: FakeLayer = { id: 'selected-file', name: 'Selected file', type: 'geojson', visible: initialVisible };
    const provider: FakeProvider = {
        toggleLayerVisibility: async (): Promise<void> => {
            calls.push('toggleLayerVisibility');
            if (provider.toggleError) {
                throw provider.toggleError;
            }
            layer.visible = !layer.visible;
        },
        getSelectedFileLayer: (): FakeLayer => layer
    };
    return { provider, layer };
}

function makeToggle(provider: FakeProvider): { toggle: (layer: FakeLayer) => Promise<void>; syncCalls: string[] } {
    const syncCalls: string[] = [];
    const toggle = createToggleOverlayLayerWithBackfill({
        layerTreeProvider: provider as never,
        providerManager: {} as never,
        fileToGeoJsonAdapters: [],
        syncClipboardLayer: (): void => {
            syncCalls.push('sync');
        }
    });
    return { toggle: toggle as (layer: FakeLayer) => Promise<void>, syncCalls };
}

suite('createToggleOverlayLayerWithBackfill', () => {
    setup(() => {
        calls.length = 0;
    });

    test('should toggle layer visibility through the provider', async () => {
        const { provider, layer } = makeFakeProvider(false);
        const { toggle, syncCalls } = makeToggle(provider);
        await toggle(layer);
        assert.strictEqual(layer.visible, true);
        assert.deepStrictEqual(syncCalls, []);
    });

    test('should reset selection state and re-process the active editor when the selected file layer becomes visible', async () => {
        const { provider, layer } = makeFakeProvider(false);
        const { toggle } = makeToggle(provider);
        await toggle(layer);
        assert.ok(calls.includes('resetFileSelectionState'));
        assert.ok(calls.includes('activeTextEditor'));
        assert.ok(calls.indexOf('activeTextEditor') < calls.indexOf('resetFileSelectionState'));
    });

    test('should sync the clipboard layer when the clipboard layer is toggled', async () => {
        const { provider, layer } = makeFakeProvider(false);
        layer.id = 'clipboard';
        const { toggle, syncCalls } = makeToggle(provider);
        await toggle(layer);
        assert.deepStrictEqual(syncCalls, ['sync']);
    });

    test('should report toggle errors through showOperationError without throwing', async () => {
        const { provider, layer } = makeFakeProvider(false);
        provider.toggleError = new Error('toggle failed');
        const { toggle } = makeToggle(provider);
        await toggle(layer);
        assert.ok(calls.includes('showOperationError'));
        assert.strictEqual(calls.filter(c => c === 'toggleLayerVisibility').length, 1);
    });
});