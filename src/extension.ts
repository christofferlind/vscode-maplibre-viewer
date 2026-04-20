// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import { parseCoordinate, parseMultipleCoordinates, calculateBoundingBox, extractCoordinatesFromGeoJson, Coordinate, addCoordinatePattern, clearCustomPatterns } from './coordinateParser';
import { BookmarkManager } from './bookmarkManager';
import { MapBookmark } from './bookmarkTypes';
import { BookmarkTreeProvider } from './bookmarkTreeProvider';
import { LayerTreeProvider } from './layerTreeProvider';
import { BaseMapStyle, OverlayLayer } from './layerTypes';
import { MapLibreViewerAPI, BasemapProvider, FileToGeoJsonAdapter } from './api';
import { geojsonAdapter } from './adapters/geojsonAdapter';
import { MapViewProvider } from './mapViewProvider';
import { MapEditorProvider } from './mapEditorProvider';
import { LANGUAGE_OPTIONS } from './languageOptions';
import { confirmAction, showOperationError, updateCoordinateSelectionState, getCoordinateSelectionState, toggleCoordinateSelectionState } from './extensionUtils';
import { performGeocodingSearch, extractSearchTextFromArgs, getSelectedTextFromEditor, SearchResultData } from './geocodingSearch';

// Interface for view state stored in settings
interface StoredViewState {
	center: { lat: number; lng: number };
	zoom: number;
	bearing: number;
	pitch: number;
	baseMapId?: string;
}

/**
 * Loads custom coordinate patterns from VS Code settings
 */
function loadCustomCoordinatePatterns(): void {
	// Clear any existing custom patterns
	clearCustomPatterns();
	
	// Get custom patterns from configuration
	const config = vscode.workspace.getConfiguration('vscodeMaplibreViewer');
	const patterns = config.get<Array<{name: string; pattern: string; flags?: string}>>('coordinatePatterns');
	
	if (!patterns || patterns.length === 0) {
		return;
	}
	
	// Add each custom pattern
	for (const patternConfig of patterns) {
		try {
			const flags = patternConfig.flags || 'g';
			const regex = new RegExp(patternConfig.pattern, flags);
			addCoordinatePattern(regex);
			console.log(`Loaded custom coordinate pattern: ${patternConfig.name}`);
		} catch (error) {
			console.error(`Failed to load custom coordinate pattern "${patternConfig.name}": ${error}`);
			vscode.window.showWarningMessage(
				`Invalid coordinate pattern "${patternConfig.name}": ${error instanceof Error ? error.message : String(error)}`
			);
		}
	}
}

/**
 * Registers language change commands
 */
function registerLanguageCommands(context: vscode.ExtensionContext, providers: (MapViewProvider | MapEditorProvider)[]): void {
	// Register specific language commands
	const languageCommands: [string, string][] = [
		['vscodeMaplibreViewer.setLanguageNative', 'native'],
		['vscodeMaplibreViewer.setLanguageEnglish', 'en'],
		['vscodeMaplibreViewer.setLanguageGerman', 'de']
	];

	languageCommands.forEach(([commandId, languageCode]) => {
		context.subscriptions.push(
			vscode.commands.registerCommand(commandId, () => {
				providers.forEach(p => p.setMapLanguage(languageCode));
			})
		);
	});

	// Register generic language selection command
	context.subscriptions.push(
		vscode.commands.registerCommand('vscodeMaplibreViewer.setLanguage', async () => {
			const selected = await vscode.window.showQuickPick(LANGUAGE_OPTIONS, {
				placeHolder: 'Select a language for map labels',
				matchOnDescription: true,
				matchOnDetail: true
			});

			if (selected) {
				providers.forEach(p => p.setMapLanguage(selected.languageCode));
			}
		})
	);
}

/**
 * Registers coordinate selection commands
 */
function registerCoordinateSelectionCommands(context: vscode.ExtensionContext): void {
	// Register toggle coordinate selection command
	context.subscriptions.push(
		vscode.commands.registerCommand('vscodeMaplibreViewer.toggleCoordinateSelection', async () => {
			await toggleCoordinateSelectionState(context);
		})
	);

	// Register enable coordinate selection command (for toolbar icon when disabled)
	context.subscriptions.push(
		vscode.commands.registerCommand('vscodeMaplibreViewer.enableCoordinateSelection', async () => {
			await updateCoordinateSelectionState(context, true);
		})
	);

	// Register disable coordinate selection command (for toolbar icon when enabled)
	context.subscriptions.push(
		vscode.commands.registerCommand('vscodeMaplibreViewer.disableCoordinateSelection', async () => {
			await updateCoordinateSelectionState(context, false);
		})
	);
}

/**
 * Handles search on map command
 */
