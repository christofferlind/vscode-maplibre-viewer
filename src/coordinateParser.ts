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
 * Registry for custom coordinate patterns.
 * Patterns must have named groups 'lat' and 'lng' for direct coordinate extraction,
 * or named groups for DMS components (latDegrees, latMinutes, latSeconds, latDirection,
 * lngDegrees, lngMinutes, lngSeconds, lngDirection).
 */
const customPatterns: RegExp[] = [];

/**
 * Default coordinate patterns built into the parser.
 */
const defaultPatterns: RegExp[] = [
    // GeoJSON format: [lng, lat]
    /\[\s*(?<lng>-?\d+\.?\d*)\s*[,\s]\s*(?<lat>-?\d+\.?\d*)\s*\]/g,
    // URL format: @lat,lng or @lat lng
    /@(?<lat>-?\d+\.?\d*)\s*[,\s]\s*(?<lng>-?\d+\.?\d*)/g,
    // DMS format: 59°19'45.5"N 18°4'7.0"E
    /(?<latDegrees>-?\d+)(?:°|\s)+(?<latMinutes>\d+)?(?:['\s])*(?<latSeconds>\d+\.?\d*)?(?:"|\s)*(?<latDirection>[NS])?\s*(?<lngDegrees>-?\d+)(?:°|\s)+(?<lngMinutes>\d+)?(?:['\s])*(?<lngSeconds>\d+\.?\d*)?(?:"|\s)*(?<lngDirection>[EW])?/gi,
    // Decimal degrees: lat,lng or lat lng
    /(?<lat>-?\d+\.?\d*)\s*[,\s]\s*(?<lng>-?\d+\.?\d*)/g
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
function findCoordinatesRegex(text: string, patterns: RegExp[]): Coordinate[] {
    const coordinates: Coordinate[] = [];
    
    for (const pattern of patterns) {
        // Reset lastIndex for global patterns
        pattern.lastIndex = 0;
        
        let match;
        while ((match = pattern.exec(text)) !== null) {
            const groups = match.groups;
            if (!groups) continue;
            
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
export function calculateBoundingBox(coordinates: Coordinate[]): { 
    southwest: Coordinate; 
    northeast: Coordinate;
} | null {
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