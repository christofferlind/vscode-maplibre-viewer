/**
 * WKT (Well-Known Text) geometry parser.
 *
 * Converts WKT geometry text into GeoJSON geometry objects so selected
 * WKT text can be rendered on the map. Supports the standard geometry
 * types: Point, LineString, Polygon, MultiPoint, MultiLineString,
 * MultiPolygon and GeometryCollection.
 */

export interface WktParseResult {
    geojson: object;
    geometryCount: number;
}

type GeometryMap = Record<string, unknown>;

const WKT_KEYWORD_REGEX = /^(POINT|LINESTRING|POLYGON|MULTIPOINT|MULTILINESTRING|MULTIPOLYGON|GEOMETRYCOLLECTION)\s*(Z|M|ZM)?\s*\(/i;

/**
 * Checks whether the given text looks like WKT geometry.
 * Detection is intentionally permissive: it only requires the text to
 * start with a known WKT geometry type keyword.
 *
 * @param text - The text to inspect
 * @returns True if the text starts with a WKT geometry keyword
 */
export function isWktText(text: string): boolean {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
        return false;
    }
    return WKT_KEYWORD_REGEX.test(trimmed);
}

/**
 * Parses WKT text into a GeoJSON FeatureCollection. When the text contains
 * multiple geometries (separated by top-level commas, or wrapped in a
 * GeometryCollection) each becomes a feature in the collection.
 *
 * @param text - The WKT text to parse
 * @returns A WktParseResult with the GeoJSON and geometry count
 * @throws Error when the text contains no parseable WKT geometry
 */
export function parseWktToGeoJson(text: string): WktParseResult {
    const geometries = parseGeometryList(text.trim());
    if (geometries.length === 0) {
        throw new Error('No valid WKT geometry found in selection');
    }
    const features = geometries.map((geometry) => ({
        type: 'Feature',
        properties: {},
        geometry
    }));
    return {
        geojson: { type: 'FeatureCollection', features },
        geometryCount: geometries.length
    };
}

/**
 * Splits text on commas that are not nested inside parentheses.
 */
function splitTopLevel(text: string): string[] {
    const chunks: string[] = [];
    let current = '';
    let depth = 0;
    for (const char of text) {
        if (char === '(') {
            depth++;
        } else if (char === ')') {
            depth--;
        } else if (char === ',' && depth === 0) {
            chunks.push(current);
            current = '';
            continue;
        }
        current += char;
    }
    chunks.push(current);
    return chunks;
}

/**
 * Parses a list of WKT geometries separated by top-level commas, newlines
 * or other whitespace between complete geometries. A GEOMETRYCOLLECTION is
 * flattened into its member geometries.
 */
function parseGeometryList(text: string): GeometryMap[] {
    const geometries: GeometryMap[] = [];
    for (const chunk of splitGeometrySegments(text)) {
        const geometry = parseGeometry(chunk.trim());
        if (geometry) {
            if (isGeometryCollection(geometry)) {
                geometries.push(...(geometry.geometries as GeometryMap[]));
            } else {
                geometries.push(geometry);
            }
        }
    }
    return geometries;
}

/**
 * Splits text into individual geometry strings. Geometries may be separated
 * by top-level commas, newlines or whitespace. Splitting happens at the
 * start of each WKT geometry keyword that occurs at parenthesis depth 0,
 * so geometry-internal commas and nested keywords (e.g. POINT inside a
 * MULTIPOINT or GEOMETRYCOLLECTION) never cause a split.
 */
function splitGeometrySegments(text: string): string[] {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
        return [];
    }
    const segments: string[] = [];
    let depth = 0;
    let start = 0;
    const keywordRegex = /\b(POINT|LINESTRING|POLYGON|MULTIPOINT|MULTILINESTRING|MULTIPOLYGON|GEOMETRYCOLLECTION)\b/gi;
    let match: RegExpExecArray | null;
    while ((match = keywordRegex.exec(trimmed)) !== null) {
        if (depth > 0) {
            continue;
        }
        if (match.index > start) {
            segments.push(trimmed.slice(start, match.index));
        }
        start = match.index;
    }
    segments.push(trimmed.slice(start));
    return segments;
}

function isGeometryCollection(geometry: GeometryMap): boolean {
    return geometry.type === 'GeometryCollection' && Array.isArray(geometry.geometries);
}

/**
 * Parses a single WKT geometry string like "POLYGON ((...))" into a
 * GeoJSON geometry object. Returns null when the text is not a
 * recognized WKT geometry.
 */
function parseGeometry(text: string): GeometryMap | null {
    const match = WKT_KEYWORD_REGEX.exec(text);
    if (!match) {
        return null;
    }
    const kind = match[1].toUpperCase();
    // The keyword match already consumed the opening paren, so start
    // scanning one character before the end of the match.
    const body = extractParenthesizedBody(text, match[0].length - 1);
    if (body === null) {
        return null;
    }

    switch (kind) {
        case 'POINT':
            return pointGeometry(body);
        case 'LINESTRING':
            return lineStringGeometry(body);
        case 'POLYGON':
            return polygonGeometry(body);
        case 'MULTIPOINT':
            return multiPointGeometry(body);
        case 'MULTILINESTRING':
            return multiLineStringGeometry(body);
        case 'MULTIPOLYGON':
            return multiPolygonGeometry(body);
        case 'GEOMETRYCOLLECTION':
            return { type: 'GeometryCollection', geometries: parseGeometryList(body) };
        default:
            return null;
    }
}