async function handleSearchOnMap(
	args: unknown,
	mapsViewProvider: MapViewProvider,
	mapEditorProvider: MapEditorProvider
): Promise<void> {
	// Try to get text from args first, then from editor
	let selectedText = extractSearchTextFromArgs(args);
	
	if (!selectedText) {
		selectedText = getSelectedTextFromEditor();
	}

	// Get configuration for geocoding
	const config = vscode.workspace.getConfiguration('vscodeMaplibreViewer');
	const geocodingApiKey = config.get<string>('geocodingApiKey') || '';
	const photonSearchUrl = config.get<string>('photonSearchUrl') || 'https://photon.komoot.io/api/';

	// Create a QuickPick for search
	const quickPick = vscode.window.createQuickPick();
	quickPick.placeholder = 'Search for a place on the map...';
	quickPick.value = selectedText;
	quickPick.matchOnDescription = true;
	quickPick.matchOnDetail = true;

	// Store search results with coordinates and optional bounding box
	const searchResultsMap = new Map<string, SearchResultData>();

	// Debounce timer for search
	let searchDebounceTimer: ReturnType<typeof setTimeout> | undefined;

	// Handle input changes with debounce
	quickPick.onDidChangeValue((value) => {
		if (searchDebounceTimer) {
			clearTimeout(searchDebounceTimer);
		}
		searchDebounceTimer = setTimeout(async () => {
			quickPick.busy = true;
			quickPick.items = await performGeocodingSearch(value, geocodingApiKey, photonSearchUrl, searchResultsMap);
			quickPick.busy = false;
		}, 300);
	});

	// Initial search if there's selected text
	if (selectedText.length >= 2) {
		quickPick.busy = true;
		const items = await performGeocodingSearch(selectedText, geocodingApiKey, photonSearchUrl, searchResultsMap);
		quickPick.items = items;
		quickPick.busy = false;
	}

	// Handle selection
	quickPick.onDidAccept(() => {
		const selected = quickPick.selectedItems[0];
		if (selected) {
			// Find the coordinates for the selected item
			const itemKey = `${selected.label}-${selected.detail}`;
			const coords = searchResultsMap.get(itemKey);
			
			if (coords) {
				if (coords.bbox) {
					// Use bounding box to fit the map
					mapsViewProvider.fitBoundsOnly(coords.bbox);
					mapEditorProvider.fitBoundsOnly(coords.bbox);
				} else if (coords.lat !== 0 && coords.lng !== 0) {
					// Fall back to flying to a point
					const config = vscode.workspace.getConfiguration('vscodeMaplibreViewer');
					const singlePointZoom = config.get<number>('singlePointZoom') ?? 14;
					mapsViewProvider.flyToLocation(coords.lat, coords.lng, singlePointZoom);
					mapEditorProvider.flyToLocation(coords.lat, coords.lng, singlePointZoom);
				}
			}
		}
		quickPick.hide();
	});

	// Show the QuickPick
	quickPick.show();
}

/**
 * Handles text selection for coordinate parsing
 */
function handleTextSelection(providers: (MapViewProvider | MapEditorProvider)[]): void {
	// Get the active editor
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		return;
	}

	// Get the selected text
	const selection = editor.selection;
	if (selection.isEmpty) {
		return;
	}

	const selectedText = editor.document.getText(selection);
	if (!selectedText || selectedText.trim().length === 0) {
		return;
	}

	// Try to parse multiple coordinates from the selected text
	const coordinates = parseMultipleCoordinates(selectedText);
	
	if (coordinates.length > 1) {
		// Multiple coordinates found - calculate bounding box and fit all
		const bbox = calculateBoundingBox(coordinates);
		if (bbox) {
			providers.forEach(p => p.fitBoundingBox(coordinates, bbox));
		}
	} else if (coordinates.length === 1) {
		// Single coordinate - fly to it with configured zoom level
		const config = vscode.workspace.getConfiguration('vscodeMaplibreViewer');
		const singlePointZoom = config.get<number>('singlePointZoom') ?? 14;
		providers.forEach(p => p.flyToLocation(coordinates[0].latitude, coordinates[0].longitude, singlePointZoom));
} else {
	// Fallback: try single coordinate parsing for backward compatibility
	const coordinate = parseCoordinate(selectedText);
	if (coordinate) {
		providers.forEach(p => p.flyToLocation(coordinate.latitude, coordinate.longitude));
	}
}
}

/**
 * Handles file selection for GeoJSON processing
 */
