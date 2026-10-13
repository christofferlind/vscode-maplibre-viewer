import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

/**
 * Loads resources/scripts/map-globe.js into a sandboxed context with a fake
 * MapLibre v6 map and DOM. On v6 the projection lives in the style stylesheet,
 * there is no projectionchange event, and style changes surface as styledata;
 * the module therefore owns a toggle button and repairs the projection on
 * styledata. Zoom-driven projectiontransition events must stay inert.
 */

interface PostedMessage {
    type: string;
    [key: string]: unknown;
}

interface GlobeHarness {
    globe: Record<string, (...args: unknown[]) => unknown>;
    posted: PostedMessage[];
    currentProjection: () => string | null;
    setProjectionDirectly: (type: string | null) => void;
    setStyleLoaded: (loaded: boolean) => void;
    attachMap: () => void;
    fireStyleData: () => void;
    fireProjectionTransition: () => void;
    clickGlobeButton: () => void;
    buttonClassContains: (name: string) => boolean;
    pendingTimers: () => number;
    tickTimers: () => void;
}

function createElementStub(): Record<string, unknown> {
    const classes = new Set<string>();
    const listeners: Record<string, Array<() => void>> = {};
    const element: Record<string, unknown> = {
        className: '',
        title: '',
        attributes: {} as Record<string, string>,
        children: [] as unknown[],
        setAttribute: (name: string, value: string) => {
            (element.attributes as Record<string, string>)[name] = value;
        },
        classList: {
            add: (name: string) => {
                classes.add(name);
            },
            remove: (name: string) => {
                classes.delete(name);
            },
            contains: (name: string) => classes.has(name)
        },
        addEventListener: (event: string, handler: () => void) => {
            const list = listeners[event] ?? [];
            list.push(handler);
            listeners[event] = list;
        },
        appendChild: (child: unknown) => {
            (element.children as unknown[]).push(child);
        },
        click: () => {
            (listeners['click'] ?? []).forEach((handler) => handler());
        },
        remove: () => undefined
    };
    return element;
}

function createHarness(): GlobeHarness {
    const scriptsDir = path.join(__dirname, '..', '..', '..', 'resources', 'scripts');
    const source = fs.readFileSync(path.join(scriptsDir, 'map-globe.js'), 'utf-8');

    const posted: PostedMessage[] = [];
    let styleLoaded = false;
    let projectionType: string | null = 'mercator';
    const eventHandlers = new Map<string, Array<() => void>>();

    function fire(event: string): void {
        const list = eventHandlers.get(event) ?? [];
        list.forEach((handler) => handler());
    }

    const map: Record<string, unknown> = {
        addControl: () => undefined,
        on: (event: string, handler: () => void) => {
            const list = eventHandlers.get(event) ?? [];
            list.push(handler);
            eventHandlers.set(event, list);
        },
        isStyleLoaded: () => styleLoaded,
        getProjection: () => (projectionType ? { type: projectionType } : null),
        setProjection: (spec: { type: string }) => {
            projectionType = spec.type;
            // In v6, setProjection mutates the stylesheet and fires styledata
            fire('styledata');
        }
    };

    // map-globe.js builds its control through document.createElement; the DOM
    // stub hands back one shared element so tests can drive and inspect it.
    const domElement = createElementStub();

    // Repair polls use timers; tests tick them manually for determinism
    const sandboxTimers: Array<{ fn: () => void; id: number; cancelled: boolean }> = [];
    let timerId = 0;

    const sandbox: Record<string, unknown> = {
        window: {},
        console,
        vscode: {
            postMessage: (message: PostedMessage) => {
                posted.push(message);
            }
        },
        document: {
            createElement: () => domElement
        },
        setTimeout: (fn: () => void, _ms?: number) => {
            timerId++;
            sandboxTimers.push({ fn, id: timerId, cancelled: false });
            return timerId;
        },
        clearTimeout: (id: number) => {
            const timer = sandboxTimers.find((t) => t.id === id);
            if (timer) {
                timer.cancelled = true;
            }
        }
    };

    const context = vm.createContext(sandbox);
    vm.runInContext(source, context);

    const windowObj = sandbox.window as Record<string, unknown>;
    const globe = windowObj.MapGlobe as Record<string, (...args: unknown[]) => unknown>;
    assert.ok(globe, 'map-globe.js must export window.MapGlobe');

    return {
        globe,
        posted,
        currentProjection: () => projectionType,
        setProjectionDirectly: (type: string | null) => {
            projectionType = type;
        },
        setStyleLoaded: (loaded: boolean) => {
            styleLoaded = loaded;
        },
        attachMap: () => {
            globe.attach(map);
        },
        fireStyleData: () => {
            fire('styledata');
        },
        fireProjectionTransition: () => {
            fire('projectiontransition');
        },
        clickGlobeButton: () => {
            (domElement.click as () => void)();
        },
        buttonClassContains: (name: string) =>
            Boolean((domElement.classList as { contains(name: string): boolean }).contains(name)),
        pendingTimers: () => sandboxTimers.filter((t) => !t.cancelled).length,
        tickTimers: () => {
            const pending = sandboxTimers.filter((t) => !t.cancelled);
            pending.forEach((t) => {
                t.cancelled = true;
            });
            pending.forEach((t) => t.fn());
        }
    };
}

