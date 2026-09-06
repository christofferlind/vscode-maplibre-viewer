import * as assert from 'assert';
import { createRequire } from 'module';

// The vscode module only resolves inside the extension host; stub it so the
// geocodingSearch module can be imported in plain node unit tests.
const nodeRequire = createRequire(__filename);
const ModuleCtor = nodeRequire('module') as typeof import('module');
const vscodeStub = { window: {} };
const originalPrototypeRequire = ModuleCtor.prototype.require;
ModuleCtor.prototype.require = function (id: string): unknown {
    if (id === 'vscode') {
        return vscodeStub;
    }
    return originalPrototypeRequire.call(this, id);
};

const geocodingSearchModule = nodeRequire('../../services/geocodingSearch') as {
    performGeocodingSearch: typeof import('../../services/geocodingSearch')['performGeocodingSearch'];
    extractSearchTextFromArgs: typeof import('../../services/geocodingSearch')['extractSearchTextFromArgs'];
};
ModuleCtor.prototype.require = originalPrototypeRequire;

interface MockFeature {
    text?: string;
    place_name?: string;
    place_type?: string[];
    center?: [number, number];
    bbox?: [number, number, number, number];
    properties?: {
        name?: string;
        city?: string;
        state?: string;
        country?: string;
        osm_value?: string;
        osm_key?: string;
        extent?: [number, number, number, number];
    };
    context?: { id?: string; text?: string; short_code?: string }[];
    geometry?: { coordinates: [number, number] };
}

function createMockFetch(responseBody: { features: MockFeature[] }, capturedUrls: string[] = []): typeof fetch {
    const mockFetch = ((url: RequestInfo | URL) => {
        capturedUrls.push(url.toString());
        return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(responseBody)
        } as Response);
    }) as typeof fetch;
    return mockFetch;
}

