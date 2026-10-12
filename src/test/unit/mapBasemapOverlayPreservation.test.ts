import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

import { loadMapBasemap } from '../testUtils/mapBasemapHarness';

/**
 * Loads the real map-utils.js so the shared overlay predicate is tested
 * against the module both map-overlays.js and map-basemap.js consume.
 */
function loadMapUtils(): Record<string, (...args: unknown[]) => unknown> {
    const sourcePath = path.join(__dirname, '..', '..', '..', 'resources', 'scripts', 'map-utils.js');
    const source = fs.readFileSync(sourcePath, 'utf-8');
    const windowObj: Record<string, unknown> = {};
    windowObj.window = windowObj;
    const context: Record<string, unknown> = { window: windowObj, console };
    vm.runInNewContext(source, context);
    return windowObj.MapUtils as Record<string, (...args: unknown[]) => unknown>;
}

/**
 * Tests for the transformStyle overlay preservation across basemap switches:
 * mergeOverlayStyleIntoNext carries overlay sources/layers from the previous
 * style into the next one. Without the merge, MapLibre v6 computes a style
 * diff between the previous and the next style and strips every overlay layer
 * the moment the new basemap commits, so enabled overlays disappear until the
 * mapReady resync lands (or forever if mapReady is never posted).
 */

const TEST_GEOJSON_SOURCE = {
    type: 'geojson',
    data: {
        type: 'FeatureCollection',
        features: [
            {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [18.07, 59.33] },
                properties: {}
            }
        ]
    }
};

function previousStyleWithOverlays(overlayLayerIds: string[]): object {
    const sources: Record<string, unknown> = {
        'base-source': { type: 'vector', url: 'https://example.com/tiles.json' }
    };
    const layers: Array<Record<string, unknown>> = [
        { id: 'background', type: 'background' },
        { id: 'base-layer', type: 'fill', source: 'base-source' }
    ];
    for (const overlayId of overlayLayerIds) {
        const sourceId = 'overlay-' + overlayId;
        sources[sourceId] = TEST_GEOJSON_SOURCE;
        layers.push(
            { id: sourceId + '-circles', type: 'circle', source: sourceId },
            { id: sourceId + '-lines', type: 'line', source: sourceId },
            { id: sourceId + '-fills', type: 'fill', source: sourceId }
        );
    }
    return {
        version: 8,
        sources,
        layers
    };
}

function nextStyle(): object {
    return {
        version: 8,
        sources: {
            'new-base-source': { type: 'vector', url: 'https://example.com/new-tiles.json' }
        },
        layers: [
            { id: 'background', type: 'background' },
            { id: 'new-base-layer', type: 'fill', source: 'new-base-source' }
        ]
    };
}

type MergeFn = (previousStyle: unknown, nextStyle: unknown) => Record<string, unknown>;

function mergedLayerIds(merged: Record<string, unknown>): string[] {
    return (merged.layers as Array<{ id: string }>).map((layer) => layer.id);
}

