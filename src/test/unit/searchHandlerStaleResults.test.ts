import * as assert from 'assert';
import { createRequire } from 'module';

interface PendingRequest {
    query: string;
    map: Map<string, { lat: number; lng: number; bbox?: BBoxLike }>;
    items: Array<{ label: string; detail: string }>;
    mapData: Record<string, { lat: number; lng: number; bbox?: BBoxLike }>;
    resolve: () => void;
    reject: (err: Error) => void;
    resolved: boolean;
}

interface BBoxLike {
    southwest: { latitude: number; longitude: number };
    northeast: { latitude: number; longitude: number };
}

interface RecordedFit {
    southwest: { latitude: number; longitude: number };
    northeast: { latitude: number; longitude: number };
}

const nodeRequire = createRequire(__filename);
const ModuleCtor = nodeRequire('module') as typeof import('module');

interface QuickPickStub {
    placeholder: string;
    value: string;
    matchOnDescription: boolean;
    matchOnDetail: boolean;
    items: unknown[];
    busy: boolean;
    selectedItems: unknown[];
    shown: boolean;
    hidden: number;
    disposed: number;
    callbacks: Record<string, Array<(value: unknown) => void>>;
}

interface Harness {
    quickPick: QuickPickStub;
    errorMessages: string[];
    fitCalls: RecordedFit[];
    flyCalls: Array<[number, number, number]>;
    pendingRequests: PendingRequest[];
    fireValue: (value: string) => void;
    fireActive: (items: unknown[]) => void;
    fireAccept: () => void;
    flushDebounce: () => Promise<void>;
    resolveRequest: (request: PendingRequest, items: Array<{ label: string; detail: string }>, mapData: Record<string, { lat: number; lng: number; bbox?: BBoxLike }>) => void;
    rejectRequest: (request: PendingRequest, error: Error) => void;
    dispose: () => void;
}

