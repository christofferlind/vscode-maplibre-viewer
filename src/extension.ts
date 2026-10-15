import * as vscode from 'vscode';
import { BookmarkManager } from './bookmarks/bookmarkManager';
import { BookmarkTreeProvider } from './bookmarks/bookmarkTreeProvider';
import { LayerTreeProvider } from './layers/layerTreeProvider';
import { BaseMapStyle, OverlayLayer } from './layers/layerTypes';
import { MapLibreViewerAPI, BasemapProvider, FileToGeoJsonAdapter } from './services/api';
import { geojsonAdapter } from './adapters/geojsonAdapter';
import { gpxAdapter } from './adapters/gpxAdapter';
import { MapViewProvider } from './map/mapViewProvider';
import { MapEditorProvider } from './map/mapEditorProvider';
import { MapWebviewController } from './map/mapWebviewController';
import { ProviderManager } from './map/providerManager';
import { MapInfoTreeProvider } from './info/mapInfoTreeProvider';
import { showOperationError, confirmAction, getCoordinateSelectionState } from './extensionUtils';
import { formatCoordinate } from './services/coordinateFormatter';
import { StoredViewState, StoredPerViewState } from './map/mapWebviewTypes';
import { handleSearchOnMap } from './searchHandler';
import { handleTextSelection, handleFileSelection, resetFileSelectionState } from './selectionHandler';
import { loadCustomCoordinatePatterns, registerLanguageCommands, registerCoordinateSelectionCommands } from './commandRegistration';
import { configureLayerStyle, promptLayerColor } from './layers/layerStylePrompt';
import { DoubleClickTracker } from './layers/layerClickHandler';
import { createToggleOverlayLayerWithBackfill } from './layers/layerToggleService';
import { getConfig, onConfigurationChanged, setViewStateWriteGuard } from './services/configService';
import { debounce } from './services/debounce';
import { calculateBoundingBoxFromGeoJson } from './services/coordinateParser';
import { ClipboardLayerManager } from './services/clipboardLayerManager';

let mapsViewProvider: MapViewProvider;
let mapEditorProvider: MapEditorProvider;
let layerTreeProviderForTestAccess: LayerTreeProvider | undefined;

/**
 * Activates the extension.
 */
