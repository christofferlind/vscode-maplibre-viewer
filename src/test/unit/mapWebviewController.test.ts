import * as assert from 'assert';
import { MockWebview, createTestBookmark, createBookmarkWithRotation } from '../testUtils';
import { MapBookmark } from '../../bookmarks/bookmarkTypes';

/**
 * Mock controller that mimics MapWebviewController's flyToBookmark behavior
 * without requiring the vscode module
 */
class MockMapWebviewController {
    private _webview: MockWebview | undefined;

    setWebview(webview: MockWebview | undefined): void {
        this._webview = webview;
    }

    getWebview(): MockWebview | undefined {
        return this._webview;
    }

    /**
     * Flies to a bookmark location on the map
     * This mimics the real MapWebviewController.flyToBookmark method
     */
    flyToBookmark(bookmark: MapBookmark): void {
        const webview = this.getWebview();
        if (webview) {
            webview.postMessage({
                type: 'flyToBookmark',
                bookmark: bookmark
            });
        }
    }
}

suite('MapWebviewController flyToBookmark Tests', () => {
    let mockWebview: MockWebview;
    let controller: MockMapWebviewController;

    setup(() => {
        mockWebview = new MockWebview();
        controller = new MockMapWebviewController();
    });

    teardown(() => {
        mockWebview.clearMessages();
    });

    suite('flyToBookmark message construction', () => {
        test('should post flyToBookmark message with correct type', () => {
            // Arrange
            controller.setWebview(mockWebview);
            const bookmark = createTestBookmark();

            // Act
            controller.flyToBookmark(bookmark);

            // Assert
            const messages = mockWebview.getMessagesOfType('flyToBookmark');
            assert.strictEqual(messages.length, 1, 'Should post exactly one flyToBookmark message');
        });

        test('should post message with correct coordinates', () => {
            // Arrange
            controller.setWebview(mockWebview);
            const bookmark = createTestBookmark({
                center: { latitude: 59.3293, longitude: 18.0686 }
            });

            // Act
            controller.flyToBookmark(bookmark);

            // Assert
            const message = mockWebview.getLastMessage() as any;
            assert.ok(message, 'Should have a message');
            assert.strictEqual(message.type, 'flyToBookmark');
            assert.strictEqual(message.bookmark.center.latitude, 59.3293);
            assert.strictEqual(message.bookmark.center.longitude, 18.0686);
        });

        test('should include all view parameters in message', () => {
            // Arrange
            controller.setWebview(mockWebview);
            const bookmark = createTestBookmark({
                center: { latitude: 57.7089, longitude: 11.9746 },
                zoom: 15,
                bearing: 90,
                pitch: 45
            });

            // Act
            controller.flyToBookmark(bookmark);

            // Assert
            const message = mockWebview.getLastMessage() as any;
            assert.ok(message, 'Should have a message');
            assert.strictEqual(message.bookmark.zoom, 15, 'Should include zoom');
            assert.strictEqual(message.bookmark.bearing, 90, 'Should include bearing');
            assert.strictEqual(message.bookmark.pitch, 45, 'Should include pitch');
        });

        test('should include bookmark id and name in message', () => {
            // Arrange
            controller.setWebview(mockWebview);
            const bookmark = createTestBookmark({
                id: 'test-id-123',
                name: 'Test Location Name'
            });

            // Act
            controller.flyToBookmark(bookmark);

            // Assert
            const message = mockWebview.getLastMessage() as any;
            assert.ok(message, 'Should have a message');
            assert.strictEqual(message.bookmark.id, 'test-id-123');
            assert.strictEqual(message.bookmark.name, 'Test Location Name');
        });
    });

    suite('flyToBookmark with default bearing and pitch', () => {
        test('should handle bookmark with bearing=0 and pitch=0', () => {
            // Arrange
            controller.setWebview(mockWebview);
            const bookmark = createTestBookmark({
                bearing: 0,
                pitch: 0
            });

            // Act
            controller.flyToBookmark(bookmark);

            // Assert
            const message = mockWebview.getLastMessage() as any;
            assert.ok(message, 'Should have a message');
            assert.strictEqual(message.bookmark.bearing, 0, 'Should preserve bearing=0');
            assert.strictEqual(message.bookmark.pitch, 0, 'Should preserve pitch=0');
        });

        test('should handle bookmark with undefined bearing and pitch defaults', () => {
            // Arrange
            controller.setWebview(mockWebview);
            // Create bookmark without explicit bearing/pitch
            const bookmark: MapBookmark = {
                id: 'test-id',
                name: 'Test',
                center: { latitude: 59.3293, longitude: 18.0686 },
                zoom: 10,
                bearing: 0, // Default value
                pitch: 0,   // Default value
                createdAt: '2024-01-01T00:00:00.000Z',
                updatedAt: '2024-01-01T00:00:00.000Z'
            };

            // Act
            controller.flyToBookmark(bookmark);

            // Assert
            const message = mockWebview.getLastMessage() as any;
            assert.ok(message, 'Should have a message');
            assert.strictEqual(message.bookmark.bearing, 0);
            assert.strictEqual(message.bookmark.pitch, 0);
        });
    });

    suite('flyToBookmark with custom bearing and pitch', () => {
        test('should handle bookmark with bearing=45 and pitch=30', () => {
            // Arrange
            controller.setWebview(mockWebview);
            const bookmark = createBookmarkWithRotation();

            // Act
            controller.flyToBookmark(bookmark);

            // Assert
            const message = mockWebview.getLastMessage() as any;
            assert.ok(message, 'Should have a message');
            assert.strictEqual(message.bookmark.bearing, 45, 'Should preserve custom bearing');
            assert.strictEqual(message.bookmark.pitch, 30, 'Should preserve custom pitch');
        });

        test('should handle bookmark with maximum bearing (360)', () => {
            // Arrange
            controller.setWebview(mockWebview);
            const bookmark = createTestBookmark({
                bearing: 360
            });

            // Act
            controller.flyToBookmark(bookmark);

            // Assert
            const message = mockWebview.getLastMessage() as any;
            assert.ok(message, 'Should have a message');
            assert.strictEqual(message.bookmark.bearing, 360);
        });

        test('should handle bookmark with maximum pitch (60)', () => {
            // Arrange
            controller.setWebview(mockWebview);
            const bookmark = createTestBookmark({
                pitch: 60
            });

            // Act
            controller.flyToBookmark(bookmark);

            // Assert
            const message = mockWebview.getLastMessage() as any;
            assert.ok(message, 'Should have a message');
            assert.strictEqual(message.bookmark.pitch, 60);
        });
    });

    suite('flyToBookmark graceful handling when webview unavailable', () => {
        test('should not throw when webview is undefined', () => {
            // Arrange
            controller.setWebview(undefined);
            const bookmark = createTestBookmark();

            // Act & Assert - should not throw
            assert.doesNotThrow(() => {
                controller.flyToBookmark(bookmark);
            });
        });

        test('should not send message when webview is undefined', () => {
            // Arrange
            controller.setWebview(undefined);
            const bookmark = createTestBookmark();

            // Act
            controller.flyToBookmark(bookmark);

            // Assert - no messages should be posted
            assert.strictEqual(mockWebview.postedMessages.length, 0);
        });

        test('should send message when webview becomes available', () => {
            // Arrange - start without webview
            controller.setWebview(undefined);
            const bookmark = createTestBookmark();

            // Act - first call with no webview
            controller.flyToBookmark(bookmark);
            
            // Now set webview and call again
            controller.setWebview(mockWebview);
            controller.flyToBookmark(bookmark);

            // Assert - only one message should be posted (second call)
            assert.strictEqual(mockWebview.postedMessages.length, 1);
        });
    });

    suite('flyToBookmark coordinate precision', () => {
        test('should preserve high precision coordinates', () => {
            // Arrange
            controller.setWebview(mockWebview);
            const bookmark = createTestBookmark({
                center: { latitude: 59.3293123456, longitude: 18.0686789012 }
            });

            // Act
            controller.flyToBookmark(bookmark);

            // Assert
            const message = mockWebview.getLastMessage() as any;
            assert.ok(message, 'Should have a message');
            // Use tolerance for floating point comparison
            assert.ok(
                Math.abs(message.bookmark.center.latitude - 59.3293123456) < 0.0000001,
                'Latitude should be preserved with high precision'
            );
            assert.ok(
                Math.abs(message.bookmark.center.longitude - 18.0686789012) < 0.0000001,
                'Longitude should be preserved with high precision'
            );
        });

        test('should handle negative coordinates', () => {
            // Arrange
            controller.setWebview(mockWebview);
            const bookmark = createTestBookmark({
                center: { latitude: -33.8688, longitude: -151.2093 }
            });

            // Act
            controller.flyToBookmark(bookmark);

            // Assert
            const message = mockWebview.getLastMessage() as any;
            assert.ok(message, 'Should have a message');
            assert.strictEqual(message.bookmark.center.latitude, -33.8688);
            assert.strictEqual(message.bookmark.center.longitude, -151.2093);
        });

        test('should handle coordinates at boundaries', () => {
            // Arrange
            controller.setWebview(mockWebview);
            const bookmark = createTestBookmark({
                center: { latitude: 90, longitude: 180 }
            });

            // Act
            controller.flyToBookmark(bookmark);

            // Assert
            const message = mockWebview.getLastMessage() as any;
            assert.ok(message, 'Should have a message');
            assert.strictEqual(message.bookmark.center.latitude, 90);
            assert.strictEqual(message.bookmark.center.longitude, 180);
        });

        test('should handle coordinates at negative boundaries', () => {
            // Arrange
            controller.setWebview(mockWebview);
            const bookmark = createTestBookmark({
                center: { latitude: -90, longitude: -180 }
            });

            // Act
            controller.flyToBookmark(bookmark);

            // Assert
            const message = mockWebview.getLastMessage() as any;
            assert.ok(message, 'Should have a message');
            assert.strictEqual(message.bookmark.center.latitude, -90);
            assert.strictEqual(message.bookmark.center.longitude, -180);
        });
    });

    suite('flyToBookmark zoom level handling', () => {
        test('should preserve zoom level 0', () => {
            // Arrange
            controller.setWebview(mockWebview);
            const bookmark = createTestBookmark({ zoom: 0 });

            // Act
            controller.flyToBookmark(bookmark);

            // Assert
            const message = mockWebview.getLastMessage() as any;
            assert.ok(message, 'Should have a message');
            assert.strictEqual(message.bookmark.zoom, 0);
        });

        test('should preserve maximum zoom level (24)', () => {
            // Arrange
            controller.setWebview(mockWebview);
            const bookmark = createTestBookmark({ zoom: 24 });

            // Act
            controller.flyToBookmark(bookmark);

            // Assert
            const message = mockWebview.getLastMessage() as any;
            assert.ok(message, 'Should have a message');
            assert.strictEqual(message.bookmark.zoom, 24);
        });

        test('should preserve fractional zoom levels', () => {
            // Arrange
            controller.setWebview(mockWebview);
            const bookmark = createTestBookmark({ zoom: 12.5 });

            // Act
            controller.flyToBookmark(bookmark);

            // Assert
            const message = mockWebview.getLastMessage() as any;
            assert.ok(message, 'Should have a message');
            assert.strictEqual(message.bookmark.zoom, 12.5);
        });
    });

    suite('flyToBookmark complete bookmark data', () => {
        test('should pass complete bookmark object to webview', () => {
            // Arrange
            controller.setWebview(mockWebview);
            const bookmark = createTestBookmark({
                id: 'complete-test-id',
                name: 'Complete Test',
                description: 'A complete bookmark',
                center: { latitude: 59.3293, longitude: 18.0686 },
                zoom: 14,
                bearing: 45,
                pitch: 30,
                tags: ['test', 'complete'],
                styleUrl: 'https://example.com/style.json'
            });

            // Act
            controller.flyToBookmark(bookmark);

            // Assert
            const message = mockWebview.getLastMessage() as any;
            assert.ok(message, 'Should have a message');
            assert.deepStrictEqual(message.bookmark, bookmark, 'Complete bookmark should be passed');
        });

        test('should not modify the original bookmark', () => {
            // Arrange
            controller.setWebview(mockWebview);
            const originalBookmark = createTestBookmark();
            const bookmarkCopy = { ...originalBookmark };

            // Act
            controller.flyToBookmark(originalBookmark);

            // Assert
            assert.deepStrictEqual(originalBookmark, bookmarkCopy, 'Original bookmark should not be modified');
        });
    });
});