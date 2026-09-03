import * as assert from 'assert';
import { ProviderManager } from '../../map/providerManager';

/**
 * Tests for ProviderManager convenience methods other than flyToBookmark:
 * fitBoundsOnly, flyToLocation, updateOverlayLayers, setBaseMap,
 * fitBoundingBox, updateConfiguration, setMapLanguage. These all funnel
 * through the private broadcast helper.
 */

interface PendingCall {
    method: string;
    args: unknown[];
}

class MockProvider {
    public calls: PendingCall[] = [];
    public throwsForMethod?: string;

    private record(method: string, args: unknown[]): void {
        if (this.throwsForMethod === method) {
            throw new Error(`Mock error for ${method}`);
        }
        this.calls.push({ method, args });
    }

    fitBoundsOnly(bbox: unknown): void {
        this.record('fitBoundsOnly', [bbox]);
    }
    flyToLocation(lat: number, lng: number, zoom?: number): void {
        this.record('flyToLocation', [lat, lng, zoom]);
    }
    updateOverlayLayers(layers: unknown): void {
        this.record('updateOverlayLayers', [layers]);
    }
    setBaseMap(style: unknown): void {
        this.record('setBaseMap', [style]);
    }
    fitBoundingBox(coordinates: unknown, bbox: unknown): void {
        this.record('fitBoundingBox', [coordinates, bbox]);
    }
    updateConfiguration(): void {
        this.record('updateConfiguration', []);
    }
    setMapLanguage(languageCode: string): void {
        this.record('setMapLanguage', [languageCode]);
    }
}

suite('ProviderManager convenience methods', () => {
    let manager: ProviderManager;
    let provider1: MockProvider;
    let provider2: MockProvider;

    setup(() => {
        manager = new ProviderManager();
        provider1 = new MockProvider();
        provider2 = new MockProvider();
    });

    teardown(() => {
        manager.getProviders().forEach(() => undefined);
    });

    suite('fitBoundsOnly', () => {
        test('broadcasts the bbox to all providers', () => {
            manager.register(provider1 as never);
            manager.register(provider2 as never);
            const bbox = { southwest: { lat: 1, lng: 2 }, northeast: { lat: 3, lng: 4 } };

            manager.fitBoundsOnly(bbox as never);

            assert.strictEqual(provider1.calls.length, 1);
            assert.strictEqual(provider1.calls[0].method, 'fitBoundsOnly');
            assert.strictEqual(provider1.calls[0].args[0], bbox);
            assert.strictEqual(provider2.calls.length, 1);
        });

        test('handles a bbox of zero coordinates', () => {
            manager.register(provider1 as never);
            const bbox = { southwest: { lat: 0, lng: 0 }, northeast: { lat: 0, lng: 0 } };
            manager.fitBoundsOnly(bbox as never);
            assert.deepStrictEqual(provider1.calls[0].args[0], bbox);
        });

        test('is a no-op when no providers are registered', () => {
            assert.doesNotThrow(() => {
                manager.fitBoundsOnly({ southwest: { lat: 1, lng: 1 }, northeast: { lat: 2, lng: 2 } } as never);
            });
        });
    });

    suite('flyToLocation', () => {
        test('broadcasts lat, lng and zoom', () => {
            manager.register(provider1 as never);
            manager.flyToLocation(59.5, 18.5, 9);
            assert.strictEqual(provider1.calls[0].method, 'flyToLocation');
            assert.deepStrictEqual(provider1.calls[0].args, [59.5, 18.5, 9]);
        });

        test('handles optional zoom omitted', () => {
            manager.register(provider1 as never);
            manager.flyToLocation(10, 20);
            assert.deepStrictEqual(provider1.calls[0].args, [10, 20, undefined]);
        });

        test('broadcasts zoom level 0 (not mistaken for absent)', () => {
            manager.register(provider1 as never);
            manager.flyToLocation(10, 20, 0);
            assert.strictEqual(provider1.calls[0].args[2], 0);
        });
    });

    suite('updateOverlayLayers', () => {
        test('broadcasts the layers array', () => {
            manager.register(provider1 as never);
            const layers = [{ id: 'a', visible: true }];
            manager.updateOverlayLayers(layers as never);
            assert.strictEqual(provider1.calls[0].method, 'updateOverlayLayers');
            assert.strictEqual(provider1.calls[0].args[0], layers);
        });

        test('broadcasts an empty layers array', () => {
            manager.register(provider1 as never);
            manager.updateOverlayLayers([]);
            assert.strictEqual(provider1.calls[0].args.length, 1);
            assert.deepStrictEqual(provider1.calls[0].args[0], []);
        });
    });

    suite('setBaseMap', () => {
        test('broadcasts the basemap style', () => {
            manager.register(provider1 as never);
            const style = { id: 's1', name: 'Street', styleUrl: 'https://x/style.json' };
            manager.setBaseMap(style as never);
            assert.strictEqual(provider1.calls[0].method, 'setBaseMap');
            assert.strictEqual(provider1.calls[0].args[0], style);
        });

        test('continues when a provider throws', () => {
            provider1.throwsForMethod = 'setBaseMap';
            manager.register(provider1 as never);
            manager.register(provider2 as never);

            assert.doesNotThrow(() => {
                manager.setBaseMap({ id: 'x', name: 'X' } as never);
            });
            assert.strictEqual(provider2.calls.length, 1, 'second provider should still get the call');
        });
    });

    suite('fitBoundingBox', () => {
        test('broadcasts coordinates and bbox', () => {
            manager.register(provider1 as never);
            const coordinates = [{ lat: 1, lng: 1 }];
            const bbox = { southwest: { lat: 1, lng: 1 }, northeast: { lat: 2, lng: 2 } };
            manager.fitBoundingBox(coordinates as never, bbox as never);
            assert.strictEqual(provider1.calls[0].method, 'fitBoundingBox');
            assert.strictEqual(provider1.calls[0].args[0], coordinates);
            assert.strictEqual(provider1.calls[0].args[1], bbox);
        });
    });

    suite('updateConfiguration and setMapLanguage', () => {
        test('updateConfiguration broadcasts with no args', () => {
            manager.register(provider1 as never);
            manager.updateConfiguration();
            assert.strictEqual(provider1.calls[0].method, 'updateConfiguration');
            assert.deepStrictEqual(provider1.calls[0].args, []);
        });

        test('setMapLanguage broadcasts the language code', () => {
            manager.register(provider1 as never);
            manager.setMapLanguage('sv');
            assert.strictEqual(provider1.calls[0].method, 'setMapLanguage');
            assert.deepStrictEqual(provider1.calls[0].args, ['sv']);
        });

        test('continues broadcasting when one provider lacks a method', () => {
            const silentProvider = { register: () => undefined } as unknown as MockProvider;
            manager.register(silentProvider as never);
            manager.register(provider2 as never);
            manager.flyToLocation(1, 2);
            assert.strictEqual(provider2.calls.length, 1);
        });
    });
});
