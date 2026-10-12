import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

/**
 * Loads resources/scripts/map-core.js into a sandboxed context with a fake
 * MapLibre map whose style-load state and events can be driven from tests.
 */

interface PostedMessage {
    type: string;
    [key: string]: unknown;
}

export interface Harness {
    core: Record<string, (...args: unknown[]) => unknown>;
    posted: PostedMessage[];
    setStyleLoaded: (loaded: boolean) => void;
    setSymbolLayers: (layers: Array<{ id: string; type: string }>) => void;
    fireMapEvent: (event: string, data?: unknown) => void;
    getTerrainState: () => { terrainSource?: string; terrainControlSource?: string; addedSourceIds: string[]; hillshadeLayerBefore?: string | null };
    addedControls: Array<{ source?: string; globe?: boolean }>;
    pendingCount: () => number;
    flushTimers: () => Promise<void>;
    advanceTime: (ms: number) => Promise<void>;
}

interface HarnessOptions {
    globeControl?: boolean;
}

function createHarness(options?: HarnessOptions): Harness {
    const sourcePath = path.join(__dirname, '..', '..', '..', 'resources', 'scripts', 'map-core.js');
    const source = fs.readFileSync(sourcePath, 'utf-8');

    const posted: PostedMessage[] = [];
    const styleLayers: Array<{ id: string; source?: string }> = [];
    let styleLoaded = false;
    let mapInstance: Record<string, unknown> | null = null;
    const eventHandlers = new Map<string, Array<(e?: unknown) => void>>();
    let terrainState: { sourceId?: string } = { };
    const addedSources = new Map<string, unknown>();
    const addedControls: Array<{ source?: string; globe?: boolean }> = [];
    const addedLayers = new Map<string, unknown>();
    let styleLayerIds: Array<{ id: string; type: string }> = [];
    const sandboxTimers: Array<{ fn: () => void; id: number; cancelled: boolean }> = [];
    let timerId = 0;

    function createMap(): Record<string, unknown> {
        const handlers = eventHandlers;
        return {
            addControl: (control: { source?: string }) => {
                addedControls.push(control);
            },
            removeControl: (control: { source?: string }) => {
                const index = addedControls.indexOf(control);
                if (index !== -1) {
                    addedControls.splice(index, 1);
                }
            },
            on: (event: string, handler: (e?: unknown) => void) => {
                const list = handlers.get(event) ?? [];
                list.push(handler);
                handlers.set(event, list);
            },
            once: (event: string, handler: (e?: unknown) => void) => {
                const list = handlers.get(event) ?? [];
                list.push(handler);
                handlers.set(event, list);
            },
            isStyleLoaded: () => styleLoaded,
            getTerrain: () => (terrainState.sourceId !== undefined ? { source: terrainState.sourceId } : null),
            setTerrain: (terrain: { source: string } | null) => {
                terrainState = terrain ? { sourceId: terrain.source } : { };
            },
            getSource: (id: string) => addedSources.get(id),
            addSource: (id: string, spec: unknown) => {
                addedSources.set(id, spec);
            },
            getLayer: (id: string) => addedLayers.get(id),
            addLayer: (layer: { id: string }, before?: string) => {
                addedLayers.set(layer.id, { before: before ?? null });
            },
            removeLayer: (id: string) => {
                addedLayers.delete(id);
            },
            removeSource: (id: string) => {
                addedSources.delete(id);
            },
            getStyle: () => ({ layers: styleLayerIds }),
            getCanvas: () => ({ setAttribute: () => undefined })
        };
    }

    const windowObj: Record<string, unknown> = {
        addEventListener: () => undefined
    };
    windowObj.window = windowObj;
    windowObj.maplibregl = {
        Map: function () {
            mapInstance = createMap();
            return mapInstance;
        },
        NavigationControl: function () {
            return {};
        },
        TerrainControl: function (options: { source?: string }) {
            return { source: options ? options.source : undefined };
        }
    };
    if (options?.globeControl) {
        (windowObj.maplibregl as Record<string, unknown>).GlobeControl = function () {
            return { globe: true };
        };
    }

    const context: Record<string, unknown> = {
        window: windowObj,
        console,
        maplibregl: windowObj.maplibregl,
        setTimeout: (fn: () => void, _ms?: number) => {
            // Execute immediately so the test observes the coalesced result
            fn();
            timerId++;
            sandboxTimers.push({ fn, id: timerId, cancelled: true });
            return timerId;
        },
        clearTimeout: (id: number) => {
            const timer = sandboxTimers.find((t) => t.id === id);
            if (timer) {
                timer.cancelled = true;
            }
        },
        document: {
            addEventListener: () => undefined,
            getElementById: () => ({ style: {} })
        },
        showErrorOverlay: () => undefined,
        hideErrorOverlay: () => undefined,
        vscode: {
            postMessage: (msg: PostedMessage) => {
                posted.push(msg);
            }
        }
    };

    vm.runInNewContext(source, context);

    const core = windowObj.MapCore as Record<string, (...args: unknown[]) => unknown>;

    return {
        core,
        posted,
        addedControls,
        setStyleLoaded: (loaded: boolean) => {
            styleLoaded = loaded;
        },
        setSymbolLayers: (layers: Array<{ id: string; type: string }>) => {
            styleLayerIds = layers;
        },
        fireMapEvent: (event: string, data?: unknown) => {
            (eventHandlers.get(event) ?? []).forEach((handler) => handler(data));
        },
        getTerrainState: () => ({
            terrainSource: terrainState.sourceId,
            terrainControlSource: addedControls.map((c) => c.source).find((s) => s !== undefined),
            addedSourceIds: Array.from(addedSources.keys()),
            hillshadeLayerBefore: addedLayers.has('hillshade-3d')
                ? ((addedLayers.get('hillshade-3d') as { before?: string | null }).before ?? undefined)
                : undefined
        }),
        pendingCount: () => {
            // Pending operations are internal; infer via a fresh queueOperation probe
            return 0;
        },
        flushTimers: async () => {
            for (const timer of [...sandboxTimers]) {
                if (!timer.cancelled) {
                    timer.cancelled = true;
                    timer.fn();
                }
            }
        },
        advanceTime: async (ms: number) => {
            await new Promise((resolve) => setTimeout(resolve, ms));
        }
    };
}

