import * as assert from 'assert';
import { MockWebview } from '../testUtils';

class TestQueryController {
    private _webview: MockWebview | undefined;
    private _requestIdCounter = 0;
    private _pendingTestResolves: Map<number, (value: unknown) => void> = new Map();
    private _pendingTimeouts: Map<number, ReturnType<typeof setTimeout>> = new Map();

    setWebview(webview: MockWebview | undefined): void {
        this._webview = webview;
    }

    async queryWebview(method: string, args?: unknown[], timeoutMs?: number): Promise<unknown> {
        const webview = this._webview;
        if (!webview) {
            return undefined;
        }

        const requestId = ++this._requestIdCounter;
        const timeout = timeoutMs || 5000;

        return new Promise<unknown>((resolve) => {
            const timeoutHandle = setTimeout(() => {
                this._pendingTestResolves.delete(requestId);
                this._pendingTimeouts.delete(requestId);
                resolve(undefined);
            }, timeout);

            this._pendingTestResolves.set(requestId, resolve);
            this._pendingTimeouts.set(requestId, timeoutHandle);

            webview.postMessage({
                type: '__testQuery',
                requestId: requestId,
                method: method,
                args: args || []
            });
        });
    }

    handleWebviewMessage(message: unknown): void {
        const msg = message as Record<string, unknown>;
        if (msg.type === '__testResponse') {
            const requestId = msg.requestId as number;
            const resolve = this._pendingTestResolves.get(requestId);
            if (resolve) {
                const timeoutHandle = this._pendingTimeouts.get(requestId);
                if (timeoutHandle) {
                    clearTimeout(timeoutHandle);
                    this._pendingTimeouts.delete(requestId);
                }
                this._pendingTestResolves.delete(requestId);
                resolve(msg.result);
            }
        }
    }
}

