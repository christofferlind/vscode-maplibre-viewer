import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

/**
 * Startup-restore robustness tests for resources/scripts/map-core.js.
 *
 * Covers the failure mode where saved overlay layers did not reappear after a
 * VS Code restart: the mapReady signal fired ahead of the style commit so the
 * overlay push queued behind it could strand with no event to drain it, and a
 * silently dropped message could not be recovered. These tests drive a fake
 * MapLibre map and a controllable timer queue:
 * - mapReady is posted only once the style reports loaded, with a bounded
 *   fallback so it can never be lost
 * - a requestOverlaySync pull is posted alongside mapReady
 * - queued operations drain on a timer even when no styledata/load event
 *   fires afterwards
 */

interface PostedMessage {
    type: string;
    [key: string]: unknown;
}

interface TimerRecord {
    id: number;
    fn: () => void;
    cancelled: boolean;
}

interface Harness {
    core: Record<string, (...args: unknown[]) => unknown>;
    posted: PostedMessage[];
    setStyleLoaded: (loaded: boolean) => void;
    fireMapEvent: (event: string, data?: unknown) => void;
    flushTimers: (rounds?: number) => void;
    cancelTimerCount: (id: number) => boolean;
    warnings: string[];
}

function createHarness(): Harness {
    const scriptsDir = path.join(__dirname, '..', '..', '..', 'resources', 'scripts');
    const terrainSource = fs.readFileSync(path.join(scriptsDir, 'map-terrain.js'), 'utf-8');
    const source = fs.readFileSync(path.join(scriptsDir, 'map-core.js'), 'utf-8');

    const posted: PostedMessage[] = [];
    const warnings: string[] = [];
    // Reset when a new map instance is created, mirroring real MapLibre where
    // listeners die with the map instance instead of accumulating across
    // recreations.
    let eventHandlers = new Map<string, Array<(e?: unknown) => void>>();
    const timers: TimerRecord[] = [];
    let nextTimerId = 0;
    let styleLoaded = false;
    let mapInstance: Record<string, unknown> | null = null;

    function createMap(): Record<string, unknown> {
        return {
            addControl: () => undefined,
            removeControl: () => undefined,
            on: (event: string, handler: (e?: unknown) => void) => {
                const list = eventHandlers.get(event) ?? [];
                list.push(handler);
                eventHandlers.set(event, list);
            },
            once: (event: string, handler: (e?: unknown) => void) => {
                const list = eventHandlers.get(event) ?? [];
                list.push(handler);
                eventHandlers.set(event, list);
            },
            isStyleLoaded: () => styleLoaded,
            getTerrain: () => null,
            setTerrain: () => undefined,
            getSource: () => undefined,
            addSource: () => undefined,
            removeSource: () => undefined,
            getLayer: () => undefined,
            addLayer: () => undefined,
            removeLayer: () => undefined,
            getCenter: () => ({ lng: 0, lat: 0 }),
            getZoom: () => 4,
            getBearing: () => 0,
            getPitch: () => 0,
            jumpTo: () => undefined,
            getStyle: () => ({ layers: [] }),
            getCanvas: () => ({ setAttribute: () => undefined })
        };
    }

    const maplibreglStub: Record<string, unknown> = {
        Map: function () {
            // A real map recreation drops the handlers of the previous instance
            eventHandlers = new Map<string, Array<(e?: unknown) => void>>();
            mapInstance = createMap();
            return mapInstance;
        },
        NavigationControl: function () {
            return {};
        },
        TerrainControl: function () {
            return {};
        }
    };

    const windowObj: Record<string, unknown> = {
        maplibregl: maplibreglStub,
        addEventListener: () => undefined,
        removeEventListener: () => undefined
    };
    windowObj.window = windowObj;

    const context: Record<string, unknown> = {
        window: windowObj,
        console: {
            log: () => undefined,
            warn: (...args: unknown[]) => {
                warnings.push(args.map(String).join(' '));
            },
            error: () => undefined,
            debug: () => undefined,
            info: () => undefined
        },
        maplibregl: maplibreglStub,
        setTimeout: (fn: () => void, _ms?: number) => {
            const id = ++nextTimerId;
            timers.push({ id, fn, cancelled: false });
            return id;
        },
        clearTimeout: (id: number) => {
            const timer = timers.find((t) => t.id === id);
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

    vm.createContext(context);
    // map-terrain.js must run before map-core.js: it declares the terrain
    // globals and the applyTerrain function that MapCore exports, mirroring
    // the script order in map-view.html.
    vm.runInContext(terrainSource, context);
    vm.runInContext(source, context, { filename: 'map-core.js' });

    return {
        core: windowObj.MapCore as Record<string, (...args: unknown[]) => unknown>,
        posted,
        setStyleLoaded: (loaded: boolean) => {
            styleLoaded = loaded;
        },
        fireMapEvent: (event: string, data?: unknown) => {
            (eventHandlers.get(event) ?? []).forEach((handler) => handler(data));
        },
        flushTimers: (rounds = Number.POSITIVE_INFINITY) => {
            let round = 0;
            while (round < rounds) {
                const ready = timers.filter((t) => !t.cancelled);
                if (ready.length === 0) {
                    return;
                }
                ready.forEach((t) => {
                    t.cancelled = true;
                });
                ready.forEach((t) => t.fn());
                round++;
            }
        },
        cancelTimerCount: (id: number) =>
            timers.filter((t) => t.id === id).length > 0,
        warnings
    };
}

suite('MapCore overlay startup restore robustness', () => {
    let harness: Harness;

    function initialize(): void {
        harness.core.setConfig({ terrain: false, terrainUrl: '' });
        harness.core.initializeMap({ center: { longitude: 0, latitude: 0 }, zoom: 1, bearing: 0, pitch: 0 });
    }

    setup(() => {
        harness = createHarness();
    });

    test('load event posts mapReady and requestOverlaySync once the style is loaded', () => {
        initialize();
        harness.setStyleLoaded(true);
        harness.fireMapEvent('load');

        const ready = harness.posted.filter((m) => m.type === 'mapReady');
        const pulls = harness.posted.filter((m) => m.type === 'requestOverlaySync');
        assert.strictEqual(ready.length, 1, 'exactly one mapReady after the load event');
        assert.strictEqual(pulls.length, 1, 'exactly one overlay-sync pull alongside mapReady');
    });

    test('mapReady is deferred while the style is still committing', () => {
        initialize();
        harness.fireMapEvent('load');
        harness.flushTimers(1);

        assert.strictEqual(
            harness.posted.filter((m) => m.type === 'mapReady').length,
            0,
            'mapReady must not be posted before the style reports loaded'
        );

        harness.setStyleLoaded(true);
        harness.flushTimers();

        const ready = harness.posted.filter((m) => m.type === 'mapReady');
        const pulls = harness.posted.filter((m) => m.type === 'requestOverlaySync');
        assert.strictEqual(ready.length, 1, 'mapReady posted once the style commit is confirmed');
        assert.strictEqual(pulls.length, 1, 'overlay-sync pull posted together with mapReady');
    });

    test('mapReady falls back to posting when the style never reports loaded', () => {
        initialize();
        harness.fireMapEvent('load');
        harness.flushTimers();

        const ready = harness.posted.filter((m) => m.type === 'mapReady');
        const pulls = harness.posted.filter((m) => m.type === 'requestOverlaySync');
        assert.strictEqual(ready.length, 1, 'mapReady must eventually post even if the style never settles');
        assert.strictEqual(pulls.length, 1, 'overlay-sync pull must accompany the fallback mapReady');
        assert.strictEqual(harness.warnings.length, 0, 'the fallback is a normal path and must not warn');
    });

    test('recreating the map cancels a pending mapReady retry from the previous instance', () => {
        initialize();
        harness.fireMapEvent('load');
        harness.flushTimers(1);
        assert.strictEqual(
            harness.posted.filter((m) => m.type === 'mapReady').length,
            0,
            'no mapReady while the style is loading'
        );

        // Simulate recreateMapWithStyle: initializeMap runs again on the same
        // sandbox, so the first instance's retry timer must never post for the
        // second instance.
        initialize();
        harness.flushTimers();
        assert.strictEqual(
            harness.posted.filter((m) => m.type === 'mapReady').length,
            0,
            'a stale retry timer from the previous map instance must not post mapReady'
        );

        harness.setStyleLoaded(true);
        harness.fireMapEvent('load');
        harness.flushTimers();

        const ready = harness.posted.filter((m) => m.type === 'mapReady');
        const pulls = harness.posted.filter((m) => m.type === 'requestOverlaySync');
        assert.strictEqual(ready.length, 1, 'exactly one mapReady after recreation and style load');
        assert.strictEqual(pulls.length, 1, 'exactly one overlay-sync pull after recreation');
    });

    test('queued operations drain on the timer with no further style events', () => {
        initialize();
        let executed = 0;
        harness.core.queueOperation(() => {
            executed++;
        });
        assert.strictEqual(executed, 0, 'operation must be queued while the style is loading');

        harness.setStyleLoaded(true);
        harness.flushTimers();

        assert.strictEqual(executed, 1, 'queued operation must drain via the timer without any style event');
    });

    test('queued operations stay deferred until the style reports loaded', () => {
        initialize();
        let executed = 0;
        harness.core.queueOperation(() => {
            executed++;
        });

        harness.flushTimers(1);
        assert.strictEqual(executed, 0, 'operation must not run while the style is loading');

        harness.setStyleLoaded(true);
        harness.flushTimers();
        assert.strictEqual(executed, 1, 'operation must run once the style is loaded');
    });

    test('drain gives up after bounded retries on a permanently unloaded style', () => {
        initialize();
        let executed = 0;
        harness.core.queueOperation(() => {
            executed++;
        });

        // Run the whole bound: the timer chain retries, never drains (the
        // style stays unloaded) and must stop instead of spinning forever.
        harness.flushTimers();

        assert.strictEqual(executed, 0, 'the operation must stay queued while the style is unloaded');
        assert.ok(
            harness.warnings.some((w) => w.indexOf('queued operations') !== -1),
            'giving up must be reported via a warning'
        );

        // After giving up, further timer flushes must not resurrect attempts
        harness.flushTimers();
        assert.strictEqual(executed, 0);
    });

    test('drain attempts reset after the queue drains, then bounded retry works again', () => {
        initialize();
        let executed = 0;
        harness.core.queueOperation(() => {
            executed++;
        });
        harness.setStyleLoaded(true);
        harness.flushTimers();
        assert.strictEqual(executed, 1, 'first operation drains once the style is loaded');

        // Simulate a second period where the style reports unloaded again
        harness.setStyleLoaded(false);
        let secondExecuted = 0;
        harness.core.queueOperation(() => {
            secondExecuted++;
        });
        harness.setStyleLoaded(true);
        harness.flushTimers();
        assert.strictEqual(secondExecuted, 1, 'a fresh queue must drain again after the previous drain');
        assert.strictEqual(
            harness.warnings.some((w) => w.indexOf('queued operations') !== -1),
            false,
            'normal drains must never warn'
        );
    });
});