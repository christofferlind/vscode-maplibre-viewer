import * as fs from 'fs';
import { FileToGeoJsonAdapter } from '../services/api';
import { parseGpxFile } from '../services/gpxParser';
import { isValidGeoJson } from '../services/geojsonUtils';

/**
 * GPX file adapter for the MapLibre Viewer extension.
 * Handles .gpx files containing GPS Exchange Format data.
 */
export const gpxAdapter: FileToGeoJsonAdapter = {
    /**
     * Returns the name of this adapter.
     */
    getName(): string {
        return 'GPX Adapter';
    },

    /**
     * Checks if this adapter can handle the given file extension.
     * @param fileExtension The file extension (including the dot, e.g., '.gpx')
     * @returns True if this adapter can handle the file type
     */
    canHandle(fileExtension: string): boolean {
        return fileExtension.toLowerCase() === '.gpx';
    },

    /**
     * Converts a GPX file to a GeoJSON object.
     * @param filePath The absolute path to the file
     * @returns A promise resolving to the GeoJSON object
     */
    async toGeoJson(filePath: string): Promise<object> {
        const geojson = parseGpxFile(filePath);
        
        if (!isValidGeoJson(geojson)) {
            throw new Error('Failed to convert GPX to valid GeoJSON');
        }
        
        return geojson;
    }
};
