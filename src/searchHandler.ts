/**
 * Search handler module for map search functionality
 */
import * as vscode from 'vscode';
import { ProviderManager } from './map/providerManager';
import { performGeocodingSearch, extractSearchTextFromArgs, getSelectedTextFromEditor, SearchResultData } from './services/geocodingSearch';
import { getConfig } from './services/configService';
import { debounce } from './services/debounce';
import { isTerminalContextArgs, resolveSelectedTextFromTerminalProbe } from './services/terminalSelection';

/**
 * Copies the active terminal's selection to the clipboard and returns it.
 *
 * The terminal context menu only forwards a serialized instance id, never the selected text,
 * so the selection must be read indirectly. The user's clipboard is restored afterwards.
 *
 * @returns The trimmed selected text, or an empty string when nothing is selected.
 */
async function getSelectedTextFromTerminal(): Promise<string> {
    if (!vscode.window.activeTerminal) {
        return '';
    }

    const before = await vscode.env.clipboard.readText();
    try {
        await vscode.commands.executeCommand('workbench.action.terminal.copySelection');
        const after = await vscode.env.clipboard.readText();
        return resolveSelectedTextFromTerminalProbe({ before, after });
    } finally {
        if ((await vscode.env.clipboard.readText()) !== before) {
            await vscode.env.clipboard.writeText(before);
        }
    }
}

/**
 * Handles search on map command
 */
export async function handleSearchOnMap(
    args: unknown,
    providerManager: ProviderManager
): Promise<void> {
    // Try to get text from args first, then from editor, then from the terminal selection
    let selectedText = extractSearchTextFromArgs(args);

    if (!selectedText && isTerminalContextArgs(args)) {
        selectedText = await getSelectedTextFromTerminal();
    }

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

    // Store search results with coordinates and optional bounding box.
    // Each request fills its own map; it becomes active only if the request is still current,
    // otherwise a stale response would clear/overwrite results shown for the latest query.
    let activeResultsMap = new Map<string, SearchResultData>();

    // Create debounced search function
    let requestToken = 0;
    const debouncedSearch = debounce(async (value: unknown) => {
        const query = value as string;
        const token = ++requestToken;
        const requestMap = new Map<string, SearchResultData>();
        quickPick.busy = true;
        try {
            const items = await performGeocodingSearch(query, geocodingApiKey, photonSearchUrl, requestMap);
            if (token === requestToken) {
                activeResultsMap = requestMap;
                quickPick.items = items;
            }
        } catch {
            if (token === requestToken) {
                quickPick.items = [];
                vscode.window.showErrorMessage('Search failed. Please try again.');
            }
        } finally {
            if (token === requestToken) {
                quickPick.busy = false;
            }
        }
    }, 300);

    // Handle input changes with debounce
    quickPick.onDidChangeValue((value) => {
        if (value.length < 2) {
            requestToken++;
            quickPick.items = [];
            debouncedSearch.cancel();
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
        
        // Find the coordinates for the active item by its index in the results
        const index = quickPick.items.indexOf(activeItem);
        const coords = activeResultsMap.get(String(index));
        
        if (!coords) {
            return;
        }
        
        if (coords.bbox) {
            // Use bounding box to fit the map
            providerManager.fitBoundsOnly(coords.bbox);
            return;
        }

        // Fall back to flying to a point
        const singlePointZoom = getConfig().get<number>('singlePointZoom') ?? 14;
        providerManager.flyToLocation(coords.lat, coords.lng, singlePointZoom);
    });

    // Show the QuickPick before any network work so the UI is responsive immediately
    quickPick.show();

    // Initial search if there's selected text
    if (selectedText.length >= 2) {
        const token = ++requestToken;
        const requestMap = new Map<string, SearchResultData>();
        quickPick.busy = true;
        try {
            const items = await performGeocodingSearch(selectedText, geocodingApiKey, photonSearchUrl, requestMap);
            if (token === requestToken) {
                activeResultsMap = requestMap;
                quickPick.items = items;
            }
        } catch {
            if (token === requestToken) {
                quickPick.items = [];
                vscode.window.showErrorMessage('Search failed. Please try again.');
            }
        } finally {
            if (token === requestToken) {
                quickPick.busy = false;
            }
        }
    }

    // Handle hiding: cancel pending debounce and dispose to avoid leaks
    quickPick.onDidHide(() => {
        debouncedSearch.cancel();
        quickPick.dispose();
    });

    // Handle selection
    quickPick.onDidAccept(() => {
        const selected = quickPick.selectedItems[0];
        if (!selected) {
            quickPick.hide();
            return;
        }
        
        // Find the coordinates for the selected item by its index in the results
        const index = quickPick.items.indexOf(selected);
        const coords = activeResultsMap.get(String(index));
        
        if (!coords) {
            quickPick.hide();
            return;
        }
        
        if (coords.bbox) {
            // Use bounding box to fit the map
            providerManager.fitBoundsOnly(coords.bbox);
        } else {
            // Fall back to flying to a point
            const singlePointZoom = getConfig().get<number>('singlePointZoom') ?? 14;
            providerManager.flyToLocation(coords.lat, coords.lng, singlePointZoom);
        }
        quickPick.hide();
    });
}