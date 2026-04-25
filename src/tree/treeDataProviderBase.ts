// src/tree/treeDataProviderBase.ts
import * as vscode from 'vscode';

/**
 * Abstract base class for TreeDataProvider implementations.
 * Provides common tree view functionality including refresh events
 * and optional change detection.
 */
export abstract class TreeDataProviderBase<T extends vscode.TreeItem> implements vscode.TreeDataProvider<T> {
    
    protected readonly _onDidChangeTreeData: vscode.EventEmitter<T | undefined | null | void> = 
        new vscode.EventEmitter<T | undefined | null | void>();
    
    readonly onDidChangeTreeData: vscode.Event<T | undefined | null | void> = 
        this._onDidChangeTreeData.event;
    
    /**
     * Trigger a refresh of the tree view.
     * @param item - Optional specific item to refresh. If not provided, refreshes entire tree.
     */
    refresh(item?: T): void {
        this._onDidChangeTreeData.fire(item);
    }
    
    /**
     * Get the tree item for display.
     * @param element - The element to get the tree item for
     */
    abstract getTreeItem(element: T): vscode.TreeItem;
    
    /**
     * Get children of the given element, or root elements if no element provided.
     * @param element - Optional parent element
     */
    abstract getChildren(element?: T): vscode.ProviderResult<T[]>;
    
    /**
     * Optional: Resolve the tree item for display (e.g., tooltips, icons).
     * Override this method if you need to dynamically resolve tree item properties.
     * @param item - The tree item to resolve
     * @param element - The element associated with the tree item
     */
    resolveTreeItem?(item: vscode.TreeItem, element: T, token: vscode.CancellationToken): vscode.ProviderResult<vscode.TreeItem>;
}