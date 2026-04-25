import * as fs from 'fs';
import * as path from 'path';
import { FileToGeoJsonAdapter } from './api';
import { parseKmlFile } from './kmlParser';
import { parseGpxFile } from './gpxParser';
import { parseCsvFile } from './csvParser';
import { ensureFeatureCollection } from './geojsonUtils';

/**
 * Result of file validation.
 */
export interface FileValidationResult {
    /** Whether the file is valid and can be converted */
    valid: boolean;
    /** Error message if invalid */
    error?: string;
    /** The file extension (e.g., '.geojson') */
    extension: string;
}

/**
 * Supported file extensions for drag-and-drop conversion to GeoJSON.
 */
export const SUPPORTED_EXTENSIONS = new Set([
    '.geojson',
    '.json',
    '.kml',
    '.gpx',
    '.csv',
    '.shp'
]);

/**
 * Shapefile requires accompanying files.
 */
const SHAPEFILE_REQUIRED_EXTENSIONS = ['.dbf', '.prj', '.shx'];

/**
 * Checks if a file extension is supported for drag-and-drop conversion.
 * @param extension File extension including the dot (e.g., '.geojson')
 * @returns True if the extension is supported
 */
export function isSupportedFileExtension(extension: string): boolean {
    return SUPPORTED_EXTENSIONS.has(extension.toLowerCase());
}

/**
 * Gets the list of supported file extensions as a display string.
 */
export function getSupportedExtensionsDisplay(): string {
    return Array.from(SUPPORTED_EXTENSIONS).join(', ');
}

/**
 * Validates a file to check if it can be converted to GeoJSON.
 * @param filePath Absolute path to the file
 * @returns Validation result with error details if invalid
 */
export function validateFile(filePath: string): FileValidationResult {
    const ext = path.extname(filePath).toLowerCase();

    // Check if extension is supported
    if (!isSupportedFileExtension(ext)) {
        return {
            valid: false,
            error: `Unsupported file format "${ext}". Supported formats: ${getSupportedExtensionsDisplay()}`,
            extension: ext
        };
    }

    // Check if file exists
    if (!fs.existsSync(filePath)) {
        return {
            valid: false,
            error: `File not found: ${filePath}`,
            extension: ext
        };
    }

    // Check if file is readable
    try {
        fs.accessSync(filePath, fs.constants.R_OK);
    } catch {
        return {
            valid: false,
            error: `File is not readable: ${filePath}`,
            extension: ext
        };
    }

    // For shapefiles, check accompanying files
    if (ext === '.shp') {
        const missingFiles: string[] = [];
        for (const reqExt of SHAPEFILE_REQUIRED_EXTENSIONS) {
            const reqPath = filePath.replace(/\.shp$/i, reqExt);
            if (!fs.existsSync(reqPath)) {
                missingFiles.push(reqExt);
            }
        }
        if (missingFiles.length > 0) {
            return {
                valid: false,
                error: `Shapefile is missing required accompanying file(s): ${missingFiles.join(', ')}. ` +
                    'A .shp file requires .dbf, .prj, and .shx files with the same base name.',
                extension: ext
            };
        }
    }

    return {
        valid: true,
        extension: ext
    };
}

/**
 * Converts a file to a GeoJSON object.
 * Uses registered adapters first, then falls back to built-in parsers.
 * @param filePath Absolute path to the file
 * @param adapters Array of registered FileToGeoJsonAdapters
 * @returns A promise resolving to a GeoJSON FeatureCollection object
 * @throws Error if conversion fails
 */
export async function convertToGeoJson(
    filePath: string,
    adapters: FileToGeoJsonAdapter[]
): Promise<object> {
    const ext = path.extname(filePath).toLowerCase();

    // First, try registered adapters
    for (const adapter of adapters) {
        if (adapter.canHandle(ext)) {
            try {
                const result = await adapter.toGeoJson(filePath);
                // Ensure it's a FeatureCollection
                return ensureFeatureCollection(result);
            } catch (error) {
                throw new Error(
                    `Adapter "${adapter.getName()}" failed to convert file: ` +
                    `${error instanceof Error ? error.message : String(error)}`
                );
            }
        }
    }

    // Fall back to built-in parsers
    try {
        switch (ext) {
            case '.geojson':
            case '.json':
                return convertGeoJsonFile(filePath);
            case '.kml':
                return parseKmlFile(filePath);
            case '.gpx':
                return parseGpxFile(filePath);
            case '.csv':
                return parseCsvFile(filePath);
            case '.shp':
                throw new Error(
                    'Shapefile (.shp) conversion requires a registered adapter. ' +
                    'No adapter is currently available for this format.'
                );
            default:
                throw new Error(`Unsupported file format: ${ext}`);
        }
    } catch (error) {
        if (error instanceof Error) {
            throw error;
        }
        throw new Error(`Failed to convert file: ${String(error)}`);
    }
}

/**
 * Converts a .geojson or .json file by reading and parsing it.
 */
function convertGeoJsonFile(filePath: string): object {
    const content = fs.readFileSync(filePath, 'utf-8');
    let parsed: unknown;

    try {
        parsed = JSON.parse(content);
    } catch (error) {
        throw new Error(
            `Failed to parse JSON: ${error instanceof SyntaxError ? error.message : String(error)}`
        );
    }

    return ensureFeatureCollection(parsed);
}

/**
 * Extracts a default layer name from a file path.
 * @param filePath Absolute path to the file
 * @returns The filename without extension
 */
export function getDefaultLayerName(filePath: string): string {
    const basename = path.basename(filePath);
    const ext = path.extname(basename);
    return basename.slice(0, -ext.length) || basename;
}
