import * as assert from 'assert';
import type * as vscode from 'vscode';
import { MockWebview } from '../testUtils/mockWebview';
import { loadWithStubbedVscode } from '../testUtils/loadWithStubbedVscode';

/**
 * Tests for the featureInfoUpdate protocol between the webview and the
 * MapWebviewController, and the parse/validation logic in mapWebviewUtils.
 * Both modules are loaded for real with a stubbed vscode module.
 */

const utilsLoaded = loadWithStubbedVscode<typeof import('../../map/mapWebviewUtils')>('../../map/mapWebviewUtils');
const utilsModule = utilsLoaded.module;

interface ControllerModule {
    MapWebviewController: typeof import('../../map/mapWebviewController').MapWebviewController;
}
const controllerLoaded = loadWithStubbedVscode<ControllerModule>('../../map/mapWebviewController');
const { MapWebviewController } = controllerLoaded.module;

function makeUri(): vscode.Uri {
    return { fsPath: process.cwd() } as vscode.Uri;
}

class Testable extends MapWebviewController {
    private webview_: vscode.Webview | undefined;

    constructor(uri: vscode.Uri) {
        super(uri, undefined as never);
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
        return 'test-view';
    }

    public async testHandleWebviewMessage(message: unknown): Promise<void> {
        return this.handleWebviewMessage(message);
    }
}

const validMessage = {
    type: 'featureInfoUpdate',
    lngLat: { lng: 18.06, lat: 59.32 },
    features: [
        {
            source: 'overlay-pois',
            layerId: 'overlay-pois-circles',
            layerName: 'Points of Interest',
            geometryType: 'Point',
            properties: { name: 'Cafe' }
        },
        {
            source: 'demotiles',
            layerId: 'background',
            geometryType: 'Polygon',
            properties: { class: 'land' }
        }
    ]
};

