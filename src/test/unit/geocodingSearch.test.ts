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