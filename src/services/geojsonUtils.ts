/**
 * GeoJSON Utilities Module
 *
 * Provides validation and conversion utilities for GeoJSON data.
 * Consolidates common GeoJSON operations used across the extension.
 */

/**
 * Valid GeoJSON geometry types
 */
export const VALID_GEOJSON_GEOMETRY_TYPES = [
    'Point',
    'MultiPoint',
    'LineString',
    'MultiLineString',
    'Polygon',
    'MultiPolygon',
    'GeometryCollection'
] as const;

/**
 * Valid GeoJSON top-level types (includes Feature and FeatureCollection)
 */
export const VALID_GEOJSON_TYPES = [
    'FeatureCollection',
    'Feature',
    ...VALID_GEOJSON_GEOMETRY_TYPES
] as const;

/**
 * Type for valid GeoJSON geometry types
 */
export type GeoJsonGeometryType = typeof VALID_GEOJSON_GEOMETRY_TYPES[number];

/**
 * Type for valid GeoJSON top-level types
 */
export type GeoJsonType = typeof VALID_GEOJSON_TYPES[number];

/**
 * Checks if an object is valid GeoJSON.
 * Validates that the object has a valid type property and required structure.
 *
 * @param obj The object to validate
 * @returns True if the object appears to be valid GeoJSON
 */
export function isValidGeoJson(obj: unknown): boolean {
    if (!obj || typeof obj !== 'object') {
        return false;
    }

    const geojson = obj as Record<string, unknown>;

    // Must have a type property
    if (typeof geojson.type !== 'string') {
        return false;
    }

    // Check if type is valid
    if (!VALID_GEOJSON_TYPES.includes(geojson.type as GeoJsonType)) {
        return false;
    }

    // Additional validation for FeatureCollection
    if (geojson.type === 'FeatureCollection') {
        if (!Array.isArray(geojson.features)) {
            return false;
        }
    }

    // Additional validation for Feature
    if (geojson.type === 'Feature') {
        if (geojson.geometry !== null && typeof geojson.geometry !== 'object') {
            return false;
        }
    }

    return true;
}

/**
 * Ensures a GeoJSON object is wrapped as a FeatureCollection.
 * Wraps single Features or Geometry objects into a FeatureCollection.
 *
 * @param obj The object to convert
 * @returns A GeoJSON FeatureCollection object
 * @throws Error if the object is not valid GeoJSON
 */
export function ensureFeatureCollection(obj: unknown): object {
    if (!obj || typeof obj !== 'object') {
        throw new Error('Invalid GeoJSON: expected an object');
    }

    const geojson = obj as Record<string, unknown>;

    // Already a FeatureCollection
    if (geojson.type === 'FeatureCollection') {
        if (!Array.isArray(geojson.features)) {
            throw new Error('Invalid GeoJSON FeatureCollection: "features" must be an array');
        }
        return geojson;
    }

    // Single Feature - wrap in FeatureCollection
    if (geojson.type === 'Feature') {
        return {
            type: 'FeatureCollection',
            features: [geojson]
        };
    }

    // Geometry object - wrap in FeatureCollection
    if (typeof geojson.type === 'string' && VALID_GEOJSON_GEOMETRY_TYPES.includes(geojson.type as GeoJsonGeometryType)) {
        return {
            type: 'FeatureCollection',
            features: [
                {
                    type: 'Feature',
                    geometry: geojson,
                    properties: {}
                }
            ]
        };
    }

    throw new Error(
        'Invalid GeoJSON: expected a FeatureCollection, Feature, or Geometry object. ' +
        `Got type "${String(geojson.type)}"`
    );
}