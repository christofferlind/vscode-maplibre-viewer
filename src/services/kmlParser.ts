import * as fs from 'fs';

/**
 * Parses KML XML content and converts it to a GeoJSON FeatureCollection.
 * Supports: Point, LineString, Polygon, MultiGeometry, and nested Folders.
 */

interface KmlPlacemark {
    name?: string;
    description?: string;
    geometry?: KmlGeometry;
}

interface KmlGeometry {
    type: string;
    coordinates: unknown; // Can be number[], number[][], number[][][], or number[][][][]
}

/**
 * Parses a KML file and converts it to a GeoJSON FeatureCollection.
 * @param filePath Absolute path to the .kml file
 * @returns A GeoJSON FeatureCollection
 */
export function parseKmlFile(filePath: string): object {
    const content = fs.readFileSync(filePath, 'utf-8');
    return parseKmlContent(content);
}

/**
 * Parses KML XML string content and converts to GeoJSON FeatureCollection.
 * @param content KML XML string
 * @returns A GeoJSON FeatureCollection
 */
export function parseKmlContent(content: string): object {
    const features: object[] = [];

    // Extract all Placemark elements using simple string parsing
    const placemarks = extractPlacemarks(content);

    for (const placemark of placemarks) {
        const feature = placemarkToFeature(placemark);
        if (feature) {
            features.push(feature);
        }
    }

    return {
        type: 'FeatureCollection',
        features
    };
}

/**
 * Extracts Placemark elements from KML XML using regex-based parsing.
 * This avoids needing an XML parser dependency.
 */
function extractPlacemarks(content: string): KmlPlacemark[] {
    const placemarks: KmlPlacemark[] = [];
    const placemarkRegex = /<Placemark[^>]*>([\s\S]*?)<\/Placemark>/gi;
    let match: RegExpExecArray | null;

    while ((match = placemarkRegex.exec(content)) !== null) {
        const placemarkContent = match[1];
        const placemark = parsePlacemarkContent(placemarkContent);
        if (placemark.geometry) {
            placemarks.push(placemark);
        }
    }

    return placemarks;
}

/**
 * Parses the content of a single Placemark element.
 */
function parsePlacemarkContent(content: string): KmlPlacemark {
    const placemark: KmlPlacemark = {};

    // Extract name
    const nameMatch = /<name[^>]*>([\s\S]*?)<\/name>/i.exec(content);
    if (nameMatch) {
        placemark.name = decodeXmlEntities(nameMatch[1].trim());
    }

    // Extract description
    const descMatch = /<description[^>]*>([\s\S]*?)<\/description>/i.exec(content);
    if (descMatch) {
        placemark.description = decodeXmlEntities(descMatch[1].trim());
    }

    // Extract geometry
    placemark.geometry = extractGeometry(content);

    return placemark;
}

/**
 * Extracts geometry from a Placemark content string.
 * Supports Point, LineString, Polygon, and MultiGeometry.
 */
function extractGeometry(content: string): KmlGeometry | undefined {
    // Try Point
    const pointMatch = /<Point[^>]*>([\s\S]*?)<\/Point>/i.exec(content);
    if (pointMatch) {
        const coords = parseCoordinateString(pointMatch[1]);
        if (coords.length > 0) {
            return {
                type: 'Point',
                coordinates: coords[0]
            };
        }
    }

    // Try LineString
    const lineMatch = /<LineString[^>]*>([\s\S]*?)<\/LineString>/i.exec(content);
    if (lineMatch) {
        const coords = parseCoordinateString(lineMatch[1]);
        if (coords.length > 0) {
            return {
                type: 'LineString',
                coordinates: coords
            };
        }
    }

    // Try LinearRing (used in Polygons)
    const ringMatch = /<LinearRing[^>]*>([\s\S]*?)<\/LinearRing>/i.exec(content);
    if (ringMatch) {
        const coords = parseCoordinateString(ringMatch[1]);
        if (coords.length > 0) {
            return {
                type: 'LinearRing',
                coordinates: coords
            };
        }
    }

    // Try Polygon
    const polygonMatch = /<Polygon[^>]*>([\s\S]*?)<\/Polygon>/i.exec(content);
    if (polygonMatch) {
        const polygonContent = polygonMatch[1];
        const rings: number[][][] = [];

        // Extract outer boundary (required)
        const outerMatch = /<outerBoundaryIs[^>]*>([\s\S]*?)<\/outerBoundaryIs>/i.exec(polygonContent);
        if (outerMatch) {
            const outerCoords = extractRingCoordinates(outerMatch[1]);
            if (outerCoords.length > 0) {
                rings.push(outerCoords);
            }
        }

        // Extract inner boundaries (holes, optional)
        const innerRegex = /<innerBoundaryIs[^>]*>([\s\S]*?)<\/innerBoundaryIs>/gi;
        let innerMatch: RegExpExecArray | null;
        while ((innerMatch = innerRegex.exec(polygonContent)) !== null) {
            const innerCoords = extractRingCoordinates(innerMatch[1]);
            if (innerCoords.length > 0) {
                rings.push(innerCoords);
            }
        }

        if (rings.length > 0) {
            return {
                type: 'Polygon',
                coordinates: rings
            };
        }
    }

    // Try MultiGeometry
    const multiMatch = /<MultiGeometry[^>]*>([\s\S]*?)<\/MultiGeometry>/i.exec(content);
    if (multiMatch) {
        // Recursively extract geometries from within MultiGeometry
        // For simplicity, we'll just take the first geometry found
        return extractGeometry(multiMatch[1]);
    }

    return undefined;
}