/**
 * Extracts the content between the outermost parentheses starting at
 * the given offset in the text.
 */
function extractParenthesizedBody(text: string, openParenIndex: number): string | null {
    let depth = 0;
    let start = -1;
    for (let i = openParenIndex; i < text.length; i++) {
        const char = text[i];
        if (char === '(') {
            depth++;
            if (depth === 1) {
                start = i + 1;
            }
        } else if (char === ')') {
            depth--;
            if (depth === 0 && start !== -1) {
                return text.slice(start, i);
            }
        }
    }
    return null;
}

function pointGeometry(body: string): GeometryMap | null {
    const coord = parseCoordinateTuple(body);
    if (!coord) {
        return null;
    }
    return { type: 'Point', coordinates: coord };
}

function lineStringGeometry(body: string): GeometryMap | null {
    const coords = parseCoordinateList(body);
    if (coords.length === 0) {
        return null;
    }
    return { type: 'LineString', coordinates: coords };
}

function polygonGeometry(body: string): GeometryMap | null {
    const rings = parseRingList(body);
    if (rings.length === 0) {
        return null;
    }
    return { type: 'Polygon', coordinates: rings };
}

function multiPointGeometry(body: string): GeometryMap | null {
    const coords = parseCoordinateList(body);
    if (coords.length === 0) {
        return null;
    }
    return { type: 'MultiPoint', coordinates: coords };
}

function multiLineStringGeometry(body: string): GeometryMap | null {
    const lines = parseRingList(body);
    if (lines.length === 0) {
        return null;
    }
    return { type: 'MultiLineString', coordinates: lines };
}

function multiPolygonGeometry(body: string): GeometryMap | null {
    const polygons: number[][][][] = [];
    for (const chunk of splitTopLevel(stripEnclosingParens(body))) {
        const rings = parseRingList(chunk.trim());
        if (rings.length > 0) {
            polygons.push(rings);
        }
    }
    if (polygons.length === 0) {
        return null;
    }
    return { type: 'MultiPolygon', coordinates: polygons };
}

/**
 * Parses "(ring), (ring), ..." into arrays of [lng, lat] pairs.
 */
function parseRingList(text: string): number[][][] {
    const rings: number[][][] = [];
    for (const chunk of splitTopLevel(text)) {
        const coords = parseCoordinateList(chunk.trim());
        if (coords.length > 0) {
            rings.push(coords);
        }
    }
    return rings;
}

/**
 * Parses "lon lat, lon lat, ..." or "(lon lat), (lon lat)" lists into
 * [lng, lat] pairs. Extra Z/M/ZM values in each tuple are ignored.
 */
function parseCoordinateList(text: string): number[][] {
    const coords: number[][] = [];
    for (const chunk of splitTopLevel(stripAllEnclosingParens(text))) {
        const coord = parseCoordinateTuple(chunk.trim());
        if (coord) {
            coords.push(coord);
        }
    }
    return coords;
}

/**
 * Removes one matching pair of parentheses that wraps the whole text so
 * comma-separated members inside a single parenthesized group become
 * top-level chunks.
 */
function stripEnclosingParens(text: string): string {
    const trimmed = text.trim();
    if (!trimmed.startsWith('(') || !trimmed.endsWith(')')) {
        return trimmed;
    }
    let depth = 0;
    for (let i = 0; i < trimmed.length; i++) {
        const char = trimmed[i];
        if (char === '(') {
            depth++;
        } else if (char === ')') {
            depth--;
            if (depth === 0 && i < trimmed.length - 1) {
                return trimmed;
            }
        }
    }
    return trimmed.slice(1, -1);
}

/**
 * Removes all nested matching pairs of parentheses that wrap the whole
 * text, so "((0 0, 1 0))" becomes "0 0, 1 0". Stops at the first
 * non-parenthesized character.
 */
function stripAllEnclosingParens(text: string): string {
    let current = text;
    let previous = '';
    while (current !== previous) {
        previous = current;
        current = stripEnclosingParens(current);
    }
    return current;
}

/**
 * Parses a single "(lon lat ...)" or "lon lat ..." tuple into [lng, lat].
 * Longitude is the first value per WKT/GeoJSON ordering.
 */
function parseCoordinateTuple(text: string): number[] | null {
    let cleaned = text.trim();
    if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
        cleaned = cleaned.slice(1, -1).trim();
    }
    // Drop a POINT keyword from "MULTIPOINT (POINT (1 2))" spellings and
    // EMPTY markers so the numeric parser only sees values.
    cleaned = cleaned.replace(/^POINT\s*(Z|M|ZM)?\s*/i, '').replace(/EMPTY/gi, '').trim();
    if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
        cleaned = cleaned.slice(1, -1).trim();
    }
    // A chunk may still contain several "lon lat" tuples after unwrapping
    // (e.g. a ring "(0 0, 1 0, ...)" reaching the tuple parser); take the
    // first tuple only.
    cleaned = cleaned.split(',')[0].trim();
    const numbers = cleaned.split(/\s+/).filter((part) => part.length > 0).map(Number);
    if (numbers.length < 2 || !Number.isFinite(numbers[0]) || !Number.isFinite(numbers[1])) {
        return null;
    }
    const [lng, lat] = numbers;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        return null;
    }
    return [lng, lat];
}