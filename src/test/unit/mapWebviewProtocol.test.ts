import * as assert from 'assert';
import { MockWebview } from '../testUtils';

/**
 * Mock controller that mimics MapWebviewController's __testResponse,
 * viewStateChanged, and configUpdate handling without requiring the vscode module.
 * Mirrors the real implementation so tests verify the message protocol contract.
 */
class MockProtocolController {
    private _webview: MockWebview | undefined;
    private _requestIdCounter = 0;
    private _pendingTestResolves: Map<number, {
        resolve: (value: unknown) => void;
        reject: (reason?: unknown) => void;
        timeout: ReturnType<typeof setTimeout>;
    }> = new Map();
    private _viewType = 'test-view';
    public lastActiveViewType = 'mapsView';

    setWebview(webview: MockWebview | undefined): void {
        this._webview = webview;
    }

    setViewType(viewType: string): void {
        this._viewType = viewType;
    }

    async queryWebview(method: string, args?: unknown[], timeoutMs = 5000): Promise<unknown> {
        const webview = this._webview;
        if (!webview) {
            return undefined;
        }

        const requestId = ++this._requestIdCounter;

        return new Promise<unknown>((resolve, reject) => {
            const timeoutHandle = setTimeout(() => {
                this._pendingTestResolves.delete(requestId);
                resolve(undefined);
            }, timeoutMs);

            this._pendingTestResolves.set(requestId, { resolve, reject, timeout: timeoutHandle });

            webview.postMessage({
                type: '__testQuery',
                requestId,
                method,
                args: args || []
            });
        });
    }

    updateConfiguration(config: Record<string, unknown>): void {
        const webview = this._webview;
        if (!webview) {
            return;
        }
        webview.postMessage({
            type: 'configUpdate',
            config
        });
    }

    async handleWebviewMessage(message: unknown): Promise<void> {
        const msg = message as Record<string, unknown>;
        if (!msg || typeof msg.type !== 'string') {
            return;
        }

        switch (msg.type) {
            case '__testResponse': {
                const requestId = msg.requestId as number;
                const pending = this._pendingTestResolves.get(requestId);
                if (pending) {
                    clearTimeout(pending.timeout);
                    this._pendingTestResolves.delete(requestId);
                    const error = msg.error as string | undefined;
                    if (error) {
                        pending.reject(new Error(error));
                    } else {
                        pending.resolve(msg.result);
                    }
                }
                break;
            }

            case 'viewStateChanged': {
                this.lastActiveViewType = this._viewType;
                break;
            }
        }
    }
}

suite('MapWebview message protocol bug fixes', () => {
    let mockWebview: MockWebview;
    let controller: MockProtocolController;

    setup(() => {
        mockWebview = new MockWebview();
        controller = new MockProtocolController();
        controller.setWebview(mockWebview);
        mockWebview.onDidReceiveMessage((msg) => {
            void controller.handleWebviewMessage(msg);
        });
    });

    teardown(() => {
        mockWebview.clearMessages();
        mockWebview.clearTestHandlers();
    });

    suite('__testResponse error handling', () => {
        test('should reject queryWebview promise when response carries an error field', async () => {
            const queryPromise = controller.queryWebview('unknownMethod', undefined, 1000);

            const response = mockWebview.getMessagesOfType('__testQuery')[0] as Record<string, unknown>;

            mockWebview.simulateMessage({
                type: '__testResponse',
                requestId: response.requestId,
                result: undefined,
                error: 'Method not found: unknownMethod'
            });

            await assert.rejects(queryPromise, (err: Error) => {
                assert.strictEqual(err.message, 'Method not found: unknownMethod');
                return true;
            });
        });

        test('should resolve normally when response has no error field', async () => {
            mockWebview.onTestQuery('isAvailable', () => true);

            const result = await controller.queryWebview('isAvailable');

            assert.strictEqual(result, true);
        });

        test('should not reject when result is undefined but no error field present', async () => {
            mockWebview.onTestQuery('emptyMethod', () => undefined);

            const queryPromise = controller.queryWebview('emptyMethod', undefined, 1000);

            const response = mockWebview.getMessagesOfType('__testQuery')[0] as Record<string, unknown>;

            mockWebview.simulateMessage({
                type: '__testResponse',
                requestId: response.requestId,
                result: undefined
            });

            const result = await queryPromise;
            assert.strictEqual(result, undefined);
        });
    });

    suite('lastActiveViewType tracking on viewStateChanged', () => {
        test('should update lastActiveViewType when viewStateChanged is received', async () => {
            controller.setViewType('mapEditor');

            assert.strictEqual(controller.lastActiveViewType, 'mapsView');

            await controller.handleWebviewMessage({
                type: 'viewStateChanged',
                center: { latitude: 59.3293, longitude: 18.0686 },
                zoom: 12,
                bearing: 0,
                pitch: 0
            });

            assert.strictEqual(controller.lastActiveViewType, 'mapEditor');
        });

        test('should track the most recent view that reported state', async () => {
            controller.setViewType('mapEditor');
            await controller.handleWebviewMessage({ type: 'viewStateChanged', zoom: 10 });

            controller.setViewType('mapsView');
            await controller.handleWebviewMessage({ type: 'viewStateChanged', zoom: 11 });

            assert.strictEqual(controller.lastActiveViewType, 'mapsView');
        });
    });

    suite('configUpdate message payload', () => {
        test('should post configUpdate with enableSearch false in payload', () => {
            const config = {
                enableSearch: false,
                geocodingApiKey: 'key-123',
                photonSearchUrl: 'https://photon.example/api',
                searchResultsTransparency: 40,
                flyToDuration: 2000
            };

            controller.updateConfiguration(config);

            const messages = mockWebview.getMessagesOfType('configUpdate');
            assert.strictEqual(messages.length, 1, 'Should post exactly one configUpdate message');

            const message = messages[0] as Record<string, unknown>;
            const postedConfig = message.config as Record<string, unknown>;
            assert.strictEqual(postedConfig.enableSearch, false);
            assert.strictEqual(postedConfig.geocodingApiKey, 'key-123');
            assert.strictEqual(postedConfig.photonSearchUrl, 'https://photon.example/api');
        });

        test('should not post configUpdate when webview is unavailable', () => {
            controller.setWebview(undefined);

            controller.updateConfiguration({ enableSearch: false });

            assert.strictEqual(mockWebview.postedMessages.length, 0);
        });
    });
});