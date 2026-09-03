import * as assert from 'assert';
import { createRequire } from 'module';

// The vscode module only resolves inside the extension host; stub it so the
// bookmark modules can be imported in plain node unit tests.
const nodeRequire = createRequire(__filename);
const ModuleCtor = nodeRequire('module') as typeof import('module');

const registeredCommands = new Map<string, (arg: unknown) => unknown>();
let inputBoxResult: string | undefined;
let infoMessages: string[] = [];
let errorMessages: string[] = [];

class MarkdownStringStub {
    value = '';
    appendMarkdown(text: string): void {
        this.value += text;
    }
}

class EventEmitterStub {
    private readonly handlers: ((e: unknown) => void)[] = [];
    fireCount = 0;

    fire(e: unknown): void {
        this.fireCount++;
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
        showWarningMessage: (): Promise<undefined> => Promise.resolve(undefined),
        showInformationMessage: (msg: string): Promise<undefined> => {
            infoMessages.push(msg);
            return Promise.resolve(undefined);
        },
        showQuickPick: (): Promise<undefined> => Promise.resolve(undefined),
        showInputBox: (): Promise<string | undefined> => Promise.resolve(inputBoxResult)
    },
    commands: {
        registerCommand: (id: string, cb: (arg: unknown) => unknown): { dispose: () => void } => {
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

// Earlier test files may have cached the bookmark modules against a different
// vscode stub. Evict them so they load against this file's stub.
const moduleCache = (ModuleCtor as unknown as { _cache: Record<string, unknown> })._cache;
for (const cachedPath of Object.keys(moduleCache)) {
    if (
        cachedPath.includes('bookmarkTreeProvider') ||
        cachedPath.includes('bookmarkManager') ||
        cachedPath.includes('extensionUtils') ||
        cachedPath.includes('bookmarkFormatter') ||
        cachedPath.includes('treeDataProviderBase')
    ) {
        delete moduleCache[cachedPath];
    }
}

const { BookmarkTreeProvider } = nodeRequire('../../bookmarks/bookmarkTreeProvider') as {
    BookmarkTreeProvider: typeof import('../../bookmarks/bookmarkTreeProvider')['BookmarkTreeProvider'];
};
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

suite('BookmarkTreeProvider tests', () => {
    const context = { subscriptions: [] as { dispose(): void }[] };

    setup(() => {
        registeredCommands.clear();
        inputBoxResult = undefined;
        infoMessages = [];
        errorMessages = [];
    });

    function createProvider(bookmarksStore: Array<ReturnType<typeof createTestBookmark>> = []): {
        provider: import('../../bookmarks/bookmarkTreeProvider').BookmarkTreeProvider;
        memento: MockMemento;
    } {
        const memento = new MockMemento();
        if (bookmarksStore.length > 0) {
            memento.setRaw('vscodeMaplibreViewer.bookmarks', {
                version: 1,
                bookmarks: bookmarksStore,
                lastUpdated: '2024-01-01T00:00:00.000Z'
            });
        }
        const manager = new BookmarkManager(memento as never);
        const provider = new BookmarkTreeProvider(manager);
        return { provider, memento };
    }

    suite('getTreeItem', () => {
        test('builds a non-collapsible tree item with bookmark details', () => {
            const { provider } = createProvider();
            const bookmark = createTestBookmark({ id: 't', name: 'Test Spot' });
            const item = provider.getTreeItem(bookmark) as unknown as TreeItemStub;

            assert.strictEqual(item.collapsibleState, 0);
            assert.ok(item.description, 'should have a coordinate description');
            assert.ok(item.tooltip, 'should have a tooltip');
            assert.ok(item.command);
            assert.strictEqual((item.command as { command: string }).command, 'vscodeMaplibreViewer.goToBookmark');
            assert.strictEqual(item.contextValue, 'bookmark');
            assert.ok(item.iconPath, 'should have an icon');
        });

        test('builds a tree item for a bookmark without a center', () => {
            const { provider } = createProvider();
            const bookmark = createTestBookmark({ id: 't', name: 'No Center' });
            delete (bookmark as { center?: unknown }).center;

            const item = provider.getTreeItem(bookmark as never) as unknown as TreeItemStub;
            assert.strictEqual(item.label, 'No Center');
            assert.ok(item.description, 'should fall back to zero coordinates');
        });
    });

    suite('getChildren', () => {
        test('returns empty for a parent element', async () => {
            const { provider } = createProvider();
            const children = await provider.getChildren(createTestBookmark({ id: 'parent' }));
            assert.deepStrictEqual(children, []);
        });

        test('returns all bookmarks at the root level', async () => {
            const { provider } = createProvider([
                createTestBookmark({ id: 'a', name: 'A' }),
                createTestBookmark({ id: 'b', name: 'B' })
            ]);
            const children = await provider.getChildren();
            assert.ok(children);
            assert.strictEqual(children.length, 2);
        });
    });

    suite('refresh', () => {
        test('fires the onDidChangeTreeData event', () => {
            const { provider } = createProvider();
            const emitter = (provider as unknown as { _onDidChangeTreeData: EventEmitterStub })._onDidChangeTreeData;
            const before = emitter.fireCount;

            provider.refresh();

            assert.strictEqual(emitter.fireCount, before + 1);
        });
    });

    suite('renameBookmark', () => {
        test('registers the rename command', () => {
            const { provider } = createProvider();
            provider.registerCommands(context as never);
            assert.ok(registeredCommands.has('vscodeMaplibreViewer.renameBookmark'));
        });

        test('shows an error when invoked without a selected bookmark', async () => {
            const { provider } = createProvider();
            await (provider as unknown as { renameBookmark(b?: unknown): Promise<void> }).renameBookmark();

            assert.ok(errorMessages.some((m) => m.includes('No bookmark selected')));
        });

        test('renames an existing bookmark', async () => {
            const { provider } = createProvider([createTestBookmark({ id: 'r', name: 'Old Name' })]);
            inputBoxResult = 'New Name';

            await (provider as unknown as { renameBookmark(b: unknown): Promise<void> }).renameBookmark(
                createTestBookmark({ id: 'r', name: 'Old Name' })
            );

            assert.ok(infoMessages.some((m) => m.includes('New Name')));
        });

        test('does nothing when the user cancels the input box', async () => {
            const { provider } = createProvider([createTestBookmark({ id: 'r', name: 'Old Name' })]);
            inputBoxResult = undefined;

            await (provider as unknown as { renameBookmark(b: unknown): Promise<void> }).renameBookmark(
                createTestBookmark({ id: 'r', name: 'Old Name' })
            );

            assert.strictEqual(infoMessages.length, 0);
        });

        test('does nothing when the name is unchanged', async () => {
            const { provider } = createProvider([createTestBookmark({ id: 'r', name: 'Same' })]);
            inputBoxResult = '  Same  ';

            await (provider as unknown as { renameBookmark(b: unknown): Promise<void> }).renameBookmark(
                createTestBookmark({ id: 'r', name: 'Same' })
            );

            assert.strictEqual(infoMessages.length, 0);
        });

        test('shows an error when the bookmark no longer exists', async () => {
            const { provider } = createProvider([]);
            inputBoxResult = 'Ghost';

            await (provider as unknown as { renameBookmark(b: unknown): Promise<void> }).renameBookmark(
                createTestBookmark({ id: 'gone', name: 'Gone' })
            );

            assert.ok(errorMessages.some((m) => m.includes('Failed to rename bookmark. Bookmark not found')));
        });

        test('shows an error when renaming throws', async () => {
            inputBoxResult = 'Boom';

            const throwingManager = new BookmarkManager(({
                get: (): { bookmarks: ReturnType<typeof createTestBookmark>[] } => ({ bookmarks: [createTestBookmark({ id: 'x', name: 'X' })] }),
                update: (): Promise<void> => Promise.reject(new Error('storage failure'))
            }) as never);
            const throwingProvider = new BookmarkTreeProvider(throwingManager);

            await (throwingProvider as unknown as { renameBookmark(b: unknown): Promise<void> }).renameBookmark(
                createTestBookmark({ id: 'x', name: 'X' })
            );

            assert.ok(errorMessages.some((m) => m.includes('Failed to rename bookmark')));
        });
    });
});
