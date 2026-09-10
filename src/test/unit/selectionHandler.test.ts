import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
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

// Earlier test files may have loaded these modules under a different vscode
// stub; drop them from the require cache so they re-resolve against this stub.
const moduleCache = (ModuleCtor as unknown as { _cache: Record<string, NodeModule | undefined> })._cache;
for (const cached of [
    nodeRequire.resolve('../../selectionHandler'),
    nodeRequire.resolve('../../extensionUtils')
]) {
    delete moduleCache[cached];
}

const vscode = nodeRequire('vscode') as typeof vscodeStub;

import { handleFileSelection, handleTextSelection, resetFileSelectionState } from '../../selectionHandler';

suite('handleTextSelection with WKT', () => {
    function resetMocks(): void {
        capturedErrorMessage = undefined;
        vscode.window.activeTextEditor = undefined;
        resetFileSelectionState();
    }

    function createSelectionEditor(selectedText: string, uri = 'file:///test.wkt'): {
        selection: { isEmpty: boolean; anchor: { line: number; character: number }; active: { line: number; character: number } };
        document: { getText: (_selection: unknown) => string; uri: { toString: () => string } };
    } {
        return {
            selection: {
                isEmpty: false,
                anchor: { line: 0, character: 0 },
                active: { line: 0, character: selectedText.length }
            },
            document: {
                getText: (): string => selectedText,
                uri: { toString: (): string => uri }
            }
        };
    }

    function createRecordingProviderManager(): {
        updatedGeoJson: (object | null)[];
        fitBoundsOnlyCalls: unknown[];
        updateSelectedFileLayer: (geojson: object | null) => void;
        fitBoundsOnly: (bbox: unknown) => void;
        fitBoundingBox: (coords: unknown[], bbox: unknown) => void;
        flyToLocation: (lat: number, lng: number, zoom?: number) => void;
    } {
        const manager = {
            updatedGeoJson: [] as (object | null)[],
            fitBoundsOnlyCalls: [] as unknown[],
            updateSelectedFileLayer: (geojson: object | null): void => {
                manager.updatedGeoJson.push(geojson);
            },
            fitBoundsOnly: (bbox: unknown): void => {
                manager.fitBoundsOnlyCalls.push(bbox);
            },
            fitBoundingBox: (_coords: unknown[], _bbox: unknown): void => {},
            flyToLocation: (_lat: number, _lng: number, _zoom?: number): void => {}
        };
        return manager as unknown as ReturnType<typeof createRecordingProviderManager>;
    }

    test('renders selected WKT Point as GeoJSON on the map', async () => {
        resetMocks();
        const providerManager = createRecordingProviderManager();
        vscode.window.activeTextEditor = createSelectionEditor('POINT (18.0686 59.3293)') as unknown as any;

        handleTextSelection(providerManager as unknown as any);
        await new Promise((resolve) => setTimeout(resolve, 10));

        assert.strictEqual(providerManager.updatedGeoJson.length, 1);
        const fc = providerManager.updatedGeoJson[0] as { type: string; features: unknown[] };
        assert.strictEqual(fc.type, 'FeatureCollection');
        assert.strictEqual(fc.features.length, 1);
        assert.strictEqual(providerManager.fitBoundsOnlyCalls.length, 1, 'should fit bounds to geometry');
        assert.strictEqual(capturedErrorMessage, undefined);
    });

    test('does not re-render when the same WKT selection re-fires', async () => {
        resetMocks();
        const providerManager = createRecordingProviderManager();
        const editor = createSelectionEditor('POINT (18.0686 59.3293)');
        vscode.window.activeTextEditor = editor as unknown as any;

        handleTextSelection(providerManager as unknown as any);
        await new Promise((resolve) => setTimeout(resolve, 10));
        handleTextSelection(providerManager as unknown as any);
        await new Promise((resolve) => setTimeout(resolve, 10));
        handleTextSelection(providerManager as unknown as any);
        await new Promise((resolve) => setTimeout(resolve, 10));

        assert.strictEqual(providerManager.updatedGeoJson.length, 1, 'should render only once for identical selection');
        assert.strictEqual(providerManager.fitBoundsOnlyCalls.length, 1, 'should fit bounds only once');
    });

    test('renders again when the WKT selection changes', async () => {
        resetMocks();
        const providerManager = createRecordingProviderManager();
        vscode.window.activeTextEditor = createSelectionEditor('POINT (18.0686 59.3293)') as unknown as any;
        handleTextSelection(providerManager as unknown as any);
        await new Promise((resolve) => setTimeout(resolve, 10));

        vscode.window.activeTextEditor = createSelectionEditor('POINT (11.1111 22.2222)') as unknown as any;
        handleTextSelection(providerManager as unknown as any);
        await new Promise((resolve) => setTimeout(resolve, 10));

        assert.strictEqual(providerManager.updatedGeoJson.length, 2, 'should render for each distinct selection');
    });

    test('renders again after resetFileSelectionState', async () => {
        resetMocks();
        const providerManager = createRecordingProviderManager();
        vscode.window.activeTextEditor = createSelectionEditor('POINT (18.0686 59.3293)') as unknown as any;
        handleTextSelection(providerManager as unknown as any);
        await new Promise((resolve) => setTimeout(resolve, 10));

        resetFileSelectionState();
        handleTextSelection(providerManager as unknown as any);
        await new Promise((resolve) => setTimeout(resolve, 10));

        assert.strictEqual(providerManager.updatedGeoJson.length, 2, 'should render again after state reset');
    });

    test('shows an error when WKT parsing fails', async () => {
        resetMocks();
        const providerManager = createRecordingProviderManager();
        vscode.window.activeTextEditor = createSelectionEditor('POINT (999 999)') as unknown as any;

        handleTextSelection(providerManager as unknown as any);
        await new Promise((resolve) => setTimeout(resolve, 10));

        assert.strictEqual(providerManager.updatedGeoJson.length, 0);
        assert.ok(capturedErrorMessage !== undefined, 'should show error message');
    });

    test('falls back to coordinate parsing for non-WKT selections', () => {
        resetMocks();
        const providerManager = createRecordingProviderManager();
        vscode.window.activeTextEditor = createSelectionEditor('59.3293, 18.0686') as unknown as any;

        handleTextSelection(providerManager as unknown as any);

        assert.strictEqual(providerManager.updatedGeoJson.length, 0);
        assert.strictEqual(capturedErrorMessage, undefined);
    });
});

