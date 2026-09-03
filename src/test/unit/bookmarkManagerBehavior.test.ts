import * as assert from 'assert';
import { createRequire } from 'module';

// The vscode module only resolves inside the extension host; stub it so the
// bookmark modules can be imported in plain node unit tests.
const nodeRequire = createRequire(__filename);
const ModuleCtor = nodeRequire('module') as typeof import('module');

const registeredCommands = new Map<string, (arg: unknown, ...rest: unknown[]) => unknown>();
let quickPickResult: unknown;
let inputBoxResult: unknown;
let warningResult: unknown;
let infoMessages: string[] = [];
let errorMessages: string[] = [];
let capturedInputValidator: ((value: string) => string | null | undefined) | undefined;

class MarkdownStringStub {
    value = '';
    appendMarkdown(text: string): void {
        this.value += text;
    }
}

class EventEmitterStub {
    private readonly handlers: ((e: unknown) => void)[] = [];

    fire(e: unknown): void {
        for (const h of this.handlers) {
            h(e);
        }
    }

    get event(): (fn: (e: unknown) => void) => { dispose: () => void } {
        return (fn: (e: unknown) => void): { dispose: () => void } => {
            this.handlers.push(fn);
            return { dispose: (): void => undefined };
        };
    }
}

class TreeItemStub {
    description: string | undefined;
    tooltip: unknown;
    command: unknown;
    contextValue: string | undefined;
    iconPath: unknown;

    constructor(public label: string, public collapsibleState: number) {}
}

class ThemeIconStub {
    constructor(public id: string) {}
}

const vscodeStub = {
    window: {
        showErrorMessage: (msg: string): Promise<undefined> => {
            errorMessages.push(msg);
            return Promise.resolve(undefined);
        },
        showWarningMessage: (): Promise<unknown> => Promise.resolve(warningResult),
        showInformationMessage: (msg: string): Promise<undefined> => {
            infoMessages.push(msg);
            return Promise.resolve(undefined);
        },
        showQuickPick: (): Promise<unknown> => Promise.resolve(quickPickResult),
        showInputBox: (options?: { validateInput?: (value: string) => string | null | undefined }): Promise<unknown> => {
            capturedInputValidator = options?.validateInput;
            return Promise.resolve(inputBoxResult);
        }
    },
    commands: {
        registerCommand: (id: string, cb: (arg: unknown, ...rest: unknown[]) => unknown): { dispose: () => void } => {
            registeredCommands.set(id, cb);
            return { dispose: (): void => undefined };
        },
        executeCommand: (): Promise<unknown> => Promise.resolve(undefined)
    },
    workspace: {
        getConfiguration: () => ({
            get: <T>(_key: string, defaultValue?: T): T | undefined => defaultValue,
            update: (): Promise<void> => Promise.resolve()
        }),
        onDidChangeConfiguration: (): { dispose: () => void } => ({ dispose: (): void => undefined })
    },
    MarkdownString: MarkdownStringStub,
    EventEmitter: EventEmitterStub,
    TreeItem: TreeItemStub,
    TreeItemCollapsibleState: { None: 0 },
    ThemeIcon: ThemeIconStub,
    QuickPickItemKind: { Separator: 2 }
};

const originalPrototypeRequire = ModuleCtor.prototype.require;
ModuleCtor.prototype.require = function (id: string): unknown {
    if (id === 'vscode') {
        return vscodeStub;
    }
    return originalPrototypeRequire.call(this, id);
};

// Other unit test files load the bookmark modules against their own vscode
// stubs, so Node's module cache may already hold copies bound to a different
// stub. Drop the affected modules from the cache so they reload here against
// this file's stub and its command registry / window mocks are actually used.
const cache = (ModuleCtor as unknown as { _cache: Record<string, unknown> })._cache;
for (const cachedPath of Object.keys(cache)) {
    if (
        cachedPath.includes('bookmarkManager') ||
        cachedPath.includes('bookmarkTreeProvider') ||
        cachedPath.includes('extensionUtils') ||
        cachedPath.includes('bookmarkFormatter') ||
        cachedPath.includes('treeDataProviderBase')
    ) {
        delete cache[cachedPath];
    }
}

