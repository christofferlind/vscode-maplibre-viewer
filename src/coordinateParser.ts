/**
 * Coordinate Parser Module
 * 
 * Parses various coordinate formats from text strings.
 * Supports decimal degrees, DMS format, GeoJSON arrays, and URL formats.
 */

/**
 * Represents a parsed geographic coordinate
 */
export interface Coordinate {
    latitude: number;
    longitude: number;
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
    
    // Try each format in order of specificity
    const result = 
        tryGeoJSON(trimmed) ||
        tryURLFormat(trimmed) ||
        tryDMS(trimmed) ||
        tryDecimalDegrees(trimmed);
    
    return result;
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
 * Attempts to parse decimal degrees format.
 * Examples: "59.3293, 18.0686", "59.3293 18.0686", "-33.8688, 151.2093"
 */
function tryDecimalDegrees(text: string): Coordinate | null {
    // Match patterns like:
    // 59.3293, 18.0686
    // 59.3293,18.0686
    // 59.3293 18.0686
    // -33.8688, 151.2093
    const pattern = /^(-?\d+\.?\d*)\s*[,\s]\s*(-?\d+\.?\d*)$/;
    const match = text.match(pattern);
    
    if (!match) {
        return null;
    }
    
    const first = parseFloat(match[1]);
    const second = parseFloat(match[2]);
    
    // Determine which is latitude and which is longitude
    // Convention: first value is typically latitude
    // Exception: if one value is > 90 or < -90, it must be longitude
    let lat: number;
    let lng: number;
    
    if (Math.abs(first) > 90 && Math.abs(second) <= 90) {
        // First value is longitude (out of latitude range)
        lng = first;
        lat = second;
    } else if (Math.abs(second) > 90 && Math.abs(first) <= 90) {
        // Second value is longitude (out of latitude range)
        lat = first;
        lng = second;
    } else {
        // Both values could be valid latitude - use standard convention
        lat = first;
        lng = second;
    }
    
    if (!isValidCoordinate(lat, lng)) {
        return null;
    }
    
    return { latitude: lat, longitude: lng };
}

/**
 * Attempts to parse DMS (Degrees Minutes Seconds) format.
 * Examples: "59°19'45.5\"N 18°4'7.0\"E", "59 19 45.5 N 18 4 7.0 E"
 */
function tryDMS(text: string): Coordinate | null {
    // Pattern for DMS format with various separators
    // Matches: 59°19'45.5"N 18°4'7.0"E or 59 19 45.5 N 18 4 7.0 E
    const pattern = /(-?\d+)(?:°|\s)+(\d+)?(?:['\s])*(\d+\.?\d*)?(?:"|\s)*([NS])?\s*(-?\d+)(?:°|\s)+(\d+)?(?:['\s])*(\d+\.?\d*)?(?:"|\s)*([EW])?/i;
    const match = text.match(pattern);
    
    if (!match) {
        return null;
    }
    
    // Parse first coordinate (latitude)
    const latDegrees = parseFloat(match[1]);
    const latMinutes = match[2] ? parseFloat(match[2]) : 0;
    const latSeconds = match[3] ? parseFloat(match[3]) : 0;
    const latDirection = match[4] ? match[4].toUpperCase() : 'N';
    
    // Parse second coordinate (longitude)
    const lngDegrees = parseFloat(match[5]);
    const lngMinutes = match[6] ? parseFloat(match[6]) : 0;
    const lngSeconds = match[7] ? parseFloat(match[7]) : 0;
    const lngDirection = match[8] ? match[8].toUpperCase() : 'E';
    
    // Convert DMS to decimal degrees
    let lat = dmsToDecimal(latDegrees, latMinutes, latSeconds, latDirection);
    let lng = dmsToDecimal(lngDegrees, lngMinutes, lngSeconds, lngDirection);
    
    if (!isValidCoordinate(lat, lng)) {
        return null;
    }
    
    return { latitude: lat, longitude: lng };
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

/**
 * Attempts to parse GeoJSON array format.
 * Note: GeoJSON uses [longitude, latitude] order.
 * Example: "[18.0686, 59.3293]"
 */
function tryGeoJSON(text: string): Coordinate | null {
    // Match patterns like: [18.0686, 59.3293] or [ 18.0686, 59.3293 ]
    const pattern = /\[\s*(-?\d+\.?\d*)\s*[,\s]\s*(-?\d+\.?\d*)\s*\]/;
    const match = text.match(pattern);
    
    if (!match) {
        return null;
    }
    
    // GeoJSON order is [longitude, latitude]
    const lng = parseFloat(match[1]);
    const lat = parseFloat(match[2]);
    
    if (!isValidCoordinate(lat, lng)) {
        return null;
    }
    
    return { latitude: lat, longitude: lng };
}

/**
 * Attempts to parse URL format coordinates.
 * Example: "@59.3293,18.0686" (common in mapping URLs)
 */
function tryURLFormat(text: string): Coordinate | null {
    // Match patterns like: @59.3293,18.0686 or @59.3293 18.0686
    const pattern = /@(-?\d+\.?\d*)\s*[,\s]\s*(-?\d+\.?\d*)/;
    const match = text.match(pattern);
    
    if (!match) {
        return null;
    }
    
    const first = parseFloat(match[1]);
    const second = parseFloat(match[2]);
    
    // URL format typically has latitude first
    let lat: number;
    let lng: number;
    
    if (Math.abs(first) > 90 && Math.abs(second) <= 90) {
        lng = first;
        lat = second;
    } else if (Math.abs(second) > 90 && Math.abs(first) <= 90) {
        lat = first;
        lng = second;
    } else {
        // Standard convention: latitude first in URL format
        lat = first;
        lng = second;
    }
    
    if (!isValidCoordinate(lat, lng)) {
        return null;
    }
    
    return { latitude: lat, longitude: lng };
}