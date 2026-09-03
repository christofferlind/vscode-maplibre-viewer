import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { geojsonAdapter } from '../../adapters/geojsonAdapter';

suite('geojsonAdapter', () => {
    let tempDir: string;

    suiteSetup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geojson-adapter-test-'));
    });

    suiteTeardown(() => {
        if (tempDir) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('getName should return the adapter name', () => {
        assert.strictEqual(geojsonAdapter.getName(), 'GeoJSON Adapter');
    });

    suite('canHandle', () => {
        test('should accept .geojson extension', () => {
            assert.strictEqual(geojsonAdapter.canHandle('.geojson'), true);
        });

        test('should accept .json extension', () => {
            assert.strictEqual(geojsonAdapter.canHandle('.json'), true);
        });

        test('should accept uppercase extensions', () => {
            assert.strictEqual(geojsonAdapter.canHandle('.GEOJSON'), true);
            assert.strictEqual(geojsonAdapter.canHandle('.JSON'), true);
        });

        test('should reject unsupported extensions', () => {
            assert.strictEqual(geojsonAdapter.canHandle('.kml'), false);
            assert.strictEqual(geojsonAdapter.canHandle('.gpx'), false);
            assert.strictEqual(geojsonAdapter.canHandle('.txt'), false);
        });

        test('should reject missing dot extensions', () => {
            assert.strictEqual(geojsonAdapter.canHandle('geojson'), false);
        });
    });

    suite('toGeoJson', () => {
        test('should resolve valid GeoJSON FeatureCollection', async () => {
            const filePath = path.join(tempDir, 'valid.geojson');
            fs.writeFileSync(
                filePath,
                JSON.stringify({ type: 'FeatureCollection', features: [] })
            );

            const result = (await geojsonAdapter.toGeoJson(filePath)) as { type: string };
            assert.strictEqual(result.type, 'FeatureCollection');
        });

        test('should resolve a single Feature', async () => {
            const filePath = path.join(tempDir, 'feature.json');
            const feature = {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [0, 0] },
                properties: {}
            };
            fs.writeFileSync(filePath, JSON.stringify(feature));

            const result = await geojsonAdapter.toGeoJson(filePath);
            assert.deepStrictEqual(result, feature);
        });

        test('should throw when content is not valid GeoJSON', async () => {
            const filePath = path.join(tempDir, 'invalid.geojson');
            fs.writeFileSync(filePath, JSON.stringify({ type: 'Bogus' }));

            await assert.rejects(
                () => geojsonAdapter.toGeoJson(filePath),
                /does not contain valid GeoJSON/
            );
        });

        test('should wrap JSON syntax errors', async () => {
            const filePath = path.join(tempDir, 'broken.json');
            fs.writeFileSync(filePath, '{ not valid json ');

            await assert.rejects(
                () => geojsonAdapter.toGeoJson(filePath),
                /Failed to parse JSON/
            );
        });
    });
});