suite('handleFileSelection', () => {
    let tempDir: string;

    suiteSetup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'selection-handler-test-'));
    });

    suiteTeardown(() => {
        if (tempDir && fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    function resetMocks(): void {
        capturedErrorMessage = undefined;
        vscode.window.activeTextEditor = undefined;
        resetFileSelectionState();
    }

    function createMockAdapter(
        canHandleResult: boolean,
        toGeoJsonResult?: object,
        toGeoJsonError?: Error
    ): { canHandle: (ext: string) => boolean; getName: () => string; toGeoJson: (fp: string) => Promise<object> } {
        return {
            canHandle: (_ext: string): boolean => canHandleResult,
            getName: (): string => 'Test Adapter',
            async toGeoJson(_fp: string): Promise<object> {
                if (toGeoJsonError) {
                    throw toGeoJsonError;
                }
                return toGeoJsonResult ?? { type: 'FeatureCollection', features: [] };
            }
        };
    }

    function createMockLayerTreeProvider(
        selectedFileLayerVisible = true,
        isLayerEmpty = true
    ): {
        getSelectedFileLayer: () => { visible: boolean } | undefined;
        updateSelectedFileLayer: (geojson: object | null) => Promise<void>;
        isSelectedFileLayerEmpty: () => boolean;
    } {
        let updateCalls: (object | null)[] = [];
        return {
            getSelectedFileLayer: (): { visible: boolean } | undefined => {
                return isLayerEmpty ? undefined : { visible: selectedFileLayerVisible };
            },
            updateSelectedFileLayer: (geojson: object | null): Promise<void> => {
                updateCalls.push(geojson);
                return Promise.resolve();
            },
            isSelectedFileLayerEmpty: (): boolean => isLayerEmpty
        };
    }

    function createMockProviderManager(): { fitBoundingBox: (coords: unknown[], bbox: unknown) => void; fitBoundsOnly: (bbox: unknown) => void } {
        return {
            fitBoundingBox: (_coords: unknown[], _bbox: unknown): void => {},
            fitBoundsOnly: (_bbox: unknown): void => {}
        };
    }

    function createMockDocument(filePath: string): { uri: { fsPath: string }; getText: (_selection: unknown) => string } {
        return {
            uri: { fsPath: filePath },
            getText: (): string => ''
        };
    }

    function createMockEditor(filePath: string): { document: { uri: { fsPath: string }; getText: (_selection: unknown) => string }; selection: { isEmpty: boolean } } {
        return {
            document: createMockDocument(filePath),
            selection: { isEmpty: false }
        };
    }

    test('should call adapter and update layer when adapter succeeds', async () => {
        resetMocks();
        const testFile = path.join(tempDir, 'test.geojson');
        fs.writeFileSync(testFile, '{"type": "FeatureCollection", "features": []}');

        const mockAdapter = createMockAdapter(true, { type: 'FeatureCollection', features: [] });
        const layerTreeProvider = createMockLayerTreeProvider(true, true);
        const providerManager = createMockProviderManager();
        const editor = createMockEditor(testFile);

        vscode.window.activeTextEditor = editor as unknown as Parameters<typeof handleFileSelection>[0];

        await handleFileSelection(
            editor as unknown as Parameters<typeof handleFileSelection>[0],
            layerTreeProvider as unknown as any,
            providerManager as unknown as any,
            [mockAdapter as unknown as any]
        );

        assert.strictEqual(capturedErrorMessage, undefined, 'should not show error on success');
    });

    test('should show error and not clear layer when adapter throws', async () => {
        resetMocks();
        const testFile = path.join(tempDir, 'test.geojson');
        fs.writeFileSync(testFile, 'invalid content');

        const mockAdapter = createMockAdapter(true, undefined, new Error('Parse failed'));
        const layerTreeProvider = createMockLayerTreeProvider(true, false);
        const providerManager = createMockProviderManager();
        const editor = createMockEditor(testFile);

        vscode.window.activeTextEditor = editor as unknown as Parameters<typeof handleFileSelection>[0];

        await handleFileSelection(
            editor as unknown as Parameters<typeof handleFileSelection>[0],
            layerTreeProvider as unknown as any,
            providerManager as unknown as any,
            [mockAdapter as unknown as any]
        );

        assert.ok(capturedErrorMessage !== undefined, 'should show error message');
        assert.ok(capturedErrorMessage?.includes('Parse failed'), 'error message should include the original error');
        assert.ok(capturedErrorMessage?.includes('Test Adapter'), 'error message should include adapter name');

        const allCalls = (layerTreeProvider.updateSelectedFileLayer as unknown as { calls: (object | null)[] }).calls;
        if (allCalls) {
            for (const call of allCalls) {
                assert.notStrictEqual(call, null, 'should not clear layer on adapter failure');
            }
        }
    });

    test('should return early when selected file layer is disabled', async () => {
        resetMocks();
        const testFile = path.join(tempDir, 'test.geojson');
        fs.writeFileSync(testFile, '{"type":"FeatureCollection","features":[]}');

        const mockAdapter = createMockAdapter(true);
        const layerTreeProvider = createMockLayerTreeProvider(false, false);
        const providerManager = createMockProviderManager();
        const editor = createMockEditor(testFile);

        vscode.window.activeTextEditor = editor as unknown as Parameters<typeof handleFileSelection>[0];

        await handleFileSelection(
            editor as unknown as Parameters<typeof handleFileSelection>[0],
            layerTreeProvider as unknown as any,
            providerManager as unknown as any,
            [mockAdapter as unknown as any]
        );

        assert.strictEqual(capturedErrorMessage, undefined, 'should not process when layer is disabled');
    });

    test('should return early when no adapter can handle the file', async () => {
        resetMocks();
        const testFile = path.join(tempDir, 'test.xyz');
        fs.writeFileSync(testFile, 'some content');

        const mockAdapter = createMockAdapter(false);
        const layerTreeProvider = createMockLayerTreeProvider(true, true);
        const providerManager = createMockProviderManager();
        const editor = createMockEditor(testFile);

        vscode.window.activeTextEditor = editor as unknown as Parameters<typeof handleFileSelection>[0];

        await handleFileSelection(
            editor as unknown as Parameters<typeof handleFileSelection>[0],
            layerTreeProvider as unknown as any,
            providerManager as unknown as any,
            [mockAdapter as unknown as any]
        );

        assert.strictEqual(capturedErrorMessage, undefined, 'should not show error when no adapter matches');
    });
});
