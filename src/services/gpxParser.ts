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
    if (waypoints.length > 0) {
        features.push({
            type: 'Feature',
            geometry: {
                type: 'MultiPoint',
                coordinates: waypoints.map(w => [w.lon, w.lat])
            },
            properties: {
                name: 'Waypoints',
                count: waypoints.length
            }
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
 * Extracts waypoints (wpt elements) from GPX content.
 */
function extractWaypoints(content: string): GpxPoint[] {
    const points: GpxPoint[] = [];
    const wptRegex = /<wpt\s+lat="([^"]*)"\s+lon="([^"]*)"[^>]*>([\s\S]*?)<\/wpt>/gi;
    let match: RegExpExecArray | null;

    while ((match = wptRegex.exec(content)) !== null) {
        const lat = parseFloat(match[1]);
        const lon = parseFloat(match[2]);

        if (isNaN(lat) || isNaN(lon)) { continue; }

        const innerContent = match[3];
        const point: GpxPoint = { lat, lon };

        // Extract elevation
        const eleMatch = /<ele[^>]*>([\s\S]*?)<\/ele>/i.exec(innerContent);
        if (eleMatch) {
            point.ele = parseFloat(eleMatch[1].trim());
        }

        // Extract name
        const nameMatch = /<name[^>]*>([\s\S]*?)<\/name>/i.exec(innerContent);
        if (nameMatch) {
            point.name = nameMatch[1].trim();
        }

        // Extract description
        const descMatch = /<desc[^>]*>([\s\S]*?)<\/desc>/i.exec(innerContent);
        if (descMatch) {
            point.desc = descMatch[1].trim();
        }

        // Extract type
        const typeMatch = /<type[^>]*>([\s\S]*?)<\/type>/i.exec(innerContent);
        if (typeMatch) {
            point.type = typeMatch[1].trim();
        }

        // Extract time
        const timeMatch = /<time[^>]*>([\s\S]*?)<\/time>/i.exec(innerContent);
        if (timeMatch) {
            point.time = timeMatch[1].trim();
        }

        points.push(point);
    }

    return points;
}

/**
 * Extracts routes (rte elements) from GPX content.
 */
function extractRoutes(content: string): GpxRoute[] {
    const routes: GpxRoute[] = [];
    const rteRegex = /<rte[^>]*>([\s\S]*?)<\/rte>/gi;
    let match: RegExpExecArray | null;

    while ((match = rteRegex.exec(content)) !== null) {
        const rteContent = match[1];
        const route: GpxRoute = { points: [] };

        // Extract route name
        const nameMatch = /<name[^>]*>([\s\S]*?)<\/name>/i.exec(rteContent);
        if (nameMatch) {
            route.name = nameMatch[1].trim();
        }

        // Extract route points (rtept) - handle both self-closing and regular tags
        const rteptRegex = /<rtept\s+lat="([^"]*)"\s+lon="([^"]*)"[^>]*\/?>/gi;
        let ptMatch: RegExpExecArray | null;
        while ((ptMatch = rteptRegex.exec(rteContent)) !== null) {
            const lat = parseFloat(ptMatch[1]);
            const lon = parseFloat(ptMatch[2]);
            if (!isNaN(lat) && !isNaN(lon)) {
                route.points.push({ lat, lon });
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
    const trkRegex = /<trk[^>]*>([\s\S]*?)<\/trk>/gi;
    let match: RegExpExecArray | null;

    while ((match = trkRegex.exec(content)) !== null) {
        const trkContent = match[1];
        const track: GpxTrack = { segments: [] };

        // Extract track name
        const nameMatch = /<name[^>]*>([\s\S]*?)<\/name>/i.exec(trkContent);
        if (nameMatch) {
            track.name = nameMatch[1].trim();
        }

        // Extract track segments (trkseg)
        const trksegRegex = /<trkseg[^>]*>([\s\S]*?)<\/trkseg>/gi;
        let segMatch: RegExpExecArray | null;
        while ((segMatch = trksegRegex.exec(trkContent)) !== null) {
            const segContent = segMatch[1];
            const points: GpxPoint[] = [];

            // Extract track points (trkpt) - handle both self-closing and regular tags
            const trkptRegex = /<trkpt\s+lat="([^"]*)"\s+lon="([^"]*)"[^>]*\/?>/gi;
            let ptMatch: RegExpExecArray | null;
            while ((ptMatch = trkptRegex.exec(segContent)) !== null) {
                const lat = parseFloat(ptMatch[1]);
                const lon = parseFloat(ptMatch[2]);
                if (!isNaN(lat) && !isNaN(lon)) {
                    points.push({ lat, lon });
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
