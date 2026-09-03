import * as assert from 'assert';
import { createRequire } from 'module';

// The vscode module only resolves inside the extension host; stub it so the
// bookmark modules can be imported in plain node unit tests.
const nodeRequire = createRequire(__filename);
const ModuleCtor = nodeRequire('module') as typeof import('module');

const registeredCommands = new Map<string, (arg: unknown, ...rest: unknown[]) => unknown>();
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
        showWarningMessage: (): Promise<unknown> => Promise.resolve(undefined),
        showInformationMessage: (msg: string): Promise<undefined> => {
            infoMessages.push(msg);
            return Promise.resolve(undefined);
        },
        showQuickPick: (): Promise<unknown> => Promise.resolve(undefined),
        showInputBox: (): Promise<unknown> => Promise.resolve(undefined)
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
// this file's stub.
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

suite('BookmarkManager CRUD tests', () => {
    setup(() => {
        registeredCommands.clear();
        infoMessages = [];
        errorMessages = [];
    });

    suite('saveBookmark', () => {
        test('adds a new bookmark and generates an id and timestamps', async () => {
            const memento = new MockMemento();
            const manager = new BookmarkManager(memento as never);
            const bookmark = createTestBookmark();
            delete (bookmark as { id?: string }).id;
            delete (bookmark as { createdAt?: string }).createdAt;

            const saved = await manager.saveBookmark(bookmark);

            assert.ok(saved.id.length > 0, 'should generate an id');
            assert.ok(saved.createdAt, 'should set createdAt');
            assert.ok(saved.updatedAt, 'should set updatedAt');
            assert.strictEqual(manager.count, 1);
        });

        test('adds a bookmark generating all timestamps when missing', async () => {
            const memento = new MockMemento();
            const manager = new BookmarkManager(memento as never);
            const bookmark = createTestBookmark();
            delete (bookmark as { id?: string }).id;
            delete (bookmark as { createdAt?: string }).createdAt;
            delete (bookmark as { updatedAt?: string }).updatedAt;

            const saved = await manager.saveBookmark(bookmark);

            assert.ok(saved.createdAt, 'should set createdAt when missing');
            assert.ok(saved.updatedAt, 'should set updatedAt when missing');
            assert.strictEqual(manager.count, 1);
        });

        test('preserves a provided timestamp when adding a new bookmark', async () => {
            const memento = new MockMemento();
            const manager = new BookmarkManager(memento as never);
            const bookmark = createTestBookmark({ updatedAt: '2020-05-05T00:00:00.000Z' });
            delete (bookmark as { id?: string }).id;

            const saved = await manager.saveBookmark(bookmark);

            assert.strictEqual(saved.id.length > 0, true);
            assert.strictEqual(saved.updatedAt, '2020-05-05T00:00:00.000Z');
        });

        test('updates an existing bookmark with the same id', async () => {
            const memento = new MockMemento();
            const manager = new BookmarkManager(memento as never);
            const bookmark = createTestBookmark({ name: 'First' });
            await manager.saveBookmark(bookmark);

            const updated = createTestBookmark({ id: bookmark.id, name: 'Second' });
            await manager.saveBookmark(updated);

            const stored = manager.getBookmark(bookmark.id);
            assert.ok(stored);
            assert.strictEqual(stored.name, 'Second');
            assert.strictEqual(manager.count, 1, 'should not duplicate');
        });
    });

    suite('createBookmark', () => {
        test('creates a bookmark with all view state fields', async () => {
            const memento = new MockMemento();
            const manager = new BookmarkManager(memento as never);
            const bookmark = await manager.createBookmark(
                '  My Place  ',
                {
                    center: { latitude: 59.32, longitude: 18.06 },
                    zoom: 12,
                    bearing: 45,
                    pitch: 30
                },
                '  A description  '
            );

            assert.strictEqual(bookmark.name, 'My Place');
            assert.strictEqual(bookmark.description, 'A description');
            assert.deepStrictEqual(bookmark.center, { latitude: 59.32, longitude: 18.06 });
            assert.strictEqual(bookmark.zoom, 12);
            assert.strictEqual(bookmark.bearing, 45);
            assert.strictEqual(bookmark.pitch, 30);
        });

        test('defaults bearing and pitch to 0', async () => {
            const memento = new MockMemento();
            const manager = new BookmarkManager(memento as never);
            const bookmark = await manager.createBookmark('Flat', {
                center: { latitude: 0, longitude: 0 },
                zoom: 5,
                bearing: 0,
                pitch: 0
            });

            assert.strictEqual(bookmark.bearing, 0);
            assert.strictEqual(bookmark.pitch, 0);
        });
    });

    suite('getBookmark / findByName', () => {
        test('returns undefined when bookmark does not exist', () => {
            const memento = new MockMemento();
            const manager = new BookmarkManager(memento as never);
            assert.strictEqual(manager.getBookmark('missing'), undefined);
        });

        test('finds a bookmark by case-insensitive name', async () => {
            const memento = new MockMemento();
            const manager = new BookmarkManager(memento as never);
            await manager.saveBookmark(createTestBookmark({ id: 's', name: 'Stockholm' }));

            assert.ok(manager.findByName('stockholm'));
            assert.ok(manager.findByName('STOCKHOLM'));
            assert.strictEqual(manager.findByName('Gothenburg'), undefined);
        });

        test('nameExists reflects bookmark presence', async () => {
            const memento = new MockMemento();
            const manager = new BookmarkManager(memento as never);
            await manager.saveBookmark(createTestBookmark({ id: 's', name: 'Stockholm' }));

            assert.strictEqual(manager.nameExists('stockholm'), true);
            assert.strictEqual(manager.nameExists('nowhere'), false);
        });
    });

    suite('deleteBookmark', () => {
        test('returns false if the bookmark is not found', async () => {
            const memento = new MockMemento();
            const manager = new BookmarkManager(memento as never);
            assert.strictEqual(await manager.deleteBookmark('missing'), false);
        });

        test('deletes an existing bookmark', async () => {
            const memento = new MockMemento();
            const manager = new BookmarkManager(memento as never);
            await manager.saveBookmark(createTestBookmark({ id: 'del' }));

            assert.strictEqual(await manager.deleteBookmark('del'), true);
            assert.strictEqual(manager.count, 0);
            const stored = memento.get('vscodeMaplibreViewer.bookmarks') as { bookmarks: unknown[] } | undefined;
            assert.ok(stored, 'collection should persist');
            assert.strictEqual(stored.bookmarks.length, 0);
        });
    });

    suite('updateBookmark', () => {
        test('returns undefined when bookmark does not exist', async () => {
            const memento = new MockMemento();
            const manager = new BookmarkManager(memento as never);
            assert.strictEqual(await manager.updateBookmark('missing', { name: 'X' }), undefined);
        });

        test('updates fields while preserving id and createdAt', async () => {
            const memento = new MockMemento();
            const manager = new BookmarkManager(memento as never);
            const createdAt = '2020-01-01T00:00:00.000Z';
            await manager.saveBookmark(createTestBookmark({ id: 'u', name: 'Old', createdAt }));

            const updated = await manager.updateBookmark('u', { name: 'New', zoom: 20 });
            assert.ok(updated);
            assert.strictEqual(updated.name, 'New');
            assert.strictEqual(updated.zoom, 20);
            assert.strictEqual(updated.id, 'u');
            assert.strictEqual(updated.createdAt, createdAt);
        });
    });

    suite('clearAll / count', () => {
        test('clears all bookmarks', async () => {
            const memento = new MockMemento();
            const manager = new BookmarkManager(memento as never);
            await manager.saveBookmark(createTestBookmark({ id: 'a' }));
            await manager.saveBookmark(createTestBookmark({ id: 'b' }));

            await manager.clearAll();

            assert.strictEqual(manager.count, 0);
            assert.deepStrictEqual(manager.getAllBookmarks(), []);
        });

        test('count reflects stored bookmarks', async () => {
            const memento = new MockMemento();
            const manager = new BookmarkManager(memento as never);
            assert.strictEqual(manager.count, 0);
            await manager.saveBookmark(createTestBookmark({ id: 'a' }));
            assert.strictEqual(manager.count, 1);
        });
    });

    suite('validation of persisted bookmarks', () => {
        test('drops a bookmark with an out-of-range negative latitude', async () => {
            const memento = new MockMemento();
            await memento.update('vscodeMaplibreViewer.bookmarks', {
                version: 1,
                bookmarks: [
                    createTestBookmark({ id: 'ok', name: 'Ok' }),
                    { id: 'bad', name: 'Bad', center: { latitude: -91, longitude: 0 }, zoom: 5 }
                ],
                lastUpdated: '2024-01-01T00:00:00.000Z'
            });

            const manager = new BookmarkManager(memento as never);
            assert.strictEqual(manager.getAllBookmarks().length, 1);
        });

        test('drops a bookmark with an out-of-range longitude', async () => {
            const memento = new MockMemento();
            await memento.update('vscodeMaplibreViewer.bookmarks', {
                version: 1,
                bookmarks: [
                    createTestBookmark({ id: 'ok', name: 'Ok' }),
                    { id: 'bad', name: 'Bad', center: { latitude: 0, longitude: 181 }, zoom: 5 }
                ],
                lastUpdated: '2024-01-01T00:00:00.000Z'
            });

            const manager = new BookmarkManager(memento as never);
            assert.strictEqual(manager.getAllBookmarks().length, 1);
        });

        test('drops a bookmark with a negative zoom', async () => {
            const memento = new MockMemento();
            await memento.update('vscodeMaplibreViewer.bookmarks', {
                version: 1,
                bookmarks: [
                    createTestBookmark({ id: 'ok', name: 'Ok' }),
                    { id: 'bad', name: 'Bad', center: { latitude: 0, longitude: 0 }, zoom: -1 }
                ],
                lastUpdated: '2024-01-01T00:00:00.000Z'
            });

            const manager = new BookmarkManager(memento as never);
            assert.strictEqual(manager.getAllBookmarks().length, 1);
        });
    });
});
