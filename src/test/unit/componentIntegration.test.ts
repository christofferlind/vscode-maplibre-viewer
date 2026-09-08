import * as assert from 'assert';
import type * as vscode from 'vscode';
import { MockWebview } from '../testUtils/mockWebview';
import { loadWithStubbedVscode, type VscodeStubState } from '../testUtils/loadWithStubbedVscode';

/**
 * High-level integration tests: wire the REAL modules together
 * (BookmarkManager, BookmarkTreeProvider, LayerTreeProvider,
 * MapWebviewController, ProviderManager) with only the `vscode` module
 * stubbed, and verify that the pieces cooperate end to end:
 *
 * - a saved bookmark flows from BookmarkManager into the tree view and onto
 *   every registered map webview through ProviderManager
 * - layer mutations in LayerTreeProvider propagate to the map webview
 * - view state reported by the webview round-trips back into persistence and
 *   new bookmarks
 */

interface ControllerModule {
    MapWebviewController: typeof import('../../map/mapWebviewController').MapWebviewController;
}
type ProviderManagerType = import('../../map/providerManager').ProviderManager;
type BookmarkManagerType = import('../../bookmarks/bookmarkManager').BookmarkManager;
type BookmarkTreeProviderType = import('../../bookmarks/bookmarkTreeProvider').BookmarkTreeProvider;
type LayerTreeProviderType = import('../../layers/layerTreeProvider').LayerTreeProvider;
type MapBookmark = import('../../bookmarks/bookmarkTypes').MapBookmark;
type ViewState = import('../../bookmarks/bookmarkTypes').ViewState;
type OverlayLayer = import('../../layers/layerTypes').OverlayLayer;
type BaseMapStyle = import('../../layers/layerTypes').BaseMapStyle;

const controllerLoaded = loadWithStubbedVscode<ControllerModule>('../../map/mapWebviewController');
const { MapWebviewController } = controllerLoaded.module;

const providerManagerLoaded = loadWithStubbedVscode<{ ProviderManager: new () => ProviderManagerType }>(
    '../../map/providerManager'
);
const bookmarkManagerLoaded = loadWithStubbedVscode<{ BookmarkManager: new (state: vscode.Memento) => BookmarkManagerType }>(
    '../../bookmarks/bookmarkManager'
);
const bookmarkTreeLoaded = loadWithStubbedVscode<{ BookmarkTreeProvider: new (mgr: BookmarkManagerType) => BookmarkTreeProviderType }>(
    '../../bookmarks/bookmarkTreeProvider'
);
const layerTreeLoaded = loadWithStubbedVscode<{ LayerTreeProvider: new (ctx: vscode.ExtensionContext) => LayerTreeProviderType }>(
    '../../layers/layerTreeProvider'
);

const SELECTED_FILE_LAYER_ID = 'selected-file';

/** Minimal concrete controller wiring a MockWebview into the real base class. */
class TestableController extends MapWebviewController {
    private webview_: vscode.Webview | undefined;
    private type_: string;

    constructor(
        uri: vscode.Uri,
        bookmarkManager: BookmarkManagerType,
        viewType: string
    ) {
        super(uri, bookmarkManager);
        this.type_ = viewType;
    }

