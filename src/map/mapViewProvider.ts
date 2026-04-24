import * as vscode from 'vscode';
import { BookmarkManager } from '../bookmarks/bookmarkManager';
import { MapWebviewController } from './mapWebviewController';

/**
 * Manages the MapLibre webview view (sidebar)
 * Extends MapWebviewController and implements WebviewViewProvider
 */
export class MapViewProvider extends MapWebviewController implements vscode.WebviewViewProvider {
    public static readonly viewType = 'mapsView';

    protected getViewType(): string {
        return 'mapsView';
    }

    private _view?: vscode.WebviewView;

    constructor(
        extensionUri: vscode.Uri,
        bookmarkManager: BookmarkManager,
        initialStyleUrl?: string,
        initialBaseMapId?: string
    ) {
        super(extensionUri, bookmarkManager, initialStyleUrl, initialBaseMapId);
    }

    /**
     * Gets the webview from the sidebar view
     */
    protected override getWebview(): vscode.Webview | undefined {
        return this._view?.webview;
    }

    /**
     * Called by VS Code when the webview view is resolved
     */
    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ): void {
        this._view = webviewView;

        webviewView.webview.options = this.getWebviewOptions();
        webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(
            (message: unknown) => {
                this.handleWebviewMessage(message);
            },
            undefined,
            []
        );
    }
}