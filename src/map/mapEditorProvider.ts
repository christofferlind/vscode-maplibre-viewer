import * as vscode from 'vscode';
import { BookmarkManager } from '../bookmarks/bookmarkManager';
import { MapWebviewController } from './mapWebviewController';

/**
 * Manages the MapLibre webview editor panel
 * Extends MapWebviewController for editor tab functionality
 */
export class MapEditorProvider extends MapWebviewController {
    private _panel?: vscode.WebviewPanel;

    protected getViewType(): string {
        return 'mapEditor';
    }

    constructor(
        extensionUri: vscode.Uri,
        bookmarkManager: BookmarkManager,
        initialStyleUrl?: string,
        initialBaseMapId?: string
    ) {
        super(extensionUri, bookmarkManager, initialStyleUrl, initialBaseMapId);
    }

    /**
     * Gets the webview from the editor panel
     */
    protected override getWebview(): vscode.Webview | undefined {
        return this._panel?.webview;
    }

    /**
     * Creates or reveals the webview panel
     */
    public async createPanel(column: vscode.ViewColumn = vscode.ViewColumn.One): Promise<vscode.WebviewPanel> {
        if (this._panel) {
            try {
                this._panel.reveal(column);
                return this._panel;
            } catch (e) {
                this._panel = undefined;
            }
        }

        this._panel = vscode.window.createWebviewPanel(
        	'mapEditor',
        	'Map Viewer Editor',
        	{
        		viewColumn: column
        	},
        	this.getWebviewOptions()
        );

        this._panel.webview.options = this.getWebviewOptions();
        this._panel.webview.html = this.getHtmlForWebview(this._panel.webview);

        this._panel.webview.onDidReceiveMessage(
            (message: unknown) => {
                this.handleWebviewMessage(message);
            },
            undefined,
            []
        );

        return this._panel;
    }
}