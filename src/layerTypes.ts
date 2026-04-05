/**
 * Represents a base map style option
 */
export interface BaseMapStyle {
    id: string;
    name: string;
    description?: string;
    styleUrl: string;
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
    return typeof item === 'object' && item !== null && 'styleUrl' in item;
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
    // Users can add their own layers via settings
];