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
    // For MultiGeometry: list of nested geometries
    geometries?: KmlGeometry[];
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

    // Some GIS exporters namespace-prefix every element
    // (e.g. <kml:Placemark>); strip the prefixes so the element regexes match.
    const normalized = content.replace(/<([a-zA-Z0-9_]+):([a-zA-Z0-9_]+)/g, '<$2')
        .replace(/<\/([a-zA-Z0-9_]+):([a-zA-Z0-9_]+)/g, '</$2');

    // Extract all Placemark elements using simple string parsing
    const placemarks = extractPlacemarks(normalized);

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
        if (placemark.geometry || placemark.name || placemark.description) {
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
        placemark.name = decodeXmlEntities(stripCdata(nameMatch[1].trim()));
    }

    // Extract description
    const descMatch = /<description[^>]*>([\s\S]*?)<\/description>/i.exec(content);
    if (descMatch) {
        placemark.description = decodeXmlEntities(stripCdata(descMatch[1].trim()));
    }

    // Extract geometry
    placemark.geometry = extractGeometry(content);

    return placemark;
}

/**
 * Extracts geometry from a Placemark content string.
 * Supports Point, LineString, Polygon, and MultiGeometry.
 */
/**
 * Finds the outermost MultiGeometry block, tolerating nested MultiGeometry
 * elements by counting open/close tags instead of relying on a non-greedy
 * regex (which would stop at the first nested closing tag).
 * @returns The inner content of the outermost MultiGeometry, or undefined
 */
function extractOuterMultiGeometryContent(content: string): string | undefined {
    const openRegex = /<MultiGeometry[^>]*>/gi;
    let depth = 0;
    let innerStart = -1;

    const tokenRegex = /<(\/?)MultiGeometry[^>]*>/gi;
    let token: RegExpExecArray | null;
    while ((token = tokenRegex.exec(content)) !== null) {
        if (token[1] === '/') {
            depth--;
            if (depth === 0) {
                return content.substring(innerStart, token.index);
            }
        } else {
            if (depth === 0) {
                innerStart = token.index + token[0].length;
            }
            depth++;
        }
    }
    return undefined;
}

function extractGeometry(content: string): KmlGeometry | undefined {
    // Try MultiGeometry first so contained primitives are not mistaken for
    // the placemark's own geometry.
    const multiInner = extractOuterMultiGeometryContent(content);
    if (multiInner !== undefined) {
        // Extract every contained geometry so valid KML is not silently
        // reduced to its first child.
        const geometries = extractAllGeometries(multiInner);
        if (geometries.length > 0) {
            return {
                type: 'MultiGeometry',
                coordinates: [],
                geometries
            };
        }
    }

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

    // Try Polygon before LinearRing so real polygons keep their holes
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

    // Try standalone LinearRing (e.g. inside MultiGeometry without a Polygon wrapper)
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

    return undefined;
}

/**
 * Removes all MultiGeometry blocks (tolerating nesting) from the content,
 * collecting each outermost block's parsed geometries into the target array.
 */
function removeNestedMultiGeometry(content: string, target: KmlGeometry[]): string {
    let result = '';
    let index = 0;

    while (index < content.length) {
        const openMatch = /<MultiGeometry[^>]*>/i.exec(content.slice(index));
        if (!openMatch) {
            result += content.slice(index);
            break;
        }
        const openStart = index + openMatch.index;
        result += content.slice(index, openStart);

        // Scan forward for the matching close tag, accounting for nesting
        const tokenRegex = /<(\/?)MultiGeometry[^>]*>/gi;
        tokenRegex.lastIndex = openStart + openMatch[0].length;
        let depth = 1;
        let closeEnd = -1;
        let token: RegExpExecArray | null;
        while ((token = tokenRegex.exec(content)) !== null) {
            if (token[1] === '/') {
                depth--;
                if (depth === 0) {
                    closeEnd = token.index + token[0].length;
                    break;
                }
            } else {
                depth++;
            }
        }

        if (closeEnd === -1) {
            // Unbalanced markup: treat the rest as plain content
            result += content.slice(openStart);
            break;
        }

        const inner = content.substring(openStart + openMatch[0].length, closeEnd - '</MultiGeometry>'.length);
        const nested = extractAllGeometries(inner);
        if (nested.length > 0) {
            target.push({
                type: 'GeometryCollection',
                coordinates: [],
                geometries: nested
            });
        }
        index = closeEnd;
    }

    return result;
}

/**
 * Extracts all top-level geometries from MultiGeometry content.
 * Nested MultiGeometry elements recurse into a GeometryCollection.
 */
