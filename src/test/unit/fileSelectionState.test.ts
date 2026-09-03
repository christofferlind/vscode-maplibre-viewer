import * as assert from 'assert';
import { createRequire } from 'module';

// The vscode module only resolves inside the extension host; stub it so the
// selection handler module can be imported in plain node unit tests.
const nodeRequire = createRequire(__filename);
const ModuleCtor = nodeRequire('module') as typeof import('module');
let capturedErrorMessage: string | undefined;

const vscodeStub = {
    window: {
        showErrorMessage: (message: string): Promise<undefined> => {
            capturedErrorMessage = message;
            return Promise.resolve(undefined);
        },
        activeTextEditor: undefined as unknown
    },
    workspace: {
        getConfiguration: () => ({
            get: <T>(_key: string, defaultValue?: T): T | undefined => defaultValue
        })
    }
};

const originalPrototypeRequire = ModuleCtor.prototype.require;
ModuleCtor.prototype.require = function (id: string): unknown {
    if (id === 'vscode') {
        return vscodeStub;
    }
    return originalPrototypeRequire.call(this, id);
};

// Earlier test files may have cached extensionUtils with a different vscode stub.
// Evict it so the selection handler uses this file's stub (and error capture).
const moduleCache = (ModuleCtor as unknown as { _cache: Record<string, NodeModule | undefined> })._cache;
for (const cachedPath of Object.keys(moduleCache)) {
    if (cachedPath.includes('extensionUtils')) {
        delete moduleCache[cachedPath];
    }
}

import { handleFileSelection, resetFileSelectionState } from '../../selectionHandler';
import { FileToGeoJsonAdapter } from '../../services/api';

type EditorLike = Parameters<typeof handleFileSelection>[0];
type LayerTreeProviderLike = Parameters<typeof handleFileSelection>[1];
type ProviderManagerLike = Parameters<typeof handleFileSelection>[2];

interface RecordingLayerTreeProvider {
    getSelectedFileLayer: () => { visible: boolean } | undefined;
    updateSelectedFileLayer: (geojson: object) => Promise<void>;
    updateCalls: object[];
}

interface RecordingProviderManager {
    fitBoundsOnly: (bbox: number[]) => void;
    fitCalls: number[][];
}

interface RecordingAdapter extends FileToGeoJsonAdapter {
    toGeoJsonCalls: string[];
}

const sampleGeoJson = {
    type: 'FeatureCollection',
    features: [
        {
            type: 'Feature',
            properties: {},
            geometry: { type: 'Point', coordinates: [12.5, 55.7] }
        },
        {
            type: 'Feature',
            properties: {},
            geometry: { type: 'Point', coordinates: [13.9, 57.2] }
        }
    ]
};

function createRecordingAdapter(extensions: string[]): RecordingAdapter {
    return {
        getName: (): string => 'Recording Adapter',
        canHandle: (fileExtension: string): boolean => extensions.includes(fileExtension.toLowerCase()),
        toGeoJson: (_filePath: string): Promise<object> => {
            throw new Error('not implemented in base recording adapter');
        },
        toGeoJsonCalls: []
    } as RecordingAdapter;
}

function createSuccessAdapter(extensions: string[]): { adapter: RecordingAdapter; counter: { value: number } } {
    const counter = { value: 0 };
    const adapter = createRecordingAdapter(extensions);
    adapter.toGeoJson = (_filePath: string): Promise<object> => {
        counter.value += 1;
        adapter.toGeoJsonCalls.push(_filePath);
        return Promise.resolve(sampleGeoJson);
    };
    return { adapter, counter };
}

function createFailingAdapter(extensions: string[]): { adapter: RecordingAdapter; counter: { value: number } } {
    const counter = { value: 0 };
    const adapter = createRecordingAdapter(extensions);
    adapter.toGeoJson = (_filePath: string): Promise<object> => {
        counter.value += 1;
        adapter.toGeoJsonCalls.push(_filePath);
        return Promise.reject(new Error('conversion failed'));
    };
    return { adapter, counter };
}

function createRecordingLayerTreeProvider(layerVisible: boolean): RecordingLayerTreeProvider {
    const updateCalls: object[] = [];
    return {
        getSelectedFileLayer: (): { visible: boolean } | undefined => ({ visible: layerVisible }),
        updateSelectedFileLayer: (geojson: object): Promise<void> => {
            updateCalls.push(geojson);
            return Promise.resolve();
        },
        updateCalls
    };
}

