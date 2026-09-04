import * as assert from 'assert';
import type * as vscode from 'vscode';
import { MockWebview } from '../testUtils/mockWebview';
import { loadWithStubbedVscode, type VscodeStubState } from '../testUtils/loadWithStubbedVscode';
import type { MapConfig, StoredViewState } from '../../map/mapWebviewTypes';

/**
 * Tests that load the *real* MapWebviewController and MapWebviewUtils source
 * while stubbing the `vscode` module (same technique as geocodingStaleResponse),
 * giving genuine line/statement coverage of the map module instead of
 * re-implementing its behavior in a mock.
 */

type ViewState = { center: { latitude: number; longitude: number }; zoom: number; bearing: number; pitch: number };

const utilsLoaded = loadWithStubbedVscode<typeof import('../../map/mapWebviewUtils')>('../../map/mapWebviewUtils');
const utilsModule = utilsLoaded.module;

interface ControllerModule {
    MapWebviewController: typeof import('../../map/mapWebviewController').MapWebviewController;
}

const controllerLoaded: { module: ControllerModule; vscodeState: VscodeStubState } =
    loadWithStubbedVscode<ControllerModule>('../../map/mapWebviewController');
const { MapWebviewController } = controllerLoaded.module;

function makeUri(): vscode.Uri {
    return { fsPath: process.cwd() } as vscode.Uri;
}

function baseConfig(): MapConfig {
    return {
        geocodingApiKey: '',
        photonSearchUrl: 'https://photon.example/',
        enableSearch: true,
        searchResultsTransparency: 20,
        flyToDuration: 500
    };
}

class Testable extends MapWebviewController {
    private webview_: vscode.Webview | undefined;
    private type_ = 'test-view';

    constructor(uri: vscode.Uri, styleUrl?: string, baseMapId?: string) {
        super(uri, undefined as never, styleUrl, baseMapId);
    }

    setWebview(w: vscode.Webview | undefined): void {
        this.webview_ = w;
    }

    connect(webview: vscode.Webview): void {
        this.setupMessageListener(webview);
    }

    protected override getWebview(): vscode.Webview | undefined {
        return this.webview_;
    }

    protected override getViewType(): string {
        return this.type_;
    }
}