suite('MapBasemap overlay preservation across basemap switches', () => {
    test('mergeOverlayStyleIntoNext carries overlay sources and layers into the next style', () => {
        const harness = loadMapBasemap(true);
        const merge = harness.basemap.mergeOverlayStyleIntoNext as MergeFn;

        const previous = previousStyleWithOverlays(['poi']);
        const next = nextStyle();
        const merged = merge(previous, next);

        const mergedSources = merged.sources as Record<string, unknown>;
        assert.strictEqual(mergedSources['new-base-source'] !== undefined, true, 'new basemap sources must be kept');
        assert.strictEqual(mergedSources['overlay-poi'] !== undefined, true, 'overlay source must survive the switch');

        const ids = mergedLayerIds(merged);
        assert.strictEqual(ids.includes('new-base-layer'), true, 'new basemap layers must be kept');
        for (const suffix of ['-circles', '-lines', '-fills']) {
            assert.strictEqual(ids.includes('overlay-poi' + suffix), true,
                'overlay layer ' + suffix + ' must survive the switch');
        }
        // Overlays must be appended after the new basemap layers so they render on top
        const lastLayer = (merged.layers as Array<{ id: string }>)[(merged.layers as unknown[]).length - 1];
        assert.strictEqual(typeof lastLayer.id === 'string' && lastLayer.id.indexOf('overlay-') === 0, true,
            'overlay layers must be appended at the end so they render on top');
    });

    test('mergeOverlayStyleIntoNext returns the next style untouched when there are no overlays', () => {
        const harness = loadMapBasemap(true);
        const merge = harness.basemap.mergeOverlayStyleIntoNext as (previousStyle: unknown, nextStyle: unknown) => unknown;

        const next = nextStyle();
        assert.strictEqual(merge({ version: 8, sources: {}, layers: [] }, next), next, 'must return identical object');
        assert.strictEqual(merge(undefined, next), next, 'must tolerate a missing previous style');
    });

    test('mergeOverlayStyleIntoNext keeps non-overlay basemap layers from leaking into the next style', () => {
        const harness = loadMapBasemap(true);
        const merge = harness.basemap.mergeOverlayStyleIntoNext as MergeFn;

        const previous = previousStyleWithOverlays(['poi']);
        const next = nextStyle();
        const merged = merge(previous, next);

        const ids = mergedLayerIds(merged);
        assert.strictEqual(ids.includes('base-layer'), false,
            'old basemap layers must not be carried into the new style');
        assert.strictEqual(ids.filter((id) => id === 'background').length, 1,
            'the next style background must appear exactly once');
    });

    test('updateMapStyle passes the merging transformStyle to setStyle', () => {
        const harness = loadMapBasemap(true);

        harness.basemap.updateMapStyle('https://example.com/new-style.json');

        assert.strictEqual(harness.setStyleCalls.length, 1);
        const transform = harness.setStyleCalls[0].opts?.transformStyle as
            (previousStyle: unknown, nextStyle: unknown) => Record<string, unknown>;
        assert.strictEqual(typeof transform, 'function', 'transformStyle callback must be kept');

        const merged = transform(previousStyleWithOverlays(['poi']), nextStyle());
        assert.strictEqual(mergedLayerIds(merged).includes('overlay-poi-circles'), true,
            'basemap style switch must keep overlay layers');
    });

    test('updateBasemap with a raster basemap passes the merging transformStyle to setStyle', () => {
        const harness = loadMapBasemap(true);

        harness.basemap.updateBasemap({
            id: 'osm',
            name: 'OSM',
            type: 'raster',
            tileUrl: 'https://tile.example.com/{z}/{x}/{y}.png'
        });

        assert.strictEqual(harness.setStyleCalls.length, 1);
        const transform = harness.setStyleCalls[0].opts?.transformStyle as
            (previousStyle: unknown, nextStyle: unknown) => Record<string, unknown>;
        assert.strictEqual(typeof transform, 'function', 'transformStyle callback must be kept');

        const merged = transform(previousStyleWithOverlays(['poi']), nextStyle());
        assert.strictEqual(mergedLayerIds(merged).includes('overlay-poi-circles'), true,
            'raster basemap switch must keep overlay layers');
    });

    test('a source outside the overlay family is not carried into the next style', () => {
        const harness = loadMapBasemap(true);
        const merge = harness.basemap.mergeOverlayStyleIntoNext as MergeFn;

        const previous = {
            version: 8,
            sources: {
                'terrain-3d': { type: 'raster-dem', url: 'https://example.com/dem.json' }
            },
            layers: [
                { id: 'hillshade-3d', type: 'hillshade', source: 'terrain-3d' }
            ]
        };
        const next = nextStyle();
        const merged = merge(previous, next);

        const mergedSources = merged.sources as Record<string, unknown>;
        assert.strictEqual(mergedSources['terrain-3d'] === undefined, true,
            'non-overlay sources must not leak into the new style');
        assert.strictEqual((merged.layers as unknown[]).length,
            (nextStyle() as { layers: unknown[] }).layers.length,
            'no layers must be appended when there are no overlay layers');
    });

    test('merge tolerates layers whose source is an inline source object', () => {
        const harness = loadMapBasemap(true);
        const merge = harness.basemap.mergeOverlayStyleIntoNext as MergeFn;

        const previous = {
            version: 8,
            sources: {},
            layers: [
                { id: 'inline', type: 'circle', source: { type: 'geojson', data: TEST_GEOJSON_SOURCE.data } }
            ]
        };
        const next = nextStyle();
        const merged = merge(previous, next);

        assert.strictEqual((merged.layers as unknown[]).length,
            (nextStyle() as { layers: unknown[] }).layers.length,
            'inline-source layers without an overlay prefix must not be appended');
    });
});

suite('shared overlay predicate', () => {
    test('isOverlayLayer and isOverlaySourceId use the overlay- prefix on string sources', () => {
        const utils = loadMapUtils();
        assert.strictEqual(utils.isOverlaySourceId('overlay-poi'), true, 'overlay source id must match');
        assert.strictEqual(utils.isOverlaySourceId('base-source'), false, 'non-overlay id must not match');
        assert.strictEqual(utils.isOverlaySourceId({ type: 'geojson' }), false, 'object sources must not match');
        assert.strictEqual(utils.isOverlaySourceId(undefined), false, 'undefined must not match');

        assert.strictEqual(utils.isOverlayLayer({ id: 'overlay-poi-circles', source: 'overlay-poi' }), true,
            'overlay layer must match');
        assert.strictEqual(utils.isOverlayLayer({ id: 'base-layer', source: 'base-source' }), false,
            'base layer must not match');
        assert.strictEqual(utils.isOverlayLayer({ id: 'inline', source: { type: 'geojson' } }), false,
            'inline source object must not match');
        assert.strictEqual(utils.isOverlayLayer(undefined), false, 'missing layer must not match');
    });
});