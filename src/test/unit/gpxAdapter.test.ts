import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { gpxAdapter } from '../../adapters/gpxAdapter';

suite('GpxAdapter', () => {
    let tempDir: string;

    suiteSetup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gpx-adapter-test-'));
    });

    suiteTeardown(() => {
        if (tempDir && fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    function writeGpxFile(fileName: string, content: string): string {
        const filePath = path.join(tempDir, fileName);
        fs.writeFileSync(filePath, content);
        return filePath;
    }

    suite('toGeoJson', () => {
        test('should convert valid GPX with waypoints to GeoJSON', async () => {
            const gpxContent = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1">
  <wpt lat="45.0" lon="-75.0">
    <name>Waypoint 1</name>
  </wpt>
  <wpt lat="46.0" lon="-76.0">
    <name>Waypoint 2</name>
  </wpt>
</gpx>`;

            const filePath = writeGpxFile('valid.gpx', gpxContent);
            const result = await gpxAdapter.toGeoJson(filePath);
            const gj = result as { type: string; features: Array<{ type: string; geometry: { type: string; coordinates: number[] }; properties: { name?: string } }> };

            assert.strictEqual(gj.type, 'FeatureCollection');
            assert.strictEqual(gj.features.length, 2);
            assert.strictEqual(gj.features[0].geometry.type, 'Point');
            assert.deepStrictEqual(gj.features[0].geometry.coordinates, [-75.0, 45.0]);
            assert.strictEqual(gj.features[0].properties.name, 'Waypoint 1');
        });

        test('should convert valid GPX with track to GeoJSON', async () => {
            const gpxContent = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1">
  <trk>
    <name>Test Track</name>
    <trkseg>
      <trkpt lat="45.0" lon="-75.0"/>
      <trkpt lat="46.0" lon="-76.0"/>
    </trkseg>
  </trk>
</gpx>`;

            const filePath = writeGpxFile('track.gpx', gpxContent);
            const result = await gpxAdapter.toGeoJson(filePath);
            const gj = result as { type: string; features: Array<{ type: string; geometry: { type: string; coordinates: number[][] } }> };

            assert.strictEqual(gj.type, 'FeatureCollection');
            assert.strictEqual(gj.features.length, 1);
            assert.strictEqual(gj.features[0].geometry.type, 'LineString');
        });

        test('should convert valid GPX with route to GeoJSON', async () => {
            const gpxContent = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1">
  <rte>
    <name>Test Route</name>
    <rtept lat="45.0" lon="-75.0"/>
    <rtept lat="46.0" lon="-76.0"/>
  </rte>
</gpx>`;

            const filePath = writeGpxFile('route.gpx', gpxContent);
            const result = await gpxAdapter.toGeoJson(filePath);
            const gj = result as { type: string; features: Array<{ type: string; geometry: { type: string; coordinates: number[][] } }> };

            assert.strictEqual(gj.type, 'FeatureCollection');
            assert.strictEqual(gj.features.length, 1);
            assert.strictEqual(gj.features[0].geometry.type, 'LineString');
        });

        test('should throw error for GPX with gpx root but zero parseable features', async () => {
            const gpxContent = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1">
</gpx>`;

            const filePath = writeGpxFile('empty.gpx', gpxContent);

            await assert.rejects(
                async () => {
                    await gpxAdapter.toGeoJson(filePath);
                },
                (err: Error) => {
                    assert.strictEqual(err.message, 'No recognizable GPX data found in file');
                    return true;
                }
            );
        });

        test('should throw error for GPX with gpx root and only metadata but no features', async () => {
            const gpxContent = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test">
  <metadata>
    <name>Empty Track</name>
  </metadata>
</gpx>`;

            const filePath = writeGpxFile('metadata-only.gpx', gpxContent);

            await assert.rejects(
                async () => {
                    await gpxAdapter.toGeoJson(filePath);
                },
                (err: Error) => {
                    assert.strictEqual(err.message, 'No recognizable GPX data found in file');
                    return true;
                }
            );
        });

        test('should not throw for file without gpx root tag that yields zero features', async () => {
            const filePath = writeGpxFile('not-gpx.txt', 'this is just plain text');

            const result = await gpxAdapter.toGeoJson(filePath);
            const gj = result as { type: string; features: unknown[] };

            assert.strictEqual(gj.type, 'FeatureCollection');
            assert.strictEqual(gj.features.length, 0);
        });

        test('should throw for GPX with gpx root tag in uppercase', async () => {
            const gpxContent = `<?xml version="1.0" encoding="UTF-8"?>
<GPX version="1.1">
</GPX>`;

            const filePath = writeGpxFile('uppercase.gpx', gpxContent);

            await assert.rejects(
                async () => {
                    await gpxAdapter.toGeoJson(filePath);
                },
                (err: Error) => {
                    assert.strictEqual(err.message, 'No recognizable GPX data found in file');
                    return true;
                }
            );
        });
    });

    suite('getName', () => {
        test('should return adapter name', () => {
            assert.strictEqual(gpxAdapter.getName(), 'GPX Adapter');
        });
    });

    suite('canHandle', () => {
        test('should return true for .gpx', () => {
            assert.strictEqual(gpxAdapter.canHandle('.gpx'), true);
        });

        test('should return true for .GPX', () => {
            assert.strictEqual(gpxAdapter.canHandle('.GPX'), true);
        });

        test('should return false for .kml', () => {
            assert.strictEqual(gpxAdapter.canHandle('.kml'), false);
        });

        test('should return false for .geojson', () => {
            assert.strictEqual(gpxAdapter.canHandle('.geojson'), false);
        });
    });
});
