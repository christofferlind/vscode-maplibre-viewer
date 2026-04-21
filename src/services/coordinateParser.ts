/**
 * Coordinate Parser Module
 *
 * Parses various coordinate formats from text strings.
 * Supports decimal degrees, DMS format, GeoJSON arrays, and URL formats.
 * Additional patterns can be registered via addCoordinatePattern().
 */

/**
 * Represents a parsed geographic coordinate
 */
export interface Coordinate {
    latitude: number;
    longitude: number;
}

/**
 * Represents a coordinate with its position in the source text
 */
export interface CoordinateWithPosition extends Coordinate {
    startIndex: number;
    endIndex: number;
}

/**
 * Represents a GeoJSON position (longitude, latitude order)
 */
export type GeoJsonPosition = [number, number];

/**
 * Represents a bounding box with southwest and northeast corners
 */
export interface BoundingBox {
    southwest: Coordinate;
    northeast: Coordinate;
}

/**
 * Registry for custom coordinate patterns.
 * Patterns must have named groups 'lat' and 'lng' for direct coordinate extraction,
 * or named groups for DMS components (latDegrees, latMinutes, latSeconds, latDirection,
 * lngDegrees, lngMinutes, lngSeconds, lngDirection).
 */
const customPatterns: RegExp[] = [];

// DMS format: 59°19'45.5"N 18°4'7.0"E
// Stricter regex that requires degree symbol (°), minute ('), second ("), and direction
export const regexDMS = /(?<latDegrees>\d+)°(?<latMinutes>\d+)?'(?<latSeconds>\d+\.?\d*)?"(?<latDirection>[NS])\s+(?<lngDegrees>\d+)°(?<lngMinutes>\d+)?'(?<lngSeconds>\d+\.?\d*)?"(?<lngDirection>[EW])/gi;

// Decimal degrees: lat,lng or lat lng
export const regexWGS84 = /(?<lat>-?\d+\.?\d*)\s*[,\s]\s*(?<lng>-?\d+\.?\d*)/g;

// GeoJSON array format: [lng, lat] - first value is longitude, second is latitude
export const regexGeoJSON = /\[\s*(?<lng>-?\d+\.?\d*)\s*(,|\s)\s*(?<lat>-?\d+\.?\d*)\s*\]/g;

/**
 * Default coordinate patterns built into the parser.
 */
export const defaultPatterns: RegExp[] = [
    regexGeoJSON,
    regexDMS,
    regexWGS84
];

/**
 * Adds a custom coordinate pattern to the registry.
 * Patterns must have named groups 'lat' and 'lng' for direct coordinate extraction,
 * or named groups for DMS components.
 *
 * @param pattern - RegExp pattern with named groups for coordinate extraction
 * @example
 * // Add a pattern for MGRS format
 * addCoordinatePattern(/(?<lat>\d+\.\d+).*?(?<lng>\d+\.\d+)/g);
 */
export function addCoordinatePattern(pattern: RegExp): void {
    customPatterns.push(pattern);
}

/**
 * Removes all custom coordinate patterns from the registry.
 */
export function clearCustomPatterns(): void {
    customPatterns.length = 0;
}

/**
 * Gets all registered patterns (default + custom).
 * @returns Array of all registered regex patterns
 */
export function getCoordinatePatterns(): RegExp[] {
    return [...defaultPatterns, ...customPatterns];
}

/**
 * Parses coordinate text and returns a Coordinate object if valid.
 * 
 * Supported formats:
 * - Decimal degrees: `59.3293, 18.0686` or `59.3293 18.0686`
 * - DMS format: `59°19'45.5"N 18°4'7.0"E`
 * - GeoJSON array: `[18.0686, 59.3293]` (note: GeoJSON is [lng, lat])
 * - URL format: `@59.3293,18.0686`
 * 
 * @param text - The text to parse for coordinates
 * @returns A Coordinate object if valid coordinates found, null otherwise
 */
export function parseCoordinate(text: string): Coordinate | null {
    const trimmed = text.trim();
    
    if (!trimmed) {
        return null;
    }
    
    // Parse coordinates from the text and return the first match
    const coordinates = parseMultipleCoordinates(trimmed);
    return coordinates.length > 0 ? coordinates[0] : null;
}

/**
 * Parses text and returns all found coordinates.
 * This function scans the entire text for coordinate patterns.
 * 
 * @param text - The text to parse for coordinates
 * @returns An array of Coordinate objects found in the text
 */
