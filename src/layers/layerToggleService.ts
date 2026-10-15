import * as vscode from 'vscode';
import { OverlayLayer } from './layerTypes';
import type { LayerTreeProvider } from './layerTreeProvider';
import type { ProviderManager } from '../map/providerManager';
import type { FileToGeoJsonAdapter } from '../services/api';
import { showOperationError } from '../extensionUtils';
import { resetFileSelectionState, handleFileSelection } from '../selectionHandler';

interface ToggleDeps {
    layerTreeProvider: LayerTreeProvider;
    providerManager: ProviderManager;
    fileToGeoJsonAdapters: FileToGeoJsonAdapter[];
    syncClipboardLayer: () => void;
}

/**
 * Toggles an overlay layer's visibility and runs extension-side back-fills
 * that depend on the new visibility: the "Selected file" layer is re-processed
 * from the active editor when it becomes visible, and clipboard watching is
 * synced when the clipboard layer changes.
 */
export function createToggleOverlayLayerWithBackfill(deps: ToggleDeps): (layer: OverlayLayer) => Promise<void> {
    const { layerTreeProvider, providerManager, fileToGeoJsonAdapters, syncClipboardLayer } = deps;

    return async (layer: OverlayLayer): Promise<void> => {
        try {
            await layerTreeProvider.toggleLayerVisibility(layer.id);

            // Back-fill the "Selected file" layer when it becomes visible:
            // while hidden, file activations were skipped, so re-process the
            // active editor now.
            if (layer.id === 'selected-file') {
                const selectedFileLayer = layerTreeProvider.getSelectedFileLayer();
                if (selectedFileLayer?.visible && vscode.window.activeTextEditor) {
                    resetFileSelectionState();
                    await handleFileSelection(
                        vscode.window.activeTextEditor,
                        layerTreeProvider,
                        providerManager,
                        fileToGeoJsonAdapters
                    );
                }
            }

            // Start/stop clipboard watching based on the layer's visibility
            if (layer.id === 'clipboard') {
                syncClipboardLayer();
            }
        } catch (error) {
            showOperationError('toggle layer', error);
        }
    };
}