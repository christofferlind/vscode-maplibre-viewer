import * as vscode from 'vscode';
import { MapBookmark, BookmarkCollection, ViewState } from './bookmarkTypes';
import { BookmarkTreeProvider } from './bookmarkTreeProvider';
import { MapWebviewController } from '../map/mapWebviewController';
import { MapEditorProvider } from '../map/mapEditorProvider';
import { ProviderManager } from '../map/providerManager';
import { confirmAction, showOperationError } from '../extensionUtils';
import { formatCoordinates, formatViewState } from '../services/coordinateParser';
import { formatBookmarkDescriptionFromBookmark } from '../services/bookmarkFormatter';

/**
 * Storage key for bookmarks in globalState
 */
const BOOKMARKS_STORAGE_KEY = 'vscodeMaplibreViewer.bookmarks';

/**
 * Generates a unique ID for bookmarks
 * @returns A unique string identifier
 */
function generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

/**
 * Validates that a bookmark has valid data
 * @param bookmark The bookmark to validate
 * @returns True if valid, false otherwise
 */
function validateBookmark(bookmark: unknown): bookmark is MapBookmark {
    if (!bookmark || typeof bookmark !== 'object') {
        return false;
    }
    
    const b = bookmark as Partial<MapBookmark>;
    
    // Required fields
    if (typeof b.id !== 'string' || b.id.trim().length === 0) {
        return false;
    }
    if (typeof b.name !== 'string' || b.name.trim().length === 0) {
        return false;
    }
    if (!b.center || typeof b.center.latitude !== 'number' || typeof b.center.longitude !== 'number') {
        return false;
    }
    if (typeof b.zoom !== 'number') {
        return false;
    }
    
    // Validate coordinate ranges
    if (b.center.latitude < -90 || b.center.latitude > 90) {
        return false;
    }
    if (b.center.longitude < -180 || b.center.longitude > 180) {
        return false;
    }
    if (b.zoom < 0 || b.zoom > 24) {
        return false;
    }
    
    return true;
}

/**
 * Manages map view bookmarks with persistence using VSCode's globalState
 */
export class BookmarkManager {
    private readonly _globalState: vscode.Memento;
    
    /**
     * Creates a new BookmarkManager
     * @param globalState VSCode's globalState for persistent storage
     */
    constructor(globalState: vscode.Memento) {
        this._globalState = globalState;
    }
    
    /**
     * Gets the bookmark collection from storage
     * @returns The bookmark collection or creates a new one if none exists
     */
    private getCollection(): BookmarkCollection {
        const collection = this._globalState.get<BookmarkCollection>(BOOKMARKS_STORAGE_KEY);
        
        if (!collection) {
            return {
                version: 1,
                bookmarks: [],
                lastUpdated: new Date().toISOString()
            };
        }
        
        return collection;
    }
    
    /**
     * Saves the bookmark collection to storage
     * @param collection The collection to save
     */
    private async saveCollection(collection: BookmarkCollection): Promise<void> {
        collection.lastUpdated = new Date().toISOString();
        await this._globalState.update(BOOKMARKS_STORAGE_KEY, collection);
    }
    
    /**
     * Saves a new bookmark or updates an existing one
     * @param bookmark The bookmark to save
     * @returns The saved bookmark
     */
    public async saveBookmark(bookmark: MapBookmark): Promise<MapBookmark> {
        const collection = this.getCollection();
        
        // Check if bookmark with same ID exists (update case)
        const existingIndex = collection.bookmarks.findIndex(b => b.id === bookmark.id);
        
        if (existingIndex >= 0) {
            // Update existing bookmark
            bookmark.updatedAt = new Date().toISOString();
            collection.bookmarks[existingIndex] = bookmark;
        } else {
            // Add new bookmark
            if (!bookmark.id) {
                bookmark.id = generateId();
            }
            if (!bookmark.createdAt) {
                bookmark.createdAt = new Date().toISOString();
            }
            if (!bookmark.updatedAt) {
                bookmark.updatedAt = new Date().toISOString();
            }
            collection.bookmarks.push(bookmark);
        }
        
        await this.saveCollection(collection);
        return bookmark;
    }
    
    /**
     * Creates and saves a new bookmark from a view state
     * @param name The name for the bookmark
     * @param viewState The current view state
     * @param description Optional description
     * @returns The created bookmark
     */
    public async createBookmark(name: string, viewState: ViewState, description?: string): Promise<MapBookmark> {
        const now = new Date().toISOString();
        
        const bookmark: MapBookmark = {
            id: generateId(),
            name: name.trim(),
            description: description?.trim(),
            center: viewState.center,
            zoom: viewState.zoom,
            bearing: viewState.bearing || 0,
            pitch: viewState.pitch || 0,
            createdAt: now,
            updatedAt: now
        };
        
        return this.saveBookmark(bookmark);
    }
    
    /**
     * Gets a bookmark by its ID
     * @param id The bookmark ID
     * @returns The bookmark or undefined if not found
     */
    public getBookmark(id: string): MapBookmark | undefined {
        const collection = this.getCollection();
        return collection.bookmarks.find(b => b.id === id);
    }
    
