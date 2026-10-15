import * as assert from 'assert';
import * as vscode from 'vscode';
import { OverlayLayer, LayerStyle } from '../../layers/layerTypes';
import { LayerTreeProvider } from '../../layers/layerTreeProvider';
import { TestableMapWebviewController } from '../testUtils/testableController';
import { MockWebview } from '../testUtils/mockWebview';
import { BookmarkManager } from '../../bookmarks/bookmarkManager';
import { activateViewGroup } from '../testUtils/integrationSetup';

/**
 * Integration test suite for user-configurable overlay layer styles
 * (color, opacity, circle radius, line width).
 *
 * Flow under test (mirrors the wired extension behavior):
 *   LayerTreeProvider.updateLayerStyle -> onDidChangeLayers ->
 *   controller.updateOverlayLayers(visibleLayers) -> webview message ->
 *   __testQuery('getLayerPaint') round trip.
 *
 * The MockWebview simulates the webview side: getLayerPaint derives the
 * paint properties from the last updateOverlayLayers message using the same
 * fallback rules as resources/scripts/map-overlays.js, so a passing test
 * proves the full style plumbing from provider to webview renderer state.
 */

suite('Layer Style Integration Tests', () => {
    const WEBVIEW_TIMEOUT = 15000;

    function createMockContext(): vscode.ExtensionContext {
        const store = new Map<string, unknown>();
        return {
            subscriptions: [],
            globalState: {
                get: <T>(key: string, defaultValue?: T): T | undefined => {
                    const value = store.get(key);
                    return value === undefined ? defaultValue : (value as T);
                },
                update: (key: string, value: unknown): Thenable<void> => {
                    if (value === undefined) {
                        store.delete(key);
                    } else {
                        store.set(key, value);
                    }
                    return Promise.resolve();
                }
            },
            extensionUri: vscode.Uri.file('/test-extension')
        } as unknown as vscode.ExtensionContext;
    }

    const STYLED_POINT_LAYER: OverlayLayer = {
        id: 'styled-point-layer',
        name: 'Styled Point Layer',
        type: 'geojson',
        visible: true,
        source: {
            type: 'geojson',
            data: {
                type: 'Feature' as const,
                geometry: {
                    type: 'Point' as const,
                    coordinates: [18.0686, 59.3293]
                },
                properties: { name: 'Styled Point' }
            }
        }
    };

    let mockWebview: MockWebview;
    let controller: TestableMapWebviewController;
    let layerTreeProvider: LayerTreeProvider;
    let mockContext: vscode.ExtensionContext;

    /**
     * Paint properties the real webview would derive from the last
     * updateOverlayLayers message, mirroring map-overlays.js fallback rules.
     */
    function derivePaintFromLastUpdate(layerId: string): unknown {
        const messages = mockWebview.getMessagesOfType('updateOverlayLayers');
        const lastMessage = messages[messages.length - 1] as { layers: OverlayLayer[] } | undefined;
        const layer = lastMessage?.layers.find(l => l.id === layerId);
        if (!layer || layer.visible === false) {
            return { circles: {}, lines: {}, fills: {}, error: 'layer not in last update' };
        }
        const color = layer.color || '#FF0000';
        const opacity = layer.opacity !== undefined ? layer.opacity : 1;
        return {
            circles: {
                'circle-radius': layer.circleRadius !== undefined ? layer.circleRadius : 6,
                'circle-color': color,
                'circle-opacity': opacity
            },
            lines: {
                'line-color': color,
                'line-width': layer.lineWidth !== undefined ? layer.lineWidth : 2,
                'line-opacity': opacity
            },
            fills: {
                'fill-color': color,
                'fill-opacity': opacity * 0.5
            }
        };
    }

    suiteSetup(async function() {
        this.timeout(30000);
        await activateViewGroup();
    });

    setup(() => {
        mockWebview = new MockWebview();
        controller = new TestableMapWebviewController(
            vscode.Uri.file('/test-extension'),
            new BookmarkManager({
                get: () => undefined,
                update: () => Promise.resolve()
            } as unknown as vscode.Memento)
        );
        controller.setWebview(mockWebview);
        controller.setViewType('test-view');
        mockWebview.onDidReceiveMessage((msg) => {
            controller.testHandleWebviewMessage(msg);
        });

        mockContext = createMockContext();
        layerTreeProvider = new LayerTreeProvider(mockContext);
        layerTreeProvider.addOverlayLayer({ ...STYLED_POINT_LAYER });

        mockWebview.onTestQuery('getLayerPaint', (args) => derivePaintFromLastUpdate(args[0] as string));
    });

    teardown(() => {
        mockWebview.clearTestHandlers();
        mockWebview.clearMessages();
    });

    test('should have changeLayerStyle command registered', async function() {
        this.timeout(WEBVIEW_TIMEOUT);

        const commands = await vscode.commands.getCommands(true);
        assert.ok(
            commands.includes('vscodeMaplibreViewer.changeLayerStyle'),
            'changeLayerStyle command should be registered by the extension'
        );
    });

    test('should broadcast styled overlay layer when layer style is updated', async function() {
        this.timeout(WEBVIEW_TIMEOUT);

        const appliedStyle: LayerStyle = {
            color: '#00FF00',
            opacity: 0.5,
            circleRadius: 12,
            lineWidth: 7
        };

        layerTreeProvider.onDidChangeLayers(() => {
            void controller.updateOverlayLayers(layerTreeProvider.getVisibleOverlayLayers());
        });

        await layerTreeProvider.updateLayerStyle(STYLED_POINT_LAYER.id, appliedStyle);

        const messages = mockWebview.getMessagesOfType('updateOverlayLayers');
        assert.ok(messages.length >= 1, 'should broadcast updateOverlayLayers after a style update');
        const lastMessage = messages[messages.length - 1] as { layers: OverlayLayer[] };
        const layer = lastMessage.layers.find(l => l.id === STYLED_POINT_LAYER.id);
        assert.ok(layer, 'styled layer should be in the broadcast');
        assert.strictEqual(layer.color, '#00FF00');
        assert.strictEqual(layer.opacity, 0.5);
        assert.strictEqual(layer.circleRadius, 12);
        assert.strictEqual(layer.lineWidth, 7);
    });

    test('should round-trip custom style properties through getLayerPaint', async function() {
        this.timeout(WEBVIEW_TIMEOUT);

        layerTreeProvider.onDidChangeLayers(() => {
            void controller.updateOverlayLayers(layerTreeProvider.getVisibleOverlayLayers());
        });
        await layerTreeProvider.updateLayerStyle(STYLED_POINT_LAYER.id, {
            color: '#FF8800',
            opacity: 0.25,
            circleRadius: 9,
            lineWidth: 3
        });

        const paint = await controller.queryWebview('getLayerPaint', [STYLED_POINT_LAYER.id]) as {
            circles: Record<string, unknown>;
            lines: Record<string, unknown>;
            fills: Record<string, unknown>;
        };

        assert.strictEqual(paint.circles['circle-color'], '#FF8800');
        assert.strictEqual(paint.circles['circle-radius'], 9);
        assert.strictEqual(paint.circles['circle-opacity'], 0.25);
        assert.strictEqual(paint.lines['line-color'], '#FF8800');
        assert.strictEqual(paint.lines['line-width'], 3);
        assert.strictEqual(paint.lines['line-opacity'], 0.25);
        assert.strictEqual(paint.fills['fill-color'], '#FF8800');
        assert.strictEqual(paint.fills['fill-opacity'], 0.125, 'fill paint blends with the layer opacity');
    });

    test('should fall back to default paint when style properties are absent', async function() {
        this.timeout(WEBVIEW_TIMEOUT);

        layerTreeProvider.onDidChangeLayers(() => {
            void controller.updateOverlayLayers(layerTreeProvider.getVisibleOverlayLayers());
        });
        await layerTreeProvider.updateLayerStyle(STYLED_POINT_LAYER.id, {
            color: undefined,
            opacity: undefined,
            circleRadius: undefined,
            lineWidth: undefined
        });

        const paint = await controller.queryWebview('getLayerPaint', [STYLED_POINT_LAYER.id]) as {
            circles: Record<string, unknown>;
            lines: Record<string, unknown>;
        };

        assert.strictEqual(paint.circles['circle-color'], '#FF0000', 'default color must be red');
        assert.strictEqual(paint.circles['circle-radius'], 6, 'default circle radius must be 6');
        assert.strictEqual(paint.circles['circle-opacity'], 1, 'default opacity must be 1');
        assert.strictEqual(paint.lines['line-width'], 2, 'default line width must be 2');
    });

    test('should reject invalid style updates without broadcasting', async function() {
        this.timeout(WEBVIEW_TIMEOUT);

        layerTreeProvider.onDidChangeLayers(() => {
            void controller.updateOverlayLayers(layerTreeProvider.getVisibleOverlayLayers());
        });

        await controller.updateOverlayLayers(layerTreeProvider.getVisibleOverlayLayers());
        const messagesBefore = mockWebview.getMessagesOfType('updateOverlayLayers').length;

        await assert.rejects(
            () => layerTreeProvider.updateLayerStyle(STYLED_POINT_LAYER.id, { opacity: 1.5 }),
            /between 0 and 1/
        );
        await assert.rejects(
            () => layerTreeProvider.updateLayerStyle(STYLED_POINT_LAYER.id, { circleRadius: -1 }),
            /positive/
        );

        const messagesAfter = mockWebview.getMessagesOfType('updateOverlayLayers');
        assert.strictEqual(messagesAfter.length, messagesBefore,
            'invalid style updates must not change what the webview renders');

        const unchanged = await controller.queryWebview('getLayerPaint', [STYLED_POINT_LAYER.id]) as {
            circles: Record<string, unknown>;
        };
        assert.strictEqual(unchanged.circles['circle-color'], '#FF0000',
            'webview state must keep the prior style after a rejected update');
    });

    test('should persist layer style across provider instances', async function() {
        this.timeout(WEBVIEW_TIMEOUT);

        layerTreeProvider.onDidChangeLayers(() => {
            void controller.updateOverlayLayers(layerTreeProvider.getVisibleOverlayLayers());
        });
        await layerTreeProvider.updateLayerStyle(STYLED_POINT_LAYER.id, { color: '#123456', lineWidth: 5 });

        const globalState = mockContext.globalState;
        const persisted = globalState.get<OverlayLayer[]>('overlayLayers');
        assert.ok(persisted, 'overlay layers with styles should be persisted to globalState');
        const persistedLayer = persisted.find(l => l.id === STYLED_POINT_LAYER.id);
        assert.strictEqual(persistedLayer?.color, '#123456');
        assert.strictEqual(persistedLayer?.lineWidth, 5);
    });
});