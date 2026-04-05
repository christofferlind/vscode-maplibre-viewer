import * as vscode from 'vscode';
import { BaseMapStyle, OverlayLayer, DEFAULT_OVERLAY_LAYERS, SELECTED_FILE_LAYER_ID } from './layerTypes';

/**
 * Tree item types for internal use
 */
type TreeItem = BaseMapStyle | OverlayLayer | 'baseMapsRoot' | 'layersRoot';

/**
 * Tree data provider for managing map layers and base maps
 */
export class LayerTreeProvider implements vscode.TreeDataProvider<TreeItem> {
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
     * Event emitter for layer changes
     */
    private _onDidChangeLayers: vscode.EventEmitter<{ type: 'baseMap' | 'overlay'; data: any }> = 
        new vscode.EventEmitter<{ type: 'baseMap' | 'overlay'; data: any }>();
    
    /**
     * Event that fires when layers change
     */
    readonly onDidChangeLayers: vscode.Event<{ type: 'baseMap' | 'overlay'; data: any }> = 
        this._onDidChangeLayers.event;

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
        // Validate required fields
        if (!basemap.id || !basemap.name || !basemap.styleUrl) {
            throw new Error('Basemap must have id, name, and styleUrl');
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
}