suite('Test API - __testQuery Protocol', () => {
    let mockWebview: MockWebview;
    let controller: TestQueryController;

    setup(() => {
        mockWebview = new MockWebview();
        controller = new TestQueryController();
        controller.setWebview(mockWebview);
        mockWebview.onDidReceiveMessage((msg) => {
            controller.handleWebviewMessage(msg);
        });
        mockWebview.clearTestHandlers();
    });

    teardown(() => {
        mockWebview.clearMessages();
        mockWebview.clearTestHandlers();
    });

    suite('queryWebview with onTestQuery handlers', () => {
        test('should return result from registered handler', async () => {
            mockWebview.onTestQuery('getOverlayLayers', () => ({ layer1: { id: 'layer1', visible: true } }));

            const result = await controller.queryWebview('getOverlayLayers');

            assert.ok(result, 'Should receive a result');
            assert.deepStrictEqual(result, { layer1: { id: 'layer1', visible: true } });

            const queryMessages = mockWebview.getMessagesOfType('__testQuery');
            assert.strictEqual(queryMessages.length, 1, 'Should have sent one __testQuery');
        });

        test('should return undefined for unregistered handler', async () => {
            const result = await controller.queryWebview('unknownMethod');

            assert.strictEqual(result, undefined);

            const queryMessages = mockWebview.getMessagesOfType('__testQuery');
            assert.strictEqual(queryMessages.length, 1, 'Should have sent one __testQuery');
        });

        test('should pass arguments to handler', async () => {
            mockWebview.onTestQuery('getLayerVisibility', (args: unknown[]) => {
                return { layerId: args[0], visibility: 'none' };
            });

            const result = await controller.queryWebview('getLayerVisibility', ['test-layer']);

            assert.deepStrictEqual(result, { layerId: 'test-layer', visibility: 'none' });
        });

        test('should support multiple sequential queries', async () => {
            mockWebview.onTestQuery('getOverlaySource', () => ({ exists: true }));
            mockWebview.onTestQuery('getLayerVisibility', (args: unknown[]) => {
                if (args[0] === 'layer-a') {
                    return { visibility: 'visible' };
                }
                return { visibility: 'none' };
            });

            const source = await controller.queryWebview('getOverlaySource', ['layer-a']);
            const visA = await controller.queryWebview('getLayerVisibility', ['layer-a']);
            const visB = await controller.queryWebview('getLayerVisibility', ['layer-b']);

            assert.deepStrictEqual(source, { exists: true });
            assert.deepStrictEqual(visA, { visibility: 'visible' });
            assert.deepStrictEqual(visB, { visibility: 'none' });
        });

        test('should return undefined when no webview set', async () => {
            controller.setWebview(undefined);

            const result = await controller.queryWebview('getOverlayLayers');

            assert.strictEqual(result, undefined);
        });
    });

    suite('queryWebview message posting', () => {
        test('should post __testQuery with correct structure', async () => {
            mockWebview.onTestQuery('getAllOverlayState', () => ({}));

            await controller.queryWebview('getAllOverlayState');

            const queryMsgs = mockWebview.getMessagesOfType('__testQuery');
            const msg = queryMsgs[0] as Record<string, unknown>;

            assert.strictEqual(msg.type, '__testQuery');
            assert.strictEqual(msg.method, 'getAllOverlayState');
            assert.ok(msg.requestId !== undefined, 'Should have a requestId');
            assert.deepStrictEqual(msg.args, []);
        });

        test('should include args in posted message', async () => {
            mockWebview.onTestQuery('isOverlayLayerOnMap', () => true);

            await controller.queryWebview('isOverlayLayerOnMap', ['selected-file']);

            const queryMsgs = mockWebview.getMessagesOfType('__testQuery');
            const msg = queryMsgs[0] as Record<string, unknown>;

            assert.deepStrictEqual(msg.args, ['selected-file']);
        });

        test('should increment requestId for each query', async () => {
            mockWebview.onTestQuery('isAvailable', () => true);

            await controller.queryWebview('isAvailable');
            await controller.queryWebview('isAvailable');

            const queryMsgs = mockWebview.getMessagesOfType('__testQuery');
            assert.strictEqual(queryMsgs.length, 2);
            const msg1 = queryMsgs[0] as Record<string, unknown>;
            const msg2 = queryMsgs[1] as Record<string, unknown>;
            assert.notStrictEqual(msg1.requestId, msg2.requestId);
        });
    });

    suite('Layer toggle verification via __test', () => {
        test('should verify overlay becomes invisible after toggle', async () => {
            let currentVisibility = 'visible';
            mockWebview.onTestQuery('getLayerVisibility', () => {
                return { circles: currentVisibility, lines: currentVisibility, fills: currentVisibility };
            });

            const before = await controller.queryWebview('getLayerVisibility', ['test-layer']);
            assert.deepStrictEqual(before, { circles: 'visible', lines: 'visible', fills: 'visible' });

            currentVisibility = 'none';

            const after = await controller.queryWebview('getLayerVisibility', ['test-layer']);
            assert.deepStrictEqual(after, { circles: 'none', lines: 'none', fills: 'none' });
        });

        test('should verify overlay source existence', async () => {
            let sourceExists = true;
            mockWebview.onTestQuery('getOverlaySource', () => ({ exists: sourceExists, type: 'geojson' }));
            mockWebview.onTestQuery('isOverlayLayerOnMap', () => sourceExists);

            const before = await controller.queryWebview('getOverlaySource', ['test-layer']);
            assert.deepStrictEqual(before, { exists: true, type: 'geojson' });
            assert.strictEqual(await controller.queryWebview('isOverlayLayerOnMap', ['test-layer']), true);

            sourceExists = false;

            assert.strictEqual(await controller.queryWebview('isOverlayLayerOnMap', ['test-layer']), false);
        });

        test('should verify full overlay state dump', async () => {
            const fullState = {
                'layer-1': {
                    name: 'Layer 1',
                    visible: true,
                    onMap: true,
                    visibility: { circles: 'visible', lines: 'visible', fills: 'visible' },
                    source: { exists: true, type: 'geojson' }
                },
                'layer-2': {
                    name: 'Layer 2',
                    visible: false,
                    onMap: true,
                    visibility: { circles: 'none', lines: 'none', fills: 'none' },
                    source: { exists: true, type: 'geojson' }
                }
            };
            mockWebview.onTestQuery('getAllOverlayState', () => fullState);

            const result = await controller.queryWebview('getAllOverlayState');

            assert.ok(result, 'Should receive state');
            const state = result as Record<string, unknown>;
            assert.ok(state['layer-1']);
            assert.ok(state['layer-2']);
        });
    });
});
