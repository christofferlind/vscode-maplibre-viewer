import * as assert from 'assert';
import {
    parseCoordinate,
    parseMultipleCoordinates,
    getCoordinatePatterns,
    addCoordinatePattern,
    clearCustomPatterns,
    findCoordinatesRegex,
    calculateBoundingBox,
    calculateBoundingBoxFromGeoJson,
    extractCoordinatesFromGeoJson,
    formatCoordinates,
    formatViewState,
    regexDMS,
    regexWGS84,
    regexGeoJSON,
    regexXmlAttributes
} from '../../services/coordinateParser';

suite('Coordinate Parser Test Suite', () => {

    teardown(() => {
        clearCustomPatterns();
    });

    suite('parseCoordinate', () => {

        test('should return null for empty or whitespace-only text', () => {
            assert.strictEqual(parseCoordinate(''), null);
            assert.strictEqual(parseCoordinate('   '), null);
            assert.strictEqual(parseCoordinate('\t\n'), null);
        });

        test('should parse decimal degrees with comma separator', () => {
            const coord = parseCoordinate('59.3293, 18.0686');
            assert.deepStrictEqual(coord, { latitude: 59.3293, longitude: 18.0686 });
        });

        test('should parse decimal degrees with space separator', () => {
            const coord = parseCoordinate('59.3293 18.0686');
            assert.deepStrictEqual(coord, { latitude: 59.3293, longitude: 18.0686 });
        });

        test('should parse DMS format', () => {
            const coord = parseCoordinate('59°19\'45.5"N 18°4\'7.0"E');
            assert.ok(coord);
            assert.strictEqual(coord.latitude, 59.329306);
            assert.strictEqual(coord.longitude, 18.068611);
        });

        test('should parse GeoJSON array format (lng, lat)', () => {
            const coord = parseCoordinate('[18.0686, 59.3293]');
            assert.deepStrictEqual(coord, { latitude: 59.3293, longitude: 18.0686 });
        });

        test('should parse XML-style attributes', () => {
            const coord = parseCoordinate('lat="50.085556" lon="14.4183102"');
            assert.deepStrictEqual(coord, { latitude: 50.085556, longitude: 14.4183102 });
        });

        test('should return null when no coordinate is found', () => {
            assert.strictEqual(parseCoordinate('no coordinates here'), null);
        });

        test('should return the first coordinate when multiple exist', () => {
            const coord = parseCoordinate('59.3293, 18.0686 and 40.7128, -74.0060');
            assert.deepStrictEqual(coord, { latitude: 59.3293, longitude: 18.0686 });
        });
    });

    suite('parseMultipleCoordinates', () => {

        test('should return empty array for empty text', () => {
            assert.deepStrictEqual(parseMultipleCoordinates(''), []);
            assert.deepStrictEqual(parseMultipleCoordinates('   '), []);
        });

        test('should return all coordinates found in text', () => {
            const coords = parseMultipleCoordinates('59.3293, 18.0686 and 40.7128, -74.0060');
            assert.strictEqual(coords.length, 2);
            assert.deepStrictEqual(coords[0], { latitude: 59.3293, longitude: 18.0686 });
            assert.deepStrictEqual(coords[1], { latitude: 40.7128, longitude: -74.006 });
        });

        test('should deduplicate coordinates within tolerance', () => {
            const coords = parseMultipleCoordinates('59.3293, 18.0686 and 59.3293, 18.0686');
            assert.strictEqual(coords.length, 1);
        });

        test('should include custom patterns', () => {
            addCoordinatePattern(/@(?<lat>-?\d+\.?\d*),(?<lng>-?\d+\.?\d*)/g);
            const coords = parseMultipleCoordinates('@59.3293,18.0686');
            assert.deepStrictEqual(coords, [{ latitude: 59.3293, longitude: 18.0686 }]);
        });
    });

    suite('getCoordinatePatterns', () => {

        test('should return default patterns plus custom patterns', () => {
            const defaults = getCoordinatePatterns();
            assert.strictEqual(defaults.length, 4);
            assert.ok(defaults.includes(regexDMS));
            assert.ok(defaults.includes(regexWGS84));
            assert.ok(defaults.includes(regexGeoJSON));
            assert.ok(defaults.includes(regexXmlAttributes));

            addCoordinatePattern(/@(?<lat>-?\d+\.?\d*),(?<lng>-?\d+\.?\d*)/g);
            const withCustom = getCoordinatePatterns();
            assert.strictEqual(withCustom.length, 5);
        });

        test('should not mutate the internal default patterns array', () => {
            const patterns = getCoordinatePatterns();
            patterns.length = 0;
            assert.strictEqual(getCoordinatePatterns().length, 4);
        });
    });

    suite('findCoordinatesRegex', () => {

        test('should skip matches without named groups', () => {
            const coords = findCoordinatesRegex('59.3293, 18.0686', [/foo/g]);
            assert.deepStrictEqual(coords, []);
        });

        test('should skip a match that has no groups at all', () => {
            const coords = findCoordinatesRegex('59.3293, 18.0686', [/59/g]);
            assert.deepStrictEqual(coords, []);
        });

        test('should handle a match with only an lng group', () => {
            const pattern = /(?<lat>-?\d+\.?\d*)?\s*[,\s]\s*(?<lng>-?\d+\.?\d*)/g;
            const coords = findCoordinatesRegex(', 18.0686', [pattern]);
            assert.deepStrictEqual(coords, []);
        });

        test('should pair a pending lat with a following lng fragment', () => {
            const pattern = /(?<lat>-?\d+\.?\d*)?\s*[,\s]\s*(?<lng>-?\d+\.?\d*)?/g;
            const coords = findCoordinatesRegex('59.3293, 18.0686', [pattern]);
            assert.ok(coords.some(c => c.latitude === 59.3293 && c.longitude === 18.0686));
        });

        test('should pair separate lat and lng captures', () => {
            const pattern = /(?<lat>-?\d+\.?\d*)|(?<lng>-?\d+\.?\d*)/g;
            const coords = findCoordinatesRegex('59.3293 18.0686', [pattern]);
            assert.ok(coords.some(c => c.latitude === 59.3293 && c.longitude === 18.0686));
        });

        test('should pair a pending lat with a following lng-only match', () => {
            const pattern = /(?<lat>-?\d+\.?\d*)|L(?<lng>-?\d+\.?\d*)/g;
            const coords = findCoordinatesRegex('59.3293 L18.0686', [pattern]);
            assert.ok(coords.some(c => c.latitude === 59.3293 && c.longitude === 18.0686));
        });

        test('should pair a pending lng with a following lat-only match', () => {
            const pattern = /L(?<lng>-?\d+\.?\d*)|(?<lat>-?\d+\.?\d*)/g;
            const coords = findCoordinatesRegex('L18.0686 59.3293', [pattern]);
            assert.ok(coords.some(c => c.latitude === 59.3293 && c.longitude === 18.0686));
        });

        test('should pair partial lat/lng matches from degenerate patterns', () => {
            const pattern = /(?<lat>-?\d+\.?\d*)?\s*[,\s]\s*(?<lng>-?\d+\.?\d*)?/g;
            const coords = findCoordinatesRegex('59.3293, 18.0686', [pattern]);
            assert.ok(coords.length > 0);
        });

        test('should handle lng-only partial match pairing', () => {
            const pattern = /(?<lng>-?\d+\.?\d*)/g;
            const coords = findCoordinatesRegex('18.0686', [pattern]);
            assert.deepStrictEqual(coords, []);
        });

        test('should skip overlapping matches', () => {
            const pattern = /(?<lat>-?\d+\.?\d*)\s*[,\s]\s*(?<lng>-?\d+\.?\d*)/g;
            const coords = findCoordinatesRegex('59.3293, 18.0686', [pattern]);
            assert.strictEqual(coords.length, 1);
        });
    });

    suite('calculateBoundingBox', () => {

        test('should return null for empty array', () => {
            assert.strictEqual(calculateBoundingBox([]), null);
        });

        test('should calculate bounding box from coordinates', () => {
            const box = calculateBoundingBox([
                { latitude: 10, longitude: 20 },
                { latitude: -5, longitude: 30 },
                { latitude: 15, longitude: -10 }
            ]);
            assert.deepStrictEqual(box, {
                southwest: { latitude: -5, longitude: -10 },
                northeast: { latitude: 15, longitude: 30 }
            });
        });

        test('should handle single coordinate', () => {
            const box = calculateBoundingBox([{ latitude: 10, longitude: 20 }]);
            assert.deepStrictEqual(box, {
                southwest: { latitude: 10, longitude: 20 },
                northeast: { latitude: 10, longitude: 20 }
            });
        });
    });

    suite('extractCoordinatesFromGeoJson', () => {

        test('should return empty array for null/undefined geojson', () => {
            assert.deepStrictEqual(extractCoordinatesFromGeoJson(null), []);
            assert.deepStrictEqual(extractCoordinatesFromGeoJson(undefined), []);
        });

        test('should return empty array for geometry without coordinates', () => {
            assert.deepStrictEqual(extractCoordinatesFromGeoJson({ type: 'Point' }), []);
        });

        test('should skip Point with invalid coordinates', () => {
            assert.deepStrictEqual(extractCoordinatesFromGeoJson({ type: 'Point', coordinates: [1] }), []);
            assert.deepStrictEqual(extractCoordinatesFromGeoJson({ type: 'Point', coordinates: 'not-array' }), []);
        });

        test('should skip MultiPoint/LineString with non-array coordinates', () => {
            assert.deepStrictEqual(extractCoordinatesFromGeoJson({ type: 'LineString', coordinates: 'bad' }), []);
        });

        test('should extract from MultiLineString', () => {
            const geojson = {
                type: 'MultiLineString',
                coordinates: [
                    [[13.4050, 52.5200], [4.9014, 52.3676]],
                    [[2.3522, 48.8566]]
                ]
            };
            const coords = extractCoordinatesFromGeoJson(geojson);
            assert.strictEqual(coords.length, 3);
            assert.deepStrictEqual(coords[0], { latitude: 52.52, longitude: 13.405 });
        });

        test('should skip MultiLineString with non-array coordinates', () => {
            assert.deepStrictEqual(extractCoordinatesFromGeoJson({ type: 'MultiLineString', coordinates: 'bad' }), []);
        });

        test('should skip MultiLineString with non-array ring', () => {
            assert.deepStrictEqual(
                extractCoordinatesFromGeoJson({ type: 'MultiLineString', coordinates: ['bad'] }),
                []
            );
        });

        test('should extract from Polygon', () => {
            const geojson = {
                type: 'Polygon',
                coordinates: [
                    [[0, 0], [1, 1], [2, 0], [0, 0]]
                ]
            };
            const coords = extractCoordinatesFromGeoJson(geojson);
            assert.strictEqual(coords.length, 4);
            assert.deepStrictEqual(coords[0], { latitude: 0, longitude: 0 });
        });

        test('should skip Polygon with non-array coordinates', () => {
            assert.deepStrictEqual(extractCoordinatesFromGeoJson({ type: 'Polygon', coordinates: 'bad' }), []);
        });

        test('should extract from MultiPolygon', () => {
            const geojson = {
                type: 'MultiPolygon',
                coordinates: [
                    [[[0, 0], [1, 1], [0, 1], [0, 0]]],
                    [[[10, 10], [11, 11], [10, 11], [10, 10]]]
                ]
            };
            const coords = extractCoordinatesFromGeoJson(geojson);
            assert.strictEqual(coords.length, 8);
        });

        test('should skip MultiPolygon with non-array coordinates', () => {
            assert.deepStrictEqual(extractCoordinatesFromGeoJson({ type: 'MultiPolygon', coordinates: 'bad' }), []);
        });

        test('should skip MultiPolygon with non-array polygon', () => {
            assert.deepStrictEqual(
                extractCoordinatesFromGeoJson({ type: 'MultiPolygon', coordinates: ['bad'] }),
                []
            );
        });

        test('should skip MultiPolygon with non-array ring', () => {
            assert.deepStrictEqual(
                extractCoordinatesFromGeoJson({ type: 'MultiPolygon', coordinates: [['bad']] }),
                []
            );
        });

        test('should skip GeometryCollection without geometries array', () => {
            assert.deepStrictEqual(extractCoordinatesFromGeoJson({ type: 'GeometryCollection' }), []);
        });

        test('should extract from FeatureCollection', () => {
            const geojson = {
                type: 'FeatureCollection',
                features: [
                    { type: 'Feature', geometry: { type: 'Point', coordinates: [18.0686, 59.3293] } },
                    { type: 'Feature', geometry: { type: 'Point', coordinates: [13.4050, 52.5200] } }
                ]
            };
            const coords = extractCoordinatesFromGeoJson(geojson);
            assert.strictEqual(coords.length, 2);
        });

        test('should skip Feature without geometry', () => {
            assert.deepStrictEqual(extractCoordinatesFromGeoJson({ type: 'Feature' }), []);
        });
    });

    suite('calculateBoundingBoxFromGeoJson', () => {

        test('should return null when no coordinates found', () => {
            assert.strictEqual(calculateBoundingBoxFromGeoJson({ type: 'Point' }), null);
        });

        test('should calculate bounding box from geojson', () => {
            const box = calculateBoundingBoxFromGeoJson({
                type: 'Point',
                coordinates: [18.0686, 59.3293]
            });
            assert.deepStrictEqual(box, {
                southwest: { latitude: 59.3293, longitude: 18.0686 },
                northeast: { latitude: 59.3293, longitude: 18.0686 }
            });
        });
    });

    suite('formatCoordinates', () => {

        test('should format with default precision of 4', () => {
            assert.strictEqual(formatCoordinates(59.3293, 18.0686), '59.3293, 18.0686');
        });

        test('should format with custom precision', () => {
            assert.strictEqual(formatCoordinates(59.3293, 18.0686, 2), '59.33, 18.07');
        });
    });

    suite('formatViewState', () => {

        test('should format view state string', () => {
            assert.strictEqual(
                formatViewState(12.345, 45.6, 30.4),
                'Zoom: 12.3 | Bearing: 46° | Pitch: 30°'
            );
        });
    });
});