suite('parseFeatureInfoUpdate', () => {
    test('parses a valid message with typed features', () => {
        const parsed = utilsModule.parseFeatureInfoUpdate(validMessage);
        assert.ok(parsed);
        assert.deepStrictEqual(parsed!.lngLat, { lng: 18.06, lat: 59.32 });
        assert.strictEqual(parsed!.features.length, 2);
        assert.strictEqual(parsed!.features[0].source, 'overlay-pois');
        assert.strictEqual(parsed!.features[0].layerName, 'Points of Interest');
        assert.deepStrictEqual(parsed!.features[0].properties, { name: 'Cafe' });
    });

    test('rejects non-object and wrong-type messages', () => {
        assert.strictEqual(utilsModule.parseFeatureInfoUpdate(undefined), undefined);
        assert.strictEqual(utilsModule.parseFeatureInfoUpdate('nope'), undefined);
        assert.strictEqual(utilsModule.parseFeatureInfoUpdate({ type: 'other' }), undefined);
    });

    test('rejects messages with missing or malformed lngLat', () => {
        assert.strictEqual(
            utilsModule.parseFeatureInfoUpdate({ type: 'featureInfoUpdate', features: [] }),
            undefined
        );
        assert.strictEqual(
            utilsModule.parseFeatureInfoUpdate({ type: 'featureInfoUpdate', lngLat: { lat: 1 }, features: [] }),
            undefined
        );
        assert.strictEqual(
            utilsModule.parseFeatureInfoUpdate({ type: 'featureInfoUpdate', lngLat: { lng: 'x', lat: 1 }, features: [] }),
            undefined
        );
    });

    test('rejects messages whose features are not an array', () => {
        assert.strictEqual(
            utilsModule.parseFeatureInfoUpdate({ type: 'featureInfoUpdate', lngLat: { lng: 1, lat: 2 }, features: 'nope' }),
            undefined
        );
    });

    test('skips malformed feature entries but keeps valid ones', () => {
        const parsed = utilsModule.parseFeatureInfoUpdate({
            type: 'featureInfoUpdate',
            lngLat: { lng: 1, lat: 2 },
            features: [
                'not-an-object',
                { layerId: 'missing-source' },
                { source: 's', layerId: 'l', geometryType: 'Point' }
            ]
        });
        assert.ok(parsed);
        assert.strictEqual(parsed!.features.length, 1);
        assert.strictEqual(parsed!.features[0].source, 's');
    });

    test('feature without properties yields an empty properties object', () => {
        const parsed = utilsModule.parseFeatureInfoUpdate({
            type: 'featureInfoUpdate',
            lngLat: { lng: 1, lat: 2 },
            features: [{ source: 's', layerId: 'l', geometryType: 'Point' }]
        });
        assert.ok(parsed);
        assert.deepStrictEqual(parsed!.features[0].properties, {});
    });

    test('isOverlayFeature distinguishes overlay vs basemap sources', () => {
        const parsed = utilsModule.parseFeatureInfoUpdate(validMessage);
        assert.ok(parsed);
        assert.strictEqual(utilsModule.isOverlayFeature(parsed!.features[0]), true);
        assert.strictEqual(utilsModule.isOverlayFeature(parsed!.features[1]), false);
    });

    test('formatClickedFeatureLabel prefers layerName then stripped overlay id then layer id', () => {
        assert.strictEqual(
            utilsModule.formatClickedFeatureLabel({ source: 'overlay-abc', layerId: 'overlay-abc-fills', geometryType: 'Polygon', properties: {} }),
            'abc'
        );
        assert.strictEqual(
            utilsModule.formatClickedFeatureLabel({ source: 'overlay-abc', layerId: 'overlay-abc-fills', layerName: 'Fancy Layer', geometryType: 'Polygon', properties: {} }),
            'Fancy Layer'
        );
        assert.strictEqual(
            utilsModule.formatClickedFeatureLabel({ source: 'demotiles', layerId: 'background', geometryType: 'Polygon', properties: {} }),
            'background (demotiles)'
        );
    });

    test('formatGeometryType maps geometry keywords to readable labels', () => {
        assert.strictEqual(utilsModule.formatGeometryType('Point'), 'Point');
        assert.strictEqual(utilsModule.formatGeometryType('LineString'), 'Line');
        assert.strictEqual(utilsModule.formatGeometryType('Polygon'), 'Polygon');
        assert.strictEqual(utilsModule.formatGeometryType('MultiPolygon'), 'Multi-Polygon');
        assert.strictEqual(utilsModule.formatGeometryType('Unknown'), 'Unknown');
    });
});

suite('MapWebviewController featureInfoUpdate handling', () => {
    let mock: MockWebview;
    let controller: Testable;
    let received: Array<Record<string, unknown>>;

    setup(() => {
        mock = new MockWebview();
        controller = new Testable(makeUri());
        controller.setWebview(mock);
        controller.connect(mock);
        received = [];
        const event = controller.onFeatureInfoUpdate;
        assert.ok(event, 'controller should expose onFeatureInfoUpdate');
        event((message) => {
            received.push(message as unknown as Record<string, unknown>);
        });
    });

    teardown(() => {
        mock.clearMessages();
        mock.clearTestHandlers();
    });

    test('featureInfoUpdate message fires onFeatureInfoUpdate with parsed data', async () => {
        await controller.testHandleWebviewMessage(validMessage);

        assert.strictEqual(received.length, 1);
        assert.deepStrictEqual(received[0].lngLat, { lng: 18.06, lat: 59.32 });
        assert.strictEqual((received[0].features as unknown[]).length, 2);
    });

    test('malformed featureInfoUpdate message does not fire the event', async () => {
        await controller.testHandleWebviewMessage({ type: 'featureInfoUpdate', lngLat: { lat: 1 } });
        await controller.testHandleWebviewMessage({ type: 'featureInfoUpdate', features: [] });

        assert.strictEqual(received.length, 0, 'no event should fire for malformed messages');
    });

    test('onFeatureInfoUpdate lazily creates a single emitter per controller', () => {
        const first = controller.onFeatureInfoUpdate;
        const second = controller.onFeatureInfoUpdate;
        assert.ok(first && second, 'event getter should return an event');
    });
});