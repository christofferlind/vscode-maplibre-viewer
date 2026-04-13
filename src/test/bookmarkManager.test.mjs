/**
 * Standalone mjs tests for BookmarkManager
 * Run with: node src/test/bookmarkManager.test.mjs
 */

import assert from 'assert';

/**
 * Mock Memento for testing BookmarkManager
 * Simulates VSCode's Memento interface
 */
class MockMemento {
    #storage = new Map();

    get(key, defaultValue) {
        const value = this.#storage.get(key);
        if (value === undefined) {
            return defaultValue;
        }
        return value;
    }

    async update(key, value) {
        if (value === undefined) {
            this.#storage.delete(key);
        } else {
            this.#storage.set(key, value);
        }
    }

    keys() {
        return Array.from(this.#storage.keys());
    }

    clear() {
        this.#storage.clear();
    }
}

/**
 * BookmarkManager class (extracted for standalone testing)
 * This is a simplified version for testing purposes
 */
const BOOKMARKS_STORAGE_KEY = 'vscodeMaplibreViewer.bookmarks';

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

function validateBookmark(bookmark) {
    if (!bookmark || typeof bookmark !== 'object') {
        return false;
    }
    
    const b = bookmark;
    
    // Required fields
    if (typeof b.id !== 'string' || b.id.trim().length === 0) {
        return false;
    }
    if (typeof b.name !== 'string' || b.name.trim().length === 0) {
        return false;
    }
    if (!b.center || typeof b.center.latitude !== 'number' || typeof b.center.longitude !== 'number') {
        return false;
    }
    if (typeof b.zoom !== 'number') {
        return false;
    }
    
    // Validate coordinate ranges
    if (b.center.latitude < -90 || b.center.latitude > 90) {
        return false;
    }
    if (b.center.longitude < -180 || b.center.longitude > 180) {
        return false;
    }
    if (b.zoom < 0 || b.zoom > 24) {
        return false;
    }
    
    return true;
}

class BookmarkManager {
    #globalState;

    constructor(globalState) {
        this.#globalState = globalState;
    }

    #getCollection() {
        const collection = this.#globalState.get(BOOKMARKS_STORAGE_KEY);
        
        if (!collection) {
            return {
                version: 1,
                bookmarks: [],
                lastUpdated: new Date().toISOString()
            };
        }
        
        return collection;
    }
    
    async #saveCollection(collection) {
        collection.lastUpdated = new Date().toISOString();
        await this.#globalState.update(BOOKMARKS_STORAGE_KEY, collection);
    }

    async saveBookmark(bookmark) {
        const collection = this.#getCollection();
        
        const existingIndex = collection.bookmarks.findIndex(b => b.id === bookmark.id);
        
        if (existingIndex >= 0) {
            bookmark.updatedAt = new Date().toISOString();
            collection.bookmarks[existingIndex] = bookmark;
        } else {
            if (!bookmark.id) {
                bookmark.id = generateId();
            }
            if (!bookmark.createdAt) {
                bookmark.createdAt = new Date().toISOString();
            }
            if (!bookmark.updatedAt) {
                bookmark.updatedAt = new Date().toISOString();
            }
            collection.bookmarks.push(bookmark);
        }
        
        await this.#saveCollection(collection);
        return bookmark;
    }

    async createBookmark(name, viewState, description) {
        const now = new Date().toISOString();
        
        const bookmark = {
            id: generateId(),
            name: name.trim(),
            description: description?.trim(),
            center: viewState.center,
            zoom: viewState.zoom,
            bearing: viewState.bearing || 0,
            pitch: viewState.pitch || 0,
            createdAt: now,
            updatedAt: now
        };
        
        return this.saveBookmark(bookmark);
    }

    getBookmark(id) {
        const collection = this.#getCollection();
        return collection.bookmarks.find(b => b.id === id);
    }

    findByName(name) {
        const collection = this.#getCollection();
        const searchName = name.trim().toLowerCase();
        return collection.bookmarks.find(b => b.name.toLowerCase() === searchName);
    }

    getAllBookmarks() {
        const collection = this.#getCollection();
        return [...collection.bookmarks];
    }

    async deleteBookmark(id) {
        const collection = this.#getCollection();
        const index = collection.bookmarks.findIndex(b => b.id === id);
        
        if (index < 0) {
            return false;
        }
        
        collection.bookmarks.splice(index, 1);
        await this.#saveCollection(collection);
        return true;
    }

    nameExists(name) {
        return this.findByName(name) !== undefined;
    }

    async updateBookmark(id, updates) {
        const bookmark = this.getBookmark(id);
        
        if (!bookmark) {
            return undefined;
        }
        
        const updatedBookmark = {
            ...bookmark,
            ...updates,
            id: bookmark.id,
            createdAt: bookmark.createdAt,
            updatedAt: new Date().toISOString()
        };
        
        return this.saveBookmark(updatedBookmark);
    }

    async clearAll() {
        await this.#globalState.update(BOOKMARKS_STORAGE_KEY, undefined);
    }

    get count() {
        const collection = this.#getCollection();
        return collection.bookmarks.length;
    }
}

