import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

/**
 * Loads resources/scripts/map-search.js into a sandboxed context with DOM
 * stubs so the staleness/query-correlation logic can be exercised.
 */

interface PostedMessage {
    type: string;
    [key: string]: unknown;
}

interface Harness {
    search: Record<string, (...args: unknown[]) => unknown>;
    posted: PostedMessage[];
    setInputValue: (value: string) => void;
    fireInput: () => void;
    getVisible: () => boolean;
    getResultsHtml: () => string;
    respondWithResults: (results: unknown[], query?: string) => void;
    mapStubs: {
        flyToCalls: Array<{ center: [number, number] }>;
        panToCalls: Array<{ center: [number, number] }>;
    };
    markerCalls: Array<{ lat: number; lng: number }>;
}

function createHarness(): Harness {
    const sourcePath = path.join(__dirname, '..', '..', '..', 'resources', 'scripts', 'map-search.js');
    const source = fs.readFileSync(sourcePath, 'utf-8');

    const posted: PostedMessage[] = [];
    const listeners: Record<string, Array<(e?: unknown) => void>> = {};
    const elements: Record<string, SearchElement> = {};

interface SearchElement {
    value: string;
    style: Record<string, string>;
    classList: { add(c: string): void; remove(c: string): void; contains(c: string): boolean };
    innerHTML: string;
    addEventListener: (type: string, fn: (e?: unknown) => void) => void;
    focus: () => void;
    contains: (target: unknown) => boolean;
    querySelectorAll: () => { forEach: (fn: (item: unknown) => void) => void };
}

function makeElement(): SearchElement {
    const classSet = new Set<string>();
    return {
        value: '',
        style: {} as Record<string, string>,
        classList: {
            add: (c: string) => classSet.add(c),
            remove: (c: string) => classSet.delete(c),
            contains: (c: string) => classSet.has(c)
        },
        innerHTML: '',
        addEventListener: (type: string, fn: (e?: unknown) => void) => {
            const key = type;
            listeners[key] = listeners[key] || [];
            listeners[key].push(fn);
        },
        focus: () => undefined,
        contains: () => true,
        querySelectorAll: () => ({ forEach: () => undefined })
    };
}

    elements['search-container'] = makeElement();
    elements['search-input'] = makeElement();
    elements['search-results'] = makeElement();
    elements['search-clear-btn'] = makeElement();

    const mapStubs = {
        flyToCalls: [] as Array<{ center: [number, number] }>,
        panToCalls: [] as Array<{ center: [number, number] }>,
        flyTo: function (options: { center: [number, number] }): void {
            mapStubs.flyToCalls.push({ center: options.center });
        },
        panTo: function (center: [number, number], _options?: unknown): void {
            mapStubs.panToCalls.push({ center });
        }
    };

    const markerCalls: Array<{ lat: number; lng: number }> = [];

    const windowObj: Record<string, unknown> = {
        MapConfig: { enableSearch: true, searchResultsTransparency: 20 },
        MapCore: { getMap: () => mapStubs },
        MapUtils: { getConfig: () => 500, fitBoundsWithDefaults: () => undefined },
        MapNavigation: {
            showTemporaryMarker: (lat: number, lng: number) => {
                markerCalls.push({ lat, lng });
            },
            clearTemporaryMarkers: () => undefined
        }
    };
    windowObj.window = windowObj;

    const documentStub = {
        getElementById: (id: string) => elements[id] ?? null,
        addEventListener: () => undefined,
        createElement: () => {
            const el = { textContent: '', innerHTML: '', _text: '' };
            // Mimic textContent -> innerHTML escaping for the escapeHtml helper
            Object.defineProperty(el, 'textContent', {
                set: (value: string) => {
                    el._text = value;
                },
                get: () => el._text
            });
            Object.defineProperty(el, 'innerHTML', {
                get: () => {
                    return String(el._text ?? '')
                        .replace(/&/g, '&amp;')
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;');
                }
            });
            return el;
        },
        activeElement: null
    };

    const context: Record<string, unknown> = {
        window: windowObj,
        document: documentStub,
        console,
        setTimeout: (fn: () => void, _ms?: number) => setTimeout(fn, 0),
        clearTimeout,
        getComputedStyle: () => ({
            getPropertyValue: () => '#1e1e1e'
        }),
        sendMessage: (type: string, data: Record<string, unknown>) => {
            posted.push({ type, ...data });
        },
        vscode: {
            postMessage: (msg: PostedMessage) => {
                posted.push(msg);
            }
        }
    };

    vm.runInNewContext(source, context);

    const search = windowObj.MapSearch as Record<string, (...args: unknown[]) => unknown>;
    search.initialize();

    return {
        search,
        posted,
        setInputValue: (value: string) => {
            elements['search-input'].value = value;
        },
        fireInput: () => {
            (listeners['input'] || []).forEach((fn) => fn());
        },
        getVisible: () => elements['search-results'].classList.contains('visible'),
        getResultsHtml: () => elements['search-results'].innerHTML,
        respondWithResults: (results: unknown[], query?: string) => {
            search.handleGeocodingSearchResults(results, query);
        },
        mapStubs,
        markerCalls
    };
}

