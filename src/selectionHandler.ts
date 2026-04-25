/**
 * Selection handler module for coordinate and file selection functionality
 */
import * as vscode from 'vscode';
import * as path from 'path';
import { parseCoordinate, parseMultipleCoordinates, calculateBoundingBox, extractCoordinatesFromGeoJson } from './services/coordinateParser';
import { LayerTreeProvider } from './layers/layerTreeProvider';
import { ProviderManager } from './map/providerManager';
import { FileToGeoJsonAdapter } from './services/api';

/**
 * Handles text selection for coordinate parsing
 */
export function handleTextSelection(providerManager: ProviderManager): void {
    // Get the active editor
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return;
    }

    // Get the selected text
    const selection = editor.selection;
    if (selection.isEmpty) {
        return;
    }

    const selectedText = editor.document.getText(selection);
    if (!selectedText || selectedText.trim().length === 0) {
        return;
    }

    // Try to parse multiple coordinates from the selected text
    const coordinates = parseMultipleCoordinates(selectedText);
    
    if (coordinates.length > 1) {
        // Multiple coordinates found - calculate bounding box and fit all
        const bbox = calculateBoundingBox(coordinates);
        if (bbox) {
            providerManager.fitBoundingBox(coordinates, bbox);
        }
    } else if (coordinates.length === 1) {
        // Single coordinate - fly to it with configured zoom level
        const config = vscode.workspace.getConfiguration('vscodeMaplibreViewer');
        const singlePointZoom = config.get<number>('singlePointZoom') ?? 14;
        providerManager.flyToLocation(coordinates[0].latitude, coordinates[0].longitude, singlePointZoom);
    } else {
        // Fallback: try single coordinate parsing for backward compatibility
        const coordinate = parseCoordinate(selectedText);
        if (coordinate) {
            providerManager.flyToLocation(coordinate.latitude, coordinate.longitude);
        }
    }
}

/**
 * Handles file selection for GeoJSON processing
 */
export async function handleFileSelection(
    editor: vscode.TextEditor,
    layerTreeProvider: LayerTreeProvider,
    providerManager: ProviderManager,
    fileToGeoJsonAdapters: FileToGeoJsonAdapter[]
): Promise<void> {
    const filePath = editor.document.uri.fsPath;
    console.log(`File selected in navigator: ${filePath}`);

    // Only clear the layer if it has content
    if (!layerTreeProvider.isSelectedFileLayerEmpty()) {
        await layerTreeProvider.updateSelectedFileLayer(null);
    }

    // Check if the "Selected file" layer is enabled
    const selectedFileLayer = layerTreeProvider.getSelectedFileLayer();
    if (selectedFileLayer && !selectedFileLayer.visible) {
        console.log('Selected file layer is disabled, skipping file processing');
        return;
    }

    // Check all registered file-to-GeoJSON adapters
    const fileExtension = path.extname(filePath).toLowerCase();
    for (const adapter of fileToGeoJsonAdapters) {
        if (adapter.canHandle(fileExtension)) {
            console.log(`Adapter "${adapter.getName()}" can handle ${fileExtension} files`);
            try {
                const geojson = await adapter.toGeoJson(filePath);
                
                // Update the selected file layer through the layer tree provider
                // This ensures the layer visibility state is properly managed
                await layerTreeProvider.updateSelectedFileLayer(geojson);
                
                // Extract coordinates from GeoJSON and fit map to bounding box
                // Use fitBoundsOnly to avoid creating blue markers - the GeoJSON layer already renders features
                const coordinates = extractCoordinatesFromGeoJson(geojson);
                if (coordinates.length > 0) {
                    const bbox = calculateBoundingBox(coordinates);
                    if (bbox) {
                        providerManager.fitBoundsOnly(bbox);
                    }
                }
                
                return; // Use the first adapter that can handle the file
            } catch (error) {
                console.error(`Error converting file with ${adapter.getName()} adapter:`, error);
            }
        }
    }
}