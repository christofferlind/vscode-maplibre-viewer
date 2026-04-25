import * as vscode from 'vscode';
import { BoundingBox, formatCoordinates } from './coordinateParser';

/**
 * Interface for search result data
 */
export interface SearchResultData {
	lat: number;
	lng: number;
	bbox?: BoundingBox;
}

/**
 * Interface for geocoding feature from MapTiler API
 */
interface MapTilerFeature {
	text?: string;
	place_name?: string;
	place_type?: string[];
	center?: [number, number];
	bbox?: [number, number, number, number];
}

/**
 * Interface for geocoding feature from Photon API
 */
interface PhotonFeature {
	properties?: {
		name?: string;
		city?: string;
		state?: string;
		osm_value?: string;
		osm_key?: string;
		extent?: [number, number, number, number]; // [west, south, east, north]
	};
	geometry?: { coordinates: [number, number] };
}

/**
 * Interface for geocoding API response
 */
interface GeocodingResponse {
	features: (MapTilerFeature & PhotonFeature)[];
}

/**
 * Parses a bounding box from API format to internal format
 * @param bbox The bounding box array [west, south, east, north]
 * @returns The parsed bounding box or undefined
 */
function parseBbox(bbox: [number, number, number, number] | undefined): SearchResultData['bbox'] | undefined {
	if (!bbox || bbox.length !== 4) {
		return undefined;
	}
	return {
		southwest: { latitude: bbox[1], longitude: bbox[0] },
		northeast: { latitude: bbox[3], longitude: bbox[2] }
	};
}

/**
 * Creates a QuickPick item from a search result
 * @param label The label for the item
 * @param description The description
 * @param detail The detail text
 * @returns The QuickPick item
 */
function createSearchResultItem(
	label: string,
	description: string,
	detail: string
): vscode.QuickPickItem {
	return { label, description, detail };
}

/**
 * Parses MapTiler geocoding results into QuickPick items
 * @param features The features from MapTiler API
 * @param searchResultsMap The map to store results
 * @returns Array of QuickPick items
 */
function parseMapTilerResults(
	features: MapTilerFeature[],
	searchResultsMap: Map<string, SearchResultData>
): vscode.QuickPickItem[] {
	const items: vscode.QuickPickItem[] = [];
	
	features.slice(0, 10).forEach(feature => {
		const label = feature.text || feature.place_name || 'Unknown';
		const description = feature.place_type ? feature.place_type[0] : 'place';
		const lat = feature.center?.[1] || 0;
		const lng = feature.center?.[0] || 0;
		
		const bbox = parseBbox(feature.bbox);
		
		const detail = bbox
			? `BBox: ${bbox.southwest.latitude.toFixed(2)} to ${bbox.northeast.latitude.toFixed(2)}, ${bbox.southwest.longitude.toFixed(2)} to ${bbox.northeast.longitude.toFixed(2)}`
			: formatCoordinates(lat, lng);
		const itemKey = `${label}-${detail}`;
		
		items.push(createSearchResultItem(label, description, detail));
		searchResultsMap.set(itemKey, { lat, lng, bbox });
	});
	
	return items;
}

/**
 * Parses Photon geocoding results into QuickPick items
 * @param features The features from Photon API
 * @param searchResultsMap The map to store results
 * @returns Array of QuickPick items
 */
function parsePhotonResults(
	features: PhotonFeature[],
	searchResultsMap: Map<string, SearchResultData>
): vscode.QuickPickItem[] {
	const items: vscode.QuickPickItem[] = [];
	
	features.slice(0, 10).forEach(feature => {
		const label = feature.properties?.name || feature.properties?.city || feature.properties?.state || 'Unknown';
		const description = feature.properties?.osm_value || feature.properties?.osm_key || 'place';
		const lat = feature.geometry?.coordinates?.[1] || 0;
		const lng = feature.geometry?.coordinates?.[0] || 0;
		
		// Photon API provides bbox in properties.extent as [west, south, east, north]
		const bbox = parseBbox(feature.properties?.extent);
		
		const detail = bbox
			? `BBox: ${bbox.southwest.latitude.toFixed(2)} to ${bbox.northeast.latitude.toFixed(2)}, ${bbox.southwest.longitude.toFixed(2)} to ${bbox.northeast.longitude.toFixed(2)}`
			: formatCoordinates(lat, lng);
		const itemKey = `${label}-${detail}`;
		
		items.push(createSearchResultItem(label, description, detail));
		searchResultsMap.set(itemKey, { lat, lng, bbox });
	});
	
	return items;
}

/**
 * Performs a geocoding search and returns QuickPick items
 * @param query The search query
 * @param geocodingApiKey Optional MapTiler API key
 * @param photonSearchUrl The Photon API URL
 * @param searchResultsMap The map to store results
 * @returns Promise resolving to array of QuickPick items
 */
export async function performGeocodingSearch(
	query: string,
	geocodingApiKey: string | undefined,
	photonSearchUrl: string,
	searchResultsMap: Map<string, SearchResultData>
): Promise<vscode.QuickPickItem[]> {
	if (query.trim().length < 2) {
		return [];
	}

	try {
		// Build API URL
		let apiUrl: string;
		if (geocodingApiKey && geocodingApiKey.length > 0) {
			apiUrl = `https://api.maptiler.com/geocoding/search.json?query=${encodeURIComponent(query)}&key=${geocodingApiKey}`;
		} else {
			apiUrl = `${photonSearchUrl}?q=${encodeURIComponent(query)}`;
		}

		// Fetch results
		const response = await fetch(apiUrl);
		if (!response.ok) {
			throw new Error(`Geocoding API error: ${response.status}`);
		}

		const data = await response.json() as GeocodingResponse;

		// Clear previous results
		searchResultsMap.clear();

		// Parse results based on API type
		if (geocodingApiKey && geocodingApiKey.length > 0) {
			return parseMapTilerResults(data.features as MapTilerFeature[], searchResultsMap);
		} else {
			return parsePhotonResults(data.features as PhotonFeature[], searchResultsMap);
		}
	} catch (error) {
		console.error('Geocoding search failed:', error);
		return [{
			label: 'Search failed. Please try again.',
			description: '',
			detail: ''
		}];
	}
}

/**
 * Extracts text from search command arguments
 * @param args The arguments passed to the command
 * @returns The extracted text
 */
export function extractSearchTextFromArgs(args: unknown): string {
	let selectedText = '';
	
	// Check if text was passed as argument (from terminal context menu)
	// Terminal context passes an object with 'selectionText' or 'selection' property
	if (args && typeof args === 'object') {
		const argsObj = args as Record<string, unknown>;
		if (typeof argsObj.selectionText === 'string') {
			selectedText = argsObj.selectionText.trim();
		} else if (typeof argsObj.selection === 'string') {
			selectedText = argsObj.selection.trim();
		} else if (argsObj.lngLat && typeof argsObj.lngLat === 'object') {
			// If it's a lngLat from the map context menu, we don't have text
			return '';
		}
	}
	
	return selectedText;
}

/**
 * Gets selected text from the active editor
 * @returns The selected text or empty string
 */
export function getSelectedTextFromEditor(): string {
	const editor = vscode.window.activeTextEditor;
	
	if (editor) {
		const selection = editor.selection;
		if (!selection.isEmpty) {
			return editor.document.getText(selection).trim();
		}
	}
	
	return '';
}