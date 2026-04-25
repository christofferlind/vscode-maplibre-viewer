import * as fs from 'fs';
import { FileToGeoJsonAdapter } from '../services/api';
import { isValidGeoJson } from '../services/geojsonUtils';

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