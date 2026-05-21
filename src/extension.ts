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
import { ProviderManager } from './map/providerManager';
import { showOperationError, confirmAction, getCoordinateSelectionState } from './extensionUtils';
import { StoredViewState } from './map/mapWebviewTypes';
import { handleSearchOnMap } from './searchHandler';
import { handleTextSelection, handleFileSelection } from './selectionHandler';
import { loadCustomCoordinatePatterns, registerLanguageCommands, registerCoordinateSelectionCommands } from './commandRegistration';
import { getConfig, onConfigurationChanged } from './services/configService';
import { debounce } from './services/debounce';
import { calculateBoundingBoxFromGeoJson } from './services/coordinateParser';

let mapsViewProvider: MapViewProvider;
let mapEditorProvider: MapEditorProvider;

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

    const savedViewState = getConfig().get<StoredViewState>('lastViewState');
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

    const sendVisibleOverlayLayers = () => {
        providerManager.updateOverlayLayers(layerTreeProvider.getVisibleOverlayLayers());
    };

    mapsViewProvider.onMapReady(sendVisibleOverlayLayers);
    mapEditorProvider.onMapReady(sendVisibleOverlayLayers);

    layerTreeProvider.onDidChangeLayers((event) => {
        if (event.type === 'baseMap') {
            providerManager.setBaseMap(event.data as BaseMapStyle);
        } else if (event.type === 'overlay') {
            sendVisibleOverlayLayers();
        }
    });

    layerTreeProvider.onDidAddLayerViaDragDrop((event) => {
        if (event.bbox) {
            providerManager.fitBoundsOnly(event.bbox);
        }
    });

    context.subscriptions.push(
        vscode.commands.registerCommand('vscodeMaplibreViewer.setBaseMap', async (baseMap: BaseMapStyle) => {
            try {
                await layerTreeProvider.setActiveBaseMap(baseMap.id);
            } catch (error) {
                showOperationError('set base map', error);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('vscodeMaplibreViewer.toggleLayer', async (layer: OverlayLayer) => {
            try {
                await layerTreeProvider.toggleLayerVisibility(layer.id);
            } catch (error) {
                showOperationError('toggle layer', error);
            }
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

            const url = await vscode.window.showInputBox({
                prompt: 'Enter the URL for this layer',
                placeHolder: layerType === 'GeoJSON URL'
                    ? 'https://example.com/data.geojson'
                    : 'https://example.com/tiles/{z}/{x}/{y}.pbf'
            });

            if (!url) {
                return;
            }

            const newLayer: OverlayLayer = {
                id: `layer-${Date.now()}`,
                name,
                type: layerType === 'GeoJSON URL' ? 'geojson' : 'vector',
                source: {
                    type: layerType === 'GeoJSON URL' ? 'geojson' : 'vector',
                    data: layerType === 'GeoJSON URL' ? url : undefined,
                    url: layerType === 'Vector Tiles URL' ? url : undefined
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
            const colorPickers: vscode.QuickPickItem[] = [
                { label: '$(circle-filled) Red', detail: '#FF0000' },
                { label: '$(circle-filled) Blue', detail: '#0000FF' },
                { label: '$(circle-filled) Green', detail: '#00FF00' },
                { label: '$(circle-filled) Yellow', detail: '#FFFF00' },
                { label: '$(circle-filled) Orange', detail: '#FFA500' },
                { label: '$(circle-filled) Purple', detail: '#800080' },
                { label: '$(circle-filled) Cyan', detail: '#00FFFF' },
                { label: '$(circle-filled) Magenta', detail: '#FF00FF' },
                { label: '$(circle-filled) Black', detail: '#000000' },
                { label: '$(circle-filled) White', detail: '#FFFFFF' },
                { label: '$(color-mode) Custom...', detail: 'custom' }
            ];

            const selected = await vscode.window.showQuickPick(colorPickers, {
                placeHolder: `Select color for "${layer.name}"`,
                title: 'Layer Color'
            });

            if (!selected) {
                return;
            }

            let color: string | undefined;
            if (selected.detail === 'custom') {
                color = await vscode.window.showInputBox({
                    prompt: 'Enter color value (hex, rgb, or color name)',
                    placeHolder: '#FF0000',
                    value: layer.color || '#FF0000'
                });
            } else {
                color = selected.detail;
            }

            if (!color) {
                return;
            }

            try {
                await layerTreeProvider.updateLayerColor(layer.id, color);
            } catch (error) {
                showOperationError('change layer color', error);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('vscodeMaplibreViewer.removeLayer', async (layer: OverlayLayer) => {
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

    context.subscriptions.push(
        onConfigurationChanged(() => {
            providerManager.updateConfiguration();
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('vscodeMaplibreViewer.baseMaps')) {
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

    const fileToGeoJsonAdapters: FileToGeoJsonAdapter[] = [];
    fileToGeoJsonAdapters.push(geojsonAdapter);
    fileToGeoJsonAdapters.push(gpxAdapter);
    layerTreeProvider.setFileAdapters(fileToGeoJsonAdapters);

    const fileSelectionListener = vscode.window.onDidChangeActiveTextEditor(async (editor) => {
        if (!editor) {
            return;
        }
        await handleFileSelection(editor, layerTreeProvider, providerManager, fileToGeoJsonAdapters);
    });
    context.subscriptions.push(fileSelectionListener);

    const onDidChangeActiveBasemapEmitter = new vscode.EventEmitter<BaseMapStyle>();

    layerTreeProvider.onDidChangeLayers((event) => {
        if (event.type === 'baseMap') {
            onDidChangeActiveBasemapEmitter.fire(event.data as BaseMapStyle);
        }
    });

    const api = createAPI(layerTreeProvider, onDidChangeActiveBasemapEmitter, fileToGeoJsonAdapters);

    const defaultBasemap: BasemapProvider = {
        id: 'maplibre-demotiles',
        name: 'Demotiles',
        type: 'vector',
        styleUrl: 'https://demotiles.maplibre.org/style.json'
    };
    const defaultBasemapDisposable = api.registerBasemap(defaultBasemap);
    context.subscriptions.push(defaultBasemapDisposable);

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
        vscode.commands.registerCommand('vscodeMaplibreViewer.updateCoordinates', (lngLat: { lng: number; lat: number }) => {
            if (lngLat && typeof lngLat.lat === 'number' && typeof lngLat.lng === 'number') {
                coordinateStatusbarItem.text = `Map: ${lngLat.lat.toFixed(4)}, ${lngLat.lng.toFixed(4)}`;
            }
        })
    );

    return api;
}

export async function deactivate(): Promise<void> {
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
