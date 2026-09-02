import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ViewState } from '../bookmarks/bookmarkTypes';
import { MapConfig, StoredViewState } from './mapWebviewTypes';

/**
 * Generates a random nonce for Content Security Policy
 * Uses cryptographically secure random values.
 */
export function getNonce(): string {
    const crypto = require('crypto');
    return crypto.randomBytes(16).toString('base64');
}

/**
 * Gets the current configuration from VS Code settings
 */
export function getMapConfiguration(): MapConfig {
    const config = vscode.workspace.getConfiguration('vscodeMaplibreViewer');
    const lastViewState = config.get<StoredViewState>('lastViewState');

    return {
        geocodingApiKey: config.get<string>('geocodingApiKey') || '',
        photonSearchUrl: config.get<string>('photonSearchUrl') || 'https://photon.komoot.io/api/',
        enableSearch: config.get<boolean>('enableSearch') ?? true,
        searchResultsTransparency: config.get<number>('searchResultsTransparency') ?? 20,
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
export async function saveViewStateToSettings(viewState: ViewState, currentBaseMapId?: string): Promise<void> {
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

    try {
        await config.update('lastViewState', stateToStore, vscode.ConfigurationTarget.Global);
    } catch (error) {
        console.error('Failed to save view state:', error);
    }
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
    mapCoreJsUri: vscode.Uri;
    mapBasemapJsUri: vscode.Uri;
    mapPopupJsUri: vscode.Uri;
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
    mapStyleUrl: (ctx) => ctx.styleUrl,
    geocodingApiKey: (ctx) => ctx.config.geocodingApiKey,
    photonSearchUrl: (ctx) => ctx.config.photonSearchUrl,
    enableSearch: (ctx) => String(ctx.config.enableSearch),
    searchResultsTransparency: (ctx) => String(ctx.config.searchResultsTransparency),
    flyToDuration: (ctx) => String(ctx.config.flyToDuration),
    maplibreJsUri: (ctx) => ctx.maplibreJsUri.toString(),
    maplibreCssUri: (ctx) => ctx.maplibreCssUri.toString(),
    maplibreWorkerBase64: (ctx) => ctx.workerBase64,
    mapUtilsJsUri: (ctx) => ctx.mapUtilsJsUri.toString(),
    mapCoreJsUri: (ctx) => ctx.mapCoreJsUri.toString(),
    mapBasemapJsUri: (ctx) => ctx.mapBasemapJsUri.toString(),
    mapPopupJsUri: (ctx) => ctx.mapPopupJsUri.toString(),
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
export function generateWebviewHtml(
    extensionUri: vscode.Uri,
    webview: vscode.Webview,
    config: MapConfig,
    currentBaseMapStyleUrl?: string,
    viewType?: string
): string {
    const nonce = getNonce();
    const styleUrl = currentBaseMapStyleUrl || 'https://demotiles.maplibre.org/style.json';

    const maplibreJsUri = getWebviewUri(extensionUri, webview, 'resources', 'maplibre-gl', 'maplibre-gl.js');
    const maplibreCssUri = getWebviewUri(extensionUri, webview, 'resources', 'maplibre-gl', 'maplibre-gl.css');
    const mapUtilsJsUri = getWebviewUri(extensionUri, webview, 'resources', 'scripts', 'map-utils.js');
    const mapCoreJsUri = getWebviewUri(extensionUri, webview, 'resources', 'scripts', 'map-core.js');
    const mapBasemapJsUri = getWebviewUri(extensionUri, webview, 'resources', 'scripts', 'map-basemap.js');
    const mapPopupJsUri = getWebviewUri(extensionUri, webview, 'resources', 'scripts', 'map-popup.js');
    const mapOverlaysJsUri = getWebviewUri(extensionUri, webview, 'resources', 'scripts', 'map-overlays.js');
    const mapNavigationJsUri = getWebviewUri(extensionUri, webview, 'resources', 'scripts', 'map-navigation.js');
    const mapSearchJsUri = getWebviewUri(extensionUri, webview, 'resources', 'scripts', 'map-search.js');
    const mainJsUri = getWebviewUri(extensionUri, webview, 'resources', 'scripts', 'main.js');
    const testApiJsUri = getWebviewUri(extensionUri, webview, 'resources', 'scripts', 'test-api.js');
    const mainCssUri = getWebviewUri(extensionUri, webview, 'resources', 'styles', 'main.css');

    const workerPath = path.join(extensionUri.fsPath, 'resources', 'maplibre-gl', 'maplibre-gl-worker.js');
    const workerContent = fs.readFileSync(workerPath, 'utf8');
    const workerBase64 = Buffer.from(workerContent).toString('base64');

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
        mapCoreJsUri,
        mapBasemapJsUri,
        mapPopupJsUri,
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
        ? JSON.stringify(config.initialViewState)
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

    if (viewState && viewState.center) {
        const center = viewState.center as Record<string, number>;
        return {
            center: {
                latitude: center.lat ?? center.latitude,
                longitude: center.lng ?? center.longitude
            },
            zoom: viewState.zoom as number,
            bearing: (viewState.bearing as number) || 0,
            pitch: (viewState.pitch as number) || 0
        };
    }
    return undefined;
}