suite('MapWebviewUtils real module', () => {
    let mock: MockWebview;

    setup(() => {
        mock = new MockWebview();
    });

    teardown(() => {
        mock.clearMessages();
        mock.clearTestHandlers();
    });

    test('getNonce returns a non-empty base64 string', () => {
        const nonce = utilsModule.getNonce();
        assert.strictEqual(typeof nonce, 'string');
        assert.ok(nonce.length > 0);
    });

    test('getMapConfiguration returns defaults when no settings present', () => {
        const config = utilsModule.getMapConfiguration();
        assert.strictEqual(config.geocodingApiKey, '');
        assert.strictEqual(config.photonSearchUrl, 'https://photon.komoot.io/api/');
        assert.strictEqual(config.enableSearch, true);
        assert.strictEqual(config.searchResultsTransparency, 20);
        assert.strictEqual(config.flyToDuration, 500);
        assert.strictEqual(config.initialViewState, undefined);
    });

    test('getMapConfiguration maps a stored lastViewState into initialViewState', () => {
        const loaded = loadWithStubbedVscode<typeof import('../../map/mapWebviewUtils')>('../../map/mapWebviewUtils');
        const stored: StoredViewState = {
            center: { lat: 59.3293, lng: 18.0686 },
            zoom: 12,
            bearing: 45,
            pitch: 30,
            baseMapId: 'osm'
        };
        loaded.vscodeState.setGetValues((key: string) => (key === 'lastViewState' ? stored : undefined));
        const config = loaded.module.getMapConfiguration();
        assert.deepStrictEqual(config.initialViewState, {
            center: { latitude: 59.3293, longitude: 18.0686 },
            zoom: 12,
            bearing: 45,
            pitch: 30
        });
    });

    test('saveViewStateToSettings persists a flattened state', async () => {
        const loaded = loadWithStubbedVscode<typeof import('../../map/mapWebviewUtils')>('../../map/mapWebviewUtils');
        const viewState: ViewState = { center: { latitude: 59.3, longitude: 18.1 }, zoom: 5, bearing: 10, pitch: 20 };
        await loaded.module.saveViewStateToSettings(viewState, 'osm');
        assert.strictEqual(loaded.vscodeState.updateCalls.length, 1);
        const call = loaded.vscodeState.updateCalls[0];
        assert.strictEqual(call.section, 'lastViewState');
        assert.deepStrictEqual(call.value, {
            center: { lat: 59.3, lng: 18.1 },
            zoom: 5,
            bearing: 10,
            pitch: 20,
            baseMapId: 'osm'
        });
        assert.strictEqual(call.target, 1);
    });

    test('generateWebviewHtml renders placeholders and injects initialViewState: null', () => {
        const html = utilsModule.generateWebviewHtml(
            makeUri(),
            mock as unknown as vscode.Webview,
            baseConfig(),
            'https://example.com/style.json',
            'mapsView'
        );
        assert.ok(html.includes('initialViewState: null'));
        assert.ok(html.includes('nonce-'), 'template should include the injected nonce');
        assert.ok(html.length > 0);
    });

    test('generateWebviewHtml embeds the configured style URL', () => {
        const html = utilsModule.generateWebviewHtml(
            makeUri(),
            mock as unknown as vscode.Webview,
            baseConfig(),
            'https://custom-style.example/style.json'
        );
        assert.ok(html.includes('https://custom-style.example/style.json'));
    });

    test('generateWebviewHtml injects initialViewState when provided', () => {
        const config = {
            ...baseConfig(),
            initialViewState: { center: { latitude: 59, longitude: 18 }, zoom: 5, bearing: 0, pitch: 0 }
        };
        const html = utilsModule.generateWebviewHtml(
            makeUri(),
            mock as unknown as vscode.Webview,
            config,
            undefined,
            'mapEditor'
        );
        assert.ok(
            html.includes('initialViewState: {"center":{"latitude":59,"longitude":18},"zoom":5,"bearing":0,"pitch":0}')
        );
    });

    test('parseViewStateFromMessage parses lat/lng based view state', () => {
        const result = utilsModule.parseViewStateFromMessage({
            type: 'viewStateChanged',
            viewState: { center: { lat: 59.3, lng: 18.1 }, zoom: 5, bearing: 10, pitch: 20 }
        });
        assert.ok(result);
        assert.deepStrictEqual(result!!.center, { latitude: 59.3, longitude: 18.1 });
        assert.strictEqual(result!!.zoom, 5);
        assert.strictEqual(result!!.bearing, 10);
        assert.strictEqual(result!!.pitch, 20);
    });

    test('parseViewStateFromMessage parses latitude/longitude based view state', () => {
        const result = utilsModule.parseViewStateFromMessage({
            type: 'viewStateChanged',
            viewState: { center: { latitude: 10, longitude: 20 }, zoom: 3 }
        });
        assert.ok(result);
        assert.deepStrictEqual(result!!.center, { latitude: 10, longitude: 20 });
        assert.strictEqual(result!!.bearing, 0, 'bearing defaults to 0 when absent');
        assert.strictEqual(result!!.pitch, 0, 'pitch defaults to 0 when absent');
    });

    test('parseViewStateFromMessage returns undefined when no center', () => {
        assert.strictEqual(utilsModule.parseViewStateFromMessage({ type: 'viewStateChanged', zoom: 5 }), undefined);
        assert.strictEqual(utilsModule.parseViewStateFromMessage('not-an-object'), undefined);
    });
});

