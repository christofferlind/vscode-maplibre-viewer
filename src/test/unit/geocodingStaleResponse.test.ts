import * as assert from 'assert';
import { createRequire } from 'module';
import type * as vscode from 'vscode';
import type { BookmarkManager } from '../../bookmarks/bookmarkManager';
import type { SearchResultData } from '../../services/geocodingSearch';
import { MockWebview } from '../testUtils/mockWebview';

/**
 * Unit tests for stale/out-of-order geocoding response handling in
 * MapWebviewController (Bug 3). The real geocoding service is replaced with
 * a stub whose promises are resolved manually, so request ordering can be
 * simulated deterministically.
 */

interface StubQuickPickItem {
    label: string;
    description?: string;
    detail?: string;
}

interface PendingGeocodingCall {
    query: string;
    searchResultsMap: Map<string, SearchResultData>;
    resolve: (items: StubQuickPickItem[]) => void;
    reject: (reason?: unknown) => void;
}

const pendingGeocodingCalls: PendingGeocodingCall[] = [];

const geocodingSearchStub: Record<string, unknown> = {
    performGeocodingSearch: (
        query: string,
        _geocodingApiKey: string | undefined,
        _photonSearchUrl: string,
        searchResultsMap: Map<string, SearchResultData>
    ): Promise<StubQuickPickItem[]> => {
        return new Promise<StubQuickPickItem[]>((resolve, reject) => {
            pendingGeocodingCalls.push({ query, searchResultsMap, resolve, reject });
        });
    }
};

const vscodeStub: Record<string, unknown> = {
    workspace: {
        getConfiguration: () => ({
            get: <T>(_key: string, defaultValue?: T) => defaultValue
        }),
        onDidChangeConfiguration: (): { dispose: () => void } => ({ dispose: (): void => undefined })
    },
    window: {
        createOutputChannel: (): { appendLine: () => void; show: () => void } => ({
            appendLine: (): void => undefined,
            show: (): void => undefined
        })
    }
};

const nodeRequire = createRequire(__filename);
const ModuleCtor = nodeRequire('module') as typeof import('module');
const originalPrototypeRequire = ModuleCtor.prototype.require;

type TestableController = import('../testUtils/testableController').TestableMapWebviewController;

const { TestableMapWebviewController } = ((): {
    TestableMapWebviewController: new (extensionUri: vscode.Uri, bookmarkManager: BookmarkManager) => TestableController;
} => {
    ModuleCtor.prototype.require = function (id: string): unknown {
        if (id === 'vscode') {
            return vscodeStub;
        }
        if (id === '../services/geocodingSearch') {
            return geocodingSearchStub;
        }
        return originalPrototypeRequire.call(this, id);
    };
    try {
        const moduleCache = (ModuleCtor as unknown as { _cache: Record<string, NodeModule | undefined> })._cache;
        for (const cached of [
            nodeRequire.resolve('../testUtils/testableController'),
            nodeRequire.resolve('../../map/mapWebviewController'),
            nodeRequire.resolve('../../map/mapWebviewUtils'),
            nodeRequire.resolve('../../services/geocodingSearch'),
            nodeRequire.resolve('../../services/configService')
        ]) {
            delete moduleCache[cached];
        }
        return nodeRequire('../testUtils/testableController') as {
            TestableMapWebviewController: new (extensionUri: vscode.Uri, bookmarkManager: BookmarkManager) => TestableController;
        };
    } finally {
        ModuleCtor.prototype.require = originalPrototypeRequire;
    }
})();