async function handleFileSelection(
	editor: vscode.TextEditor,
	layerTreeProvider: LayerTreeProvider,
	mapsViewProvider: MapViewProvider,
	mapEditorProvider: MapEditorProvider,
	fileToGeoJsonAdapters: FileToGeoJsonAdapter[]
): Promise<void> {
	const filePath = editor.document.uri.fsPath;
	console.log(`File selected in navigator: ${filePath}`);

	// Only clear the layer if it has content
	if (!layerTreeProvider.isSelectedFileLayerEmpty()) {
		await layerTreeProvider.updateSelectedFileLayer(null);
	}

	// Check if the "Selected file" layer is enabled
	const selectedFileLayer = layerTreeProvider.getSelectedFileLayer();
	if (selectedFileLayer && !selectedFileLayer.visible) {
		console.log('Selected file layer is disabled, skipping file processing');
		return;
	}

	// Check all registered file-to-GeoJSON adapters
	const fileExtension = path.extname(filePath).toLowerCase();
	for (const adapter of fileToGeoJsonAdapters) {
		if (adapter.canHandle(fileExtension)) {
			console.log(`Adapter "${adapter.getName()}" can handle ${fileExtension} files`);
			try {
				const geojson = await adapter.toGeoJson(filePath);
				
				// Update the selected file layer through the layer tree provider
				// This ensures the layer visibility state is properly managed
				await layerTreeProvider.updateSelectedFileLayer(geojson);
				
				// Extract coordinates from GeoJSON and fit map to bounding box
				// Use fitBoundsOnly to avoid creating blue markers - the GeoJSON layer already renders features
				const coordinates = extractCoordinatesFromGeoJson(geojson);
				if (coordinates.length > 0) {
					const bbox = calculateBoundingBox(coordinates);
					if (bbox) {
						mapsViewProvider.fitBoundsOnly(bbox);
						mapEditorProvider.fitBoundsOnly(bbox);
					}
				}
				
				return; // Use the first adapter that can handle the file
			} catch (error) {
				console.error(`Error converting file with ${adapter.getName()} adapter:`, error);
			}
		}
	}
}

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

	context.subscriptions.push(
		vscode.window.registerTreeDataProvider('bookmarksView', bookmarkTreeProvider)
	);

	// Initialize and register the Layer Tree Provider
	const layerTreeProvider = new LayerTreeProvider(context);

	// Check if there's a saved baseMapId in settings and apply it
	const config = vscode.workspace.getConfiguration('vscodeMaplibreViewer');
	const savedViewState = config.get<StoredViewState>('lastViewState');
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
	const mapsViewProvider = new MapViewProvider(context.extensionUri, bookmarkManager, initialBaseMap?.styleUrl, initialBaseMap?.id);

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider('mapsView', mapsViewProvider)
	);

	const mapEditorProvider = new MapEditorProvider(context.extensionUri, bookmarkManager, initialBaseMap?.styleUrl, initialBaseMap?.id);

	context.subscriptions.push(
		vscode.window.registerTreeDataProvider('layersView', layerTreeProvider)
	);

	// Listen for layer changes and update the webview
	layerTreeProvider.onDidChangeLayers((event) => {
		if (event.type === 'baseMap') {
			mapsViewProvider.setBaseMap(event.data as BaseMapStyle);
			mapEditorProvider.setBaseMap(event.data as BaseMapStyle);
		} else if (event.type === 'overlay') {
			const visibleLayers = layerTreeProvider.getVisibleOverlayLayers();
			mapsViewProvider.updateOverlayLayers(visibleLayers);
			mapEditorProvider.updateOverlayLayers(visibleLayers);
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
	bookmarkManager.registerCommands(context, bookmarkTreeProvider, mapsViewProvider, mapEditorProvider);

	// Register configuration change listener
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration('vscodeMaplibreViewer')) {
				mapsViewProvider.updateConfiguration();
				mapEditorProvider.updateConfiguration();
			}
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
	registerLanguageCommands(context, [mapsViewProvider, mapEditorProvider]);

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
			handleSearchOnMap(args, mapsViewProvider, mapEditorProvider)
		)
	);

	// Debounce timer for text selection listener
	let debounceTimer: ReturnType<typeof setTimeout> | undefined;

	// Register text selection listener for coordinate parsing
	const selectionListener = vscode.window.onDidChangeTextEditorSelection(() => {
		// Check if coordinate selection is enabled
		const isEnabled = getCoordinateSelectionState(context);
		if (!isEnabled) {
			return;
		}

		// Clear previous timer
		if (debounceTimer) {
			clearTimeout(debounceTimer);
		}

		// Debounce the handler (300ms)
		debounceTimer = setTimeout(() => {
			handleTextSelection([mapsViewProvider, mapEditorProvider]);
		}, 300);
	});

	// Clean up the listener when the extension is deactivated
	context.subscriptions.push(selectionListener);

	// Registry for file-to-GeoJSON adapters
	const fileToGeoJsonAdapters: FileToGeoJsonAdapter[] = [];

	// Register the built-in GeoJSON adapter
	fileToGeoJsonAdapters.push(geojsonAdapter);

	// Register file selection listener for the navigator view
	const fileSelectionListener = vscode.window.onDidChangeActiveTextEditor(async (editor) => {
		if (!editor) {
			return;
		}
		
		await handleFileSelection(editor, layerTreeProvider, mapsViewProvider, mapEditorProvider, fileToGeoJsonAdapters);
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
export function deactivate() {}