suite('map-globe.js (MapLibre v6 stylesheet projection)', () => {
    test('attach adds a toggle control and no projection is applied before the style loads', () => {
        const harness = createHarness();
        harness.globe.setConfig({ globe: true });
        harness.attachMap();
        harness.fireStyleData();
        assert.strictEqual(harness.currentProjection(), 'mercator', 'style not loaded yet: nothing may be applied');
        assert.ok(harness.pendingTimers() > 0, 'a bounded repair poll must be armed while the style is loading');
    });

    test('the persisted globe preference is repaired by polling without any styledata event', () => {
        const harness = createHarness();
        harness.globe.setConfig({ globe: true });
        harness.attachMap();
        harness.setStyleLoaded(true);
        // No styledata fires (the v6 race where the last styledata of a basemap
        // swap arrives while the incoming style still reports loading)
        harness.tickTimers();
        assert.strictEqual(
            harness.currentProjection(),
            'globe',
            'the poll must apply the requested projection once the style reports loaded'
        );
        assert.strictEqual(harness.pendingTimers(), 0, 'the poll must stop once satisfied');
    });

    test('a mercator preference poll stops when the projection already matches', () => {
        const harness = createHarness();
        harness.globe.setConfig({ globe: false });
        harness.attachMap();
        harness.setStyleLoaded(true);
        harness.tickTimers();
        assert.strictEqual(harness.currentProjection(), 'mercator');
        assert.strictEqual(harness.pendingTimers(), 0);
        harness.tickTimers();
        assert.strictEqual(harness.posted.length, 0, 'satisfied polls must not post anything');
    });

    test('the poll loop is bounded so a permanently loading style cannot poll forever', () => {
        const harness = createHarness();
        harness.globe.setConfig({ globe: true });
        harness.attachMap();
        for (let i = 0; i < 105; i++) {
            harness.tickTimers();
        }
        assert.strictEqual(harness.pendingTimers(), 0, 'the repair poll must give up eventually');
        assert.strictEqual(harness.currentProjection(), 'mercator');
    });

    test('a config update while the style is mid-load is applied once the style loads', () => {
        const harness = createHarness();
        harness.attachMap();
        harness.globe.setConfig({ globe: true });
        assert.strictEqual(harness.currentProjection(), 'mercator');
        harness.setStyleLoaded(true);
        harness.tickTimers();
        assert.strictEqual(harness.currentProjection(), 'globe');
        assert.strictEqual(harness.posted.length, 0, 'applying a broadcast config must not echo a report');
    });

    test('applyGlobe applies the requested globe projection once the style is loaded', () => {
        const harness = createHarness();
        harness.globe.setConfig({ globe: true });
        harness.attachMap();
        harness.setStyleLoaded(true);
        harness.fireStyleData();
        assert.strictEqual(harness.currentProjection(), 'globe');
    });

    test('the persisted mercator preference is applied on style load', () => {
        const harness = createHarness();
        harness.globe.setConfig({ globe: false });
        harness.setProjectionDirectly('globe');
        harness.attachMap();
        harness.setStyleLoaded(true);
        harness.fireStyleData();
        assert.strictEqual(harness.currentProjection(), 'mercator');
    });

    test('zooming projection transitions never report or reset the preference', () => {
        const harness = createHarness();
        harness.globe.setConfig({ globe: true });
        harness.attachMap();
        harness.setStyleLoaded(true);
        harness.fireStyleData();
        assert.strictEqual(harness.posted.length, 0);

        // MapLibre v6 fires projectiontransition while zooming between the
        // globe and mercator renderings; the stylesheet projection is unchanged
        harness.fireProjectionTransition();
        assert.strictEqual(harness.currentProjection(), 'globe', 'zoom transition must not change the configured projection');
        assert.strictEqual(harness.posted.length, 0, 'zoom must never post a globeStateChanged message');
    });

    test('clicking the toggle applies the projection and reports the new state', () => {
        const harness = createHarness();
        harness.globe.setConfig({ globe: false });
        harness.attachMap();
        harness.setStyleLoaded(true);
        harness.fireStyleData();

        harness.clickGlobeButton();
        assert.strictEqual(harness.currentProjection(), 'globe', 'click must apply immediately');
        assert.strictEqual(harness.posted.length, 1);
        assert.strictEqual(harness.posted[0].type, 'globeStateChanged');
        assert.strictEqual(harness.posted[0].enabled, true);
        assert.strictEqual(harness.globe.isGlobeEnabled(), true);

        harness.clickGlobeButton();
        assert.strictEqual(harness.currentProjection(), 'mercator');
        assert.strictEqual(harness.posted.length, 2);
        assert.strictEqual(harness.posted[1].enabled, false);
    });

    test('toggling before the style loads defers the projection but still reports', () => {
        const harness = createHarness();
        harness.globe.setConfig({ globe: false });
        harness.attachMap();
        harness.setStyleLoaded(false);

        harness.clickGlobeButton();
        assert.strictEqual(harness.posted.length, 1, 'the preference report must not wait for the style');
        assert.strictEqual(harness.currentProjection(), 'mercator', 'nothing applied while the style is loading');
        assert.ok(harness.pendingTimers() > 0, 'the deferred application must be armed by the poll');

        harness.setStyleLoaded(true);
        harness.fireStyleData();
        assert.strictEqual(harness.currentProjection(), 'globe', 'the requested state applies once the style loads');
        assert.strictEqual(harness.pendingTimers(), 0, 'the poll must stop once the state is applied');
    });

    test('a style swap resetting the stylesheet projection is repaired to the requested state', () => {
        const harness = createHarness();
        harness.globe.setConfig({ globe: true });
        harness.attachMap();
        harness.setStyleLoaded(true);
        harness.fireStyleData();

        // A basemap swap installs a fresh stylesheet whose projection is mercator
        harness.setProjectionDirectly('mercator');
        harness.fireStyleData();
        assert.strictEqual(harness.currentProjection(), 'globe', 'the requested projection must be repaired after a style swap');
        assert.strictEqual(harness.posted.length, 0, 'repairing a style swap must not write the preference again');
    });

    test('a style swap that already matches the requested state is a no-op', () => {
        const harness = createHarness();
        harness.globe.setConfig({ globe: false });
        harness.attachMap();
        harness.setStyleLoaded(true);
        harness.fireStyleData();
        harness.fireStyleData();
        assert.strictEqual(harness.currentProjection(), 'mercator');
        assert.strictEqual(harness.posted.length, 0);
    });

    test('a config update applies the new preference without reporting an echo', () => {
        const harness = createHarness();
        harness.globe.setConfig({ globe: false });
        harness.attachMap();
        harness.setStyleLoaded(true);
        harness.fireStyleData();

        // The extension broadcast a config update after the user changed settings
        harness.globe.setConfig({ globe: true });
        assert.strictEqual(harness.currentProjection(), 'globe');
        assert.strictEqual(harness.posted.length, 0);
    });

    test('setConfig without an attached map does not throw', () => {
        const harness = createHarness();
        assert.doesNotThrow(() => harness.globe.setConfig({ globe: true }));
        assert.doesNotThrow(() => harness.globe.applyGlobe());
    });

    test('the toggle button reflects the requested state', () => {
        const harness = createHarness();
        harness.attachMap();
        assert.strictEqual(harness.buttonClassContains('maplibregl-ctrl-globe'), true);
        assert.strictEqual(harness.buttonClassContains('maplibregl-ctrl-globe-enabled'), false);

        harness.clickGlobeButton();
        assert.strictEqual(harness.buttonClassContains('maplibregl-ctrl-globe-enabled'), true);
        assert.strictEqual(harness.buttonClassContains('maplibregl-ctrl-globe'), false);
    });
});