    /**
     * Finds a bookmark by its name (case-insensitive)
     * @param name The bookmark name to search for
     * @returns The bookmark or undefined if not found
     */
    public findByName(name: string): MapBookmark | undefined {
        const collection = this.getCollection();
        const searchName = name.trim().toLowerCase();
        return collection.bookmarks.find(b => b.name.toLowerCase() === searchName);
    }
    
    /**
     * Gets all bookmarks
     * @returns Array of all bookmarks
     */
    public getAllBookmarks(): MapBookmark[] {
        const collection = this.getCollection();
        return [...collection.bookmarks];
    }
    
    /**
     * Deletes a bookmark by its ID
     * @param id The bookmark ID to delete
     * @returns True if deleted, false if not found
     */
    public async deleteBookmark(id: string): Promise<boolean> {
        const collection = this.getCollection();
        const index = collection.bookmarks.findIndex(b => b.id === id);
        
        if (index < 0) {
            return false;
        }
        
        collection.bookmarks.splice(index, 1);
        await this.saveCollection(collection);
        return true;
    }
    
    /**
     * Checks if a bookmark with the given name exists
     * @param name The name to check
     * @returns True if a bookmark with this name exists
     */
    public nameExists(name: string): boolean {
        return this.findByName(name) !== undefined;
    }
    
    /**
     * Updates an existing bookmark
     * @param id The bookmark ID
     * @param updates Partial bookmark data to update
     * @returns The updated bookmark or undefined if not found
     */
    public async updateBookmark(id: string, updates: Partial<MapBookmark>): Promise<MapBookmark | undefined> {
        const bookmark = this.getBookmark(id);
        
        if (!bookmark) {
            return undefined;
        }
        
        const updatedBookmark: MapBookmark = {
            ...bookmark,
            ...updates,
            id: bookmark.id, // Preserve ID
            createdAt: bookmark.createdAt, // Preserve creation time
            updatedAt: new Date().toISOString()
        };
        
        return this.saveBookmark(updatedBookmark);
    }
    
    /**
     * Clears all bookmarks
     */
    public async clearAll(): Promise<void> {
        await this._globalState.update(BOOKMARKS_STORAGE_KEY, undefined);
    }
    
    /**
     * Gets the count of bookmarks
     * @returns Number of bookmarks
     */
    public get count(): number {
        const collection = this.getCollection();
        return collection.bookmarks.length;
    }

    /**
     * Registers bookmark-related commands with VS Code
     * @param context The extension context
     * @param bookmarkTreeProvider The bookmark tree provider for UI updates
     * @param providerManager The provider manager for navigation
     * @returns Array of disposables for the registered commands
     */
    public registerCommands(
        context: vscode.ExtensionContext,
        bookmarkTreeProvider: BookmarkTreeProvider,
        providerManager: ProviderManager
    ): void {
        // Register command to navigate to a bookmark from the tree view
        context.subscriptions.push(
            vscode.commands.registerCommand('vscodeMaplibreViewer.goToBookmark', (bookmark: MapBookmark) => {
                providerManager.flyToBookmark(bookmark);
            })
        );

        // Register command to open a bookmark in the Map Editor panel
        context.subscriptions.push(
            vscode.commands.registerCommand('vscodeMaplibreViewer.openBookmarkInEditor', async (bookmark: MapBookmark) => {
                // Get the MapEditorProvider from the provider manager's providers
                const providers = providerManager.getProviders();
                const mapEditorProvider = providers.find((p): p is MapEditorProvider =>
                    p instanceof MapEditorProvider
                );
                
                if (!mapEditorProvider) {
                    vscode.window.showErrorMessage('Map Editor is not available');
                    return;
                }
                
                // Open the editor panel using the createPanel method
                await mapEditorProvider.createPanel();
                
                // Wait a bit for the panel to initialize, then fly to the bookmark
                setTimeout(() => {
                    providerManager.flyToBookmark(bookmark);
                }, 500);
            })
        );

        // Register command to delete a bookmark from the tree view context menu
        context.subscriptions.push(
            vscode.commands.registerCommand('vscodeMaplibreViewer.deleteBookmark', async (bookmark: MapBookmark) => {
                if (await confirmAction(`Are you sure you want to delete bookmark "${bookmark.name}"?`, 'Delete')) {
                    await this.deleteBookmark(bookmark.id);
                    bookmarkTreeProvider.refresh();
                }
            })
        );

        // Register save view command - opens QuickPick with existing bookmarks or option to create new
        // Uses MapWebviewController.lastActiveViewType to know which webview triggered the context menu
        context.subscriptions.push(
            vscode.commands.registerCommand('vscodeMaplibreViewer.saveBookmark', () => {
                const isEditor = MapWebviewController.lastActiveViewType === 'mapEditor';
                const providers = providerManager.getProviders();
                // Find the appropriate provider based on the active view type
                const provider = isEditor
                    ? providers.find(p => p.constructor.name === 'MapEditorProvider') || providers[0]
                    : providers.find(p => p.constructor.name === 'MapViewProvider') || providers[0];
                return this.handleSaveBookmark(bookmarkTreeProvider, provider);
            })
        );

        // Register load bookmark command - opens QuickPick with all bookmarks
        context.subscriptions.push(
            vscode.commands.registerCommand('vscodeMaplibreViewer.loadBookmark', () =>
                this.handleLoadBookmark(providerManager)
            )
        );
    }

