import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
    isSupportedFileExtension,
    getSupportedExtensionsDisplay,
    validateFile,
    convertToGeoJson,
    getDefaultLayerName,
    SUPPORTED_EXTENSIONS
} from '../../services/fileConversionService';
import { parseKmlContent } from '../../services/kmlParser';
import { parseGpxContent } from '../../services/gpxParser';
import { parseCsvContent } from '../../services/csvParser';

suite('FileConversionService', () => {
    let tempDir: string;

    suiteSetup(() => {
        // Create a temporary directory for test files
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-conversion-test-'));
    });

    suiteTeardown(() => {
        // Clean up temporary directory
        if (tempDir && fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    suite('isSupportedFileExtension', () => {
        test('should return true for .geojson', () => {
            assert.strictEqual(isSupportedFileExtension('.geojson'), true);
        });

        test('should return true for .json', () => {
            assert.strictEqual(isSupportedFileExtension('.json'), true);
        });

        test('should return true for .kml', () => {
            assert.strictEqual(isSupportedFileExtension('.kml'), true);
        });

        test('should return true for .gpx', () => {
            assert.strictEqual(isSupportedFileExtension('.gpx'), true);
        });

        test('should return true for .csv', () => {
            assert.strictEqual(isSupportedFileExtension('.csv'), true);
        });

        test('should return true for .shp', () => {
            assert.strictEqual(isSupportedFileExtension('.shp'), true);
        });

        test('should return false for .txt', () => {
            assert.strictEqual(isSupportedFileExtension('.txt'), false);
        });

        test('should return false for .pdf', () => {
            assert.strictEqual(isSupportedFileExtension('.pdf'), false);
        });

        test('should return false for .png', () => {
            assert.strictEqual(isSupportedFileExtension('.png'), false);
        });

        test('should be case-insensitive', () => {
            assert.strictEqual(isSupportedFileExtension('.GEOJSON'), true);
            assert.strictEqual(isSupportedFileExtension('.KML'), true);
            assert.strictEqual(isSupportedFileExtension('.CSV'), true);
        });
    });

    suite('getSupportedExtensionsDisplay', () => {
        test('should return a string with all supported extensions', () => {
            const display = getSupportedExtensionsDisplay();
            assert.ok(display.includes('.geojson'));
            assert.ok(display.includes('.kml'));
            assert.ok(display.includes('.gpx'));
            assert.ok(display.includes('.csv'));
            assert.ok(display.includes('.shp'));
        });
    });

    suite('validateFile', () => {
        test('should return invalid for unsupported extension', () => {
            const filePath = path.join(tempDir, 'test.xyz');
            fs.writeFileSync(filePath, 'test content');
            
            const result = validateFile(filePath);
            assert.strictEqual(result.valid, false);
            assert.ok(result.error?.includes('Unsupported file format'));
            
            fs.unlinkSync(filePath);
        });

        test('should return invalid for non-existent file', () => {
            const filePath = path.join(tempDir, 'nonexistent.geojson');
            
            const result = validateFile(filePath);
            assert.strictEqual(result.valid, false);
            assert.ok(result.error?.includes('File not found'));
        });

        test('should return valid for existing .geojson file', () => {
            const filePath = path.join(tempDir, 'test.geojson');
            fs.writeFileSync(filePath, '{"type":"FeatureCollection","features":[]}');
            
            const result = validateFile(filePath);
            assert.strictEqual(result.valid, true);
            assert.strictEqual(result.extension, '.geojson');
            
            fs.unlinkSync(filePath);
        });

        test('should return invalid for .shp without accompanying files', () => {
            const filePath = path.join(tempDir, 'test.shp');
            fs.writeFileSync(filePath, 'binary content');
            
            const result = validateFile(filePath);
            assert.strictEqual(result.valid, false);
            assert.ok(result.error?.includes('missing required accompanying file'));
            
            fs.unlinkSync(filePath);
        });
    });

    suite('getDefaultLayerName', () => {
        test('should extract filename without extension', () => {
            assert.strictEqual(getDefaultLayerName('/path/to/myfile.geojson'), 'myfile');
        });

        test('should handle multiple dots in filename', () => {
            assert.strictEqual(getDefaultLayerName('/path/to/my.file.name.kml'), 'my.file.name');
        });

        test('should handle filename without path', () => {
            assert.strictEqual(getDefaultLayerName('test.gpx'), 'test');
        });
    });
});

suite('KmlParser', () => {
    test('should parse KML with Point', () => {
        const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <name>Test Point</name>
      <Point>
        <coordinates>12.345,67.890</coordinates>
      </Point>
    </Placemark>
  </Document>
</kml>`;
        
        const geojson = parseKmlContent(kml);
        const gj = geojson as { type: string; features: Array<{ type: string; geometry: { type: string; coordinates: number[] }; properties: { name?: string } }> };
        
        assert.strictEqual(gj.type, 'FeatureCollection');
        assert.strictEqual(gj.features.length, 1);
        assert.strictEqual(gj.features[0].geometry.type, 'Point');
        assert.deepStrictEqual(gj.features[0].geometry.coordinates, [12.345, 67.890]);
        assert.strictEqual(gj.features[0].properties.name, 'Test Point');
    });

    test('should parse KML with LineString', () => {
        const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Placemark>
    <name>Test Line</name>
    <LineString>
      <coordinates>0,0 1,1 2,2</coordinates>
    </LineString>
  </Placemark>
</kml>`;
        
        const geojson = parseKmlContent(kml);
        const gj = geojson as { type: string; features: Array<{ type: string; geometry: { type: string; coordinates: number[][] } }> };
        
        assert.strictEqual(gj.type, 'FeatureCollection');
        assert.strictEqual(gj.features.length, 1);
        assert.strictEqual(gj.features[0].geometry.type, 'LineString');
        assert.deepStrictEqual(gj.features[0].geometry.coordinates, [[0, 0], [1, 1], [2, 2]]);
    });

    test('should parse KML with Polygon', () => {
        const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Placemark>
    <Polygon>
      <outerBoundaryIs>
        <LinearRing>
          <coordinates>0,0 1,0 1,1 0,1 0,0</coordinates>
        </LinearRing>
      </outerBoundaryIs>
    </Polygon>
  </Placemark>
</kml>`;
        
        const geojson = parseKmlContent(kml);
        const gj = geojson as { type: string; features: Array<{ type: string; geometry: { type: string; coordinates: number[][][] } }> };
        
        assert.strictEqual(gj.type, 'FeatureCollection');
        assert.strictEqual(gj.features.length, 1);
        assert.strictEqual(gj.features[0].geometry.type, 'Polygon');
    });

    test('should return empty FeatureCollection for KML without Placemarks', () => {
        const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Empty Document</name>
  </Document>
</kml>`;
        
        const geojson = parseKmlContent(kml);
        const gj = geojson as { type: string; features: unknown[] };
        
        assert.strictEqual(gj.type, 'FeatureCollection');
        assert.strictEqual(gj.features.length, 0);
    });
});

suite('GpxParser', () => {
    test('should parse GPX with waypoints', () => {
        const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1">
  <wpt lat="45.0" lon="-75.0">
    <name>Waypoint 1</name>
  </wpt>
  <wpt lat="46.0" lon="-76.0">
    <name>Waypoint 2</name>
  </wpt>
</gpx>`;
        
        const geojson = parseGpxContent(gpx);
        const gj = geojson as { type: string; features: Array<{ type: string; geometry: { type: string; coordinates: number[][] } }> };
        
        assert.strictEqual(gj.type, 'FeatureCollection');
        assert.strictEqual(gj.features.length, 1);
        assert.strictEqual(gj.features[0].geometry.type, 'MultiPoint');
        assert.deepStrictEqual(gj.features[0].geometry.coordinates, [[-75.0, 45.0], [-76.0, 46.0]]);
    });

    test('should parse GPX with route', () => {
        const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1">
  <rte>
    <name>Test Route</name>
    <rtept lat="45.0" lon="-75.0"/>
    <rtept lat="46.0" lon="-76.0"/>
    <rtept lat="47.0" lon="-77.0"/>
  </rte>
</gpx>`;
        
        const geojson = parseGpxContent(gpx);
        const gj = geojson as { type: string; features: Array<{ type: string; geometry: { type: string; coordinates: number[][] } }> };
        
        assert.strictEqual(gj.type, 'FeatureCollection');
        assert.strictEqual(gj.features.length, 1);
        assert.strictEqual(gj.features[0].geometry.type, 'LineString');
    });

    test('should parse GPX with track', () => {
        const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1">
  <trk>
    <name>Test Track</name>
    <trkseg>
      <trkpt lat="45.0" lon="-75.0"/>
      <trkpt lat="46.0" lon="-76.0"/>
    </trkseg>
  </trk>
</gpx>`;
        
        const geojson = parseGpxContent(gpx);
        const gj = geojson as { type: string; features: Array<{ type: string; geometry: { type: string; coordinates: number[][] } }> };
        
        assert.strictEqual(gj.type, 'FeatureCollection');
        assert.strictEqual(gj.features.length, 1);
        assert.strictEqual(gj.features[0].geometry.type, 'LineString');
    });

    test('should return empty FeatureCollection for GPX without data', () => {
        const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1">
</gpx>`;
        
        const geojson = parseGpxContent(gpx);
        const gj = geojson as { type: string; features: unknown[] };
        
        assert.strictEqual(gj.type, 'FeatureCollection');
        assert.strictEqual(gj.features.length, 0);
    });
});

suite('CsvParser', () => {
    test('should parse CSV with lat/lng columns', () => {
        const csv = `name,lat,lng
Point 1,45.0,-75.0
Point 2,46.0,-76.0`;
        
        const geojson = parseCsvContent(csv);
        const gj = geojson as { type: string; features: Array<{ type: string; geometry: { type: string; coordinates: number[] }; properties: { name: string } }> };
        
        assert.strictEqual(gj.type, 'FeatureCollection');
        assert.strictEqual(gj.features.length, 2);
        assert.strictEqual(gj.features[0].geometry.type, 'Point');
        assert.deepStrictEqual(gj.features[0].geometry.coordinates, [-75.0, 45.0]);
        assert.strictEqual(gj.features[0].properties.name, 'Point 1');
    });

    test('should parse CSV with latitude/longitude columns', () => {
        const csv = `id,latitude,longitude
1,45.0,-75.0
2,46.0,-76.0`;
        
        const geojson = parseCsvContent(csv);
        const gj = geojson as { type: string; features: unknown[] };
        
        assert.strictEqual(gj.type, 'FeatureCollection');
        assert.strictEqual(gj.features.length, 2);
    });

    test('should parse CSV with lon/lat columns', () => {
        const csv = `name,lon,lat
Point 1,-75.0,45.0`;
        
        const geojson = parseCsvContent(csv);
        const gj = geojson as { type: string; features: Array<{ type: string; geometry: { type: string; coordinates: number[] } }> };
        
        assert.strictEqual(gj.type, 'FeatureCollection');
        assert.strictEqual(gj.features.length, 1);
        assert.deepStrictEqual(gj.features[0].geometry.coordinates, [-75.0, 45.0]);
    });

    test('should throw error for CSV without lat/lng columns', () => {
        const csv = `name,description,value
Point 1,test,100`;
        
        assert.throws(() => {
            parseCsvContent(csv);
        }, /Could not detect latitude\/longitude columns/);
    });

    test('should handle quoted CSV fields', () => {
        const csv = `"name","lat","lng"
"Point 1",45.0,-75.0`;
        
        const geojson = parseCsvContent(csv);
        const gj = geojson as { type: string; features: Array<{ type: string; geometry: { type: string; coordinates: number[] }; properties: { name: string } }> };
        
        assert.strictEqual(gj.type, 'FeatureCollection');
        assert.strictEqual(gj.features.length, 1);
        assert.strictEqual(gj.features[0].properties.name, 'Point 1');
    });

    test('should skip rows with invalid coordinates', () => {
        const csv = `name,lat,lng
Valid,45.0,-75.0
Invalid,invalid,invalid
Valid2,46.0,-76.0`;
        
        const geojson = parseCsvContent(csv);
        const gj = geojson as { type: string; features: unknown[] };
        
        assert.strictEqual(gj.type, 'FeatureCollection');
        assert.strictEqual(gj.features.length, 2);
    });
});