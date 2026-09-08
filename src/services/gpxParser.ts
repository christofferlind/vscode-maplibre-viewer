import * as fs from 'fs';

/**
 * Parses GPX XML content and converts it to a GeoJSON FeatureCollection.
 * Supports: waypoints (wpt), routes (rte), and tracks (trk).
 */

interface GpxPoint {
    lat: number;
    lon: number;
    ele?: number;
    name?: string;
    desc?: string;
    type?: string;
    time?: string;
}

/**
 * Parses a GPX file and converts it to a GeoJSON FeatureCollection.
 * @param filePath Absolute path to the .gpx file
 * @returns A GeoJSON FeatureCollection
 */
export function parseGpxFile(filePath: string): object {
    const content = fs.readFileSync(filePath, 'utf-8');
    return parseGpxContent(content);
}

/**
 * Parses GPX XML string content and converts to GeoJSON FeatureCollection.
 * @param content GPX XML string
 * @returns A GeoJSON FeatureCollection
 */
export function parseGpxContent(content: string): object {
    const features: object[] = [];

    // Extract waypoints
    const waypoints = extractWaypoints(content);
    for (const wpt of waypoints) {
        const properties: Record<string, unknown> = {};
        if (wpt.name) { properties.name = wpt.name; }
        if (wpt.ele !== undefined) { properties.elevation = wpt.ele; }
        if (wpt.desc) { properties.description = wpt.desc; }
        if (wpt.type) { properties.type = wpt.type; }
        if (wpt.time) { properties.time = wpt.time; }

        features.push({
            type: 'Feature',
            geometry: {
                type: 'Point',
                coordinates: [wpt.lon, wpt.lat]
            },
            properties
        });
    }

    // Extract routes
    const routes = extractRoutes(content);
    for (const route of routes) {
        if (route.points.length >= 2) {
            features.push({
                type: 'Feature',
                geometry: {
                    type: 'LineString',
                    coordinates: route.points.map(p => [p.lon, p.lat])
                },
                properties: {
                    name: route.name || 'Route',
                    type: 'route'
                }
            });
        } else if (route.points.length === 1) {
            features.push({
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: [route.points[0].lon, route.points[0].lat]
                },
                properties: {
                    name: route.name || 'Route',
                    type: 'route'
                }
            });
        }
    }

    // Extract tracks
    const tracks = extractTracks(content);
    for (const track of tracks) {
        if (track.segments.length > 0) {
            // Each track segment becomes a LineString
            for (let i = 0; i < track.segments.length; i++) {
                const segment = track.segments[i];
                if (segment.length >= 2) {
                    features.push({
                        type: 'Feature',
                        geometry: {
                            type: 'LineString',
                            coordinates: segment.map(p => [p.lon, p.lat])
                        },
                        properties: {
                            name: track.name ? `${track.name} (segment ${i + 1})` : `Track segment ${i + 1}`,
                            type: 'track'
                        }
                    });
                }
            }
        }
    }

    return {
        type: 'FeatureCollection',
        features
    };
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
    const offset = value - 0x10000;
    return String.fromCharCode(0xd800 + (offset >> 10), 0xdc00 + (offset & 0x3ff));
}

/**
 * Decodes XML entities in a string. Handles the five predefined XML entities,
 * &nbsp;, and numeric character references.
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

/**
 * Extracts text content of the first matching element, decoding entities and
 * stripping CDATA wrappers.
 */
function extractElementText(content: string, tagName: string): string | undefined {
    const match = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, 'i').exec(content);
    if (match) {
        return decodeXmlEntities(stripCdata(match[1].trim()));
    }
    return undefined;
}

/**
 * Parses a lat/lon attribute pair from a point element opening tag.
 * Accepts lat and lon in any order, and both double and single quotes.
 * @returns The parsed point or undefined when attributes are missing/invalid
 */
function parsePointAttributes(tag: string): { lat: number; lon: number } | undefined {
    const latMatch = /lat\s*=\s*("([^"]*)"|'([^']*)')/i.exec(tag);
    const lonMatch = /lon\s*=\s*("([^"]*)"\s*|'([^']*)')/i.exec(tag);
    if (!latMatch || !lonMatch) {
        return undefined;
    }
    const lat = parseFloat(latMatch[2] ?? latMatch[3]);
    const lon = parseFloat(lonMatch[2] ?? lonMatch[3]);
    if (isNaN(lat) || isNaN(lon)) {
        return undefined;
    }
    return { lat, lon };
}