    /**
     * Handles saving a bookmark
     */
    private async handleSaveBookmark(
        bookmarkTreeProvider: BookmarkTreeProvider,
        mapProvider: MapWebviewController
    ): Promise<void> {
        // Get current view state from the webview
        const viewState = await mapProvider.getCurrentViewState();
        
        if (!viewState) {
            vscode.window.showWarningMessage('Unable to get current map view. Please ensure the map is loaded.');
            return;
        }

        const bookmarks = this.getAllBookmarks();
        
        // Create QuickPick items: existing bookmarks + option to create new
        const items: (vscode.QuickPickItem & { bookmark?: MapBookmark; isNew?: boolean })[] = [
            {
                label: '$(add) Create New Bookmark...',
                description: 'Save current view as a new bookmark',
                isNew: true
            }
        ];
        
        // Add existing bookmarks if any
        if (bookmarks.length > 0) {
            items.push({
                label: '── Existing Bookmarks ──',
                kind: vscode.QuickPickItemKind.Separator
            });
            
            bookmarks.forEach(b => {
                items.push({
                    label: `$(bookmark) ${b.name}`,
                    description: formatCoordinates(b.center?.latitude ?? 0, b.center?.longitude ?? 0),
                    detail: formatViewState(b.zoom ?? 0, b.bearing ?? 0, b.pitch ?? 0),
                    bookmark: b
                });
            });
        }

        // Show QuickPick
        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select an existing bookmark to update or create a new one',
            matchOnDescription: true,
            matchOnDetail: true
        });

        // User cancelled the selection
        if (!selected) {
            return;
        }

        // Handle selection
        if (selected.isNew) {
            await this.createNewBookmark(bookmarkTreeProvider, viewState);
        } else if (selected.bookmark) {
            await this.updateExistingBookmark(bookmarkTreeProvider, selected.bookmark, viewState);
        }
    }

    /**
     * Creates a new bookmark
     */
    private async createNewBookmark(
        bookmarkTreeProvider: BookmarkTreeProvider,
        viewState: ViewState
    ): Promise<void> {
        const name = await vscode.window.showInputBox({
            prompt: 'Enter a name for this bookmark',
            placeHolder: 'e.g., Office Location',
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Name is required';
                }
                if (this.findByName(value)) {
                    return 'A bookmark with this name already exists';
                }
                return null;
            }
        });

        if (!name) {
            return;
        }

        try {
            const bookmark = await this.createBookmark(name, viewState);
            bookmarkTreeProvider.refresh();
            vscode.window.showInformationMessage(`Bookmark "${bookmark.name}" saved successfully.`);
        } catch (error) {
            showOperationError('save bookmark', error);
        }
    }

    /**
     * Updates an existing bookmark
     */
    private async updateExistingBookmark(
        bookmarkTreeProvider: BookmarkTreeProvider,
        bookmark: MapBookmark,
        viewState: ViewState
    ): Promise<void> {
        if (!await confirmAction(`Update "${bookmark.name}" with current view?`, 'Update')) {
            return;
        }

        try {
            await this.updateBookmark(bookmark.id, {
                center: viewState.center,
                zoom: viewState.zoom,
                bearing: viewState.bearing,
                pitch: viewState.pitch
            });
            bookmarkTreeProvider.refresh();
            vscode.window.showInformationMessage(`Bookmark "${bookmark.name}" updated successfully.`);
        } catch (error) {
            showOperationError('update bookmark', error);
        }
    }

    /**
     * Handles loading a bookmark
     */
    private async handleLoadBookmark(
        providerManager: ProviderManager
    ): Promise<void> {
        const bookmarks = this.getAllBookmarks();
        
        if (bookmarks.length === 0) {
            vscode.window.showInformationMessage('No bookmarks saved. Use "Save View" to create bookmarks.');
            return;
        }

        // Create QuickPick items from bookmarks using bookmarkFormatter
        const items: (vscode.QuickPickItem & { bookmark: MapBookmark })[] = bookmarks.map(b => {
            return {
                label: b.name,
                description: formatBookmarkDescriptionFromBookmark(b),
                detail: formatViewState(b.zoom ?? 0, b.bearing ?? 0, b.pitch ?? 0),
                bookmark: b
            };
        });

        // Show QuickPick
        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select a saved place to load',
            matchOnDescription: true,
            matchOnDetail: true
        });

        // User cancelled the selection
        if (!selected) {
            return;
        }

        // Fly to the selected bookmark on all map views
        providerManager.flyToBookmark(selected.bookmark);
    }
}