import { Coordinate, parseMultipleCoordinates, extractCoordinatesFromGeoJson } from './coordinateParser';
import { isWktText, parseWktToGeoJson } from './wktParser';

/**
 * Result of parsing free text (editor selection or clipboard) that may
 * contain coordinates or WKT geometry.
 */
export interface GeoTextParseResult {
    /** GeoJSON FeatureCollection representing the parsed content */
    geojson: object;
    /** All coordinates found in the text */
    coordinates: Coordinate[];
    /** True when the text was recognized and parsed as WKT geometry */
    isWkt: boolean;
    /** Number of geometries/features represented in geojson */
    geometryCount: number;
}

/**
 * Shared parser for free-form geospatial text used by both the editor
 * selection handler and the clipboard layer.
 *
 * WKT geometry takes precedence: text starting with a WKT keyword is parsed
 * with the WKT parser, which reads tuples in "lng lat" order. Anything else
 * goes through the plain coordinate parser, and every parsed coordinate
 * becomes a Point feature.
 *
 * @param text - The text to parse
 * @returns A GeoTextParseResult, or null when no coordinates were found
 * @throws Error when the text looks like WKT but cannot be parsed
 */
export function parseGeoText(text: string): GeoTextParseResult | null {
    const trimmed = text.trim();
    if (!trimmed) {
        return null;
    }

    if (isWktText(trimmed)) {
        const { geojson, geometryCount } = parseWktToGeoJson(trimmed);
        return {
            geojson,
            coordinates: extractCoordinatesFromGeoJson(geojson),
            isWkt: true,
            geometryCount
        };
    }

    const coordinates = parseMultipleCoordinates(trimmed);
    if (coordinates.length === 0) {
        return null;
    }

    return {
        geojson: coordinatesToGeoJson(coordinates),
        coordinates,
        isWkt: false,
        geometryCount: coordinates.length
    };
}

/**
 * Builds a Point FeatureCollection from parsed coordinates
 */
function coordinatesToGeoJson(coordinates: Coordinate[]): object {
    return {
        type: 'FeatureCollection',
        features: coordinates.map((coordinate) => ({
            type: 'Feature',
            properties: {},
            geometry: {
                type: 'Point',
                coordinates: [coordinate.longitude, coordinate.latitude]
            }
        }))
    };
}