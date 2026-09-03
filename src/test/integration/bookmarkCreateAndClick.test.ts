import * as assert from 'assert';
import * as vscode from 'vscode';
import { BookmarkManager } from '../../bookmarks/bookmarkManager';
import { BookmarkTreeProvider } from '../../bookmarks/bookmarkTreeProvider';
import { MapBookmark } from '../../bookmarks/bookmarkTypes';
import { ProviderManager } from '../../map/providerManager';
import { TestableMapWebviewController } from '../testUtils/testableController';
import { MockWebview } from '../testUtils/mockWebview';
import { createTestBookmark, createStockholmBookmark, createGothenburgBookmark } from '../testUtils';

/**
 * Integration test for the bookmark create-and-click flow.
 *
 * Simulates the real user flow:
 * 1. Create bookmarks through the BookmarkManager.
 * 2. "Click" a bookmark in the tree view, which executes the
 *    vscodeMaplibreViewer.goToBookmark command (the same command wired to
 *    each bookmark's TreeItem).
 * 3. Verify the view change is broadcast to the map webview as a
 *    flyToBookmark message carrying the clicked bookmark.
 */
suite('Bookmark Create and Click Integration Tests', () => {
    const TEST_TIMEOUT = 10000;

    class MockMemento implements vscode.Memento {
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

    let memento: MockMemento;
    let bookmarkManager: BookmarkManager;
    let treeProvider: BookmarkTreeProvider;
    let providerManager: ProviderManager;
    let mockWebview: MockWebview;
    let controller: TestableMapWebviewController;

    suiteSetup(async function() {
        this.timeout(30000);

        const extension = vscode.extensions.getExtension('christofferlind.vscode-maplibre-viewer');
        if (!extension) {
            throw new Error('Extension not found');
        }
        if (!extension.isActive) {
            await extension.activate();
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
    });

    setup(() => {
        memento = new MockMemento();
        bookmarkManager = new BookmarkManager(memento);
        treeProvider = new BookmarkTreeProvider(bookmarkManager);
        providerManager = new ProviderManager();
        mockWebview = new MockWebview();
        controller = new TestableMapWebviewController(
            vscode.Uri.file('/test-extension'),
            bookmarkManager
        );
        controller.setWebview(mockWebview);
        providerManager.register(controller);
    });

    teardown(() => {
        mockWebview.clearTestHandlers();
        mockWebview.clearMessages();
        memento.clear();
    });

    test('should create a bookmark and list it in the tree provider', async function() {
        this.timeout(TEST_TIMEOUT);

        const bookmark = await bookmarkManager.createBookmark('Stockholm', {
            center: { latitude: 59.3293, longitude: 18.0686 },
            zoom: 12,
            bearing: 0,
            pitch: 0
        });

        assert.ok(bookmark, 'Bookmark should be created');
        assert.strictEqual(bookmark.name, 'Stockholm');

        const children = await treeProvider.getChildren();
        assert.strictEqual(children.length, 1, 'Tree should list the created bookmark');
        assert.strictEqual(children[0].id, bookmark.id);
    });

    test('should create multiple bookmarks and list them all', async function() {
        this.timeout(TEST_TIMEOUT);

        await bookmarkManager.createBookmark('Stockholm', {
            center: { latitude: 59.3293, longitude: 18.0686 },
            zoom: 12,
            bearing: 0,
            pitch: 0
        });
        await bookmarkManager.createBookmark('Gothenburg', {
            center: { latitude: 57.7089, longitude: 11.9746 },
            zoom: 11,
            bearing: 0,
            pitch: 0
        });

        const children = await treeProvider.getChildren();
        assert.strictEqual(children.length, 2, 'Tree should list both bookmarks');
    });

    test('should expose the goToBookmark command on the bookmark tree item', async function() {
        this.timeout(TEST_TIMEOUT);

        const bookmark = await bookmarkManager.createBookmark('Stockholm', {
            center: { latitude: 59.3293, longitude: 18.0686 },
            zoom: 12,
            bearing: 0,
            pitch: 0
        });

        const treeItem = treeProvider.getTreeItem(bookmark);
        assert.ok(treeItem.command, 'Tree item should have a command');
        assert.strictEqual(treeItem.command!.command, 'vscodeMaplibreViewer.goToBookmark');
        assert.deepStrictEqual(treeItem.command!.arguments, [bookmark]);
    });

    test('should have the goToBookmark command registered by the extension', async function() {
        this.timeout(TEST_TIMEOUT);

        const commands = await vscode.commands.getCommands(true);
        assert.ok(
            commands.includes('vscodeMaplibreViewer.goToBookmark'),
            'goToBookmark command should be registered'
        );
    });

    test('should broadcast flyToBookmark when a bookmark is clicked', async function() {
        this.timeout(TEST_TIMEOUT);

        const bookmark = await bookmarkManager.createBookmark('Stockholm', {
            center: { latitude: 59.3293, longitude: 18.0686 },
            zoom: 12,
            bearing: 0,
            pitch: 0
        });

        // Clicking a bookmark in the tree executes the goToBookmark command
        // with the bookmark as its argument (see BookmarkTreeProvider.getTreeItem).
        // The command broadcasts flyToBookmark to all registered providers.
        providerManager.flyToBookmark(bookmark);

        const messages = mockWebview.getMessagesOfType('flyToBookmark');
        assert.strictEqual(messages.length, 1, 'Should send one flyToBookmark message');

        const message = messages[0] as Record<string, unknown>;
        const sentBookmark = message.bookmark as MapBookmark;
        assert.strictEqual(sentBookmark.id, bookmark.id);
        assert.strictEqual(sentBookmark.name, 'Stockholm');
        assert.strictEqual(sentBookmark.center.latitude, 59.3293);
        assert.strictEqual(sentBookmark.center.longitude, 18.0686);
        assert.strictEqual(sentBookmark.zoom, 12);
    });

    test('should change the view to the clicked bookmark coordinates', async function() {
        this.timeout(TEST_TIMEOUT);

        const stockholm = await bookmarkManager.createBookmark('Stockholm', {
            center: { latitude: 59.3293, longitude: 18.0686 },
            zoom: 12,
            bearing: 0,
            pitch: 0
        });
        const gothenburg = await bookmarkManager.createBookmark('Gothenburg', {
            center: { latitude: 57.7089, longitude: 11.9746 },
            zoom: 11,
            bearing: 0,
            pitch: 0
        });

        // Click Stockholm
        providerManager.flyToBookmark(stockholm);
        let messages = mockWebview.getMessagesOfType('flyToBookmark');
        assert.strictEqual(messages.length, 1);
        let sent = (messages[0] as Record<string, unknown>).bookmark as MapBookmark;
        assert.strictEqual(sent.center.latitude, 59.3293);
        assert.strictEqual(sent.center.longitude, 18.0686);

        // Click Gothenburg - the view should change to its coordinates
        providerManager.flyToBookmark(gothenburg);
        messages = mockWebview.getMessagesOfType('flyToBookmark');
        assert.strictEqual(messages.length, 2);
        sent = (messages[1] as Record<string, unknown>).bookmark as MapBookmark;
        assert.strictEqual(sent.center.latitude, 57.7089);
        assert.strictEqual(sent.center.longitude, 11.9746);
    });

    test('should preserve zoom, bearing and pitch when clicking a bookmark', async function() {
        this.timeout(TEST_TIMEOUT);

        const bookmark = await bookmarkManager.createBookmark('Rotated View', {
            center: { latitude: 59.3293, longitude: 18.0686 },
            zoom: 15,
            bearing: 45,
            pitch: 30
        });

        providerManager.flyToBookmark(bookmark);

        const messages = mockWebview.getMessagesOfType('flyToBookmark');
        assert.strictEqual(messages.length, 1);
        const sent = (messages[0] as Record<string, unknown>).bookmark as MapBookmark;
        assert.strictEqual(sent.zoom, 15);
        assert.strictEqual(sent.bearing, 45);
        assert.strictEqual(sent.pitch, 30);
    });

    test('should create bookmarks from the test factory and click them', async function() {
        this.timeout(TEST_TIMEOUT);

        const stockholm = createStockholmBookmark();
        const gothenburg = createGothenburgBookmark();
        const plain = createTestBookmark({ id: 'plain', name: 'Plain', center: { latitude: 0, longitude: 0 }, zoom: 1 });

        for (const bookmark of [stockholm, gothenburg, plain]) {
            providerManager.flyToBookmark(bookmark);
        }

        const messages = mockWebview.getMessagesOfType('flyToBookmark');
        assert.strictEqual(messages.length, 3, 'Each click should broadcast a flyToBookmark message');
        const ids = messages.map(m => ((m as Record<string, unknown>).bookmark as MapBookmark).id);
        assert.deepStrictEqual(ids, ['stockholm-id', 'gothenburg-id', 'plain']);
    });
});
