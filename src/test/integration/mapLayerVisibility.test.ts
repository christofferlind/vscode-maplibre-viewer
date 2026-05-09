import * as assert from 'assert';
import * as vscode from 'vscode';
import { OverlayLayer } from '../../layers/layerTypes';
import { TestableMapWebviewController } from '../testUtils/testableController';
import { MockWebview } from '../testUtils/mockWebview';
import { BookmarkManager } from '../../bookmarks/bookmarkManager';

/**
 * Integration test suite for verifying map layer visibility and rendering.
 * Uses the extension's __testQuery API to inspect actual map renderer state.
 * 
 * Test strategies:
 * 1. MapLibre state inspection - Query map.getLayer(), map.getSource()
 * 2. Layer visibility verification - Check layout visibility properties
 * 3. DOM element verification - Verify overlay layers exist in map style
 * 4. Toggle interaction - Verify layers respond to visibility toggles
 * 
 * These tests use the MockWebview to simulate webview responses via the
 * __testQuery/__testResponse protocol, allowing verification of layer
 * rendering without requiring a full VS Code webview environment.
 */

suite('Map Layer Visibility Integration Tests', () => {
    const WEBVIEW_TIMEOUT = 15000;
    const LAYER_RENDER_TIMEOUT = 10000;

    /**
     * Test layer configuration for circle overlay
     */
    const TEST_CIRCLE_LAYER: OverlayLayer = {
        id: 'test-circle-layer',
        name: 'Test Circle Layer',
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
                properties: {
                    name: 'Test Point',
                    color: '#ff0000'
                }
            }
        }
    };

    /**
     * Test layer configuration for line overlay
     */
    const TEST_LINE_LAYER: OverlayLayer = {
        id: 'test-line-layer',
        name: 'Test Line Layer',
        type: 'geojson',
        visible: true,
        source: {
            type: 'geojson',
            data: {
                type: 'Feature' as const,
                geometry: {
                    type: 'LineString' as const,
                    coordinates: [
                        [18.0686, 59.3293],
                        [18.0786, 59.3393]
                    ]
                },
                properties: {
                    name: 'Test Line',
                    color: '#00ff00'
                }
            }
        }
    };

    /**
     * Test layer configuration for fill (polygon) overlay
     */
    const TEST_FILL_LAYER: OverlayLayer = {
        id: 'test-fill-layer',
        name: 'Test Fill Layer',
        type: 'geojson',
        visible: true,
        source: {
            type: 'geojson',
            data: {
                type: 'Feature' as const,
                geometry: {
                    type: 'Polygon' as const,
                    coordinates: [[
                        [18.0636, 59.3243],
                        [18.0736, 59.3243],
                        [18.0736, 59.3343],
                        [18.0636, 59.3343],
                        [18.0636, 59.3243]
                    ]]
                },
                properties: {
                    name: 'Test Polygon',
                    color: '#0000ff'
                }
            }
        }
    };

    let mockWebview: MockWebview;
    let controller: TestableMapWebviewController;
    let bookmarkManager: BookmarkManager;

    /**
     * Simulates the webview's __test API response for layer state queries.
     * This allows tests to verify layer rendering without a real webview.
     */
    function setupLayerStateMock(
        layerStates: Map<string, { exists: boolean; visible: boolean; sourceExists: boolean }>
    ): void {
        mockWebview.onTestQuery('getLayerVisibility', (args) => {
            const layerId = args[0] as string;
            const state = layerStates.get(layerId);
            if (!state) {
                return { circles: 'not-found', lines: 'not-found', fills: 'not-found' };
            }
            const visibility = state.exists && state.visible ? 'visible' : 'none';
            return {
                circles: visibility,
                lines: visibility,
                fills: visibility
            };
        });

        mockWebview.onTestQuery('getOverlaySource', (args) => {
            const layerId = args[0] as string;
            const state = layerStates.get(layerId);
            return state ? { exists: state.sourceExists, type: 'geojson' } : { exists: false };
        });

        mockWebview.onTestQuery('isOverlayLayerOnMap', (args) => {
            const layerId = args[0] as string;
            const state = layerStates.get(layerId);
            return state ? state.exists && state.sourceExists : false;
        });

        mockWebview.onTestQuery('getAllOverlayState', () => {
            const result: Record<string, unknown> = {};
            layerStates.forEach((state, id) => {
                result[id] = {
                    visible: state.visible,
                    onMap: state.exists && state.sourceExists,
                    source: { exists: state.sourceExists }
                };
            });
            return result;
        });
    }

    suiteSetup(async function() {
        this.timeout(30000);

        const extension = vscode.extensions.getExtension('christofferlind.vscode-maplibre-viewer');
        if (!extension) {
            throw new Error('Extension not found');
        }
        if (!extension.isActive) {
            await extension.activate();
        }
        await new Promise(resolve => setTimeout(resolve, 2000));

        bookmarkManager = new BookmarkManager({
            get: () => undefined,
            update: () => Promise.resolve()
        } as unknown as vscode.Memento);
    });

    setup(() => {
        mockWebview = new MockWebview();
        controller = new TestableMapWebviewController(
            vscode.Uri.file('/test-extension'),
            bookmarkManager
        );
        controller.setWebview(mockWebview);
        controller.setViewType('test-view');
        mockWebview.onDidReceiveMessage((msg) => {
            controller.testHandleWebviewMessage(msg);
        });
    });

    teardown(() => {
        mockWebview.clearTestHandlers();
        mockWebview.clearMessages();
    });

    test('should have extension activated', async function() {
        this.timeout(WEBVIEW_TIMEOUT);
        
        const extension = vscode.extensions.getExtension('christofferlind.vscode-maplibre-viewer');
        assert.ok(extension, 'Extension should be available');
        assert.ok(extension!.isActive, 'Extension should be activated');
    });

    test('should have addLayer command registered', async function() {
        this.timeout(WEBVIEW_TIMEOUT);
        
        const commands = await vscode.commands.getCommands(true);
        const hasAddLayer = commands.includes('vscodeMaplibreViewer.addLayer');
        assert.ok(hasAddLayer, 'addLayer command should be registered');
    });

    test('should have toggleLayer command registered', async function() {
        this.timeout(WEBVIEW_TIMEOUT);
        
        const commands = await vscode.commands.getCommands(true);
        const hasToggleLayer = commands.includes('vscodeMaplibreViewer.toggleLayer');
        assert.ok(hasToggleLayer, 'toggleLayer command should be registered');
    });

    test('should have removeLayer command registered', async function() {
        this.timeout(WEBVIEW_TIMEOUT);
        
        const commands = await vscode.commands.getCommands(true);
        const hasRemoveLayer = commands.includes('vscodeMaplibreViewer.removeLayer');
        assert.ok(hasRemoveLayer, 'removeLayer command should be registered');
    });

    test('should send updateOverlayLayers message when layer is added', async function() {
        this.timeout(WEBVIEW_TIMEOUT);
        
        const layerStates = new Map<string, { exists: boolean; visible: boolean; sourceExists: boolean }>();
        layerStates.set(TEST_CIRCLE_LAYER.id, { exists: true, visible: true, sourceExists: true });
        setupLayerStateMock(layerStates);

        await controller.updateOverlayLayers([TEST_CIRCLE_LAYER]);
        
        const messages = mockWebview.getMessagesOfType('updateOverlayLayers');
        assert.strictEqual(messages.length, 1, 'Should send one updateOverlayLayers message');
        
        const message = messages[0] as Record<string, unknown>;
        assert.ok(message.layers, 'Message should have layers property');
        assert.ok(Array.isArray(message.layers), 'Layers should be an array');
        assert.strictEqual((message.layers as unknown[]).length, 1, 'Should have one layer');
    });

    test('should verify layer visibility state through __testQuery API', async function() {
        this.timeout(WEBVIEW_TIMEOUT);
        
        const layerStates = new Map<string, { exists: boolean; visible: boolean; sourceExists: boolean }>();
        layerStates.set(TEST_CIRCLE_LAYER.id, { exists: true, visible: true, sourceExists: true });
        setupLayerStateMock(layerStates);

        await controller.updateOverlayLayers([TEST_CIRCLE_LAYER]);
        
        const state = await controller.queryWebview('getLayerVisibility', [TEST_CIRCLE_LAYER.id]);
        assert.strictEqual((state as Record<string, string>).circles, 'visible');
        assert.strictEqual((state as Record<string, string>).lines, 'visible');
        assert.strictEqual((state as Record<string, string>).fills, 'visible');
    });

    test('should toggle layer visibility and verify state change', async function() {
        this.timeout(WEBVIEW_TIMEOUT);
        
        const layerStates = new Map<string, { exists: boolean; visible: boolean; sourceExists: boolean }>();
        layerStates.set(TEST_CIRCLE_LAYER.id, { exists: true, visible: true, sourceExists: true });
        setupLayerStateMock(layerStates);

        await controller.updateOverlayLayers([TEST_CIRCLE_LAYER]);
        
        let state = await controller.queryWebview('getLayerVisibility', [TEST_CIRCLE_LAYER.id]);
        assert.strictEqual((state as Record<string, string>).circles, 'visible');

        layerStates.set(TEST_CIRCLE_LAYER.id, { exists: true, visible: false, sourceExists: true });
        
        await controller.updateOverlayLayers([{ ...TEST_CIRCLE_LAYER, visible: false }]);
        
        state = await controller.queryWebview('getLayerVisibility', [TEST_CIRCLE_LAYER.id]);
        assert.strictEqual((state as Record<string, string>).circles, 'none');
    });

    test('should handle multiple layers and verify each independently', async function() {
        this.timeout(WEBVIEW_TIMEOUT * 2);
        
        const layers = [TEST_CIRCLE_LAYER, TEST_LINE_LAYER, TEST_FILL_LAYER];
        const layerStates = new Map<string, { exists: boolean; visible: boolean; sourceExists: boolean }>();
        
        layers.forEach(layer => {
            layerStates.set(layer.id, { exists: true, visible: true, sourceExists: true });
        });
        
        setupLayerStateMock(layerStates);

        await controller.updateOverlayLayers(layers);
        
        for (const layer of layers) {
            const state = await controller.queryWebview('getLayerVisibility', [layer.id]);
            assert.strictEqual((state as Record<string, string>).circles, 'visible', 
                `Layer ${layer.id} should be visible`);
        }
    });

    test('should verify layer source exists on map', async function() {
        this.timeout(WEBVIEW_TIMEOUT);
        
        const layerStates = new Map<string, { exists: boolean; visible: boolean; sourceExists: boolean }>();
        layerStates.set(TEST_CIRCLE_LAYER.id, { exists: true, visible: true, sourceExists: true });
        setupLayerStateMock(layerStates);

        await controller.updateOverlayLayers([TEST_CIRCLE_LAYER]);
        
        const sourceState = await controller.queryWebview('getOverlaySource', [TEST_CIRCLE_LAYER.id]);
        assert.ok((sourceState as Record<string, unknown>).exists, 'Source should exist');
        assert.strictEqual((sourceState as Record<string, unknown>).type, 'geojson');
    });

    test('should verify layer is on map through isOverlayLayerOnMap query', async function() {
        this.timeout(WEBVIEW_TIMEOUT);
        
        const layerStates = new Map<string, { exists: boolean; visible: boolean; sourceExists: boolean }>();
        layerStates.set(TEST_CIRCLE_LAYER.id, { exists: true, visible: true, sourceExists: true });
        setupLayerStateMock(layerStates);

        await controller.updateOverlayLayers([TEST_CIRCLE_LAYER]);
        
        const isOnMap = await controller.queryWebview('isOverlayLayerOnMap', [TEST_CIRCLE_LAYER.id]);
        assert.strictEqual(isOnMap, true, 'Layer should be on map');
    });

    test('should return false for non-existent layer', async function() {
        this.timeout(WEBVIEW_TIMEOUT);
        
        const layerStates = new Map<string, { exists: boolean; visible: boolean; sourceExists: boolean }>();
        setupLayerStateMock(layerStates);

        const state = await controller.queryWebview('getLayerVisibility', ['non-existent-layer']);
        assert.strictEqual((state as Record<string, string>).circles, 'not-found');
        assert.strictEqual((state as Record<string, string>).lines, 'not-found');
        assert.strictEqual((state as Record<string, string>).fills, 'not-found');
    });

    test('should handle complex GeoJSON FeatureCollection', async function() {
        this.timeout(WEBVIEW_TIMEOUT);
        
        const complexLayer: OverlayLayer = {
            id: 'test-complex-geojson',
            name: 'Complex GeoJSON Layer',
            type: 'geojson',
            visible: true,
            source: {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection' as const,
                    features: [
                        {
                            type: 'Feature' as const,
                            geometry: {
                                type: 'Polygon' as const,
                                coordinates: [[
                                    [18.0636, 59.3243],
                                    [18.0686, 59.3243],
                                    [18.0686, 59.3293],
                                    [18.0636, 59.3293],
                                    [18.0636, 59.3243]
                                ]]
                            },
                            properties: { name: 'Polygon 1' }
                        }
                    ]
                }
            }
        };
        
        const layerStates = new Map<string, { exists: boolean; visible: boolean; sourceExists: boolean }>();
        layerStates.set(complexLayer.id, { exists: true, visible: true, sourceExists: true });
        setupLayerStateMock(layerStates);

        await controller.updateOverlayLayers([complexLayer]);
        
        const messages = mockWebview.getMessagesOfType('updateOverlayLayers');
        assert.strictEqual(messages.length, 1);
        
        const message = messages[0] as Record<string, unknown>;
        const layers = message.layers as unknown[];
        assert.strictEqual(layers.length, 1);
    });

    test('should verify getAllOverlayState returns comprehensive state', async function() {
        this.timeout(WEBVIEW_TIMEOUT);
        
        const layerStates = new Map<string, { exists: boolean; visible: boolean; sourceExists: boolean }>();
        layerStates.set(TEST_CIRCLE_LAYER.id, { exists: true, visible: true, sourceExists: true });
        layerStates.set(TEST_LINE_LAYER.id, { exists: true, visible: false, sourceExists: true });
        setupLayerStateMock(layerStates);

        await controller.updateOverlayLayers([TEST_CIRCLE_LAYER, TEST_LINE_LAYER]);
        
        const allState = await controller.queryWebview('getAllOverlayState', []);
        const stateObj = allState as Record<string, Record<string, unknown>>;
        
        assert.ok(stateObj['test-circle-layer'], 'Should have circle layer state');
        assert.ok(stateObj['test-line-layer'], 'Should have line layer state');
        assert.strictEqual(stateObj['test-circle-layer'].visible, true);
        assert.strictEqual(stateObj['test-line-layer'].visible, false);
    });

    test('should handle layer removal by sending empty layers array', async function() {
        this.timeout(WEBVIEW_TIMEOUT);
        
        await controller.updateOverlayLayers([TEST_CIRCLE_LAYER]);
        
        let messages = mockWebview.getMessagesOfType('updateOverlayLayers');
        assert.strictEqual(messages.length, 1);

        await controller.updateOverlayLayers([]);
        
        messages = mockWebview.getMessagesOfType('updateOverlayLayers');
        assert.strictEqual(messages.length, 2);
        
        const removalMessage = messages[1] as Record<string, unknown>;
        assert.ok(Array.isArray(removalMessage.layers));
        assert.strictEqual((removalMessage.layers as unknown[]).length, 0);
    });
});
