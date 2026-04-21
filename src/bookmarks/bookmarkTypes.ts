/**
 * Represents map coordinates with latitude and longitude
 */
export interface Coordinates {
    /** Latitude in degrees (-90 to 90) */
    latitude: number;
    /** Longitude in degrees (-180 to 180) */
    longitude: number;
}

/**
 * Represents a saved map view bookmark
 */
export interface MapBookmark {
    /** Unique identifier */
    id: string;
    
    /** User-defined name for the bookmark */
    name: string;
    
    /** Optional description */
    description?: string;
    
    /** Map center coordinates */
    center: Coordinates;
    
    /** Map zoom level (typically 0-22) */
    zoom: number;
    
    /** Map bearing/rotation in degrees (0-360) */
    bearing: number;
    
    /** Map pitch/tilt in degrees (0-60) */
    pitch: number;
    
    /** ISO timestamp when bookmark was created */
    createdAt: string;
    
    /** ISO timestamp when bookmark was last modified */
    updatedAt: string;
    
    /** Optional tags for organization */
    tags?: string[];
    
    /** Optional: Associated style URL if style-specific */
    styleUrl?: string;
}

/**
 * Collection of bookmarks with metadata for versioned storage
 */
export interface BookmarkCollection {
    /** Version for migration purposes */
    version: 1;
    
    /** Array of bookmarks */
    bookmarks: MapBookmark[];
    
    /** Last updated timestamp */
    lastUpdated: string;
}

/**
 * Represents the current map view state
 */
export interface ViewState {
    /** Map center coordinates */
    center: Coordinates;
    
    /** Map zoom level */
    zoom: number;
    
    /** Map bearing/rotation in degrees */
    bearing: number;
    
    /** Map pitch/tilt in degrees */
    pitch: number;
}

/**
 * QuickPick item for bookmark selection
 */
export interface BookmarkQuickPickItem extends vscode.QuickPickItem {
    /** The bookmark data associated with this item */
    bookmark: MapBookmark;
}

import * as vscode from 'vscode';