function extractAllGeometries(content: string): KmlGeometry[] {
    const geometries: KmlGeometry[] = [];

    // Remove nested MultiGeometry blocks first so they can be collected
    // without their inner primitives being double-counted.
    const nestedMulti: KmlGeometry[] = [];
    const contentWithoutMulti = removeNestedMultiGeometry(content, nestedMulti);

    const pointMatch = /<Point[^>]*>([\s\S]*?)<\/Point>/i.exec(contentWithoutMulti);
    if (pointMatch) {
        const coords = parseCoordinateString(pointMatch[1]);
        if (coords.length > 0) {
            geometries.push({ type: 'Point', coordinates: coords[0] });
        }
    }

    const lineMatch = /<LineString[^>]*>([\s\S]*?)<\/LineString>/i.exec(contentWithoutMulti);
    if (lineMatch) {
        const coords = parseCoordinateString(lineMatch[1]);
        if (coords.length > 0) {
            geometries.push({ type: 'LineString', coordinates: coords });
        }
    }

    const polygonRegex = /<Polygon[^>]*>([\s\S]*?)<\/Polygon>/gi;
    let polygonMatch: RegExpExecArray | null;
    while ((polygonMatch = polygonRegex.exec(contentWithoutMulti)) !== null) {
        const polygon = extractPolygonRings(polygonMatch[1]);
        if (polygon) {
            geometries.push(polygon);
        }
    }

    // Standalone LinearRings (not already consumed as polygon boundaries)
    const contentWithoutPolygons = contentWithoutMulti.replace(/<Polygon[^>]*>[\s\S]*?<\/Polygon>/gi, '');
    const ringRegex = /<LinearRing[^>]*>([\s\S]*?)<\/LinearRing>/gi;
    let ringMatch: RegExpExecArray | null;
    while ((ringMatch = ringRegex.exec(contentWithoutPolygons)) !== null) {
        const coords = parseCoordinateString(ringMatch[1]);
        if (coords.length > 0) {
            geometries.push({ type: 'LinearRing', coordinates: coords });
        }
    }

    geometries.push(...nestedMulti);
    return geometries;
}

/**
 * Extracts outer/inner rings from Polygon element content.
 */
function extractPolygonRings(polygonContent: string): KmlGeometry | undefined {
    const rings: number[][][] = [];

    const outerMatch = /<outerBoundaryIs[^>]*>([\s\S]*?)<\/outerBoundaryIs>/i.exec(polygonContent);
    if (outerMatch) {
        const outerCoords = extractRingCoordinates(outerMatch[1]);
        if (outerCoords.length > 0) {
            rings.push(outerCoords);
        }
    }

    const innerRegex = /<innerBoundaryIs[^>]*>([\s\S]*?)<\/innerBoundaryIs>/gi;
    let innerMatch: RegExpExecArray | null;
    while ((innerMatch = innerRegex.exec(polygonContent)) !== null) {
        const innerCoords = extractRingCoordinates(innerMatch[1]);
        if (innerCoords.length > 0) {
            rings.push(innerCoords);
        }
    }

    if (rings.length > 0) {
        return { type: 'Polygon', coordinates: rings };
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
            if (values.length >= 3 && !isNaN(values[2])) {
                coordinates.push([values[0], values[1], values[2]]);
            } else {
                coordinates.push([values[0], values[1]]);
            }
        }
    }

    return coordinates;
}

/**
 * Converts a KML Placemark to a GeoJSON Feature.
 */
function placemarkToFeature(placemark: KmlPlacemark): object | undefined {
    const geometry = placemark.geometry ? convertGeometry(placemark.geometry) : undefined;
    if (!geometry && !placemark.name && !placemark.description) {
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
        case 'GeometryCollection':
        case 'MultiGeometry':
            return {
                type: 'GeometryCollection',
                geometries: (kmlGeom.geometries ?? [])
                    .map(convertGeometry)
                    .filter((g): g is object => g !== undefined)
            };
        default:
            return undefined;
    }
}

/**
 * Strips a CDATA wrapper if present, returning the raw inner text.
 */
function stripCdata(text: string): string {
    const cdataMatch = /^<!\[CDATA\[([\s\S]*?)\]\]>$/i.exec(text.trim());
    if (cdataMatch) {
        return cdataMatch[1];
    }
    return text;
}

/**
 * Decodes a single numeric character reference into a proper string,
 * handling astral-plane code points via surrogate pairs.
 */
function fromCodePoint(value: number): string {
    if (!Number.isFinite(value) || value < 0 || value > 0x10ffff) {
        return '';
    }
    if (value <= 0xffff) {
        return String.fromCharCode(value);
    }
    value -= 0x10000;
    return String.fromCharCode(0xd800 + (value >> 10), 0xdc00 + (value & 0x3ff));
}

/**
 * Decodes common XML entities in a string.
 * Handles the five predefined XML entities, common named HTML entities found
 * in KML descriptions, and numeric character references.
 * &amp; is decoded last so doubly-escaped sequences like &amp;lt; stay as &lt;.
 */
function decodeXmlEntities(text: string): string {
    return text
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#x([0-9a-fA-F]+);/g, (_match, hex) => fromCodePoint(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_match, dec) => fromCodePoint(parseInt(dec, 10)))
        .replace(/&amp;/g, '&');
}
