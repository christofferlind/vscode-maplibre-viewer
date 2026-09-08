import * as vscode from 'vscode';
import { BookmarkManager } from '../bookmarks/bookmarkManager';
import { MapBookmark, ViewState } from '../bookmarks/bookmarkTypes';
import { BaseMapStyle, OverlayLayer } from '../layers/layerTypes';
import { Coordinate } from '../services/coordinateParser';
import { performGeocodingSearch, SearchResultData } from '../services/geocodingSearch';
import { MapConfig, StoredViewState } from './mapWebviewTypes';
import {
    getMapConfiguration,
    saveViewStateToSettings,
    generateWebviewHtml,
    parseViewStateFromMessage,
    buildGeocodingResults
} from './mapWebviewUtils';
import { getConfig } from '../services/configService';
import { logInfo, logError, logLine, showErrorLog } from '../services/logger';

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
    private _pendingViewStateResolves: Array<(state: ViewState | undefined) => void> = [];
    private _pendingMapCenterResolves: Array<(center: {
        center: { latitude: number; longitude: number };
        zoom: number;
        bearing: number;
        pitch: number;
    } | undefined) => void> = [];
    private _messageListenerDisposable?: vscode.Disposable;
    private _messageListenerWebview?: vscode.Webview;
    private _mapReadyResolve?: () => void;
    private _mapReadyPromise?: Promise<void>;
    /**
     * Messages posted while the webview page is still loading (or was just
     * reloaded) are silently dropped by VS Code. Unsent messages are held here
     * and flushed when the webview next signals 'mapReady'.
     */
    private _pendingWebviewMessages: Array<Record<string, unknown>> = [];
    protected _currentBaseMapStyleUrl?: string;
    protected _currentBaseMapId?: string;
    protected _lastViewState?: ViewState;

    private _requestIdCounter = 0;
    private _pendingTestResolves: Map<number, {
        resolve: (value: unknown) => void;
        reject: (reason?: unknown) => void;
        timeout: ReturnType<typeof setTimeout>;
    }> = new Map();

    private _geocodingRequestId = 0;

    /**
     * Tracks which webview last triggered a context menu
     */
    public static lastActiveViewType = 'mapsView';

    /**
     * The last coordinate the user right-clicked on any map view, used by the Copy Coordinates command
     */
    public static lastClickedLngLat?: { lng: number; lat: number };

    protected logInfo(message: string): void {
        logInfo(message);
    }

    /**
     * Posts a state message to the webview, holding it for later delivery if
     * the webview reports it cannot receive messages yet (page loading or
     * reloading). Queued messages flush on the next 'mapReady' signal.
     */
    private postStateMessage(message: Record<string, unknown>): void {
        const webview = this.getWebview();
        if (!webview) {
            return;
        }

        try {
            const result = webview.postMessage(message);
            if (result && typeof (result as Thenable<boolean>).then === 'function') {
                (result as Thenable<boolean>).then((ok) => {
                    if (!ok) {
                        this._pendingWebviewMessages.push(message);
                    }
                }, () => {
                    this._pendingWebviewMessages.push(message);
                });
            }
        } catch {
            this._pendingWebviewMessages.push(message);
        }
    }

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
        return getMapConfiguration(this.getViewType());
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
        this.logInfo(`Sending configuration update to ${this.getViewType()}`);
        this.postStateMessage({
            type: 'configUpdate',
            config: { ...config, initialViewState: undefined }
        });
    }

    /**
     * Promise that resolves when the webview signals 'mapReady'.
     * A fresh promise is created each time a webview is attached
     * (attachWebview) so flyToBookmark-style callers can wait for
     * the map instead of using a blind timeout.
     */
    public get mapReadyPromise(): Promise<void> {
        if (!this._mapReadyPromise) {
            this._mapReadyPromise = new Promise<void>((resolve) => {
                this._mapReadyResolve = resolve;
            });
        }
        return this._mapReadyPromise;
    }

    public setMapLanguage(languageCode: string): void {
        const webview = this.getWebview();
        if (!webview) {
            return;
        }
        this.logInfo(`Setting map language to "${languageCode}"`);
        this.postStateMessage({
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
        this.logInfo(`Flying to location (${latitude}, ${longitude}) at zoom ${zoom ?? defaultZoom}`);
        this.postStateMessage({
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
        this.logInfo(`Fitting bounding box with ${coordinates.length} coordinate(s)`);
        this.postStateMessage({
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
        this.logInfo('Fitting to bounding box only');
        this.postStateMessage({
            type: 'fitBoundsOnly',
            boundingBox: bbox
        });
    }

    public flyToBookmark(bookmark: MapBookmark): void {
        const webview = this.getWebview();
        if (!webview) {
            return;
        }
        this.logInfo(`Flying to bookmark "${bookmark.name}"`);
        this.postStateMessage({
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
        this.logInfo(`Setting basemap to "${baseMap.name}" (${baseMap.id})`);
        this.postStateMessage({
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
        this.logInfo(`Updating ${layers.length} overlay layer(s)`);
        this.postStateMessage({
            type: 'updateOverlayLayers',
            layers
        });
    }

    public updateSelectedFileLayer(geojson: object | null): void {
        const webview = this.getWebview();
        if (!webview) {
            return;
        }
        this.logInfo(geojson ? 'Updating selected file layer with GeoJSON' : 'Clearing selected file layer');
        this.postStateMessage({
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
            this._pendingViewStateResolves.push(resolve);
            webview.postMessage({ type: 'requestViewState' });

            setTimeout(() => {
                const index = this._pendingViewStateResolves.indexOf(resolve);
                if (index !== -1) {
                    this._pendingViewStateResolves.splice(index, 1);
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
            this._pendingMapCenterResolves.push(resolve);
            webview.postMessage({ type: 'getMapCenter' });

            setTimeout(() => {
                const index = this._pendingMapCenterResolves.indexOf(resolve);
                if (index !== -1) {
                    this._pendingMapCenterResolves.splice(index, 1);
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

                const pendingResolves = this._pendingViewStateResolves;
                this._pendingViewStateResolves = [];
                pendingResolves.forEach((resolve) => {
                    resolve(viewState);
                });

                if (!viewState) {
                    break;
                }

                this._lastViewState = viewState;
                await saveViewStateToSettings(viewState, this._currentBaseMapId, this.getViewType());
                break;
            }

            case 'contextMenu': {
                const lngLat = message.lngLat as { lng: number; lat: number } | undefined;
                if (lngLat && typeof lngLat.lat === 'number' && typeof lngLat.lng === 'number') {
                    MapWebviewController.lastClickedLngLat = lngLat;
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
                this.logInfo(`Map ready in ${this.getViewType()}`);
                if (this._mapReadyResolve) {
                    this._mapReadyResolve();
                    this._mapReadyResolve = undefined;
                }
                this._onMapReady?.();

                // The page is now loaded and able to receive messages; deliver
                // any messages that were dropped while it was loading.
                // Yield one microtask first so in-flight postMessage promises
                // have settled and their rejections are recorded.
                await Promise.resolve();
                if (this._pendingWebviewMessages.length > 0) {
                    const queued = this._pendingWebviewMessages;
                    this._pendingWebviewMessages = [];
                    queued.forEach((queuedMessage) => {
                        this.postStateMessage(queuedMessage);
                    });
                    this.logInfo(`Delivered ${queued.length} queued message(s)`);
                }
                break;

            case 'log': {
                const level = message.level as string | undefined;
                const args = message.args as string | undefined;
                const prefix = level ? `[${level.toUpperCase()}]` : '[LOG]';
                logLine(prefix, args ?? '');
                break;
            }

            case 'mapError': {
                const errorMessage = typeof message.message === 'string' ? message.message : String(message.message);
                const details = message.details as string | undefined;
                const stack = message.stack as string | undefined;
                const source = message.source as string | undefined;

                logError(errorMessage);
                if (source) {
                    logLine('[INFO]', `Source: ${source}`);
                }
                if (details) {
                    logLine('[INFO]', `Details: ${details}`);
                }
                if (stack) {
                    logLine('[INFO]', `Stack: ${stack}`);
                }
                logLine('[INFO]', '---');

                this._showMapErrorThrottled(errorMessage);
                break;
            }

            case 'mapCenterResponse': {
                const error = message.error as string | undefined;
                const center = error
                    ? undefined
                    : {
                        center: message.center as { latitude: number; longitude: number },
                        zoom: message.zoom as number,
                        bearing: message.bearing as number,
                        pitch: message.pitch as number
                    };

                const pendingResolves = this._pendingMapCenterResolves;
                this._pendingMapCenterResolves = [];
                pendingResolves.forEach((resolve) => {
                    resolve(center);
                });
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
                if (mouseLngLat && typeof mouseLngLat.lat === 'number' && typeof mouseLngLat.lng === 'number') {
                    await vscode.commands.executeCommand('vscodeMaplibreViewer.updateCoordinates', mouseLngLat);
                }
                break;
            }
        }
    }

    private _onMapReady?: () => void;

    private _lastMapErrorNotificationTime = 0;

    /**
     * Webview errors can fire rapidly (e.g. one failed tile request per tile
     * while panning a raster basemap offline). Only surface the first error in
     * a 10 second window as a notification; everything is still logged.
     */
    private _showMapErrorThrottled(errorMessage: string): void {
        const now = Date.now();
        if (now - this._lastMapErrorNotificationTime < 10000) {
            return;
        }
        this._lastMapErrorNotificationTime = now;

        const showLog = 'Show Error Log';
        void vscode.window.showErrorMessage(errorMessage, showLog).then((selection) => {
            if (selection === showLog) {
                showErrorLog();
            }
        });
    }

    public onMapReady(callback: () => void): void {
        this._onMapReady = callback;
    }

    public async saveCurrentViewState(): Promise<void> {
        if (this._lastViewState) {
            await saveViewStateToSettings(this._lastViewState, this._currentBaseMapId, this.getViewType());
        }
    }

    private async handleGeocodingSearch(query: string): Promise<void> {
        const webview = this.getWebview();
        if (!webview) {
            return;
        }

        const config = this.getConfiguration();
        const searchResultsMap = new Map<string, SearchResultData>();
        const requestId = ++this._geocodingRequestId;
        this.logInfo(`Geocoding search for "${query}"`);

        try {
            const items = await performGeocodingSearch(
                query,
                config.geocodingApiKey,
                config.photonSearchUrl,
                searchResultsMap
            );

            if (requestId !== this._geocodingRequestId) {
                return;
            }

            const results = buildGeocodingResults(items, searchResultsMap);

            webview.postMessage({
                type: 'geocodingSearchResults',
                results
            });
        } catch {
            if (requestId !== this._geocodingRequestId) {
                return;
            }

            webview.postMessage({
                type: 'geocodingSearchError',
                message: 'Search failed. Please try again.'
            });
        }
    }

    protected setupMessageListener(webview: vscode.Webview): void {
        if (this._messageListenerDisposable && this._messageListenerWebview === webview) {
            return;
        }

        this._messageListenerDisposable?.dispose();
        this._messageListenerDisposable = webview.onDidReceiveMessage(
            (msg: unknown) => {
                this.handleWebviewMessage(msg).catch((error) => {
                    logError(`Error handling webview message: ${error instanceof Error ? error.message : String(error)}`);
                });
            },
            undefined,
            []
        );
        this._messageListenerWebview = webview;
    }
}
