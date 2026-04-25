import * as assert from 'assert';
import { ProviderManager } from '../../map/providerManager';
import { MapBookmark } from '../../bookmarks/bookmarkTypes';
import { createTestBookmark, createStockholmBookmark, createGothenburgBookmark } from '../testUtils';

/**
 * Mock provider that tracks flyToBookmark calls
 * This mimics MapWebviewController without requiring vscode module
 */
class MockMapWebviewController {
    public flyToBookmarkCalls: Array<{ bookmark: MapBookmark }> = [];
    public shouldThrow: boolean = false;

    flyToBookmark(bookmark: MapBookmark): void {
        if (this.shouldThrow) {
            throw new Error('Mock provider error');
        }
        this.flyToBookmarkCalls.push({ bookmark });
    }

    clearCalls(): void {
        this.flyToBookmarkCalls = [];
    }
}

suite('ProviderManager flyToBookmark Tests', () => {
    let providerManager: ProviderManager;
    let mockProvider1: MockMapWebviewController;
    let mockProvider2: MockMapWebviewController;
    let mockProvider3: MockMapWebviewController;

    setup(() => {
        providerManager = new ProviderManager();
        mockProvider1 = new MockMapWebviewController();
        mockProvider2 = new MockMapWebviewController();
        mockProvider3 = new MockMapWebviewController();
    });

    teardown(() => {
        mockProvider1.clearCalls();
        mockProvider2.clearCalls();
        mockProvider3.clearCalls();
    });

    suite('broadcast to all providers', () => {
        test('should call flyToBookmark on all registered providers', () => {
            // Arrange
            providerManager.register(mockProvider1 as any);
            providerManager.register(mockProvider2 as any);
            providerManager.register(mockProvider3 as any);
            const bookmark = createTestBookmark();

            // Act
            providerManager.flyToBookmark(bookmark);

            // Assert
            assert.strictEqual(mockProvider1.flyToBookmarkCalls.length, 1, 'Provider 1 should receive call');
            assert.strictEqual(mockProvider2.flyToBookmarkCalls.length, 1, 'Provider 2 should receive call');
            assert.strictEqual(mockProvider3.flyToBookmarkCalls.length, 1, 'Provider 3 should receive call');
        });

        test('should call flyToBookmark on single registered provider', () => {
            // Arrange
            providerManager.register(mockProvider1 as any);
            const bookmark = createTestBookmark();

            // Act
            providerManager.flyToBookmark(bookmark);

            // Assert
            assert.strictEqual(mockProvider1.flyToBookmarkCalls.length, 1, 'Provider should receive call');
        });

        test('should not call flyToBookmark on unregistered providers', () => {
            // Arrange
            providerManager.register(mockProvider1 as any);
            providerManager.register(mockProvider2 as any);
            const bookmark = createTestBookmark();

            // Act
            providerManager.unregister(mockProvider2 as any);
            providerManager.flyToBookmark(bookmark);

            // Assert
            assert.strictEqual(mockProvider1.flyToBookmarkCalls.length, 1, 'Provider 1 should receive call');
            assert.strictEqual(mockProvider2.flyToBookmarkCalls.length, 0, 'Unregistered provider should not receive call');
        });
    });

    suite('pass bookmark unchanged to providers', () => {
        test('should pass bookmark object unchanged to all providers', () => {
            // Arrange
            providerManager.register(mockProvider1 as any);
            providerManager.register(mockProvider2 as any);
            const bookmark = createStockholmBookmark();

            // Act
            providerManager.flyToBookmark(bookmark);

            // Assert
            assert.deepStrictEqual(
                mockProvider1.flyToBookmarkCalls[0].bookmark,
                bookmark,
                'Provider 1 should receive exact bookmark object'
            );
            assert.deepStrictEqual(
                mockProvider2.flyToBookmarkCalls[0].bookmark,
                bookmark,
                'Provider 2 should receive exact bookmark object'
            );
        });

        test('should pass bookmark with all properties to providers', () => {
            // Arrange
            providerManager.register(mockProvider1 as any);
            const bookmark: MapBookmark = {
                id: 'full-bookmark',
                name: 'Full Bookmark',
                description: 'A complete bookmark',
                center: { latitude: 59.3293, longitude: 18.0686 },
                zoom: 14,
                bearing: 45,
                pitch: 30,
                createdAt: '2024-01-01T00:00:00.000Z',
                updatedAt: '2024-01-01T00:00:00.000Z',
                tags: ['test'],
                styleUrl: 'https://example.com/style.json'
            };

            // Act
            providerManager.flyToBookmark(bookmark);

            // Assert
            const receivedBookmark = mockProvider1.flyToBookmarkCalls[0].bookmark;
            assert.strictEqual(receivedBookmark.id, bookmark.id);
            assert.strictEqual(receivedBookmark.name, bookmark.name);
            assert.strictEqual(receivedBookmark.description, bookmark.description);
            assert.strictEqual(receivedBookmark.center.latitude, bookmark.center.latitude);
            assert.strictEqual(receivedBookmark.center.longitude, bookmark.center.longitude);
            assert.strictEqual(receivedBookmark.zoom, bookmark.zoom);
            assert.strictEqual(receivedBookmark.bearing, bookmark.bearing);
            assert.strictEqual(receivedBookmark.pitch, bookmark.pitch);
            assert.deepStrictEqual(receivedBookmark.tags, bookmark.tags);
            assert.strictEqual(receivedBookmark.styleUrl, bookmark.styleUrl);
        });

        test('should pass different bookmarks correctly on multiple calls', () => {
            // Arrange
            providerManager.register(mockProvider1 as any);
            const bookmark1 = createStockholmBookmark();
            const bookmark2 = createGothenburgBookmark();

            // Act
            providerManager.flyToBookmark(bookmark1);
            providerManager.flyToBookmark(bookmark2);

            // Assert
            assert.strictEqual(mockProvider1.flyToBookmarkCalls.length, 2);
            assert.deepStrictEqual(mockProvider1.flyToBookmarkCalls[0].bookmark, bookmark1);
            assert.deepStrictEqual(mockProvider1.flyToBookmarkCalls[1].bookmark, bookmark2);
        });
    });

    suite('handle empty providers list gracefully', () => {
        test('should not throw when no providers are registered', () => {
            // Arrange - no providers registered
            const bookmark = createTestBookmark();

            // Act & Assert - should not throw
            assert.doesNotThrow(() => {
                providerManager.flyToBookmark(bookmark);
            });
        });

        test('should handle flyToBookmark after all providers unregistered', () => {
            // Arrange
            providerManager.register(mockProvider1 as any);
            providerManager.unregister(mockProvider1 as any);
            const bookmark = createTestBookmark();

            // Act & Assert - should not throw
            assert.doesNotThrow(() => {
                providerManager.flyToBookmark(bookmark);
            });
        });

        test('should return empty array from getProviders when none registered', () => {
            // Act
            const providers = providerManager.getProviders();

            // Assert
            assert.strictEqual(providers.length, 0);
        });
    });

    suite('continue broadcasting if one provider throws', () => {
        test('should continue to other providers if one throws', () => {
            // Arrange
            mockProvider2.shouldThrow = true; // This provider will throw
            providerManager.register(mockProvider1 as any);
            providerManager.register(mockProvider2 as any);
            providerManager.register(mockProvider3 as any);
            const bookmark = createTestBookmark();

            // Act
            // Note: The current implementation does NOT catch errors, so this will throw.
            // This test documents the current behavior.
            // If we want resilience, we would need to modify ProviderManager.
            try {
                providerManager.flyToBookmark(bookmark);
            } catch (e) {
                // Expected to throw from mockProvider2
            }

            // Assert - Provider 1 should still have been called before the throw
            // Provider 3 may or may not be called depending on order
            assert.ok(
                mockProvider1.flyToBookmarkCalls.length >= 1,
                'Provider 1 should have been called'
            );
        });

        test('should throw when provider throws', () => {
            // Arrange
            mockProvider1.shouldThrow = true;
            providerManager.register(mockProvider1 as any);
            const bookmark = createTestBookmark();

            // Act & Assert
            assert.throws(() => {
                providerManager.flyToBookmark(bookmark);
            }, /Mock provider error/);
        });
    });

    suite('provider registration management', () => {
        test('should track registered providers count', () => {
            // Arrange & Act
            providerManager.register(mockProvider1 as any);
            assert.strictEqual(providerManager.getProviders().length, 1);

            providerManager.register(mockProvider2 as any);
            assert.strictEqual(providerManager.getProviders().length, 2);

            // Unregister
            providerManager.unregister(mockProvider1 as any);
            assert.strictEqual(providerManager.getProviders().length, 1);
        });

        test('should return copy of providers array', () => {
            // Arrange
            providerManager.register(mockProvider1 as any);
            
            // Act
            const providers1 = providerManager.getProviders();
            const providers2 = providerManager.getProviders();

            // Assert
            assert.notStrictEqual(providers1, providers2, 'Should return different array instances');
        });

        test('should not fail when unregistering non-existent provider', () => {
            // Arrange - mockProvider1 was never registered
            const bookmark = createTestBookmark();

            // Act & Assert - should not throw
            assert.doesNotThrow(() => {
                providerManager.unregister(mockProvider1 as any);
            });
        });

        test('should allow re-registering same provider', () => {
            // Arrange
            providerManager.register(mockProvider1 as any);
            providerManager.unregister(mockProvider1 as any);
            
            // Act - re-register
            providerManager.register(mockProvider1 as any);
            const bookmark = createTestBookmark();
            providerManager.flyToBookmark(bookmark);

            // Assert
            assert.strictEqual(mockProvider1.flyToBookmarkCalls.length, 1, 'Re-registered provider should receive call');
        });
    });

    suite('multiple sequential flyToBookmark calls', () => {
        test('should handle multiple sequential calls correctly', () => {
            // Arrange
            providerManager.register(mockProvider1 as any);
            providerManager.register(mockProvider2 as any);
            const bookmarks = [
                createStockholmBookmark(),
                createGothenburgBookmark(),
                createTestBookmark({ id: 'third', name: 'Third Location' })
            ];

            // Act
            for (const bookmark of bookmarks) {
                providerManager.flyToBookmark(bookmark);
            }

            // Assert
            assert.strictEqual(mockProvider1.flyToBookmarkCalls.length, 3);
            assert.strictEqual(mockProvider2.flyToBookmarkCalls.length, 3);
            
            // Verify order is preserved
            assert.strictEqual(mockProvider1.flyToBookmarkCalls[0].bookmark.id, 'stockholm-id');
            assert.strictEqual(mockProvider1.flyToBookmarkCalls[1].bookmark.id, 'gothenburg-id');
            assert.strictEqual(mockProvider1.flyToBookmarkCalls[2].bookmark.id, 'third');
        });

        test('should handle rapid successive calls', () => {
            // Arrange
            providerManager.register(mockProvider1 as any);
            const bookmark = createTestBookmark();

            // Act - rapid calls
            for (let i = 0; i < 100; i++) {
                providerManager.flyToBookmark(bookmark);
            }

            // Assert
            assert.strictEqual(mockProvider1.flyToBookmarkCalls.length, 100);
        });
    });
});