function createHarness(): Harness {
    const quickPick: QuickPickStub = {
        placeholder: '',
        value: '',
        matchOnDescription: false,
        matchOnDetail: false,
        items: [],
        busy: false,
        selectedItems: [],
        shown: false,
        hidden: 0,
        disposed: 0,
        callbacks: {}
    } as QuickPickStub;

    const errorMessages: string[] = [];
    const fitCalls: RecordedFit[] = [];
    const flyCalls: Array<[number, number, number]> = [];
    const pendingRequests: PendingRequest[] = [];

    const registerCallback = (name: string): (fn: (value: unknown) => void) => unknown => {
        return (fn: (value: unknown) => void) => {
            quickPick.callbacks[name] = quickPick.callbacks[name] || [];
            quickPick.callbacks[name].push(fn);
            return { dispose: () => undefined };
        };
    };

    (quickPick as unknown as Record<string, unknown>).onDidChangeValue = registerCallback('onDidChangeValue');
    (quickPick as unknown as Record<string, unknown>).onDidChangeActive = registerCallback('onDidChangeActive');
    (quickPick as unknown as Record<string, unknown>).onDidAccept = registerCallback('onDidAccept');
    (quickPick as unknown as Record<string, unknown>).onDidHide = registerCallback('onDidHide');
    (quickPick as unknown as Record<string, unknown>).show = (): void => {
        quickPick.shown = true;
    };
    (quickPick as unknown as Record<string, unknown>).hide = (): void => {
        quickPick.hidden += 1;
    };
    (quickPick as unknown as Record<string, unknown>).dispose = (): void => {
        quickPick.disposed += 1;
    };

    const providerManager = {
        fitBoundsOnly: (bbox: RecordedFit): void => {
            fitCalls.push(bbox);
        },
        flyToLocation: (lat: number, lng: number, zoom: number): void => {
            flyCalls.push([lat, lng, zoom]);
        }
    };

    const vscodeStub: Record<string, unknown> = {
        window: {
            createQuickPick: () => quickPick,
            showErrorMessage: (message: string) => {
                errorMessages.push(message);
                return Promise.resolve(undefined);
            }
        },
        workspace: {
            getConfiguration: () => ({
                get: <T>(_key: string, defaultValue?: T): T | undefined => defaultValue
            }),
            onDidChangeConfiguration: () => ({ dispose: () => undefined })
        }
    };

    const geocodingStub: Record<string, unknown> = {
        performGeocodingSearch: (query: string, _apiKey: string, _url: string, map: Map<string, { lat: number; lng: number; bbox?: BBoxLike }>) => {
            const request: PendingRequest = {
                query,
                map,
                items: [],
                mapData: {},
                resolve: () => undefined,
                reject: () => undefined,
                resolved: false
            };
            const promise = new Promise<unknown>((resolve, reject) => {
                request.resolve = () => {
                    if (request.resolved) {
                        return;
                    }
                    request.resolved = true;
                    for (const [key, value] of Object.entries(request.mapData)) {
                        map.set(key, value);
                    }
                    resolve(request.items);
                };
                request.reject = (err: Error) => {
                    if (request.resolved) {
                        return;
                    }
                    request.resolved = true;
                    reject(err);
                };
            });
            pendingRequests.push(request);
            return promise;
        },
        extractSearchTextFromArgs: () => '',
        getSelectedTextFromEditor: () => ''
    };

    const terminalSelectionStub: Record<string, unknown> = {
        isTerminalContextArgs: () => false,
        resolveSelectedTextFromTerminalProbe: () => ''
    };

    const configServiceStub: Record<string, unknown> = {
        getConfig: () => ({
            get: <T>(_key: string, defaultValue?: T): T | undefined => defaultValue
        })
    };

    const originalPrototypeRequire = ModuleCtor.prototype.require;
    ModuleCtor.prototype.require = function (id: string): unknown {
        if (id === 'vscode') {
            return vscodeStub;
        }
        if (id.endsWith('services/geocodingSearch')) {
            return geocodingStub;
        }
        if (id.endsWith('services/terminalSelection')) {
            return terminalSelectionStub;
        }
        if (id.endsWith('services/configService')) {
            return configServiceStub;
        }
        return originalPrototypeRequire.call(this, id);
    };

    const searchHandlerPath = require.resolve('../../searchHandler');
    delete (ModuleCtor as unknown as { _cache: Record<string, unknown> })._cache[searchHandlerPath];

    let disposeDone = false;
    const loadAndRun = async (): Promise<void> => {
        const searchHandler = nodeRequire('../../searchHandler') as {
            handleSearchOnMap: (args: unknown, pm: unknown) => Promise<void>;
        };
        await searchHandler.handleSearchOnMap(undefined, providerManager);
    };

    const harness: Harness = {
        quickPick,
        errorMessages,
        fitCalls,
        flyCalls,
        pendingRequests,
        fireValue: (value: string) => {
            for (const fn of quickPick.callbacks.onDidChangeValue || []) {
                fn(value);
            }
        },
        fireActive: (items: unknown[]) => {
            for (const fn of quickPick.callbacks.onDidChangeActive || []) {
                fn(items);
            }
        },
        fireAccept: () => {
            for (const fn of quickPick.callbacks.onDidAccept || []) {
                fn(undefined);
            }
        },
        flushDebounce: () => new Promise(resolve => setTimeout(resolve, 350)),
        resolveRequest: (request, items, mapData) => {
            request.items = items;
            request.mapData = mapData;
            request.resolve();
        },
        rejectRequest: (request, error) => {
            request.reject(error);
        },
        dispose: () => {
            if (disposeDone) {
                return;
            }
            disposeDone = true;
            ModuleCtor.prototype.require = originalPrototypeRequire;
            delete (ModuleCtor as unknown as { _cache: Record<string, unknown> })._cache[searchHandlerPath];
        }
    };

    void loadAndRun();

    return harness;
}

