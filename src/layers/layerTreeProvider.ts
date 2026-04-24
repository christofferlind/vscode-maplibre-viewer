import * as vscode from 'vscode';
import * as path from 'path';
import { BaseMapStyle, OverlayLayer, DEFAULT_OVERLAY_LAYERS, SELECTED_FILE_LAYER_ID } from './layerTypes';
import { FileToGeoJsonAdapter } from '../services/api';
import {
    validateFile,
    convertToGeoJson,
    getDefaultLayerName,
    isSupportedFileExtension,
    getSupportedExtensionsDisplay
} from '../services/fileConversionService';
import { calculateBoundingBoxFromGeoJson, BoundingBox } from '../services/coordinateParser';

/**
 * Tree item types for internal use
 */
type TreeItem = BaseMapStyle | OverlayLayer | 'baseMapsRoot' | 'layersRoot';

/**
 * MIME types for drag-and-drop operations
 */
const MIME_TEXT_URI_LIST = 'text/uri-list';
const MIME_APPLICATION_JSON = 'application/json';

/**
 * Tree data provider for managing map layers and base maps
 * Also implements TreeDragAndDropController for file drag-and-drop support
 */
export class LayerTreeProvider implements vscode.TreeDataProvider<TreeItem>, vscode.TreeDragAndDropController<TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<TreeItem | undefined | null> =
        new vscode.EventEmitter<TreeItem | undefined | null>();
    
    readonly onDidChangeTreeData: vscode.Event<TreeItem | undefined | null> =
        this._onDidChangeTreeData.event;

    private _baseMaps: BaseMapStyle[];
    private _externalBasemaps: Map<string, BaseMapStyle> = new Map();
    private _overlayLayers: OverlayLayer[];
    private _activeBaseMapId: string;
    private _extensionContext: vscode.ExtensionContext;
    
    /**
     * File-to-GeoJSON adapters for drag-and-drop conversion
     */
    private _fileAdapters: FileToGeoJsonAdapter[] = [];

    /**
     * Event emitter for layer changes
     */
    private _onDidChangeLayers: vscode.EventEmitter<{ type: 'baseMap' | 'overlay'; data: any }> =
        new vscode.EventEmitter<{ type: 'baseMap' | 'overlay'; data: any }>();
    
    /**
     * Event that fires when layers change
     */
    readonly onDidChangeLayers: vscode.Event<{ type: 'baseMap' | 'overlay'; data: any }> =
        this._onDidChangeLayers.event;
    
    /**
     * Event emitter for when a layer is added via drag-and-drop with bounding box
     */
    private _onDidAddLayerViaDragDrop: vscode.EventEmitter<{ layer: OverlayLayer; bbox: BoundingBox | null }> =
        new vscode.EventEmitter<{ layer: OverlayLayer; bbox: BoundingBox | null }>();
    
    /**
     * Event that fires when a layer is added via drag-and-drop
     * The bounding box can be used to zoom the map to fit the new layer
     */
    readonly onDidAddLayerViaDragDrop: vscode.Event<{ layer: OverlayLayer; bbox: BoundingBox | null }> =
        this._onDidAddLayerViaDragDrop.event;

    /**
     * MIME types that this controller can handle for drops
     */
    readonly dropMimeTypes: readonly string[] = [MIME_TEXT_URI_LIST];
    
    /**
     * MIME types that this controller can produce for drags (not used, but required by interface)
     */
    readonly dragMimeTypes: readonly string[] = [MIME_APPLICATION_JSON];

    constructor(context: vscode.ExtensionContext) {
        this._extensionContext = context;
        
        // Initialize base maps from configuration and external registrations
        this._baseMaps = [];
        this._rebuildBaseMaps();
        
        // Load overlay layers from globalState or use defaults
        this._overlayLayers = context.globalState.get<OverlayLayer[]>('overlayLayers')
            || [...DEFAULT_OVERLAY_LAYERS];
        
        // Ensure the "Selected file" layer always exists
        this._ensureSelectedFileLayer();
        
        // Load active base map from globalState or use first one, or 'basic' as fallback
        this._activeBaseMapId = context.globalState.get<string>('activeBaseMapId')
            || this._baseMaps[0]?.id
            || 'basic';
    }

    /**
     * Sets the file adapters to use for drag-and-drop conversion
     * @param adapters Array of FileToGeoJsonAdapter instances
     */
    setFileAdapters(adapters: FileToGeoJsonAdapter[]): void {
        this._fileAdapters = adapters;
    }

    /**
     * Handles the drag operation (required by TreeDragAndDropController)
     * We don't support dragging items out of the tree, so this is a no-op.
     */
    handleDrag(
        _source: readonly TreeItem[],
        _dataTransfer: vscode.DataTransfer,
        _token: vscode.CancellationToken
    ): void | Thenable<void> {
        // Not implemented - we don't support dragging items out of the layers view
    }

    /**
     * Handles the drop operation when files are dropped onto the tree view.
     * Validates the dropped files, converts them to GeoJSON, and creates new layers.
     */
    async handleDrop(
        target: TreeItem | undefined,
        sources: vscode.DataTransfer,
        _token: vscode.CancellationToken
    ): Promise<void> {
        // Get the URI list from the data transfer
        const uriList = sources.get(MIME_TEXT_URI_LIST);
        if (!uriList) {
            return;
        }

        // Parse the URI list - it's a string with one URI per line
        const uriListValue = uriList.value;
        if (typeof uriListValue !== 'string' || !uriListValue.trim()) {
            return;
        }

        const uris = uriListValue
            .split('\n')
            .map(u => u.trim())
            .filter(u => u.length > 0)
            .map(u => {
                try {
                    return vscode.Uri.parse(u);
                } catch {
                    return undefined;
                }
            })
            .filter((u): u is vscode.Uri => u !== undefined);

        if (uris.length === 0) {
            return;
        }

        // Process each dropped file
        const addedLayers: { layer: OverlayLayer; bbox: BoundingBox | null }[] = [];
        const errors: { file: string; error: string }[] = [];

        for (const uri of uris) {
            // Only handle file URIs
            if (uri.scheme !== 'file') {
                errors.push({
                    file: uri.toString(),
                    error: 'Only local files are supported'
                });
                continue;
            }

            const filePath = uri.fsPath;
            const result = await this._processDroppedFile(filePath);

            if (result.success && result.layer && result.bbox !== undefined) {
                addedLayers.push({ layer: result.layer, bbox: result.bbox });
            } else if (result.error) {
                errors.push({ file: path.basename(filePath), error: result.error });
            }
        }

        // Show error messages for failed files
        if (errors.length > 0) {
            const errorMessages = errors.map(e => `${e.file}: ${e.error}`).join('\n');
            if (errors.length === 1) {
                vscode.window.showErrorMessage(`Failed to add layer: ${errorMessages}`);
            } else {
                vscode.window.showErrorMessage(
                    `Failed to add ${errors.length} layer(s). See console for details.`
                );
                console.error('Drag-and-drop errors:\n' + errorMessages);
            }
        }

        // Show success message for added layers
        if (addedLayers.length > 0) {
            const layerNames = addedLayers.map(l => l.layer.name).join(', ');
            vscode.window.showInformationMessage(
                `Added ${addedLayers.length} layer(s): ${layerNames}`
            );

            // Fire events for each added layer
            for (const { layer, bbox } of addedLayers) {
                this._onDidAddLayerViaDragDrop.fire({ layer, bbox });
            }
        }
    }

    /**
     * Processes a single dropped file - validates and converts to a layer.
     */
    private async _processDroppedFile(filePath: string): Promise<{
        success: boolean;
        layer?: OverlayLayer;
        bbox?: BoundingBox | null;
        error?: string;
    }> {
        // Validate the file
        const validation = validateFile(filePath);
        if (!validation.valid) {
            return { success: false, error: validation.error };
        }

        try {
            // Convert to GeoJSON
            const geojson = await convertToGeoJson(filePath, this._fileAdapters);

            // Create a new layer
            const layerName = getDefaultLayerName(filePath);
            const layerId = `drag-drop-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

            const newLayer: OverlayLayer = {
                id: layerId,
                name: layerName,
                description: `Imported from ${path.basename(filePath)}`,
                type: 'geojson',
                source: {
                    type: 'geojson',
                    data: geojson
                },
                visible: true
            };

            // Add the layer
            await this.addOverlayLayer(newLayer);

            // Calculate bounding box for zooming
            const bbox = calculateBoundingBoxFromGeoJson(geojson);

            return { success: true, layer: newLayer, bbox };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return { success: false, error: errorMessage };
        }
    }

    /**
     * Ensures the "Selected file" layer exists in the overlay layers
     */
    private _ensureSelectedFileLayer(): void {
        const layerIndex = this._overlayLayers.findIndex(l => l.id === SELECTED_FILE_LAYER_ID);
        if (layerIndex === -1) {
            // Layer doesn't exist, create it
            this._overlayLayers.push({
                id: SELECTED_FILE_LAYER_ID,
                name: 'Selected file',
                description: 'Displays the currently selected file on the map',
                type: 'geojson',
                source: {
                    type: 'geojson',
                    data: { type: 'FeatureCollection', features: [] }
                },
                visible: false
            });
        }
    }

    /**
     * Gets the tree item for an element
     */
    getTreeItem(element: TreeItem): vscode.TreeItem {
        if (element === 'baseMapsRoot') {
            const item = new vscode.TreeItem('Base Maps', vscode.TreeItemCollapsibleState.Expanded);
            item.contextValue = 'baseMapsRoot';
            item.iconPath = new vscode.ThemeIcon('layers');
            return item;
        }

        if (element === 'layersRoot') {
            const item = new vscode.TreeItem('Overlay Layers', vscode.TreeItemCollapsibleState.Expanded);
            item.contextValue = 'layersRoot';
            item.iconPath = new vscode.ThemeIcon('layer');
            return item;
        }

        if (this.isBaseMapStyle(element)) {
            const baseMap = element;
            const item = new vscode.TreeItem(baseMap.name, vscode.TreeItemCollapsibleState.None);
            item.description = baseMap.description;
            item.tooltip = `${baseMap.name}\n${baseMap.styleUrl}`;
            item.contextValue = baseMap.id === this._activeBaseMapId ? 'activeBaseMap' : 'baseMap';
            item.iconPath = baseMap.id === this._activeBaseMapId 
                ? new vscode.ThemeIcon('check') 
                : new vscode.ThemeIcon('circle-outline');
            
            // Make clickable to set as active base map
            item.command = {
                command: 'vscodeMaplibreViewer.setBaseMap',
                title: 'Set Active Base Map',
                arguments: [baseMap]
            };
            
            return item;
        }

        if (this.isBaseMapRaster(element)) {
            const baseMap = element;
            const item = new vscode.TreeItem(baseMap.name, vscode.TreeItemCollapsibleState.None);
            item.description = baseMap.description;
            item.tooltip = `${baseMap.name}\n${baseMap.tileUrl}`;
            item.contextValue = baseMap.id === this._activeBaseMapId ? 'activeBaseMap' : 'baseMap';
            item.iconPath = baseMap.id === this._activeBaseMapId 
                ? new vscode.ThemeIcon('check') 
                : new vscode.ThemeIcon('circle-outline');
            
            // Make clickable to set as active base map
            item.command = {
                command: 'vscodeMaplibreViewer.setBaseMap',
                title: 'Set Active Base Map',
                arguments: [baseMap]
            };
            
            return item;
        }

        if (this.isOverlayLayer(element)) {
            const layer = element;
            const item = new vscode.TreeItem(layer.name, vscode.TreeItemCollapsibleState.None);
            item.description = layer.description;
            item.tooltip = `${layer.name}\nType: ${layer.type}\nVisible: ${layer.visible}`;
            item.contextValue = layer.visible ? 'visibleOverlayLayer' : 'overlayLayer';
            item.iconPath = layer.visible 
                ? new vscode.ThemeIcon('eye') 
                : new vscode.ThemeIcon('eye-closed');
            
            // Make clickable to toggle visibility
            item.command = {
                command: 'vscodeMaplibreViewer.toggleLayer',
                title: 'Toggle Layer Visibility',
                arguments: [layer]
            };
            
            return item;
        }

        // Fallback (shouldn't reach here)
        return new vscode.TreeItem('Unknown', vscode.TreeItemCollapsibleState.None);
    }

    /**
     * Gets the children of an element
     */
    getChildren(element?: TreeItem): Thenable<TreeItem[]> {
        if (!element) {
            // Root level - return the two category headers
            return Promise.resolve(['baseMapsRoot', 'layersRoot'] as TreeItem[]);
        }

        if (element === 'baseMapsRoot') {
            return Promise.resolve(this._baseMaps);
        }

        if (element === 'layersRoot') {
            return Promise.resolve(this._overlayLayers);
        }

        // No children for individual items
        return Promise.resolve([]);
    }

    /**
     * Gets the currently active base map
     */
    getActiveBaseMap(): BaseMapStyle | undefined {
        return this._baseMaps.find(bm => bm.id === this._activeBaseMapId);
    }

    /**
     * Gets all overlay layers
     */
    getOverlayLayers(): OverlayLayer[] {
        return [...this._overlayLayers];
    }

    /**
     * Gets visible overlay layers
     */
    getVisibleOverlayLayers(): OverlayLayer[] {
        return this._overlayLayers.filter(layer => layer.visible);
    }

    /**
     * Sets the active base map
     */
    async setActiveBaseMap(baseMapId: string): Promise<void> {
        const baseMap = this._baseMaps.find(bm => bm.id === baseMapId);
        if (!baseMap) {
            throw new Error(`Base map with id '${baseMapId}' not found`);
        }

        this._activeBaseMapId = baseMapId;
        await this._extensionContext.globalState.update('activeBaseMapId', baseMapId);
        
        // Notify listeners
        this._onDidChangeLayers.fire({ type: 'baseMap', data: baseMap });
        this.refresh();
    }

    /**
     * Toggles the visibility of an overlay layer
     */
    async toggleLayerVisibility(layerId: string): Promise<void> {
        const layerIndex = this._overlayLayers.findIndex(l => l.id === layerId);
        if (layerIndex === -1) {
            throw new Error(`Layer with id '${layerId}' not found`);
        }

        this._overlayLayers[layerIndex].visible = !this._overlayLayers[layerIndex].visible;
        await this._extensionContext.globalState.update('overlayLayers', this._overlayLayers);
        
        // Notify listeners
        this._onDidChangeLayers.fire({ 
            type: 'overlay', 
            data: this._overlayLayers[layerIndex] 
        });
        this.refresh();
    }

    /**
     * Adds a new overlay layer
     */
    async addOverlayLayer(layer: OverlayLayer): Promise<void> {
        // Check for duplicate ID
        if (this._overlayLayers.some(l => l.id === layer.id)) {
            throw new Error(`Layer with id '${layer.id}' already exists`);
        }

        this._overlayLayers.push(layer);
        await this._extensionContext.globalState.update('overlayLayers', this._overlayLayers);
        
        this._onDidChangeLayers.fire({ type: 'overlay', data: layer });
        this.refresh();
    }

    /**
     * Removes an overlay layer
     */
    async removeOverlayLayer(layerId: string): Promise<void> {
        const index = this._overlayLayers.findIndex(l => l.id === layerId);
        if (index === -1) {
            throw new Error(`Layer with id '${layerId}' not found`);
        }

        const removed = this._overlayLayers.splice(index, 1)[0];
        await this._extensionContext.globalState.update('overlayLayers', this._overlayLayers);
        
        this._onDidChangeLayers.fire({ type: 'overlay', data: removed });
        this.refresh();
    }

    /**
     * Refreshes the tree view
     */
    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    /**
     * Type guard for BaseMapStyle
     */
    private isBaseMapStyle(item: TreeItem): item is BaseMapStyle {
        return typeof item === 'object' && item !== null && 'styleUrl' in item;
    }

    /**
     * Type guard for BaseMapRaster
     */
    private isBaseMapRaster(item: TreeItem): item is BaseMapStyle {
        return typeof item === 'object' && item !== null && 'tileUrl' in item && item.type === 'raster';
    }

    /**
     * Type guard for OverlayLayer
     */
    private isOverlayLayer(item: TreeItem): item is OverlayLayer {
        return typeof item === 'object' && item !== null && 'visible' in item;
    }

    /**
     * Register a basemap from an external extension.
     * @param basemap The basemap to register
     * @returns A Disposable that removes the basemap when disposed
     */
    registerBasemap(basemap: BaseMapStyle): vscode.Disposable {
        // Validate required fields - must have id, name, and either styleUrl or tileUrl
        if (!basemap.id || !basemap.name) {
            throw new Error('Basemap must have id and name');
        }
        if (!basemap.styleUrl && !basemap.tileUrl) {
            throw new Error('Basemap must have either styleUrl or tileUrl');
        }
        
        // Check for duplicate ID
        if (this._baseMaps.some(bm => bm.id === basemap.id)) {
            console.warn(`Basemap '${basemap.id}' already exists, replacing`);
        }
        
        // Add to external basemaps map
        this._externalBasemaps.set(basemap.id, basemap);
        
        // Rebuild baseMaps array (defaults + external)
        this._rebuildBaseMaps();
        
        // Refresh the tree
        this._onDidChangeTreeData.fire(undefined);
        
        // Return disposable for cleanup
        return new vscode.Disposable(() => {
            this._externalBasemaps.delete(basemap.id);
            this._rebuildBaseMaps();
            this._onDidChangeTreeData.fire(undefined);
        });
    }

    /**
     * Rebuild the baseMaps array from configuration and external registrations
     */
    private _rebuildBaseMaps(): void {
        // Get basemaps from configuration
        const config = vscode.workspace.getConfiguration('vscodeMaplibreViewer');
        const configBaseMaps = config.get<BaseMapStyle[]>('baseMaps') || [];
        
        // Start with configured basemaps (no defaults)
        this._baseMaps = [...configBaseMaps];
        
        // Append external basemaps
        for (const basemap of this._externalBasemaps.values()) {
            // Remove any existing basemap with same ID (in case of replacement)
            this._baseMaps = this._baseMaps.filter(bm => bm.id !== basemap.id);
            this._baseMaps.push(basemap);
        }
    }

    /**
     * Public method to rebuild basemaps when configuration changes
     */
    rebuildBaseMaps(): void {
        this._rebuildBaseMaps();
        
        // If the currently active basemap no longer exists, switch to the first available
        if (this._baseMaps.length > 0 && !this._baseMaps.find(bm => bm.id === this._activeBaseMapId)) {
            this._activeBaseMapId = this._baseMaps[0].id;
            this._extensionContext.globalState.update('activeBaseMapId', this._activeBaseMapId);
        }
        
        // Notify listeners of the change
        const activeBaseMap = this.getActiveBaseMap();
        if (activeBaseMap) {
            this._onDidChangeLayers.fire({ type: 'baseMap', data: activeBaseMap });
        }
        
        this.refresh();
    }

    /**
     * Get all registered basemaps (both built-in and external)
     */
    getBasemaps(): readonly BaseMapStyle[] {
        return this._baseMaps;
    }

    /**
     * Updates the "Selected file" layer with new GeoJSON data.
     * The layer visibility is preserved - if the layer was disabled, it stays disabled.
     * If data is null/empty, the layer data is cleared but visibility is preserved.
     * @param geojson The GeoJSON data to display, or null/empty to clear
     */
    async updateSelectedFileLayer(geojson: object | null): Promise<void> {
        const layerIndex = this._overlayLayers.findIndex(l => l.id === SELECTED_FILE_LAYER_ID);
        
        // Layer should always exist (created in constructor), but handle missing case gracefully
        if (layerIndex === -1) {
            console.error('Selected file layer not found - this should not happen');
            return;
        }

        // Preserve current visibility
        const currentVisibility = this._overlayLayers[layerIndex].visible;
        
        if (geojson && Object.keys(geojson).length > 0) {
            // Update the layer with new data, preserve current visibility
            this._overlayLayers[layerIndex] = {
                ...this._overlayLayers[layerIndex],
                source: {
                    ...this._overlayLayers[layerIndex].source,
                    data: geojson
                },
                visible: currentVisibility
            };
        } else {
            // Clear the layer data, preserve visibility
            this._overlayLayers[layerIndex] = {
                ...this._overlayLayers[layerIndex],
                source: {
                    type: 'geojson',
                    data: { type: 'FeatureCollection', features: [] }
                },
                visible: currentVisibility
            };
        }

        // Persist the changes
        await this._extensionContext.globalState.update('overlayLayers', this._overlayLayers);
        
        // Notify listeners
        const layer = this._overlayLayers[layerIndex];
        this._onDidChangeLayers.fire({ type: 'overlay', data: layer });
        this.refresh();
    }

    /**
     * Gets the "Selected file" layer
     */
    getSelectedFileLayer(): OverlayLayer | undefined {
        return this._overlayLayers.find(l => l.id === SELECTED_FILE_LAYER_ID);
    }

    /**
     * Checks if the "Selected file" layer has no features (is empty).
     * @returns true if the layer has no features, false otherwise
     */
    isSelectedFileLayerEmpty(): boolean {
        const layer = this.getSelectedFileLayer();
        if (!layer || !layer.source || !layer.source.data) {
            return true;
        }

        const data = layer.source.data as { type: string; features: unknown[] };
        return !data.features || data.features.length === 0;
    }
}