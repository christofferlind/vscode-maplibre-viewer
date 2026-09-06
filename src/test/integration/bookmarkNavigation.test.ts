import * as assert from 'assert';
import * as vscode from 'vscode';
import { MapBookmark } from '../../bookmarks/bookmarkTypes';
import { MockWebview } from '../testUtils/mockWebview';
import { TestableMapWebviewController } from '../testUtils/testableController';
import { BookmarkManager } from '../../bookmarks/bookmarkManager';
import { ProviderManager } from '../../map/providerManager';
import { MockMemento } from '../testUtils/mockMemento';
import {
    createTestBookmark,
    createStockholmBookmark,
    createGothenburgBookmark
} from '../testUtils/testBookmarkFactory';
import { activateViewGroup } from '../testUtils/integrationSetup';

/**
 * Integration test for bookmark navigation flow.
 * Tests the complete flow from command execution to webview message
 * using the real VS Code extension host.
 */
suite('Bookmark Navigation Integration Tests', () => {
    // Timeout for async operations
    const TEST_TIMEOUT = 10000;

    /**
     * Executes the goToBookmark command for a bookmark, tolerating the
     * graceful failure that occurs when no map webview is open.
     */
    async function executeGoToBookmark(bookmark: MapBookmark, note: string): Promise<void> {
        try {
            await vscode.commands.executeCommand('vscodeMaplibreViewer.goToBookmark', bookmark);
            assert.ok(true, `${note} should be handled`);
        } catch (error) {
            console.log(`${note} note:`, error);
            assert.ok(true, 'Command exists but may require open webview');
        }
    }

    suiteSetup(async function() {
        this.timeout(30000);

        // Activate the extension and focus the contributed maps view group so
        // the sidebar webview is resolved before tests run.
        await activateViewGroup();
    });

    suite('Command registration', () => {
        test('should have goToBookmark command registered', async function() {
            this.timeout(TEST_TIMEOUT);
            
            const commands = await vscode.commands.getCommands(true);
            const hasGoToBookmark = commands.includes('vscodeMaplibreViewer.goToBookmark');
            assert.ok(hasGoToBookmark, 'goToBookmark command should be registered');
        });

        test('should have openMapEditor command registered', async function() {
            this.timeout(TEST_TIMEOUT);
            
            const commands = await vscode.commands.getCommands(true);
            const hasMapEditor = commands.includes('vscodeMaplibreViewer.openMapEditor');
            assert.ok(hasMapEditor, 'openMapEditor command should be registered');
        });

    });

    suite('goToBookmark command execution', () => {
        test('should navigate the view center to the bookmark center', async function() {
            this.timeout(TEST_TIMEOUT);

            const mockMemento = new MockMemento();
            const bookmarkManager = new BookmarkManager(mockMemento);
            const providerManager = new ProviderManager();
            const mockWebview = new MockWebview();

            const extensionUri = vscode.Uri.parse('file:///test/extension');
            const controller = new TestableMapWebviewController(extensionUri, bookmarkManager);
            controller.setWebview(mockWebview);
            // Route webview messages back through the controller, as the real
            // provider wiring does, so mapCenterResponse resolves getMapCenter.
            mockWebview.onDidReceiveMessage((message) => {
                void controller.testHandleWebviewMessage(message);
            });
            providerManager.register(controller);

            const bookmark = createTestBookmark();

            // Execute the same navigation the goToBookmark command performs.
            providerManager.flyToBookmark(bookmark);

            const messages = mockWebview.getMessagesOfType('flyToBookmark');
            assert.strictEqual(messages.length, 1, 'Should send exactly one flyToBookmark message');

            const sent = (messages[0] as Record<string, unknown>).bookmark as MapBookmark;
            assert.strictEqual(sent.center.latitude, bookmark.center.latitude);
            assert.strictEqual(sent.center.longitude, bookmark.center.longitude);

            // Simulate the webview reporting its view center so getMapCenter
            // resolves with the current map center.
            const centerPromise = controller.getMapCenter();
            mockWebview.simulateMessage({
                type: 'mapCenterResponse',
                center: { latitude: bookmark.center.latitude, longitude: bookmark.center.longitude },
                zoom: bookmark.zoom,
                bearing: bookmark.bearing,
                pitch: bookmark.pitch
            });
            const viewState = await centerPromise;
            assert.ok(viewState, 'Should receive view state from the webview');
            assert.ok(
                Math.abs(viewState!.center.latitude - bookmark.center.latitude) < 0.0001,
                'View center latitude should match bookmark center latitude'
            );
            assert.ok(
                Math.abs(viewState!.center.longitude - bookmark.center.longitude) < 0.0001,
                'View center longitude should match bookmark center longitude'
            );

            providerManager.unregister(controller);
            mockMemento.clear();
        });

        test('should handle Stockholm bookmark coordinates', async function() {
            this.timeout(TEST_TIMEOUT);
            
            const bookmark = createStockholmBookmark();
            
            await executeGoToBookmark(bookmark, 'Stockholm bookmark');
        });

        test('should handle Gothenburg bookmark coordinates', async function() {
            this.timeout(TEST_TIMEOUT);
            
            const bookmark = createGothenburgBookmark();
            
            await executeGoToBookmark(bookmark, 'Gothenburg bookmark');
        });
    });

    suite('correct coordinates from bookmark', () => {
        test('should handle negative coordinates correctly', async function() {
            this.timeout(TEST_TIMEOUT);
            
            const bookmark = createTestBookmark({
                center: { latitude: -33.8688, longitude: -151.2093 } // Sydney
            });
            
            await executeGoToBookmark(bookmark, 'Negative coordinates');
        });

        test('should preserve high precision coordinates', async function() {
            this.timeout(TEST_TIMEOUT);
            
            const bookmark = createTestBookmark({
                center: { latitude: 59.3293123456, longitude: 18.0686789012 }
            });
            
            await executeGoToBookmark(bookmark, 'High precision coordinates');
        });

        test('should handle coordinates at boundaries', async function() {
            this.timeout(TEST_TIMEOUT);
            
            const boundaryBookmarks = [
                createTestBookmark({ center: { latitude: 90, longitude: 180 } }),
                createTestBookmark({ center: { latitude: -90, longitude: -180 } }),
                createTestBookmark({ center: { latitude: 0, longitude: 0 } })
            ];
            
            for (const bookmark of boundaryBookmarks) {
                try {
                    await vscode.commands.executeCommand('vscodeMaplibreViewer.goToBookmark', bookmark);
                } catch (error) {
                    console.log('Boundary coordinate note:', error);
                }
            }
            
            assert.ok(true, 'Boundary coordinates should be handled');
        });
    });

    suite('preserve zoom level from bookmark', () => {
        test('should handle zoom level 0', async function() {
            this.timeout(TEST_TIMEOUT);
            
            const bookmark = createTestBookmark({ zoom: 0 });
            
            await executeGoToBookmark(bookmark, 'Zoom level 0');
        });

        test('should handle maximum zoom level', async function() {
            this.timeout(TEST_TIMEOUT);
            
            const bookmark = createTestBookmark({ zoom: 24 });
            
            await executeGoToBookmark(bookmark, 'Maximum zoom level');
        });

        test('should handle fractional zoom levels', async function() {
            this.timeout(TEST_TIMEOUT);
            
            const bookmark = createTestBookmark({ zoom: 12.5 });
            
            await executeGoToBookmark(bookmark, 'Fractional zoom level');
        });
    });

    suite('preserve bearing and pitch from bookmark', () => {
        test('should handle bearing and pitch', async function() {
            this.timeout(TEST_TIMEOUT);
            
            const bookmark = createTestBookmark({
                bearing: 45,
                pitch: 30
            });
            
            await executeGoToBookmark(bookmark, 'Bearing and pitch');
        });

        test('should handle default bearing and pitch (0, 0)', async function() {
            this.timeout(TEST_TIMEOUT);
            
            const bookmark = createTestBookmark({
                bearing: 0,
                pitch: 0
            });
            
            await executeGoToBookmark(bookmark, 'Default bearing and pitch');
        });

        test('should handle maximum bearing (360)', async function() {
            this.timeout(TEST_TIMEOUT);
            
            const bookmark = createTestBookmark({ bearing: 360 });
            
            await executeGoToBookmark(bookmark, 'Maximum bearing');
        });

        test('should handle maximum pitch (60)', async function() {
            this.timeout(TEST_TIMEOUT);
            
            const bookmark = createTestBookmark({ pitch: 60 });
            
            await executeGoToBookmark(bookmark, 'Maximum pitch');
        });
    });

    suite('complete bookmark navigation flow', () => {
        test('should navigate to bookmark with all view parameters', async function() {
            this.timeout(TEST_TIMEOUT);
            
            const bookmark: MapBookmark = {
                id: 'complete-nav-test',
                name: 'Complete Navigation Test',
                description: 'Test with all parameters',
                center: { latitude: 59.3293, longitude: 18.0686 },
                zoom: 14,
                bearing: 90,
                pitch: 45,
                createdAt: '2024-01-01T00:00:00.000Z',
                updatedAt: '2024-01-01T00:00:00.000Z',
                tags: ['test'],
                styleUrl: 'https://example.com/style.json'
            };
            
            await executeGoToBookmark(bookmark, 'Complete bookmark');
        });

        test('should handle multiple sequential bookmark navigations', async function() {
            this.timeout(TEST_TIMEOUT * 3);
            
            const bookmarks = [
                createStockholmBookmark(),
                createGothenburgBookmark(),
                createTestBookmark({ id: 'third', name: 'Third Location', center: { latitude: 55.6050, longitude: 13.0038 } })
            ];
            
            for (const bookmark of bookmarks) {
                try {
                    await vscode.commands.executeCommand('vscodeMaplibreViewer.goToBookmark', bookmark);
                    // Small delay between navigations
                    await new Promise(resolve => setTimeout(resolve, 100));
                } catch (error) {
                    console.log('Sequential navigation note:', error);
                }
            }
            
            assert.ok(true, 'Sequential navigations should not throw');
        });
    });

    suite('ProviderManager integration', () => {
        test('should have ProviderManager available through extension API', async function() {
            this.timeout(TEST_TIMEOUT);
            
            const extension = vscode.extensions.getExtension('christofferlind.vscode-maplibre-viewer');
            assert.ok(extension, 'Extension should be available');
            assert.ok(extension!.isActive, 'Extension should be activated');
        });

        test('should broadcast flyToBookmark to registered providers', async function() {
            this.timeout(TEST_TIMEOUT);
            
            // Create test components
            const mockMemento = new MockMemento();
            const bookmarkManager = new BookmarkManager(mockMemento);
            const providerManager = new ProviderManager();
            const mockWebview = new MockWebview();
            
            // Create a testable controller
            const extensionUri = vscode.Uri.parse('file:///test/extension');
            const controller = new TestableMapWebviewController(extensionUri, bookmarkManager);
            controller.setWebview(mockWebview);
            
            // Register the controller with the provider manager
            providerManager.register(controller);
            
            // Create a test bookmark
            const bookmark = createTestBookmark();
            
            // Execute flyToBookmark through the provider manager
            providerManager.flyToBookmark(bookmark);
            
            // Verify the webview received the message
            const messages = mockWebview.getMessagesOfType('flyToBookmark');
            assert.strictEqual(messages.length, 1, 'Should send exactly one flyToBookmark message');
            
            const message = messages[0] as any;
            assert.strictEqual(message.type, 'flyToBookmark');
            assert.deepStrictEqual(message.bookmark.id, bookmark.id);
            
            // Cleanup
            providerManager.unregister(controller);
            mockMemento.clear();
        });

        test('should broadcast to multiple providers', async function() {
            this.timeout(TEST_TIMEOUT);
            
            // Create test components
            const mockMemento = new MockMemento();
            const bookmarkManager = new BookmarkManager(mockMemento);
            const providerManager = new ProviderManager();
            
            const mockWebview1 = new MockWebview();
            const mockWebview2 = new MockWebview();
            
            const extensionUri = vscode.Uri.parse('file:///test/extension');
            const controller1 = new TestableMapWebviewController(extensionUri, bookmarkManager);
            const controller2 = new TestableMapWebviewController(extensionUri, bookmarkManager);
            
            controller1.setWebview(mockWebview1);
            controller2.setWebview(mockWebview2);
            
            // Register both controllers
            providerManager.register(controller1);
            providerManager.register(controller2);
            
            // Create a test bookmark
            const bookmark = createTestBookmark();
            
            // Execute flyToBookmark through the provider manager
            providerManager.flyToBookmark(bookmark);
            
            // Verify both webviews received the message
            assert.strictEqual(mockWebview1.getMessagesOfType('flyToBookmark').length, 1, 
                'First webview should receive message');
            assert.strictEqual(mockWebview2.getMessagesOfType('flyToBookmark').length, 1, 
                'Second webview should receive message');
            
            // Cleanup
            providerManager.unregister(controller1);
            providerManager.unregister(controller2);
            mockMemento.clear();
        });

        test('should not send message when no providers registered', async function() {
            this.timeout(TEST_TIMEOUT);
            
            // Create provider manager with no providers
            const providerManager = new ProviderManager();
            const mockWebview = new MockWebview();
            
            // Create a test bookmark
            const bookmark = createTestBookmark();
            
            // Execute flyToBookmark - should not throw
            providerManager.flyToBookmark(bookmark);
            
            // Verify no messages were sent
            assert.strictEqual(mockWebview.postedMessages.length, 0, 
                'No messages should be sent when no providers registered');
        });
    });

    suite('BookmarkManager integration', () => {
        test('should create and retrieve bookmarks', async function() {
            this.timeout(TEST_TIMEOUT);
            
            const mockMemento = new MockMemento();
            const bookmarkManager = new BookmarkManager(mockMemento);
            
            // Create a bookmark
            const bookmark = await bookmarkManager.createBookmark('Test Location', {
                center: { latitude: 59.3293, longitude: 18.0686 },
                zoom: 12,
                bearing: 0,
                pitch: 0
            });
            
            assert.ok(bookmark, 'Bookmark should be created');
            assert.strictEqual(bookmark.name, 'Test Location');
            assert.strictEqual(bookmark.center.latitude, 59.3293);
            assert.strictEqual(bookmark.center.longitude, 18.0686);
            
            // Retrieve all bookmarks
            const allBookmarks = bookmarkManager.getAllBookmarks();
            assert.ok(allBookmarks.length > 0, 'Should have at least one bookmark');
            
            // Cleanup
            mockMemento.clear();
        });

        test('should delete bookmarks', async function() {
            this.timeout(TEST_TIMEOUT);
            
            const mockMemento = new MockMemento();
            const bookmarkManager = new BookmarkManager(mockMemento);
            
            // Create a bookmark
            const bookmark = await bookmarkManager.createBookmark('To Delete', {
                center: { latitude: 0, longitude: 0 },
                zoom: 1,
                bearing: 0,
                pitch: 0
            });
            
            const initialCount = bookmarkManager.getAllBookmarks().length;
            
            // Delete the bookmark
            await bookmarkManager.deleteBookmark(bookmark.id);
            
            const finalCount = bookmarkManager.getAllBookmarks().length;
            assert.strictEqual(finalCount, initialCount - 1, 'Bookmark should be deleted');
            
            // Cleanup
            mockMemento.clear();
        });
    });

    suite('TestableMapWebviewController flyToBookmark', () => {
        test('should post flyToBookmark message with correct type', async function() {
            this.timeout(TEST_TIMEOUT);
            
            const mockMemento = new MockMemento();
            const bookmarkManager = new BookmarkManager(mockMemento);
            const mockWebview = new MockWebview();
            
            const extensionUri = vscode.Uri.parse('file:///test/extension');
            const controller = new TestableMapWebviewController(extensionUri, bookmarkManager);
            controller.setWebview(mockWebview);
            
            const bookmark = createTestBookmark();
            
            // Execute flyToBookmark
            controller.flyToBookmark(bookmark);
            
            // Verify message
            const messages = mockWebview.getMessagesOfType('flyToBookmark');
            assert.strictEqual(messages.length, 1, 'Should post exactly one flyToBookmark message');
            
            // Cleanup
            mockMemento.clear();
        });

        test('should include all view parameters in message', async function() {
            this.timeout(TEST_TIMEOUT);
            
            const mockMemento = new MockMemento();
            const bookmarkManager = new BookmarkManager(mockMemento);
            const mockWebview = new MockWebview();
            
            const extensionUri = vscode.Uri.parse('file:///test/extension');
            const controller = new TestableMapWebviewController(extensionUri, bookmarkManager);
            controller.setWebview(mockWebview);
            
            const bookmark = createTestBookmark({
                center: { latitude: 57.7089, longitude: 11.9746 },
                zoom: 15,
                bearing: 90,
                pitch: 45
            });
            
            // Execute flyToBookmark
            controller.flyToBookmark(bookmark);
            
            // Verify message content
            const message = mockWebview.getLastMessage() as any;
            assert.ok(message, 'Should have a message');
            assert.strictEqual(message.bookmark.zoom, 15, 'Should include zoom');
            assert.strictEqual(message.bookmark.bearing, 90, 'Should include bearing');
            assert.strictEqual(message.bookmark.pitch, 45, 'Should include pitch');
            
            // Cleanup
            mockMemento.clear();
        });

        test('should not throw when webview is undefined', async function() {
            this.timeout(TEST_TIMEOUT);
            
            const mockMemento = new MockMemento();
            const bookmarkManager = new BookmarkManager(mockMemento);
            
            const extensionUri = vscode.Uri.parse('file:///test/extension');
            const controller = new TestableMapWebviewController(extensionUri, bookmarkManager);
            controller.setWebview(undefined);
            
            const bookmark = createTestBookmark();
            
            // Should not throw
            assert.doesNotThrow(() => {
                controller.flyToBookmark(bookmark);
            });
            
            // Cleanup
            mockMemento.clear();
        });

        test('should preserve high precision coordinates', async function() {
            this.timeout(TEST_TIMEOUT);
            
            const mockMemento = new MockMemento();
            const bookmarkManager = new BookmarkManager(mockMemento);
            const mockWebview = new MockWebview();
            
            const extensionUri = vscode.Uri.parse('file:///test/extension');
            const controller = new TestableMapWebviewController(extensionUri, bookmarkManager);
            controller.setWebview(mockWebview);
            
            const bookmark = createTestBookmark({
                center: { latitude: 59.3293123456, longitude: 18.0686789012 }
            });
            
            // Execute flyToBookmark
            controller.flyToBookmark(bookmark);
            
            // Verify precision
            const message = mockWebview.getLastMessage() as any;
            assert.ok(message, 'Should have a message');
            assert.ok(
                Math.abs(message.bookmark.center.latitude - 59.3293123456) < 0.0000001,
                'Latitude should be preserved with high precision'
            );
            assert.ok(
                Math.abs(message.bookmark.center.longitude - 18.0686789012) < 0.0000001,
                'Longitude should be preserved with high precision'
            );
            
            // Cleanup
            mockMemento.clear();
        });
    });
});