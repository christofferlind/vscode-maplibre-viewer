import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ViewState } from '../bookmarks/bookmarkTypes';
import { MapConfig, StoredViewState } from './mapWebviewTypes';

/**
 * Generates a random nonce for Content Security Policy
 */
export function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
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

    // Get webview URIs for local MapLibre assets
    const maplibreJsUri = getWebviewUri(extensionUri, webview, 'resources', 'maplibre-gl', 'maplibre-gl.js');
    const maplibreCssUri = getWebviewUri(extensionUri, webview, 'resources', 'maplibre-gl', 'maplibre-gl.css');

    // Get webview URIs for modular JS files
    const mapUtilsJsUri = getWebviewUri(extensionUri, webview, 'resources', 'scripts', 'map-utils.js');
    const mapCoreJsUri = getWebviewUri(extensionUri, webview, 'resources', 'scripts', 'map-core.js');
    const mapOverlaysJsUri = getWebviewUri(extensionUri, webview, 'resources', 'scripts', 'map-overlays.js');
    const mapNavigationJsUri = getWebviewUri(extensionUri, webview, 'resources', 'scripts', 'map-navigation.js');
    const mapSearchJsUri = getWebviewUri(extensionUri, webview, 'resources', 'scripts', 'map-search.js');
    const mainJsUri = getWebviewUri(extensionUri, webview, 'resources', 'scripts', 'main.js');
    const testApiJsUri = getWebviewUri(extensionUri, webview, 'resources', 'scripts', 'test-api.js');

    // Get webview URI for CSS file
    const mainCssUri = getWebviewUri(extensionUri, webview, 'resources', 'styles', 'main.css');

    // Read the worker script and encode it as base64 for inline Blob URL
    const workerPath = path.join(extensionUri.fsPath, 'resources', 'maplibre-gl', 'maplibre-gl-worker.js');
    const workerContent = fs.readFileSync(workerPath, 'utf8');
    const workerBase64 = Buffer.from(workerContent).toString('base64');

    // Read the HTML template from the resources folder
    const htmlPath = path.join(extensionUri.fsPath, 'resources', 'map-view.html');
    let htmlContent = fs.readFileSync(htmlPath, 'utf8');

    // Replace the placeholders with actual values
    htmlContent = htmlContent.replace(/\$\{cspSource\}/g, webview.cspSource);
    htmlContent = htmlContent.replace(/\$\{nonce\}/g, nonce);
    htmlContent = htmlContent.replace(/\$\{mapStyleUrl\}/g, styleUrl);
    htmlContent = htmlContent.replace(/\$\{geocodingApiKey\}/g, config.geocodingApiKey);
    htmlContent = htmlContent.replace(/\$\{photonSearchUrl\}/g, config.photonSearchUrl);
    htmlContent = htmlContent.replace(/\$\{enableSearch\}/g, String(config.enableSearch));
    htmlContent = htmlContent.replace(/\$\{searchResultsTransparency\}/g, String(config.searchResultsTransparency));
    htmlContent = htmlContent.replace(/\$\{flyToDuration\}/g, String(config.flyToDuration));
    
    // Replace initial view state placeholder
    const initialViewStateJson = config.initialViewState
        ? JSON.stringify(config.initialViewState)
        : 'null';
    htmlContent = htmlContent.replace(
        /initialViewState: null/g,
        `initialViewState: ${initialViewStateJson}`
    );
    
    // Replace MapLibre asset URIs
    htmlContent = htmlContent.replace(/\$\{maplibreJsUri\}/g, maplibreJsUri.toString());
    htmlContent = htmlContent.replace(/\$\{maplibreCssUri\}/g, maplibreCssUri.toString());
    htmlContent = htmlContent.replace(/\$\{maplibreWorkerBase64\}/g, workerBase64);

    // Replace modular JS file URIs
    htmlContent = htmlContent.replace(/\$\{mapUtilsJsUri\}/g, mapUtilsJsUri.toString());
    htmlContent = htmlContent.replace(/\$\{mapCoreJsUri\}/g, mapCoreJsUri.toString());
    htmlContent = htmlContent.replace(/\$\{mapOverlaysJsUri\}/g, mapOverlaysJsUri.toString());
    htmlContent = htmlContent.replace(/\$\{mapNavigationJsUri\}/g, mapNavigationJsUri.toString());
    htmlContent = htmlContent.replace(/\$\{mapSearchJsUri\}/g, mapSearchJsUri.toString());
    htmlContent = htmlContent.replace(/\$\{mainJsUri\}/g, mainJsUri.toString());
    htmlContent = htmlContent.replace(/\$\{testApiJsUri\}/g, testApiJsUri.toString());

    // Replace CSS URI
    htmlContent = htmlContent.replace(/\$\{mainCssUri\}/g, mainCssUri.toString());

    // Replace view type identifier
    htmlContent = htmlContent.replace(/\$\{viewType\}/g, viewType || 'mapsView');

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
                latitude: center.lat || center.latitude,
                longitude: center.lng || center.longitude
            },
            zoom: viewState.zoom as number,
            bearing: (viewState.bearing as number) || 0,
            pitch: (viewState.pitch as number) || 0
        };
    }
    return undefined;
}