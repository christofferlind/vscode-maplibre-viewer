/**
 * Represents a base map style option
 * Can be either a vector style (styleUrl) or raster tiles (tileUrl)
 */
export interface BaseMapStyle {
    id: string;
    name: string;
    description?: string;
    /** URL to MapLibre style JSON (for vector styles) */
    styleUrl?: string;
    /** Type of basemap: 'vector' for style JSON, 'raster' for raster tiles */
    type?: 'vector' | 'raster';
    /** Raster tile URL template (e.g., 'https://tile.example.com/{z}/{x}/{y}.png') */
    tileUrl?: string;
    /** Tile size for raster sources (default: 256) */
    tileSize?: number;
    /** Attribution text for the tiles */
    attribution?: string;
    /** Minimum zoom level for raster tiles */
    minzoom?: number;
    /** Maximum zoom level for raster tiles */
    maxzoom?: number;
    thumbnail?: string;
}

/**
 * Represents an overlay layer that can be toggled on/off
 */
export interface OverlayLayer {
    id: string;
    name: string;
    description?: string;
    type: 'geojson' | 'vector' | 'raster';
    source: LayerSource;
    visible: boolean;
    opacity?: number;
    minzoom?: number;
    maxzoom?: number;
}

/**
 * Source configuration for a layer
 */
export interface LayerSource {
    type: 'geojson' | 'vector' | 'raster';
    data?: string | object; // URL or GeoJSON object for GeoJSON sources
    url?: string; // Tile URL for vector/raster sources
    tileSize?: number; // For raster sources
    attribution?: string;
}

/**
 * Tree item types for the layer tree view
 */
export type LayerTreeItem = BaseMapStyle | OverlayLayer | 'baseMapsRoot' | 'layersRoot';

/**
 * Type guard to check if an item is a base map root
 */
export function isBaseMapsRoot(item: LayerTreeItem): item is 'baseMapsRoot' {
    return item === 'baseMapsRoot';
}

/**
 * Type guard to check if an item is a layers root
 */
export function isLayersRoot(item: LayerTreeItem): item is 'layersRoot' {
    return item === 'layersRoot';
}

/**
 * Type guard to check if an item is a base map style
 */
export function isBaseMapStyle(item: LayerTreeItem): item is BaseMapStyle {
    return typeof item === 'object' && item !== null && ('styleUrl' in item || 'tileUrl' in item);
}

/**
 * Type guard to check if an item is an overlay layer
 */
export function isOverlayLayer(item: LayerTreeItem): item is OverlayLayer {
    return typeof item === 'object' && item !== null && 'visible' in item;
}

/**
 * Default overlay layers
 */
export const DEFAULT_OVERLAY_LAYERS: OverlayLayer[] = [
    {
        id: 'selected-file',
        name: 'Selected file',
        description: 'Displays the currently selected file on the map',
        type: 'geojson',
        source: {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        },
        visible: false
    }
];

/**
 * Special layer ID for the selected file layer
 */
export const SELECTED_FILE_LAYER_ID = 'selected-file';