import * as vscode from 'vscode';
import { BaseMapStyle } from './layerTypes';

/**
 * Interface for basemap providers from external extensions.
 * Required fields: id, name, styleUrl
 * Optional field: description
 */
export interface BasemapProvider {
    id: string;
    name: string;
    styleUrl: string;
    description?: string;
}

/**
 * Public API for the MapLibre Viewer extension.
 * Allows external extensions to register custom basemaps.
 */
export interface MapLibreViewerAPI {
    /**
     * Register a custom basemap from an external extension.
     * @param provider The basemap provider definition
     * @returns A Disposable that removes the basemap when disposed
     * @throws Error if provider is missing required fields
     */
    registerBasemap(provider: BasemapProvider): vscode.Disposable;
    
    /**
     * Get all registered basemaps (both built-in and external).
     */
    getBasemaps(): readonly BaseMapStyle[];
    
    /**
     * Get the currently active basemap.
     */
    getActiveBasemap(): BaseMapStyle | undefined;
    
    /**
     * Event fired when the active basemap changes.
     */
    onDidChangeActiveBasemap: vscode.Event<BaseMapStyle>;
}