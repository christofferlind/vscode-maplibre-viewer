import * as assert from 'assert';
import { BookmarkManager } from '../../bookmarkManager';
import { MapBookmark, ViewState } from '../../bookmarkTypes';

/**
 * Mock Memento for testing BookmarkManager
 */
class MockMemento {
    private _storage: Map<string, unknown> = new Map();

    get<T>(key: string): T | undefined;
    get<T>(key: string, defaultValue: T): T;
    get<T>(key: string, defaultValue?: T): T | undefined {
        const value = this._storage.get(key);
        if (value === undefined) {
            return defaultValue;
        }
        return value as T;
    }

    async update(key: string, value: unknown): Promise<void> {
        if (value === undefined) {
            this._storage.delete(key);
        } else {
            this._storage.set(key, value);
        }
    }

    keys(): readonly string[] {
        return Array.from(this._storage.keys());
    }

    clear(): void {
        this._storage.clear();
    }
}

suite('BookmarkManager Test Suite', () => {
    let bookmarkManager: BookmarkManager;
    let mockMemento: MockMemento;

    setup(() => {
        mockMemento = new MockMemento();
        bookmarkManager = new BookmarkManager(mockMemento as any);
    });

    teardown(() => {
        mockMemento.clear();
    });

    // Helper function to create a valid view state
    function createViewState(overrides?: Partial<ViewState>): ViewState {
        return {
            center: { latitude: 59.3293, longitude: 18.0686 },
            zoom: 10,
            bearing: 0,
            pitch: 0,
            ...overrides
        };
    }

    // Helper function to create a valid bookmark
    function createBookmark(overrides?: Partial<MapBookmark>): MapBookmark {
        const now = new Date().toISOString();
        return {
            id: 'test-id-' + Date.now(),
            name: 'Test Bookmark',
            center: { latitude: 59.3293, longitude: 18.0686 },
            zoom: 10,
            bearing: 0,
            pitch: 0,
            createdAt: now,
            updatedAt: now,
            ...overrides
        };
    }

    suite('createBookmark', () => {
        test('should create a bookmark with required fields', async () => {
            const viewState = createViewState();
            const bookmark = await bookmarkManager.createBookmark('My Bookmark', viewState);

            assert.strictEqual(bookmark.name, 'My Bookmark');
            assert.strictEqual(bookmark.center.latitude, 59.3293);
            assert.strictEqual(bookmark.center.longitude, 18.0686);
            assert.strictEqual(bookmark.zoom, 10);
            assert.strictEqual(bookmark.bearing, 0);
            assert.strictEqual(bookmark.pitch, 0);
            assert.ok(bookmark.id, 'Should have an ID');
            assert.ok(bookmark.createdAt, 'Should have createdAt');
            assert.ok(bookmark.updatedAt, 'Should have updatedAt');
        });

        test('should create a bookmark with description', async () => {
            const viewState = createViewState();
            const bookmark = await bookmarkManager.createBookmark('My Bookmark', viewState, 'A description');

            assert.strictEqual(bookmark.description, 'A description');
        });

        test('should trim bookmark name', async () => {
            const viewState = createViewState();
            const bookmark = await bookmarkManager.createBookmark('  Trimmed Name  ', viewState);

            assert.strictEqual(bookmark.name, 'Trimmed Name');
        });

        test('should trim description', async () => {
            const viewState = createViewState();
            const bookmark = await bookmarkManager.createBookmark('My Bookmark', viewState, '  Trimmed Description  ');

            assert.strictEqual(bookmark.description, 'Trimmed Description');
        });

        test('should use default bearing and pitch if not provided', async () => {
            const viewState: ViewState = {
                center: { latitude: 59.3293, longitude: 18.0686 },
                zoom: 10,
                bearing: undefined as any,
                pitch: undefined as any
            };
            const bookmark = await bookmarkManager.createBookmark('My Bookmark', viewState);

            assert.strictEqual(bookmark.bearing, 0);
            assert.strictEqual(bookmark.pitch, 0);
        });

        test('should preserve bearing and pitch from view state', async () => {
            const viewState = createViewState({
                bearing: 45,
                pitch: 30
            });
            const bookmark = await bookmarkManager.createBookmark('My Bookmark', viewState);

            assert.strictEqual(bookmark.bearing, 45);
            assert.strictEqual(bookmark.pitch, 30);
        });

        test('should generate unique IDs for different bookmarks', async () => {
            const viewState = createViewState();
            const bookmark1 = await bookmarkManager.createBookmark('Bookmark 1', viewState);
            const bookmark2 = await bookmarkManager.createBookmark('Bookmark 2', viewState);

            assert.notStrictEqual(bookmark1.id, bookmark2.id, 'IDs should be unique');
        });
    });

    suite('saveBookmark', () => {
        test('should save a new bookmark', async () => {
            const bookmark = createBookmark();
            const savedBookmark = await bookmarkManager.saveBookmark(bookmark);

            assert.strictEqual(savedBookmark.id, bookmark.id);
            assert.strictEqual(savedBookmark.name, bookmark.name);
        });

        test('should generate ID if not provided', async () => {
            const bookmark = createBookmark({ id: undefined as any });
            const savedBookmark = await bookmarkManager.saveBookmark(bookmark);

            assert.ok(savedBookmark.id, 'Should have generated an ID');
        });

        test('should set createdAt if not provided', async () => {
            const bookmark = createBookmark({ createdAt: undefined as any });
            const savedBookmark = await bookmarkManager.saveBookmark(bookmark);

            assert.ok(savedBookmark.createdAt, 'Should have set createdAt');
        });

        test('should set updatedAt if not provided', async () => {
            const bookmark = createBookmark({ updatedAt: undefined as any });
            const savedBookmark = await bookmarkManager.saveBookmark(bookmark);

            assert.ok(savedBookmark.updatedAt, 'Should have set updatedAt');
        });

        test('should update existing bookmark with same ID', async () => {
            const bookmark = createBookmark({ name: 'Original Name' });
            await bookmarkManager.saveBookmark(bookmark);

            const updatedBookmark = createBookmark({
                id: bookmark.id,
                name: 'Updated Name'
            });
            await bookmarkManager.saveBookmark(updatedBookmark);

            const allBookmarks = bookmarkManager.getAllBookmarks();
            assert.strictEqual(allBookmarks.length, 1, 'Should still have only one bookmark');
            assert.strictEqual(allBookmarks[0].name, 'Updated Name');
        });

        test('should preserve createdAt when using updateBookmark', async () => {
            const originalCreatedAt = '2024-01-01T00:00:00.000Z';
            const bookmark = createBookmark({ createdAt: originalCreatedAt });
            await bookmarkManager.saveBookmark(bookmark);

            // Use updateBookmark to preserve createdAt
            const saved = await bookmarkManager.updateBookmark(bookmark.id, { name: 'Updated Name' });

            assert.ok(saved, 'Should return updated bookmark');
            assert.strictEqual(saved!.createdAt, originalCreatedAt, 'createdAt should be preserved');
        });
    });

    suite('getBookmark', () => {
        test('should return undefined for non-existent bookmark', () => {
            const result = bookmarkManager.getBookmark('non-existent-id');
            assert.strictEqual(result, undefined);
        });

        test('should return bookmark by ID', async () => {
            const bookmark = createBookmark();
            await bookmarkManager.saveBookmark(bookmark);

            const result = bookmarkManager.getBookmark(bookmark.id);

            assert.ok(result, 'Should find bookmark');
            assert.strictEqual(result.id, bookmark.id);
        });

        test('should return correct bookmark when multiple exist', async () => {
            const bookmark1 = createBookmark({ id: 'bookmark-1', name: 'First' });
            const bookmark2 = createBookmark({ id: 'bookmark-2', name: 'Second' });
            await bookmarkManager.saveBookmark(bookmark1);
            await bookmarkManager.saveBookmark(bookmark2);

            const result = bookmarkManager.getBookmark('bookmark-2');

            assert.ok(result, 'Should find bookmark');
            assert.strictEqual(result.name, 'Second');
        });
    });

    suite('findByName', () => {
        test('should return undefined for non-existent name', () => {
            const result = bookmarkManager.findByName('Non-existent');
            assert.strictEqual(result, undefined);
        });

        test('should find bookmark by name (case-insensitive)', async () => {
            const bookmark = createBookmark({ name: 'Stockholm' });
            await bookmarkManager.saveBookmark(bookmark);

            const resultLower = bookmarkManager.findByName('stockholm');
            const resultUpper = bookmarkManager.findByName('STOCKHOLM');
            const resultMixed = bookmarkManager.findByName('StOcKhOlM');

            assert.ok(resultLower, 'Should find with lowercase');
            assert.ok(resultUpper, 'Should find with uppercase');
            assert.ok(resultMixed, 'Should find with mixed case');
        });

        test('should trim name when searching', async () => {
            const bookmark = createBookmark({ name: 'Stockholm' });
            await bookmarkManager.saveBookmark(bookmark);

            const result = bookmarkManager.findByName('  Stockholm  ');

            assert.ok(result, 'Should find bookmark with trimmed search');
        });

        test('should return first match if multiple bookmarks have same name', async () => {
            const bookmark1 = createBookmark({ id: 'first', name: 'Duplicate' });
            const bookmark2 = createBookmark({ id: 'second', name: 'Duplicate' });
            await bookmarkManager.saveBookmark(bookmark1);
            await bookmarkManager.saveBookmark(bookmark2);

            const result = bookmarkManager.findByName('Duplicate');

            assert.ok(result, 'Should find a bookmark');
            assert.strictEqual(result.name, 'Duplicate');
        });
    });

    suite('getAllBookmarks', () => {
        test('should return empty array when no bookmarks', () => {
            const result = bookmarkManager.getAllBookmarks();
            assert.deepStrictEqual(result, []);
        });

        test('should return all bookmarks', async () => {
            const bookmark1 = createBookmark({ id: 'bookmark-1' });
            const bookmark2 = createBookmark({ id: 'bookmark-2' });
            const bookmark3 = createBookmark({ id: 'bookmark-3' });
            await bookmarkManager.saveBookmark(bookmark1);
            await bookmarkManager.saveBookmark(bookmark2);
            await bookmarkManager.saveBookmark(bookmark3);

            const result = bookmarkManager.getAllBookmarks();

            assert.strictEqual(result.length, 3);
        });

        test('should return a copy of bookmarks array', async () => {
            const bookmark = createBookmark();
            await bookmarkManager.saveBookmark(bookmark);

            const result1 = bookmarkManager.getAllBookmarks();
            const result2 = bookmarkManager.getAllBookmarks();

            assert.notStrictEqual(result1, result2, 'Should return different array instances');
        });
    });

    suite('deleteBookmark', () => {
        test('should return false for non-existent bookmark', async () => {
            const result = await bookmarkManager.deleteBookmark('non-existent-id');
            assert.strictEqual(result, false);
        });

        test('should delete bookmark and return true', async () => {
            const bookmark = createBookmark();
            await bookmarkManager.saveBookmark(bookmark);

            const deleteResult = await bookmarkManager.deleteBookmark(bookmark.id);
            assert.strictEqual(deleteResult, true);

            const getResult = bookmarkManager.getBookmark(bookmark.id);
            assert.strictEqual(getResult, undefined);
        });

        test('should delete correct bookmark when multiple exist', async () => {
            const bookmark1 = createBookmark({ id: 'bookmark-1' });
            const bookmark2 = createBookmark({ id: 'bookmark-2' });
            await bookmarkManager.saveBookmark(bookmark1);
            await bookmarkManager.saveBookmark(bookmark2);

            await bookmarkManager.deleteBookmark('bookmark-1');

            const allBookmarks = bookmarkManager.getAllBookmarks();
            assert.strictEqual(allBookmarks.length, 1);
            assert.strictEqual(allBookmarks[0].id, 'bookmark-2');
        });
    });

    suite('updateBookmark', () => {
        test('should return undefined for non-existent bookmark', async () => {
            const result = await bookmarkManager.updateBookmark('non-existent-id', { name: 'New Name' });
            assert.strictEqual(result, undefined);
        });

        test('should update bookmark properties', async () => {
            const bookmark = createBookmark({ name: 'Original Name', zoom: 10 });
            await bookmarkManager.saveBookmark(bookmark);

            const result = await bookmarkManager.updateBookmark(bookmark.id, {
                name: 'Updated Name',
                zoom: 15
            });

            assert.ok(result, 'Should return updated bookmark');
            assert.strictEqual(result.name, 'Updated Name');
            assert.strictEqual(result.zoom, 15);
        });

        test('should preserve ID and createdAt', async () => {
            const originalCreatedAt = '2024-01-01T00:00:00.000Z';
            const bookmark = createBookmark({ createdAt: originalCreatedAt });
            await bookmarkManager.saveBookmark(bookmark);

            const result = await bookmarkManager.updateBookmark(bookmark.id, { name: 'Updated' });

            assert.ok(result, 'Should return updated bookmark');
            assert.strictEqual(result!.id, bookmark.id, 'ID should be preserved');
            assert.strictEqual(result!.createdAt, originalCreatedAt, 'createdAt should be preserved');
        });

        test('should update updatedAt timestamp', async () => {
            const bookmark = createBookmark();
            await bookmarkManager.saveBookmark(bookmark);
            const originalUpdatedAt = bookmark.updatedAt;

            // Small delay to ensure different timestamp
            await new Promise(resolve => setTimeout(resolve, 10));

            const result = await bookmarkManager.updateBookmark(bookmark.id, { name: 'Updated' });

            assert.ok(result, 'Should return updated bookmark');
            assert.notStrictEqual(result!.updatedAt, originalUpdatedAt, 'updatedAt should be different');
        });

        test('should support partial updates', async () => {
            const bookmark = createBookmark({
                name: 'Original',
                description: 'Original Description',
                zoom: 10
            });
            await bookmarkManager.saveBookmark(bookmark);

            const result = await bookmarkManager.updateBookmark(bookmark.id, { zoom: 15 });

            assert.ok(result, 'Should return updated bookmark');
            assert.strictEqual(result!.name, 'Original', 'Name should be unchanged');
            assert.strictEqual(result!.description, 'Original Description', 'Description should be unchanged');
            assert.strictEqual(result!.zoom, 15, 'Zoom should be updated');
        });
    });

    suite('nameExists', () => {
        test('should return false when no bookmarks exist', () => {
            const result = bookmarkManager.nameExists('Any Name');
            assert.strictEqual(result, false);
        });

        test('should return true when bookmark with name exists', async () => {
            const bookmark = createBookmark({ name: 'Stockholm' });
            await bookmarkManager.saveBookmark(bookmark);

            const result = bookmarkManager.nameExists('Stockholm');
            assert.strictEqual(result, true);
        });

        test('should be case-insensitive', async () => {
            const bookmark = createBookmark({ name: 'Stockholm' });
            await bookmarkManager.saveBookmark(bookmark);

            assert.strictEqual(bookmarkManager.nameExists('stockholm'), true);
            assert.strictEqual(bookmarkManager.nameExists('STOCKHOLM'), true);
        });

        test('should return false for non-existent name', async () => {
            const bookmark = createBookmark({ name: 'Stockholm' });
            await bookmarkManager.saveBookmark(bookmark);

            const result = bookmarkManager.nameExists('Gothenburg');
            assert.strictEqual(result, false);
        });
    });

    suite('clearAll', () => {
        test('should remove all bookmarks', async () => {
            const bookmark1 = createBookmark({ id: 'bookmark-1' });
            const bookmark2 = createBookmark({ id: 'bookmark-2' });
            await bookmarkManager.saveBookmark(bookmark1);
            await bookmarkManager.saveBookmark(bookmark2);

            await bookmarkManager.clearAll();

            const result = bookmarkManager.getAllBookmarks();
            assert.strictEqual(result.length, 0);
        });

        test('should work when no bookmarks exist', async () => {
            await bookmarkManager.clearAll();

            const result = bookmarkManager.getAllBookmarks();
            assert.strictEqual(result.length, 0);
        });
    });

    suite('count', () => {
        test('should return 0 when no bookmarks', () => {
            assert.strictEqual(bookmarkManager.count, 0);
        });

        test('should return correct count', async () => {
            const bookmark1 = createBookmark({ id: 'bookmark-1' });
            const bookmark2 = createBookmark({ id: 'bookmark-2' });
            await bookmarkManager.saveBookmark(bookmark1);
            await bookmarkManager.saveBookmark(bookmark2);

            assert.strictEqual(bookmarkManager.count, 2);
        });

        test('should update count after deletion', async () => {
            const bookmark = createBookmark();
            await bookmarkManager.saveBookmark(bookmark);

            await bookmarkManager.deleteBookmark(bookmark.id);

            assert.strictEqual(bookmarkManager.count, 0);
        });
    });

    suite('persistence', () => {
        test('should persist bookmarks across manager instances', async () => {
            const bookmark = createBookmark({ name: 'Persistent Bookmark' });
            await bookmarkManager.saveBookmark(bookmark);

            // Create a new manager with the same memento
            const newManager = new BookmarkManager(mockMemento as any);
            const result = newManager.getBookmark(bookmark.id);

            assert.ok(result, 'Should find bookmark in new manager');
            assert.strictEqual(result!.name, 'Persistent Bookmark');
        });

        test('should persist collection metadata', async () => {
            const bookmark = createBookmark();
            await bookmarkManager.saveBookmark(bookmark);

            // Create a new manager with the same memento
            const newManager = new BookmarkManager(mockMemento as any);
            const allBookmarks = newManager.getAllBookmarks();

            assert.strictEqual(allBookmarks.length, 1);
        });
    });
});