suite('MapCore style-load gating and throttling (bug fix)', () => {
    let harness: Harness;

    function initialize(): void {
        harness.core.initializeMap({ center: { longitude: 0, latitude: 0 }, zoom: 1, bearing: 0, pitch: 0 });
    }

    setup(() => {
        harness = createHarness();
    });

    test('isMapStyleLoaded is false before load and true after style loads', () => {
        initialize();
        assert.strictEqual(harness.core.isMapStyleLoaded(), false, 'style not loaded right after map construction');
        assert.strictEqual(harness.core.isMapReady(), true, 'map instance exists immediately');

        harness.setStyleLoaded(true);
        assert.strictEqual(harness.core.isMapStyleLoaded(), true);
    });

    test('queueOperation defers until the style is loaded, then drains', () => {
        initialize();
        let executed = 0;
        harness.core.queueOperation(() => {
            executed++;
        });
        assert.strictEqual(executed, 0, 'operation must be queued while style is loading');

        harness.setStyleLoaded(true);
        harness.fireMapEvent('load');
        assert.strictEqual(executed, 1, 'queued operation must run once the load event fires');
    });

    test('updateOverlayLayers arriving before style load is queued and applied after load', () => {
        initialize();
        // Simulate what map-overlays does: it checks isMapStyleLoaded and queues
        let applied = false;
        if (!harness.core.isMapStyleLoaded()) {
            harness.core.queueOperation(() => {
                applied = true;
            });
        }
        assert.strictEqual(applied, false);

        harness.setStyleLoaded(true);
        harness.fireMapEvent('load');
        assert.strictEqual(applied, true, 'overlay update must be applied once style loads');
    });

    test('queued operations drain on styledata once the style reports loaded', () => {
        initialize();
        // MapLibre v6 fires the map-level 'load' event only for the initial
        // style; operations queued while a basemap style swap is in progress
        // must drain when any later style event reports the style ready.
        let applied = false;
        harness.core.queueOperation(() => {
            applied = true;
        });

        harness.setStyleLoaded(true);
        harness.fireMapEvent('styledata');
        assert.strictEqual(applied, true, 'queued operation must run on styledata once style is loaded');
    });

    test('queued operations do not drain on styledata while the style is still loading', () => {
        initialize();
        let applied = false;
        harness.core.queueOperation(() => {
            applied = true;
        });

        harness.setStyleLoaded(false);
        harness.fireMapEvent('styledata');
        assert.strictEqual(applied, false, 'queued operation must stay deferred while style is loading');

        harness.setStyleLoaded(true);
        harness.fireMapEvent('styledata');
        assert.strictEqual(applied, true, 'queued operation must run on styledata once style is loaded');
    });

    test('drain stops instead of spinning when a drained op makes the style report not loaded', () => {
        initialize();
        // In MapLibre v6, Style.addLayer synchronously populates _updatedSources,
        // which makes isStyleLoaded() report false mid-drain. A gated operation
        // queued behind it (like updateOverlayLayers) requeues itself whenever
        // isMapStyleLoaded() is false; without a loop guard the synchronous
        // drain pops what it just pushed forever (webview freeze).
        let firstRuns = 0;
        let secondCompleted = false;
        harness.core.queueOperation(() => {
            firstRuns++;
            // Simulate the first op's addLayer side effect
            harness.setStyleLoaded(false);
        });
        harness.core.queueOperation(function gatedOp(): void {
            if (!harness.core.isMapStyleLoaded()) {
                harness.core.queueOperation(gatedOp);
                return;
            }
            secondCompleted = true;
        });

        harness.setStyleLoaded(true);
        harness.fireMapEvent('styledata');
        assert.strictEqual(firstRuns, 1, 'first operation must run exactly once');
        assert.strictEqual(secondCompleted, false,
            'second gated operation must stay queued when the style flipped to loading mid-drain');

        harness.setStyleLoaded(true);
        harness.fireMapEvent('styledata');
        assert.strictEqual(secondCompleted, true,
            'second gated operation must complete on the next styledata once the style is loaded again');
    });

    test('initializes with a GlobeControl when the MapLibre build provides one', () => {
        const globeHarness = createHarness({ globeControl: true });
        globeHarness.core.initializeMap({ center: { longitude: 0, latitude: 0 }, zoom: 1, bearing: 0, pitch: 0 });
        assert.strictEqual(
            globeHarness.addedControls.some((c) => c.globe === true),
            true,
            'GlobeControl must be added when maplibregl.GlobeControl exists'
        );
    });

    test('skips the GlobeControl on MapLibre builds without one', () => {
        initialize();
        assert.strictEqual(
            harness.addedControls.some((c) => c.globe === true),
            false,
            'GlobeControl must not be added when maplibregl.GlobeControl is absent'
        );
    });

    test('mousemove messages are throttled', async () => {
        initialize();
        const lngLat = { lngLat: { lng: 1, lat: 2 } };

        for (let i = 0; i < 50; i++) {
            harness.fireMapEvent('mousemove', lngLat);
        }

        // The harness executes timers synchronously on registration, so all
        // events in the first throttle window coalesce into one message.
        const mouseMoves = harness.posted.filter((m) => m.type === 'mouseMove');
        assert.strictEqual(mouseMoves.length, 1, '50 mousemoves in one window must post at most one message');
        assert.strictEqual(
            JSON.stringify((mouseMoves[0] as unknown as { lngLat: unknown }).lngLat),
            JSON.stringify({ lng: 1, lat: 2 })
        );
    });

    test('applyTerrain adds terrain source, setTerrain and TerrainControl when enabled', () => {
        initialize();
        harness.core.setConfig({
            terrain: true,
            terrainUrl: 'https://demotiles.maplibre.org/terrain-tiles/tiles.json'
        });
        harness.setStyleLoaded(true);
        harness.core.applyTerrain();
        harness.core.applyTerrain();

        const state = harness.getTerrainState();
        assert.strictEqual(state.terrainSource, 'terrain-3d', 'terrain must be set from the configured source');
        assert.strictEqual(state.terrainControlSource, 'terrain-3d', 'TerrainControl must be added once');
        assert.strictEqual(state.addedSourceIds.length, 2, 'terrain and hillshade sources must not be duplicated on re-apply');
    });

    test('applyTerrain adds a separate hillshade layer and source', () => {
        initialize();
        harness.setStyleLoaded(true);
        harness.core.setConfig({ terrain: true, terrainUrl: 'https://example.com/tiles.json' });
        harness.core.applyTerrain();

        const state = harness.getTerrainState();
        assert.ok(state.addedSourceIds.includes('hillshade-3d'), 'hillshade raster-dem source must be added separately');
        assert.strictEqual(state.hillshadeLayerBefore, undefined, 'hillshade layers on top of a style without symbol layers may sit above all layers');
    });

    test('applyTerrain supports tile URL templates with {z}/{x}/{y}', () => {
        initialize();
        harness.core.setConfig({
            terrain: true,
            terrainUrl: 'https://example.com/terrain/{z}/{x}/{y}.png'
        });
        harness.setStyleLoaded(true);
        harness.core.applyTerrain();

        const state = harness.getTerrainState();
        assert.strictEqual(state.terrainSource, 'terrain-3d');
    });

    test('applyTerrain removes terrain and TerrainControl when disabled', () => {
        initialize();
        harness.core.setConfig({ terrain: true, terrainUrl: 'https://example.com/tiles.json' });
        harness.setStyleLoaded(true);
        harness.core.applyTerrain();
        harness.core.setConfig({ terrain: false, terrainUrl: 'https://example.com/tiles.json' });
        harness.core.applyTerrain();

        const state = harness.getTerrainState();
        assert.strictEqual(state.terrainSource, undefined, 'terrain must be removed when disabled');
        assert.strictEqual(state.terrainControlSource, undefined, 'TerrainControl must be removed when disabled');
    });

    test('hillshade layer is inserted below the first symbol layer and removed when disabled', () => {
        initialize();
        harness.setStyleLoaded(true);
        harness.setSymbolLayers([{ id: 'background', type: 'background' }, { id: 'labels', type: 'symbol' }]);
        harness.core.setConfig({ terrain: true, terrainUrl: 'https://example.com/tiles.json' });
        harness.core.applyTerrain();
        assert.strictEqual(harness.getTerrainState().hillshadeLayerBefore, 'labels', 'hillshade must render below labels');
        harness.core.setConfig({ terrain: false, terrainUrl: 'https://example.com/tiles.json' });
        harness.core.applyTerrain();
        assert.strictEqual(harness.getTerrainState().hillshadeLayerBefore, undefined, 'hillshade source/layer must be removed when disabled');
        assert.strictEqual(harness.getTerrainState().addedSourceIds.length, 0, 'both terrain and hillshade sources must be removed when disabled');
    });

    test('applyTerrain defers until the style reports loaded', () => {
        initialize();
        harness.core.setConfig({ terrain: true, terrainUrl: 'https://example.com/tiles.json' });
        harness.setStyleLoaded(false);
        harness.core.applyTerrain();
        assert.strictEqual(harness.getTerrainState().terrainSource, undefined, 'must not touch the style before it is loaded');

        harness.setStyleLoaded(true);
        harness.fireMapEvent('styledata');
        assert.strictEqual(harness.getTerrainState().terrainSource, 'terrain-3d');
    });
});