suite('MapSearch stale results (bug fix)', () => {
    let harness: Harness;

    function flushDebounce(): Promise<void> {
        return new Promise<void>((resolve) => {
            setTimeout(resolve, 10);
        });
    }

    setup(() => {
        harness = createHarness();
    });

    test('typing a query posts geocodingSearch with the trimmed query', () => {
        harness.setInputValue('paris ');
        harness.fireInput();

        // Debounce resolves on next macrotask
        return new Promise<void>((resolve) => {
            setTimeout(() => {
                const searches = harness.posted.filter((m) => m.type === 'geocodingSearch');
                assert.strictEqual(searches.length, 1);
                assert.strictEqual((searches[0] as unknown as { query: string }).query, 'paris');
                resolve();
            }, 10);
        });
    });

    test('backspacing below minimum cancels the pending search', () => {
        harness.setInputValue('paris');
        harness.fireInput();
        harness.setInputValue('p');
        harness.fireInput();

        return new Promise<void>((resolve) => {
            setTimeout(() => {
                const searches = harness.posted.filter((m) => m.type === 'geocodingSearch');
                assert.strictEqual(searches.length, 0, 'pending debounced search must be cancelled');
                resolve();
            }, 10);
        });
    });

    test('hideSearchResults cancels a pending search', () => {
        harness.setInputValue('paris');
        harness.fireInput();
        harness.search.clearResults();

        return new Promise<void>((resolve) => {
            setTimeout(() => {
                const searches = harness.posted.filter((m) => m.type === 'geocodingSearch');
                assert.strictEqual(searches.length, 0, 'pending debounced search must be cancelled on hide');
                resolve();
            }, 10);
        });
    });

    test('stale results for a different query are not rendered', async () => {
        harness.setInputValue('paris');
        harness.fireInput();
        await flushDebounce();
        harness.respondWithResults([{ name: 'Paris', type: 'city', lat: 48.85, lng: 2.35 }], 'paris');
        assert.ok(harness.getVisible(), 'matching query renders');

        // User clears; late response for old query arrives
        harness.search.clearResults();
        harness.respondWithResults([{ name: 'Paris', type: 'city', lat: 48.85, lng: 2.35 }], 'paris');
        assert.strictEqual(harness.getVisible(), false, 'cleared query must not re-render stale results');
    });

    test('results whose query does not match current input are ignored', async () => {
        harness.setInputValue('london');
        harness.fireInput();
        await flushDebounce();
        harness.respondWithResults([{ name: 'Paris', type: 'city', lat: 48.85, lng: 2.35 }], 'paris');
        assert.strictEqual(harness.getVisible(), false, 'mismatched query results must be ignored');
    });

    test('results matching the current query render', async () => {
        harness.setInputValue('paris');
        harness.fireInput();
        await flushDebounce();
        harness.respondWithResults([{ name: 'Paris', type: 'city', lat: 48.85, lng: 2.35 }], 'paris');
        assert.ok(harness.getVisible());
        assert.ok(harness.getResultsHtml().includes('Paris'));
    });

    test('transparency of 0 produces a valid rgba background', () => {
        const search = harness.search as unknown as { applyTransparency(p: number): void };
        assert.doesNotThrow(() => search.applyTransparency(0));
    });
});

suite('MapSearch point result pin', () => {
    let harness: Harness;

    setup(() => {
        harness = createHarness();
    });

    test('flyToResult shows a marker for a point result without bbox', () => {
        harness.search.flyToResult({ name: 'Paris', type: 'city', lat: 48.85, lng: 2.35 });

        assert.strictEqual(harness.mapStubs.flyToCalls.length, 1);
        assert.strictEqual(harness.mapStubs.flyToCalls[0]?.center[0], 2.35);
        assert.strictEqual(harness.mapStubs.flyToCalls[0]?.center[1], 48.85);
        assert.strictEqual(harness.markerCalls.length, 1, 'point result must show a pin');
        assert.deepStrictEqual(harness.markerCalls[0], { lat: 48.85, lng: 2.35 });
    });

    test('flyToResult does not show a pin for bbox results', () => {
        harness.search.flyToResult({
            name: 'France',
            type: 'country',
            lat: 46.6,
            lng: 2.4,
            bbox: { west: -5, south: 41, east: 9, north: 51 }
        });

        assert.strictEqual(harness.markerCalls.length, 0, 'area results must not show a pin');
    });

    test('hover preview shows a marker for point results', () => {
        harness.search.performSearch('paris');
        harness.respondWithResults([{ name: 'Paris', type: 'city', lat: 48.85, lng: 2.35 }], 'paris');
        harness.search.previewResultOnHover(0);

        assert.strictEqual(harness.markerCalls.length, 1, 'hover preview of point result must show a pin');
        assert.deepStrictEqual(harness.markerCalls[0], { lat: 48.85, lng: 2.35 });
    });
});