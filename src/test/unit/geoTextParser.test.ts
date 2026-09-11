import * as assert from 'assert';
import { parseGeoText } from '../../services/geoTextParser';
import { loadWithStubbedVscode } from '../testUtils/loadWithStubbedVscode';

// Load coordinateParser (transitively used by geoTextParser) against the
// stubbed vscode module so logging does not require the extension host.
loadWithStubbedVscode('../../services/coordinateParser');

suite('geoTextParser Test Suite', () => {
    test('parses WKT POINT with lng lat order', () => {
        const result = parseGeoText('POINT (18.0686 59.3293)');
        assert.ok(result);
        assert.strictEqual(result.isWkt, true);
        assert.strictEqual(result.geometryCount, 1);
        const fc = result.geojson as { features: Array<{ geometry: { coordinates: number[] } }> };
        assert.deepStrictEqual(fc.features[0].geometry.coordinates, [18.0686, 59.3293]);
    });

    test('parses plain decimal coordinates as lat lng', () => {
        const result = parseGeoText('59.3293, 18.0686');
        assert.ok(result);
        assert.strictEqual(result.isWkt, false);
        assert.strictEqual(result.coordinates.length, 1);
        assert.strictEqual(result.coordinates[0].latitude, 59.3293);
        assert.strictEqual(result.coordinates[0].longitude, 18.0686);
        const fc = result.geojson as { features: Array<{ geometry: { coordinates: number[] } }> };
        assert.deepStrictEqual(fc.features[0].geometry.coordinates, [18.0686, 59.3293]);
    });

    test('parses multiple plain coordinates', () => {
        const result = parseGeoText('59.3293, 18.0686\n55.6050, 13.0038');
        assert.ok(result);
        assert.strictEqual(result.coordinates.length, 2);
        assert.strictEqual(result.geometryCount, 2);
    });

    test('returns null for text without coordinates', () => {
        assert.strictEqual(parseGeoText('hello world'), null);
    });

    test('returns null for empty text', () => {
        assert.strictEqual(parseGeoText('   '), null);
    });

    test('throws for unparseable WKT-looking text', () => {
        assert.throws(() => parseGeoText('POINT (999 999)'));
    });
});