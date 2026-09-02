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

/** Message type guard helpers */
function isRecord(msg: unknown): msg is Record<string, unknown> {
    return typeof msg === 'object' && msg !== null;
}

function hasType(msg: unknown): msg is Record<string, unknown> & { type: string } {
    return isRecord(msg) && typeof msg.type === 'string';
}

/**
 * Abstract base controller for MapLibre webview management
 * Provides common functionality for both sidebar view and editor panel
 */
export abstract class MapWebviewController {
    protected _pendingViewStateResolve?: (state: ViewState | undefined) => void;
    protected _pendingMapCenterResolve?: (center: {
        center: { latitude: number; longitude: number };
        zoom: number;
        bearing: number;
        pitch: number;
    }) => void;
    protected _currentBaseMapStyleUrl?: string;
    protected _currentBaseMapId?: string;
    protected _lastViewState?: ViewState;

    private _requestIdCounter = 0;
    private _pendingTestResolves: Map<number, {
        resolve: (value: unknown) => void;
        reject: (reason?: unknown) => void;
        timeout: ReturnType<typeof setTimeout>;
    }> = new Map();

    /**
     * Tracks which webview last triggered a context menu
     */
    public static lastActiveViewType = 'mapsView';

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

    protected getViewType(): string {
        return 'unknown';
    }

    protected abstract getWebview(): vscode.Webview | undefined;