/**
 * Extracts waypoints (wpt elements) from GPX content.
 */
function extractWaypoints(content: string): GpxPoint[] {
    const points: GpxPoint[] = [];

    // Strip <trkpt>/<rtept> blocks first so a <wpt> prefix match cannot
    // consume them (the old `<wpt\s` regex overmatched nothing, but the
    // attribute scan below must only see real waypoints).
    const wptBlockRegex = /<wpt(?=[\s/>])[^>]*?(?:\/>|>([\s\S]*?)<\/wpt>)/gi;
    let match: RegExpExecArray | null;

    while ((match = wptBlockRegex.exec(content)) !== null) {
        const attrs = parsePointAttributes(match[0]);
        if (!attrs) {
            continue;
        }

        const innerContent = match[1] ?? '';
        const point: GpxPoint = { lat: attrs.lat, lon: attrs.lon };

        // Extract elevation
        const eleMatch = /<ele[^>]*>([\s\S]*?)<\/ele>/i.exec(innerContent);
        if (eleMatch) {
            const ele = parseFloat(eleMatch[1].trim());
            if (!isNaN(ele)) {
                point.ele = ele;
            }
        }

        point.name = extractElementText(innerContent, 'name');
        point.desc = extractElementText(innerContent, 'desc');
        point.type = extractElementText(innerContent, 'type');
        point.time = extractElementText(innerContent, 'time');

        points.push(point);
    }

    return points;
}

/**
 * Extracts routes (rte elements) from GPX content.
 */
function extractRoutes(content: string): GpxRoute[] {
    const routes: GpxRoute[] = [];

    // Match the exact element name so <rtept>/<rteXXX> cannot be consumed as
    // a route opening tag.
    const rteRegex = /<rte(?=[\s/>])[^>]*>([\s\S]*?)<\/rte>/gi;
    let match: RegExpExecArray | null;

    while ((match = rteRegex.exec(content)) !== null) {
        const rteContent = match[1];
        const route: GpxRoute = { points: [] };

        route.name = extractElementText(rteContent, 'name');

        // Extract route points (rtept) - handle both self-closing and regular tags
        const rteptRegex = /<rtept(?=[\s/>])[^>]*?(?:\/>|>[\s\S]*?<\/rtept>)/gi;
        let ptMatch: RegExpExecArray | null;
        while ((ptMatch = rteptRegex.exec(rteContent)) !== null) {
            const attrs = parsePointAttributes(ptMatch[0]);
            if (attrs) {
                route.points.push(attrs);
            }
        }

        if (route.points.length > 0) {
            routes.push(route);
        }
    }

    return routes;
}

/**
 * Extracts tracks (trk elements) from GPX content.
 */
function extractTracks(content: string): GpxTrack[] {
    const tracks: GpxTrack[] = [];

    // Match the exact element name so <trkpt>/<trkseg> cannot be consumed as
    // a track opening tag (which fabricated spurious tracks with duplicated
    // segments when track points appeared before a track).
    const trkRegex = /<trk(?=[\s/>])[^>]*>([\s\S]*?)<\/trk>/gi;
    let match: RegExpExecArray | null;

    while ((match = trkRegex.exec(content)) !== null) {
        const trkContent = match[1];
        const track: GpxTrack = { segments: [] };

        track.name = extractElementText(trkContent, 'name');

        // Extract track segments (trkseg)
        const trksegRegex = /<trkseg(?=[\s/>])[^>]*>([\s\S]*?)<\/trkseg>/gi;
        let segMatch: RegExpExecArray | null;
        while ((segMatch = trksegRegex.exec(trkContent)) !== null) {
            const segContent = segMatch[1];
            const points: GpxPoint[] = [];

            // Extract track points (trkpt) - handle both self-closing and regular tags
            const trkptRegex = /<trkpt(?=[\s/>])[^>]*?(?:\/>|>[\s\S]*?<\/trkpt>)/gi;
            let ptMatch: RegExpExecArray | null;
            while ((ptMatch = trkptRegex.exec(segContent)) !== null) {
                const attrs = parsePointAttributes(ptMatch[0]);
                if (attrs) {
                    points.push({ lat: attrs.lat, lon: attrs.lon });
                }
            }

            if (points.length > 0) {
                track.segments.push(points);
            }
        }

        if (track.segments.length > 0) {
            tracks.push(track);
        }
    }

    return tracks;
}

interface GpxRoute {
    name?: string;
    points: GpxPoint[];
}

interface GpxTrack {
    name?: string;
    segments: GpxPoint[][];
}