import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ViewState } from '../bookmarks/bookmarkTypes';
import { MapConfig, StoredViewState, GeocodingResult, ClickedFeatureInfo, FeatureInfoUpdateMessage } from './mapWebviewTypes';
import { notifyViewStateWriteStarted } from '../services/configService';

/**
 * Generates a random nonce for Content Security Policy
 * Uses cryptographically secure random values.
 */
export function getNonce(): string {
    const crypto = require('crypto');
    return crypto.randomBytes(16).toString('base64');
}

/**
 * View types that persist their own last view state key
 */
const VIEW_STATE_KEYS = ['mapsView', 'mapEditor'] as const;

type ViewStateKey = (typeof VIEW_STATE_KEYS)[number];

export interface StoredPerViewState {
    mapsView?: StoredViewState;
    mapEditor?: StoredViewState;
}

/**
 * Normalizes a view type to a persisted key
 */
function viewStateKey(viewType?: string): ViewStateKey {
    return viewType === 'mapEditor' ? 'mapEditor' : 'mapsView';
}

/**
 * Gets the current configuration from VS Code settings
 */
export function getMapConfiguration(viewType?: string): MapConfig {
    const config = vscode.workspace.getConfiguration('vscodeMaplibreViewer');
    const stored = config.get<StoredPerViewState | StoredViewState>('lastViewState');

    let lastViewState: StoredViewState | undefined;
    if (stored) {
        if ('mapsView' in stored || 'mapEditor' in stored) {
            const perView = stored as StoredPerViewState;
            lastViewState = perView[viewStateKey(viewType)];
        } else {
            // Legacy single-object storage: use it for both view types
            lastViewState = stored as StoredViewState;
        }
    }

    return {
        geocodingApiKey: config.get<string>('geocodingApiKey') || '',
        photonSearchUrl: config.get<string>('photonSearchUrl') || 'https://photon.komoot.io/api/',
        enableSearch: config.get<boolean>('enableSearch') ?? true,
        searchResultsTransparency: config.get<number>('searchResultsTransparency') ?? 20,
        flyToDuration: config.get<number>('flyToDuration') ?? 500,
        terrain: config.get<boolean>('terrain') ?? false,
        terrainUrl: config.get<string>('terrainUrl') || 'https://tiles.mapterhorn.com/tilejson.json',
        globe: config.get<boolean>('globe') ?? false,
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
 * Saves the current view state to VS Code settings, keyed by view type so the
 * sidebar and editor panels do not clobber each other's state.
 */
export async function saveViewStateToSettings(
    viewState: ViewState,
    currentBaseMapId?: string,
    viewType?: string
): Promise<void> {
    const config = vscode.workspace.getConfiguration('vscodeMaplibreViewer');
    const stateToStore: StoredViewState = {
        center: {
            lat: viewState.center.latitude,
            lng: viewState.center.longitude
        },
        zoom: viewState.zoom,
        bearing: viewState.bearing || 0,
        pitch: viewState.pitch || 0,
        baseMapId: currentBaseMapId
    };

    const stored = config.get<StoredPerViewState>('lastViewState');
    const perView: StoredPerViewState = (stored && ('mapsView' in stored || 'mapEditor' in stored))
        ? { ...(stored as StoredPerViewState) }
        : {};

    perView[viewStateKey(viewType)] = stateToStore;

    try {
        notifyViewStateWriteStarted();
        await config.update('lastViewState', perView, vscode.ConfigurationTarget.Global);
    } catch (error) {
        console.error('Failed to save view state:', error);
    }
}

/**
 * Saves the globe projection preference to VS Code settings so the choice
 * survives across sessions and views.
 */
export async function saveGlobeSetting(enabled: boolean): Promise<void> {
    const config = vscode.workspace.getConfiguration('vscodeMaplibreViewer');
    await config.update('globe', enabled, vscode.ConfigurationTarget.Global);
}

/**
 * Gets the webview URI for a local resource file
 */
export function getWebviewUri(extensionUri: vscode.Uri, webview: vscode.Webview, ...pathSegments: string[]): vscode.Uri {
    const fileUri = vscode.Uri.joinPath(extensionUri, ...pathSegments);
    return webview.asWebviewUri(fileUri);
}

interface TemplateContext {
    webview: vscode.Webview;
    config: MapConfig;
    styleUrl: string;
    nonce: string;
    viewType: string;
    maplibreJsUri: vscode.Uri;
    maplibreCssUri: vscode.Uri;
    workerBase64: string;
    mapUtilsJsUri: vscode.Uri;
    mapTerrainJsUri: vscode.Uri;
    mapGlobeJsUri: vscode.Uri;
    mapCoreJsUri: vscode.Uri;
    mapBasemapJsUri: vscode.Uri;
    mapPopupJsUri: vscode.Uri;
    mapInfoJsUri: vscode.Uri;
    mapOverlaysJsUri: vscode.Uri;
    mapNavigationJsUri: vscode.Uri;
    mapSearchJsUri: vscode.Uri;
    mainJsUri: vscode.Uri;
    testApiJsUri: vscode.Uri;
    mainCssUri: vscode.Uri;
}

type PlaceholderResolver = (ctx: TemplateContext) => string;

/**
 * Template placeholder replacement map.
 * Each resolver receives the shared context object.
 */
const HTML_PLACEHOLDERS: Record<string, PlaceholderResolver> = {
    cspSource: (ctx) => ctx.webview.cspSource,
    nonce: (ctx) => ctx.nonce,
    mapStyleUrl: (ctx) => JSON.stringify(ctx.styleUrl),
    geocodingApiKey: (ctx) => JSON.stringify(ctx.config.geocodingApiKey),
    photonSearchUrl: (ctx) => JSON.stringify(ctx.config.photonSearchUrl),
    enableSearch: (ctx) => String(ctx.config.enableSearch),
    searchResultsTransparency: (ctx) => String(ctx.config.searchResultsTransparency),
    flyToDuration: (ctx) => String(ctx.config.flyToDuration),
    terrain: (ctx) => String(ctx.config.terrain),
    terrainUrl: (ctx) => JSON.stringify(ctx.config.terrainUrl),
    globe: (ctx) => String(ctx.config.globe),
    maplibreJsUri: (ctx) => ctx.maplibreJsUri.toString(),
    maplibreCssUri: (ctx) => ctx.maplibreCssUri.toString(),
    maplibreWorkerBase64: (ctx) => ctx.workerBase64,
    mapUtilsJsUri: (ctx) => ctx.mapUtilsJsUri.toString(),
    mapTerrainJsUri: (ctx) => ctx.mapTerrainJsUri.toString(),
    mapGlobeJsUri: (ctx) => ctx.mapGlobeJsUri.toString(),
    mapCoreJsUri: (ctx) => ctx.mapCoreJsUri.toString(),
    mapBasemapJsUri: (ctx) => ctx.mapBasemapJsUri.toString(),
    mapPopupJsUri: (ctx) => ctx.mapPopupJsUri.toString(),
    mapInfoJsUri: (ctx) => ctx.mapInfoJsUri.toString(),
    mapOverlaysJsUri: (ctx) => ctx.mapOverlaysJsUri.toString(),
    mapNavigationJsUri: (ctx) => ctx.mapNavigationJsUri.toString(),
    mapSearchJsUri: (ctx) => ctx.mapSearchJsUri.toString(),
    mainJsUri: (ctx) => ctx.mainJsUri.toString(),
    testApiJsUri: (ctx) => ctx.testApiJsUri.toString(),
    mainCssUri: (ctx) => ctx.mainCssUri.toString(),
    viewType: (ctx) => ctx.viewType,
};

/**
 * Single-pass template replacement engine for webview HTML.
 * Prevents O(n*m) complexity from sequential .replace() calls.
 */
function renderTemplate(html: string, context: TemplateContext): string {
    const pattern = /\$\{(\w+)\}/g;
    return html.replace(pattern, (match, key) => {
        const resolver = HTML_PLACEHOLDERS[key];
        if (resolver) {
            return resolver(context);
        }
        return match;
    });
}

/**
 * Generates HTML for the webview from template
 */
let cachedWorkerBase64: string | undefined;
let cachedWorkerBase64Uri: string | undefined;

function getWorkerBase64(extensionUri: vscode.Uri): string {
    if (cachedWorkerBase64Uri === extensionUri.toString() && cachedWorkerBase64 !== undefined) {
        return cachedWorkerBase64;
    }
    const workerPath = path.join(extensionUri.fsPath, 'resources', 'maplibre-gl', 'maplibre-gl-worker.js');
    const workerContent = fs.readFileSync(workerPath, 'utf8');
    cachedWorkerBase64 = Buffer.from(workerContent).toString('base64');
    cachedWorkerBase64Uri = extensionUri.toString();
    return cachedWorkerBase64;
}
export function generateWebviewHtml(
    extensionUri: vscode.Uri,
    webview: vscode.Webview,
    config: MapConfig,
    currentBaseMapStyleUrl?: string,
    viewType?: string
): string {
    const nonce = getNonce();
    const styleUrl = currentBaseMapStyleUrl
        || getWebviewUri(extensionUri, webview, 'resources', 'styles', 'default-style.json').toString();

    const maplibreJsUri = getWebviewUri(extensionUri, webview, 'resources', 'maplibre-gl', 'maplibre-gl.js');
    const maplibreCssUri = getWebviewUri(extensionUri, webview, 'resources', 'maplibre-gl', 'maplibre-gl.css');
    const mapUtilsJsUri = getWebviewUri(extensionUri, webview, 'resources', 'scripts', 'map-utils.js');
    const mapTerrainJsUri = getWebviewUri(extensionUri, webview, 'resources', 'scripts', 'map-terrain.js');
    const mapGlobeJsUri = getWebviewUri(extensionUri, webview, 'resources', 'scripts', 'map-globe.js');
    const mapCoreJsUri = getWebviewUri(extensionUri, webview, 'resources', 'scripts', 'map-core.js');
    const mapBasemapJsUri = getWebviewUri(extensionUri, webview, 'resources', 'scripts', 'map-basemap.js');
    const mapPopupJsUri = getWebviewUri(extensionUri, webview, 'resources', 'scripts', 'map-popup.js');
    const mapInfoJsUri = getWebviewUri(extensionUri, webview, 'resources', 'scripts', 'map-info.js');
    const mapOverlaysJsUri = getWebviewUri(extensionUri, webview, 'resources', 'scripts', 'map-overlays.js');
    const mapNavigationJsUri = getWebviewUri(extensionUri, webview, 'resources', 'scripts', 'map-navigation.js');
    const mapSearchJsUri = getWebviewUri(extensionUri, webview, 'resources', 'scripts', 'map-search.js');
    const mainJsUri = getWebviewUri(extensionUri, webview, 'resources', 'scripts', 'main.js');
    const testApiJsUri = getWebviewUri(extensionUri, webview, 'resources', 'scripts', 'test-api.js');
    const mainCssUri = getWebviewUri(extensionUri, webview, 'resources', 'styles', 'main.css');

    const workerPath = path.join(extensionUri.fsPath, 'resources', 'maplibre-gl', 'maplibre-gl-worker.js');
    const workerBase64 = getWorkerBase64(extensionUri);

    const htmlPath = path.join(extensionUri.fsPath, 'resources', 'map-view.html');
    let htmlContent = fs.readFileSync(htmlPath, 'utf8');

    const context: TemplateContext = {
        webview,
        config,
        styleUrl,
        nonce,
        viewType: viewType || 'mapsView',
        maplibreJsUri,
        maplibreCssUri,
        workerBase64,
        mapUtilsJsUri,
        mapTerrainJsUri,
        mapGlobeJsUri,
        mapCoreJsUri,
        mapBasemapJsUri,
        mapPopupJsUri,
        mapInfoJsUri,
        mapOverlaysJsUri,
        mapNavigationJsUri,
        mapSearchJsUri,
        mainJsUri,
        testApiJsUri,
        mainCssUri,
    };

    htmlContent = renderTemplate(htmlContent, context);

    // Handle the special initialViewState replacement (not a simple placeholder)
    const initialViewStateJson = config.initialViewState
        ? JSON.stringify(config.initialViewState).replace(/</g, '\\u003c')
        : 'null';
    htmlContent = htmlContent.replace(
        /initialViewState: null/g,
        `initialViewState: ${initialViewStateJson}`
    );

    return htmlContent;
}

/**
 * Parses view state from webview message
 */
export function parseViewStateFromMessage(message: unknown): ViewState | undefined {
    const msg = message as Record<string, unknown>;
    const viewState = msg.viewState as Record<string, unknown> | undefined;

    if (viewState && typeof viewState === 'object' && viewState.center) {
        const center = viewState.center as Record<string, unknown>;
        const latitude = center.lat ?? center.latitude;
        const longitude = center.lng ?? center.longitude;
        const zoom = viewState.zoom;

        if (typeof latitude !== 'number' || typeof longitude !== 'number' || typeof zoom !== 'number') {
            return undefined;
        }

        return {
            center: {
                latitude,
                longitude
            },
            zoom,
            bearing: typeof viewState.bearing === 'number' ? viewState.bearing : 0,
            pitch: typeof viewState.pitch === 'number' ? viewState.pitch : 0
        };
    }
    return undefined;
}

/**
 * Parses a featureInfoUpdate message from the webview into a typed structure.
 * Returns undefined when the message is malformed (missing lngLat, features
 * not an array, or entries missing required string fields).
 */
export function parseFeatureInfoUpdate(message: unknown): FeatureInfoUpdateMessage | undefined {
    const msg = message as Record<string, unknown>;
    if (!msg || msg.type !== 'featureInfoUpdate') {
        return undefined;
    }

    const lngLat = msg.lngLat as Record<string, unknown> | undefined;
    if (!lngLat || typeof lngLat.lng !== 'number' || typeof lngLat.lat !== 'number') {
        return undefined;
    }

    if (!Array.isArray(msg.features)) {
        return undefined;
    }

    const features: ClickedFeatureInfo[] = [];
    for (const raw of msg.features) {
        const entry = raw as Record<string, unknown>;
        if (!entry || typeof entry.source !== 'string' || typeof entry.layerId !== 'string'
            || typeof entry.geometryType !== 'string') {
            continue;
        }

        const properties: Record<string, unknown> = {};
        if (entry.properties && typeof entry.properties === 'object') {
            for (const [key, value] of Object.entries(entry.properties as Record<string, unknown>)) {
                properties[key] = value;
            }
        }

        features.push({
            source: entry.source,
            sourceLayer: typeof entry.sourceLayer === 'string' ? entry.sourceLayer : undefined,
            layerId: entry.layerId,
            layerName: typeof entry.layerName === 'string' ? entry.layerName : undefined,
            geometryType: entry.geometryType,
            properties
        });
    }

    return {
        type: 'featureInfoUpdate',
        lngLat: { lng: lngLat.lng, lat: lngLat.lat },
        features
    };
}

/**
 * Determines whether a clicked feature belongs to an overlay layer (source
 * prefixed with 'overlay-') or the basemap.
 */
export function isOverlayFeature(feature: ClickedFeatureInfo): boolean {
    return feature.source.startsWith('overlay-');
}

/**
 * Converts a clicked feature into a user-facing label: overlay features use
 * their layer name (falling back to the source name without the 'overlay-'
 * prefix), basemap features use the layer/source identity.
 */
export function formatClickedFeatureLabel(feature: ClickedFeatureInfo): string {
    if (isOverlayFeature(feature)) {
        return feature.layerName || feature.source.replace(/^overlay-/, '');
    }
    const layerLabel = feature.layerName || feature.layerId;
    return `${layerLabel} (${feature.source})`;
}

/**
 * Formats a geometry type keyword ('Point', 'LineString', 'Polygon', ...) as a
 * human-readable kind label used by the Map Information tree.
 */
export function formatGeometryType(geometryType: string): string {
    switch (geometryType) {
        case 'Point':
            return 'Point';
        case 'MultiPoint':
            return 'Multi-Point';
        case 'LineString':
            return 'Line';
        case 'MultiLineString':
            return 'Multi-Line';
        case 'Polygon':
            return 'Polygon';
        case 'MultiPolygon':
            return 'Multi-Polygon';
        default:
            return geometryType;
    }
}

/**
 * Converts geocoding QuickPick items plus their indexed coordinate data into
 * the result shape sent to the webview. Items without matching coordinate
 * data are skipped.
 */
export function buildGeocodingResults(
    items: { label: string; description?: string }[],
    searchResultsMap: Map<string, { lat: number; lng: number; bbox?: { southwest: { latitude: number; longitude: number }; northeast: { latitude: number; longitude: number } } }>
): GeocodingResult[] {
    const results: GeocodingResult[] = [];
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const data = searchResultsMap.get(String(i));
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
    return results;
}
