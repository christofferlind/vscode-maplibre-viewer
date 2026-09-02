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
}

interface MockMap {
    getStyle: () => { layers: MockStyleLayer[] };
    getLayer: () => boolean;
    getSource: (id: string) => boolean;
    addSource: () => void;
    removeLayer: () => void;
    removeSource: () => void;
    addLayer: (layer: MockStyleLayer) => void;
    setLayoutProperty: () => void;
    setData: () => void;
}

function loadMapOverlays() {
    const sourcePath = path.join(__dirname, '..', '..', '..', 'resources', 'scripts', 'map-overlays.js');
    const source = fs.readFileSync(sourcePath, 'utf-8');

    const style: { layers: MockStyleLayer[] } = { layers: [] };
    const map: MockMap = {
        getStyle: () => style,
        getLayer: () => false,
        getSource: (id: string) => style.layers.some(l => l.source === id),
        addSource: () => undefined,
        removeLayer: () => undefined,
        removeSource: () => undefined,
        addLayer: layer => { style.layers.push(layer); },
        setLayoutProperty: () => undefined,
        setData: () => undefined
    };

    const windowObj: Record<string, unknown> = {
        MapCore: {
            isMapReady: () => true,
            getMap: () => map
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
});