function createRecordingProviderManager(): RecordingProviderManager {
    const fitCalls: number[][] = [];
    return {
        fitBoundsOnly: (bbox: number[]): void => {
            fitCalls.push(bbox);
        },
        fitCalls
    };
}

function createMockEditor(fsPath: string, uriString: string): EditorLike {
    return {
        document: {
            uri: {
                fsPath,
                toString: (): string => uriString
            }
        }
    } as unknown as EditorLike;
}

suite('handleFileSelection state', () => {
    setup(() => {
        capturedErrorMessage = undefined;
        resetFileSelectionState();
    });

    test('processing the same editor twice parses, updates and fits only once', async () => {
        const { adapter, counter } = createSuccessAdapter(['.geojson']);
        const layerTreeProvider = createRecordingLayerTreeProvider(true);
        const providerManager = createRecordingProviderManager();
        const editor = createMockEditor('/tmp/a.geojson', 'file:///tmp/a.geojson');

        await handleFileSelection(
            editor,
            layerTreeProvider as unknown as LayerTreeProviderLike,
            providerManager as unknown as ProviderManagerLike,
            [adapter]
        );
        await handleFileSelection(
            editor,
            layerTreeProvider as unknown as LayerTreeProviderLike,
            providerManager as unknown as ProviderManagerLike,
            [adapter]
        );

        assert.strictEqual(counter.value, 1, 'toGeoJson should be called exactly once');
        assert.strictEqual(layerTreeProvider.updateCalls.length, 1, 'updateSelectedFileLayer should be called once');
        assert.strictEqual(providerManager.fitCalls.length, 1, 'fitBoundsOnly should be called once');
        assert.strictEqual(capturedErrorMessage, undefined, 'should not show error on success');
    });

    test('switching between two editors parses each file every time it is activated', async () => {
        const { adapter, counter } = createSuccessAdapter(['.geojson', '.gpx']);
        const layerTreeProvider = createRecordingLayerTreeProvider(true);
        const providerManager = createRecordingProviderManager();
        const editorA = createMockEditor('/tmp/a.geojson', 'file:///tmp/a.geojson');
        const editorB = createMockEditor('/tmp/b.gpx', 'file:///tmp/b.gpx');

        await handleFileSelection(editorA, layerTreeProvider as unknown as LayerTreeProviderLike, providerManager as unknown as ProviderManagerLike, [adapter]);
        await handleFileSelection(editorB, layerTreeProvider as unknown as LayerTreeProviderLike, providerManager as unknown as ProviderManagerLike, [adapter]);
        await handleFileSelection(editorA, layerTreeProvider as unknown as LayerTreeProviderLike, providerManager as unknown as ProviderManagerLike, [adapter]);

        assert.strictEqual(counter.value, 3, 'toGeoJson should be called three times');
        assert.strictEqual(providerManager.fitCalls.length, 3, 'fitBoundsOnly should be called three times');
        assert.strictEqual(layerTreeProvider.updateCalls.length, 3, 'updateSelectedFileLayer should be called three times');
    });

    test('disabled layer does not record the uri so enabling it processes the file again', async () => {
        const { adapter, counter } = createSuccessAdapter(['.geojson']);
        const hiddenProvider = createRecordingLayerTreeProvider(false);
        const providerManager = createRecordingProviderManager();
        const editor = createMockEditor('/tmp/a.geojson', 'file:///tmp/a.geojson');

        await handleFileSelection(
            editor,
            hiddenProvider as unknown as LayerTreeProviderLike,
            providerManager as unknown as ProviderManagerLike,
            [adapter]
        );

        assert.strictEqual(counter.value, 0, 'toGeoJson should not run while layer is disabled');
        assert.strictEqual(hiddenProvider.updateCalls.length, 0, 'updateSelectedFileLayer should not run while layer is disabled');
        assert.strictEqual(providerManager.fitCalls.length, 0, 'fitBoundsOnly should not run while layer is disabled');

        const visibleProvider = createRecordingLayerTreeProvider(true);
        await handleFileSelection(
            editor,
            visibleProvider as unknown as LayerTreeProviderLike,
            providerManager as unknown as ProviderManagerLike,
            [adapter]
        );

        assert.strictEqual(counter.value, 1, 'toGeoJson should run once after the layer is enabled');
        assert.strictEqual(visibleProvider.updateCalls.length, 1, 'updateSelectedFileLayer should run after the layer is enabled');
        assert.strictEqual(providerManager.fitCalls.length, 1, 'fitBoundsOnly should run after the layer is enabled');
    });

    test('resetFileSelectionState allows the same editor to process again', async () => {
        const { adapter, counter } = createSuccessAdapter(['.geojson']);
        const layerTreeProvider = createRecordingLayerTreeProvider(true);
        const providerManager = createRecordingProviderManager();
        const editor = createMockEditor('/tmp/a.geojson', 'file:///tmp/a.geojson');

        await handleFileSelection(
            editor,
            layerTreeProvider as unknown as LayerTreeProviderLike,
            providerManager as unknown as ProviderManagerLike,
            [adapter]
        );
        assert.strictEqual(counter.value, 1, 'toGeoJson should run once before reset');

        resetFileSelectionState();

        await handleFileSelection(
            editor,
            layerTreeProvider as unknown as LayerTreeProviderLike,
            providerManager as unknown as ProviderManagerLike,
            [adapter]
        );
        assert.strictEqual(counter.value, 2, 'toGeoJson should run again after reset');
        assert.strictEqual(layerTreeProvider.updateCalls.length, 2, 'updateSelectedFileLayer should run again after reset');
        assert.strictEqual(providerManager.fitCalls.length, 2, 'fitBoundsOnly should run again after reset');
    });

    test('adapter failure shows an error and retries on next activation of the same uri', async () => {
        const { adapter, counter } = createFailingAdapter(['.geojson']);
        const layerTreeProvider = createRecordingLayerTreeProvider(true);
        const providerManager = createRecordingProviderManager();
        const editor = createMockEditor('/tmp/a.geojson', 'file:///tmp/a.geojson');

        await handleFileSelection(
            editor,
            layerTreeProvider as unknown as LayerTreeProviderLike,
            providerManager as unknown as ProviderManagerLike,
            [adapter]
        );

        assert.strictEqual(counter.value, 1, 'toGeoJson should be attempted once');
        assert.ok(capturedErrorMessage !== undefined, 'should show an error message');
        assert.ok(capturedErrorMessage?.includes('conversion failed'), 'error message should include the original error');
        assert.ok(capturedErrorMessage?.includes('Recording Adapter'), 'error message should include the adapter name');
        assert.strictEqual(layerTreeProvider.updateCalls.length, 0, 'layer should not update when the adapter fails');
        assert.strictEqual(providerManager.fitCalls.length, 0, 'fitBoundsOnly should not run when the adapter fails');

        await handleFileSelection(
            editor,
            layerTreeProvider as unknown as LayerTreeProviderLike,
            providerManager as unknown as ProviderManagerLike,
            [adapter]
        );

        assert.strictEqual(counter.value, 2, 'toGeoJson should be retried on next activation');
        assert.strictEqual(layerTreeProvider.updateCalls.length, 0, 'layer should still not update on repeated failure');
        assert.strictEqual(providerManager.fitCalls.length, 0, 'fitBoundsOnly should still not run on repeated failure');
    });

    test('files with no matching adapter are re-evaluated on the next activation', async () => {
        const { adapter, counter } = createSuccessAdapter(['.geojson']);
        const layerTreeProvider = createRecordingLayerTreeProvider(true);
        const providerManager = createRecordingProviderManager();
        const editor = createMockEditor('/tmp/a.xyz', 'file:///tmp/a.xyz');

        await handleFileSelection(
            editor,
            layerTreeProvider as unknown as LayerTreeProviderLike,
            providerManager as unknown as ProviderManagerLike,
            [adapter]
        );
        await handleFileSelection(
            editor,
            layerTreeProvider as unknown as LayerTreeProviderLike,
            providerManager as unknown as ProviderManagerLike,
            [adapter]
        );

        assert.strictEqual(counter.value, 0, 'toGeoJson should never run without a matching adapter');
        assert.strictEqual(layerTreeProvider.updateCalls.length, 0, 'updateSelectedFileLayer should not run without a matching adapter');
        assert.strictEqual(providerManager.fitCalls.length, 0, 'fitBoundsOnly should not run without a matching adapter');
        assert.strictEqual(capturedErrorMessage, undefined, 'should not show error when no adapter matches');
    });
});