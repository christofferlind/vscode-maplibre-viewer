import { ViewState } from './bookmarkTypes';

// Interface for configuration messages sent to the webview
export interface MapConfig {
    geocodingApiKey: string;
    photonSearchUrl: string;
    enableSearch: boolean;
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
    | 'viewStateChanged';

export interface ViewStateChangedMessage {
    type: 'viewStateChanged';
    viewState: {
        center: { lat?: number; latitude?: number; lng?: number; longitude?: number };
        zoom: number;
        bearing?: number;
        pitch?: number;
    };
}