const { BookmarkManager } = nodeRequire('../../bookmarks/bookmarkManager') as {
    BookmarkManager: typeof import('../../bookmarks/bookmarkManager')['BookmarkManager'];
};
const { createTestBookmark } = nodeRequire('../testUtils') as typeof import('../testUtils');
ModuleCtor.prototype.require = originalPrototypeRequire;

class MockMemento {
    private store = new Map<string, unknown>();

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
}

suite('BookmarkManager command behavior tests', () => {
    setup(() => {
        registeredCommands.clear();
        quickPickResult = undefined;
        inputBoxResult = undefined;
        warningResult = undefined;
        infoMessages = [];
        errorMessages = [];
        capturedInputValidator = undefined;
    });

    suite('registerCommands', () => {
        const context = { subscriptions: [] as { dispose(): void }[] };
        const viewState = {
            center: { latitude: 59.32, longitude: 18.06 },
            zoom: 12,
            bearing: 45,
            pitch: 30
        };
        const flyCalls: unknown[] = [];
        const providers = [
            { constructor: { name: 'MapViewProvider' }, getCurrentViewState: async (): Promise<typeof viewState> => viewState },
            { constructor: { name: 'MapEditorProvider' }, createPanel: async (): Promise<void> => undefined }
        ];
        const providerManager = {
            getProviders: (): unknown[] => providers,
            flyToBookmark: (b: unknown): void => {
                flyCalls.push(b);
            }
        } as unknown as { getProviders(): unknown[]; flyToBookmark(b: unknown): void };

        setup(() => {
            flyCalls.length = 0;
        });

        test('registers all bookmark commands', () => {
            const memento = new MockMemento();
            const manager = new BookmarkManager(memento as never);
            const tree = { refresh: (): void => undefined } as never;

            manager.registerCommands(context as never, tree as never, providerManager as never);

            for (const id of [
                'vscodeMaplibreViewer.goToBookmark',
                'vscodeMaplibreViewer.openBookmarkInEditor',
                'vscodeMaplibreViewer.deleteBookmark',
                'vscodeMaplibreViewer.saveBookmark',
                'vscodeMaplibreViewer.loadBookmark'
            ]) {
                assert.ok(registeredCommands.has(id), `missing ${id}`);
            }
        });

        test('goToBookmark flies to the selected bookmark', async () => {
            const memento = new MockMemento();
            const manager = new BookmarkManager(memento as never);
            manager.registerCommands(context as never, {} as never, providerManager as never);

            const bookmark = createTestBookmark({ id: 'g', name: 'Go' });
            const cb = registeredCommands.get('vscodeMaplibreViewer.goToBookmark');
            assert.ok(cb);
            (cb as (arg: unknown) => unknown)(bookmark);

            assert.strictEqual(flyCalls.length, 1);
            assert.strictEqual(flyCalls[0], bookmark);
        });

        test('openBookmarkInEditor shows error when no editor provider is available', async () => {
            const memento = new MockMemento();
            const manager = new BookmarkManager(memento as never);
            const emptyProviders = { getProviders: (): unknown[] => [], flyToBookmark: (): void => undefined };
            manager.registerCommands(context as never, {} as never, emptyProviders as never);

            const cb = registeredCommands.get('vscodeMaplibreViewer.openBookmarkInEditor');
            assert.ok(cb);
            await (cb as (arg: unknown) => Promise<void>)(createTestBookmark());

            assert.ok(errorMessages.some((m) => m.includes('Map Editor is not available')));
        });

        test('deleteBookmark deletes when confirmed', async () => {
            const memento = new MockMemento();
            const manager = new BookmarkManager(memento as never);
            await manager.saveBookmark(createTestBookmark({ id: 'del', name: 'Del' }));
            let refreshCount = 0;
            const tree = { refresh: (): void => {
                refreshCount++;
            } };
            manager.registerCommands(context as never, tree as never, providerManager as never);

            warningResult = 'Delete';
            const cb = registeredCommands.get('vscodeMaplibreViewer.deleteBookmark');
            assert.ok(cb);
            await (cb as (arg: unknown) => Promise<void>)(createTestBookmark({ id: 'del', name: 'Del' }));

            assert.strictEqual(manager.count, 0);
            assert.strictEqual(refreshCount, 1);
        });

        test('deleteBookmark does not delete when cancelled', async () => {
            const memento = new MockMemento();
            const manager = new BookmarkManager(memento as never);
            await manager.saveBookmark(createTestBookmark({ id: 'del', name: 'Del' }));
            const tree = { refresh: (): void => undefined };
            manager.registerCommands(context as never, tree as never, providerManager as never);

            warningResult = 'Cancel';
            const cb = registeredCommands.get('vscodeMaplibreViewer.deleteBookmark');
            assert.ok(cb);
            await (cb as (arg: unknown) => Promise<void>)(createTestBookmark({ id: 'del', name: 'Del' }));

            assert.strictEqual(manager.count, 1);
        });
    });

    suite('handleSaveBookmark / handleLoadBookmark (via commands)', () => {
        const context = { subscriptions: [] as { dispose(): void }[] };
        const viewState = {
            center: { latitude: 59.32, longitude: 18.06 },
            zoom: 12,
            bearing: 45,
            pitch: 30
        };
        const flyCalls: unknown[] = [];
        const providers = [
            { constructor: { name: 'MapViewProvider' }, getCurrentViewState: async (): Promise<typeof viewState> => viewState },
            { constructor: { name: 'MapEditorProvider' }, createPanel: async (): Promise<void> => undefined }
        ];
        const providerManager = {
            getProviders: (): unknown[] => providers,
            flyToBookmark: (b: unknown): void => {
                flyCalls.push(b);
            }
        } as unknown as { getProviders(): unknown[]; flyToBookmark(b: unknown): void };

        setup(() => {
            flyCalls.length = 0;
        });

        test('creates a new bookmark from the current view', async () => {
            const memento = new MockMemento();
            const manager = new BookmarkManager(memento as never);
            let refreshCount = 0;
            const tree = { refresh: (): void => {
                refreshCount++;
            } };
            manager.registerCommands(context as never, tree as never, providerManager as never);

            quickPickResult = { label: '$(add) Create New Bookmark...', isNew: true };
            inputBoxResult = 'My New Spot';
            const cb = registeredCommands.get('vscodeMaplibreViewer.saveBookmark');
            assert.ok(cb);
            await (cb as () => Promise<void>)();

            const all = manager.getAllBookmarks();
            assert.strictEqual(all.length, 1);
            assert.strictEqual(all[0].name, 'My New Spot');
            assert.strictEqual(refreshCount, 1);
        });

        test('does nothing when the quick pick is cancelled', async () => {
            const memento = new MockMemento();
            const manager = new BookmarkManager(memento as never);
            manager.registerCommands(context as never, { refresh: (): void => undefined } as never, providerManager as never);

            quickPickResult = undefined;
            const cb = registeredCommands.get('vscodeMaplibreViewer.saveBookmark');
            assert.ok(cb);
            await (cb as () => Promise<void>)();

            assert.strictEqual(manager.count, 0);
        });

        test('updates an existing bookmark when selected', async () => {
            const memento = new MockMemento();
            const manager = new BookmarkManager(memento as never);
            await manager.saveBookmark(createTestBookmark({ id: 'u', name: 'Existing', zoom: 5 }));
            manager.registerCommands(context as never, { refresh: (): void => undefined } as never, providerManager as never);

            const existing = createTestBookmark({ id: 'u', name: 'Existing', zoom: 5 });
            quickPickResult = { label: 'Existing', bookmark: existing };
            warningResult = 'Update';
            const cb = registeredCommands.get('vscodeMaplibreViewer.saveBookmark');
            assert.ok(cb);
            await (cb as () => Promise<void>)();

            const updated = manager.getBookmark('u');
            assert.ok(updated);
            assert.strictEqual(updated.zoom, 12);
            assert.strictEqual(updated.name, 'Existing');
        });

        test('loadBookmark shows info message when there are no bookmarks', async () => {
            const memento = new MockMemento();
            const manager = new BookmarkManager(memento as never);
            manager.registerCommands(context as never, {} as never, providerManager as never);

            const cb = registeredCommands.get('vscodeMaplibreViewer.loadBookmark');
            assert.ok(cb);
            await (cb as () => Promise<void>)();

            assert.ok(infoMessages.some((m) => m.includes('No bookmarks saved')));
        });

        test('loadBookmark flies to the selected bookmark', async () => {
            const memento = new MockMemento();
            const manager = new BookmarkManager(memento as never);
            const bookmark = createTestBookmark({ id: 'l', name: 'Load' });
            await manager.saveBookmark(bookmark);
            manager.registerCommands(context as never, {} as never, providerManager as never);

            quickPickResult = { label: 'Load', bookmark };
            const cb = registeredCommands.get('vscodeMaplibreViewer.loadBookmark');
            assert.ok(cb);
            await (cb as () => Promise<void>)();

            assert.strictEqual(flyCalls.length, 1);
            assert.strictEqual(flyCalls[0], bookmark);
        });

        test('loadBookmark does nothing when the quick pick is cancelled', async () => {
            const memento = new MockMemento();
            const manager = new BookmarkManager(memento as never);
            await manager.saveBookmark(createTestBookmark({ id: 'l', name: 'Load' }));
            manager.registerCommands(context as never, {} as never, providerManager as never);

            quickPickResult = undefined;
            const cb = registeredCommands.get('vscodeMaplibreViewer.loadBookmark');
            assert.ok(cb);
            await (cb as () => Promise<void>)();

            assert.strictEqual(flyCalls.length, 0);
        });

        test('saveBookmark with a falsy view state warns the user', async () => {
            const falsyProviderManager = {
                getProviders: (): unknown[] => [
                    { constructor: { name: 'MapViewProvider' }, getCurrentViewState: async (): Promise<null> => null }
                ],
                flyToBookmark: (): void => undefined
            } as unknown as { getProviders(): unknown[]; flyToBookmark(b: unknown): void };

            const messages: string[] = [];
            const memento = new MockMemento();
            const manager = new BookmarkManager(memento as never);

            const originalShowWarningMessage = vscodeStub.window.showWarningMessage;
            vscodeStub.window.showWarningMessage = (((msg: string): Promise<unknown> => {
                messages.push(msg);
                return Promise.resolve(undefined);
            }) as () => Promise<unknown>);
            try {
                manager.registerCommands(context as never, { refresh: (): void => undefined } as never, falsyProviderManager as never);
                const cb = registeredCommands.get('vscodeMaplibreViewer.saveBookmark');
                assert.ok(cb);
                await (cb as () => Promise<void>)();

                assert.ok(messages.some((m) => m.includes('Unable to get current map view')));
            } finally {
                vscodeStub.window.showWarningMessage = originalShowWarningMessage;
            }
        });

        test('createBookmark validation rejects an empty name', async () => {
            const memento = new MockMemento();
            const manager = new BookmarkManager(memento as never);
            manager.registerCommands(context as never, { refresh: (): void => undefined } as never, providerManager as never);

            quickPickResult = { label: '$(add) Create New Bookmark...', isNew: true };
            inputBoxResult = 'Will Not Be Used';
            const cb = registeredCommands.get('vscodeMaplibreViewer.saveBookmark');
            assert.ok(cb);
            await (cb as () => Promise<void>)();

            assert.ok(capturedInputValidator, 'validator should be supplied');
            const validateCreateName = capturedInputValidator as (v: string) => string | null | undefined;
            assert.ok((validateCreateName('') ?? '').includes('Name is required'));
            assert.strictEqual(validateCreateName('   '), 'Name is required');
            assert.strictEqual(validateCreateName('  Good Name  '), null);
        });

        test('createBookmark validation rejects a duplicate name', async () => {
            const memento = new MockMemento();
            const manager = new BookmarkManager(memento as never);
            await manager.saveBookmark(createTestBookmark({ id: 'dup', name: 'Taken' }));
            manager.registerCommands(context as never, { refresh: (): void => undefined } as never, providerManager as never);

            quickPickResult = { label: '$(add) Create New Bookmark...', isNew: true };
            inputBoxResult = 'Taken';
            const cb = registeredCommands.get('vscodeMaplibreViewer.saveBookmark');
            assert.ok(cb);
            await (cb as () => Promise<void>)();

            assert.ok(capturedInputValidator);
            const validateDupName = capturedInputValidator as (v: string) => string | null | undefined;
            assert.ok((validateDupName('taken') ?? '').includes('already exists'));
        });

        test('createBookmark does nothing when the input box is cancelled', async () => {
            const memento = new MockMemento();
            const manager = new BookmarkManager(memento as never);
            manager.registerCommands(context as never, { refresh: (): void => undefined } as never, providerManager as never);

            quickPickResult = { label: '$(add) Create New Bookmark...', isNew: true };
            inputBoxResult = undefined;
            const cb = registeredCommands.get('vscodeMaplibreViewer.saveBookmark');
            assert.ok(cb);
            await (cb as () => Promise<void>)();

            assert.strictEqual(manager.count, 0);
        });

        test('createBookmark reports an error when saving fails', async () => {
            const failingMemento = new MockMemento();
            (failingMemento as unknown as { update: unknown }).update = (): Promise<void> => Promise.reject(new Error('storage failure'));

            const manager = new BookmarkManager(failingMemento as never);
            manager.registerCommands(context as never, { refresh: (): void => undefined } as never, providerManager as never);

            quickPickResult = { label: '$(add) Create New Bookmark...', isNew: true };
            inputBoxResult = 'Failing';
            const cb = registeredCommands.get('vscodeMaplibreViewer.saveBookmark');
            assert.ok(cb);
            await (cb as () => Promise<void>)();

            assert.ok(errorMessages.some((m) => m.includes('Failed to save bookmark')));
        });

        test('updateExistingBookmark does nothing when confirmation is cancelled', async () => {
            const memento = new MockMemento();
            const manager = new BookmarkManager(memento as never);
            await manager.saveBookmark(createTestBookmark({ id: 'u', name: 'Existing', zoom: 5 }));
            manager.registerCommands(context as never, { refresh: (): void => undefined } as never, providerManager as never);

            quickPickResult = { label: 'Existing', bookmark: createTestBookmark({ id: 'u', name: 'Existing', zoom: 5 }) };
            warningResult = 'Cancel';
            const cb = registeredCommands.get('vscodeMaplibreViewer.saveBookmark');
            assert.ok(cb);
            await (cb as () => Promise<void>)();

            const stored = manager.getBookmark('u');
            assert.ok(stored);
            assert.strictEqual(stored.zoom, 5, 'should not update when cancelled');
        });

        test('updateExistingBookmark reports an error when saving fails', async () => {
            const failingMemento = new MockMemento();
            failingMemento.setRaw('vscodeMaplibreViewer.bookmarks', {
                version: 1,
                bookmarks: [createTestBookmark({ id: 'u', name: 'Existing', zoom: 5 })],
                lastUpdated: '2024-01-01T00:00:00.000Z'
            });
            (failingMemento as unknown as { update: unknown }).update = (): Promise<void> => Promise.reject(new Error('update failure'));
            const manager = new BookmarkManager(failingMemento as never);
            manager.registerCommands(context as never, { refresh: (): void => undefined } as never, providerManager as never);

            quickPickResult = { label: 'Existing', bookmark: createTestBookmark({ id: 'u', name: 'Existing', zoom: 5 }) };
            warningResult = 'Update';
            const cb = registeredCommands.get('vscodeMaplibreViewer.saveBookmark');
            assert.ok(cb);
            await (cb as () => Promise<void>)();

            assert.ok(errorMessages.some((m) => m.includes('Failed to update bookmark')));
        });
    });
});