    setWebview(webview: vscode.Webview | undefined): void {
        this.webview_ = webview;
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

interface TestHarness {
    vscodeState: VscodeStubState;
    bookmarkManager: BookmarkManagerType;
    bookmarkTree: BookmarkTreeProviderType;
    layerTree: LayerTreeProviderType;
    providerManager: ProviderManagerType;
    controllers: TestableController[];
    webviews: MockWebview[];
    dispose(): void;
}

/** Shared in-memory globalState so all components observe the same store. */
function createSharedContext(uri: vscode.Uri): vscode.ExtensionContext {
    const store = new Map<string, unknown>();
    return {
        subscriptions: [],
        globalState: {
            get: <T>(key: string, defaultValue?: T): T | undefined => {
                const value = store.get(key);
                return value === undefined ? defaultValue : (value as T);
            },
            update: (key: string, value: unknown): Thenable<void> => {
                store.set(key, value);
                return Promise.resolve();
            }
        },
        extensionUri: uri
    } as unknown as vscode.ExtensionContext;
}

function createHarness(): TestHarness {
    const loaded = loadWithStubbedVscode<{ noop: () => void }>('../../map/mapWebviewUtils');
    const vscodeState = loaded.vscodeState;
    const uri = { fsPath: process.cwd() } as vscode.Uri;

    const context = createSharedContext(uri);
    const bookmarkManager = new bookmarkManagerLoaded.module.BookmarkManager(
        context.globalState as unknown as vscode.Memento
    );
    const bookmarkTree = new bookmarkTreeLoaded.module.BookmarkTreeProvider(bookmarkManager);
    const layerTree = new layerTreeLoaded.module.LayerTreeProvider(context);
    const providerManager = new providerManagerLoaded.module.ProviderManager();

    const controllers: TestableController[] = [];
    const webviews: MockWebview[] = [];
    for (const viewType of ['mapsView', 'mapEditor']) {
        const controller = new TestableController(uri, bookmarkManager, viewType);
        const webview = new MockWebview();
        controller.setWebview(webview);
        controller.connect(webview);
        providerManager.register(controller);
        controllers.push(controller);
        webviews.push(webview);
    }

    // Mirror the extension.ts wiring: layer tree changes are broadcast to all
    // registered map webviews through the provider manager.
    layerTree.onDidChangeLayers((event) => {
        const change = event as { type: 'baseMap' | 'overlay'; data: unknown };
        if (change.type === 'baseMap') {
            providerManager.setBaseMap(change.data as BaseMapStyle);
        } else {
            providerManager.updateOverlayLayers(layerTree.getVisibleOverlayLayers());
        }
    });

    // Mirror the extension.ts wiring: bookmark changes refresh the tree view
    // and broadcast the new bookmark list to all registered map webviews.
    bookmarkManager.onDidChangeBookmarks((bookmarks) => {
        bookmarkTree.refresh();
        providerManager.updateBookmarks(bookmarks);
    });

    return {
        vscodeState,
        bookmarkManager,
        bookmarkTree,
        layerTree,
        providerManager,
        controllers,
        webviews,
        dispose(): void {
            MapWebviewController.lastActiveViewType = 'mapsView';
        }
    };
}

function sampleViewState(overrides?: Partial<ViewState>): ViewState {
    return {
        center: { latitude: 59.3293, longitude: 18.0686 },
        zoom: 12,
        bearing: 0,
        pitch: 0,
        ...overrides
    };
}

function overlayLayer(overrides?: Partial<OverlayLayer>): OverlayLayer {
    return {
        id: 'trail-1',
        name: 'Trails',
        type: 'geojson',
        source: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
        visible: true,
        ...overrides
    };
}

suite('High-level integration: components work together', () => {
    let harness: TestHarness;

    setup(() => {
        harness = createHarness();
    });

    teardown(() => {
        harness.dispose();
    });

    suite('Bookmark flow: manager -> tree -> both map webviews', () => {
        test('a bookmark created via the manager appears in the bookmark tree', async () => {
            await harness.bookmarkManager.createBookmark('Office', sampleViewState());

            const children = await harness.bookmarkTree.getChildren();
            assert.strictEqual(children.length, 1);
            assert.strictEqual(children[0].name, 'Office');

            const item = harness.bookmarkTree.getTreeItem(children[0]);
            assert.ok(item.command, 'tree item should carry the goToBookmark command');
            assert.strictEqual(item.command.command, 'vscodeMaplibreViewer.goToBookmark');
        });

        test('goToBookmark command wiring navigates every registered webview', async () => {
            const bookmark = await harness.bookmarkManager.createBookmark(
                'Harbor',
                sampleViewState({ zoom: 15, bearing: 45, pitch: 30 })
            );

            // Simulate what the registered goToBookmark command does
            harness.providerManager.flyToBookmark(bookmark);

            for (const webview of harness.webviews) {
                const messages = webview.getMessagesOfType('flyToBookmark');
                assert.strictEqual(messages.length, 1, 'each webview gets exactly one flyToBookmark');
                const message = messages[0] as { bookmark: MapBookmark };
                assert.strictEqual(message.bookmark.id, bookmark.id);
                assert.strictEqual(message.bookmark.name, 'Harbor');
                assert.strictEqual(message.bookmark.zoom, 15);
                assert.strictEqual(message.bookmark.bearing, 45);
                assert.strictEqual(message.bookmark.pitch, 30);
            }
        });

        test('deleting from the manager removes it from the tree listing', async () => {
            const bookmark = await harness.bookmarkManager.createBookmark('Temporary', sampleViewState());
            assert.strictEqual((await harness.bookmarkTree.getChildren()).length, 1);

            const deleted = await harness.bookmarkManager.deleteBookmark(bookmark.id);
            assert.strictEqual(deleted, true);
            assert.strictEqual((await harness.bookmarkTree.getChildren()).length, 0);
        });

        test('creating a bookmark broadcasts bookmarksUpdated to every webview', async () => {
            const bookmark = await harness.bookmarkManager.createBookmark('Office', sampleViewState());

            for (const webview of harness.webviews) {
                const messages = webview.getMessagesOfType('bookmarksUpdated');
                assert.strictEqual(messages.length, 1, 'each webview gets one bookmarksUpdated');
                const message = messages[0] as { bookmarks: MapBookmark[] };
                assert.strictEqual(message.bookmarks.length, 1);
                assert.strictEqual(message.bookmarks[0].id, bookmark.id);
                assert.strictEqual(message.bookmarks[0].name, 'Office');
            }
        });

        test('updating and deleting a bookmark broadcasts the new list', async () => {
            const bookmark = await harness.bookmarkManager.createBookmark('Office', sampleViewState());
            for (const webview of harness.webviews) {
                webview.clearMessages();
            }

            await harness.bookmarkManager.updateBookmark(bookmark.id, { name: 'Renamed Office' });
            for (const webview of harness.webviews) {
                const messages = webview.getMessagesOfType('bookmarksUpdated');
                assert.strictEqual(messages.length, 1);
                const message = messages[0] as { bookmarks: MapBookmark[] };
                assert.strictEqual(message.bookmarks.length, 1);
                assert.strictEqual(message.bookmarks[0].name, 'Renamed Office');
            }

            await harness.bookmarkManager.deleteBookmark(bookmark.id);
            for (const webview of harness.webviews) {
                const messages = webview.getMessagesOfType('bookmarksUpdated');
                assert.strictEqual(messages.length, 2);
                const message = messages[1] as { bookmarks: MapBookmark[] };
                assert.strictEqual(message.bookmarks.length, 0);
            }
            assert.strictEqual((await harness.bookmarkTree.getChildren()).length, 0);
        });

        test('view state reported by the webview creates a bookmark round-trip', async () => {
            const controller = harness.controllers[0];
            const webview = harness.webviews[0];

            // Start getCurrentViewState (as handleSaveBookmark does), then
            // have the "webview" report its state through the message channel
            const statePromise = controller.getCurrentViewState();
            webview.simulateMessage({
                type: 'viewStateChanged',
                viewState: { center: { lat: 57.7, lng: 11.97 }, zoom: 14, bearing: 90, pitch: 20 }
            });
            const viewState = await statePromise;
            assert.ok(viewState, 'controller should resolve the reported view state');

            // Save it as a bookmark and read it back through the tree
            const bookmark = await harness.bookmarkManager.createBookmark('Gothenburg', viewState);
            const children = await harness.bookmarkTree.getChildren();
            const saved = children.find((b) => b.id === bookmark.id);
            assert.ok(saved, 'bookmark appears in the tree');
            assert.deepStrictEqual(saved.center, { latitude: 57.7, longitude: 11.97 });
            assert.strictEqual(saved.bearing, 90);
        });
    });

    suite('Layer flow: LayerTreeProvider -> map webviews', () => {
        test('setActiveBaseMap broadcasts the basemap to every webview', async () => {
            const baseMap: BaseMapStyle = {
                id: 'satellite',
                name: 'Satellite',
                styleUrl: 'https://example.com/satellite.json'
            };
            harness.layerTree.registerBasemap(baseMap);
            await harness.layerTree.setActiveBaseMap(baseMap.id);

            for (const webview of harness.webviews) {
                const messages = webview.getMessagesOfType('setBaseMap');
                assert.strictEqual(messages.length, 1);
                const message = messages[0] as { basemap: Record<string, unknown> };
                assert.strictEqual(message.basemap.id, 'satellite');
                assert.strictEqual(message.basemap.type, 'vector');
            }
        });

        test('toggling a layer fires change events and updates getVisibleOverlayLayers', async () => {
            const layer = overlayLayer({ visible: false });
            await harness.layerTree.addOverlayLayer(layer);

            let changeEvent: { type: string; data: OverlayLayer } | undefined;
            harness.layerTree.onDidChangeLayers((e) => {
                changeEvent = e as { type: string; data: OverlayLayer };
            });

            await harness.layerTree.toggleLayerVisibility(layer.id);

            assert.ok(changeEvent, 'onDidChangeLayers fired');
            assert.strictEqual(changeEvent.type, 'overlay');
            assert.strictEqual(changeEvent.data.id, layer.id);
            assert.strictEqual(changeEvent.data.visible, true);
            assert.strictEqual(harness.layerTree.getVisibleOverlayLayers().length, 1);
        });

        test('updating the selected file layer reaches the webview through the controller', async () => {
            const geojson = {
                type: 'FeatureCollection',
                features: [
                    {
                        type: 'Feature',
                        geometry: { type: 'Point', coordinates: [18.0686, 59.3293] },
                        properties: {}
                    }
                ]
            };

            await harness.layerTree.updateSelectedFileLayer(geojson);

            // The wired extension behavior pushes only VISIBLE layers to the
            // webview; the selected file layer stays hidden until shown.
            const layer = harness.layerTree.getSelectedFileLayer();
            assert.ok(layer, 'selected file layer exists');
            assert.strictEqual(
                (layer.source.data as { features: unknown[] }).features.length,
                1,
                'provider holds the new geojson data'
            );
            assert.strictEqual(harness.layerTree.getVisibleOverlayLayers().length, 0);
            for (const webview of harness.webviews) {
                const messages = webview.getMessagesOfType('updateOverlayLayers');
                assert.strictEqual(messages.length, 1, 'layer change triggers a broadcast even when nothing is visible');
                const layers = (messages[0] as { layers: OverlayLayer[] }).layers;
                assert.strictEqual(layers.length, 0, 'no visible layers are sent');
            }
        });

        test('showing the selected file layer broadcasts the visible layer list', async () => {
            await harness.layerTree.toggleLayerVisibility(SELECTED_FILE_LAYER_ID);
            for (const webview of harness.webviews) {
                const messages = webview.getMessagesOfType('updateOverlayLayers');
                assert.strictEqual(messages.length, 1, 'visible layer change is broadcast');
                const layers = (messages[0] as { layers: OverlayLayer[] }).layers;
                assert.ok(layers.some((l) => l.id === SELECTED_FILE_LAYER_ID && l.visible));
            }
        });

        test('layer state survives reconstruction from the shared globalState', async () => {
            await harness.layerTree.addOverlayLayer(overlayLayer({ id: 'persist-1', name: 'Persisted' }));

            const reloadedContext = createSharedContext({ fsPath: process.cwd() } as vscode.Uri);
            await reloadedContext.globalState.update(
                'overlayLayers',
                harness.layerTree.getOverlayLayers()
            );
            const reloadedTree = new layerTreeLoaded.module.LayerTreeProvider(reloadedContext);
            const layers = reloadedTree.getOverlayLayers();
            assert.ok(layers.some((l) => l.id === 'persist-1'), 'persisted layer is reloaded');
            assert.ok(
                layers.some((l) => l.id === SELECTED_FILE_LAYER_ID),
                'selected file layer always exists after reload'
            );
        });
    });

    suite('Webview message handling across components', () => {
        test('mapReady marks the originating view as the active one', async () => {
            MapWebviewController.lastActiveViewType = 'mapsView';
            harness.controllers[1].handleWebviewMessage({ type: 'mapReady' });
            assert.strictEqual(MapWebviewController.lastActiveViewType, 'mapEditor');
        });

        test('basemap set through provider manager updates controller state and webview', () => {
            const baseMap: BaseMapStyle = {
                id: 'raster-map',
                name: 'Raster Map',
                type: 'raster',
                tileUrl: 'https://tiles.example.com/{z}/{x}/{y}.png'
            };
            harness.providerManager.setBaseMap(baseMap);

            for (const webview of harness.webviews) {
                const messages = webview.getMessagesOfType('setBaseMap');
                assert.strictEqual(messages.length, 1);
                const basemap = (messages[0] as { basemap: Record<string, unknown> }).basemap;
                assert.strictEqual(basemap.type, 'raster');
                assert.strictEqual(basemap.tileUrl, baseMap.tileUrl);
            }
        });

        test('config update broadcast reaches all webviews after language change', () => {
            harness.providerManager.setMapLanguage('sv');
            harness.providerManager.updateConfiguration();

            for (const webview of harness.webviews) {
                assert.strictEqual(webview.getMessagesOfType('languageChange').length, 1);
                assert.strictEqual(webview.getMessagesOfType('configUpdate').length, 1);
            }
        });

        test('view state persistence happens when webview reports movement', async () => {
            const before = controllerLoaded.vscodeState.updateCalls.length;
            await harness.controllers[0].handleWebviewMessage({
                type: 'viewStateChanged',
                viewState: { center: { lat: 60, lng: 20 }, zoom: 8, bearing: 0, pitch: 0 }
            });
            assert.strictEqual(controllerLoaded.vscodeState.updateCalls.length, before + 1);
            const call = controllerLoaded.vscodeState.updateCalls[controllerLoaded.vscodeState.updateCalls.length - 1];
            assert.strictEqual(call.section, 'lastViewState');
            const perView = call.value as { mapsView: { center: { lat: number; lng: number } } };
            assert.deepStrictEqual(perView.mapsView.center, { lat: 60, lng: 20 });
        });
    });
});