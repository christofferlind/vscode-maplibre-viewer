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
 * Manages the MapLibre webview editor panel
 */
export class MapEditorProvider {
	private _panel?: vscode.WebviewPanel;
	private _pendingViewStateResolve?: (state: ViewState | undefined) => void;
	private _currentBaseMapStyleUrl?: string;
	private _currentBaseMapId?: string;

	constructor(
		private readonly _extensionUri: vscode.Uri,
		private readonly _bookmarkManager: BookmarkManager,
		initialStyleUrl?: string,
		initialBaseMapId?: string
	) {
		if (initialStyleUrl) {
			this._currentBaseMapStyleUrl = initialStyleUrl;
		}
		if (initialBaseMapId) {
			this._currentBaseMapId = initialBaseMapId;
		}
	}

	public async createPanel(column: vscode.ViewColumn = vscode.ViewColumn.One): Promise<vscode.WebviewPanel> {
		if (this._panel) {
			try {
				this._panel.reveal(column);
				return this._panel;
			} catch (e) {
				this._panel = undefined;
			}
		}

		this._panel = vscode.window.createWebviewPanel(
			'mapEditor',
			'Map Viewer Editor',
			{
				viewColumn: column
			}
		);

		this._panel.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(this._extensionUri, 'resources')
			]
		};

		this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);

		this._panel.webview.onDidReceiveMessage(
			(message: unknown) => {
				this.handleWebviewMessage(message);
			},
			undefined,
			[]
		);

		return this._panel;
	}

	public updateConfiguration(): void {
		if (this._panel) {
			const config = this.getConfiguration();
			this._panel.webview.postMessage({
				type: 'configUpdate',
				config: config
			});
		}
	}

	public setMapLanguage(languageCode: string): void {
		if (this._panel) {
			this._panel.webview.postMessage({
				type: 'languageChange',
				language: languageCode
			});
		}
	}

	public flyToLocation(latitude: number, longitude: number, zoom?: number): void {
		if (this._panel) {
			const config = vscode.workspace.getConfiguration('vscodeMaplibreViewer');
			const defaultZoom = config.get<number>('singlePointZoom') ?? 14;
			const zoomLevel = zoom ?? defaultZoom;
			
			this._panel.webview.postMessage({
				type: 'flyToLocation',
				latitude: latitude,
				longitude: longitude,
				zoom: zoomLevel
			});
		}
	}

	public fitBoundingBox(coordinates: Coordinate[], bbox: { southwest: Coordinate; northeast: Coordinate }): void {
		if (this._panel) {
			this._panel.webview.postMessage({
				type: 'fitBoundingBox',
				coordinates: coordinates,
				boundingBox: bbox
			});
		}
	}

	public fitBoundsOnly(bbox: { southwest: Coordinate; northeast: Coordinate }): void {
		if (this._panel) {
			this._panel.webview.postMessage({
				type: 'fitBoundsOnly',
				boundingBox: bbox
			});
		}
	}

	public flyToBookmark(bookmark: MapBookmark): void {
		if (this._panel) {
			this._panel.webview.postMessage({
				type: 'flyToBookmark',
				bookmark: bookmark
			});
		}
	}

	public setBaseMap(baseMap: BaseMapStyle): void {
		this._currentBaseMapStyleUrl = baseMap.styleUrl;
		this._currentBaseMapId = baseMap.id;

		if (this._panel) {
			this._panel.webview.postMessage({
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

	public updateOverlayLayers(layers: OverlayLayer[]): void {
		if (this._panel) {
			this._panel.webview.postMessage({
				type: 'updateOverlayLayers',
				layers: layers
			});
		}
	}

	public updateSelectedFileLayer(geojson: object | null): void {
		if (this._panel) {
			this._panel.webview.postMessage({
				type: 'updateSelectedFileLayer',
				geojson: geojson
			});
		}
	}

	public async getCurrentViewState(): Promise<ViewState | undefined> {
		if (!this._panel) {
			return undefined;
		}

		return new Promise<ViewState | undefined>((resolve) => {
			this._pendingViewStateResolve = resolve;
			this._panel?.webview.postMessage({ type: 'requestViewState' });
			
			setTimeout(() => {
				if (this._pendingViewStateResolve) {
					this._pendingViewStateResolve = undefined;
					resolve(undefined);
				}
			}, 5000);
		});
	}

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
					
					if (this._pendingViewStateResolve) {
						this._pendingViewStateResolve(state);
						this._pendingViewStateResolve = undefined;
					}
					
					await this.saveViewState(state);
				} else if (this._pendingViewStateResolve) {
					this._pendingViewStateResolve(undefined);
					this._pendingViewStateResolve = undefined;
				}
				break;
		}
	}

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

	private _getUri(webview: vscode.Webview, ...pathSegments: string[]): vscode.Uri {
		const fileUri = vscode.Uri.joinPath(this._extensionUri, ...pathSegments);
		return webview.asWebviewUri(fileUri);
	}

	private _getHtmlForWebview(webview: vscode.Webview): string {
		const nonce = getNonce();
		const config = this.getConfiguration();
		const styleUrl = this._currentBaseMapStyleUrl || 'https://demotiles.maplibre.org/style.json';

		const maplibreJsUri = this._getUri(webview, 'resources', 'maplibre-gl', 'maplibre-gl.js');
		const maplibreCssUri = this._getUri(webview, 'resources', 'maplibre-gl', 'maplibre-gl.css');

		const workerPath = path.join(this._extensionUri.fsPath, 'resources', 'maplibre-gl', 'maplibre-gl-worker.js');
		const workerContent = fs.readFileSync(workerPath, 'utf8');
		const workerBase64 = Buffer.from(workerContent).toString('base64');

		const htmlPath = path.join(this._extensionUri.fsPath, 'resources', 'map-view.html');
		let htmlContent = fs.readFileSync(htmlPath, 'utf8');

		htmlContent = htmlContent.replace(/\$\{cspSource\}/g, webview.cspSource);
		htmlContent = htmlContent.replace(/\$\{nonce\}/g, nonce);
		htmlContent = htmlContent.replace(/\$\{mapStyleUrl\}/g, styleUrl);
		htmlContent = htmlContent.replace(/\$\{geocodingApiKey\}/g, config.geocodingApiKey);
		htmlContent = htmlContent.replace(/\$\{photonSearchUrl\}/g, config.photonSearchUrl);
		htmlContent = htmlContent.replace(/\$\{enableSearch\}/g, String(config.enableSearch));
		htmlContent = htmlContent.replace(/\$\{flyToDuration\}/g, String(config.flyToDuration));
		
		const initialViewStateJson = config.initialViewState
			? JSON.stringify(config.initialViewState)
			: 'null';
		htmlContent = htmlContent.replace(
			/var initialViewState = null;/g,
			`var initialViewState = ${initialViewStateJson};`
		);
		
		htmlContent = htmlContent.replace(/\$\{maplibreJsUri\}/g, maplibreJsUri.toString());
		htmlContent = htmlContent.replace(/\$\{maplibreCssUri\}/g, maplibreCssUri.toString());
		htmlContent = htmlContent.replace(/\$\{maplibreWorkerBase64\}/g, workerBase64);

		return htmlContent;
	}
}