export async function activate(context: vscode.ExtensionContext): Promise<MapLibreViewerAPI> {
    console.log('Congratulations, your extension "vscode-maplibre-viewer" is now active!');

    loadCustomCoordinatePatterns();

    const coordinateSelectionEnabled = getCoordinateSelectionState(context);
    await vscode.commands.executeCommand('setContext', 'maplibreView.coordinateSelectionEnabled', coordinateSelectionEnabled);

    const bookmarkManager = new BookmarkManager(context.globalState);
    const bookmarkTreeProvider = new BookmarkTreeProvider(bookmarkManager);
    bookmarkTreeProvider.registerCommands(context);

    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('bookmarksView', bookmarkTreeProvider)
    );

    const layerTreeProvider = new LayerTreeProvider(context);
    layerTreeProviderForTestAccess = layerTreeProvider;

    const onDidChangeActiveBasemapEmitter = new vscode.EventEmitter<BaseMapStyle>();

    const fileToGeoJsonAdapters: FileToGeoJsonAdapter[] = [];
    fileToGeoJsonAdapters.push(geojsonAdapter);
    fileToGeoJsonAdapters.push(gpxAdapter);
    layerTreeProvider.setFileAdapters(fileToGeoJsonAdapters);

    const api = createAPI(layerTreeProvider, onDidChangeActiveBasemapEmitter, fileToGeoJsonAdapters);

    const demoBasemap: BasemapProvider = {
        id: 'openfreemap-liberty',
        name: 'OpenFreeMap.org',
        type: 'vector',
        styleUrl: 'https://tiles.openfreemap.org/styles/liberty'
    };
    let demoBasemapDisposable: vscode.Disposable | undefined;

    const updateDemoBasemapRegistration = (): void => {
        const config = vscode.workspace.getConfiguration('vscodeMaplibreViewer');
        const customBasemaps = config.get<BaseMapStyle[]>('baseMaps', []);
        const alwaysShowDemoTiles = config.get<boolean>('alwaysShowDemoTiles', false);
        // Count only genuinely external basemaps: registered basemaps that are
        // neither user-configured nor the demo basemap itself. Counting the
        // demo basemap here made this function dispose it on the second run.
        const externalBasemapCount = layerTreeProvider.getBasemaps().filter(
            bm => !customBasemaps.some(cb => cb.id === bm.id) && bm.id !== demoBasemap.id
        ).length;
        const shouldShow = (customBasemaps.length === 0 && externalBasemapCount === 0) || alwaysShowDemoTiles;

        if (shouldShow && !demoBasemapDisposable) {
            demoBasemapDisposable = api.registerBasemap(demoBasemap);
            context.subscriptions.push(demoBasemapDisposable);
        } else if (!shouldShow && demoBasemapDisposable) {
            demoBasemapDisposable.dispose();
            demoBasemapDisposable = undefined;
        }
    };

    updateDemoBasemapRegistration();

    const savedLastViewState = getConfig().get<StoredPerViewState | StoredViewState>('lastViewState');
    const savedViewState = savedLastViewState
        && ('mapsView' in savedLastViewState || 'mapEditor' in savedLastViewState)
        ? (savedLastViewState as StoredPerViewState).mapsView
        : savedLastViewState as StoredViewState | undefined;
    if (savedViewState?.baseMapId) {
        try {
            await layerTreeProvider.setActiveBaseMap(savedViewState.baseMapId);
        } catch {
            console.log('Saved base map not found, using default');
        }
    }

    const initialBaseMap = layerTreeProvider.getActiveBaseMap();
    mapsViewProvider = new MapViewProvider(context.extensionUri, bookmarkManager, initialBaseMap?.styleUrl, initialBaseMap?.id);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('mapsView', mapsViewProvider)
    );

    mapEditorProvider = new MapEditorProvider(context.extensionUri, bookmarkManager, initialBaseMap?.styleUrl, initialBaseMap?.id);

    const providerManager = new ProviderManager();
    providerManager.register(mapsViewProvider);
    providerManager.register(mapEditorProvider);

    const layersTreeView = vscode.window.createTreeView('layersView', {
        treeDataProvider: layerTreeProvider,
        dragAndDropController: layerTreeProvider,
        showCollapseAll: true
    });
    context.subscriptions.push(layersTreeView);

    const mapInfoTreeProvider = new MapInfoTreeProvider(() => providerManager.getProviders());
    context.subscriptions.push(...mapInfoTreeProvider.subscribeToProviders());
    const mapInfoTreeView = vscode.window.createTreeView('mapInfoView', {
        treeDataProvider: mapInfoTreeProvider
    });
    context.subscriptions.push(mapInfoTreeView);

    const sendVisibleOverlayLayers = () => {
        providerManager.updateOverlayLayers(layerTreeProvider.getVisibleOverlayLayers());
    };

    mapsViewProvider.onMapReady(sendVisibleOverlayLayers);
    mapEditorProvider.onMapReady(sendVisibleOverlayLayers);

    // The webview pulls the current overlay layers once the map reports ready,
    // so a saved overlay set is restored even when the mapReady-triggered push
    // is silently dropped by the webview pipeline.
    mapsViewProvider.onOverlaySyncRequest(sendVisibleOverlayLayers);
    mapEditorProvider.onOverlaySyncRequest(sendVisibleOverlayLayers);

    context.subscriptions.push(onDidChangeActiveBasemapEmitter);

    context.subscriptions.push(
        layerTreeProvider.onDidChangeLayers((event) => {
            if (event.type === 'baseMap') {
                providerManager.setBaseMap(event.data as BaseMapStyle);
                onDidChangeActiveBasemapEmitter.fire(event.data as BaseMapStyle);
            } else if (event.type === 'overlay') {
                sendVisibleOverlayLayers();
            }
        })
    );

    context.subscriptions.push(
        layerTreeProvider.onDidAddLayerViaDragDrop((event) => {
            if (event.bbox) {
                providerManager.fitBoundsOnly(event.bbox);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('vscodeMaplibreViewer.setBaseMap', async (baseMap: BaseMapStyle) => {
            try {
                await layerTreeProvider.setActiveBaseMap(baseMap.id);
            } catch (error) {
                showOperationError('set base map', error);
            }
        })
    );

    const toggleOverlayLayerWithBackfill = createToggleOverlayLayerWithBackfill({
        layerTreeProvider,
        providerManager,
        fileToGeoJsonAdapters,
        syncClipboardLayer: () => clipboardLayerManager.syncWithLayerState()
    });

    context.subscriptions.push(
        vscode.commands.registerCommand('vscodeMaplibreViewer.toggleLayer', toggleOverlayLayerWithBackfill)
    );

    context.subscriptions.push(
        layersTreeView.onDidChangeCheckboxState(async (event) => {
            for (const [item, state] of event.items) {
                const layerId = layerTreeProvider.getOverlayLayerIdForTreeItem(item);
                if (!layerId) {
                    continue;
                }
                const layer = layerTreeProvider.getOverlayLayers().find(l => l.id === layerId);
                if (!layer) {
                    continue;
                }
                const shouldShow = state === vscode.TreeItemCheckboxState.Checked;
                if (layer.visible === shouldShow) {
                    continue;
                }
                await toggleOverlayLayerWithBackfill(layer);
            }
        })
    );

    const layerActivationTracker = new DoubleClickTracker();
    context.subscriptions.push(new vscode.Disposable(() => layerActivationTracker.dispose()));
    context.subscriptions.push(
        vscode.commands.registerCommand('vscodeMaplibreViewer.layerItemActivated', async (layer: OverlayLayer) => {
            if (!layerActivationTracker.handleClick(layer.id)) {
                return;
            }
            await vscode.commands.executeCommand(
                'vscodeMaplibreViewer.showOverlayLayersOnMap',
                layer
            );
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('vscodeMaplibreViewer.addLayer', async () => {
            const layerType = await vscode.window.showQuickPick(
                ['GeoJSON URL', 'Vector Tiles URL'],
                { placeHolder: 'Select layer type' }
            );

            if (!layerType) {
                return;
            }

            const name = await vscode.window.showInputBox({
                prompt: 'Enter a name for this layer',
                placeHolder: 'e.g., My Points of Interest'
            });

            if (!name) {
                return;
            }

            if (layerType === 'Vector Tiles URL') {
                vscode.window.showInformationMessage('Vector tile overlays are not yet supported.');
                return;
            }

            const url = await vscode.window.showInputBox({
                prompt: 'Enter the URL for this layer',
                placeHolder: 'https://example.com/data.geojson'
            });

            if (!url) {
                return;
            }

            const newLayer: OverlayLayer = {
                id: `layer-${Date.now()}`,
                name,
                type: 'geojson',
                source: {
                    type: 'geojson',
                    data: url
                },
                visible: true
            };

            try {
                await layerTreeProvider.addOverlayLayer(newLayer);
            } catch (error) {
                showOperationError('add layer', error);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('vscodeMaplibreViewer.changeLayerColor', async (layer: OverlayLayer) => {
            if (!layer) {
                return;
            }
            try {
                const color = await promptLayerColor(layer.color);
                if (!color) {
                    return;
                }
                await layerTreeProvider.updateLayerColor(layer.id, color);
            } catch (error) {
                showOperationError('change layer color', error);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('vscodeMaplibreViewer.changeLayerStyle', async (layer: OverlayLayer) => {
            if (!layer) {
                return;
            }
            const liveLayer = layerTreeProvider.getOverlayLayers().find(l => l.id === layer.id);
            if (!liveLayer) {
                return;
            }
            try {
                await configureLayerStyle(liveLayer, style => layerTreeProvider.updateLayerStyle(layer.id, style));
            } catch (error) {
                showOperationError('configure layer style', error);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('vscodeMaplibreViewer.removeLayer', async (layer: OverlayLayer) => {
            if (!layer) {
                return;
            }
            if (await confirmAction(`Are you sure you want to remove layer "${layer.name}"?`, 'Remove')) {
                try {
                    await layerTreeProvider.removeOverlayLayer(layer.id);
                    vscode.window.showInformationMessage(`Layer "${layer.name}" removed`);
                } catch (error) {
                    showOperationError('remove layer', error);
                }
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('vscodeMaplibreViewer.showOverlayLayersOnMap', async (layer: OverlayLayer) => {
            try {
                const layers = layer ? [layer] : layerTreeProvider.getOverlayLayers();
                const bboxes: Array<{ southwest: { latitude: number; longitude: number }; northeast: { latitude: number; longitude: number } }> = [];

                for (const overlayLayer of layers) {
                    if (overlayLayer.source?.data) {
                        const bbox = calculateBoundingBoxFromGeoJson(overlayLayer.source.data);
                        if (bbox) {
                            bboxes.push({
                                southwest: { latitude: bbox.southwest.latitude, longitude: bbox.southwest.longitude },
                                northeast: { latitude: bbox.northeast.latitude, longitude: bbox.northeast.longitude }
                            });
                        }
                    }
                }

                if (bboxes.length === 0) {
                    vscode.window.showWarningMessage('No valid coordinates found in the selected layer(s)');
                    return;
                }

                if (bboxes.length === 1) {
                    providerManager.fitBoundsOnly(bboxes[0]);
                } else {
                    const combinedBbox = {
                        southwest: {
                            latitude: Math.min(...bboxes.map(b => b.southwest.latitude)),
                            longitude: Math.min(...bboxes.map(b => b.southwest.longitude))
                        },
                        northeast: {
                            latitude: Math.max(...bboxes.map(b => b.northeast.latitude)),
                            longitude: Math.max(...bboxes.map(b => b.northeast.longitude))
                        }
                    };
                    providerManager.fitBoundsOnly(combinedBbox);
                }
            } catch (error) {
                showOperationError('show overlay layers on map', error);
            }
        })
    );

    bookmarkManager.registerCommands(context, bookmarkTreeProvider, providerManager);

    // Keep every UI surface in sync whenever the bookmark collection changes:
    // the tree view re-renders and map webviews receive the new bookmark list.
    context.subscriptions.push(
        bookmarkManager.onDidChangeBookmarks((bookmarks) => {
            bookmarkTreeProvider.refresh();
            providerManager.updateBookmarks(bookmarks);
        })
    );

    // Set while the extension itself writes lastViewState so the resulting
    // configuration event does not broadcast a redundant configUpdate on
    // every map pan (feedback loop that fights the user mid-drag).
    let suppressConfigUpdate = false;

    context.subscriptions.push(
        onConfigurationChanged((event) => {
            if (suppressConfigUpdate && event.affectsConfiguration('vscodeMaplibreViewer.lastViewState')) {
                return;
            }
            providerManager.updateConfiguration();
        })
    );

    setViewStateWriteGuard(() => {
        suppressConfigUpdate = true;
        setTimeout(() => {
            suppressConfigUpdate = false;
        }, 0);
    });

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('vscodeMaplibreViewer.baseMaps')
                || e.affectsConfiguration('vscodeMaplibreViewer.alwaysShowDemoTiles')) {
                updateDemoBasemapRegistration();
                layerTreeProvider.rebuildBaseMaps();
            }
            if (e.affectsConfiguration('vscodeMaplibreViewer.coordinatePatterns')) {
                loadCustomCoordinatePatterns();
                vscode.window.showInformationMessage('Custom coordinate patterns reloaded.');
            }
        })
    );

    registerLanguageCommands(context, providerManager);
    registerCoordinateSelectionCommands(context);

    const clipboardLayerManager = new ClipboardLayerManager({
        getClipboardLayer: () => layerTreeProvider.getClipboardLayer(),
        updateClipboardLayer: (geojson) => layerTreeProvider.updateClipboardLayer(geojson),
        fitBoundsOnly: (bbox) => providerManager.fitBoundsOnly(bbox),
        setContextKey: (key, value) => vscode.commands.executeCommand('setContext', key, value)
    });
    context.subscriptions.push(clipboardLayerManager);
    clipboardLayerManager.syncWithLayerState();

    context.subscriptions.push(
        vscode.commands.registerCommand('vscodeMaplibreViewer.openSettings', () => {
            vscode.commands.executeCommand(
                'workbench.action.openSettings',
                'vscodeMaplibreViewer'
            );
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('vscodeMaplibreViewer.searchOnMap', (args?: unknown) =>
            handleSearchOnMap(args, providerManager)
        )
    );

    const debouncedTextSelection = debounce(() => {
        handleTextSelection(providerManager);
    }, 300);

    const selectionListener = vscode.window.onDidChangeTextEditorSelection(() => {
        const isEnabled = getCoordinateSelectionState(context);
        if (!isEnabled) {
            return;
        }
        debouncedTextSelection();
    });
    context.subscriptions.push(selectionListener);

    const fileSelectionListener = vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (!editor) {
            return;
        }
        (async () => {
            try {
                await handleFileSelection(editor, layerTreeProvider, providerManager, fileToGeoJsonAdapters);
            } catch (error) {
                showOperationError('handle file selection', error);
            }
        })();
    });
    context.subscriptions.push(fileSelectionListener);

    const coordinateStatusbarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100
    );
    coordinateStatusbarItem.name = 'Map Coordinates';
    coordinateStatusbarItem.text = 'Map: 0.0000, 0.0000';
    coordinateStatusbarItem.tooltip = 'Mouse pointer location in WGS84 coordinates';
    coordinateStatusbarItem.show();
    context.subscriptions.push(coordinateStatusbarItem);

    context.subscriptions.push(
        vscode.commands.registerCommand('vscodeMaplibreViewer.openMapEditor', async () => {
            await mapEditorProvider.createPanel();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('vscodeMaplibreViewer.copyCoordinates', async () => {
            const lngLat = MapWebviewController.lastClickedLngLat;
            if (!lngLat || typeof lngLat.lat !== 'number' || typeof lngLat.lng !== 'number') {
                vscode.window.showWarningMessage('No map coordinate to copy. Right-click on the map first.');
                return;
            }
            await vscode.env.clipboard.writeText(formatCoordinate({ latitude: lngLat.lat, longitude: lngLat.lng }));
            vscode.window.showInformationMessage(`Copied: ${formatCoordinate({ latitude: lngLat.lat, longitude: lngLat.lng })}`);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('vscodeMaplibreViewer.updateCoordinates', (lngLat: { lng: number; lat: number }) => {
            if (lngLat && typeof lngLat.lat === 'number' && typeof lngLat.lng === 'number') {
                coordinateStatusbarItem.text = `Map: ${lngLat.lat.toFixed(4)}, ${lngLat.lng.toFixed(4)}`;
            }
        })
    );

    return api;
}

/**
 * Test-only accessor for the live extension components (the extension-host
 * counterpart of the webview's window.__test hook). Lets integration tests
 * query the real, visible map webviews and the live layer tree provider
 * without exposing test paths on the public API.
 */
export function getMapViewerTestAccess(): {
    mapWebviews: MapWebviewController[];
    layerTreeProvider: LayerTreeProvider;
} | undefined {
    if (!mapsViewProvider || !mapEditorProvider || !layerTreeProviderForTestAccess) {
        return undefined;
    }
    return {
        mapWebviews: [mapsViewProvider, mapEditorProvider],
        layerTreeProvider: layerTreeProviderForTestAccess
    };
}

export async function deactivate(): Promise<void> {
    // Only the provider that moved last persists its state; the other view's
    // state was already written per-view on every moveend.
    if (mapsViewProvider && mapEditorProvider) {
        const lastViewType = MapWebviewController.lastActiveViewType;
        if (lastViewType === 'mapEditor') {
            await mapEditorProvider.saveCurrentViewState();
        } else {
            await mapsViewProvider.saveCurrentViewState();
        }
        return;
    }
    if (mapsViewProvider) {
        await mapsViewProvider.saveCurrentViewState();
    }
    if (mapEditorProvider) {
        await mapEditorProvider.saveCurrentViewState();
    }
}

function createAPI(
    layerTreeProvider: LayerTreeProvider,
    onDidChangeActiveBasemapEmitter: vscode.EventEmitter<BaseMapStyle>,
    fileToGeoJsonAdapters: FileToGeoJsonAdapter[]
): MapLibreViewerAPI {
    return {
        registerBasemap: (provider: BasemapProvider) => {
            const basemap: BaseMapStyle = {
                id: provider.id,
                name: provider.name,
                styleUrl: provider.styleUrl,
                type: provider.type,
                tileUrl: provider.tileUrl,
                tileSize: provider.tileSize,
                attribution: provider.attribution,
                minzoom: provider.minzoom,
                maxzoom: provider.maxzoom,
                description: provider.description
            };
            return layerTreeProvider.registerBasemap(basemap);
        },
        getBasemaps: () => layerTreeProvider.getBasemaps(),
        getActiveBasemap: () => layerTreeProvider.getActiveBaseMap(),
        onDidChangeActiveBasemap: onDidChangeActiveBasemapEmitter.event,
        registerFileToGeoJsonAdapter: (adapter: FileToGeoJsonAdapter) => {
            fileToGeoJsonAdapters.push(adapter);
            return new vscode.Disposable(() => {
                const index = fileToGeoJsonAdapters.indexOf(adapter);
                if (index !== -1) {
                    fileToGeoJsonAdapters.splice(index, 1);
                }
            });
        },
        getFileToGeoJsonAdapters: () => [...fileToGeoJsonAdapters]
    };
}
