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

// Per-view-type record of last saved view states (sidebar and editor each
// persist independently so they cannot clobber each other)
export interface StoredPerViewState {
    mapsView?: StoredViewState;
    mapEditor?: StoredViewState;
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
    | 'bookmarksUpdated'
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

/**
 * A single rendered feature the user clicked on the map, as reported by the
 * webview. `source` distinguishes basemap features from overlay features
 * (overlay sources are prefixed with 'overlay-').
 */
export interface ClickedFeatureInfo {
    source: string;
    sourceLayer?: string;
    layerId: string;
    layerName?: string;
    geometryType: string;
    /** Flattened feature properties (dotted keys for nested objects) */
    properties: Record<string, unknown>;
}

/**
 * Payload of a featureInfoUpdate message posted by the webview on a map click.
 */
export interface FeatureInfoUpdateMessage {
    type: 'featureInfoUpdate';
    lngLat: { lng: number; lat: number };
    features: ClickedFeatureInfo[];
}

export interface GeocodingSearchResultsMessage {
    type: 'geocodingSearchResults';
    results: GeocodingResult[];
}