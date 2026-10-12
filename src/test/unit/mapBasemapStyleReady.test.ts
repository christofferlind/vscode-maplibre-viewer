import * as assert from 'assert';

import { loadMapBasemap, FakeStyle } from '../testUtils/mapBasemapHarness';

suite('MapBasemap mapReady style loading', () => {

    suite('updateMapStyle', () => {
        test('does not post mapReady synchronously after setStyle on a loaded style', () => {
            const harness = loadMapBasemap(true);

            harness.basemap.updateMapStyle('https://example.com/style.json');

            // Real MapLibre flips isStyleLoaded() to false when setStyle is
            // called; without the event gate the synchronous path would have
            // posted mapReady against the stale style.
            assert.strictEqual(harness.posted.length, 0, 'No mapReady synchronously after setStyle');
            assert.strictEqual(harness.onceHandlerCount('styledata'), 1, 'Waits for styledata after setStyle');
        });

        test('does not post mapReady while style is still loading', () => {
            const harness = loadMapBasemap(false);

            harness.basemap.updateMapStyle('https://example.com/style.json');

            assert.strictEqual(harness.posted.length, 0, 'No mapReady before style is loaded');
        });

        test('posts mapReady when the first post-setStyle styledata fires and the new style is loaded', () => {
            const harness = loadMapBasemap(true);

            harness.basemap.updateMapStyle('https://example.com/style.json');

            harness.setStyleLoaded(true);
            harness.fireOnce('styledata');

            assert.strictEqual(harness.posted.length, 1, 'Exactly one mapReady after styledata');
            assert.strictEqual(harness.posted[0].type, 'mapReady');
        });

        test('does not trust isStyleLoaded() before the first post-setStyle style event', () => {
            const harness = loadMapBasemap(true);

            // Even if the map still reported the old style as loaded right
            // after setStyle (as MapLibre can briefly do), mapReady must wait
            // for an actual style event.
            harness.basemap.updateMapStyle('https://example.com/style.json');

            assert.strictEqual(harness.posted.length, 0, 'No mapReady without a post-setStyle style event');

            harness.setStyleLoaded(true);
            harness.fireOnce('styledata');

            assert.strictEqual(harness.posted.length, 1, 'mapReady only after the new style actually loaded');
        });

        test('posts exactly one mapReady after styledata fires once', () => {
            const harness = loadMapBasemap(false);

            harness.basemap.updateMapStyle('https://example.com/style.json');

            harness.setStyleLoaded(true);
            harness.fireOnce('styledata');

            assert.strictEqual(harness.posted.length, 1, 'Exactly one mapReady after styledata');
            assert.strictEqual(harness.posted[0].type, 'mapReady');
        });

        test('firing styledata twice does not post mapReady twice', () => {
            const harness = loadMapBasemap(false);

            harness.basemap.updateMapStyle('https://example.com/style.json');

            harness.setStyleLoaded(true);
            harness.fireOnce('styledata');
            harness.fireOnce('styledata');

            assert.strictEqual(harness.posted.length, 1, 'mapReady must be idempotent per style change');
        });

        test('posts mapReady via the load event when styledata never fires', () => {
            const harness = loadMapBasemap(false);

            harness.basemap.updateMapStyle('https://example.com/style.json');

            harness.setStyleLoaded(true);
            harness.fireOnce('load');

            assert.strictEqual(harness.posted.length, 1, 'Exactly one mapReady via the load guard');
            assert.strictEqual(harness.posted[0].type, 'mapReady');
        });

        test('a styledata event while the new style is still loading does not leak handlers', () => {
            const harness = loadMapBasemap(false);

            harness.basemap.updateMapStyle('https://example.com/style.json');

            // First styledata arrives before the new style is ready; the
            // loop must re-arm itself and eventually post mapReady
            harness.fireOnce('styledata');
            harness.setStyleLoaded(true);
            harness.fireOnce('styledata');

            assert.strictEqual(harness.posted.length, 1, 'Exactly one mapReady after the style finally loads');
        });

        test('isStyleLoaded() reporting true before a style event does not commit the tracked URL', () => {
            const harness = loadMapBasemap(true);

            // The style may still report loaded from the previous style right
            // after setStyle; the tracked URL must only advance on an actual
            // post-setStyle style event.
            harness.basemap.updateMapStyle('https://example.com/style.json');

            assert.strictEqual(harness.setCurrentStyleUrlCalls.length, 0, 'No commit before a style event');

            harness.setStyleLoaded(true);
            harness.fireOnce('styledata');

            assert.strictEqual(harness.setCurrentStyleUrlCalls.length, 1, 'Commit once the style is applied');
        });

        test('stores the new style URL when the new style is applied (deferred commit)', () => {
            const harness = loadMapBasemap(true);

            harness.basemap.updateMapStyle('https://example.com/style.json');
            assert.strictEqual(harness.trackedStyleUrl(), null, 'Tracked URL is not committed synchronously');

            harness.setStyleLoaded(true);
            harness.fireOnce('styledata');

            assert.deepStrictEqual(harness.setCurrentStyleUrlCalls, ['https://example.com/style.json']);
            assert.strictEqual(harness.trackedStyleUrl(), 'https://example.com/style.json');
        });

        test('failed style load does not commit the tracked URL and a retry re-issues setStyle', () => {
            const harness = loadMapBasemap(true);

            // First switch: style fetch fails, the style never applies
            harness.basemap.updateMapStyle('https://example.com/failed.json');
            assert.strictEqual(harness.setCurrentStyleUrlCalls.length, 0);

            // Re-selecting the failed basemap re-issues setStyle (tracker was
            // never committed and still points at the rendered style)
            harness.basemap.updateMapStyle('https://example.com/failed.json');

            assert.strictEqual(harness.setStyleCalls.length, 2, 'Re-selection after a failed load must not be skipped');
        });

        test('re-selecting an already applied style while a newer load is in flight is not skipped', () => {
            const harness = loadMapBasemap(true);

            harness.basemap.updateMapStyle('https://example.com/b.json');
            harness.setStyleLoaded(true);
            harness.fireOnce('styledata');

            // A switch to C that never completes (e.g. fetch failure)
            harness.setStyleLoaded(false);
            harness.basemap.updateMapStyle('https://example.com/c.json');

            // While C is still loading, re-selecting C must not be turned
            // into a no-op by the tracker state of B
            harness.basemap.updateMapStyle('https://example.com/c.json');

            assert.strictEqual(harness.setStyleCalls.length, 3, 'The in-flight reload must re-issue setStyle');
        });

        test('a superseded style load does not commit a stale tracked URL', () => {
            const harness = loadMapBasemap(true);

            harness.basemap.updateMapStyle('https://example.com/b.json');
            harness.setStyleLoaded(false);
            harness.basemap.updateMapStyle('https://example.com/c.json');

            // B's setStyle completed first; C has superseded it
            harness.setStyleLoaded(true);
            harness.fireOnce('styledata');

            assert.strictEqual(harness.trackedStyleUrl(), 'https://example.com/c.json',
                'Only the latest request commits the tracked URL');
        });

        test('passes the new style URL and transformStyle options to setStyle', () => {
            const harness = loadMapBasemap(true);

            harness.basemap.updateMapStyle('https://example.com/style.json');

            assert.strictEqual(harness.setStyleCalls.length, 1);
            assert.strictEqual(harness.setStyleCalls[0].style, 'https://example.com/style.json');
            assert.strictEqual(harness.setStyleCalls[0].opts?.preserveSources, undefined, 'preserveSources is not a real setStyle option and must not be passed');
            assert.ok(harness.setStyleCalls[0].opts?.transformStyle, 'transformStyle callback must be kept');
        });

        test('jumpTo is still called to preserve the view state', () => {
            const harness = loadMapBasemap(true);

            harness.basemap.updateMapStyle('https://example.com/style.json');

            assert.strictEqual(harness.jumpToCalls.length, 1);
            assert.deepStrictEqual(harness.jumpToCalls[0].center, { lng: 18.07, lat: 59.33 });
            assert.strictEqual(harness.jumpToCalls[0].zoom, 4);
        });
    });

    suite('updateBasemap with raster basemap', () => {
        const rasterBasemap = {
            id: 'r1',
            name: 'R',
            type: 'raster',
            tileUrl: 'https://example.com/{z}/{x}/{y}.png'
        };

        test('passes an inline raster style object to setStyle', () => {
            const harness = loadMapBasemap(true);

            harness.basemap.updateBasemap(rasterBasemap);

            assert.strictEqual(harness.setStyleCalls.length, 1);
            const styleArg = harness.setStyleCalls[0].style;
            assert.strictEqual(typeof styleArg, 'object', 'Raster basemaps must use an inline style object');

            const inlineStyle = styleArg as FakeStyle;
            const source = inlineStyle.sources['raster-basemap'];
            assert.ok(source, 'Should contain the raster-basemap source');
            assert.strictEqual(source.type, 'raster');
            assert.deepStrictEqual(source.tiles.length, 1, 'Should have one tile URL');
            assert.strictEqual(source.tiles[0], 'https://example.com/{z}/{x}/{y}.png');
            assert.strictEqual(source.tileSize, 256);
            assert.ok(inlineStyle.layers.some(l => l.id === 'raster-layer' && l.type === 'raster'));
            assert.strictEqual(harness.setCurrentStyleUrlCalls[0], null, 'Raster basemaps clear the stored style URL');
        });

        test('delegates vector style basemaps to updateMapStyle behavior', () => {
            const harness = loadMapBasemap(false);

            harness.basemap.updateBasemap({ id: 'v1', name: 'V', type: 'vector', styleUrl: 'https://example.com/vector.json' });

            harness.setStyleLoaded(true);
            harness.fireOnce('styledata');

            assert.strictEqual(harness.setStyleCalls[0].style, 'https://example.com/vector.json');
            assert.strictEqual(harness.posted.length, 1, 'Exactly one mapReady after styledata');
            assert.strictEqual(harness.posted[0].type, 'mapReady');
        });
    });
});