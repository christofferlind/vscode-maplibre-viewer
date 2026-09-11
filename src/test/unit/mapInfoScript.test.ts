import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

/**
 * Loads resources/scripts/map-info.js into a sandboxed context with a fake
 * map, a fake vscode.postMessage sink, and drives click events through the
 * attached handler to verify feature-info serialization and posting.
 */
interface LoadedMapInfo {
    mapInfo: {
        attachInfoHandler: (map?: unknown) => void;
        isInfoHandlerAttached: () => boolean;
    };
    posted: Array<Record<string, unknown>>;
    attach: () => void;
    fireClick: (lngLat: { lng: number; lat: number }, features: unknown[]) => void;
}

interface FakeFeature {
    source?: string;
    sourceLayer?: string;
    layer?: { id?: string; metadata?: Record<string, unknown> };
    geometry?: { type: string };
    properties?: Record<string, unknown>;
}

function loadMapInfo(): LoadedMapInfo {
    const sourcePath = path.join(__dirname, '..', '..', '..', 'resources', 'scripts', 'map-info.js');
    const source = fs.readFileSync(sourcePath, 'utf-8');

    const posted: Array<Record<string, unknown>> = [];
    const clickListeners: Array<(e: unknown) => void> = [];
    const map = {
        on: (event: string, handler: (e: unknown) => void) => {
            if (event === 'click') {
                clickListeners.push(handler);
            }
        },
        queryRenderedFeatures: (point: unknown) => point
    };

    const windowObj: Record<string, unknown> = {};
    const context: Record<string, unknown> = {
        window: windowObj,
        console,
        vscode: {
            postMessage: (msg: Record<string, unknown>) => {
                // JSON round-trip strips the vm realm from nested objects so
                // assertions compare plain same-realm structures.
                posted.push(JSON.parse(JSON.stringify(msg)) as Record<string, unknown>);
            }
        }
    };

    vm.runInNewContext(source, context);
    const mapInfo = windowObj.MapInfo as LoadedMapInfo['mapInfo'];
    return {
        mapInfo,
        posted,
        attach: () => mapInfo.attachInfoHandler(map),
        fireClick: (lngLat: { lng: number; lat: number }, features: unknown[]) => {
            for (const listener of clickListeners) {
                listener({ lngLat, point: features });
            }
        }
    };
}

suite('MapInfo webview script', () => {
    test('exports attachInfoHandler and isInfoHandlerAttached', () => {
        const { mapInfo } = loadMapInfo();
        assert.strictEqual(typeof mapInfo.attachInfoHandler, 'function');
        assert.strictEqual(typeof mapInfo.isInfoHandlerAttached, 'function');
    });

    test('isInfoHandlerAttached reflects attachment state', () => {
        const { mapInfo, attach } = loadMapInfo();
        assert.strictEqual(mapInfo.isInfoHandlerAttached(), false);
        attach();
        assert.strictEqual(mapInfo.isInfoHandlerAttached(), true);
    });

    test('click with overlay and basemap features posts a featureInfoUpdate with both', () => {
        const { mapInfo, posted, attach, fireClick } = loadMapInfo();
        attach();

        const features: FakeFeature[] = [
            {
                source: 'overlay-test-layer',
                layer: { id: 'overlay-test-layer-circles', metadata: { name: 'Test Layer' } },
                geometry: { type: 'Point' },
                properties: { name: 'Point A', nested: { value: 42 } }
            },
            {
                source: 'demotiles',
                layer: { id: 'background' },
                geometry: { type: 'Polygon' },
                properties: { class: 'water' }
            }
        ];
        fireClick({ lng: 18.06, lat: 59.32 }, features);

        assert.strictEqual(posted.length, 1, 'should post exactly one message');
        const message = posted[0];
        assert.strictEqual(message.type, 'featureInfoUpdate');
        assert.deepStrictEqual(message.lngLat, { lng: 18.06, lat: 59.32 });

        const sent = message.features as Array<Record<string, unknown>>;
        assert.strictEqual(sent.length, 2);

        assert.strictEqual(sent[0].source, 'overlay-test-layer');
        assert.strictEqual(sent[0].layerName, 'Test Layer');
        assert.strictEqual(sent[0].geometryType, 'Point');
        assert.deepStrictEqual(sent[0].properties, { name: 'Point A', 'nested.value': 42 });

        assert.strictEqual(sent[1].source, 'demotiles');
        assert.strictEqual(sent[1].layerId, 'background');
        assert.strictEqual(sent[1].geometryType, 'Polygon');
        assert.deepStrictEqual(sent[1].properties, { class: 'water' });
    });

    test('click with no features posts a featureInfoUpdate with an empty feature list', () => {
        const { mapInfo, posted, attach, fireClick } = loadMapInfo();
        attach();

        fireClick({ lng: 0, lat: 0 }, []);

        assert.strictEqual(posted.length, 1);
        assert.deepStrictEqual(posted[0].features, []);
        assert.deepStrictEqual(posted[0].lngLat, { lng: 0, lat: 0 });
    });

    test('nested and non-primitive property values are stringified', () => {
        const { mapInfo, posted, attach, fireClick } = loadMapInfo();
        attach();

        fireClick({ lng: 1, lat: 2 }, [
            {
                source: 'overlay-x',
                layer: { id: 'overlay-x-lines' },
                geometry: { type: 'LineString' },
                properties: {
                    tags: ['a', 'b'],
                    meta: { deep: { deeper: true } },
                    count: 3
                }
            }
        ]);

        const sent = posted[0].features as Array<Record<string, unknown>>;
        assert.deepStrictEqual(sent[0].properties, {
            'meta.deep.deeper': true,
            count: 3,
            tags: 'a,b'
        });
    });

    test('feature without layer metadata has no layerName', () => {
        const { mapInfo, posted, attach, fireClick } = loadMapInfo();
        attach();

        fireClick({ lng: 1, lat: 2 }, [
            { source: 's', layer: { id: 'L' }, geometry: { type: 'Point' }, properties: {} }
        ]);

        const sent = posted[0].features as Array<Record<string, unknown>>;
        assert.strictEqual(sent[0].layerName, undefined);
        assert.strictEqual(sent[0].layerId, 'L');
    });
});