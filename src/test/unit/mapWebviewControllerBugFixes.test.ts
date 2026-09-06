import * as assert from 'assert';
import { createRequire } from 'module';
import type * as vscode from 'vscode';
import type { BookmarkManager } from '../../bookmarks/bookmarkManager';
import { MockWebview } from '../testUtils/mockWebview';

/**
 * Unit tests for MapWebviewController bug fixes:
 * - concurrent getCurrentViewState/getMapCenter calls (single resolver slot)
 * - mapReadyPromise waits for the 'mapReady' message
 * - configUpdate payload has no initialViewState
 * - duplicate message listeners are not registered
 * - mapCenterResponse error path resolves undefined without a cast
 */

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
        return originalPrototypeRequire.call(this, id);
    };
    try {
        const moduleCache = (ModuleCtor as unknown as { _cache: Record<string, NodeModule | undefined> })._cache;
        for (const cached of [
            nodeRequire.resolve('../testUtils/testableController'),
            nodeRequire.resolve('../../map/mapWebviewController'),
            nodeRequire.resolve('../../map/mapWebviewUtils'),
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

suite('MapWebviewController concurrency bug fixes', () => {
    let mockWebview: MockWebview;
    let controller: TestableController;

    setup(() => {
        mockWebview = new MockWebview();
        controller = new TestableMapWebviewController({} as vscode.Uri, {} as BookmarkManager);
        controller.setWebview(mockWebview);
        type WithSetup = { setupMessageListener(w: MockWebview): void } & TestableController;
        (controller as unknown as WithSetup).setupMessageListener(mockWebview);
    });

    teardown(() => {
        mockWebview.clearMessages();
        mockWebview.clearTestHandlers();
    });

    function flushMicrotasks(): Promise<void> {
        return new Promise<void>((resolve) => {
            setTimeout(resolve, 0);
        });
    }

    const viewState = { center: { latitude: 59.33, longitude: 18.07 }, zoom: 10, bearing: 0, pitch: 0 };
    const center = { center: { latitude: 59.33, longitude: 18.07 }, zoom: 10, bearing: 0, pitch: 0 };

    test('two concurrent getCurrentViewState calls both resolve', async () => {
        const promiseA = controller.getCurrentViewState();
        const promiseB = controller.getCurrentViewState();

        // Let both requestViewState messages be posted
        await flushMicrotasks();
        assert.strictEqual(mockWebview.getMessagesOfType('requestViewState').length, 2);

        // One viewStateChanged message resolves both
        mockWebview.simulateMessage({ type: 'viewStateChanged', viewState: viewState });
        await Promise.race([
            Promise.all([promiseA, promiseB]),
            new Promise((_, reject) => setTimeout(() => reject(new Error('promises hung')), 250))
        ]);

        assert.deepStrictEqual(await promiseA, viewState, 'first caller must resolve');
        assert.deepStrictEqual(await promiseB, viewState, 'second caller must resolve');
    });

    test('two concurrent getMapCenter calls both resolve', async () => {
        const promiseA = controller.getMapCenter();
        const promiseB = controller.getMapCenter();

        await flushMicrotasks();
        assert.strictEqual(mockWebview.getMessagesOfType('getMapCenter').length, 2);

        mockWebview.simulateMessage({ type: 'mapCenterResponse', ...center });
        await Promise.race([
            Promise.all([promiseA, promiseB]),
            new Promise((_, reject) => setTimeout(() => reject(new Error('promises hung')), 250))
        ]);

        assert.deepStrictEqual(await promiseA, center, 'first caller must resolve');
        assert.deepStrictEqual(await promiseB, center, 'second caller must resolve');
    });

    test('timed-out getCurrentViewState resolves undefined without breaking the next call', async function () {
        this.timeout(12000);
        const first = controller.getCurrentViewState();
        await flushMicrotasks();

        const settled = await Promise.race([
            first.then((v) => ({ settled: true as const, value: v })),
            new Promise<{ settled: false }>((resolve) => setTimeout(() => resolve({ settled: false }), 6000))
        ]);
        assert.ok(settled.settled, 'first call must not hang forever');
        assert.strictEqual(settled.settled && settled.value, undefined);

        const second = controller.getCurrentViewState();
        mockWebview.simulateMessage({ type: 'viewStateChanged', viewState: viewState });
        await flushMicrotasks();
        assert.deepStrictEqual(await second, viewState, 'next call still works after a timeout');
    });

    test('mapCenterResponse error path resolves undefined (no cast crash)', async () => {
        const promise = controller.getMapCenter();
        await flushMicrotasks();
        mockWebview.simulateMessage({ type: 'mapCenterResponse', error: 'Map not initialized' });
        await flushMicrotasks();

        const result = await Promise.race([
            promise,
            new Promise((_, reject) => setTimeout(() => reject(new Error('promise hung')), 250))
        ]);
        assert.strictEqual(result, undefined);
    });

    test('mapReadyPromise resolves only after the mapReady message', async () => {
        let resolved = false;
        const ready = controller.mapReadyPromise.then(() => {
            resolved = true;
        });

        await flushMicrotasks();
        assert.strictEqual(resolved, false, 'must not resolve before the message arrives');

        mockWebview.simulateMessage({ type: 'mapReady' });
        await ready;
        assert.strictEqual(resolved, true);
    });

    test('configUpdate does not include initialViewState', async () => {
        await controller.testHandleWebviewMessage({ type: 'viewStateChanged', viewState });
        await flushMicrotasks();

        mockWebview.clearMessages();
        controller.updateConfiguration();

        const updates = mockWebview.getMessagesOfType('configUpdate');
        assert.strictEqual(updates.length, 1);
        const message = updates[0] as { config: Record<string, unknown> };
        assert.strictEqual(message.config.initialViewState, undefined,
            'initialViewState must only be used at initial webview load');
    });

    test('setupMessageListener registers only one listener per webview', () => {
        type WithSetup = { setupMessageListener(w: MockWebview): void } & TestableController;
        const withSetup = controller as unknown as WithSetup;

        // Setup already attached one listener; two more calls must not add more
        withSetup.setupMessageListener(mockWebview);
        withSetup.setupMessageListener(mockWebview);

        const listenerCount = (mockWebview as unknown as { _listeners: unknown[] })._listeners.length;
        assert.strictEqual(listenerCount, 1, 'duplicate listeners must not accumulate');
    });

    test('setupMessageListener re-registers when the webview instance changes', () => {
        type WithSetup = { setupMessageListener(w: MockWebview): void } & TestableController;
        const withSetup = controller as unknown as WithSetup;

        withSetup.setupMessageListener(mockWebview);
        const secondWebview = new MockWebview();
        withSetup.setupMessageListener(secondWebview);

        const firstCount = (mockWebview as unknown as { _listeners: unknown[] })._listeners.length;
        const secondCount = (secondWebview as unknown as { _listeners: unknown[] })._listeners.length;
        assert.strictEqual(firstCount, 0, 'old webview listener must be disposed');
        assert.strictEqual(secondCount, 1, 'new webview gets exactly one listener');
    });
});

suite('Camera command delivery while webview is loading (bug fix)', () => {
    /**
     * Webview stub whose postMessage returns false (message dropped) until
     * simulateLoaded() is called, mimicking a webview page that is still
     * loading when the extension posts camera commands.
     */
    class SlowLoadWebview implements vscode.Webview {
        public postedMessages: unknown[] = [];
        public loaded = false;
        public options: vscode.WebviewOptions = {};
        public html = '';
        public cspSource = 'mock';

        public postMessage(message: unknown): Thenable<boolean> {
            if (!this.loaded) {
                return Promise.resolve(false);
            }
            this.postedMessages.push(message);
            return Promise.resolve(true);
        }

        public asWebviewUri(uri: vscode.Uri): vscode.Uri {
            return uri;
        }

        public onDidReceiveMessage = (): { dispose: () => void } => ({ dispose: () => undefined });

        public simulateLoaded(): void {
            this.loaded = true;
        }
    }

    let webview: SlowLoadWebview;
    let controller: TestableController;

    setup(() => {
        webview = new SlowLoadWebview();
        controller = new TestableMapWebviewController({} as vscode.Uri, {} as BookmarkManager);
        controller.setWebview(webview);
        type WithSetup = { setupMessageListener(w: SlowLoadWebview): void } & TestableController;
        (controller as unknown as WithSetup).setupMessageListener(webview);
    });

    test('fitBoundsOnly posted while loading is delivered after mapReady', async () => {
        const bbox = {
            southwest: { latitude: 59.33, longitude: 18.07 },
            northeast: { latitude: 59.34, longitude: 18.08 }
        };
        controller.fitBoundsOnly(bbox);
        assert.strictEqual(webview.postedMessages.length, 0, 'message must be held while page is loading');

        webview.simulateLoaded();
        await controller.testHandleWebviewMessage({ type: 'mapReady' });

        const fits = webview.postedMessages.filter((m) => (m as Record<string, unknown>).type === 'fitBoundsOnly');
        assert.strictEqual(fits.length, 1, 'queued fit must be delivered on mapReady');
        assert.deepStrictEqual((fits[0] as Record<string, unknown>).boundingBox, bbox);
    });

    test('flyToLocation posted while loading is delivered after mapReady', async () => {
        controller.flyToLocation(59.33, 18.07, 14);
        assert.strictEqual(webview.postedMessages.length, 0);

        webview.simulateLoaded();
        await controller.testHandleWebviewMessage({ type: 'mapReady' });

        const flights = webview.postedMessages.filter((m) => (m as Record<string, unknown>).type === 'flyToLocation');
        assert.strictEqual(flights.length, 1);
    });

    test('messages posted while the webview accepts them are not duplicated', async () => {
        webview.simulateLoaded();
        const bbox = {
            southwest: { latitude: 1, longitude: 1 },
            northeast: { latitude: 2, longitude: 2 }
        };
        controller.fitBoundsOnly(bbox);
        assert.strictEqual(webview.postedMessages.length, 1, 'delivered immediately');

        await controller.testHandleWebviewMessage({ type: 'mapReady' });
        assert.strictEqual(webview.postedMessages.length, 1, 'no duplicate delivery on mapReady');
    });

    test('queued messages flush in order and only once', async () => {
        controller.flyToLocation(1, 2, 3);
        controller.flyToLocation(4, 5, 6);
        assert.strictEqual(webview.postedMessages.length, 0);

        webview.simulateLoaded();
        await controller.testHandleWebviewMessage({ type: 'mapReady' });
        assert.strictEqual(webview.postedMessages.length, 2);
        assert.strictEqual((webview.postedMessages[0] as Record<string, unknown>).latitude, 1);
        assert.strictEqual((webview.postedMessages[1] as Record<string, unknown>).latitude, 4);

        await controller.testHandleWebviewMessage({ type: 'mapReady' });
        assert.strictEqual(webview.postedMessages.length, 2, 'second mapReady must not re-deliver');
    });
});