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
        return Promise.resolve(true);
    }
    
    asWebviewUri(uri: vscode.Uri): vscode.Uri {
        return uri;
    }
    
    cspSource: string = 'mock-csp-source';
    
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