suite('Geocoding stale response handling', () => {
    let mockWebview: MockWebview;
    let controller: TestableController;

    setup(() => {
        pendingGeocodingCalls.length = 0;
        mockWebview = new MockWebview();
        controller = new TestableMapWebviewController({} as vscode.Uri, {} as BookmarkManager);
        controller.setWebview(mockWebview);
    });

    teardown(() => {
        mockWebview.clearMessages();
        mockWebview.clearTestHandlers();
        pendingGeocodingCalls.length = 0;
    });

    function flushMicrotasks(): Promise<void> {
        return new Promise<void>((resolve) => {
            setTimeout(resolve, 0);
        });
    }

    function createResults(
        searchResultsMap: Map<string, SearchResultData>,
        spec: Array<{ label: string; lat: number; lng: number }>
    ): StubQuickPickItem[] {
        return spec.map((item, index) => {
            const detail = `${item.label}-detail`;
            searchResultsMap.set(String(index), { lat: item.lat, lng: item.lng });
            return { label: item.label, description: 'city', detail };
        });
    }

    test('should discard stale results when a newer search resolves first', async () => {
        const promiseA = controller.testHandleWebviewMessage({ type: 'geocodingSearch', query: 'sto' });
        const promiseB = controller.testHandleWebviewMessage({ type: 'geocodingSearch', query: 'stockholm' });

        assert.strictEqual(pendingGeocodingCalls.length, 2, 'both searches should be in flight');
        const callA = pendingGeocodingCalls[0];
        const callB = pendingGeocodingCalls[1];

        callB.resolve(createResults(callB.searchResultsMap, [{ label: 'B-result', lat: 59.33, lng: 18.07 }]));
        await flushMicrotasks();

        callA.resolve(createResults(callA.searchResultsMap, [{ label: 'A-result', lat: 57.71, lng: 11.97 }]));
        await flushMicrotasks();

        await Promise.all([promiseA, promiseB]);

        const resultMessages = mockWebview.getMessagesOfType('geocodingSearchResults');
        assert.strictEqual(resultMessages.length, 1, 'only the newest search results should be posted');
        const message = resultMessages[0] as { results: Array<{ name: string; lat: number }> };
        assert.strictEqual(message.results.length, 1);
        assert.strictEqual(message.results[0].name, 'B-result');
        assert.strictEqual(message.results[0].lat, 59.33);

        assert.strictEqual(
            mockWebview.getMessagesOfType('geocodingSearchError').length,
            0,
            'stale success must not post an error either'
        );
    });

    test('should apply results when a single current search resolves', async () => {
        const promise = controller.testHandleWebviewMessage({ type: 'geocodingSearch', query: 'stockholm' });

        assert.strictEqual(pendingGeocodingCalls.length, 1);
        const call = pendingGeocodingCalls[0];
        call.resolve(createResults(call.searchResultsMap, [{ label: 'Stockholm', lat: 59.3293, lng: 18.0686 }]));
        await flushMicrotasks();
        await promise;

        const resultMessages = mockWebview.getMessagesOfType('geocodingSearchResults');
        assert.strictEqual(resultMessages.length, 1);
        const message = resultMessages[0] as {
            results: Array<{ name: string; lat: number; lng: number; type: string }>;
        };
        assert.strictEqual(message.results.length, 1);
        assert.strictEqual(message.results[0].name, 'Stockholm');
        assert.strictEqual(message.results[0].lat, 59.3293);
        assert.strictEqual(message.results[0].lng, 18.0686);
        assert.strictEqual(message.results[0].type, 'city');

        assert.strictEqual(mockWebview.getMessagesOfType('geocodingSearchError').length, 0);
    });

    test('should suppress stale error after a newer search already succeeded', async () => {
        const promiseA = controller.testHandleWebviewMessage({ type: 'geocodingSearch', query: 'sto' });
        const promiseB = controller.testHandleWebviewMessage({ type: 'geocodingSearch', query: 'stockholm' });

        const callA = pendingGeocodingCalls[0];
        const callB = pendingGeocodingCalls[1];

        callB.resolve(createResults(callB.searchResultsMap, [{ label: 'B-result', lat: 59.33, lng: 18.07 }]));
        await flushMicrotasks();

        callA.reject(new Error('stale network failure'));
        await flushMicrotasks();

        await Promise.all([promiseA, promiseB]);

        assert.strictEqual(mockWebview.getMessagesOfType('geocodingSearchResults').length, 1);
        assert.strictEqual(
            mockWebview.getMessagesOfType('geocodingSearchError').length,
            0,
            'stale failure must not clobber fresh results'
        );
    });

    test('should deliver error when the current search rejects', async () => {
        const promise = controller.testHandleWebviewMessage({ type: 'geocodingSearch', query: 'stockholm' });

        assert.strictEqual(pendingGeocodingCalls.length, 1);
        const call = pendingGeocodingCalls[0];
        call.reject(new Error('network down'));
        await flushMicrotasks();
        await promise;

        const errorMessages = mockWebview.getMessagesOfType('geocodingSearchError');
        assert.strictEqual(errorMessages.length, 1);
        const message = errorMessages[0] as { message: string };
        assert.strictEqual(message.message, 'Search failed. Please try again.');

        assert.strictEqual(mockWebview.getMessagesOfType('geocodingSearchResults').length, 0);
    });
});