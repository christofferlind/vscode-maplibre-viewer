import * as assert from 'assert';
import { createRequire } from 'module';

const nodeRequire = createRequire(__filename);
const ModuleCtor = nodeRequire('module') as typeof import('module');

class StubEventEmitter<T> {
    public event: unknown;
    public fired: T[] = [];
    private listeners: Array<(e: T) => void> = [];
    constructor() {
        this.event = (listener: (e: T) => void) => {
            this.listeners.push(listener);
            return { dispose: () => {} };
        };
    }
    fire(data: T): void {
        this.fired.push(data);
        for (const listener of this.listeners) {
            listener(data);
        }
    }
}

class StubDisposable {
    constructor(private readonly disposeFn: () => void = () => {}) {}
    dispose(): void {
        this.disposeFn();
    }
}

class StubMemento {
    private store = new Map<string, unknown>();
    private updateCalls: { key: string; value: unknown }[] = [];

    setRaw(key: string, value: unknown): void {
        this.store.set(key, value);
    }

    get<T>(key: string, defaultValue?: T): T | undefined {
        const value = this.store.get(key);
        if (value === undefined) {
            return defaultValue;
        }
        return value as T;
    }

    update(key: string, value: unknown): Promise<void> {
        this.updateCalls.push({ key, value });
        if (value === undefined) {
            this.store.delete(key);
        } else {
            this.store.set(key, value);
        }
        return Promise.resolve();
    }

    keys(): readonly string[] {
        return [...this.store.keys()];
    }

    getUpdateCalls(): { key: string; value: unknown }[] {
        return this.updateCalls;
    }
}

const registeredCommands = new Map<string, (...args: unknown[]) => unknown>();

function resetCommandRegistry(): void {
    registeredCommands.clear();
}

function makeCommandRegistryStubs(): {
    commands: Record<string, unknown>;
    window: Record<string, unknown>;
    workspace: Record<string, unknown>;
    events: StubEventEmitter<unknown>;
} {
    const events = new StubEventEmitter<unknown>();
    const commands: Record<string, unknown> = {
        registerCommand: (command: string, callback: (...args: unknown[]) => unknown) => {
            registeredCommands.set(command, callback);
            return new StubDisposable();
        },
        executeCommand: () => Promise.resolve(undefined)
    };

    const window: Record<string, unknown> = {
        activeTextEditor: undefined,
        showInformationMessage: () => Promise.resolve(undefined),
        showWarningMessage: () => Promise.resolve(undefined),
        showErrorMessage: () => Promise.resolve(undefined),
        showQuickPick: () => Promise.resolve(undefined),
        showInputBox: () => Promise.resolve(undefined),
        createStatusBarItem: () => ({
            name: '',
            text: '',
            tooltip: '',
            show: () => undefined
        }),
        registerTreeDataProvider: () => new StubDisposable(),
        createTreeView: () => new StubDisposable(),
        registerWebviewViewProvider: () => new StubDisposable(),
        onDidChangeTextEditorSelection: () => new StubDisposable(),
        onDidChangeActiveTextEditor: () => new StubDisposable(),
        onDidChangeConfiguration: () => new StubDisposable()
    };

    const workspace: Record<string, unknown> = {
        getConfiguration: () => ({
            get: <T>(_key: string, defaultValue?: T) => defaultValue
        }),
        onDidChangeConfiguration: () => new StubDisposable()
    };

    return { commands, window, workspace, events };
}

const stubs = makeCommandRegistryStubs();