suite('MapWebviewController real module - webview message broadcasts', () => {
    let mock: MockWebview;
    let controller: Testable;

    setup(() => {
        mock = new MockWebview();
        controller = new Testable(makeUri());
        controller.setWebview(mock);
    });

    teardown(() => {
        mock.clearMessages();
        mock.clearTestHandlers();
        MapWebviewController.lastActiveViewType = 'mapsView';
    });

    test('constructor captures initial style url and basemap id', () => {
        const c = new Testable(makeUri(), 'https://init/style.json', 'init-id');
        c.setWebview(undefined);
        c.setBaseMap({ id: 'b1', name: 'B', styleUrl: 'https://example/style.json' });
        // no throw; constructor stored the initial values
    });

    test('flyToLocation posts flyToLocation message', () => {
        controller.flyToLocation(59.5, 18.5);
        const messages = mock.getMessagesOfType('flyToLocation');
        assert.strictEqual(messages.length, 1);
        const msg = messages[0] as Record<string, unknown>;
        assert.strictEqual(msg.latitude, 59.5);
        assert.strictEqual(msg.longitude, 18.5);
        assert.strictEqual(msg.zoom, 14, 'default zoom when not provided');
    });

    test('flyToLocation uses provided zoom', () => {
        controller.flyToLocation(59.5, 18.5, 8);
        const msg = mock.getMessagesOfType('flyToLocation')[0] as Record<string, unknown>;
        assert.strictEqual(msg.zoom, 8);
    });

    test('fitBoundingBox posts message with coordinates and bbox', () => {
        const coordinate = { lat: 1, lng: 2 } as never;
        const bbox = { southwest: coordinate, northeast: coordinate };
        controller.fitBoundingBox([coordinate], bbox);
        const messages = mock.getMessagesOfType('fitBoundingBox');
        assert.strictEqual(messages.length, 1);
        const msg = messages[0] as Record<string, unknown>;
        assert.strictEqual(msg.boundingBox, bbox);
    });

    test('fitBoundsOnly posts message with bbox', () => {
        const coordinate = { lat: 1, lng: 2 } as never;
        const bbox = { southwest: coordinate, northeast: coordinate };
        controller.fitBoundsOnly(bbox);
        const messages = mock.getMessagesOfType('fitBoundsOnly');
        assert.strictEqual(messages.length, 1);
        assert.strictEqual((messages[0] as Record<string, unknown>).boundingBox, bbox);
    });

    test('setBaseMap posts setBaseMap with resolved vector type', () => {
        controller.setBaseMap({ id: 'b1', name: 'B', styleUrl: 'https://example/style.json' });
        const messages = mock.getMessagesOfType('setBaseMap');
        assert.strictEqual(messages.length, 1);
        const msg = (messages[0] as Record<string, unknown>).basemap as Record<string, unknown>;
        assert.strictEqual(msg.type, 'vector');
        assert.strictEqual(msg.styleUrl, 'https://example/style.json');
    });

    test('setBaseMap defaults type to raster when no styleUrl present', () => {
        controller.setBaseMap({ id: 'b2', name: 'R', type: 'raster', tileUrl: 'https://tiles/{z}/{x}/{y}.png' });
        const msg = (mock.getMessagesOfType('setBaseMap')[0] as Record<string, unknown>).basemap as Record<string, unknown>;
        assert.strictEqual(msg.type, 'raster');
    });

    test('updateOverlayLayers posts layers message', () => {
        const layers = [{ id: 'l1', name: 'L1', type: 'geojson', visible: true }] as never;
        controller.updateOverlayLayers(layers as never);
        const messages = mock.getMessagesOfType('updateOverlayLayers');
        assert.strictEqual(messages.length, 1);
        assert.strictEqual((messages[0] as Record<string, unknown>).layers, layers);
    });

    test('updateSelectedFileLayer posts geojson message', () => {
        controller.updateSelectedFileLayer({ type: 'FeatureCollection', features: [] });
        assert.strictEqual(mock.getMessagesOfType('updateSelectedFileLayer').length, 1);
    });

    test('setMapLanguage posts languageChange message', () => {
        controller.setMapLanguage('sv');
        const messages = mock.getMessagesOfType('languageChange');
        assert.strictEqual(messages.length, 1);
        assert.strictEqual((messages[0] as Record<string, unknown>).language, 'sv');
    });

    test('updateConfiguration posts configUpdate message', () => {
        controller.updateConfiguration();
        const messages = mock.getMessagesOfType('configUpdate');
        assert.strictEqual(messages.length, 1);
        assert.ok((messages[0] as Record<string, unknown>).config);
    });

    test('broadcast methods no-op without a webview', () => {
        controller.setWebview(undefined);
        assert.doesNotThrow(() => {
            controller.flyToLocation(1, 2);
            controller.fitBoundingBox([], { southwest: {} as never, northeast: {} as never });
            controller.fitBoundsOnly({ southwest: {} as never, northeast: {} as never });
            controller.setBaseMap({ id: 'x', name: 'X' });
            controller.updateOverlayLayers([]);
            controller.updateSelectedFileLayer(null);
            controller.setMapLanguage('en');
            controller.updateConfiguration();
        });
        assert.strictEqual(mock.postedMessages.length, 0);
    });
});