    protected getWebviewOptions(): vscode.WebviewOptions {
        return {
            enableScripts: true,
            enableCommandUris: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this._extensionUri, 'resources')
            ]
        };
    }

    protected getConfiguration(): MapConfig {
        return getMapConfiguration();
    }

    protected getHtmlForWebview(webview: vscode.Webview, viewType?: string): string {
        return generateWebviewHtml(
            this._extensionUri,
            webview,
            this.getConfiguration(),
            this._currentBaseMapStyleUrl,
            viewType
        );
    }

    public updateConfiguration(): void {
        const webview = this.getWebview();
        if (!webview) {
            return;
        }
        const config = this.getConfiguration();
        webview.postMessage({
            type: 'configUpdate',
            config
        });
    }

    public setMapLanguage(languageCode: string): void {
        const webview = this.getWebview();
        if (!webview) {
            return;
        }
        webview.postMessage({
            type: 'languageChange',
            language: languageCode
        });
    }

    public flyToLocation(latitude: number, longitude: number, zoom?: number): void {
        const webview = this.getWebview();
        if (!webview) {
            return;
        }
        const defaultZoom = getConfig().get<number>('singlePointZoom') ?? 14;
        webview.postMessage({
            type: 'flyToLocation',
            latitude,
            longitude,
            zoom: zoom ?? defaultZoom
        });
    }

    public fitBoundingBox(
        coordinates: Coordinate[],
        bbox: { southwest: Coordinate; northeast: Coordinate }
    ): void {
        const webview = this.getWebview();
        if (!webview) {
            return;
        }
        webview.postMessage({
            type: 'fitBoundingBox',
            coordinates,
            boundingBox: bbox
        });
    }

    public fitBoundsOnly(bbox: { southwest: Coordinate; northeast: Coordinate }): void {
        const webview = this.getWebview();
        if (!webview) {
            return;
        }
        webview.postMessage({
            type: 'fitBoundsOnly',
            boundingBox: bbox
        });
    }

    public flyToBookmark(bookmark: MapBookmark): void {
        const webview = this.getWebview();
        if (!webview) {
            return;
        }
        webview.postMessage({
            type: 'flyToBookmark',
            bookmark
        });
    }

    public setBaseMap(baseMap: BaseMapStyle): void {
        this._currentBaseMapStyleUrl = baseMap.styleUrl;
        this._currentBaseMapId = baseMap.id;

        const webview = this.getWebview();
        if (!webview) {
            return;
        }
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

    public updateOverlayLayers(layers: OverlayLayer[]): void {
        const webview = this.getWebview();
        if (!webview) {
            return;
        }
        webview.postMessage({
            type: 'updateOverlayLayers',
            layers
        });
    }

    public updateSelectedFileLayer(geojson: object | null): void {
        const webview = this.getWebview();
        if (!webview) {
            return;
        }
        webview.postMessage({
            type: 'updateSelectedFileLayer',
            geojson
        });
    }

    public async queryWebview(method: string, args?: unknown[], timeoutMs = 5000): Promise<unknown> {
        const webview = this.getWebview();
        if (!webview) {
            return undefined;
        }

        const requestId = ++this._requestIdCounter;

        return new Promise<unknown>((resolve, reject) => {
            const timeoutHandle = setTimeout(() => {
                this._pendingTestResolves.delete(requestId);
                resolve(undefined);
            }, timeoutMs);

            this._pendingTestResolves.set(requestId, { resolve, reject, timeout: timeoutHandle });

            webview.postMessage({
                type: '__testQuery',
                requestId,
                method,
                args: args || []
            });
        });
    }

    public async getCurrentViewState(): Promise<ViewState | undefined> {
        const webview = this.getWebview();
        if (!webview) {
            return undefined;
        }

        return new Promise<ViewState | undefined>((resolve) => {
            this._pendingViewStateResolve = resolve;
            webview.postMessage({ type: 'requestViewState' });

            setTimeout(() => {
                if (this._pendingViewStateResolve === resolve) {
                    this._pendingViewStateResolve = undefined;
                    resolve(undefined);
                }
            }, 5000);
        });
    }

    public async getMapCenter(): Promise<{
        center: { latitude: number; longitude: number };
        zoom: number;
        bearing: number;
        pitch: number;
    } | undefined> {
        const webview = this.getWebview();
        if (!webview) {
            return undefined;
        }

        return new Promise<{
            center: { latitude: number; longitude: number };
            zoom: number;
            bearing: number;
            pitch: number;
        } | undefined>((resolve) => {
            this._pendingMapCenterResolve = resolve;
            webview.postMessage({ type: 'getMapCenter' });

            setTimeout(() => {
                if (this._pendingMapCenterResolve === resolve) {
                    this._pendingMapCenterResolve = undefined;
                    resolve(undefined);
                }
            }, 5000);
        });
    }

    public async handleWebviewMessage(message: unknown): Promise<void> {
        if (!hasType(message)) {
            return;
        }

        switch (message.type) {
            case 'viewStateChanged': {
                MapWebviewController.lastActiveViewType = this.getViewType();
                const viewState = parseViewStateFromMessage(message);

                if (this._pendingViewStateResolve) {
                    this._pendingViewStateResolve(viewState);
                    this._pendingViewStateResolve = undefined;
                }

                if (!viewState) {
                    break;
                }

                this._lastViewState = viewState;
                await saveViewStateToSettings(viewState, this._currentBaseMapId);
                break;
            }

            case 'contextMenu': {
                const lngLat = message.lngLat as { lng: number; lat: number } | undefined;
                if (lngLat) {
                    await vscode.commands.executeCommand('setContext', 'maplibre:clickedLngLat', lngLat);
                    await vscode.commands.executeCommand('setContext', 'maplibre:hasClickedLngLat', true);
                    MapWebviewController.lastActiveViewType = this.getViewType();
                }
                break;
            }

            case 'geocodingSearch':
                await this.handleGeocodingSearch(message.query as string);
                break;

            case 'mapReady':
                MapWebviewController.lastActiveViewType = this.getViewType();
                this._onMapReady?.();
                break;

            case 'mapCenterResponse': {
                if (this._pendingMapCenterResolve) {
                    const error = message.error as string | undefined;
                    if (error) {
                        this._pendingMapCenterResolve(undefined as any);
                    } else {
                        this._pendingMapCenterResolve({
                            center: message.center as { latitude: number; longitude: number },
                            zoom: message.zoom as number,
                            bearing: message.bearing as number,
                            pitch: message.pitch as number
                        });
                    }
                    this._pendingMapCenterResolve = undefined;
                }
                break;
            }

            case '__testResponse': {
                const requestId = message.requestId as number;
                const pending = this._pendingTestResolves.get(requestId);
                if (pending) {
                    clearTimeout(pending.timeout);
                    this._pendingTestResolves.delete(requestId);
                    const error = message.error as string | undefined;
                    if (error) {
                        pending.reject(new Error(error));
                    } else {
                        pending.resolve(message.result);
                    }
                }
                break;
            }

            case 'mouseMove': {
                const mouseLngLat = message.lngLat as { lng: number; lat: number } | undefined;
                if (mouseLngLat) {
                    await vscode.commands.executeCommand('vscodeMaplibreViewer.updateCoordinates', mouseLngLat);
                }
                break;
            }
        }
    }

    private _onMapReady?: () => void;

    public onMapReady(callback: () => void): void {
        this._onMapReady = callback;
    }

    public async saveCurrentViewState(): Promise<void> {
        if (this._lastViewState) {
            await saveViewStateToSettings(this._lastViewState, this._currentBaseMapId);
        }
    }

    private async handleGeocodingSearch(query: string): Promise<void> {
        const webview = this.getWebview();
        if (!webview) {
            return;
        }

        const config = this.getConfiguration();
        const searchResultsMap = new Map<string, SearchResultData>();

        try {
            const items = await performGeocodingSearch(
                query,
                config.geocodingApiKey,
                config.photonSearchUrl,
                searchResultsMap
            );

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
                results
            });
        } catch {
            webview.postMessage({
                type: 'geocodingSearchError',
                message: 'Search failed. Please try again.'
            });
        }
    }

    protected setupMessageListener(webview: vscode.Webview): void {
        webview.onDidReceiveMessage(
            (msg: unknown) => {
                this.handleWebviewMessage(msg);
            },
            undefined,
            []
        );
    }
}
