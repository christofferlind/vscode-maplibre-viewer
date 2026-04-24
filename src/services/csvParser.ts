import * as fs from 'fs';
import * as path from 'path';

/**
 * Parses CSV files with latitude/longitude columns and converts to GeoJSON FeatureCollection.
 * Auto-detects column names for latitude and longitude.
 */

// Common column name variations for latitude and longitude
const LATITUDE_NAMES = new Set([
    'lat', 'latitude', 'latitud', 'y', 'ycoord', 'y_coord', 'ycoordinated',
    'north', 'northing', 'northings'
]);

const LONGITUDE_NAMES = new Set([
    'lng', 'lon', 'long', 'longitude', 'x', 'xcoord', 'x_coord', 'xcoordinated',
    'east', 'easting', 'eastings'
]);

interface CsvParseResult {
    headers: string[];
    rows: Record<string, string>[];
}

/**
 * Parses a CSV file and converts it to a GeoJSON FeatureCollection.
 * @param filePath Absolute path to the .csv file
 * @returns A GeoJSON FeatureCollection
 * @throws Error if lat/lng columns cannot be detected
 */
export function parseCsvFile(filePath: string): object {
    const content = fs.readFileSync(filePath, 'utf-8');
    return parseCsvContent(content, path.basename(filePath));
}

/**
 * Parses CSV string content and converts to GeoJSON FeatureCollection.
 * @param content CSV string content
 * @param fileName Optional filename for error messages
 * @returns A GeoJSON FeatureCollection
 * @throws Error if lat/lng columns cannot be detected
 */
export function parseCsvContent(content: string, fileName?: string): object {
    const parsed = parseCsv(content);
    return convertToGeoJson(parsed, fileName);
}

/**
 * Parses raw CSV text into headers and rows.
 * Handles quoted fields, commas within quotes, and various line endings.
 */
function parseCsv(text: string): CsvParseResult {
    const lines = splitLines(text);
    if (lines.length < 2) {
        throw new Error('CSV file must have a header row and at least one data row');
    }

    const headers = parseCsvLine(lines[0]);
    if (headers.length < 2) {
        throw new Error('CSV file must have at least 2 columns');
    }

    const rows: Record<string, string>[] = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) { continue; } // Skip empty lines

        const values = parseCsvLine(line);
        if (values.length === 0) { continue; }
        const row: Record<string, string> = {};
        for (let j = 0; j < headers.length; j++) {
            row[headers[j]] = j < values.length ? values[j] : '';
        }
        rows.push(row);
    }

    return { headers, rows };
}

/**
 * Splits CSV text into individual lines, handling various line endings.
 */
function splitLines(text: string): string[] {
    // Normalize line endings
    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    return normalized.split('\n');
}

/**
 * Parses a single CSV line, handling quoted fields.
 */
function parseCsvLine(line: string): string[] {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;
    let i = 0;

    while (i < line.length) {
        const char = line[i];

        if (inQuotes) {
            if (char === '"') {
                // Check for escaped quote ("")
                if (i + 1 < line.length && line[i + 1] === '"') {
                    current += '"';
                    i += 2;
                    continue;
                }
                inQuotes = false;
            } else {
                current += char;
            }
        } else {
            if (char === '"') {
                inQuotes = true;
            } else if (char === ',') {
                values.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        i++;
    }

    values.push(current.trim());
    return values;
}

/**
 * Detects the latitude and longitude column indices from headers.
 * @returns [latIndex, lngIndex] or throws if not found
 */
function detectCoordinateColumns(headers: string[]): [number, number] {
    let latIndex = -1;
    let lngIndex = -1;

    for (let i = 0; i < headers.length; i++) {
        const header = headers[i].toLowerCase().trim();
        if (LATITUDE_NAMES.has(header)) {
            latIndex = i;
        }
        if (LONGITUDE_NAMES.has(header)) {
            lngIndex = i;
        }
    }

    if (latIndex === -1 || lngIndex === -1) {
        const headerList = headers.map((h, i) => `"${h}" (column ${i + 1})`).join(', ');
        throw new Error(
            `Could not detect latitude/longitude columns. Found columns: ${headerList}. ` +
            'Expected column names like: lat, latitude, lng, lon, longitude'
        );
    }

    return [latIndex, lngIndex];
}

/**
 * Converts parsed CSV data to a GeoJSON FeatureCollection.
 */
function convertToGeoJson(parsed: CsvParseResult, fileName?: string): object {
    const [latIndex, lngIndex] = detectCoordinateColumns(parsed.headers);
    const latHeader = parsed.headers[latIndex];
    const lngHeader = parsed.headers[lngIndex];

    const features: object[] = [];
    const errors: string[] = [];

    for (let i = 0; i < parsed.rows.length; i++) {
        const row = parsed.rows[i];
        const latStr = row[latHeader] || '';
        const lngStr = row[lngHeader] || '';

        const lat = parseFloat(latStr.replace(',', '.'));
        const lng = parseFloat(lngStr.replace(',', '.'));

        if (isNaN(lat) || isNaN(lng)) {
            errors.push(`Row ${i + 2}: invalid coordinates (lat="${latStr}", lng="${lngStr}")`);
            continue;
        }

        if (lat < -90 || lat > 90) {
            errors.push(`Row ${i + 2}: latitude out of range (${lat})`);
            continue;
        }

        if (lng < -180 || lng > 180) {
            errors.push(`Row ${i + 2}: longitude out of range (${lng})`);
            continue;
        }

        // Build properties from all columns except lat/lng
        const properties: Record<string, string | number> = {};
        for (const [key, value] of Object.entries(row)) {
            if (key !== latHeader && key !== lngHeader) {
                const trimmed = value.trim();
                if (trimmed) {
                    // Try to parse as number
                    const num = parseFloat(trimmed.replace(',', '.'));
                    properties[key] = isNaN(num) ? trimmed : num;
                }
            }
        }

        features.push({
            type: 'Feature',
            geometry: {
                type: 'Point',
                coordinates: [lng, lat]
            },
            properties
        });
    }

    // Log parsing errors but don't fail entirely
    if (errors.length > 0 && features.length === 0) {
        throw new Error(
            `Failed to parse any valid coordinates from CSV. Errors:\n${errors.slice(0, 5).join('\n')}` +
            (errors.length > 5 ? `\n...and ${errors.length - 5} more errors` : '')
        );
    }

    if (errors.length > 0) {
        console.warn(`CSV parsing warnings for ${fileName || 'file'}:`, errors);
    }

    return {
        type: 'FeatureCollection',
        features
    };
}
