import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

/**
 * Loads the map-overlays.js classic script into a sandboxed context with a
 * mocked MapCore/MapUtils environment and returns window.MapOverlays plus a
 * fake map instance to drive syncAllOverlays through updateOverlayLayers.
 */
interface MockStyleLayer {
    id: string;
    source: string;
    type?: string;
}

interface MockMap {
    getStyle: () => { layers: MockStyleLayer[]; sources?: Record<string, unknown> };
    getLayer: () => boolean;
    getSource: (id: string) => boolean;
    addSource: (id: string, source: Record<string, unknown>) => void;
    removeLayer: () => void;
    removeSource: () => void;
    addLayer: (layer: MockStyleLayer) => void;
    setLayoutProperty: () => void;
    setData: () => void;
}

function loadMapOverlays() {
    const sourcePath = path.join(__dirname, '..', '..', '..', 'resources', 'scripts', 'map-overlays.js');
    const source = fs.readFileSync(sourcePath, 'utf-8');

    const style: { layers: MockStyleLayer[]; sources: Record<string, unknown> } = { layers: [], sources: {} };
    const addedSources: Record<string, Record<string, unknown>> = {};
    const map: MockMap = {
        getStyle: () => style,
        getLayer: () => false,
        getSource: (id: string) => style.layers.some(l => l.source === id),
        addSource: (id, sourceDef) => { addedSources[id] = sourceDef; },
        removeLayer: () => undefined,
        removeSource: () => undefined,
        addLayer: layer => { style.layers.push(layer); },
        setLayoutProperty: () => undefined,
        setData: () => undefined
    };
    (map as unknown as { __addedSources: Record<string, Record<string, unknown>> }).__addedSources = addedSources;
    (map as unknown as { __style: typeof style }).__style = style;

    const windowObj: Record<string, unknown> = {
        MapCore: {
            isMapReady: () => true,
            isMapStyleLoaded: () => true,
            getMap: () => map,
            queueOperation: (op: () => void) => op()
        },
        MapUtils: {
            withMap: (callback: (m: MockMap) => void) => {
                callback(map);
                return true;
            },
            createGeoJsonLayerDefinitions: (sourceId: string) => ({
                circle: { id: sourceId + '-circles', type: 'circle', source: sourceId },
                line: { id: sourceId + '-lines', type: 'line', source: sourceId },
                fill: { id: sourceId + '-fills', type: 'fill', source: sourceId }
            })
        }
    };
    const context: Record<string, unknown> = {
        window: windowObj,
        console,
        maplibregl: {}
    };

    vm.runInNewContext(source, context);
    return { overlays: windowObj.MapOverlays as Record<string, unknown>, map };
}