suite('handleSearchOnMap stale result protection', () => {
    const itemB = { label: 'B-label', detail: 'B-detail' };
    const itemA = { label: 'A-label', detail: 'A-detail' };
    const bboxB: BBoxLike = {
        southwest: { latitude: 59.0, longitude: 18.0 },
        northeast: { latitude: 59.5, longitude: 18.5 }
    };
    const bboxA: BBoxLike = {
        southwest: { latitude: 1.0, longitude: 2.0 },
        northeast: { latitude: 2.0, longitude: 3.0 }
    };

    test('stale response cannot overwrite fresh results or coordinates', async () => {
        const h = createHarness();
        try {
            h.fireValue('sto');
            await h.flushDebounce();
            h.fireValue('stockholm');
            await h.flushDebounce();

            assert.strictEqual(h.pendingRequests.length, 2);
            const staleRequest = h.pendingRequests[0];
            const freshRequest = h.pendingRequests[1];
            assert.strictEqual(staleRequest.query, 'sto');
            assert.strictEqual(freshRequest.query, 'stockholm');

            h.resolveRequest(freshRequest, [itemB], { 'B-label-B-detail': { lat: 59.33, lng: 18.07, bbox: bboxB } });
            await new Promise(resolve => setTimeout(resolve, 0));
            assert.strictEqual(h.quickPick.items.length, 1);

            h.resolveRequest(staleRequest, [itemA], { 'A-label-A-detail': { lat: 1, lng: 2, bbox: bboxA } });
            await new Promise(resolve => setTimeout(resolve, 0));

            assert.strictEqual(h.quickPick.items.length, 1);
            assert.deepStrictEqual(h.quickPick.items[0], itemB);

            h.fireActive([itemB]);
            assert.strictEqual(h.fitCalls.length, 1);
            assert.deepStrictEqual(h.fitCalls[0], bboxB);
        } finally {
            h.dispose();
        }
    });

    test('stale item hover resolves no coordinates and does not move the map', async () => {
        const h = createHarness();
        try {
            h.fireValue('sto');
            await h.flushDebounce();
            h.fireValue('stockholm');
            await h.flushDebounce();

            h.resolveRequest(h.pendingRequests[1], [itemB], { 'B-label-B-detail': { lat: 59.33, lng: 18.07, bbox: bboxB } });
            await new Promise(resolve => setTimeout(resolve, 0));
            h.resolveRequest(h.pendingRequests[0], [itemA], { 'A-label-A-detail': { lat: 1, lng: 2, bbox: bboxA } });
            await new Promise(resolve => setTimeout(resolve, 0));

            const fitsBefore = h.fitCalls.length;
            const fliesBefore = h.flyCalls.length;
            h.fireActive([itemA]);
            assert.strictEqual(h.fitCalls.length, fitsBefore);
            assert.strictEqual(h.flyCalls.length, fliesBefore);
        } finally {
            h.dispose();
        }
    });

    test('accept uses the active request coordinates', async () => {
        const h = createHarness();
        try {
            h.fireValue('stockholm');
            await h.flushDebounce();

            h.resolveRequest(h.pendingRequests[0], [itemB], { 'B-label-B-detail': { lat: 59.33, lng: 18.07, bbox: bboxB } });
            await new Promise(resolve => setTimeout(resolve, 0));

            h.quickPick.selectedItems = [itemB];
            h.fireAccept();
            assert.strictEqual(h.fitCalls.length, 1);
            assert.deepStrictEqual(h.fitCalls[0], bboxB);
            assert.strictEqual(h.quickPick.hidden, 1);
        } finally {
            h.dispose();
        }
    });

    test('short input cancels pending search', async () => {
        const h = createHarness();
        try {
            h.fireValue('abc');
            await h.flushDebounce();
            assert.strictEqual(h.pendingRequests.length, 1);

            h.fireValue('x');
            h.resolveRequest(h.pendingRequests[0], [itemA], { 'A-label-A-detail': { lat: 1, lng: 2 } });
            await new Promise(resolve => setTimeout(resolve, 0));

            assert.strictEqual(h.quickPick.items.length, 0);
        } finally {
            h.dispose();
        }
    });

    test('stale rejection does not surface an error after fresh results', async () => {
        const h = createHarness();
        try {
            h.fireValue('sto');
            await h.flushDebounce();
            h.fireValue('stockholm');
            await h.flushDebounce();

            h.resolveRequest(h.pendingRequests[1], [itemB], { 'B-label-B-detail': { lat: 59.33, lng: 18.07 } });
            await new Promise(resolve => setTimeout(resolve, 0));
            h.rejectRequest(h.pendingRequests[0], new Error('stale failure'));
            await new Promise(resolve => setTimeout(resolve, 0));

            assert.strictEqual(h.errorMessages.length, 0);
            assert.strictEqual(h.quickPick.items.length, 1);
        } finally {
            h.dispose();
        }
    });
});