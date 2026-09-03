import * as assert from 'assert';
import {
    isValidGeoJson,
    ensureFeatureCollection,
    VALID_GEOJSON_TYPES,
    VALID_GEOJSON_GEOMETRY_TYPES
} from '../../services/geojsonUtils';

suite('GeoJSON Utils', () => {
    suite('isValidGeoJson', () => {
        test('should return false for non-object inputs', () => {
            assert.strictEqual(isValidGeoJson(null), false);
            assert.strictEqual(isValidGeoJson(undefined), false);
            assert.strictEqual(isValidGeoJson('not geojson'), false);
            assert.strictEqual(isValidGeoJson(42), false);
            assert.strictEqual(isValidGeoJson([1, 2, 3]), false);
        });

        test('should return false when type is missing', () => {
            assert.strictEqual(isValidGeoJson({}), false);
            assert.strictEqual(isValidGeoJson({ name: 'no type' }), false);
        });

        test('should return false for invalid type', () => {
            assert.strictEqual(isValidGeoJson({ type: 'NotARealType' }), false);
            assert.strictEqual(isValidGeoJson({ type: 123 }), false);
        });

        test('should return true for valid geometry types', () => {
            assert.strictEqual(isValidGeoJson({ type: 'Point' }), true);
            assert.strictEqual(isValidGeoJson({ type: 'MultiPolygon' }), true);
            assert.strictEqual(isValidGeoJson({ type: 'LineString' }), true);
        });

        test('should return false for FeatureCollection without features array', () => {
            assert.strictEqual(isValidGeoJson({ type: 'FeatureCollection' }), false);
            assert.strictEqual(isValidGeoJson({ type: 'FeatureCollection', features: 'nope' }), false);
        });

        test('should return true for valid FeatureCollection', () => {
            assert.strictEqual(isValidGeoJson({ type: 'FeatureCollection', features: [] }), true);
        });

        test('should return false for Feature with invalid geometry', () => {
            assert.strictEqual(isValidGeoJson({ type: 'Feature', geometry: 'bad' }), false);
        });

        test('should return true for Feature with null geometry', () => {
            assert.strictEqual(isValidGeoJson({ type: 'Feature', geometry: null }), true);
        });

        test('should return true for Feature with object geometry', () => {
            assert.strictEqual(
                isValidGeoJson({ type: 'Feature', geometry: { type: 'Point' } }),
                true
            );
        });
    });

    suite('ensureFeatureCollection', () => {
        test('should throw for non-object input', () => {
            assert.throws(() => ensureFeatureCollection(null), /Invalid GeoJSON/);
            assert.throws(() => ensureFeatureCollection('string'), /Invalid GeoJSON/);
        });

        test('should return FeatureCollection unchanged', () => {
            const fc = { type: 'FeatureCollection', features: [] };
            assert.strictEqual(ensureFeatureCollection(fc), fc);
        });

        test('should throw when FeatureCollection misses features array', () => {
            assert.throws(
                () => ensureFeatureCollection({ type: 'FeatureCollection' }),
                /features.*must be an array/
            );
        });

        test('should wrap a single Feature', () => {
            const feature = { type: 'Feature', geometry: { type: 'Point' }, properties: {} };
            const result = ensureFeatureCollection(feature) as { type: string; features: object[] };
            assert.strictEqual(result.type, 'FeatureCollection');
            assert.strictEqual(result.features.length, 1);
            assert.strictEqual(result.features[0], feature);
        });

        test('should wrap a Geometry object into a Feature', () => {
            const geometry = { type: 'Point', coordinates: [0, 0] };
            const result = ensureFeatureCollection(geometry) as {
                type: string;
                features: { geometry: object }[];
            };
            assert.strictEqual(result.type, 'FeatureCollection');
            assert.strictEqual(result.features.length, 1);
            assert.strictEqual(result.features[0].geometry, geometry);
        });

        test('should throw for unsupported type', () => {
            assert.throws(() => ensureFeatureCollection({ type: 'Bogus' }), /Invalid GeoJSON/);
        });
    });

    test('should export the valid type constant arrays', () => {
        assert.ok(VALID_GEOJSON_TYPES.includes('FeatureCollection'));
        assert.ok(VALID_GEOJSON_GEOMETRY_TYPES.includes('Point'));
        assert.ok(VALID_GEOJSON_GEOMETRY_TYPES.includes('MultiPolygon'));
    });
});