suite('MapWebviewController real module - message handling', () => {
    let mock: MockWebview;
    let controller: Testable;

    setup(() => {
        mock = new MockWebview();
        controller = new Testable(makeUri());
        controller.setWebview(mock);
    });

    teardown(() => {
        mock.clearMessages();
        mock.clearTestHandlers();
        MapWebviewController.lastActiveViewType = 'mapsView';
    });

    test('non-object messages are ignored', async () => {
        await controller.handleWebviewMessage(null);
        await controller.handleWebviewMessage('type-string');
        await controller.handleWebviewMessage({});
        assert.strictEqual(mock.postedMessages.length, 0);
    });

    test('viewStateChanged updates active viewType and persists state', async () => {
        const before = controllerLoaded.vscodeState.updateCalls.length;
        await controller.handleWebviewMessage({
            type: 'viewStateChanged',
            viewState: { center: { lat: 59.3, lng: 18.1 }, zoom: 5, bearing: 0, pitch: 0 }
        });
        assert.strictEqual(MapWebviewController.lastActiveViewType, 'test-view');
        assert.strictEqual(controllerLoaded.vscodeState.updateCalls.length, before + 1, 'view state is persisted');
    });

    test('viewStateChanged resolves a pending getCurrentViewState', async () => {
        const statePromise = controller.getCurrentViewState();
        await controller.handleWebviewMessage({
            type: 'viewStateChanged',
            viewState: { center: { lat: 60, lng: 20 }, zoom: 6, bearing: 45, pitch: 30 }
        });
        const state = await statePromise;
        assert.ok(state);
        assert.deepStrictEqual(state!!.center, { latitude: 60, longitude: 20 });
    });

    test('viewStateChanged without a valid center does not resolve pending state', async () => {
        const statePromise = controller.getCurrentViewState();
        await controller.handleWebviewMessage({ type: 'viewStateChanged', zoom: 4 });
        const state = await statePromise;
        assert.strictEqual(state, undefined);
    });

    test('contextMenu with lngLat sets active view type', async () => {
        MapWebviewController.lastActiveViewType = 'mapsView';
        await controller.handleWebviewMessage({ type: 'contextMenu', lngLat: { lng: 18.1, lat: 59.3 } });
        assert.strictEqual(MapWebviewController.lastActiveViewType, 'test-view');
    });

    test('contextMenu without lngLat is ignored', async () => {
        MapWebviewController.lastActiveViewType = 'mapsView';
        await controller.handleWebviewMessage({ type: 'contextMenu' });
        assert.strictEqual(MapWebviewController.lastActiveViewType, 'mapsView');
    });

    test('geocodingSearch posts results for a short query', async () => {
        await controller.handleWebviewMessage({ type: 'geocodingSearch', query: 'x' });
        // query length < 2 short-circuits to empty results
        const messages = mock.getMessagesOfType('geocodingSearchResults');
        assert.strictEqual(messages.length, 1);
        assert.deepStrictEqual((messages[0] as { results: unknown[] }).results, []);
    });

    test('mapReady triggers the ready callback', async () => {
        let fired = false;
        controller.onMapReady(() => {
            fired = true;
        });
        await controller.handleWebviewMessage({ type: 'mapReady' });
        assert.strictEqual(fired, true);
        assert.strictEqual(MapWebviewController.lastActiveViewType, 'test-view');
    });

    test('mapError shows a VS Code error notification', async () => {
        const before = controllerLoaded.vscodeState.errorMessages.length;
        await controller.handleWebviewMessage({
            type: 'mapError',
            message: 'Failed to load map: boom'
        });
        assert.strictEqual(controllerLoaded.vscodeState.errorMessages.length, before + 1);
        assert.strictEqual(
            controllerLoaded.vscodeState.errorMessages[controllerLoaded.vscodeState.errorMessages.length - 1],
            'Failed to load map: boom'
        );
    });

    test('mapError logs details to the output channel', async () => {
        await controller.handleWebviewMessage({
            type: 'mapError',
            message: 'Failed to load map: boom',
            details: '{"message":"boom"}',
            stack: 'at map-core.js:1',
            source: 'style'
        });
        const channel = controllerLoaded.vscodeState.outputChannels.find((c) => c.name === 'MapLibre Viewer');
        assert.ok(channel, 'an output channel is created');
        assert.ok(channel!!.lines.some((l) => l.includes('Failed to load map: boom')));
        assert.ok(channel!!.lines.some((l) => l.includes('Source: style')));
        assert.ok(channel!!.lines.some((l) => l.includes('Details: {"message":"boom"}')));
        assert.ok(channel!!.lines.some((l) => l.includes('Stack: at map-core.js:1')));
    });

    test('mapError button reveals the error log', async () => {
        controllerLoaded.vscodeState.errorSelections.push('Show Error Log');
        await controller.handleWebviewMessage({
            type: 'mapError',
            message: 'Failed to load map: boom'
        });
        const channel = controllerLoaded.vscodeState.outputChannels.find((c) => c.name === 'MapLibre Viewer');
        assert.ok(channel, 'an output channel is created');
        assert.strictEqual(channel!!.shown, true, 'output channel is revealed when the button is pressed');
    });

    test('log message is written to the output channel', async () => {
        await controller.handleWebviewMessage({
            type: 'log',
            level: 'warn',
            args: 'Map not initialized'
        });
        const channel = controllerLoaded.vscodeState.outputChannels.find((c) => c.name === 'MapLibre Viewer');
        assert.ok(channel, 'an output channel is created');
        assert.ok(channel!!.lines.some((l) => l.includes('[WARN] Map not initialized')));
    });

    test('controller actions log info to the output channel', async () => {
        controller.setBaseMap({ id: 'osm', name: 'OpenStreetMap', styleUrl: 'https://example.com/style.json' });
        controller.updateOverlayLayers([{ id: 'a', visible: true } as never]);
        controller.flyToLocation(59.3, 18.1, 12);
        const channel = controllerLoaded.vscodeState.outputChannels.find((c) => c.name === 'MapLibre Viewer');
        assert.ok(channel, 'an output channel is created');
        assert.ok(channel!!.lines.some((l) => l.includes('[INFO] Setting basemap to "OpenStreetMap" (osm)')));
        assert.ok(channel!!.lines.some((l) => l.includes('[INFO] Updating 1 overlay layer(s)')));
        assert.ok(channel!!.lines.some((l) => l.includes('[INFO] Flying to location (59.3, 18.1) at zoom 12')));
    });

    test('mapCenterResponse resolves a pending getMapCenter', async () => {
        const centerPromise = controller.getMapCenter();
        await controller.handleWebviewMessage({
            type: 'mapCenterResponse',
            center: { latitude: 59, longitude: 18 },
            zoom: 4,
            bearing: 90,
            pitch: 45
        });
        const result = await centerPromise;
        assert.ok(result);
        assert.strictEqual(result!!.zoom, 4);
    });

    test('mapCenterResponse with error resolves undefined', async () => {
        const centerPromise = controller.getMapCenter();
        await controller.handleWebviewMessage({ type: 'mapCenterResponse', error: 'nope' });
        const result = await centerPromise;
        assert.strictEqual(result, undefined);
    });

    test('mouseMove executes the updateCoordinates command', async () => {
        await controller.handleWebviewMessage({ type: 'mouseMove', lngLat: { lng: 17, lat: 55 } });
        assert.ok(controllerLoaded.vscodeState.executeCommands.includes('vscodeMaplibreViewer.updateCoordinates'));
    });

    test('saveCurrentViewState persists last view state', async () => {
        const before = controllerLoaded.vscodeState.updateCalls.length;
        await controller.handleWebviewMessage({
            type: 'viewStateChanged',
            viewState: { center: { lat: 59, lng: 18 }, zoom: 7, bearing: 0, pitch: 0 }
        });
        const afterFirst = controllerLoaded.vscodeState.updateCalls.length;
        await controller.saveCurrentViewState();
        assert.ok(controllerLoaded.vscodeState.updateCalls.length >= afterFirst + 1);
        assert.ok(controllerLoaded.vscodeState.updateCalls.length >= before + 2);
    });
});