export function parseMultipleCoordinates(text: string): Coordinate[] {
    const trimmed = text.trim();
    
    if (!trimmed) {
        return [];
    }
    
    // Get all patterns (default + custom)
    const patterns = getCoordinatePatterns();
    
    // Find all coordinates using all patterns
    const coordinates = findCoordinatesRegex(trimmed, patterns);
    
    // Remove duplicates (coordinates within 0.000001 degrees are considered the same)
    return deduplicateCoordinates(coordinates);
}

/**
 * Finds all coordinates in text using a list of regex patterns.
 * Each regex must have named groups 'lat' and 'lng' for direct coordinate extraction,
 * or named groups for DMS components (latDegrees, latMinutes, latSeconds, latDirection,
 * lngDegrees, lngMinutes, lngSeconds, lngDirection).
 *
 * @param text - The text to search for coordinates
 * @param patterns - Array of regex patterns with named groups
 * @returns An array of Coordinate objects found in the text
 */
export function findCoordinatesRegex(text: string, patterns: RegExp[]): Coordinate[] {
    const coordinates: Coordinate[] = [];
    
    // Track occupied ranges to skip overlapping matches
    const occupiedRanges: { start: number; end: number }[] = [];
    
    for (const pattern of patterns) {
        // Reset lastIndex for global patterns
        pattern.lastIndex = 0;
        
        let match;
        while ((match = pattern.exec(text)) !== null) {
            const startIndex = match.index;
            const endIndex = startIndex + match[0].length;
            
            // Check if this match overlaps with any previously stored match
            const overlaps = occupiedRanges.some(range =>
                startIndex < range.end && endIndex > range.start
            );
            
            if (overlaps) {
                continue;
            }
            
            // Store the range first to mark this text position as occupied
            // This ensures any subsequent match within this range is skipped
            occupiedRanges.push({ start: startIndex, end: endIndex });
            
            const groups = match.groups;
            if (!groups) {
                continue;
            }
            
            let lat: number | null = null;
            let lng: number | null = null;
            
            // Check for direct lat/lng groups
            if ('lat' in groups && 'lng' in groups) {
                lat = parseFloat(groups.lat);
                lng = parseFloat(groups.lng);
            }
            // Check for DMS format groups
            else if ('latDegrees' in groups && 'lngDegrees' in groups) {
                const latDegrees = parseFloat(groups.latDegrees);
                const latMinutes = groups.latMinutes ? parseFloat(groups.latMinutes) : 0;
                const latSeconds = groups.latSeconds ? parseFloat(groups.latSeconds) : 0;
                const latDirection = groups.latDirection ? groups.latDirection.toUpperCase() : 'N';
                
                const lngDegrees = parseFloat(groups.lngDegrees);
                const lngMinutes = groups.lngMinutes ? parseFloat(groups.lngMinutes) : 0;
                const lngSeconds = groups.lngSeconds ? parseFloat(groups.lngSeconds) : 0;
                const lngDirection = groups.lngDirection ? groups.lngDirection.toUpperCase() : 'E';
                
                lat = dmsToDecimal(latDegrees, latMinutes, latSeconds, latDirection);
                lng = dmsToDecimal(lngDegrees, lngMinutes, lngSeconds, lngDirection);
            }
            
            if (lat !== null && lng !== null && isValidCoordinate(lat, lng)) {
                coordinates.push({ latitude: lat, longitude: lng });
            }
        }

    }
    
    return coordinates;
}

/**
 * Removes duplicate coordinates (within a small tolerance).
 */
function deduplicateCoordinates(coordinates: Coordinate[]): Coordinate[] {
    const unique: Coordinate[] = [];
    const tolerance = 0.000001;
    
    for (const coord of coordinates) {
        const isDuplicate = unique.some(existing => 
            Math.abs(existing.latitude - coord.latitude) < tolerance &&
            Math.abs(existing.longitude - coord.longitude) < tolerance
        );
        
        if (!isDuplicate) {
            unique.push(coord);
        }
    }
    
    return unique;
}

/**
 * Calculates a bounding box from an array of coordinates.
 * Returns null if the array is empty.
 *
 * @param coordinates - Array of coordinates
 * @returns Bounding box with southwest and northeast corners, or null
 */
export function calculateBoundingBox(coordinates: Coordinate[]): BoundingBox | null {
    if (coordinates.length === 0) {
        return null;
    }
    
    let minLat = coordinates[0].latitude;
    let maxLat = coordinates[0].latitude;
    let minLng = coordinates[0].longitude;
    let maxLng = coordinates[0].longitude;
    
    for (const coord of coordinates) {
        minLat = Math.min(minLat, coord.latitude);
        maxLat = Math.max(maxLat, coord.latitude);
        minLng = Math.min(minLng, coord.longitude);
        maxLng = Math.max(maxLng, coord.longitude);
    }
    
    return {
        southwest: { latitude: minLat, longitude: minLng },
        northeast: { latitude: maxLat, longitude: maxLng }
    };
}

