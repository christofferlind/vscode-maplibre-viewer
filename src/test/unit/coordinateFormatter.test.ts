import * as assert from 'assert';
import {
    formatCoordinate,
    parseCoordinateString,
    formatViewState,
    formatBookmarkDescription,
    formatLatitude,
    formatLongitude
} from '../../services/coordinateFormatter';

suite('coordinateFormatter', () => {
    suite('formatCoordinate', () => {
        test('should format with default precision of 6', () => {
            assert.strictEqual(
                formatCoordinate({ latitude: 59.329375, longitude: 18.068984 }),
                '59.329375, 18.068984'
            );
        });

        test('should respect custom precision', () => {
            assert.strictEqual(
                formatCoordinate({ latitude: 59.329375, longitude: 18.068984 }, 2),
                '59.33, 18.07'
            );
        });

        test('should handle negative coordinates', () => {
            assert.strictEqual(
                formatCoordinate({ latitude: -33.8, longitude: -70.7 }, 1),
                '-33.8, -70.7'
            );
        });
    });

    suite('parseCoordinateString', () => {
        test('should parse "lat, lng" with spaces', () => {
            assert.deepStrictEqual(parseCoordinateString('59.33, 18.06'), {
                latitude: 59.33,
                longitude: 18.06
            });
        });

        test('should parse "lat,lng" without spaces', () => {
            assert.deepStrictEqual(parseCoordinateString('59.33,18.06'), {
                latitude: 59.33,
                longitude: 18.06
            });
        });

        test('should parse negative coordinates', () => {
            assert.deepStrictEqual(parseCoordinateString('-33.8, -70.7'), {
                latitude: -33.8,
                longitude: -70.7
            });
        });

        test('should parse integer coordinates', () => {
            assert.deepStrictEqual(parseCoordinateString('59, 18'), {
                latitude: 59,
                longitude: 18
            });
        });

        test('should return null for invalid strings', () => {
            assert.strictEqual(parseCoordinateString('not a coordinate'), null);
            assert.strictEqual(parseCoordinateString(''), null);
            assert.strictEqual(parseCoordinateString('59.33'), null);
        });
    });

    suite('formatViewState', () => {
        test('should include zoom always and omit zero bearing/pitch', () => {
            assert.strictEqual(
                formatViewState({ zoom: 12, bearing: 0, pitch: 0 }),
                'Zoom: 12.0'
            );
        });

        test('should include bearing when non-zero', () => {
            assert.strictEqual(
                formatViewState({ zoom: 12, bearing: 45, pitch: 0 }),
                'Zoom: 12.0, Bearing: 45°'
            );
        });

        test('should include pitch when non-zero', () => {
            assert.strictEqual(
                formatViewState({ zoom: 12, bearing: 0, pitch: 30 }),
                'Zoom: 12.0, Pitch: 30°'
            );
        });

        test('should include both bearing and pitch', () => {
            assert.strictEqual(
                formatViewState({ zoom: 14, bearing: 90, pitch: 45 }),
                'Zoom: 14.0, Bearing: 90°, Pitch: 45°'
            );
        });
    });

    suite('formatBookmarkDescription', () => {
        test('should combine coordinate and view state', () => {
            assert.strictEqual(
                formatBookmarkDescription(
                    { latitude: 59.329375, longitude: 18.068984 },
                    { zoom: 12, bearing: 0, pitch: 0 }
                ),
                '59.329375, 18.068984 | Zoom: 12.0'
            );
        });
    });

    suite('formatLatitude / formatLongitude', () => {
        test('should append N/E for positive values', () => {
            assert.strictEqual(formatLatitude(59.329375), '59.329375° N');
            assert.strictEqual(formatLongitude(18.068984), '18.068984° E');
        });

        test('should append S/W for negative values', () => {
            assert.strictEqual(formatLatitude(-33.8, 1), '33.8° S');
            assert.strictEqual(formatLongitude(-70.7, 1), '70.7° W');
        });

        test('should respect custom precision', () => {
            assert.strictEqual(formatLatitude(59.329375, 2), '59.33° N');
        });
    });
});
