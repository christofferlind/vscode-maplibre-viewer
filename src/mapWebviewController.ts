import * as vscode from 'vscode';
import { BookmarkManager } from './bookmarkManager';
import { MapBookmark, ViewState } from './bookmarkTypes';
import { BaseMapStyle, OverlayLayer } from './layerTypes';
import { Coordinate } from './coordinateParser';
import { MapConfig, StoredViewState } from './mapWebviewTypes';
import { 
    getMapConfiguration, 
    saveViewStateToSettings, 
    generateWebviewHtml,
    parseViewStateFromMessage 
} from './mapWebviewUtils';

/**
 * Abstract base controller for MapLibre webview management
 * Provides common functionality for both sidebar view and editor panel
 */
export abstract class MapWebviewController {
    protected _pendingViewStateResolve?: (state: ViewState | undefined) => void;
    protected _currentBaseMapStyleUrl?: string;
    protected _currentBaseMapId?: string;

    constructor(
        protected readonly _extensionUri: vscode.Uri,
        protected readonly _bookmarkManager: BookmarkManager,
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

    /**
     * Abstract method to get the webview - implemented by subclasses
     */
    protected abstract getWebview(): vscode.Webview | undefined;

    /**
     * Gets the webview options for local resource roots
     */
    protected getWebviewOptions(): vscode.WebviewOptions {
        return {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this._extensionUri, 'resources')
            ]
        };
    }

    /**
     * Gets the current configuration from VS Code settings
     */
    protected getConfiguration(): MapConfig {
        return getMapConfiguration();
    }

    /**
     * Generates HTML for the webview
     */
    protected getHtmlForWebview(webview: vscode.Webview): string {
        return generateWebviewHtml(
            this._extensionUri,
            webview,
            this.getConfiguration(),
            this._currentBaseMapStyleUrl
        );
    }

    /**
     * Updates the map configuration when settings change
     */
    public updateConfiguration(): void {
        const webview = this.getWebview();
        if (webview) {
            const config = this.getConfiguration();
            webview.postMessage({
                type: 'configUpdate',
                config: config
            });
        }
    }

    /**
     * Sets the map language for labels
     */
    public setMapLanguage(languageCode: string): void {
        const webview = this.getWebview();
        if (webview) {
            webview.postMessage({
                type: 'languageChange',
                language: languageCode
            });
        }
    }

    /**
     * Flies to a specific location on the map
     */
    public flyToLocation(latitude: number, longitude: number, zoom?: number): void {
        const webview = this.getWebview();
        if (webview) {
            const config = vscode.workspace.getConfiguration('vscodeMaplibreViewer');
            const defaultZoom = config.get<number>('singlePointZoom') ?? 14;
            const zoomLevel = zoom ?? defaultZoom;
            
            webview.postMessage({
                type: 'flyToLocation',
                latitude: latitude,
                longitude: longitude,
                zoom: zoomLevel
            });
        }
    }

    /**
     * Fits the map to show all coordinates within a bounding box
     */
    public fitBoundingBox(coordinates: Coordinate[], bbox: { southwest: Coordinate; northeast: Coordinate }): void {
        const webview = this.getWebview();
        if (webview) {
            webview.postMessage({
                type: 'fitBoundingBox',
                coordinates: coordinates,
                boundingBox: bbox
            });
        }
    }

    /**
     * Fits the map to show a bounding box without creating markers
     */
    public fitBoundsOnly(bbox: { southwest: Coordinate; northeast: Coordinate }): void {
        const webview = this.getWebview();
        if (webview) {
            webview.postMessage({
                type: 'fitBoundsOnly',
                boundingBox: bbox
            });
        }
    }

    /**
     * Flies to a bookmark location on the map
     */
    public flyToBookmark(bookmark: MapBookmark): void {
        const webview = this.getWebview();
        if (webview) {
            webview.postMessage({
                type: 'flyToBookmark',
                bookmark: bookmark
            });
        }
    }

    /**
     * Sets the base map style
     */
    public setBaseMap(baseMap: BaseMapStyle): void {
        this._currentBaseMapStyleUrl = baseMap.styleUrl;
        this._currentBaseMapId = baseMap.id;

        const webview = this.getWebview();
        if (webview) {
            webview.postMessage({
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
     */
    public updateOverlayLayers(layers: OverlayLayer[]): void {
        const webview = this.getWebview();
        if (webview) {
            webview.postMessage({
                type: 'updateOverlayLayers',
                layers: layers
            });
        }
    }

    /**
     * Updates the "Selected file" layer with new GeoJSON data
     */
    public updateSelectedFileLayer(geojson: object | null): void {
        const webview = this.getWebview();
        if (webview) {
            webview.postMessage({
                type: 'updateSelectedFileLayer',
                geojson: geojson
            });
        }
    }

    /**
     * Gets the current view state from the webview
     */
    public async getCurrentViewState(): Promise<ViewState | undefined> {
        const webview = this.getWebview();
        if (!webview) {
            return undefined;
        }

        return new Promise<ViewState | undefined>((resolve) => {
            this._pendingViewStateResolve = resolve;
            webview.postMessage({ type: 'requestViewState' });
            
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
     */
    public async handleWebviewMessage(message: unknown): Promise<void> {
        const msg = message as Record<string, unknown>;
        
        switch (msg.type) {
            case 'viewStateChanged':
                const viewState = parseViewStateFromMessage(message);
                
                if (viewState) {
                    if (this._pendingViewStateResolve) {
                        this._pendingViewStateResolve(viewState);
                        this._pendingViewStateResolve = undefined;
                    }
                    await saveViewStateToSettings(viewState, this._currentBaseMapId);
                } else if (this._pendingViewStateResolve) {
                    this._pendingViewStateResolve(undefined);
                    this._pendingViewStateResolve = undefined;
                }
                break;
        }
    }
}