suite('GeocodingSearch unit tests', () => {
    let originalFetch: typeof fetch;

    setup(() => {
        originalFetch = globalThis.fetch;
    });

    teardown(() => {
        globalThis.fetch = originalFetch;
    });

    suite('MapTiler result parsing', () => {
        test('should skip features without center coordinates', async () => {
            globalThis.fetch = createMockFetch({
                features: [
                    { text: 'No Center', place_type: ['place'] },
                    { text: 'Berlin', place_type: ['city'], center: [13.4, 52.5] }
                ]
            });

            const items = await geocodingSearchModule.performGeocodingSearch('berlin', 'test-key', 'https://photon.example/api/', new Map());

            assert.strictEqual(items.length, 1);
            assert.strictEqual(items[0].label, 'Berlin');
        });

        test('should keep feature with valid center and populate searchResultsMap', async () => {
            globalThis.fetch = createMockFetch({
                features: [
                    { text: 'Paris', place_type: ['city'], center: [2.35, 48.85] }
                ]
            });

            const resultsMap = new Map();
            const items = await geocodingSearchModule.performGeocodingSearch('paris', 'test-key', 'https://photon.example/api/', resultsMap);

            assert.strictEqual(items.length, 1);
            assert.strictEqual(resultsMap.size, 1);
            const values = Array.from(resultsMap.values());
            assert.strictEqual(values[0].lat, 48.85);
            assert.strictEqual(values[0].lng, 2.35);
        });

        test('should show type and country in the detail', async () => {
            globalThis.fetch = createMockFetch({
                features: [
                    {
                        text: 'Paris',
                        place_type: ['city'],
                        center: [2.35, 48.85],
                        context: [
                            { id: 'country.123', text: 'France' },
                            { id: 'region.456', text: 'Île-de-France' }
                        ]
                    }
                ]
            });

            const items = await geocodingSearchModule.performGeocodingSearch('paris', 'test-key', 'https://photon.example/api/', new Map());

            assert.strictEqual(items.length, 1);
            assert.strictEqual(items[0].detail, 'France');
        });

        test('should skip feature with empty center array', async () => {
            globalThis.fetch = createMockFetch({
                features: [
                    { text: 'Broken', place_type: ['place'], center: [] as unknown as [number, number] },
                    { text: 'Valid', place_type: ['place'], center: [1, 2] }
                ]
            });

            const items = await geocodingSearchModule.performGeocodingSearch('query', 'test-key', 'https://photon.example/api/', new Map());

            assert.strictEqual(items.length, 1);
            assert.strictEqual(items[0].label, 'Valid');
        });
    });

    suite('Photon result parsing', () => {
        test('should skip features without geometry coordinates', async () => {
            globalThis.fetch = createMockFetch({
                features: [
                    { properties: { name: 'No Geometry' } },
                    { properties: { name: 'Lyon' }, geometry: { coordinates: [4.83, 45.76] } }
                ]
            });

            const items = await geocodingSearchModule.performGeocodingSearch('lyon', undefined, 'https://photon.example/api/', new Map());

            assert.strictEqual(items.length, 1);
            assert.strictEqual(items[0].label, 'Lyon');
        });

        test('should keep feature with valid coordinates and populate searchResultsMap', async () => {
            globalThis.fetch = createMockFetch({
                features: [
                    { properties: { name: 'Oslo' }, geometry: { coordinates: [10.75, 59.91] } }
                ]
            });

            const resultsMap = new Map();
            const items = await geocodingSearchModule.performGeocodingSearch('oslo', undefined, 'https://photon.example/api/', resultsMap);

            assert.strictEqual(items.length, 1);
            assert.strictEqual(resultsMap.size, 1);
            const values = Array.from(resultsMap.values());
            assert.strictEqual(values[0].lat, 59.91);
            assert.strictEqual(values[0].lng, 10.75);
        });

        test('should show type and country in the detail', async () => {
            globalThis.fetch = createMockFetch({
                features: [
                    {
                        properties: { name: 'Oslo', country: 'Norway', osm_value: 'city' },
                        geometry: { coordinates: [10.75, 59.91] }
                    }
                ]
            });

            const items = await geocodingSearchModule.performGeocodingSearch('oslo', undefined, 'https://photon.example/api/', new Map());

            assert.strictEqual(items.length, 1);
            assert.strictEqual(items[0].detail, 'Norway');
        });

        test('should skip feature with empty coordinates array', async () => {
            globalThis.fetch = createMockFetch({
                features: [
                    { properties: { name: 'Broken' }, geometry: { coordinates: [] as unknown as [number, number] } }
                ]
            });

            const items = await geocodingSearchModule.performGeocodingSearch('query', undefined, 'https://photon.example/api/', new Map());

            assert.strictEqual(items.length, 0);
        });
    });

    suite('searchResultsMap index alignment (bug fix)', () => {
        test('MapTiler: keys align with item positions when early features are skipped', async () => {
            globalThis.fetch = createMockFetch({
                features: [
                    { text: 'No Center', place_type: ['place'] },
                    { text: 'Broken', place_type: ['place'], center: [] as unknown as [number, number] },
                    { text: 'First Valid', place_type: ['city'], center: [13.4, 52.5] },
                    { text: 'Second Valid', place_type: ['city'], center: [2.35, 48.85] }
                ]
            });

            const resultsMap = new Map();
            const items = await geocodingSearchModule.performGeocodingSearch('query', 'test-key', 'https://photon.example/api/', resultsMap);

            assert.strictEqual(items.length, 2);
            assert.strictEqual(resultsMap.get('0')?.lat, 52.5, 'item 0 must map to the first valid feature');
            assert.strictEqual(resultsMap.get('0')?.lng, 13.4);
            assert.strictEqual(resultsMap.get('1')?.lat, 48.85, 'item 1 must map to the second valid feature');
            assert.strictEqual(resultsMap.get('1')?.lng, 2.35);
            assert.strictEqual(resultsMap.get('2'), undefined);
        });

        test('Photon: keys align with item positions when early features are skipped', async () => {
            globalThis.fetch = createMockFetch({
                features: [
                    { properties: { name: 'No Geometry' } },
                    { properties: { name: 'First Valid' }, geometry: { coordinates: [4.83, 45.76] } },
                    { properties: { name: 'Second Valid' }, geometry: { coordinates: [10.75, 59.91] } }
                ]
            });

            const resultsMap = new Map();
            const items = await geocodingSearchModule.performGeocodingSearch('query', undefined, 'https://photon.example/api/', resultsMap);

            assert.strictEqual(items.length, 2);
            assert.strictEqual(resultsMap.get('0')?.lat, 45.76, 'item 0 must map to the first valid feature');
            assert.strictEqual(resultsMap.get('1')?.lat, 59.91, 'item 1 must map to the second valid feature');
        });
    });

    suite('bounding box normalization (bug fix)', () => {
        test('MapTiler: should normalize inverted bbox to southwest <= northeast', async () => {
            globalThis.fetch = createMockFetch({
                features: [
                    {
                        text: 'London',
                        place_type: ['place'],
                        center: [-0.127, 51.507],
                        bbox: [-0.1271581, 51.5076831, -0.1270541, 51.5075715]
                    }
                ]
            });

            const resultsMap = new Map();
            await geocodingSearchModule.performGeocodingSearch('london', 'test-key', 'https://photon.example/api/', resultsMap);

            const coords = resultsMap.get('0');
            assert.ok(coords?.bbox);
            assert.strictEqual(coords.bbox.southwest.latitude, 51.5075715);
            assert.strictEqual(coords.bbox.northeast.latitude, 51.5076831);
            assert.strictEqual(coords.bbox.southwest.longitude, -0.1271581);
            assert.strictEqual(coords.bbox.northeast.longitude, -0.1270541);
        });

        test('Photon: should normalize inverted extent to southwest <= northeast', async () => {
            globalThis.fetch = createMockFetch({
                features: [
                    {
                        properties: {
                            name: 'London',
                            extent: [-0.1271581, 51.5076831, -0.1270541, 51.5075715]
                        },
                        geometry: { coordinates: [-0.127, 51.507] }
                    }
                ]
            });

            const resultsMap = new Map();
            await geocodingSearchModule.performGeocodingSearch('london', undefined, 'https://photon.example/api/', resultsMap);

            const coords = resultsMap.get('0');
            assert.ok(coords?.bbox);
            assert.strictEqual(coords.bbox.southwest.latitude, 51.5075715);
            assert.strictEqual(coords.bbox.northeast.latitude, 51.5076831);
        });
    });

    suite('extractSearchTextFromArgs', () => {
        test('should extract selectionText from terminal context args', () => {
            const text = geocodingSearchModule.extractSearchTextFromArgs({ selectionText: '  Paris  ' });
            assert.strictEqual(text, 'Paris');
        });

        test('should return empty string for non-string args', () => {
            assert.strictEqual(geocodingSearchModule.extractSearchTextFromArgs(undefined), '');
            assert.strictEqual(geocodingSearchModule.extractSearchTextFromArgs({ lngLat: { lng: 1, lat: 2 } }), '');
        });
    });
});