import * as vscode from 'vscode';
import { MapWebviewController } from '../../map/mapWebviewController';
import { BookmarkManager } from '../../bookmarks/bookmarkManager';

/**
 * A concrete, testable implementation of the abstract MapWebviewController.
 * This class exposes the protected getWebview method for testing purposes.
 */
export class TestableMapWebviewController extends MapWebviewController {
    private _webview: vscode.Webview | undefined;
    private _viewType: string = 'test-view';

    constructor(
        extensionUri: vscode.Uri,
        bookmarkManager: BookmarkManager,
        initialStyleUrl?: string,
        initialBaseMapId?: string
    ) {
        super(extensionUri, bookmarkManager, initialStyleUrl, initialBaseMapId);
    }

    /**
     * Sets the webview for testing
     */
    setWebview(webview: vscode.Webview | undefined): void {
        this._webview = webview;
    }

    /**
     * Gets the webview - override for testing
     */
    protected override getWebview(): vscode.Webview | undefined {
        return this._webview;
    }

    /**
     * Sets the view type for testing
     */
    setViewType(viewType: string): void {
        this._viewType = viewType;
    }

    /**
     * Returns the view type - override for testing
     */
    protected override getViewType(): string {
        return this._viewType;
    }

    /**
     * Exposes the handleWebviewMessage method for testing
     */
    public async testHandleWebviewMessage(message: unknown): Promise<void> {
        return this.handleWebviewMessage(message);
    }

    /**
     * Exposes the getHtmlForWebview method for testing
     */
    public testGetHtmlForWebview(webview: vscode.Webview, viewType?: string): string {
        return this.getHtmlForWebview(webview, viewType);
    }

    /**
     * Exposes the getConfiguration method for testing
     */
    public testGetConfiguration(): ReturnType<MapWebviewController['getConfiguration']> {
        return this.getConfiguration();
    }

    /**
     * Exposes the getWebviewOptions method for testing
     */
    public testGetWebviewOptions(): vscode.WebviewOptions {
        return this.getWebviewOptions();
    }
}