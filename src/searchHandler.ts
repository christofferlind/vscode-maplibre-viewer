/**
 * Search handler module for map search functionality
 */
import * as vscode from 'vscode';
import { ProviderManager } from './map/providerManager';
import { performGeocodingSearch, extractSearchTextFromArgs, getSelectedTextFromEditor, SearchResultData } from './services/geocodingSearch';

/**
 * Handles search on map command
 */
export async function handleSearchOnMap(
    args: unknown,
    providerManager: ProviderManager
): Promise<void> {
    // Try to get text from args first, then from editor
    let selectedText = extractSearchTextFromArgs(args);
    
    if (!selectedText) {
        selectedText = getSelectedTextFromEditor();
    }

    // Get configuration for geocoding
    const config = vscode.workspace.getConfiguration('vscodeMaplibreViewer');
    const geocodingApiKey = config.get<string>('geocodingApiKey') || '';
    const photonSearchUrl = config.get<string>('photonSearchUrl') || 'https://photon.komoot.io/api/';

    // Create a QuickPick for search
    const quickPick = vscode.window.createQuickPick();
    quickPick.placeholder = 'Search for a place on the map...';
    quickPick.value = selectedText;
    quickPick.matchOnDescription = true;
    quickPick.matchOnDetail = true;

    // Store search results with coordinates and optional bounding box
    const searchResultsMap = new Map<string, SearchResultData>();

    // Debounce timer for search
    let searchDebounceTimer: ReturnType<typeof setTimeout> | undefined;

    // Handle input changes with debounce
    quickPick.onDidChangeValue((value) => {
        if (searchDebounceTimer) {
            clearTimeout(searchDebounceTimer);
        }
        searchDebounceTimer = setTimeout(async () => {
            quickPick.busy = true;
            quickPick.items = await performGeocodingSearch(value, geocodingApiKey, photonSearchUrl, searchResultsMap);
            quickPick.busy = false;
        }, 300);
    });

    // Handle hover/active item change to preview on map
    quickPick.onDidChangeActive((activeItems) => {
        const activeItem = activeItems[0];
        if (activeItem) {
            // Find the coordinates for the active item
            const itemKey = `${activeItem.label}-${activeItem.detail}`;
            const coords = searchResultsMap.get(itemKey);
            
            if (coords) {
                if (coords.bbox) {
                    // Use bounding box to fit the map
                    providerManager.fitBoundsOnly(coords.bbox);
                } else if (coords.lat !== 0 && coords.lng !== 0) {
                    // Fall back to flying to a point
                    const config = vscode.workspace.getConfiguration('vscodeMaplibreViewer');
                    const singlePointZoom = config.get<number>('singlePointZoom') ?? 14;
                    providerManager.flyToLocation(coords.lat, coords.lng, singlePointZoom);
                }
            }
        }
    });

    // Initial search if there's selected text
    if (selectedText.length >= 2) {
        quickPick.busy = true;
        const items = await performGeocodingSearch(selectedText, geocodingApiKey, photonSearchUrl, searchResultsMap);
        quickPick.items = items;
        quickPick.busy = false;
    }

    // Handle selection
    quickPick.onDidAccept(() => {
        const selected = quickPick.selectedItems[0];
        if (selected) {
            // Find the coordinates for the selected item
            const itemKey = `${selected.label}-${selected.detail}`;
            const coords = searchResultsMap.get(itemKey);
            
            if (coords) {
                if (coords.bbox) {
                    // Use bounding box to fit the map
                    providerManager.fitBoundsOnly(coords.bbox);
                } else if (coords.lat !== 0 && coords.lng !== 0) {
                    // Fall back to flying to a point
                    const config = vscode.workspace.getConfiguration('vscodeMaplibreViewer');
                    const singlePointZoom = config.get<number>('singlePointZoom') ?? 14;
                    providerManager.flyToLocation(coords.lat, coords.lng, singlePointZoom);
                }
            }
        }
        quickPick.hide();
    });

    // Show the QuickPick
    quickPick.show();
}