suite('MapWebviewController real module - async helpers without webview / timeouts', () => {
    test('queryWebview resolves undefined without a webview', async () => {
        const controller = new Testable(makeUri());
        controller.setWebview(undefined);
        const result = await controller.queryWebview('isAvailable');
        assert.strictEqual(result, undefined);
    });

    test('getCurrentViewState resolves undefined without a webview', async () => {
        const controller = new Testable(makeUri());
        controller.setWebview(undefined);
        const result = await controller.getCurrentViewState();
        assert.strictEqual(result, undefined);
    });

    test('getMapCenter resolves undefined without a webview', async () => {
        const controller = new Testable(makeUri());
        controller.setWebview(undefined);
        const result = await controller.getMapCenter();
        assert.strictEqual(result, undefined);
    });
});

suite('MapWebviewController real module - __testQuery round trip via MockWebview', () => {
    test('queryWebview resolves a __testResponse result', async () => {
        const mock = new MockWebview();
        const controller = new Testable(makeUri());
        controller.setWebview(mock);
        controller.connect(mock);
        mock.onTestQuery('isAvailable', () => true);
        const result = await controller.queryWebview('isAvailable');
        assert.strictEqual(result, true);
    });

    test('queryWebview rejects when __testResponse carries an error', async () => {
        const mock = new MockWebview();
        const controller = new Testable(makeUri());
        controller.setWebview(mock);
        controller.connect(mock);
        mock.onTestQuery('broken', () => {
            throw new Error('boom');
        });
        await assert.rejects(() => controller.queryWebview('broken'), /boom/);
    });

    test('queryWebview passes args to the handler', async () => {
        const mock = new MockWebview();
        const controller = new Testable(makeUri());
        controller.setWebview(mock);
        controller.connect(mock);
        mock.onTestQuery('echo', (args) => args);
        const result = (await controller.queryWebview('echo', ['a', 'b'])) as unknown[];
        assert.deepStrictEqual(result, ['a', 'b']);
    });
});
