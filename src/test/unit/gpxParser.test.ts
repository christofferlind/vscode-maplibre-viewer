import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseGpxFile } from '../../services/gpxParser';

interface TestFeature {
    type: string;
    geometry: { type: string; coordinates: number[] | number[][] };
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

    test('should not fabricate a track when track points appear before a track', () => {
        const content = '<?xml version="1.0"?><gpx>' +
            '<trkseg><trkpt lat="45.0" lon="-75.0"/><trkpt lat="46.0" lon="-76.0"/></trkseg>' +
            '<trk><name>Real Track</name><trkseg><trkpt lat="10.0" lon="10.0"/><trkpt lat="11.0" lon="11.0"/></trkseg></trk>' +
            '</gpx>';
        const features = parseFeatures(content);

        const trackFeatures = features.filter(f => f.properties.type === 'track');
        assert.strictEqual(trackFeatures.length, 1, 'Only the real track should be found');
        assert.ok(String(trackFeatures[0].properties.name).startsWith('Real Track'));
    });

    test('should decode XML entities in waypoint names', () => {
        const content = '<?xml version="1.0"?><gpx>' +
            '<wpt lat="47.6" lon="-122.3"><name>A &amp; B &amp;lt;x&amp;gt;</name></wpt>' +
            '</gpx>';
        const features = parseFeatures(content);

        assert.strictEqual(features[0].properties.name, 'A & B &lt;x&gt;');
    });

    test('should strip CDATA wrappers in names', () => {
        const content = '<?xml version="1.0"?><gpx>' +
            '<wpt lat="47.6" lon="-122.3"><name><![CDATA[<b>Waypoint</b>]]></name></wpt>' +
            '</gpx>';
        const features = parseFeatures(content);

        assert.strictEqual(features[0].properties.name, '<b>Waypoint</b>');
    });

    test('should decode astral-plane numeric character references in names', () => {
        const content = '<?xml version="1.0"?><gpx>' +
            '<wpt lat="47.6" lon="-122.3"><name>&#128512;</name></wpt>' +
            '</gpx>';
        const features = parseFeatures(content);

        assert.strictEqual(features[0].properties.name, '\u{1F600}');
    });

    test('should accept lon attribute before lat', () => {
        const content = '<?xml version="1.0"?><gpx>' +
            '<wpt lon="-122.3" lat="47.6"/>' +
            '</gpx>';
        const features = parseFeatures(content);

        assert.strictEqual(features.length, 1);
        assert.deepStrictEqual(features[0].geometry.coordinates, [-122.3, 47.6]);
    });

    test('should accept single-quoted lat/lon attributes', () => {
        const content = "<?xml version=\"1.0\"?><gpx>" +
            "<wpt lat='47.6' lon='-122.3'/>" +
            '</gpx>';
        const features = parseFeatures(content);

        assert.strictEqual(features.length, 1);
        assert.deepStrictEqual(features[0].geometry.coordinates, [-122.3, 47.6]);
    });

    suite('real-world tracks', () => {
        const fixturePath = path.join(__dirname, '..', '..', '..', 'resources', 'test', '2015-02-12_05-02_Thu_2.gpx');

        interface TrackFeature {
            type: string;
            geometry: { type: string; coordinates: number[][] };
            properties: Record<string, unknown>;
        }

        function parseFixture(): TrackFeature[] {
            const result = parseGpxFile(fixturePath) as { features: unknown[] };
            return result.features as TrackFeature[];
        }

        test('should not throw for a file with CRLF line endings', () => {
            assert.doesNotThrow(() => parseFixture());
        });

        test('should convert the track to a single multi-point line', () => {
            const features = parseFixture();

            assert.strictEqual(features.length, 1, 'The whole file is one track segment');
            assert.strictEqual(features[0].geometry.type, 'LineString', 'A track must become a line');
        });

        test('should keep every recorded point of the track', () => {
            const features = parseFixture();

            assert.strictEqual(features[0].geometry.coordinates.length, 1511, 'All track points are kept');
        });

        test('should place coordinates in [lon, lat] order', () => {
            const features = parseFixture();
            const coordinates = features[0].geometry.coordinates;

            assert.deepStrictEqual(coordinates[0], [76.3301317, 26.58122]);
            assert.deepStrictEqual(coordinates[coordinates.length - 1], [75.7929967, 26.903295]);
        });

        test('should mark the feature as a track', () => {
            const features = parseFixture();

            assert.strictEqual(features[0].properties.type, 'track');
        });
    });

});