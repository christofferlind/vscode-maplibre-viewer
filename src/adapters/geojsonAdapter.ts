import * as fs from 'fs';
import { FileToGeoJsonAdapter } from '../services/api';

/**
 * GeoJSON file adapter for the MapLibre Viewer extension.
 * Handles .geojson and .json files containing GeoJSON data.
 */
export const geojsonAdapter: FileToGeoJsonAdapter = {
    /**
     * Returns the name of this adapter.
     */
    getName(): string {
        return 'GeoJSON Adapter';
    },

    /**
     * Checks if this adapter can handle the given file extension.
     * @param fileExtension The file extension (including the dot, e.g., '.geojson', '.json')
     * @returns True if this adapter can handle the file type
     */
    canHandle(fileExtension: string): boolean {
        const ext = fileExtension.toLowerCase();
        return ext === '.geojson' || ext === '.json';
    },

    /**
     * Converts a GeoJSON file to a GeoJSON object.
     * @param filePath The absolute path to the file
     * @returns A promise resolving to the GeoJSON object
     */
    async toGeoJson(filePath: string): Promise<object> {
        const content = fs.readFileSync(filePath, 'utf-8');
        
        try {
            const parsed = JSON.parse(content);
            
            // Validate that it's a valid GeoJSON structure
            if (!isValidGeoJson(parsed)) {
                throw new Error('File does not contain valid GeoJSON data');
            }
            
            return parsed;
        } catch (error) {
            if (error instanceof SyntaxError) {
                throw new Error(`Failed to parse JSON: ${error.message}`);
            }
            throw error;
        }
    }
};

/**
 * Validates that the parsed object is a valid GeoJSON structure.
 * @param obj The parsed JSON object
 * @returns True if the object appears to be valid GeoJSON
 */
function isValidGeoJson(obj: any): boolean {
    if (!obj || typeof obj !== 'object') {
        return false;
    }

    // Check for valid GeoJSON types
    const validTypes = [
        'FeatureCollection',
        'Feature',
        'Point',
        'MultiPoint',
        'LineString',
        'MultiLineString',
        'Polygon',
        'MultiPolygon',
        'GeometryCollection'
    ];

    // Must have a type property
    if (typeof obj.type !== 'string') {
        return false;
    }

    // Check if type is valid
    if (!validTypes.includes(obj.type)) {
        return false;
    }

    // Additional validation for FeatureCollection
    if (obj.type === 'FeatureCollection') {
        if (!Array.isArray(obj.features)) {
            return false;
        }
    }

    // Additional validation for Feature
    if (obj.type === 'Feature') {
        if (obj.geometry !== null && typeof obj.geometry !== 'object') {
            return false;
        }
    }

    return true;
}