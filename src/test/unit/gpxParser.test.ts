import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseGpxFile } from '../../services/gpxParser';

interface TestFeature {
    type: string;
    geometry: { type: string; coordinates: number[] };
    properties: Record<string, unknown>;
}

function writeTempGpx(content: string): string {
    const filePath = path.join(os.tmpdir(), `gpx-parser-test-${Date.now()}-${Math.floor(Math.random() * 1e9)}.gpx`);
    fs.writeFileSync(filePath, content, 'utf-8');
    return filePath;
}

function parseFeatures(content: string): TestFeature[] {
    const filePath = writeTempGpx(content);
    try {
        const result = parseGpxFile(filePath) as { features: TestFeature[] };
        return result.features;
    } finally {
        fs.unlinkSync(filePath);
    }
}

suite('GpxParser Test Suite', () => {

    test('should parse self-closing wpt elements as waypoints', () => {
        const content = '<?xml version="1.0"?><gpx>' +
            '<wpt lat="47.6" lon="-122.3"/>' +
            '<wpt lat="48.1" lon="-123.4"/>' +
            '</gpx>';
        const features = parseFeatures(content);

        assert.strictEqual(features.length, 2, 'Should find two waypoints');
        assert.strictEqual(features[0].geometry.type, 'Point');
        assert.deepStrictEqual(features[0].geometry.coordinates, [-122.3, 47.6]);
        assert.deepStrictEqual(features[1].geometry.coordinates, [-123.4, 48.1]);
    });

    test('should parse mixed self-closing and full wpt elements with correct names', () => {
        const content = '<?xml version="1.0"?><gpx>' +
            '<wpt lat="47.6" lon="-122.3"/>' +
            '<wpt lat="48.1" lon="-123.4"><name>Second</name><ele>150.5</ele></wpt>' +
            '<wpt lat="49.2" lon="-124.5"><name>Third</name></wpt>' +
            '</gpx>';
        const features = parseFeatures(content);

        assert.strictEqual(features.length, 3, 'Should find three waypoints');
        assert.deepStrictEqual(features[0].geometry.coordinates, [-122.3, 47.6]);
        assert.strictEqual(features[0].properties.name, undefined);
        assert.strictEqual(features[1].properties.name, 'Second');
        assert.strictEqual(features[1].properties.elevation, 150.5);
        assert.strictEqual(features[2].properties.name, 'Third');
    });

    test('should omit elevation when ele content is not a number', () => {
        const content = '<?xml version="1.0"?><gpx>' +
            '<wpt lat="47.6" lon="-122.3"><ele>n/a</ele><name>Point</name></wpt>' +
            '</gpx>';
        const features = parseFeatures(content);

        assert.strictEqual(features.length, 1, 'Should find one waypoint');
        assert.strictEqual(features[0].properties.elevation, undefined);
        assert.strictEqual(features[0].properties.name, 'Point');
    });

    test('should keep numeric elevation for full wpt elements', () => {
        const content = '<?xml version="1.0"?><gpx>' +
            '<wpt lat="47.6" lon="-122.3"><ele>42.7</ele></wpt>' +
            '</gpx>';
        const features = parseFeatures(content);

        assert.strictEqual(features.length, 1, 'Should find one waypoint');
        assert.strictEqual(features[0].properties.elevation, 42.7);
    });

});