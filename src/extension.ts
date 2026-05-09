// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { BookmarkManager } from './bookmarks/bookmarkManager';
import { BookmarkTreeProvider } from './bookmarks/bookmarkTreeProvider';
import { LayerTreeProvider } from './layers/layerTreeProvider';
import { BaseMapStyle, OverlayLayer } from './layers/layerTypes';
import { MapLibreViewerAPI, BasemapProvider, FileToGeoJsonAdapter } from './services/api';
import { geojsonAdapter } from './adapters/geojsonAdapter';
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

/**
 * Creates the public API object
 */
function createAPI(
	layerTreeProvider: LayerTreeProvider,
	onDidChangeActiveBasemapEmitter: vscode.EventEmitter<BaseMapStyle>,
	fileToGeoJsonAdapters: FileToGeoJsonAdapter[]
): MapLibreViewerAPI {
	return {
		registerBasemap: (provider: BasemapProvider) => {
			// Convert BasemapProvider to BaseMapStyle
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

// Module-level variables to preserve view state on deactivation
let mapsViewProvider: MapViewProvider;
let mapEditorProvider: MapEditorProvider;

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext): Promise<MapLibreViewerAPI> {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "vscode-maplibre-viewer" is now active!');

	// Load custom coordinate patterns from settings
	loadCustomCoordinatePatterns();

	// Initialize coordinate selection state from globalState (default: true)
	// MUST be set BEFORE registering the webview view provider
	const coordinateSelectionEnabled = getCoordinateSelectionState(context);
	
	// Set the context variable for the toolbar icon
	vscode.commands.executeCommand('setContext', 'maplibreView.coordinateSelectionEnabled', coordinateSelectionEnabled);

	// Initialize BookmarkManager with globalState for persistence
	const bookmarkManager = new BookmarkManager(context.globalState);

	// Initialize and register the Bookmark Tree Provider
	const bookmarkTreeProvider = new BookmarkTreeProvider(bookmarkManager);

	// Register bookmark tree provider commands (rename, etc.)
	bookmarkTreeProvider.registerCommands(context);

	context.subscriptions.push(
		vscode.window.registerTreeDataProvider('bookmarksView', bookmarkTreeProvider)
	);

	// Initialize and register the Layer Tree Provider
	const layerTreeProvider = new LayerTreeProvider(context);

	// Check if there's a saved baseMapId in settings and apply it
	const savedViewState = getConfig().get<StoredViewState>('lastViewState');
	if (savedViewState?.baseMapId) {
		// Try to set the saved base map (will fall back if not found)
		try {
			await layerTreeProvider.setActiveBaseMap(savedViewState.baseMapId);
		} catch {
			// Base map not found, will use default
			console.log('Saved base map not found, using default');
		}
	}

	// Register the Maps webview provider with the initial active basemap
	const initialBaseMap = layerTreeProvider.getActiveBaseMap();
	mapsViewProvider = new MapViewProvider(context.extensionUri, bookmarkManager, initialBaseMap?.styleUrl, initialBaseMap?.id);

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider('mapsView', mapsViewProvider)
	);

	mapEditorProvider = new MapEditorProvider(context.extensionUri, bookmarkManager, initialBaseMap?.styleUrl, initialBaseMap?.id);

	// Create the ProviderManager and register both providers
	const providerManager = new ProviderManager();
	providerManager.register(mapsViewProvider);
	providerManager.register(mapEditorProvider);

	// Register the layers tree view with drag-and-drop support
	// Note: We use createTreeView instead of registerTreeDataProvider to enable drag-and-drop
	const layersTreeView = vscode.window.createTreeView('layersView', {
		treeDataProvider: layerTreeProvider,
		dragAndDropController: layerTreeProvider,
		showCollapseAll: true
	});
	context.subscriptions.push(layersTreeView);

	// Function to send current visible overlay layers to webview providers
	const sendVisibleOverlayLayers = () => {
		const visibleLayers = layerTreeProvider.getVisibleOverlayLayers();
		providerManager.updateOverlayLayers(visibleLayers);
	};

	// Register callbacks for when webviews' maps are ready
	mapsViewProvider.onMapReady(sendVisibleOverlayLayers);
	mapEditorProvider.onMapReady(sendVisibleOverlayLayers);

	// Listen for layer changes and update the webview
	layerTreeProvider.onDidChangeLayers((event) => {
		if (event.type === 'baseMap') {
			providerManager.setBaseMap(event.data as BaseMapStyle);
		} else if (event.type === 'overlay') {
			const visibleLayers = layerTreeProvider.getVisibleOverlayLayers();
			providerManager.updateOverlayLayers(visibleLayers);
		}
	});

	// Listen for layers added via drag-and-drop and zoom the map to fit
	layerTreeProvider.onDidAddLayerViaDragDrop((event) => {
		if (event.bbox) {
			providerManager.fitBoundsOnly(event.bbox);
		}
	});

	// Register command to set active base map
	context.subscriptions.push(
		vscode.commands.registerCommand('vscodeMaplibreViewer.setBaseMap', async (baseMap: BaseMapStyle) => {
			try {
				await layerTreeProvider.setActiveBaseMap(baseMap.id);
			} catch (error) {
				showOperationError('set base map', error);
			}
		})
	);

	// Register command to toggle layer visibility
	context.subscriptions.push(
		vscode.commands.registerCommand('vscodeMaplibreViewer.toggleLayer', async (layer: OverlayLayer) => {
			try {
				await layerTreeProvider.toggleLayerVisibility(layer.id);
			} catch (error) {
				showOperationError('toggle layer', error);
			}
		})
	);

	// Register command to add a new overlay layer
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

	// Register command to remove an overlay layer
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

	// Register bookmark-related commands
	bookmarkManager.registerCommands(context, bookmarkTreeProvider, providerManager);

	// Register configuration change listener using configService
	context.subscriptions.push(
		onConfigurationChanged(() => {
			providerManager.updateConfiguration();
		})
	);

	// Register specific configuration change listeners
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((e) => {
			// Rebuild basemaps when the baseMaps setting changes
			if (e.affectsConfiguration('vscodeMaplibreViewer.baseMaps')) {
				layerTreeProvider.rebuildBaseMaps();
			}
			// Reload custom coordinate patterns when the setting changes
			if (e.affectsConfiguration('vscodeMaplibreViewer.coordinatePatterns')) {
				loadCustomCoordinatePatterns();
				vscode.window.showInformationMessage('Custom coordinate patterns reloaded.');
			}
		})
	);

	// Register language change commands
	registerLanguageCommands(context, providerManager);

	// Register coordinate selection commands
	registerCoordinateSelectionCommands(context);

	// Register open settings command
	context.subscriptions.push(
		vscode.commands.registerCommand('vscodeMaplibreViewer.openSettings', () => {
			vscode.commands.executeCommand(
				'workbench.action.openSettings',
				'vscodeMaplibreViewer'
			);
		})
	);

	// Register search on map command - shows filtered dialog with selected text as default
	context.subscriptions.push(
		vscode.commands.registerCommand('vscodeMaplibreViewer.searchOnMap', (args?: unknown) =>
			handleSearchOnMap(args, providerManager)
		)
	);

	// Create debounced text selection handler
	const debouncedTextSelection = debounce(() => {
		handleTextSelection(providerManager);
	}, 300);

	// Register text selection listener for coordinate parsing
	const selectionListener = vscode.window.onDidChangeTextEditorSelection(() => {
		// Check if coordinate selection is enabled
		const isEnabled = getCoordinateSelectionState(context);
		if (!isEnabled) {
			return;
		}

		// Call the debounced handler
		debouncedTextSelection();
	});

	// Clean up the listener when the extension is deactivated
	context.subscriptions.push(selectionListener);

	// Registry for file-to-GeoJSON adapters
	const fileToGeoJsonAdapters: FileToGeoJsonAdapter[] = [];

	// Register the built-in GeoJSON adapter
	fileToGeoJsonAdapters.push(geojsonAdapter);

	// Set the file adapters on the layer tree provider for drag-and-drop conversion
	layerTreeProvider.setFileAdapters(fileToGeoJsonAdapters);

	// Register file selection listener for the navigator view
	const fileSelectionListener = vscode.window.onDidChangeActiveTextEditor(async (editor) => {
		if (!editor) {
			return;
		}
		
		await handleFileSelection(editor, layerTreeProvider, providerManager, fileToGeoJsonAdapters);
	});

	// Clean up the file selection listener when the extension is deactivated
	context.subscriptions.push(fileSelectionListener);

	// Create an event emitter for active basemap changes (for external API)
	const onDidChangeActiveBasemapEmitter = new vscode.EventEmitter<BaseMapStyle>();
	
	// Listen to layer changes and forward only basemap changes
	layerTreeProvider.onDidChangeLayers((event) => {
		if (event.type === 'baseMap') {
			onDidChangeActiveBasemapEmitter.fire(event.data as BaseMapStyle);
		}
	});

	// Export the public API for external extensions
	const api = createAPI(layerTreeProvider, onDidChangeActiveBasemapEmitter, fileToGeoJsonAdapters);

	// Register the default basemap using our own API
	const defaultBasemap: BasemapProvider = {
		id: 'maplibre-demotiles',
		name: 'Demotiles',
		type: 'vector',
		styleUrl: 'https://demotiles.maplibre.org/style.json'
	};
	const defaultBasemapDisposable = api.registerBasemap(defaultBasemap);
	context.subscriptions.push(defaultBasemapDisposable);

	// Return the API for other extensions to consume
	// Register command to open the Map Editor panel
	context.subscriptions.push(
		vscode.commands.registerCommand('vscodeMaplibreViewer.openMapEditor', async () => {
			await mapEditorProvider.createPanel();
		})
	);

	return api;
}

// This method is called when your extension is deactivated
export async function deactivate() {
	await mapsViewProvider.saveCurrentViewState();
	await mapEditorProvider.saveCurrentViewState();
}