import { ViewState } from '../bookmarks/bookmarkTypes';

// Interface for configuration messages sent to the webview
export interface MapConfig {
    geocodingApiKey: string;
    photonSearchUrl: string;
    enableSearch: boolean;
    searchResultsTransparency: number;
    flyToDuration: number;
    initialViewState?: ViewState;
}

// Interface for view state stored in settings
export interface StoredViewState {
    center: { lat: number; lng: number };
    zoom: number;
    bearing: number;
    pitch: number;
    baseMapId?: string;
}

/**
 * Represents a geocoding search result with normalized bounding box format
 */
export interface GeocodingResult {
    name: string;
    type: string;
    lat: number;
    lng: number;
    bbox?: {
        west: number;
        south: number;
        east: number;
        north: number;
    };
}

// Type-safe message types for webview communication
export type WebviewMessageType =
    | 'configUpdate'
    | 'languageChange'
    | 'flyToLocation'
    | 'fitBoundingBox'
    | 'fitBoundsOnly'
    | 'flyToBookmark'
    | 'setBaseMap'
    | 'updateOverlayLayers'
    | 'updateSelectedFileLayer'
    | 'requestViewState'
    | 'viewStateChanged'
    | 'geocodingSearch'
    | 'geocodingSearchResults';

export interface ViewStateChangedMessage {
    type: 'viewStateChanged';
    viewState: {
        center: { lat?: number; latitude?: number; lng?: number; longitude?: number };
        zoom: number;
        bearing?: number;
        pitch?: number;
    };
}

export interface GeocodingSearchMessage {
    type: 'geocodingSearch';
    query: string;
}

export interface GeocodingSearchResultsMessage {
    type: 'geocodingSearchResults';
    results: GeocodingResult[];
}