import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { BookmarkManager } from './bookmarkManager';
import { MapBookmark, ViewState } from './bookmarkTypes';
import { BaseMapStyle, OverlayLayer } from './layerTypes';
import { Coordinate } from './coordinateParser';

// Interface for configuration messages sent to the webview
interface MapConfig {
	geocodingApiKey: string;
	photonSearchUrl: string;
	enableSearch: boolean;
	flyToDuration: number;
	initialViewState?: ViewState;
}

// Interface for view state stored in settings
interface StoredViewState {
	center: { lat: number; lng: number };
	zoom: number;
	bearing: number;
	pitch: number;
	baseMapId?: string;
}

/**
 * Generates a random nonce for Content Security Policy
 */
function getNonce(): string {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

/**
 * Manages the MapLibre webview view
 */
export class MapViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'mapsView';

	private _view?: vscode.WebviewView;
	private _pendingViewStateResolve?: (state: ViewState | undefined) => void;
	private _currentBaseMapStyleUrl?: string;
	private _currentBaseMapId?: string;

	constructor(
		private readonly _extensionUri: vscode.Uri,
		private readonly _bookmarkManager: BookmarkManager,
		initialStyleUrl?: string,
		initialBaseMapId?: string
	) {
		// Store the initial style URL if provided
		if (initialStyleUrl) {
			this._currentBaseMapStyleUrl = initialStyleUrl;
		}
		// Store the initial base map ID if provided
		if (initialBaseMapId) {
			this._currentBaseMapId = initialBaseMapId;
		}
	}

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		this._view = webviewView;

		webviewView.webview.options = {
			// Allow scripts in the webview
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(this._extensionUri, 'resources')
			]
		};

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		// Handle messages from the webview
		webviewView.webview.onDidReceiveMessage(
			(message: unknown) => {
				this.handleWebviewMessage(message);
			},
			undefined,
			[]
		);
	}

	/**
	 * Updates the map configuration when settings change
	 */
	public updateConfiguration(): void {
		if (this._view) {
			const config = this.getConfiguration();
			this._view.webview.postMessage({
				type: 'configUpdate',
				config: config
			});
		}
	}

	/**
	 * Sets the map language for labels
	 * @param languageCode The language code ('native' for local names, or ISO 639-1 code like 'en', 'de', etc.)
	 */
	public setMapLanguage(languageCode: string): void {
		if (this._view) {
			this._view.webview.postMessage({
				type: 'languageChange',
				language: languageCode
			});
		}
	}

	/**
	 * Flies to a specific location on the map
	 * @param latitude The latitude coordinate
	 * @param longitude The longitude coordinate
	 * @param zoom Optional zoom level (defaults to configuration setting)
	 */
	public flyToLocation(latitude: number, longitude: number, zoom?: number): void {
		if (this._view) {
			// Get the zoom level from parameter or configuration
			const config = vscode.workspace.getConfiguration('vscodeMaplibreViewer');
			const defaultZoom = config.get<number>('singlePointZoom') ?? 14;
			const zoomLevel = zoom ?? defaultZoom;
			
			this._view.webview.postMessage({
				type: 'flyToLocation',
				latitude: latitude,
				longitude: longitude,
				zoom: zoomLevel
			});
		}
	}

	/**
	 * Fits the map to show all coordinates within a bounding box
	 * @param coordinates Array of coordinates to display
	 * @param bbox The bounding box containing southwest and northeast corners
	 */
	public fitBoundingBox(coordinates: Coordinate[], bbox: { southwest: Coordinate; northeast: Coordinate }): void {
		if (this._view) {
			this._view.webview.postMessage({
				type: 'fitBoundingBox',
				coordinates: coordinates,
				boundingBox: bbox
			});
		}
	}

	/**
	 * Fits the map to show a bounding box without creating markers
	 * Use this for GeoJSON file viewing where the layer already renders the features
	 * @param bbox The bounding box containing southwest and northeast corners
	 */
	public fitBoundsOnly(bbox: { southwest: Coordinate; northeast: Coordinate }): void {
		if (this._view) {
			this._view.webview.postMessage({
				type: 'fitBoundsOnly',
				boundingBox: bbox
			});
		}
	}

	/**
	 * Flies to a bookmark location on the map
	 * @param bookmark The bookmark to fly to
	 */
	public flyToBookmark(bookmark: MapBookmark): void {
		if (this._view) {
			this._view.webview.postMessage({
				type: 'flyToBookmark',
				bookmark: bookmark
			});
		}
	}

	/**
	 * Sets the base map style
	 * @param baseMap The base map style to use
	 */
	public setBaseMap(baseMap: BaseMapStyle): void {
		// Store the current style URL (for vector) and ID
		this._currentBaseMapStyleUrl = baseMap.styleUrl;
		this._currentBaseMapId = baseMap.id;

		if (this._view) {
			// Send message to webview to update style while preserving view state
			// Support both vector styles (styleUrl) and raster tiles (tileUrl)
			this._view.webview.postMessage({
				type: 'setBaseMap',
				basemap: {
					id: baseMap.id,
					name: baseMap.name,
					type: baseMap.type || (baseMap.styleUrl ? 'vector' : 'raster'),
					styleUrl: baseMap.styleUrl,
					tileUrl: baseMap.tileUrl,
					tileSize: baseMap.tileSize,
					attribution: baseMap.attribution,
					minzoom: baseMap.minzoom,
					maxzoom: baseMap.maxzoom
				}
			});
		}
	}

	/**
	 * Updates the overlay layers on the map
	 * @param layers Array of visible overlay layers
	 */
	public updateOverlayLayers(layers: OverlayLayer[]): void {
		if (this._view) {
			this._view.webview.postMessage({
				type: 'updateOverlayLayers',
				layers: layers
			});
		}
	}

	/**
	 * Updates the "Selected file" layer with new GeoJSON data
	 * @param geojson The GeoJSON data to display, or null to clear
	 */
	public updateSelectedFileLayer(geojson: object | null): void {
		if (this._view) {
			this._view.webview.postMessage({
				type: 'updateSelectedFileLayer',
				geojson: geojson
			});
		}
	}

	/**
	 * Gets the current view state from the webview
	 * @returns Promise resolving to the current view state, or undefined if unavailable
	 */
	public async getCurrentViewState(): Promise<ViewState | undefined> {
		if (!this._view) {
			return undefined;
		}

		return new Promise<ViewState | undefined>((resolve) => {
			// Store the resolve function to be called when we receive the response
			this._pendingViewStateResolve = resolve;
			
			// Request the view state from the webview
			this._view?.webview.postMessage({ type: 'requestViewState' });
			
			// Set a timeout to resolve with undefined if no response
			setTimeout(() => {
				if (this._pendingViewStateResolve) {
					this._pendingViewStateResolve = undefined;
					resolve(undefined);
				}
			}, 5000);
		});
	}

	/**
	 * Handles messages from the webview
	 * @param message The message from the webview
	 */
	public async handleWebviewMessage(message: unknown): Promise<void> {
		const msg = message as Record<string, unknown>;
		switch (msg.type) {
			case 'viewStateChanged':
				const viewState = msg.viewState as Record<string, unknown> | undefined;
				if (viewState && viewState.center) {
					const center = viewState.center as Record<string, number>;
					const state: ViewState = {
						center: {
							latitude: center.lat || center.latitude,
							longitude: center.lng || center.longitude
						},
						zoom: viewState.zoom as number,
						bearing: (viewState.bearing as number) || 0,
						pitch: (viewState.pitch as number) || 0
					};
					
					// If this is a response to a pending request, resolve it
					if (this._pendingViewStateResolve) {
						this._pendingViewStateResolve(state);
						this._pendingViewStateResolve = undefined;
					}
					
					// Save the view state to settings (debounced in webview)
					await this.saveViewState(state);
				} else if (this._pendingViewStateResolve) {
					this._pendingViewStateResolve(undefined);
					this._pendingViewStateResolve = undefined;
				}
				break;
		}
	}

	/**
	 * Gets the current configuration from VS Code settings
	 */
	private getConfiguration(): MapConfig {
		const config = vscode.workspace.getConfiguration('vscodeMaplibreViewer');
		const lastViewState = config.get<StoredViewState>('lastViewState');
		
		return {
			geocodingApiKey: config.get<string>('geocodingApiKey') || '',
			photonSearchUrl: config.get<string>('photonSearchUrl') || 'https://photon.komoot.io/api/',
			enableSearch: config.get<boolean>('enableSearch') ?? true,
			flyToDuration: config.get<number>('flyToDuration') ?? 500,
			initialViewState: lastViewState ? {
				center: {
					latitude: lastViewState.center.lat,
					longitude: lastViewState.center.lng
				},
				zoom: lastViewState.zoom,
				bearing: lastViewState.bearing || 0,
				pitch: lastViewState.pitch || 0
			} : undefined
		};
	}

	/**
	 * Saves the current view state to VS Code settings
	 */
	private async saveViewState(viewState: ViewState): Promise<void> {
		const config = vscode.workspace.getConfiguration('vscodeMaplibreViewer');
		const stateToStore: StoredViewState = {
			center: {
				lat: viewState.center.latitude,
				lng: viewState.center.longitude
			},
			zoom: viewState.zoom,
			bearing: viewState.bearing || 0,
			pitch: viewState.pitch || 0,
			baseMapId: this._currentBaseMapId
		};
		
		try {
			await config.update('lastViewState', stateToStore, vscode.ConfigurationTarget.Global);
		} catch (error) {
			console.error('Failed to save view state:', error);
		}
	}

	/**
	 * Gets the webview URI for a local resource file
	 */
	private _getUri(webview: vscode.Webview, ...pathSegments: string[]): vscode.Uri {
		const fileUri = vscode.Uri.joinPath(this._extensionUri, ...pathSegments);
		return webview.asWebviewUri(fileUri);
	}

	private _getHtmlForWebview(webview: vscode.Webview): string {
		// Use a nonce to only allow specific scripts to be run
		const nonce = getNonce();
		
		// Get the current configuration
		const config = this.getConfiguration();

		// Use the stored base map style URL if available, otherwise use default
		const styleUrl = this._currentBaseMapStyleUrl || 'https://demotiles.maplibre.org/style.json';

		// Get webview URIs for local MapLibre assets
		const maplibreJsUri = this._getUri(webview, 'resources', 'maplibre-gl', 'maplibre-gl.js');
		const maplibreCssUri = this._getUri(webview, 'resources', 'maplibre-gl', 'maplibre-gl.css');

		// Read the worker script and encode it as base64 for inline Blob URL
		// This is needed because VS Code webviews have cross-origin restrictions for Workers
		const workerPath = path.join(this._extensionUri.fsPath, 'resources', 'maplibre-gl', 'maplibre-gl-worker.js');
		const workerContent = fs.readFileSync(workerPath, 'utf8');
		const workerBase64 = Buffer.from(workerContent).toString('base64');

		// Read the HTML template from the resources folder
		const htmlPath = path.join(this._extensionUri.fsPath, 'resources', 'map-view.html');
		let htmlContent = fs.readFileSync(htmlPath, 'utf8');

		// Replace the placeholders with actual values
		htmlContent = htmlContent.replace(/\$\{cspSource\}/g, webview.cspSource);
		htmlContent = htmlContent.replace(/\$\{nonce\}/g, nonce);
		htmlContent = htmlContent.replace(/\$\{mapStyleUrl\}/g, styleUrl);
		htmlContent = htmlContent.replace(/\$\{geocodingApiKey\}/g, config.geocodingApiKey);
		htmlContent = htmlContent.replace(/\$\{photonSearchUrl\}/g, config.photonSearchUrl);
		htmlContent = htmlContent.replace(/\$\{enableSearch\}/g, String(config.enableSearch));
		htmlContent = htmlContent.replace(/\$\{flyToDuration\}/g, String(config.flyToDuration));
		
		// Replace initial view state placeholder
		const initialViewStateJson = config.initialViewState
			? JSON.stringify(config.initialViewState)
			: 'null';
		htmlContent = htmlContent.replace(
			/var initialViewState = null;/g,
			`var initialViewState = ${initialViewStateJson};`
		);
		
		// Replace MapLibre asset URIs
		htmlContent = htmlContent.replace(/\$\{maplibreJsUri\}/g, maplibreJsUri.toString());
		htmlContent = htmlContent.replace(/\$\{maplibreCssUri\}/g, maplibreCssUri.toString());
		htmlContent = htmlContent.replace(/\$\{maplibreWorkerBase64\}/g, workerBase64);

		return htmlContent;
	}
}