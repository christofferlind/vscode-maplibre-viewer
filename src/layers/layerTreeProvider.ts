import * as vscode from 'vscode';
import { BaseMapStyle, OverlayLayer, DEFAULT_OVERLAY_LAYERS, SELECTED_FILE_LAYER_ID } from './layerTypes';
import { FileToGeoJsonAdapter } from '../services/api';
import { getConfig } from '../services/configService';
import { createRootTreeItem, createBaseMapTreeItem, createOverlayTreeItem } from './layerTreeItemFactory';
import { processDragDropItems } from './layerDragDropHandler';
import { logInfo } from '../services/logger';

/**
 * Tree item types for internal use
 */
type TreeItem = BaseMapStyle | OverlayLayer | 'baseMapsRoot' | 'layersRoot';

/**
 * MIME types for drag-and-drop operations
 */
const MIME_APPLICATION_JSON = 'application/json';

const EMPTY_FEATURE_COLLECTION: object = { type: 'FeatureCollection', features: [] };

/**
 * Returns a deep copy of the default overlay layers so callers can mutate
 * the returned array and its elements without modifying the module constant.
 */
function cloneDefaultOverlayLayers(): OverlayLayer[] {
    return DEFAULT_OVERLAY_LAYERS.map(layer => ({
        ...layer,
        source: {
            ...layer.source
        }
    }));
}

/**
 * Returns a copy of the overlay layers with the "Selected file" layer's
 * GeoJSON data replaced by an empty FeatureCollection. The layer's
 * visibility, color, and other properties are preserved. This is used when
 * persisting overlay state so we never write a previous session's file data
 * to globalState.
 */
