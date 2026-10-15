import { LayerStyle } from './layerTypes';

/**
 * Validates a partial layer style. Throws when a value is outside the
 * supported range so callers always persist a renderable style.
 */
export function validateLayerStyle(style: LayerStyle): void {
    if (style.color !== undefined && typeof style.color !== 'string') {
        throw new Error('Layer color must be a string');
    }
    if (style.opacity !== undefined && (typeof style.opacity !== 'number' || style.opacity < 0 || style.opacity > 1)) {
        throw new Error('Layer opacity must be a number between 0 and 1');
    }
    if (style.circleRadius !== undefined && (typeof style.circleRadius !== 'number' || style.circleRadius <= 0)) {
        throw new Error('Layer circle radius must be a positive number');
    }
    if (style.lineWidth !== undefined && (typeof style.lineWidth !== 'number' || style.lineWidth <= 0)) {
        throw new Error('Layer line width must be a positive number');
    }
}