import * as assert from 'assert';
import {
    extractCoordinatesFromGeoJson,
    findCoordinatesRegex,
    addCoordinatePattern,
    clearCustomPatterns
} from '../../services/coordinateParser';

suite('Coordinate Parser Bug Fixes Test Suite', () => {

    teardown(() => {
        clearCustomPatterns();
    });

    suite('GeometryCollection extraction', () => {

        test('should extract coordinates from GeometryCollection with nested geometries', () => {
            const geojson = {
                type: 'GeometryCollection',
                geometries: [
                    { type: 'Point', coordinates: [18.0686, 59.3293] },
                    { type: 'LineString', coordinates: [[13.4050, 52.5200], [4.9014, 52.3676]] }
                ]
            };

            const coords = extractCoordinatesFromGeoJson(geojson);

            assert.strictEqual(coords.length, 3, 'Should find three coordinates');
            assert.deepStrictEqual(coords[0], { latitude: 59.3293, longitude: 18.0686 });
            assert.deepStrictEqual(coords[1], { latitude: 52.52, longitude: 13.405 });
            assert.deepStrictEqual(coords[2], { latitude: 52.3676, longitude: 4.9014 });
        });

        test('should extract coordinates from nested GeometryCollection', () => {
            const geojson = {
                type: 'GeometryCollection',
                geometries: [
                    {
                        type: 'GeometryCollection',
                        geometries: [
                            { type: 'Point', coordinates: [2.3522, 48.8566] }
                        ]
                    },
                    { type: 'Point', coordinates: [-0.1276, 51.5072] }
                ]
            };

            const coords = extractCoordinatesFromGeoJson(geojson);

            assert.strictEqual(coords.length, 2, 'Should find two coordinates');
            assert.deepStrictEqual(coords[0], { latitude: 48.8566, longitude: 2.3522 });
            assert.deepStrictEqual(coords[1], { latitude: 51.5072, longitude: -0.1276 });
        });

        test('should extract coordinates from Feature with GeometryCollection geometry', () => {
            const geojson = {
                type: 'Feature',
                geometry: {
                    type: 'GeometryCollection',
                    geometries: [
                        { type: 'Point', coordinates: [12.4964, 41.9028] }
                    ]
                }
            };

            const coords = extractCoordinatesFromGeoJson(geojson);

            assert.strictEqual(coords.length, 1, 'Should find one coordinate');
            assert.deepStrictEqual(coords[0], { latitude: 41.9028, longitude: 12.4964 });
        });

        test('should still extract coordinates from regular geometries', () => {
            const geojson = { type: 'Point', coordinates: [18.0686, 59.3293] };
            const coords = extractCoordinatesFromGeoJson(geojson);

            assert.strictEqual(coords.length, 1);
            assert.deepStrictEqual(coords[0], { latitude: 59.3293, longitude: 18.0686 });
        });
    });

    suite('Non-global custom pattern', () => {

        test('should parse with a non-global custom pattern without hanging', () => {
            addCoordinatePattern(/@(?<lat>-?\d+\.?\d*),(?<lng>-?\d+\.?\d*)/);

            const coords = findCoordinatesRegex('no match here', [
                /@(?<lat>-?\d+\.?\d*),(?<lng>-?\d+\.?\d*)/
            ]);

            assert.deepStrictEqual(coords, []);
        });

        test('should find all matches with a non-global custom pattern', () => {
            addCoordinatePattern(/@(?<lat>-?\d+\.?\d*),(?<lng>-?\d+\.?\d*)/);

            const text = '@59.3293,18.0686 and @40.7128,-74.0060';
            const coords = findCoordinatesRegex(text, [
                /@(?<lat>-?\d+\.?\d*),(?<lng>-?\d+\.?\d*)/
            ]);

            assert.strictEqual(coords.length, 2, 'Should find both coordinates');
            assert.deepStrictEqual(coords[0], { latitude: 59.3293, longitude: 18.0686 });
            assert.deepStrictEqual(coords[1], { latitude: 40.7128, longitude: -74.006 });
        });
    });

    suite('Zero-length match handling', () => {

        test('should not hang on zero-length matches', () => {
            const zeroLengthPattern = /(?<lat>-?\d+\.?\d*)?(?<lng>-?\d+\.?\d*)?/g;

            const coords = findCoordinatesRegex('59.3293,18.0686', [zeroLengthPattern]);

            assert.ok(coords.length > 0, 'Should find coordinates via other content or complete');
        });

        test('should not hang when custom pattern matches empty string', () => {
            addCoordinatePattern(/x?/g);

            const coords = findCoordinatesRegex('abc', [/x?/g]);

            assert.deepStrictEqual(coords, []);
        });
    });
});