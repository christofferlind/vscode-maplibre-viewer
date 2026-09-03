import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

/**
 * Loads resources/scripts/map-basemap.js into a sandboxed context with a
 * mocked MapCore/MapUtils environment and a fake map whose one-shot handlers
 * and isStyleLoaded() state can be driven from the tests.
 */
interface PostedMessage {
    type: string;
    [key: string]: unknown;
}

interface StyleOptions {
    transformStyle?: unknown;
    preserveSources?: boolean;
}

interface RasterSourceDefinition {
    type: string;
    tiles: string[];
    tileSize: number;
    attribution: string;
    minzoom?: number;
    maxzoom?: number;
}

interface FakeStyle {
    version: number;
    sources: Record<string, RasterSourceDefinition>;
    layers: Array<{ id: string; type: string; source: string; minzoom: number; maxzoom: number }>;
}

interface FakeMap {
    getStyle: () => FakeStyle;
    getCenter: () => { lng: number; lat: number };
    getZoom: () => number;
    getBearing: () => number;
    getPitch: () => number;
    setStyle: (style: string | FakeStyle, opts?: StyleOptions) => void;
    jumpTo: (options: Record<string, unknown>) => void;
    once: (event: string, callback: (e?: unknown) => void) => void;
    on: (event: string, callback: (e?: unknown) => void) => void;
    isStyleLoaded: () => boolean;
    remove: () => void;
}

interface TestHarness {
    basemap: Record<string, (...args: unknown[]) => unknown>;
    map: FakeMap;
    posted: PostedMessage[];
    setCurrentStyleUrlCalls: unknown[];
    setStyleCalls: Array<{ style: string | FakeStyle; opts?: StyleOptions }>;
    jumpToCalls: Array<Record<string, unknown>>;
    fireOnce: (event: string) => void;
    onceHandlerCount: (event: string) => number;
    setStyleLoaded: (loaded: boolean) => void;
}

function loadMapBasemap(initialStyleLoaded: boolean): TestHarness {
    const sourcePath = path.join(__dirname, '..', '..', '..', 'resources', 'scripts', 'map-basemap.js');
    const source = fs.readFileSync(sourcePath, 'utf-8');

    const posted: PostedMessage[] = [];
    const onceHandlers = new Map<string, Array<(e?: unknown) => void>>();
    const onHandlers = new Map<string, Array<(e?: unknown) => void>>();
    let styleLoaded = initialStyleLoaded;

    const style: FakeStyle = {
        version: 8,
        sources: {},
        layers: []
    };

    const setStyleCalls: Array<{ style: string | FakeStyle; opts?: StyleOptions }> = [];
    const jumpToCalls: Array<Record<string, unknown>> = [];
    const setCurrentStyleUrlCalls: unknown[] = [];

    const map: FakeMap = {
        getStyle: () => style,
        getCenter: () => ({ lng: 18.07, lat: 59.33 }),
        getZoom: () => 4,
        getBearing: () => 0,
        getPitch: () => 0,
        setStyle: (styleArg, opts) => {
            setStyleCalls.push({ style: styleArg, opts });
        },
        jumpTo: options => {
            jumpToCalls.push(options);
        },
        once: (event, callback) => {
            const handlers = onceHandlers.get(event);
            if (handlers) {
                handlers.push(callback);
            } else {
                onceHandlers.set(event, [callback]);
            }
        },
        on: (event, callback) => {
            const handlers = onHandlers.get(event);
            if (handlers) {
                handlers.push(callback);
            } else {
                onHandlers.set(event, [callback]);
            }
        },
        isStyleLoaded: () => styleLoaded,
        remove: () => undefined
    };

    const windowObj: Record<string, unknown> = {
        MapCore: {
            isMapReady: () => true,
            isMapLoaded: () => true,
            getCurrentStyleUrl: () => null,
            setCurrentStyleUrl: (styleUrl: unknown) => {
                setCurrentStyleUrlCalls.push(styleUrl);
            },
            getMap: () => map
        },
        MapUtils: {
            withMap: (callback: (m: FakeMap) => void) => {
                callback(map);
                return true;
            },
            createViewState: () => null
        }
    };
    windowObj.window = windowObj;

    const context: Record<string, unknown> = {
        window: windowObj,
        console,
        // hideErrorOverlay is defined in map-ui.js and called directly by map-basemap.js
        hideErrorOverlay: () => undefined,
        vscode: {
            postMessage: (msg: PostedMessage) => {
                posted.push(msg);
            }
        }
    };

    vm.runInNewContext(source, context);

    const basemap = windowObj.MapBasemap as Record<string, (...args: unknown[]) => unknown>;

    return {
        basemap,
        map,
        posted,
        setCurrentStyleUrlCalls,
        setStyleCalls,
        jumpToCalls,
        fireOnce: (event: string) => {
            const handlers = onceHandlers.get(event);
            if (!handlers) {
                return;
            }
            onceHandlers.set(event, []);
            handlers.forEach(handler => handler());
        },
        onceHandlerCount: (event: string) => {
            const handlers = onceHandlers.get(event);
            if (!handlers) {
                return 0;
            }
            return handlers.length;
        },
        setStyleLoaded: (loaded: boolean) => {
            styleLoaded = loaded;
        }
    };
}

