import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

/**
 * Loads resources/scripts/map-navigation.js into a sandboxed context with a
 * fake MapLibre map and controllable clock to verify the temp-marker cleanup
 * timer behavior and bookmark zoom handling.
 */

interface FakeMarker {
    removed: boolean;
}

interface ScheduledTimer {
    fn: () => void;
    at: number;
    id: number;
    cancelled: boolean;
}

interface Harness {
    nav: Record<string, (...args: unknown[]) => unknown>;
    markers: FakeMarker[];
    flyToCalls: Array<{ zoom: number; center: [number, number] }>;
    advance: (ms: number) => void;
    pendingTimerCount: () => number;
}

function createHarness(): Harness {
    const sourcePath = path.join(__dirname, '..', '..', '..', 'resources', 'scripts', 'map-navigation.js');
    const source = fs.readFileSync(sourcePath, 'utf-8');

    const markers: FakeMarker[] = [];
    const flyToCalls: Array<{ zoom: number; center: [number, number] }> = [];
    let now = 0;
    const timers: ScheduledTimer[] = [];
    let timerIdCounter = 0;

    const fakeMap = {
        flyTo: (options: { center: [number, number]; zoom: number }) => {
            flyToCalls.push({ zoom: options.zoom, center: options.center });
        }
    };

    const windowObj: Record<string, unknown> = {
        temporaryMarkers: [],
        MapUtils: {
            withMap: (callback: (map: typeof fakeMap) => void) => {
                callback(fakeMap);
                return true;
            },
            getConfig: () => 500,
            fitBoundsWithDefaults: () => undefined
        },
        maplibregl: {
            Marker: function (): unknown {
                const state: { _lngLat?: [number, number]; _record?: FakeMarker } = {};
                const marker = {
                    setLngLat: (lngLat: [number, number]): unknown => {
                        state._lngLat = lngLat;
                        return marker;
                    },
                    addTo: (): unknown => {
                        const m: FakeMarker = { removed: false };
                        markers.push(m);
                        state._record = m;
                        return marker;
                    },
                    remove: (): unknown => {
                        if (state._record) {
                            state._record.removed = true;
                        }
                        return marker;
                    }
                };
                return marker;
            }
        }
    };
    windowObj.window = windowObj;

    const context: Record<string, unknown> = {
        window: windowObj,
        console,
        maplibregl: windowObj.maplibregl,
        setTimeout: (fn: () => void, ms: number) => {
            timerIdCounter++;
            const timer: ScheduledTimer = { fn, at: now + (ms ?? 0), id: timerIdCounter, cancelled: false };
            timers.push(timer);
            return timer.id;
        },
        clearTimeout: (id: number) => {
            const timer = timers.find((t) => t.id === id);
            if (timer) {
                timer.cancelled = true;
                timers.splice(timers.indexOf(timer), 1);
            }
        }
    };

    vm.runInNewContext(source, context);

    return {
        nav: windowObj.MapNavigation as Record<string, (...args: unknown[]) => unknown>,
        markers,
        flyToCalls,
        pendingTimerCount: () => timers.length,
        advance: (ms: number) => {
            now += ms;
            const due = timers.filter((t) => t.at <= now);
            due.forEach((t) => {
                timers.splice(timers.indexOf(t), 1);
                t.fn();
            });
        }
    };
}

suite('MapNavigation temp marker timers (bug fix)', () => {
    let harness: Harness;

    setup(() => {
        harness = createHarness();
    });

    test('zoom 0 bookmark flies to zoom 0, not the default', () => {
        harness.nav.flyToBookmark({
            name: 'World',
            center: { latitude: 0, longitude: 0 },
            zoom: 0,
            bearing: 0,
            pitch: 0
        });
        assert.strictEqual(harness.flyToCalls[0]?.zoom, 0, 'deliberate zoom 0 must be honored');
    });

    test('missing zoom falls back to 14', () => {
        harness.nav.flyToBookmark({
            name: 'No Zoom',
            center: { latitude: 1, longitude: 2 }
        });
        assert.strictEqual(harness.flyToCalls[0]?.zoom, 14);
    });

    test('a second fly cancels the first cleanup timer so later markers survive', () => {
        harness.nav.flyToLocation(10, 20, 14);

        // 5 seconds later a second flight
        harness.advance(5000);
        harness.nav.flyToLocation(30, 40, 14);

        // Advance 5 more seconds (10s after first flight): the first timer must
        // have been cancelled, so the second flight's markers must still exist.
        harness.advance(5000);
        assert.strictEqual(harness.markers.filter((m) => !m.removed).length, 1,
            'second flight markers must survive the first flight cleanup');

        // Advance 5 more seconds (10s after second flight): cleanup fires once.
        harness.advance(5000);
        assert.strictEqual(harness.markers.every((m) => m.removed), true,
            'cleanup eventually removes all markers');
    });

    test('rapid flights do not accumulate stale timers', () => {
        harness.nav.flyToLocation(1, 1, 14);
        assert.strictEqual(harness.pendingTimerCount(), 1);
        harness.nav.flyToLocation(2, 2, 14);
        assert.strictEqual(harness.pendingTimerCount(), 1, 'each new flight must cancel the previous timer');
        harness.nav.flyToLocation(3, 3, 14);
        assert.strictEqual(harness.pendingTimerCount(), 1);
    });

    test('fitBoundingBox cleanup also cancels previous timers', () => {
        harness.nav.flyToLocation(1, 1, 14);
        harness.nav.fitBoundingBox(
            [{ latitude: 5, longitude: 5 }],
            { southwest: { latitude: 4, longitude: 4 }, northeast: { latitude: 6, longitude: 6 } }
        );

        assert.strictEqual(harness.pendingTimerCount(), 1, 'fitBoundingBox must replace the pending cleanup timer');
    });
});