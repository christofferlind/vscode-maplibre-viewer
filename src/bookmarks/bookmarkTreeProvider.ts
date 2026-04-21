import * as vscode from 'vscode';
import { BookmarkManager } from './bookmarkManager';
import { MapBookmark } from './bookmarkTypes';

/**
 * Tree data provider for displaying map bookmarks in a TreeView
 */
export class BookmarkTreeProvider implements vscode.TreeDataProvider<MapBookmark> {
    private _onDidChangeTreeData: vscode.EventEmitter<MapBookmark | undefined | null> = 
        new vscode.EventEmitter<MapBookmark | undefined | null>();
    
    /**
     * Event that fires when the tree data changes
     */
    readonly onDidChangeTreeData: vscode.Event<MapBookmark | undefined | null> = 
        this._onDidChangeTreeData.event;

    /**
     * Creates a new BookmarkTreeProvider
     * @param bookmarkManager The bookmark manager for accessing bookmarks
     */
    constructor(
        private readonly _bookmarkManager: BookmarkManager
    ) {}

    /**
     * Gets the tree item for a bookmark
     * @param element The bookmark to get the tree item for
     * @returns A TreeItem representing the bookmark
     */
    getTreeItem(element: MapBookmark): vscode.TreeItem {
        const item = new vscode.TreeItem(element.name, vscode.TreeItemCollapsibleState.None);
        
        // Set description to show coordinates
        item.description = `${element.center.latitude.toFixed(4)}, ${element.center.longitude.toFixed(4)}`;
        
        // Set tooltip with detailed information
        item.tooltip = this.createTooltip(element);
        
        // Set the command to navigate to the bookmark when clicked
        item.command = {
            command: 'vscodeMaplibreViewer.goToBookmark',
            title: 'Go to Bookmark',
            arguments: [element]
        };
        
        // Set context value for context menu support
        item.contextValue = 'bookmark';
        
        // Use bookmark icon
        item.iconPath = new vscode.ThemeIcon('bookmark');
        
        return item;
    }

    /**
     * Gets the children of an element (root level - all bookmarks)
     * @param element The parent element (undefined for root)
     * @returns Array of bookmarks
     */
    getChildren(element?: MapBookmark): Thenable<MapBookmark[]> {
        if (element) {
            // Bookmarks don't have children, return empty array
            return Promise.resolve([]);
        }
        
        // Return all bookmarks from the bookmark manager
        return Promise.resolve(this._bookmarkManager.getAllBookmarks());
    }

    /**
     * Refreshes the tree view
     */
    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    /**
     * Creates a detailed tooltip for a bookmark
     * @param bookmark The bookmark to create a tooltip for
     * @returns Markdown string with bookmark details
     */
    private createTooltip(bookmark: MapBookmark): vscode.MarkdownString {
        const md = new vscode.MarkdownString();
        md.appendMarkdown(`**${bookmark.name}**\n\n`);
        
        if (bookmark.description) {
            md.appendMarkdown(`${bookmark.description}\n\n`);
        }
        
        md.appendMarkdown(`**Coordinates:** ${bookmark.center.latitude.toFixed(6)}, ${bookmark.center.longitude.toFixed(6)}\n\n`);
        md.appendMarkdown(`**Zoom:** ${bookmark.zoom.toFixed(1)}\n\n`);
        md.appendMarkdown(`**Bearing:** ${bookmark.bearing.toFixed(0)}°\n\n`);
        md.appendMarkdown(`**Pitch:** ${bookmark.pitch.toFixed(0)}°\n\n`);
        
        if (bookmark.tags && bookmark.tags.length > 0) {
            md.appendMarkdown(`**Tags:** ${bookmark.tags.join(', ')}\n\n`);
        }
        
        md.appendMarkdown(`*Created: ${new Date(bookmark.createdAt).toLocaleString()}*`);
        
        return md;
    }
}