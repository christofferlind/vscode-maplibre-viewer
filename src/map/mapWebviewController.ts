import * as vscode from 'vscode';
import { BookmarkManager } from '../bookmarks/bookmarkManager';
import { MapBookmark, ViewState } from '../bookmarks/bookmarkTypes';
import { BaseMapStyle, OverlayLayer } from '../layers/layerTypes';
import { Coordinate } from '../services/coordinateParser';
import { performGeocodingSearch, SearchResultData } from '../services/geocodingSearch';
import { MapConfig, StoredViewState, GeocodingResult } from './mapWebviewTypes';
import {
    getMapConfiguration,
    saveViewStateToSettings,
    generateWebviewHtml,
    parseViewStateFromMessage
} from './mapWebviewUtils';
import { getConfig } from '../services/configService';

/**
 * Abstract base controller for MapLibre webview management
 * Provides common functionality for both sidebar view and editor panel
 */
export abstract class MapWebviewController {
    protected _pendingViewStateResolve?: (state: ViewState | undefined) => void;
    protected _pendingMapCenterResolve?: (center: { center: { latitude: number; longitude: number }; zoom: number; bearing: number; pitch: number } | { error: string }) => void;
    protected _currentBaseMapStyleUrl?: string;
    protected _currentBaseMapId?: string;
    protected _lastViewState?: ViewState;

    private _requestIdCounter = 0;
    private _pendingTestResolves: Map<number, { resolve: (value: unknown) => void; timeout: ReturnType<typeof setTimeout> }> = new Map();