/**
 * Extracts all coordinates from a GeoJSON object.
 * Handles all GeoJSON geometry types including Point, MultiPoint, LineString,
 * MultiLineString, Polygon, MultiPolygon, and GeometryCollection.
 *
 * @param geojson - The GeoJSON object to extract coordinates from
 * @returns An array of Coordinate objects (latitude/longitude format)
 */
export function extractCoordinatesFromGeoJson(geojson: any): Coordinate[] {
    const coordinates: Coordinate[] = [];

    if (!geojson) {
        return coordinates;
    }

    function extractFromGeometry(geometry: any): void {
        if (!geometry || !geometry.coordinates) {
            return;
        }

        switch (geometry.type) {
            case 'Point':
                if (Array.isArray(geometry.coordinates) && geometry.coordinates.length >= 2) {
                    coordinates.push({
                        latitude: geometry.coordinates[1],
                        longitude: geometry.coordinates[0]
                    });
                }
                break;
            case 'MultiPoint':
            case 'LineString':
                if (Array.isArray(geometry.coordinates)) {
                    geometry.coordinates.forEach((coord: GeoJsonPosition) => {
                        if (Array.isArray(coord) && coord.length >= 2) {
                            coordinates.push({
                                latitude: coord[1],
                                longitude: coord[0]
                            });
                        }
                    });
                }
                break;
            case 'MultiLineString':
            case 'Polygon':
                if (Array.isArray(geometry.coordinates)) {
                    geometry.coordinates.forEach((ring: GeoJsonPosition[]) => {
                        if (Array.isArray(ring)) {
                            ring.forEach((coord: GeoJsonPosition) => {
                                if (Array.isArray(coord) && coord.length >= 2) {
                                    coordinates.push({
                                        latitude: coord[1],
                                        longitude: coord[0]
                                    });
                                }
                            });
                        }
                    });
                }
                break;
            case 'MultiPolygon':
                if (Array.isArray(geometry.coordinates)) {
                    geometry.coordinates.forEach((polygon: GeoJsonPosition[][]) => {
                        if (Array.isArray(polygon)) {
                            polygon.forEach((ring: GeoJsonPosition[]) => {
                                if (Array.isArray(ring)) {
                                    ring.forEach((coord: GeoJsonPosition) => {
                                        if (Array.isArray(coord) && coord.length >= 2) {
                                            coordinates.push({
                                                latitude: coord[1],
                                                longitude: coord[0]
                                            });
                                        }
                                    });
                                }
                            });
                        }
                    });
                }
                break;
            case 'GeometryCollection':
                if (Array.isArray(geometry.geometries)) {
                    geometry.geometries.forEach((geom: any) => extractFromGeometry(geom));
                }
                break;
        }
    }

    function extractFromFeature(feature: any): void {
        if (feature.geometry) {
            extractFromGeometry(feature.geometry);
        }
    }

    // Process based on GeoJSON type
    if (geojson.type === 'FeatureCollection') {
        if (Array.isArray(geojson.features)) {
            geojson.features.forEach((feature: any) => extractFromFeature(feature));
        }
    } else if (geojson.type === 'Feature') {
        extractFromFeature(geojson);
    } else {
        // Direct geometry object
        extractFromGeometry(geojson);
    }

    return coordinates;
}

/**
 * Calculates a bounding box from a GeoJSON object.
 * Convenience function that combines extractCoordinatesFromGeoJson and calculateBoundingBox.
 *
 * @param geojson - The GeoJSON object to calculate bounds for
 * @returns Bounding box with southwest and northeast corners, or null if no coordinates found
 */
export function calculateBoundingBoxFromGeoJson(geojson: any): BoundingBox | null {
    const coordinates = extractCoordinatesFromGeoJson(geojson);
    return calculateBoundingBox(coordinates);
}

/**
 * Validates that coordinates are within valid ranges.
 * Latitude: -90 to 90
 * Longitude: -180 to 180
 */
function isValidCoordinate(lat: number, lng: number): boolean {
    return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

/**
 * Converts DMS (Degrees Minutes Seconds) to decimal degrees.
 */
function dmsToDecimal(degrees: number, minutes: number, seconds: number, direction: string): number {
    let decimal = Math.abs(degrees) + minutes / 60 + seconds / 3600;
    
    if (direction === 'S' || direction === 'W') {
        decimal = -decimal;
    }
    
    // Round to 6 decimal places for precision
    return Math.round(decimal * 1000000) / 1000000;
}