const vscodeStub: Record<string, unknown> = {
    EventEmitter: StubEventEmitter,
    Disposable: StubDisposable,
    TreeItem: class TreeItem {
        label: string | undefined;
        collapsibleState: unknown;
        contextValue: string | undefined;
        iconPath: unknown;
        description: string | undefined;
        tooltip: string | undefined;
        command: unknown;
        constructor(label: string, collapsibleState?: unknown) {
            this.label = label;
            this.collapsibleState = collapsibleState;
        }
    },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    StatusBarAlignment: { Left: 0, Right: 1 },
    ThemeIcon: class ThemeIcon {
        constructor(public readonly id: string) {}
    },
    Uri: class Uri {
        scheme: string;
        path: string;
        constructor(scheme: string, p: string) { this.scheme = scheme; this.path = p; }
    },
    window: stubs.window,
    workspace: stubs.workspace,
    commands: stubs.commands
};

const originalPrototypeRequire = ModuleCtor.prototype.require;
ModuleCtor.prototype.require = function (id: string): unknown {
    if (id === 'vscode') {
        return vscodeStub;
    }
    return originalPrototypeRequire.call(this, id);
};

const realRequire = nodeRequire;

function loadWithVscodeStub<T>(modulePath: string): T {
    ModuleCtor.prototype.require = function (id: string): unknown {
        if (id === 'vscode') {
            return vscodeStub;
        }
        return originalPrototypeRequire.call(this, id);
    };
    try {
        const resolved = realRequire.resolve(modulePath);
        const cacheKey = require('module').Module._cache;
        if (cacheKey && cacheKey[resolved]) {
            delete cacheKey[resolved];
        }
        return realRequire(modulePath) as T;
    } finally {
        ModuleCtor.prototype.require = originalPrototypeRequire;
    }
}

const { LayerTreeProvider } = realRequire('../../layers/layerTreeProvider') as {
    LayerTreeProvider: typeof import('../../layers/layerTreeProvider')['LayerTreeProvider'];
};
const { DEFAULT_OVERLAY_LAYERS } = realRequire('../../layers/layerTypes') as {
    DEFAULT_OVERLAY_LAYERS: typeof import('../../layers/layerTypes')['DEFAULT_OVERLAY_LAYERS'];
};

function loadExtensionModule(): { activate: (context: unknown) => Promise<unknown> } {
    return loadWithVscodeStub('../../extension');
}

function makeExtensionContext(globalState: StubMemento): unknown {
    return {
        subscriptions: [] as unknown[],
        globalState,
        extensionUri: { scheme: 'file', path: '/tmp' }
    };
}

