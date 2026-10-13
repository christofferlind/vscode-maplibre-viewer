import * as vscode from 'vscode';
import { performGeocodingSearch, SearchResultData } from '../services/geocodingSearch';
import { MapConfig } from './mapWebviewTypes';
import { buildGeocodingResults } from './mapWebviewUtils';

/**
 * Dependencies injected by the controller so the search flow stays decoupled
 * from webview/controller internals.
 */
export interface GeocodingSearchDeps {
    logInfo: (message: string) => void;
    /** Returns true while the given request id is the latest one issued. */
    isCurrentRequest: (requestId: number) => boolean;
}

/**
 * Performs one geocoding search and posts the results (or a user-facing error)
 * to the webview. Stale requests (superseded while the network call was in
 * flight) are dropped without posting anything.
 */
export async function runGeocodingSearch(
    webview: vscode.Webview,
    config: MapConfig,
    query: string,
    requestId: number,
    deps: GeocodingSearchDeps
): Promise<void> {
    const searchResultsMap = new Map<string, SearchResultData>();
    deps.logInfo(`Geocoding search for "${query}"`);

    try {
        const items = await performGeocodingSearch(
            query,
            config.geocodingApiKey,
            config.photonSearchUrl,
            searchResultsMap
        );

        if (!deps.isCurrentRequest(requestId)) {
            return;
        }

        const results = buildGeocodingResults(items, searchResultsMap);

        await webview.postMessage({
            type: 'geocodingSearchResults',
            results
        });
    } catch {
        if (!deps.isCurrentRequest(requestId)) {
            return;
        }

        await webview.postMessage({
            type: 'geocodingSearchError',
            message: 'Search failed. Please try again.'
        });
    }
}