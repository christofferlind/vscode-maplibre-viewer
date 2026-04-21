import * as vscode from 'vscode';
import { BookmarkManager } from './bookmarkManager';
import { MapBookmark } from './bookmarkTypes';

/**
 * Command ID for renaming bookmarks
 */
export const RENAME_BOOKMARK_COMMAND_ID = 'vscodeMaplibreViewer.renameBookmark';

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
     * Registers the rename bookmark command with VS Code
     * @param context The extension context for subscription management
     */
    registerCommands(context: vscode.ExtensionContext): void {
        context.subscriptions.push(
            vscode.commands.registerCommand(
                RENAME_BOOKMARK_COMMAND_ID,
                (bookmark: MapBookmark) => this.renameBookmark(bookmark)
            )
        );
    }

    /**
     * Handles renaming a bookmark
     * @param bookmark The bookmark to rename (may be undefined if called from command palette)
     */
    private async renameBookmark(bookmark?: MapBookmark): Promise<void> {
        // Check if a bookmark node is selected
        if (!bookmark) {
            vscode.window.showErrorMessage('No bookmark selected. Please select a bookmark from the tree view.');
            return;
        }

        // Prompt user for new name with current name as default value
        const newName = await vscode.window.showInputBox({
            prompt: 'Enter a new name for the bookmark',
            placeHolder: 'Bookmark name',
            value: bookmark.name,
            valueSelection: [0, bookmark.name.length], // Select all text for easy replacement
            validateInput: (value: string): string | undefined => {
                const trimmedValue = value.trim();
                
                // Check for empty input
                if (!trimmedValue) {
                    return 'Bookmark name cannot be empty';
                }
                
                // Check if name already exists (excluding the current bookmark)
                const existingBookmark = this._bookmarkManager.findByName(trimmedValue);
                if (existingBookmark && existingBookmark.id !== bookmark.id) {
                    return 'A bookmark with this name already exists';
                }
                
                return undefined;
            }
        });

        // Handle user cancellation
        if (newName === undefined) {
            return;
        }

        // Handle empty input (should be caught by validation, but double-check)
        const trimmedName = newName.trim();
        if (!trimmedName) {
            vscode.window.showErrorMessage('Bookmark name cannot be empty.');
            return;
        }

        // Check if name is unchanged
        if (trimmedName === bookmark.name) {
            return;
        }

        try {
            // Update the bookmark's name in the data store
            const updatedBookmark = await this._bookmarkManager.updateBookmark(bookmark.id, {
                name: trimmedName
            });

            if (updatedBookmark) {
                // Refresh the tree view to reflect the changes
                this.refresh();
                vscode.window.showInformationMessage(`Bookmark renamed to "${trimmedName}" successfully.`);
            } else {
                vscode.window.showErrorMessage('Failed to rename bookmark. Bookmark not found.');
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to rename bookmark: ${errorMessage}`);
        }
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