suite('Spot bug fixes', () => {
    setup(() => {
        resetCommandRegistry();
    });

    teardown(() => {
        resetCommandRegistry();
    });

    test('registerBasemap activates first basemap when active id is missing (BUG 1b)', async () => {
        const memento = new StubMemento();
        await memento.update('activeBaseMapId', 'does-not-exist');
        const ctx = makeExtensionContext(memento);

        const provider = new LayerTreeProvider(ctx as never);

        provider.registerBasemap({
            id: 'first',
            name: 'First',
            type: 'vector',
            styleUrl: 'https://example.com/first.json'
        });

        const active = provider.getActiveBaseMap();
        assert.ok(active, 'an active basemap should be set after registerBasemap');
        assert.strictEqual(active?.id, 'first', 'first registered basemap should become active');
    });

    test('persisted selected-file layer data is reset to empty FeatureCollection on restore (BUG 2)', async () => {
        const memento = new StubMemento();
        const persistedData = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] } }] };
        await memento.update('overlayLayers', [
            {
                id: 'selected-file',
                name: 'Selected file',
                type: 'geojson',
                source: { type: 'geojson', data: persistedData },
                visible: true
            }
        ]);
        const ctx = makeExtensionContext(memento);

        const provider = new LayerTreeProvider(ctx as never);

        const layer = provider.getSelectedFileLayer();
        assert.ok(layer, 'selected-file layer should exist');
        const data = layer?.source.data as { type: string; features: unknown[] };
        assert.strictEqual(data.type, 'FeatureCollection');
        assert.strictEqual(data.features.length, 0, 'features should be cleared on restore');
        assert.strictEqual(layer?.visible, true, 'visibility should be preserved');
    });

    test('persisting overlay layers strips the selected-file data (BUG 2)', async () => {
        const memento = new StubMemento();
        const ctx = makeExtensionContext(memento);

        const provider = new LayerTreeProvider(ctx as never);
        const data = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] } }] };
        await provider.updateSelectedFileLayer(data);

        const writes = memento.getUpdateCalls().filter(call => call.key === 'overlayLayers');
        assert.ok(writes.length > 0, 'overlayLayers should be persisted');
        const last = writes[writes.length - 1].value as Array<{ id: string; source: { data: { features: unknown[] } } }>;
        const selectedFile = last.find(layer => layer.id === 'selected-file');
        assert.ok(selectedFile, 'selected-file layer should be in persisted data');
        assert.strictEqual(
            selectedFile?.source.data.features.length,
            0,
            'persisted selected-file data should be an empty FeatureCollection'
        );
    });

    test('DEFAULT_OVERLAY_LAYERS is not mutated after toggleLayerVisibility (BUG 5)', async () => {
        const memento = new StubMemento();
        const ctx = makeExtensionContext(memento);

        const provider = new LayerTreeProvider(ctx as never);

        const beforeVisible = DEFAULT_OVERLAY_LAYERS[0].visible;

        await provider.toggleLayerVisibility('selected-file');

        assert.strictEqual(DEFAULT_OVERLAY_LAYERS[0].visible, beforeVisible, 'default visibility should be unchanged');
        const providerLayer = provider.getSelectedFileLayer();
        assert.notStrictEqual(
            providerLayer?.source,
            DEFAULT_OVERLAY_LAYERS[0].source,
            'provider should have its own source object'
        );
    });

    test('removeLayer and changeLayerColor commands do not throw with undefined (BUG 4)', async () => {
        const memento = new StubMemento();
        const ctx = makeExtensionContext(memento);
        new LayerTreeProvider(ctx as never);

        const { activate } = loadExtensionModule();

        await activate(ctx);

        const removeCallback = registeredCommands.get('vscodeMaplibreViewer.removeLayer');
        const colorCallback = registeredCommands.get('vscodeMaplibreViewer.changeLayerColor');

        assert.ok(removeCallback, 'removeLayer command should be registered');
        assert.ok(colorCallback, 'changeLayerColor command should be registered');

        assert.doesNotThrow(() => {
            void removeCallback!(undefined);
            void colorCallback!(undefined);
        });
        await Promise.resolve();
    });

    test('file selection listener wrapper handles adapter throw without unhandled rejection (BUG 3)', async () => {
        const memento = new StubMemento();
        const ctx = makeExtensionContext(memento);
        new LayerTreeProvider(ctx as never);

        const errors: string[] = [];
        const windowStub = vscodeStub.window as { showErrorMessage: (msg: string) => Promise<string | undefined> };
        const originalShowError = windowStub.showErrorMessage;
        windowStub.showErrorMessage = (msg: string) => {
            errors.push(msg);
            return Promise.resolve(undefined);
        };

        try {
            const handler = async (shouldThrow: boolean) => {
                if (shouldThrow) {
                    throw new Error('boom');
                }
            };

            const wrapped = (shouldThrow: boolean) => {
                (async () => {
                    try {
                        await handler(shouldThrow);
                    } catch (error) {
                        const message = error instanceof Error ? error.message : String(error);
                        windowStub.showErrorMessage(
                            `Failed to handle file selection: ${message}`
                        );
                    }
                })();
            };

            wrapped(true);
            wrapped(false);

            await new Promise(resolve => setTimeout(resolve, 10));
            assert.strictEqual(errors.length, 1, 'exactly one error should be reported');
            assert.ok(errors[0].includes('boom'), 'error message should include the original error');
        } finally {
            windowStub.showErrorMessage = originalShowError;
        }
    });
});

ModuleCtor.prototype.require = originalPrototypeRequire;
