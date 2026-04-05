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
 * Interface for file-to-GeoJSON adapters from external extensions.
 * Allows external extensions to convert custom file formats to GeoJSON.
 */
export interface FileToGeoJsonAdapter {
    /**
     * Returns the name of this adapter.
     */
    getName(): string;

    /**
     * Checks if this adapter can handle the given file extension.
     * @param fileExtension The file extension (including the dot, e.g., '.geojson', '.kml')
     * @returns True if this adapter can handle the file type
     */
    canHandle(fileExtension: string): boolean;

    /**
     * Converts a file to GeoJSON format.
     * @param filePath The absolute path to the file
     * @returns A promise resolving to the GeoJSON object
     */
    toGeoJson(filePath: string): Promise<object>;
}

/**
 * Public API for the MapLibre Viewer extension.
 * Allows external extensions to register custom basemaps and file adapters.
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

    /**
     * Register a file-to-GeoJSON adapter from an external extension.
     * @param adapter The adapter implementation
     * @returns A Disposable that removes the adapter when disposed
     */
    registerFileToGeoJsonAdapter(adapter: FileToGeoJsonAdapter): vscode.Disposable;

    /**
     * Get all registered file-to-GeoJSON adapters.
     */
    getFileToGeoJsonAdapters(): readonly FileToGeoJsonAdapter[];
}