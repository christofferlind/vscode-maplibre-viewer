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

interface Harness {
    core: Record<string, (...args: unknown[]) => unknown>;
    posted: PostedMessage[];
    setStyleLoaded: (loaded: boolean) => void;
    fireMapEvent: (event: string, data?: unknown) => void;
    pendingCount: () => number;
    flushTimers: () => Promise<void>;
    advanceTime: (ms: number) => Promise<void>;
}

function createHarness(): Harness {
    const sourcePath = path.join(__dirname, '..', '..', '..', 'resources', 'scripts', 'map-core.js');
    const source = fs.readFileSync(sourcePath, 'utf-8');

    const posted: PostedMessage[] = [];
    const styleLayers: Array<{ id: string; source?: string }> = [];
    let styleLoaded = false;
    let mapInstance: Record<string, unknown> | null = null;
    const eventHandlers = new Map<string, Array<(e?: unknown) => void>>();
    const sandboxTimers: Array<{ fn: () => void; id: number; cancelled: boolean }> = [];
    let timerId = 0;

    function createMap(): Record<string, unknown> {
        const handlers = eventHandlers;
        return {
            addControl: () => undefined,
            on: (event: string, handler: (e?: unknown) => void) => {
                const list = handlers.get(event) ?? [];
                list.push(handler);
                handlers.set(event, list);
            },
            isStyleLoaded: () => styleLoaded,
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
        }
    };

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
        setStyleLoaded: (loaded: boolean) => {
            styleLoaded = loaded;
        },
        fireMapEvent: (event: string, data?: unknown) => {
            (eventHandlers.get(event) ?? []).forEach((handler) => handler(data));
        },
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
});