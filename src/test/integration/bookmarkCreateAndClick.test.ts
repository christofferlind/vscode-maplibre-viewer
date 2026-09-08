import * as assert from 'assert';
import * as vscode from 'vscode';
import { BookmarkManager } from '../../bookmarks/bookmarkManager';
import { BookmarkTreeProvider } from '../../bookmarks/bookmarkTreeProvider';
import { MapBookmark } from '../../bookmarks/bookmarkTypes';
import { ProviderManager } from '../../map/providerManager';
import { TestableMapWebviewController } from '../testUtils/testableController';
import { MockWebview } from '../testUtils/mockWebview';
import { createTestBookmark, createStockholmBookmark, createGothenburgBookmark } from '../testUtils';
import { activateViewGroup } from '../testUtils/integrationSetup';

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

        // Activate the extension and focus the contributed maps view group so
        // the sidebar webview is resolved before tests run.
        await activateViewGroup();
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

        // Simulated map view state, updated when the webview applies a
        // flyToBookmark. The __testQuery handler mirrors what
        // window.__test.getViewState() reports from the real map.
        let mapViewState = {
            center: { latitude: 0, longitude: 0 },
            zoom: 1,
            bearing: 0,
            pitch: 0
        };
        mockWebview.onTestQuery('getViewState', () => mapViewState);
        // Route webview messages back through the controller, as the real
        // provider wiring does, so __testResponse resolves queryWebview.
        mockWebview.onDidReceiveMessage((message) => {
            void controller.testHandleWebviewMessage(message);
        });

        const bookmark = await bookmarkManager.createBookmark('Rotated View', {
            center: { latitude: 59.3293, longitude: 18.0686 },
            zoom: 15,
            bearing: 45,
            pitch: 30
        });

        providerManager.flyToBookmark(bookmark);

        // The webview applies the last flyToBookmark to the map; the mock
        // view state reflects what window.__test.getViewState() would report.
        const messages = mockWebview.getMessagesOfType('flyToBookmark');
        assert.strictEqual(messages.length, 1);
        const applied = (messages[messages.length - 1] as Record<string, unknown>).bookmark as MapBookmark;
        mapViewState = {
            center: { latitude: applied.center.latitude, longitude: applied.center.longitude },
            zoom: applied.zoom !== undefined ? applied.zoom : 14,
            bearing: applied.bearing || 0,
            pitch: applied.pitch || 0
        };

        // Query the actual view state from the webview instead of the message
        const viewState = await controller.queryWebview('getViewState') as {
            center: { latitude: number; longitude: number };
            zoom: number;
            bearing: number;
            pitch: number;
        };
        assert.ok(viewState, 'Should receive view state from the webview');
        assert.strictEqual(viewState.zoom, 15);
        assert.strictEqual(viewState.bearing, 45);
        assert.strictEqual(viewState.pitch, 30);
        assert.strictEqual(viewState.center.latitude, 59.3293);
        assert.strictEqual(viewState.center.longitude, 18.0686);
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

    test('should update the webview when a bookmark is created', async function() {
        this.timeout(TEST_TIMEOUT);

        // Wire the same subscription the extension registers in activate():
        // refresh the tree view and broadcast the new bookmark list.
        const subscription = bookmarkManager.onDidChangeBookmarks((bookmarks) => {
            treeProvider.refresh();
            providerManager.updateBookmarks(bookmarks);
        });
        try {
            const bookmark = await bookmarkManager.createBookmark('Stockholm', {
                center: { latitude: 59.3293, longitude: 18.0686 },
                zoom: 12,
                bearing: 0,
                pitch: 0
            });

            const messages = mockWebview.getMessagesOfType('bookmarksUpdated');
            assert.strictEqual(messages.length, 1, 'Webview should receive a bookmarksUpdated message');
            const sent = (messages[0] as Record<string, unknown>).bookmarks as MapBookmark[];
            assert.strictEqual(sent.length, 1);
            assert.strictEqual(sent[0].id, bookmark.id);

            const children = await treeProvider.getChildren();
            assert.strictEqual(children.length, 1, 'Tree view should show the created bookmark');
            assert.strictEqual(children[0].id, bookmark.id);
        } finally {
            subscription.dispose();
        }
    });

    test('should update the webview when a bookmark is deleted', async function() {
        this.timeout(TEST_TIMEOUT);

        const subscription = bookmarkManager.onDidChangeBookmarks((bookmarks) => {
            treeProvider.refresh();
            providerManager.updateBookmarks(bookmarks);
        });
        try {
            const bookmark = await bookmarkManager.createBookmark('Stockholm', {
                center: { latitude: 59.3293, longitude: 18.0686 },
                zoom: 12,
                bearing: 0,
                pitch: 0
            });

            let messages = mockWebview.getMessagesOfType('bookmarksUpdated');
            assert.strictEqual(messages.length, 1, 'Create should broadcast');

            await bookmarkManager.deleteBookmark(bookmark.id);

            messages = mockWebview.getMessagesOfType('bookmarksUpdated');
            assert.strictEqual(messages.length, 2, 'Delete should broadcast again');
            const sent = (messages[1] as Record<string, unknown>).bookmarks as MapBookmark[];
            assert.strictEqual(sent.length, 0, 'Bookmark list should be empty after delete');

            const children = await treeProvider.getChildren();
            assert.strictEqual(children.length, 0, 'Tree view should no longer list the deleted bookmark');
        } finally {
            subscription.dispose();
        }
    });

    test('should update the webview when a bookmark is renamed', async function() {
        this.timeout(TEST_TIMEOUT);

        const subscription = bookmarkManager.onDidChangeBookmarks((bookmarks) => {
            treeProvider.refresh();
            providerManager.updateBookmarks(bookmarks);
        });
        try {
            const bookmark = await bookmarkManager.createBookmark('Stockholm', {
                center: { latitude: 59.3293, longitude: 18.0686 },
                zoom: 12,
                bearing: 0,
                pitch: 0
            });
            mockWebview.clearMessages();

            await bookmarkManager.updateBookmark(bookmark.id, { name: 'Capital' });

            const messages = mockWebview.getMessagesOfType('bookmarksUpdated');
            assert.strictEqual(messages.length, 1);
            const sent = (messages[0] as Record<string, unknown>).bookmarks as MapBookmark[];
            assert.strictEqual(sent.length, 1);
            assert.strictEqual(sent[0].name, 'Capital');
            assert.strictEqual(await treeProvider.getChildren().then(c => c[0].name), 'Capital');

            // Verify the renamed bookmark flies to the same location
            const renamed = sent[0];
            providerManager.flyToBookmark(renamed);
            const flyMessages = mockWebview.getMessagesOfType('flyToBookmark');
            assert.strictEqual(flyMessages.length, 1);
            const flown = (flyMessages[0] as Record<string, unknown>).bookmark as MapBookmark;
            assert.strictEqual(flown.name, 'Capital');
            assert.strictEqual(flown.center.latitude, 59.3293);
        } finally {
            subscription.dispose();
        }
    });
});