function sanitizeForPersistence(layers: OverlayLayer[]): OverlayLayer[] {
    return layers.map(layer => {
        if (layer.id !== SELECTED_FILE_LAYER_ID) {
            return layer;
        }
        return {
            ...layer,
            source: {
                ...layer.source,
                data: EMPTY_FEATURE_COLLECTION
            }
        };
    });
}

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
    private _onDidAddLayerViaDragDrop: vscode.EventEmitter<{ layer: OverlayLayer; bbox: any | null }> =
        new vscode.EventEmitter<{ layer: OverlayLayer; bbox: any | null }>();

    /**
     * Event that fires when a layer is added via drag-and-drop
     */
    readonly onDidAddLayerViaDragDrop: vscode.Event<{ layer: OverlayLayer; bbox: any | null }> =
        this._onDidAddLayerViaDragDrop.event;

    /**
     * MIME types that this controller can handle for drops
     */
    readonly dropMimeTypes: readonly string[] = ['text/uri-list'];

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
            || cloneDefaultOverlayLayers();

        // Ensure the "Selected file" layer always exists and reset any
        // persisted GeoJSON data so we never render a previous session's file.
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
     * Uses the extracted drag-drop handler for file processing logic.
     */
    async handleDrop(
        _target: TreeItem | undefined,
        sources: vscode.DataTransfer,
        _token: vscode.CancellationToken
    ): Promise<void> {
        const result = await processDragDropItems(sources, this._fileAdapters);

        // Show error messages for failed files
        if (result.errors.length > 0) {
            const errorMessages = result.errors.map(e => `${e.file}: ${e.error}`).join('\n');
            if (result.errors.length === 1) {
                vscode.window.showErrorMessage(`Failed to add layer: ${errorMessages}`);
            } else {
                vscode.window.showErrorMessage(
                    `Failed to add ${result.errors.length} layer(s). See console for details.`
                );
                console.error('Drag-and-drop errors:\n' + errorMessages);
            }
        }

        // Show success message and register added layers
        if (result.addedLayers.length > 0) {
            const layerNames = result.addedLayers.map(l => l.layer.name).join(', ');
            vscode.window.showInformationMessage(
                `Added ${result.addedLayers.length} layer(s): ${layerNames}`
            );

            for (const { layer, bbox } of result.addedLayers) {
                await this.addOverlayLayer(layer);
                this._onDidAddLayerViaDragDrop.fire({ layer, bbox });
            }
        }
    }

    /**
     * Ensures the "Selected file" layer exists in the overlay layers
     * and that any persisted GeoJSON data is cleared so we never render
     * a previous session's file.
     */
    private _ensureSelectedFileLayer(): void {
        const layerIndex = this._overlayLayers.findIndex(l => l.id === SELECTED_FILE_LAYER_ID);
        const emptyData = { type: 'FeatureCollection', features: [] };
        if (layerIndex === -1) {
            this._overlayLayers.push({
                id: SELECTED_FILE_LAYER_ID,
                name: 'Selected file',
                description: 'Displays the currently selected file on the map',
                type: 'geojson',
                source: {
                    type: 'geojson',
                    data: emptyData
                },
                visible: false
            });
            return;
        }
        const current = this._overlayLayers[layerIndex];
        this._overlayLayers[layerIndex] = {
            ...current,
            source: {
                ...current.source,
                data: emptyData
            }
        };
    }

    /**
     * Gets the tree item for an element
     */
    getTreeItem(element: TreeItem): vscode.TreeItem {
        if (typeof element === 'string') {
            if (element === 'baseMapsRoot') {
                return createRootTreeItem('Base Maps', 'layers', 'baseMapsRoot');
            }
            if (element === 'layersRoot') {
                return createRootTreeItem('Overlay Layers', 'layers', 'layersRoot');
            }
            return new vscode.TreeItem('Unknown', vscode.TreeItemCollapsibleState.None);
        }

        if ('visible' in element) {
            return createOverlayTreeItem(element);
        }

        return createBaseMapTreeItem(element, element.id === this._activeBaseMapId);
    }

    /**
      * Gets the children of an element
      */
    getChildren(element?: TreeItem): Thenable<TreeItem[]> {
        if (!element) {
            return Promise.resolve(['baseMapsRoot', 'layersRoot'] as TreeItem[]);
        }

        if (element === 'baseMapsRoot') {
            return Promise.resolve(this._baseMaps);
        }

        if (element === 'layersRoot') {
            return Promise.resolve(this._overlayLayers);
        }

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
        logInfo(`Set active base map to "${baseMap.name}" (${baseMapId})`);

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
        await this._extensionContext.globalState.update('overlayLayers', sanitizeForPersistence(this._overlayLayers));
        logInfo(`Toggled layer "${this._overlayLayers[layerIndex].name}" (${layerId}) visibility to ${this._overlayLayers[layerIndex].visible}`);

        this._onDidChangeLayers.fire({
            type: 'overlay',
            data: this._overlayLayers[layerIndex]
        });
        this.refresh();
    }

    /**
     * Updates the color of an overlay layer
     */
    async updateLayerColor(layerId: string, color: string): Promise<void> {
        const layerIndex = this._overlayLayers.findIndex(l => l.id === layerId);
        if (layerIndex === -1) {
            throw new Error(`Layer with id '${layerId}' not found`);
        }

        this._overlayLayers[layerIndex].color = color;
        await this._extensionContext.globalState.update('overlayLayers', sanitizeForPersistence(this._overlayLayers));
        logInfo(`Updated color of layer "${this._overlayLayers[layerIndex].name}" (${layerId}) to ${color}`);

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
        if (this._overlayLayers.some(l => l.id === layer.id)) {
            throw new Error(`Layer with id '${layer.id}' already exists`);
        }

        this._overlayLayers.push(layer);
        await this._extensionContext.globalState.update('overlayLayers', sanitizeForPersistence(this._overlayLayers));
        logInfo(`Added overlay layer "${layer.name}" (${layer.id})`);

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
        await this._extensionContext.globalState.update('overlayLayers', sanitizeForPersistence(this._overlayLayers));
        logInfo(`Removed overlay layer "${removed.name}" (${layerId})`);

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
     * Register a basemap from an external extension.
     * @param basemap The basemap to register
     * @returns A Disposable that removes the basemap when disposed
     */
    registerBasemap(basemap: BaseMapStyle): vscode.Disposable {
        if (!basemap.id || !basemap.name) {
            throw new Error('Basemap must have id and name');
        }
        if (!basemap.styleUrl && !basemap.tileUrl) {
            throw new Error('Basemap must have either styleUrl or tileUrl');
        }

        if (this._baseMaps.some(bm => bm.id === basemap.id)) {
            console.warn(`Basemap '${basemap.id}' already exists, replacing`);
        }

        this._externalBasemaps.set(basemap.id, basemap);
        this._rebuildBaseMaps();
        this._onDidChangeTreeData.fire(undefined);
        logInfo(`Registered basemap "${basemap.name}" (${basemap.id})`);

        return new vscode.Disposable(() => {
            this._externalBasemaps.delete(basemap.id);
            this._rebuildBaseMaps();
            this._onDidChangeTreeData.fire(undefined);
            logInfo(`Unregistered basemap "${basemap.name}" (${basemap.id})`);
        });
    }

    /**
     * Rebuild the baseMaps array from configuration and external registrations
     */
    private _rebuildBaseMaps(): void {
        const configBaseMaps = getConfig().get<BaseMapStyle[]>('baseMaps') || [];
        this._baseMaps = [...configBaseMaps];

        for (const basemap of this._externalBasemaps.values()) {
            this._baseMaps = this._baseMaps.filter(bm => bm.id !== basemap.id);
            this._baseMaps.push(basemap);
        }

        if (this._baseMaps.length > 0 && !this._baseMaps.find(bm => bm.id === this._activeBaseMapId)) {
            this._activeBaseMapId = this._baseMaps[0].id;
        }
    }

    /**
     * Public method to rebuild basemaps when configuration changes
     */
    rebuildBaseMaps(): void {
        this._rebuildBaseMaps();

        if (this._baseMaps.length > 0 && !this._baseMaps.find(bm => bm.id === this._activeBaseMapId)) {
            this._activeBaseMapId = this._baseMaps[0].id;
            this._extensionContext.globalState.update('activeBaseMapId', this._activeBaseMapId);
        }

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
     * The layer visibility is preserved.
     * @param geojson The GeoJSON data to display, or null/empty to clear
     */
    async updateSelectedFileLayer(geojson: object | null): Promise<void> {
        const layerIndex = this._overlayLayers.findIndex(l => l.id === SELECTED_FILE_LAYER_ID);

        if (layerIndex === -1) {
            console.error('Selected file layer not found - this should not happen');
            return;
        }

        const currentVisibility = this._overlayLayers[layerIndex].visible;

        if (geojson && Object.keys(geojson).length > 0) {
            this._overlayLayers[layerIndex] = {
                ...this._overlayLayers[layerIndex],
                source: {
                    ...this._overlayLayers[layerIndex].source,
                    data: geojson
                },
                visible: currentVisibility
            };
        } else {
            this._overlayLayers[layerIndex] = {
                ...this._overlayLayers[layerIndex],
                source: {
                    type: 'geojson',
                    data: { type: 'FeatureCollection', features: [] }
                },
                visible: currentVisibility
            };
        }

        await this._extensionContext.globalState.update('overlayLayers', sanitizeForPersistence(this._overlayLayers));

        const layer = this._overlayLayers[layerIndex];
        logInfo(geojson && Object.keys(geojson).length > 0
            ? 'Updated selected file layer with GeoJSON data'
            : 'Cleared selected file layer');
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
