/**
 * Search handler module for map search functionality
 */
import * as vscode from 'vscode';
import { ProviderManager } from './map/providerManager';
import { performGeocodingSearch, extractSearchTextFromArgs, getSelectedTextFromEditor, SearchResultData } from './services/geocodingSearch';
import { getConfig } from './services/configService';
import { debounce } from './services/debounce';

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

    // Get configuration for geocoding using configService
    const config = getConfig();
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

    // Create debounced search function
    const debouncedSearch = debounce(async (value: string) => {
        quickPick.busy = true;
        quickPick.items = await performGeocodingSearch(value, geocodingApiKey, photonSearchUrl, searchResultsMap);
        quickPick.busy = false;
    }, 300);

    // Handle input changes with debounce
    quickPick.onDidChangeValue((value) => {
        if (value.length < 2) {
            quickPick.items = [];
            return;
        }
        debouncedSearch(value);
    });

    // Handle hover/active item change to preview on map
    quickPick.onDidChangeActive((activeItems) => {
        const activeItem = activeItems[0];
        if (!activeItem) {
            return;
        }
        
        // Find the coordinates for the active item
        const itemKey = `${activeItem.label}-${activeItem.detail}`;
        const coords = searchResultsMap.get(itemKey);
        
        if (!coords) {
            return;
        }
        
        if (coords.bbox) {
            // Use bounding box to fit the map
            providerManager.fitBoundsOnly(coords.bbox);
            return;
        }
        
        if (coords.lat !== 0 && coords.lng !== 0) {
            // Fall back to flying to a point
            const singlePointZoom = getConfig().get<number>('singlePointZoom') ?? 14;
            providerManager.flyToLocation(coords.lat, coords.lng, singlePointZoom);
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
        if (!selected) {
            quickPick.hide();
            return;
        }
        
        // Find the coordinates for the selected item
        const itemKey = `${selected.label}-${selected.detail}`;
        const coords = searchResultsMap.get(itemKey);
        
        if (!coords) {
            quickPick.hide();
            return;
        }
        
        if (coords.bbox) {
            // Use bounding box to fit the map
            providerManager.fitBoundsOnly(coords.bbox);
        } else if (coords.lat !== 0 && coords.lng !== 0) {
            // Fall back to flying to a point
            const singlePointZoom = getConfig().get<number>('singlePointZoom') ?? 14;
            providerManager.flyToLocation(coords.lat, coords.lng, singlePointZoom);
        }
        quickPick.hide();
    });

    // Show the QuickPick
    quickPick.show();
}