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

interface CsvRow {
    values: string[];
    quoted: boolean[];
    lineNumber: number;
}

interface CsvParseResult {
    headers: string[];
    rows: CsvRow[];
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

    const headers = parseCsvLine(lines[0].line).values;
    if (headers.length < 2) {
        throw new Error('CSV file must have at least 2 columns');
    }

    const rows: CsvRow[] = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].line.trim();
        if (!line) {
            continue;
        }

        const parsed = parseCsvLine(line);
        if (parsed.values.length === 0) {
            continue;
        }
        rows.push({ values: parsed.values, quoted: parsed.quoted, lineNumber: lines[i].lineNumber });
    }

    if (rows.length === 0) {
        throw new Error('CSV file must have a header row and at least one data row');
    }

    return { headers, rows };
}

/**
 * Splits CSV text into records, treating newlines inside quoted fields as
 * part of the field rather than a record separator. \r\n, \n, and \r are
 * all treated as record separators outside quotes. Each record carries its
 * 1-based line number in the original text.
 */
function splitLines(text: string): { line: string; lineNumber: number }[] {
    const records: { line: string; lineNumber: number }[] = [];
    let current = '';
    let inQuotes = false;
    let lineNumber = 1;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];

        if (inQuotes) {
            if (char === '"' && text[i + 1] === '"') {
                current += '""';
                i++;
                continue;
            }
            if (char === '"') {
                inQuotes = false;
            }
            current += char;
            continue;
        }

        if (char === '"') {
            inQuotes = true;
            current += char;
        } else if (char === '\n') {
            records.push({ line: current, lineNumber });
            current = '';
            lineNumber++;
        } else if (char === '\r') {
            if (text[i + 1] === '\n') {
                i++;
            }
            records.push({ line: current, lineNumber });
            current = '';
            lineNumber++;
        } else {
            current += char;
        }
    }

    records.push({ line: current, lineNumber });
    return records;
}

/**
 * Parses a single CSV line, handling quoted fields.
 * Returns the field values and whether each value came from a quoted field.
 * Quoted fields keep their internal whitespace; unquoted fields are trimmed.
 */
function parseCsvLine(line: string): { values: string[]; quoted: boolean[] } {
    const values: string[] = [];
    const quoted: boolean[] = [];
    let current = '';
    let inQuotes = false;
    let wasQuoted = false;
    let i = 0;

    const pushValue = (): void => {
        values.push(wasQuoted ? current : current.trim());
        quoted.push(wasQuoted);
        current = '';
        wasQuoted = false;
    };

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
                wasQuoted = true;
            } else if (char === ',') {
                pushValue();
            } else {
                current += char;
            }
        }
        i++;
    }

    pushValue();
    return { values, quoted };
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

    const features: object[] = [];
    const errors: string[] = [];

    for (const row of parsed.rows) {
        const latStr = row.values[latIndex] || '';
        const lngStr = row.values[lngIndex] || '';

        const lat = parseFloat(latStr.replace(',', '.'));
        const lng = parseFloat(lngStr.replace(',', '.'));

        if (isNaN(lat) || isNaN(lng)) {
            errors.push(`Row ${row.lineNumber}: invalid coordinates (lat="${latStr}", lng="${lngStr}")`);
            continue;
        }

        if (lat < -90 || lat > 90) {
            errors.push(`Row ${row.lineNumber}: latitude out of range (${lat})`);
            continue;
        }

        if (lng < -180 || lng > 180) {
            errors.push(`Row ${row.lineNumber}: longitude out of range (${lng})`);
            continue;
        }

        // Build properties from all columns except lat/lng.
        // Quoted fields preserve their exact content; unquoted fields are trimmed.
        const properties: Record<string, string | number> = {};
        for (let j = 0; j < parsed.headers.length; j++) {
            if (j === latIndex || j === lngIndex) {
                continue;
            }
            const value = row.values[j] ?? '';
            const raw = row.quoted[j] ? value : value.trim();
            if (row.quoted[j]) {
                properties[parsed.headers[j]] = raw;
                continue;
            }
            if (raw) {
                // Try to parse as number
                const num = parseFloat(raw.replace(',', '.'));
                properties[parsed.headers[j]] = isNaN(num) ? raw : num;
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