suite('MapOverlays Test API', () => {
    const layer = (id: string, visible = true) => ({
        id,
        name: id,
        type: 'geojson',
        visible,
        color: '#FF0000',
        source: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } }
    });

    suite('addedOverlayLayers tracking', () => {
        test('getOverlayLayers returns the layers sent in the last update', () => {
            const { overlays } = loadMapOverlays();
            const update = (overlays as { updateOverlayLayers: (l: unknown[]) => void }).updateOverlayLayers;
            update([layer('one'), layer('two')]);

            const tracked = (overlays as { addedOverlayLayers: Record<string, unknown> }).addedOverlayLayers;
            assert.ok(tracked.one, 'Should track layer "one"');
            assert.ok(tracked.two, 'Should track layer "two"');
        });

        test('addedOverlayLayers is reset on a fresh update with no layers', () => {
            const { overlays } = loadMapOverlays();
            const update = (overlays as { updateOverlayLayers: (l: unknown[]) => void }).updateOverlayLayers;
            update([layer('one')]);
            update([]);

            const tracked = (overlays as { addedOverlayLayers: Record<string, unknown> }).addedOverlayLayers;
            assert.deepStrictEqual(Object.keys(tracked).length, 0, 'Tracked layers should be cleared');
        });

        test('addedOverlayLayers reference stays live across updates', () => {
            const { overlays } = loadMapOverlays();
            const update = (overlays as { updateOverlayLayers: (l: unknown[]) => void }).updateOverlayLayers;
            const tracked = (overlays as { addedOverlayLayers: Record<string, unknown> }).addedOverlayLayers;

            update([layer('a')]);
            assert.ok(tracked.a, 'Exported reference should see first update');

            update([layer('b')]);
            assert.ok(tracked.b, 'Exported reference should see second update');
            assert.ok(!tracked.a, 'Exported reference should not see stale layer');
        });
    });

    suite('isOverlayLayerOnMap', () => {
        test('returns true when the layer was synced onto the map', () => {
            const { overlays } = loadMapOverlays();
            const update = (overlays as { updateOverlayLayers: (l: unknown[]) => void }).updateOverlayLayers;
            update([layer('geo')]);

            const isOnMap = (overlays as { isOverlayLayerOnMap: (id: string) => boolean }).isOverlayLayerOnMap;
            assert.strictEqual(isOnMap('geo'), true);
        });

        test('returns false for a layer that was never added', () => {
            const { overlays } = loadMapOverlays();
            const isOnMap = (overlays as { isOverlayLayerOnMap: (id: string) => boolean }).isOverlayLayerOnMap;
            assert.strictEqual(isOnMap('missing'), false);
        });

        test('returns false when no map is initialized', () => {
            const sourcePath = path.join(__dirname, '..', '..', '..', 'resources', 'scripts', 'map-overlays.js');
            const source = fs.readFileSync(sourcePath, 'utf-8');
            const windowObj: Record<string, unknown> = {
                MapCore: { isMapReady: () => true, getMap: () => null },
                MapUtils: { withMap: () => false }
            };
            const context: Record<string, unknown> = { window: windowObj, console, maplibregl: {} };
            vm.runInNewContext(source, context);

            const overlays = windowObj.MapOverlays as { isOverlayLayerOnMap: (id: string) => boolean };
            assert.strictEqual(overlays.isOverlayLayerOnMap('any'), false);
        });
    });

    suite('raster overlay source construction (bug fix)', () => {
        test('raster overlay source uses tiles array instead of url', () => {
            const { overlays, map } = loadMapOverlays();
            const update = (overlays as { updateOverlayLayers: (l: unknown[]) => void }).updateOverlayLayers;
            update([{
                id: 'raster-one',
                name: 'Raster',
                type: 'raster',
                visible: true,
                source: { type: 'raster', url: 'https://example.com/{z}/{x}/{y}.png', tileSize: 256, attribution: 'Example' }
            }]);

            const addedSources = (map as unknown as { __addedSources: Record<string, Record<string, unknown>> }).__addedSources;
            const rasterSource = addedSources['overlay-raster-one'];
            assert.ok(rasterSource, 'raster source should be added');
            assert.ok(Array.isArray(rasterSource.tiles), 'tile URL template must use a tiles array');
            assert.deepStrictEqual([...(rasterSource.tiles as string[])], ['https://example.com/{z}/{x}/{y}.png']);
            assert.strictEqual(rasterSource.url, undefined, 'url must not be used for tile templates');
            assert.strictEqual(rasterSource.attribution, 'Example');
        });

        test('vector overlay without source-layer removes its source instead of leaving it dangling', () => {
            const { overlays, map } = loadMapOverlays();
            let removeSourceCalls: string[] = [];
            (map as unknown as { removeSource: (id: string) => void }).removeSource = (id: string) => {
                removeSourceCalls.push(id);
            };
            const update = (overlays as { updateOverlayLayers: (l: unknown[]) => void }).updateOverlayLayers;
            update([{
                id: 'vector-one',
                name: 'Vector',
                type: 'vector',
                visible: true,
                source: { type: 'vector', url: 'https://example.com/tiles.json' }
            }]);

            assert.deepStrictEqual(removeSourceCalls, ['overlay-vector-one'], 'dangling vector source must be removed');
        });

        test('vector overlay with source-layer adds a fill layer', () => {
            const { overlays, map } = loadMapOverlays();
            const update = (overlays as { updateOverlayLayers: (l: unknown[]) => void }).updateOverlayLayers;
            update([{
                id: 'vector-two',
                name: 'Vector',
                type: 'vector',
                visible: true,
                source: { type: 'vector', url: 'https://example.com/tiles.json', sourceLayer: 'buildings' }
            }]);

            const style = (map as unknown as { __style: { layers: MockStyleLayer[] } }).__style;
            const vectorLayer = style.layers.find(l => l.id === 'overlay-vector-two');
            assert.ok(vectorLayer, 'vector layer should be created');
        });
    });
});
