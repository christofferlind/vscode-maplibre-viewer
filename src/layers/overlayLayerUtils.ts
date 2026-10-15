import { OverlayLayer, DEFAULT_OVERLAY_LAYERS, SELECTED_FILE_LAYER_ID, CLIPBOARD_LAYER_ID } from './layerTypes';

export const EMPTY_FEATURE_COLLECTION: object = { type: 'FeatureCollection', features: [] };

/**
 * Returns a deep copy of the default overlay layers so callers can mutate
 * the returned array and its elements without modifying the module constant.
 */
export function cloneDefaultOverlayLayers(): OverlayLayer[] {
    return DEFAULT_OVERLAY_LAYERS.map(layer => ({
        ...layer,
        source: {
            ...layer.source
        }
    }));
}

/**
 * Returns a copy of the overlay layers with the "Selected file" layer's
 * GeoJSON data replaced by an empty FeatureCollection. The layer's
 * visibility, color, and other properties are preserved. This is used when
 * persisting overlay state so we never write a previous session's file data
 * to globalState.
 */
export function sanitizeForPersistence(layers: OverlayLayer[]): OverlayLayer[] {
    return layers.map(layer => {
        if (layer.id !== SELECTED_FILE_LAYER_ID && layer.id !== CLIPBOARD_LAYER_ID) {
            return layer;
        }
        return {
            ...layer,
            source: {
                ...layer.source,
                data: EMPTY_FEATURE_COLLECTION
            }
        };
    });
}