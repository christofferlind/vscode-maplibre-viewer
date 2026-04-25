/**
 * Coordinate and view state formatting utilities.
 * Consolidates formatting logic used across bookmark display, tooltips, and status displays.
 */

/**
 * Represents a coordinate for display purposes
 */
export interface CoordinateDisplay {
    latitude: number;
    longitude: number;
}

/**
 * Represents view state for display purposes
 */
export interface ViewStateDisplay {
    zoom: number;
    bearing: number;
    pitch: number;
}

/**
 * Format a coordinate for display with specified precision.
 * @param coord - The coordinate to format
 * @param precision - Number of decimal places (default: 6)
 * @returns Formatted coordinate string (e.g., "59.329375, 18.068984")
 */
export function formatCoordinate(coord: CoordinateDisplay, precision = 6): string {
    return `${coord.latitude.toFixed(precision)}, ${coord.longitude.toFixed(precision)}`;
}

/**
 * Parse a coordinate string into latitude/longitude.
 * @param str - String in format "lat, lng" or "lat,lng"
 * @returns Parsed coordinate or null if invalid
 */
export function parseCoordinateString(str: string): CoordinateDisplay | null {
    const match = str.match(/(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)/);
    if (!match) {
        return null;
    }
    return {
        latitude: parseFloat(match[1]),
        longitude: parseFloat(match[2])
    };
}

/**
 * Format view state for display.
 * @param state - The view state to format
 * @returns Formatted view state string (e.g., "Zoom: 12, Bearing: 0°, Pitch: 0°")
 */
export function formatViewState(state: ViewStateDisplay): string {
    const parts = [`Zoom: ${state.zoom.toFixed(1)}`];
    if (state.bearing !== 0) {
        parts.push(`Bearing: ${state.bearing.toFixed(0)}°`);
    }
    if (state.pitch !== 0) {
        parts.push(`Pitch: ${state.pitch.toFixed(0)}°`);
    }
    return parts.join(', ');
}

/**
 * Format a complete bookmark description with coordinate and view state.
 * @param coord - The coordinate
 * @param state - The view state
 * @returns Formatted description string
 */
export function formatBookmarkDescription(
    coord: CoordinateDisplay, 
    state: ViewStateDisplay
): string {
    return `${formatCoordinate(coord)} | ${formatViewState(state)}`;
}

/**
 * Format latitude for display with direction.
 * @param lat - Latitude value
 * @param precision - Number of decimal places
 * @returns Formatted latitude (e.g., "59.329375° N")
 */
export function formatLatitude(lat: number, precision = 6): string {
    const dir = lat >= 0 ? 'N' : 'S';
    return `${Math.abs(lat).toFixed(precision)}° ${dir}`;
}

/**
 * Format longitude for display with direction.
 * @param lng - Longitude value
 * @param precision - Number of decimal places
 * @returns Formatted longitude (e.g., "18.068984° E")
 */
export function formatLongitude(lng: number, precision = 6): string {
    const dir = lng >= 0 ? 'E' : 'W';
    return `${Math.abs(lng).toFixed(precision)}° ${dir}`;
}