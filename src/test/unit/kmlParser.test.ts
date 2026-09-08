import * as assert from 'assert';
import { parseKmlContent } from '../../services/kmlParser';

interface TestGeometry {
    type: string;
    coordinates: unknown;
}

function firstFeatureGeometry(content: string): TestGeometry {
    const collection = parseKmlContent(content) as { features: { geometry: TestGeometry }[] };
    assert.strictEqual(collection.features.length, 1, 'Should produce one feature');
    return collection.features[0].geometry;
}

suite('Kml Parser Test Suite', () => {

    test('should parse polygon with outer and inner boundaries as Polygon with both rings', () => {
        const kml = `<Placemark>
            <name>Hole polygon</name>
            <Polygon>
                <outerBoundaryIs>
                    <LinearRing><coordinates>0,0 10,0 10,10 0,10 0,0</coordinates></LinearRing>
                </outerBoundaryIs>
                <innerBoundaryIs>
                    <LinearRing><coordinates>2,2 4,2 4,4 2,4 2,2</coordinates></LinearRing>
                </innerBoundaryIs>
            </Polygon>
        </Placemark>`;
        const geometry = firstFeatureGeometry(kml);
        assert.strictEqual(geometry.type, 'Polygon');
        const rings = geometry.coordinates as number[][][];
        assert.strictEqual(rings.length, 2, 'Should have outer ring and one hole');
        assert.deepStrictEqual(rings[0], [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]);
        assert.deepStrictEqual(rings[1], [[2, 2], [4, 2], [4, 4], [2, 4], [2, 2]]);
    });

    test('should parse standalone LinearRing inside MultiGeometry as a Polygon in a GeometryCollection', () => {
        const kml = `<Placemark>
            <MultiGeometry>
                <LinearRing><coordinates>0,0 5,0 5,5 0,0</coordinates></LinearRing>
            </MultiGeometry>
        </Placemark>`;
        const collection = parseKmlContent(kml) as { features: { geometry: { type: string; geometries?: { type: string; coordinates: number[][][] }[] } }[] };
        const geometry = collection.features[0].geometry;
        assert.strictEqual(geometry.type, 'GeometryCollection');
        assert.strictEqual(geometry.geometries?.length, 1);
        assert.strictEqual(geometry.geometries[0].type, 'Polygon', 'LinearRing converts to single-ring Polygon');
        assert.deepStrictEqual(geometry.geometries[0].coordinates, [[[0, 0], [5, 0], [5, 5], [0, 0]]]);
    });

    test('should decode doubly-escaped ampersand-lt to literal text', () => {
        const kml = `<Placemark><name>&amp;lt;</name></Placemark>`;
        const collection = parseKmlContent(kml) as { features: { properties: Record<string, string> }[] };
        assert.strictEqual(collection.features[0].properties.name, '&lt;');
    });

    test('should decode simple ampersand entity', () => {
        const kml = `<Placemark><name>A &amp; B</name></Placemark>`;
        const collection = parseKmlContent(kml) as { features: { properties: Record<string, string> }[] };
        assert.strictEqual(collection.features[0].properties.name, 'A & B');
    });

    test('should decode hex numeric character reference to A', () => {
        const kml = `<Placemark><name>&#x41;</name></Placemark>`;
        const collection = parseKmlContent(kml) as { features: { properties: Record<string, string> }[] };
        assert.strictEqual(collection.features[0].properties.name, 'A');
    });

    test('should decode decimal numeric character reference to A', () => {
        const kml = `<Placemark><name>&#65;</name></Placemark>`;
        const collection = parseKmlContent(kml) as { features: { properties: Record<string, string> }[] };
        assert.strictEqual(collection.features[0].properties.name, 'A');
    });

    test('should keep elevation in coordinates when present', () => {
        const kml = `<Placemark>
            <LineString><coordinates>1,2,3 4,5,6</coordinates></LineString>
        </Placemark>`;
        const geometry = firstFeatureGeometry(kml);
        assert.strictEqual(geometry.type, 'LineString');
        const coords = geometry.coordinates as number[][];
        assert.deepStrictEqual(coords, [[1, 2, 3], [4, 5, 6]]);
    });

    test('should produce two-element position when elevation missing', () => {
        const kml = `<Placemark>
            <Point><coordinates>1,2</coordinates></Point>
        </Placemark>`;
        const geometry = firstFeatureGeometry(kml);
        assert.strictEqual(geometry.type, 'Point');
        assert.deepStrictEqual(geometry.coordinates, [1, 2]);
    });

    test('should drop invalid elevation and keep two-element position', () => {
        const kml = `<Placemark>
            <Point><coordinates>1,2,notanumber</coordinates></Point>
        </Placemark>`;
        const geometry = firstFeatureGeometry(kml);
        assert.strictEqual(geometry.type, 'Point');
        assert.deepStrictEqual(geometry.coordinates, [1, 2]);
    });

    test('should keep all geometries in a MultiGeometry', () => {
        const kml = `<Placemark>
            <MultiGeometry>
                <Point><coordinates>1,2</coordinates></Point>
                <LineString><coordinates>0,0 1,1</coordinates></LineString>
                <Polygon>
                    <outerBoundaryIs>
                        <LinearRing><coordinates>0,0 10,0 10,10 0,10 0,0</coordinates></LinearRing>
                    </outerBoundaryIs>
                </Polygon>
            </MultiGeometry>
        </Placemark>`;
        const collection = parseKmlContent(kml) as { features: { geometry: { type: string; geometries?: { type: string }[] } }[] };
        const geometry = collection.features[0].geometry;
        assert.strictEqual(geometry.type, 'GeometryCollection');
        assert.strictEqual(geometry.geometries?.length, 3);
        assert.deepStrictEqual(geometry.geometries?.map(g => g.type), ['Point', 'LineString', 'Polygon']);
    });

    test('should recurse into nested MultiGeometry elements', () => {
        const kml = `<Placemark>
            <MultiGeometry>
                <Point><coordinates>1,2</coordinates></Point>
                <MultiGeometry>
                    <Point><coordinates>3,4</coordinates></Point>
                </MultiGeometry>
            </MultiGeometry>
        </Placemark>`;
        const collection = parseKmlContent(kml) as { features: { geometry: { type: string; geometries?: { type: string }[] } }[] };
        const geometry = collection.features[0].geometry;
        assert.strictEqual(geometry.type, 'GeometryCollection');
        assert.strictEqual(geometry.geometries?.length, 2);
        assert.deepStrictEqual(geometry.geometries?.map(g => g.type), ['Point', 'GeometryCollection']);
    });

    test('should parse namespace-prefixed KML elements', () => {
        const kml = `<kml xmlns="http://www.opengis.net/kml/2.2">
            <kml:Placemark><kml:name>Prefixed</kml:name>
                <kml:Point><kml:coordinates>1,2</kml:coordinates></kml:Point>
            </kml:Placemark>
        </kml>`;
        const collection = parseKmlContent(kml) as { features: { properties: Record<string, string>; geometry: { type: string } }[] };
        assert.strictEqual(collection.features.length, 1);
        assert.strictEqual(collection.features[0].properties.name, 'Prefixed');
        assert.strictEqual(collection.features[0].geometry.type, 'Point');
    });

    test('should strip CDATA wrapper from description', () => {
        const kml = `<Placemark><description><![CDATA[<b>bold</b> text]]></description></Placemark>`;
        const collection = parseKmlContent(kml) as { features: { properties: Record<string, string> }[] };
        assert.strictEqual(collection.features[0].properties.description, '<b>bold</b> text');
    });

    test('should decode astral-plane numeric character references', () => {
        const kml = `<Placemark><name>&#128512;</name></Placemark>`;
        const collection = parseKmlContent(kml) as { features: { properties: Record<string, string> }[] };
        assert.strictEqual(collection.features[0].properties.name, '\u{1F600}');
    });

    test('should decode nbsp entity to a space', () => {
        const kml = `<Placemark><name>A&nbsp;B</name></Placemark>`;
        const collection = parseKmlContent(kml) as { features: { properties: Record<string, string> }[] };
        assert.strictEqual(collection.features[0].properties.name, 'A B');
    });
});