/**
 * Extracts ring coordinates from a LinearRing element content.
 */
function extractRingCoordinates(content: string): number[][] {
    const ringMatch = /<LinearRing[^>]*>([\s\S]*?)<\/LinearRing>/i.exec(content);
    if (ringMatch) {
        return parseCoordinateString(ringMatch[1]);
    }
    // Try direct coordinates
    return parseCoordinateString(content);
}

/**
 * Parses a KML coordinates string into an array of [lng, lat, elev] arrays.
 * KML format: "lng,lat,elev lng,lat,elev ..."
 */
function parseCoordinateString(content: string): number[][] {
    const coordMatch = /<coordinates[^>]*>([\s\S]*?)<\/coordinates>/i.exec(content);
    if (!coordMatch) {
        return [];
    }

    const coordText = coordMatch[1].trim();
    const coordinates: number[][] = [];

    // Split by whitespace (spaces, newlines, tabs)
    const parts = coordText.split(/\s+/);

    for (const part of parts) {
        if (!part.trim()) { continue; }

        const values = part.split(',').map(v => parseFloat(v.trim()));
        if (values.length >= 2 && !isNaN(values[0]) && !isNaN(values[1])) {
            // KML uses lng,lat order; GeoJSON also uses lng,lat order
            coordinates.push([values[0], values[1]]);
        }
    }

    return coordinates;
}

/**
 * Converts a KML Placemark to a GeoJSON Feature.
 */
function placemarkToFeature(placemark: KmlPlacemark): object | undefined {
    if (!placemark.geometry) {
        return undefined;
    }

    const geometry = convertGeometry(placemark.geometry);
    if (!geometry) {
        return undefined;
    }

    const properties: Record<string, string> = {};
    if (placemark.name) {
        properties.name = placemark.name;
    }
    if (placemark.description) {
        properties.description = placemark.description;
    }

    return {
        type: 'Feature',
        geometry,
        properties
    };
}

/**
 * Converts a KML geometry to a GeoJSON geometry object.
 */
function convertGeometry(kmlGeom: KmlGeometry): object | undefined {
    switch (kmlGeom.type) {
        case 'Point':
            return {
                type: 'Point',
                coordinates: kmlGeom.coordinates as number[]
            };
        case 'LineString':
            return {
                type: 'LineString',
                coordinates: kmlGeom.coordinates as number[][]
            };
        case 'LinearRing':
            // LinearRing in GeoJSON is represented as a Polygon with one ring
            return {
                type: 'Polygon',
                coordinates: [kmlGeom.coordinates as number[][]]
            };
        case 'Polygon':
            return {
                type: 'Polygon',
                coordinates: kmlGeom.coordinates as number[][][]
            };
        default:
            return undefined;
    }
}

/**
 * Decodes common XML entities in a string.
 */
function decodeXmlEntities(text: string): string {
    return text
        .replace(/&/g, '&')
        .replace(/</g, '<')
        .replace(/>/g, '>')
        .replace(/"/g, '"')
        .replace(/'/g, "'")
        .replace(/'/g, "'");
}