suite('MapBasemap mapReady style loading', () => {

    suite('updateMapStyle', () => {
        test('posts mapReady synchronously when style is already loaded', () => {
            const harness = loadMapBasemap(true);

            harness.basemap.updateMapStyle('https://example.com/style.json');

            assert.strictEqual(harness.posted.length, 1, 'Should post exactly one message');
            assert.strictEqual(harness.posted[0].type, 'mapReady');
            assert.strictEqual(harness.onceHandlerCount('styledata'), 0, 'No styledata handler needed when style is loaded');
        });

        test('does not post mapReady while style is still loading', () => {
            const harness = loadMapBasemap(false);

            harness.basemap.updateMapStyle('https://example.com/style.json');

            assert.strictEqual(harness.posted.length, 0, 'No mapReady before style is loaded');
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

        test('stores the new style URL via setCurrentStyleUrl before posting mapReady', () => {
            const harness = loadMapBasemap(true);

            harness.basemap.updateMapStyle('https://example.com/style.json');

            assert.deepStrictEqual(harness.setCurrentStyleUrlCalls, ['https://example.com/style.json']);
        });

        test('passes the new style URL and transformStyle options to setStyle', () => {
            const harness = loadMapBasemap(true);

            harness.basemap.updateMapStyle('https://example.com/style.json');

            assert.strictEqual(harness.setStyleCalls.length, 1);
            assert.strictEqual(harness.setStyleCalls[0].style, 'https://example.com/style.json');
            assert.strictEqual(harness.setStyleCalls[0].opts?.preserveSources, true);
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

        test('posts mapReady synchronously when style is already loaded', () => {
            const harness = loadMapBasemap(true);

            harness.basemap.updateBasemap(rasterBasemap);

            assert.strictEqual(harness.posted.length, 1, 'Should post exactly one message');
            assert.strictEqual(harness.posted[0].type, 'mapReady');
        });

        test('posts exactly one mapReady after styledata fires once', () => {
            const harness = loadMapBasemap(false);

            harness.basemap.updateBasemap(rasterBasemap);

            harness.setStyleLoaded(true);
            harness.fireOnce('styledata');

            assert.strictEqual(harness.posted.length, 1, 'Exactly one mapReady after styledata');
            assert.strictEqual(harness.posted[0].type, 'mapReady');
        });

        test('firing styledata twice does not post mapReady twice', () => {
            const harness = loadMapBasemap(false);

            harness.basemap.updateBasemap(rasterBasemap);

            harness.setStyleLoaded(true);
            harness.fireOnce('styledata');
            harness.fireOnce('styledata');

            assert.strictEqual(harness.posted.length, 1, 'mapReady must be idempotent per style change');
        });

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