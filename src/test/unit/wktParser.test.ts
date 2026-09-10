import * as assert from 'assert';
import { isWktText, parseWktToGeoJson } from '../../services/wktParser';

suite('wktParser', () => {
    suite('isWktText', () => {
        test('detects standard WKT keywords', () => {
            assert.strictEqual(isWktText('POINT (1 2)'), true);
            assert.strictEqual(isWktText('LINESTRING (1 2, 3 4)'), true);
            assert.strictEqual(isWktText('POLYGON ((0 0, 1 0, 1 1, 0 0))'), true);
            assert.strictEqual(isWktText('MULTIPOINT ((1 2), (3 4))'), true);
            assert.strictEqual(isWktText('MULTILINESTRING ((1 2, 3 4))'), true);
            assert.strictEqual(isWktText('MULTIPOLYGON (((0 0, 1 0, 1 1, 0 0)))'), true);
            assert.strictEqual(isWktText('GEOMETRYCOLLECTION (POINT (1 2))'), true);
        });

        test('is case-insensitive and trims whitespace', () => {
            assert.strictEqual(isWktText('  point(1 2)'), true);
        });

        test('detects Z/M dimension suffixes', () => {
            assert.strictEqual(isWktText('POINT Z (1 2 3)'), true);
            assert.strictEqual(isWktText('LINESTRING ZM (1 2 3 4)'), true);
        });

        test('rejects non-WKT text', () => {
            assert.strictEqual(isWktText('59.3293, 18.0686'), false);
            assert.strictEqual(isWktText('{"type": "Point"}'), false);
            assert.strictEqual(isWktText(''), false);
            assert.strictEqual(isWktText('   '), false);
            assert.strictEqual(isWktText('POINTLESS TEXT'), false);
        });
    });

    suite('parseWktToGeoJson', () => {
        test('parses a Point into a FeatureCollection', () => {
            const result = parseWktToGeoJson('POINT (18.0686 59.3293)');
            assert.strictEqual(result.geometryCount, 1);
            const fc = result.geojson as { type: string; features: unknown[] };
            assert.strictEqual(fc.type, 'FeatureCollection');
            assert.strictEqual(fc.features.length, 1);
            const geometry = (fc.features[0] as { geometry: { type: string; coordinates: number[] } }).geometry;
            assert.strictEqual(geometry.type, 'Point');
            assert.deepStrictEqual(geometry.coordinates, [18.0686, 59.3293]);
        });

        test('parses a LineString', () => {
            const result = parseWktToGeoJson('LINESTRING (0 0, 1 1, 2 0)');
            const geometry = getSingleGeometry(result);
            assert.strictEqual(geometry.type, 'LineString');
            assert.deepStrictEqual(geometry.coordinates, [[0, 0], [1, 1], [2, 0]]);
        });

        test('parses a Polygon with one ring', () => {
            const result = parseWktToGeoJson('POLYGON ((0 0, 4 0, 4 4, 0 4, 0 0))');
            const geometry = getSingleGeometry(result);
            assert.strictEqual(geometry.type, 'Polygon');
            assert.deepStrictEqual(geometry.coordinates, [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]]);
        });

        test('parses a Polygon with a hole', () => {
            const result = parseWktToGeoJson('POLYGON ((0 0, 4 0, 4 4, 0 4, 0 0), (1 1, 3 1, 3 3, 1 3, 1 1))');
            const geometry = getSingleGeometry(result);
            const polygon = geometry as { type: string; coordinates: number[][][] };
            assert.strictEqual(polygon.coordinates.length, 2);
            assert.strictEqual(polygon.coordinates[1].length, 5);
        });

        test('parses MULTIPOINT in parenthesized form', () => {
            const result = parseWktToGeoJson('MULTIPOINT ((1 2), (3 4))');
            const geometry = getSingleGeometry(result);
            assert.strictEqual(geometry.type, 'MultiPoint');
            assert.deepStrictEqual(geometry.coordinates, [[1, 2], [3, 4]]);
        });

        test('parses MULTIPOINT in bare coordinate form', () => {
            const result = parseWktToGeoJson('MULTIPOINT (1 2, 3 4)');
            const geometry = getSingleGeometry(result);
            assert.strictEqual(geometry.type, 'MultiPoint');
            assert.deepStrictEqual(geometry.coordinates, [[1, 2], [3, 4]]);
        });

        test('parses MULTILINESTRING', () => {
            const result = parseWktToGeoJson('MULTILINESTRING ((0 0, 1 1), (2 2, 3 3))');
            const geometry = getSingleGeometry(result);
            assert.strictEqual(geometry.type, 'MultiLineString');
            assert.deepStrictEqual(geometry.coordinates, [[[0, 0], [1, 1]], [[2, 2], [3, 3]]]);
        });

        test('parses MULTIPOLYGON', () => {
            const result = parseWktToGeoJson('MULTIPOLYGON (((0 0, 1 0, 1 1, 0 0)), ((2 2, 3 2, 3 3, 2 2)))');
            const geometry = getSingleGeometry(result);
            assert.strictEqual(geometry.type, 'MultiPolygon');
            const multiPolygon = geometry as { coordinates: number[][][][] };
            assert.strictEqual(multiPolygon.coordinates.length, 2);
        });

        test('parses a GEOMETRYCOLLECTION into multiple features', () => {
            const result = parseWktToGeoJson('GEOMETRYCOLLECTION (POINT (1 2), LINESTRING (0 0, 1 1))');
            assert.strictEqual(result.geometryCount, 2);
            const fc = result.geojson as { type: string; features: unknown[] };
            assert.strictEqual(fc.features.length, 2);
        });

        test('parses multiple top-level geometries separated by commas', () => {
            const result = parseWktToGeoJson('POINT (1 2), POINT (3 4)');
            assert.strictEqual(result.geometryCount, 2);
        });

        test('parses Z-dimension geometry ignoring extra values', () => {
            const result = parseWktToGeoJson('POINT Z (18.0686 59.3293 100)');
            const geometry = getSingleGeometry(result);
            assert.deepStrictEqual(geometry.coordinates, [18.0686, 59.3293]);
        });

        test('throws when no WKT geometry is found', () => {
            assert.throws(() => parseWktToGeoJson('not wkt'), /No valid WKT geometry/);
        });

        test('rejects out-of-range coordinates', () => {
            assert.throws(() => parseWktToGeoJson('POINT (200 100)'), /No valid WKT geometry/);
        });
    });

    function getSingleGeometry(result: { geojson: object }): { type: string; coordinates: unknown } {
        const fc = result.geojson as { features: { geometry: { type: string; coordinates: unknown } }[] };
        return fc.features[0].geometry;
    }
});