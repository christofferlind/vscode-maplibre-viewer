import * as assert from 'assert';
import { createRequire } from 'module';

// The vscode module only resolves inside the extension host; stub it so the
// bookmark modules can be imported in plain node unit tests.
const nodeRequire = createRequire(__filename);
const ModuleCtor = nodeRequire('module') as typeof import('module');
const vscodeStub = {
    window: {},
    commands: {},
    MarkdownString: class MarkdownString {
        value = '';
        appendMarkdown(text: string): void {
            this.value += text;
        }
    }
};
const originalPrototypeRequire = ModuleCtor.prototype.require;
ModuleCtor.prototype.require = function (id: string): unknown {
    if (id === 'vscode') {
        return vscodeStub;
    }
    return originalPrototypeRequire.call(this, id);
};

const formatter = nodeRequire('../../services/bookmarkFormatter') as typeof import('../../services/bookmarkFormatter');
const { BookmarkManager } = nodeRequire('../../bookmarks/bookmarkManager') as {
    BookmarkManager: typeof import('../../bookmarks/bookmarkManager')['BookmarkManager'];
};
const { createTestBookmark } = nodeRequire('../testUtils') as typeof import('../testUtils');
ModuleCtor.prototype.require = originalPrototypeRequire;

class MockMemento {
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

suite('Bookmark corruption tests', () => {

    suite('Bookmark formatter corrupted-data tests', () => {
        test('formatBookmarkLabel should fall back to coordinates when center is missing', () => {
            const bookmark = createTestBookmark({ name: '' }) as unknown as { center?: unknown; name: string };
            delete bookmark.center;

            const label = formatter.formatBookmarkLabel(bookmark as never);

            assert.ok(label.includes('0'), 'label should use fallback coordinate 0');
        });

        test('formatBookmarkLabel should not throw when center is missing', () => {
            const bookmark = createTestBookmark({ name: '' }) as unknown as { center?: unknown };
            delete bookmark.center;

            assert.doesNotThrow(() => formatter.formatBookmarkLabel(bookmark as never));
        });

        test('formatBookmarkLabel should prefer name when present', () => {
            const bookmark = createTestBookmark({ name: 'Named Place' });

            assert.strictEqual(formatter.formatBookmarkLabel(bookmark), 'Named Place');
        });

        test('formatBookmarkForCopy should fall back to 0 coordinates when center is missing', () => {
            const bookmark = createTestBookmark() as unknown as { center?: unknown };
            delete bookmark.center;

            const json = formatter.formatBookmarkForCopy(bookmark as never);
            const parsed = JSON.parse(json) as { latitude: number; longitude: number };

            assert.strictEqual(parsed.latitude, 0);
            assert.strictEqual(parsed.longitude, 0);
        });

        test('formatBookmarkDescriptionFromBookmark should not throw when center is missing', () => {
            const bookmark = createTestBookmark() as unknown as { center?: unknown };
            delete bookmark.center;

            assert.doesNotThrow(() => formatter.formatBookmarkDescriptionFromBookmark(bookmark as never));
        });
    });

    suite('BookmarkManager persisted-corruption tests', () => {
        test('should drop invalid persisted bookmarks and return valid ones', async () => {
            const memento = new MockMemento();
            const valid = createTestBookmark({ id: 'valid-id', name: 'Valid' });
            const collection = {
                version: 1,
                bookmarks: [
                    valid,
                    { id: 'no-center', name: 'No Center', zoom: 5 },
                    'not-an-object',
                    { id: '', name: 'Empty Id', center: { latitude: 1, longitude: 2 }, zoom: 5 }
                ],
                lastUpdated: '2024-01-01T00:00:00.000Z'
            };
            await memento.update('vscodeMaplibreViewer.bookmarks', collection);

            const manager = new BookmarkManager(memento as never);
            const bookmarks = manager.getAllBookmarks();

            assert.strictEqual(bookmarks.length, 1);
            assert.strictEqual(bookmarks[0].id, 'valid-id');
        });

        test('should persist the cleaned collection back to globalState', async () => {
            const memento = new MockMemento();
            const valid = createTestBookmark({ id: 'valid-id', name: 'Valid' });
            await memento.update('vscodeMaplibreViewer.bookmarks', {
                version: 1,
                bookmarks: [valid, { id: 'bad', name: '' }],
                lastUpdated: '2024-01-01T00:00:00.000Z'
            });

            const manager = new BookmarkManager(memento as never);
            manager.getAllBookmarks();

            const stored = memento.get('vscodeMaplibreViewer.bookmarks') as { bookmarks: unknown[] };
            assert.strictEqual(stored.bookmarks.length, 1);
            assert.strictEqual((stored.bookmarks[0] as { id: string }).id, 'valid-id');
        });

        test('should not rewrite globalState when all bookmarks are valid', async () => {
            const memento = new MockMemento();
            const valid = createTestBookmark();
            await memento.update('vscodeMaplibreViewer.bookmarks', {
                version: 1,
                bookmarks: [valid],
                lastUpdated: '2024-01-01T00:00:00.000Z'
            });

            const manager = new BookmarkManager(memento as never);
            manager.getAllBookmarks();

            const writes = memento.getUpdateCalls().filter((c) => c.key === 'vscodeMaplibreViewer.bookmarks');
            assert.strictEqual(writes.length, 1, 'only the initial seed write should have occurred');
        });

        test('should return empty collection when globalState holds a non-object value', () => {
            const memento = new MockMemento();
            memento.setRaw('vscodeMaplibreViewer.bookmarks', 'corrupted-string');

            const manager = new BookmarkManager(memento as never);

            assert.deepStrictEqual(manager.getAllBookmarks(), []);
        });

        test('should return empty collection when bookmarks array is missing', () => {
            const memento = new MockMemento();
            memento.setRaw('vscodeMaplibreViewer.bookmarks', { version: 1 });

            const manager = new BookmarkManager(memento as never);

            assert.deepStrictEqual(manager.getAllBookmarks(), []);
        });

        test('should drop out-of-range persisted bookmarks', async () => {
            const memento = new MockMemento();
            const inRange = createTestBookmark({ id: 'ok', name: 'Ok' });
            await memento.update('vscodeMaplibreViewer.bookmarks', {
                version: 1,
                bookmarks: [
                    inRange,
                    { id: 'bad-lat', name: 'Bad Lat', center: { latitude: 120, longitude: 0 }, zoom: 5 },
                    { id: 'bad-zoom', name: 'Bad Zoom', center: { latitude: 0, longitude: 0 }, zoom: 99 }
                ],
                lastUpdated: '2024-01-01T00:00:00.000Z'
            });

            const manager = new BookmarkManager(memento as never);

            const bookmarks = manager.getAllBookmarks();
            assert.strictEqual(bookmarks.length, 1);
            assert.strictEqual(bookmarks[0].id, 'ok');
        });
    });
});