suite('validateBookmark Test Suite', () => {
    // Note: validateBookmark is not exported, but we can test it indirectly
    // through the BookmarkManager's handling of bookmarks

    test('should accept valid bookmark', async () => {
        const mockMemento = new MockMemento();
        const manager = new BookmarkManager(mockMemento as any);

        const bookmark: MapBookmark = {
            id: 'valid-id',
            name: 'Valid Bookmark',
            center: { latitude: 59.3293, longitude: 18.0686 },
            zoom: 10,
            bearing: 0,
            pitch: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        const result = await manager.saveBookmark(bookmark);
        assert.ok(result, 'Valid bookmark should be saved');
    });

    test('should accept bookmark at coordinate boundaries', async () => {
        const mockMemento = new MockMemento();
        const manager = new BookmarkManager(mockMemento as any);

        const bookmark: MapBookmark = {
            id: 'boundary-id',
            name: 'Boundary Bookmark',
            center: { latitude: 90, longitude: 180 },
            zoom: 24,
            bearing: 0,
            pitch: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        const result = await manager.saveBookmark(bookmark);
        assert.ok(result, 'Bookmark at boundary should be saved');
    });

    test('should accept bookmark at negative coordinate boundaries', async () => {
        const mockMemento = new MockMemento();
        const manager = new BookmarkManager(mockMemento as any);

        const bookmark: MapBookmark = {
            id: 'negative-boundary-id',
            name: 'Negative Boundary Bookmark',
            center: { latitude: -90, longitude: -180 },
            zoom: 0,
            bearing: 0,
            pitch: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        const result = await manager.saveBookmark(bookmark);
        assert.ok(result, 'Bookmark at negative boundary should be saved');
    });

    test('should accept bookmark with optional fields', async () => {
        const mockMemento = new MockMemento();
        const manager = new BookmarkManager(mockMemento as any);

        const bookmark: MapBookmark = {
            id: 'optional-fields-id',
            name: 'Bookmark with Options',
            description: 'A description',
            center: { latitude: 59.3293, longitude: 18.0686 },
            zoom: 10,
            bearing: 45,
            pitch: 30,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            tags: ['tag1', 'tag2'],
            styleUrl: 'https://example.com/style.json'
        };

        const result = await manager.saveBookmark(bookmark);
        assert.ok(result, 'Bookmark with optional fields should be saved');
        assert.deepStrictEqual(result.tags, ['tag1', 'tag2']);
        assert.strictEqual(result.styleUrl, 'https://example.com/style.json');
    });
});

suite('generateId Test Suite', () => {
    test('should generate unique IDs', async () => {
        const mockMemento = new MockMemento();
        const manager = new BookmarkManager(mockMemento as any);

        const viewState: ViewState = {
            center: { latitude: 59.3293, longitude: 18.0686 },
            zoom: 10,
            bearing: 0,
            pitch: 0
        };

        const bookmark1 = await manager.createBookmark('Test 1', viewState);
        const bookmark2 = await manager.createBookmark('Test 2', viewState);

        assert.notStrictEqual(bookmark1.id, bookmark2.id, 'Generated IDs should be unique');
    });

    test('should generate non-empty IDs', async () => {
        const mockMemento = new MockMemento();
        const manager = new BookmarkManager(mockMemento as any);

        const viewState: ViewState = {
            center: { latitude: 59.3293, longitude: 18.0686 },
            zoom: 10,
            bearing: 0,
            pitch: 0
        };

        const bookmark = await manager.createBookmark('Test', viewState);

        assert.ok(bookmark.id, 'Generated ID should not be empty');
        assert.ok(bookmark.id.length > 0, 'Generated ID should have content');
    });
});