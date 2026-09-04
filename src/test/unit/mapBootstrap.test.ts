import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

/**
 * Verifies the webview bootstrap sequence: the inline scripts embedded in
 * resources/map-view.html (including the console-forwarding script) plus
 * resources/scripts/main.js must run without throwing so that
 * window.Main.initialize() is invoked and the map is created.
 *
 * VS Code's acquireVsCodeApi() may only be called once per webview session;
 * a second call throws. This test simulates that constraint to catch any
 * script that calls acquireVsCodeApi() more than once, which would prevent
 * the map from ever rendering.
 */

interface BootstrapHarness {
    main: Record<string, unknown> | undefined;
    initializeCalls: number;
    posted: Array<{ type: string; [key: string]: unknown }>;
    errors: string[];
}

function loadBootstrap(): BootstrapHarness {
    const htmlPath = path.join(__dirname, '..', '..', '..', 'resources', 'map-view.html');
    const mainJsPath = path.join(__dirname, '..', '..', '..', 'resources', 'scripts', 'main.js');
    const html = fs.readFileSync(htmlPath, 'utf-8');
    const mainJs = fs.readFileSync(mainJsPath, 'utf-8');

    // Extract the inline <script> blocks (nonce attribute is present). Scripts
    // that still contain unreplaced ${...} placeholders (e.g. the config block
    // with ${mapStyleUrl}) are rendered by the extension at runtime, so they are
    // skipped here. The console-forwarding script and the Event monkey-patch are
    // plain JS and are exercised.
    const inlineScripts: string[] = [];
    const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/g;
    let match: RegExpExecArray | null;
    while ((match = scriptRe.exec(html)) !== null) {
        const body = match[1];
        if (body.trim().length > 0 && !body.includes('${')) {
            inlineScripts.push(body);
        }
    }

    const posted: Array<{ type: string; [key: string]: unknown }> = [];
    const errors: string[] = [];
    let acquireCalls = 0;
    let initializeCalls = 0;

    const windowObj: Record<string, unknown> = {};
    windowObj.window = windowObj;
    windowObj.console = console;
    windowObj.addEventListener = () => undefined;

    // Stub the modules loaded from external <script src> files (map-core.js,
    // map-utils.js, map-basemap.js, map-search.js, etc.) that are not part of
    // the bootstrap sequence under test. main.js calls into these during
    // initialize(); the real webview loads them from disk.
    windowObj.MapCore = {
        setConfig: () => undefined,
        initializeMap: () => undefined,
        getMap: () => null,
        isMapReady: () => false,
        isMapLoaded: () => false,
        getCurrentStyleUrl: () => null,
        setCurrentStyleUrl: () => undefined,
        queueOperation: () => undefined,
        processPendingOperations: () => undefined,
        saveViewStateToExtension: () => undefined,
        sendViewStateChanged: () => undefined,
        updateMapStyle: () => undefined,
        createRasterStyle: () => ({}),
        updateBasemap: () => undefined,
        changeMapLanguage: () => undefined
    };
    windowObj.MapUtils = {
        withMap: () => false,
        createViewState: () => null,
        getConfig: () => undefined,
        showErrorOverlay: () => undefined,
        hideErrorOverlay: () => undefined,
        createGeoJsonLayerDefinitions: () => ({}),
        fitBoundsWithDefaults: () => undefined
    };
    windowObj.MapBasemap = {
        updateMapStyle: () => undefined,
        createRasterStyle: () => ({}),
        updateBasemap: () => undefined,
        changeMapLanguage: () => undefined,
        recreateMapWithStyle: () => false
    };
    windowObj.MapOverlays = {
        updateOverlayLayers: () => undefined,
        addOverlayLayer: () => undefined,
        removeOverlayLayer: () => undefined,
        updateLayerVisibility: () => undefined,
        updateSelectedFileLayerSource: () => undefined,
        clearSelectedFileLayer: () => undefined,
        isOverlayLayerOnMap: () => false,
        addedOverlayLayers: {}
    };
    windowObj.MapNavigation = {
        flyToLocation: () => undefined,
        clearTemporaryMarkers: () => undefined,
        fitBoundingBox: () => undefined,
        fitBoundsOnly: () => undefined,
        flyToBookmark: () => undefined
    };
    windowObj.MapSearch = {
        initialize: () => undefined,
        applyTransparency: () => undefined,
        clearResults: () => undefined,
        handleGeocodingSearchResults: () => undefined,
        handleGeocodingSearchError: () => undefined
    };
    windowObj.MapConfig = {};

    const context: Record<string, unknown> = {
        window: windowObj,
        console,
        document: {
            getElementById: () => null,
            addEventListener: () => undefined
        },
        setTimeout: () => 0,
        clearTimeout: () => undefined,
        URL: { createObjectURL: () => 'blob:mock' },
        Blob: function Blob() {},
        atob: (s: string) => s,
        Event: function Event() {},
        acquireVsCodeApi: () => {
            acquireCalls += 1;
            if (acquireCalls > 1) {
                throw new Error('acquireVsCodeApi may only be called once per webview');
            }
            return {
                postMessage: (msg: { type: string; [key: string]: unknown }) => {
                    posted.push(msg);
                }
            };
        }
    };

    // Run the inline scripts first (in order), then main.js, mirroring the
    // order in map-view.html where main.js is loaded last.
    for (const script of inlineScripts) {
        try {
            vm.runInNewContext(script, context, { filename: 'map-view.html' });
        } catch (e) {
            errors.push(`inline script: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    try {
        vm.runInNewContext(mainJs, context, { filename: 'main.js' });
    } catch (e) {
        errors.push(`main.js: ${e instanceof Error ? e.message : String(e)}`);
    }

    // The final inline script in map-view.html calls window.Main.initialize(config).
    // If main.js failed to load, window.Main is undefined and this throws.
    const main = windowObj.Main as Record<string, unknown> | undefined;
    if (main && typeof main.initialize === 'function') {
        try {
            (main.initialize as (config: unknown) => void)({
                mapStyleUrl: 'https://example.com/style.json',
                geocodingApiKey: '',
                photonSearchUrl: 'https://photon.example/api',
                enableSearch: false,
                searchResultsTransparency: 20,
                flyToDuration: 500,
                initialViewState: null
            });
            initializeCalls += 1;
        } catch (e) {
            errors.push(`initialize: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    return { main, initializeCalls, posted, errors };
}

suite('Map webview bootstrap', () => {
    test('main.js loads and window.Main.initialize is invoked', () => {
        const harness = loadBootstrap();
        assert.strictEqual(harness.errors.length, 0, `bootstrap threw: ${harness.errors.join('; ')}`);
        assert.ok(harness.main, 'window.Main should be defined after main.js loads');
        assert.strictEqual(harness.initializeCalls, 1, 'window.Main.initialize should be called exactly once');
    });

    test('acquireVsCodeApi is not called more than once', () => {
        const harness = loadBootstrap();
        assert.strictEqual(harness.errors.length, 0, `bootstrap threw: ${harness.errors.join('; ')}`);
        assert.strictEqual(harness.initializeCalls, 1, 'map must bootstrap without a second acquireVsCodeApi call');
    });
});
