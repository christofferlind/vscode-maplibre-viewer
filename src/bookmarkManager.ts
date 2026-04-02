import * as vscode from 'vscode';
import { MapBookmark, BookmarkCollection, ViewState } from './bookmarkTypes';

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
}