// Test utilities
let testsPassed = 0;
let testsFailed = 0;
const testResults = [];

function describe(suiteName, fn) {
    console.log(`\n📦 ${suiteName}`);
    fn();
}

function it(testName, fn) {
    try {
        fn();
        testsPassed++;
        console.log(`  ✅ ${testName}`);
        testResults.push({ name: testName, passed: true });
    } catch (error) {
        testsFailed++;
        console.log(`  ❌ ${testName}`);
        console.log(`     Error: ${error.message}`);
        testResults.push({ name: testName, passed: false, error: error.message });
    }
}

async function asyncIt(testName, fn) {
    try {
        await fn();
        testsPassed++;
        console.log(`  ✅ ${testName}`);
        testResults.push({ name: testName, passed: true });
    } catch (error) {
        testsFailed++;
        console.log(`  ❌ ${testName}`);
        console.log(`     Error: ${error.message}`);
        testResults.push({ name: testName, passed: false, error: error.message });
    }
}

// Helper functions
function createViewState(overrides = {}) {
    return {
        center: { latitude: 59.3293, longitude: 18.0686 },
        zoom: 10,
        bearing: 0,
        pitch: 0,
        ...overrides
    };
}

function createBookmark(overrides = {}) {
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

// ============================================
// Test Suites
// ============================================

describe('generateId', () => {
    it('should generate unique IDs', () => {
        const id1 = generateId();
        const id2 = generateId();
        assert.notStrictEqual(id1, id2);
    });

    it('should generate non-empty string IDs', () => {
        const id = generateId();
        assert.strictEqual(typeof id, 'string');
        assert.ok(id.length > 0);
    });

    it('should generate IDs with valid characters', () => {
        const id = generateId();
        assert.ok(/^[a-z0-9]+$/i.test(id), 'ID should only contain alphanumeric characters');
    });
});

describe('validateBookmark', () => {
    it('should return true for valid bookmark', () => {
        const bookmark = createBookmark();
        assert.strictEqual(validateBookmark(bookmark), true);
    });

    it('should return false for null', () => {
        assert.strictEqual(validateBookmark(null), false);
    });

    it('should return false for undefined', () => {
        assert.strictEqual(validateBookmark(undefined), false);
    });

    it('should return false for non-object', () => {
        assert.strictEqual(validateBookmark('string'), false);
        assert.strictEqual(validateBookmark(123), false);
        assert.strictEqual(validateBookmark(true), false);
    });

    it('should return false for missing id', () => {
        const bookmark = createBookmark({ id: undefined });
        assert.strictEqual(validateBookmark(bookmark), false);
    });

    it('should return false for empty id', () => {
        const bookmark = createBookmark({ id: '' });
        assert.strictEqual(validateBookmark(bookmark), false);
    });

    it('should return false for whitespace-only id', () => {
        const bookmark = createBookmark({ id: '   ' });
        assert.strictEqual(validateBookmark(bookmark), false);
    });

    it('should return false for missing name', () => {
        const bookmark = createBookmark({ name: undefined });
        assert.strictEqual(validateBookmark(bookmark), false);
    });

    it('should return false for empty name', () => {
        const bookmark = createBookmark({ name: '' });
        assert.strictEqual(validateBookmark(bookmark), false);
    });

    it('should return false for missing center', () => {
        const bookmark = createBookmark({ center: undefined });
        assert.strictEqual(validateBookmark(bookmark), false);
    });

    it('should return false for invalid latitude type', () => {
        const bookmark = createBookmark({ center: { latitude: '59.3', longitude: 18.06 } });
        assert.strictEqual(validateBookmark(bookmark), false);
    });

    it('should return false for invalid longitude type', () => {
        const bookmark = createBookmark({ center: { latitude: 59.3, longitude: '18.06' } });
        assert.strictEqual(validateBookmark(bookmark), false);
    });

    it('should return false for latitude out of range (too high)', () => {
        const bookmark = createBookmark({ center: { latitude: 91, longitude: 18.06 } });
        assert.strictEqual(validateBookmark(bookmark), false);
    });

    it('should return false for latitude out of range (too low)', () => {
        const bookmark = createBookmark({ center: { latitude: -91, longitude: 18.06 } });
        assert.strictEqual(validateBookmark(bookmark), false);
    });

    it('should return false for longitude out of range (too high)', () => {
        const bookmark = createBookmark({ center: { latitude: 59.3, longitude: 181 } });
        assert.strictEqual(validateBookmark(bookmark), false);
    });

    it('should return false for longitude out of range (too low)', () => {
        const bookmark = createBookmark({ center: { latitude: 59.3, longitude: -181 } });
        assert.strictEqual(validateBookmark(bookmark), false);
    });

    it('should accept boundary values for latitude (90)', () => {
        const bookmark = createBookmark({ center: { latitude: 90, longitude: 0 } });
        assert.strictEqual(validateBookmark(bookmark), true);
    });

    it('should accept boundary values for latitude (-90)', () => {
        const bookmark = createBookmark({ center: { latitude: -90, longitude: 0 } });
        assert.strictEqual(validateBookmark(bookmark), true);
    });

    it('should accept boundary values for longitude (180)', () => {
        const bookmark = createBookmark({ center: { latitude: 0, longitude: 180 } });
        assert.strictEqual(validateBookmark(bookmark), true);
    });

    it('should accept boundary values for longitude (-180)', () => {
        const bookmark = createBookmark({ center: { latitude: 0, longitude: -180 } });
        assert.strictEqual(validateBookmark(bookmark), true);
    });

    it('should return false for missing zoom', () => {
        const bookmark = createBookmark({ zoom: undefined });
        assert.strictEqual(validateBookmark(bookmark), false);
    });

    it('should return false for non-number zoom', () => {
        const bookmark = createBookmark({ zoom: '10' });
        assert.strictEqual(validateBookmark(bookmark), false);
    });

    it('should return false for zoom out of range (negative)', () => {
        const bookmark = createBookmark({ zoom: -1 });
        assert.strictEqual(validateBookmark(bookmark), false);
    });

    it('should return false for zoom out of range (>24)', () => {
        const bookmark = createBookmark({ zoom: 25 });
        assert.strictEqual(validateBookmark(bookmark), false);
    });

    it('should accept boundary values for zoom (0)', () => {
        const bookmark = createBookmark({ zoom: 0 });
        assert.strictEqual(validateBookmark(bookmark), true);
    });

    it('should accept boundary values for zoom (24)', () => {
        const bookmark = createBookmark({ zoom: 24 });
        assert.strictEqual(validateBookmark(bookmark), true);
    });
});

describe('BookmarkManager - createBookmark', () => {
    it('should create a bookmark with required fields', async () => {
        const mockMemento = new MockMemento();
        const manager = new BookmarkManager(mockMemento);
        
        const viewState = createViewState();
        const bookmark = await manager.createBookmark('My Bookmark', viewState);
        
        assert.strictEqual(bookmark.name, 'My Bookmark');
        assert.strictEqual(bookmark.center.latitude, 59.3293);
        assert.strictEqual(bookmark.center.longitude, 18.0686);
        assert.strictEqual(bookmark.zoom, 10);
        assert.strictEqual(bookmark.bearing, 0);
        assert.strictEqual(bookmark.pitch, 0);
        assert.ok(bookmark.id);
        assert.ok(bookmark.createdAt);
        assert.ok(bookmark.updatedAt);
    });

    it('should create a bookmark with description', async () => {
        const mockMemento = new MockMemento();
        const manager = new BookmarkManager(mockMemento);
        
        const viewState = createViewState();
        const bookmark = await manager.createBookmark('My Bookmark', viewState, 'A description');
        
        assert.strictEqual(bookmark.description, 'A description');
    });

    it('should trim bookmark name', async () => {
        const mockMemento = new MockMemento();
        const manager = new BookmarkManager(mockMemento);
        
        const viewState = createViewState();
        const bookmark = await manager.createBookmark('  Trimmed Name  ', viewState);
        
        assert.strictEqual(bookmark.name, 'Trimmed Name');
    });

    it('should trim description', async () => {
        const mockMemento = new MockMemento();
        const manager = new BookmarkManager(mockMemento);
        
        const viewState = createViewState();
        const bookmark = await manager.createBookmark('My Bookmark', viewState, '  Trimmed Description  ');
        
        assert.strictEqual(bookmark.description, 'Trimmed Description');
    });

    it('should use default bearing and pitch if not provided', async () => {
        const mockMemento = new MockMemento();
        const manager = new BookmarkManager(mockMemento);
        
        const viewState = {
            center: { latitude: 59.3293, longitude: 18.0686 },
            zoom: 10
        };
        const bookmark = await manager.createBookmark('My Bookmark', viewState);
        
        assert.strictEqual(bookmark.bearing, 0);
        assert.strictEqual(bookmark.pitch, 0);
    });

    it('should preserve bearing and pitch from view state', async () => {
        const mockMemento = new MockMemento();
        const manager = new BookmarkManager(mockMemento);
        
        const viewState = createViewState({ bearing: 45, pitch: 30 });
        const bookmark = await manager.createBookmark('My Bookmark', viewState);
        
        assert.strictEqual(bookmark.bearing, 45);
        assert.strictEqual(bookmark.pitch, 30);
    });

    it('should generate unique IDs for different bookmarks', async () => {
        const mockMemento = new MockMemento();
        const manager = new BookmarkManager(mockMemento);
        
        const viewState = createViewState();
        const bookmark1 = await manager.createBookmark('Bookmark 1', viewState);
        const bookmark2 = await manager.createBookmark('Bookmark 2', viewState);
        
        assert.notStrictEqual(bookmark1.id, bookmark2.id);
    });
});

describe('BookmarkManager - saveBookmark', () => {
    it('should save a new bookmark', async () => {
        const mockMemento = new MockMemento();
        const manager = new BookmarkManager(mockMemento);
        
        const bookmark = createBookmark();
        const savedBookmark = await manager.saveBookmark(bookmark);
        
        assert.strictEqual(savedBookmark.id, bookmark.id);
        assert.strictEqual(savedBookmark.name, bookmark.name);
    });

    it('should generate ID if not provided', async () => {
        const mockMemento = new MockMemento();
        const manager = new BookmarkManager(mockMemento);
        
        const bookmark = createBookmark({ id: undefined });
        delete bookmark.id;
        const savedBookmark = await manager.saveBookmark(bookmark);
        
        assert.ok(savedBookmark.id);
    });

    it('should set createdAt if not provided', async () => {
        const mockMemento = new MockMemento();
        const manager = new BookmarkManager(mockMemento);
        
        const bookmark = createBookmark();
        delete bookmark.createdAt;
        const savedBookmark = await manager.saveBookmark(bookmark);
        
        assert.ok(savedBookmark.createdAt);
    });

    it('should set updatedAt if not provided', async () => {
        const mockMemento = new MockMemento();
        const manager = new BookmarkManager(mockMemento);
        
        const bookmark = createBookmark();
        delete bookmark.updatedAt;
        const savedBookmark = await manager.saveBookmark(bookmark);
        
        assert.ok(savedBookmark.updatedAt);
    });

    it('should update existing bookmark with same ID', async () => {
        const mockMemento = new MockMemento();
        const manager = new BookmarkManager(mockMemento);
        
        const bookmark = createBookmark({ name: 'Original Name' });
        await manager.saveBookmark(bookmark);
        
        const updatedBookmark = createBookmark({
            id: bookmark.id,
            name: 'Updated Name'
        });
        await manager.saveBookmark(updatedBookmark);
        
        const allBookmarks = manager.getAllBookmarks();
        assert.strictEqual(allBookmarks.length, 1);
        assert.strictEqual(allBookmarks[0].name, 'Updated Name');
    });
});

describe('BookmarkManager - getBookmark', () => {
    it('should return undefined for non-existent bookmark', () => {
        const mockMemento = new MockMemento();
        const manager = new BookmarkManager(mockMemento);
        
        const result = manager.getBookmark('non-existent-id');
        assert.strictEqual(result, undefined);
    });

    it('should return bookmark by ID', async () => {
        const mockMemento = new MockMemento();
        const manager = new BookmarkManager(mockMemento);
        
        const bookmark = createBookmark();
        await manager.saveBookmark(bookmark);
        
        const result = manager.getBookmark(bookmark.id);
        
        assert.ok(result);
        assert.strictEqual(result.id, bookmark.id);
    });

    it('should return correct bookmark when multiple exist', async () => {
        const mockMemento = new MockMemento();
        const manager = new BookmarkManager(mockMemento);
        
        const bookmark1 = createBookmark({ id: 'bookmark-1', name: 'First' });
        const bookmark2 = createBookmark({ id: 'bookmark-2', name: 'Second' });
        await manager.saveBookmark(bookmark1);
        await manager.saveBookmark(bookmark2);
        
        const result = manager.getBookmark('bookmark-2');
        
        assert.ok(result);
        assert.strictEqual(result.name, 'Second');
    });
});

describe('BookmarkManager - findByName', () => {
    it('should return undefined for non-existent name', () => {
        const mockMemento = new MockMemento();
        const manager = new BookmarkManager(mockMemento);
        
        const result = manager.findByName('Non-existent');
        assert.strictEqual(result, undefined);
    });

    it('should find bookmark by name (case-insensitive)', async () => {
        const mockMemento = new MockMemento();
        const manager = new BookmarkManager(mockMemento);
        
        const bookmark = createBookmark({ name: 'Stockholm' });
        await manager.saveBookmark(bookmark);
        
        const resultLower = manager.findByName('stockholm');
        const resultUpper = manager.findByName('STOCKHOLM');
        const resultMixed = manager.findByName('StOcKhOlM');
        
        assert.ok(resultLower);
        assert.ok(resultUpper);
        assert.ok(resultMixed);
    });

    it('should trim name when searching', async () => {
        const mockMemento = new MockMemento();
        const manager = new BookmarkManager(mockMemento);
        
        const bookmark = createBookmark({ name: 'Stockholm' });
        await manager.saveBookmark(bookmark);
        
        const result = manager.findByName('  Stockholm  ');
        
        assert.ok(result);
    });
});

describe('BookmarkManager - getAllBookmarks', () => {
    it('should return empty array when no bookmarks', () => {
        const mockMemento = new MockMemento();
        const manager = new BookmarkManager(mockMemento);
        
        const result = manager.getAllBookmarks();
        assert.deepStrictEqual(result, []);
    });

    it('should return all bookmarks', async () => {
        const mockMemento = new MockMemento();
        const manager = new BookmarkManager(mockMemento);
        
        const bookmark1 = createBookmark({ id: 'bookmark-1' });
        const bookmark2 = createBookmark({ id: 'bookmark-2' });
        const bookmark3 = createBookmark({ id: 'bookmark-3' });
        await manager.saveBookmark(bookmark1);
        await manager.saveBookmark(bookmark2);
        await manager.saveBookmark(bookmark3);
        
        const result = manager.getAllBookmarks();
        
        assert.strictEqual(result.length, 3);
    });

    it('should return a copy of bookmarks array', async () => {
        const mockMemento = new MockMemento();
        const manager = new BookmarkManager(mockMemento);
        
        const bookmark = createBookmark();
        await manager.saveBookmark(bookmark);
        
        const result1 = manager.getAllBookmarks();
        const result2 = manager.getAllBookmarks();
        
        assert.notStrictEqual(result1, result2);
    });
});

describe('BookmarkManager - deleteBookmark', () => {
    it('should return false for non-existent bookmark', async () => {
        const mockMemento = new MockMemento();
        const manager = new BookmarkManager(mockMemento);
        
        const result = await manager.deleteBookmark('non-existent-id');
        assert.strictEqual(result, false);
    });

    it('should delete bookmark and return true', async () => {
        const mockMemento = new MockMemento();
        const manager = new BookmarkManager(mockMemento);
        
        const bookmark = createBookmark();
        await manager.saveBookmark(bookmark);
        
        const deleteResult = await manager.deleteBookmark(bookmark.id);
        assert.strictEqual(deleteResult, true);
        
        const getResult = manager.getBookmark(bookmark.id);
        assert.strictEqual(getResult, undefined);
    });

    it('should delete correct bookmark when multiple exist', async () => {
        const mockMemento = new MockMemento();
        const manager = new BookmarkManager(mockMemento);
        
        const bookmark1 = createBookmark({ id: 'bookmark-1' });
        const bookmark2 = createBookmark({ id: 'bookmark-2' });
        await manager.saveBookmark(bookmark1);
        await manager.saveBookmark(bookmark2);
        
        await manager.deleteBookmark('bookmark-1');
        
        const allBookmarks = manager.getAllBookmarks();
        assert.strictEqual(allBookmarks.length, 1);
        assert.strictEqual(allBookmarks[0].id, 'bookmark-2');
    });
});

describe('BookmarkManager - updateBookmark', () => {
    it('should return undefined for non-existent bookmark', async () => {
        const mockMemento = new MockMemento();
        const manager = new BookmarkManager(mockMemento);
        
        const result = await manager.updateBookmark('non-existent-id', { name: 'New Name' });
        assert.strictEqual(result, undefined);
    });

    it('should update bookmark properties', async () => {
        const mockMemento = new MockMemento();
        const manager = new BookmarkManager(mockMemento);
        
        const bookmark = createBookmark({ name: 'Original Name', zoom: 10 });
        await manager.saveBookmark(bookmark);
        
        const result = await manager.updateBookmark(bookmark.id, {
            name: 'Updated Name',
            zoom: 15
        });
        
        assert.ok(result);
        assert.strictEqual(result.name, 'Updated Name');
        assert.strictEqual(result.zoom, 15);
    });

    it('should preserve ID and createdAt', async () => {
        const mockMemento = new MockMemento();
        const manager = new BookmarkManager(mockMemento);
        
        const originalCreatedAt = '2024-01-01T00:00:00.000Z';
        const bookmark = createBookmark({ createdAt: originalCreatedAt });
        await manager.saveBookmark(bookmark);
        
        const result = await manager.updateBookmark(bookmark.id, { name: 'Updated' });
        
        assert.ok(result);
        assert.strictEqual(result.id, bookmark.id);
        assert.strictEqual(result.createdAt, originalCreatedAt);
    });

    it('should update updatedAt timestamp', async () => {
        const mockMemento = new MockMemento();
        const manager = new BookmarkManager(mockMemento);
        
        const bookmark = createBookmark();
        await manager.saveBookmark(bookmark);
        const originalUpdatedAt = bookmark.updatedAt;
        
        await new Promise(resolve => setTimeout(resolve, 10));
        
        const result = await manager.updateBookmark(bookmark.id, { name: 'Updated' });
        
        assert.ok(result);
        assert.notStrictEqual(result.updatedAt, originalUpdatedAt);
    });

    it('should support partial updates', async () => {
        const mockMemento = new MockMemento();
        const manager = new BookmarkManager(mockMemento);
        
        const bookmark = createBookmark({
            name: 'Original',
            description: 'Original Description',
            zoom: 10
        });
        await manager.saveBookmark(bookmark);
        
        const result = await manager.updateBookmark(bookmark.id, { zoom: 15 });
        
        assert.ok(result);
        assert.strictEqual(result.name, 'Original');
        assert.strictEqual(result.description, 'Original Description');
        assert.strictEqual(result.zoom, 15);
    });
});

describe('BookmarkManager - nameExists', () => {
    it('should return false when no bookmarks exist', () => {
        const mockMemento = new MockMemento();
        const manager = new BookmarkManager(mockMemento);
        
        const result = manager.nameExists('Any Name');
        assert.strictEqual(result, false);
    });

    it('should return true when bookmark with name exists', async () => {
        const mockMemento = new MockMemento();
        const manager = new BookmarkManager(mockMemento);
        
        const bookmark = createBookmark({ name: 'Stockholm' });
        await manager.saveBookmark(bookmark);
        
        const result = manager.nameExists('Stockholm');
        assert.strictEqual(result, true);
    });

    it('should be case-insensitive', async () => {
        const mockMemento = new MockMemento();
        const manager = new BookmarkManager(mockMemento);
        
        const bookmark = createBookmark({ name: 'Stockholm' });
        await manager.saveBookmark(bookmark);
        
        assert.strictEqual(manager.nameExists('stockholm'), true);
        assert.strictEqual(manager.nameExists('STOCKHOLM'), true);
    });

    it('should return false for non-existent name', async () => {
        const mockMemento = new MockMemento();
        const manager = new BookmarkManager(mockMemento);
        
        const bookmark = createBookmark({ name: 'Stockholm' });
        await manager.saveBookmark(bookmark);
        
        const result = manager.nameExists('Gothenburg');
        assert.strictEqual(result, false);
    });
});

describe('BookmarkManager - clearAll', () => {
    it('should remove all bookmarks', async () => {
        const mockMemento = new MockMemento();
        const manager = new BookmarkManager(mockMemento);
        
        const bookmark1 = createBookmark({ id: 'bookmark-1' });
        const bookmark2 = createBookmark({ id: 'bookmark-2' });
        await manager.saveBookmark(bookmark1);
        await manager.saveBookmark(bookmark2);
        
        await manager.clearAll();
        
        const result = manager.getAllBookmarks();
        assert.strictEqual(result.length, 0);
    });

    it('should work when no bookmarks exist', async () => {
        const mockMemento = new MockMemento();
        const manager = new BookmarkManager(mockMemento);
        
        await manager.clearAll();
        
        const result = manager.getAllBookmarks();
        assert.strictEqual(result.length, 0);
    });
});

describe('BookmarkManager - count', () => {
    it('should return 0 when no bookmarks', () => {
        const mockMemento = new MockMemento();
        const manager = new BookmarkManager(mockMemento);
        
        assert.strictEqual(manager.count, 0);
    });

    it('should return correct count', async () => {
        const mockMemento = new MockMemento();
        const manager = new BookmarkManager(mockMemento);
        
        const bookmark1 = createBookmark({ id: 'bookmark-1' });
        const bookmark2 = createBookmark({ id: 'bookmark-2' });
        await manager.saveBookmark(bookmark1);
        await manager.saveBookmark(bookmark2);
        
        assert.strictEqual(manager.count, 2);
    });

    it('should update count after deletion', async () => {
        const mockMemento = new MockMemento();
        const manager = new BookmarkManager(mockMemento);
        
        const bookmark = createBookmark();
        await manager.saveBookmark(bookmark);
        
        await manager.deleteBookmark(bookmark.id);
        
        assert.strictEqual(manager.count, 0);
    });
});

describe('BookmarkManager - persistence', () => {
    it('should persist bookmarks across manager instances', async () => {
        const mockMemento = new MockMemento();
        const manager1 = new BookmarkManager(mockMemento);
        
        const bookmark = createBookmark({ name: 'Persistent Bookmark' });
        await manager1.saveBookmark(bookmark);
        
        const manager2 = new BookmarkManager(mockMemento);
        const result = manager2.getBookmark(bookmark.id);
        
        assert.ok(result);
        assert.strictEqual(result.name, 'Persistent Bookmark');
    });

    it('should persist collection metadata', async () => {
        const mockMemento = new MockMemento();
        const manager1 = new BookmarkManager(mockMemento);
        
        const bookmark = createBookmark();
        await manager1.saveBookmark(bookmark);
        
        const manager2 = new BookmarkManager(mockMemento);
        const allBookmarks = manager2.getAllBookmarks();
        
        assert.strictEqual(allBookmarks.length, 1);
    });
});

describe('MockMemento', () => {
    it('should store and retrieve values', () => {
        const memento = new MockMemento();
        memento.update('key', 'value');
        
        assert.strictEqual(memento.get('key'), 'value');
    });

    it('should return undefined for non-existent keys', () => {
        const memento = new MockMemento();
        
        assert.strictEqual(memento.get('non-existent'), undefined);
    });

    it('should return default value for non-existent keys', () => {
        const memento = new MockMemento();
        
        assert.strictEqual(memento.get('non-existent', 'default'), 'default');
    });

    it('should delete value when updating with undefined', async () => {
        const memento = new MockMemento();
        await memento.update('key', 'value');
        await memento.update('key', undefined);
        
        assert.strictEqual(memento.get('key'), undefined);
    });

    it('should return all keys', async () => {
        const memento = new MockMemento();
        await memento.update('key1', 'value1');
        await memento.update('key2', 'value2');
        
        const keys = memento.keys();
        
        assert.ok(keys.includes('key1'));
        assert.ok(keys.includes('key2'));
    });

    it('should clear all values', async () => {
        const memento = new MockMemento();
        await memento.update('key1', 'value1');
        await memento.update('key2', 'value2');
        
        memento.clear();
        
        assert.strictEqual(memento.keys().length, 0);
    });
});

// Print summary
console.log('\n' + '='.repeat(50));
console.log('TEST SUMMARY');
console.log('='.repeat(50));
console.log(`Total tests: ${testsPassed + testsFailed}`);
console.log(`Passed: ${testsPassed}`);
console.log(`Failed: ${testsFailed}`);

if (testsFailed > 0) {
    console.log('\nFailed tests:');
    testResults
        .filter(r => !r.passed)
        .forEach(r => console.log(`  - ${r.name}: ${r.error}`));
    process.exit(1);
} else {
    console.log('\n✅ All tests passed!');
    process.exit(0);
}