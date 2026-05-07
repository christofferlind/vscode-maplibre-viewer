import type * as vscode from 'vscode';

/**
 * Mock implementation of vscode.Webview that captures posted messages
 * for testing purposes.
 */
export class MockWebview implements vscode.Webview {
    public postedMessages: unknown[] = [];
    public options: vscode.WebviewOptions = {};
    public html: string = '';
    private _listeners: Array<(e: unknown) => any> = [];
    private _testHandlers: Map<string, (args: unknown[]) => unknown> = new Map();
    
    public onDidReceiveMessage: vscode.Event<unknown> = (listener: (e: unknown) => any) => {
        this._listeners.push(listener);
        return {
            dispose: () => {
                const index = this._listeners.indexOf(listener);
                if (index !== -1) {
                    this._listeners.splice(index, 1);
                }
            }
        };
    };
    
    postMessage(message: unknown): Thenable<boolean> {
        this.postedMessages.push(message);
        this._handleTestQuery(message);
        return Promise.resolve(true);
    }
    
    asWebviewUri(uri: vscode.Uri): vscode.Uri {
        return uri;
    }
    
    cspSource: string = 'mock-csp-source';
    
    /**
     * Register a handler for a __testQuery method.
     * When the extension posts a __testQuery for this method,
     * the handler is called and a __testResponse is simulated back.
     * @param method - The method name to handle
     * @param handler - Function that receives args and returns the result
     */
    onTestQuery(method: string, handler: (args: unknown[]) => unknown): void {
        this._testHandlers.set(method, handler);
    }

    /**
     * Clears all registered test query handlers
     */
    clearTestHandlers(): void {
        this._testHandlers.clear();
    }

    private _handleTestQuery(message: unknown): void {
        const msg = message as Record<string, unknown>;
        if (msg.type !== '__testQuery') {
            return;
        }
        const method = msg.method as string;
        const requestId = msg.requestId as number;
        const args = (msg.args as unknown[]) || [];
        const handler = this._testHandlers.get(method);
        let result;
        if (handler) {
            try {
                result = handler(args);
            } catch (e) {
                result = undefined;
            }
        }
        this.simulateMessage({
            type: '__testResponse',
            requestId: requestId,
            result: result
        });
    }

    /**
     * Clears all captured messages
     */
    clearMessages(): void {
        this.postedMessages = [];
    }
    
    /**
     * Gets the last posted message
     */
    getLastMessage(): unknown | undefined {
        return this.postedMessages[this.postedMessages.length - 1];
    }
    
    /**
     * Gets all messages of a specific type
     */
    getMessagesOfType(type: string): unknown[] {
        return this.postedMessages.filter(msg => {
            const typedMsg = msg as Record<string, unknown>;
            return typedMsg && typedMsg.type === type;
        });
    }
    
    /**
     * Simulates receiving a message from the webview
     */
    simulateMessage(message: unknown): void {
        this._listeners.forEach(listener => listener(message));
    }
}