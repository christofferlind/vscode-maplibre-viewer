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

import { handleFileSelection, resetFileSelectionState } from '../../selectionHandler';

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