    /**
     * Tracks which webview last triggered a context menu
     * Used by commands to know which view to operate on
     */
    public static lastActiveViewType: string = 'mapsView';

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
     * Returns a unique identifier for this view type
     * Used to differentiate context menu sources
     */
    protected getViewType(): string {
        return 'unknown';
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
            enableCommandUris: true,
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
    protected getHtmlForWebview(webview: vscode.Webview, viewType?: string): string {
        return generateWebviewHtml(
            this._extensionUri,
            webview,
            this.getConfiguration(),
            this._currentBaseMapStyleUrl,
            viewType
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
            const defaultZoom = getConfig().get<number>('singlePointZoom') ?? 14;
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
     * Queries the webview's __test API for internal state inspection.
     * Used by integration tests to verify map renderer behavior.
     * @param method - Method name on window.__test
     * @param args - Arguments to pass to the method
     * @param timeoutMs - Timeout in milliseconds (default 5000)
     * @returns Promise resolving to the method's return value
     */
    public async queryWebview(method: string, args?: unknown[], timeoutMs?: number): Promise<unknown> {
        const webview = this.getWebview();
        if (!webview) {
            return undefined;
        }

        const requestId = ++this._requestIdCounter;
        const timeout = timeoutMs || 5000;

        return new Promise<unknown>((resolve) => {
            const timeoutHandle = setTimeout(() => {
                this._pendingTestResolves.delete(requestId);
                resolve(undefined);
            }, timeout);

            this._pendingTestResolves.set(requestId, { resolve, timeout: timeoutHandle });

            webview.postMessage({
                type: '__testQuery',
                requestId: requestId,
                method: method,
                args: args || []
            });
        });
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
     * Gets the current map center from the webview
     * @returns Promise resolving to the map center or undefined if unavailable
     */
    public async getMapCenter(): Promise<{ center: { latitude: number; longitude: number }; zoom: number; bearing: number; pitch: number } | undefined> {
        const webview = this.getWebview();
        if (!webview) {
            return undefined;
        }

        return new Promise<{ center: { latitude: number; longitude: number }; zoom: number; bearing: number; pitch: number } | undefined>((resolve) => {
            this._pendingMapCenterResolve = (result) => {
                if ('error' in result) {
                    resolve(undefined);
                } else {
                    resolve(result);
                }
            };
            webview.postMessage({ type: 'getMapCenter' });

            setTimeout(() => {
                if (this._pendingMapCenterResolve) {
                    this._pendingMapCenterResolve = undefined;
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
                
                if (!viewState) {
                    if (this._pendingViewStateResolve) {
                        this._pendingViewStateResolve(undefined);
                        this._pendingViewStateResolve = undefined;
                    }
                    break;
                }
                
                if (this._pendingViewStateResolve) {
                    this._pendingViewStateResolve(viewState);
                    this._pendingViewStateResolve = undefined;
                }
                this._lastViewState = viewState;
                await saveViewStateToSettings(viewState, this._currentBaseMapId);
                break;
                
            case 'contextMenu':
                // Set context for webview context menu commands
                console.log('[Extension] Received contextMenu message', msg.lngLat);
                const lngLat = msg.lngLat as { lng: number; lat: number } | undefined;
                if (lngLat) {
                    await vscode.commands.executeCommand('setContext', 'maplibre:clickedLngLat', lngLat);
                    await vscode.commands.executeCommand('setContext', 'maplibre:hasClickedLngLat', true);
                    // Track which webview triggered the context menu
                    MapWebviewController.lastActiveViewType = this.getViewType();
                }
                break;
                
            case 'geocodingSearch':
                await this.handleGeocodingSearch(msg.query as string);
                break;
                
            case 'mapReady':
                // Map is ready, request overlay layers callback
                console.log('[Extension] Received mapReady message - map is initialized');
                this._onMapReady?.();
                break;

            case 'mapCenterResponse':
                // Handle map center response from webview
                if (this._pendingMapCenterResolve) {
                    if (msg.error) {
                        this._pendingMapCenterResolve({ error: msg.error as string });
                    } else {
                        this._pendingMapCenterResolve({
                            center: msg.center as { latitude: number; longitude: number },
                            zoom: msg.zoom as number,
                            bearing: msg.bearing as number,
                            pitch: msg.pitch as number
                        });
                    }
                    this._pendingMapCenterResolve = undefined;
                }
                break;

            case '__testResponse':
                const requestId = msg.requestId as number;
                const pending = this._pendingTestResolves.get(requestId);
                if (pending) {
                    clearTimeout(pending.timeout);
                    this._pendingTestResolves.delete(requestId);
                    pending.resolve(msg.result);
                }
                break;
        }
    }

    /**
     * Sets the callback for when the webview's map is ready
     */
    private _onMapReady?: () => void;

    /**
     * Registers a callback to be called when the webview's map is ready
     */
    public onMapReady(callback: () => void): void {
        this._onMapReady = callback;
    }

    /**
     * Saves the current view state to settings
     * Called when the extension deactivates to preserve viewport
     */
    public async saveCurrentViewState(): Promise<void> {
        if (this._lastViewState) {
            await saveViewStateToSettings(this._lastViewState, this._currentBaseMapId);
        }
    }

    /**
     * Handles geocoding search requests from the webview
     * @param query - The search query
     */
    private async handleGeocodingSearch(query: string): Promise<void> {
        const webview = this.getWebview();
        if (!webview) {
            return;
        }
        
        const config = this.getConfiguration();
        const searchResultsMap = new Map<string, SearchResultData>();
        
        const items = await performGeocodingSearch(
            query,
            config.geocodingApiKey,
            config.photonSearchUrl,
            searchResultsMap
        );
        
        // Convert SearchResultData to GeocodingResult format
        const results: GeocodingResult[] = [];
        for (const item of items) {
            const key = `${item.label}-${item.detail}`;
            const data = searchResultsMap.get(key);
            if (data) {
                results.push({
                    name: item.label,
                    type: item.description || 'place',
                    lat: data.lat,
                    lng: data.lng,
                    bbox: data.bbox ? {
                        west: data.bbox.southwest.longitude,
                        south: data.bbox.southwest.latitude,
                        east: data.bbox.northeast.longitude,
                        north: data.bbox.northeast.latitude
                    } : undefined
                });
            }
        }
        
        webview.postMessage({
            type: 'geocodingSearchResults',
            results: results
        });
    }
}