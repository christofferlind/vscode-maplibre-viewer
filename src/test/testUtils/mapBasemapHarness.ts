import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

/**
 * Shared vm harness for unit tests that execute resources/scripts/map-basemap.js
 * in a sandbox with a mocked MapCore/MapUtils environment and a fake map whose
 * one-shot handlers and isStyleLoaded() state can be driven from the tests.
 */

interface PostedMessage {
    type: string;
    [key: string]: unknown;
}

export interface StyleOptions {
    transformStyle?: unknown;
    preserveSources?: boolean;
}

export interface RasterSourceDefinition {
    type: string;
    tiles: string[];
    tileSize: number;
    attribution: string;
    minzoom?: number;
    maxzoom?: number;
}

export interface FakeStyle {
    version: number;
    sources: Record<string, RasterSourceDefinition>;
    layers: Array<{ id: string; type: string; source: string; minzoom: number; maxzoom: number }>;
}

export interface FakeMap {
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

export interface MapBasemapHarness {
    basemap: Record<string, (...args: unknown[]) => unknown>;
    map: FakeMap;
    posted: PostedMessage[];
    setCurrentStyleUrlCalls: unknown[];
    trackedStyleUrl: () => unknown;
    setStyleCalls: Array<{ style: string | FakeStyle; opts?: StyleOptions }>;
    jumpToCalls: Array<Record<string, unknown>>;
    fireOnce: (event: string) => void;
    onceHandlerCount: (event: string) => number;
    setStyleLoaded: (loaded: boolean) => void;
}

export function loadMapBasemap(initialStyleLoaded: boolean): MapBasemapHarness {
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
    let trackedStyleUrl: unknown = null;

    const map: FakeMap = {
        getStyle: () => style,
        getCenter: () => ({ lng: 18.07, lat: 59.33 }),
        getZoom: () => 4,
        getBearing: () => 0,
        getPitch: () => 0,
        setStyle: (styleArg, opts) => {
            setStyleCalls.push({ style: styleArg, opts });
            // Like real MapLibre, a pending setStyle makes isStyleLoaded()
            // report false until the new style is applied.
            styleLoaded = false;
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
            getCurrentStyleUrl: () => trackedStyleUrl,
            setCurrentStyleUrl: (styleUrl: unknown) => {
                setCurrentStyleUrlCalls.push(styleUrl);
                trackedStyleUrl = styleUrl;
            },
            getMap: () => map
        },
        MapUtils: {
            withMap: (callback: (m: FakeMap) => void) => {
                callback(map);
                return true;
            },
            createViewState: () => null,
            // Mirror of the real predicates in map-utils.js; the transformStyle
            // merge and the overlay sync share the 'overlay-' prefix contract.
            isOverlaySourceId: (sourceId: unknown) =>
                typeof sourceId === 'string' && sourceId.indexOf('overlay-') === 0,
            isOverlayLayer: (layer: { source?: unknown } | null | undefined) =>
                !!layer && typeof layer.source === 'string' && layer.source.indexOf('overlay-') === 0
        }
    };
    windowObj.window = windowObj;

    const context: Record<string, unknown> = {
        window: windowObj,
        console,
        setTimeout: (fn: () => void, _ms?: number) => setTimeout(fn, 0),
        clearTimeout: (id: NodeJS.Timeout | undefined) => {
            if (id) {
                clearTimeout(id);
            }
        },
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
        trackedStyleUrl: () => trackedStyleUrl,
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