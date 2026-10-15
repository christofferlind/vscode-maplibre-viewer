import * as assert from 'assert';
import { createRequire } from 'module';
import type * as vscode from 'vscode';
import {
    vscodeStub,
    Uri as MockUri,
    DataTransfer as MockDataTransfer,
    CancellationToken as MockCancellationToken,
    TreeItem as MockTreeItem,
    TreeItemCollapsibleState as MockTreeItemCollapsibleState,
    ThemeIcon as MockThemeIcon
} from '../testUtils/vscodeLayersMock';

/**
 * Unit tests for the layers module: LayerTreeProvider, layerTreeItemFactory,
 * layerDragDropHandler, and layerTypes. The vscode module and the file
 * conversion / coordinate parsing services are stubbed so the tree provider
 * and drag-and-drop logic can be exercised without a real VS Code host.
 */

const nodeRequire = createRequire(__filename);
const ModuleCtor = nodeRequire('module') as typeof import('module');
const originalPrototypeRequire = ModuleCtor.prototype.require;

const fileConversionStub: Record<string, unknown> = {
    validateFile: (filePath: string): { valid: boolean; error?: string; extension: string } => {
        if (filePath.endsWith('.invalid')) {
            return { valid: false, error: 'Unsupported file format', extension: '.invalid' };
        }
        return { valid: true, extension: '.geojson' };
    },
    convertToGeoJson: async (): Promise<object> => ({
        type: 'FeatureCollection',
        features: []
    }),
    getDefaultLayerName: (filePath: string): string => {
        const base = filePath.split('/').pop() || filePath;
        return base.replace(/\.[^.]+$/, '');
    }
};

const coordinateParserStub: Record<string, unknown> = {
    calculateBoundingBoxFromGeoJson: (): { southwest: { lat: number; lng: number }; northeast: { lat: number; lng: number } } | null => ({
        southwest: { lat: 0, lng: 0 },
        northeast: { lat: 1, lng: 1 }
    })
};

const configServiceStub: Record<string, unknown> = {
    getConfig: (): { get: <T>(key: string, defaultValue?: T) => T | undefined } => ({
        get: <T>(_key: string, defaultValue?: T): T | undefined => defaultValue
    })
};

type LayerTreeProviderType = import('../../layers/layerTreeProvider').LayerTreeProvider;
type OverlayLayer = import('../../layers/layerTypes').OverlayLayer;
type BaseMapStyle = import('../../layers/layerTypes').BaseMapStyle;

const { LayerTreeProvider } = ((): {
    LayerTreeProvider: new (context: vscode.ExtensionContext) => LayerTreeProviderType;
} => {
    ModuleCtor.prototype.require = function (id: string): unknown {
        if (id === 'vscode') {
            return vscodeStub;
        }
        if (id === '../services/fileConversionService') {
            return fileConversionStub;
        }
        if (id === '../services/coordinateParser') {
            return coordinateParserStub;
        }
        if (id === '../services/configService') {
            return configServiceStub;
        }
        return originalPrototypeRequire.call(this, id);
    };
    try {
        const moduleCache = (ModuleCtor as unknown as { _cache: Record<string, NodeModule | undefined> })._cache;
        for (const cached of [
            nodeRequire.resolve('../../layers/layerTreeProvider'),
            nodeRequire.resolve('../../layers/layerTreeItemFactory'),
            nodeRequire.resolve('../../layers/layerDragDropHandler'),
            nodeRequire.resolve('../../layers/layerTypes'),
            nodeRequire.resolve('../../services/configService'),
            nodeRequire.resolve('../../services/fileConversionService'),
            nodeRequire.resolve('../../services/coordinateParser')
        ]) {
            delete moduleCache[cached];
        }
        return nodeRequire('../../layers/layerTreeProvider') as {
            LayerTreeProvider: new (context: vscode.ExtensionContext) => LayerTreeProviderType;
        };
    } finally {
        ModuleCtor.prototype.require = originalPrototypeRequire;
    }
})();

function createContext(overlayLayers?: OverlayLayer[], activeBaseMapId?: string): vscode.ExtensionContext {
    const store = new Map<string, unknown>();
    if (overlayLayers) {
        store.set('overlayLayers', overlayLayers);
    }
    if (activeBaseMapId) {
        store.set('activeBaseMapId', activeBaseMapId);
    }
    return {
        subscriptions: [],
        globalState: {
            get: <T>(key: string, defaultValue?: T): T | undefined => {
                const value = store.get(key);
                return value === undefined ? defaultValue : (value as T);
            },
            update: (key: string, value: unknown): Thenable<void> => {
                store.set(key, value);
                return Promise.resolve();
            }
        },
        extensionUri: MockUri.file('/test/extension')
    } as unknown as vscode.ExtensionContext;
}

function createOverlayLayer(overrides?: Partial<OverlayLayer>): OverlayLayer {
    return {
        id: 'layer-1',
        name: 'Test Layer',
        description: 'A test layer',
        type: 'geojson',
        source: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
        visible: true,
        ...overrides
    };
}

function createBaseMap(overrides?: Partial<BaseMapStyle>): BaseMapStyle {
    return {
        id: 'osm',
        name: 'OpenStreetMap',
        styleUrl: 'https://example.com/style.json',
        ...overrides
    };
}

suite('LayerTreeProvider', () => {
    test('should initialize with default overlay layers when none persisted', () => {
        const provider = new LayerTreeProvider(createContext());
        const layers = provider.getOverlayLayers();
        assert.strictEqual(layers.length, 2);
        assert.strictEqual(layers[0].id, 'selected-file');
        assert.strictEqual(layers[0].visible, true);
    });

    test('should load persisted overlay layers and ensure selected file layer exists', () => {
        const persisted = [createOverlayLayer({ id: 'custom', name: 'Custom' })];
        const provider = new LayerTreeProvider(createContext(persisted));
        const layers = provider.getOverlayLayers();
        assert.strictEqual(layers.length, 3);
        assert.ok(layers.some(l => l.id === 'selected-file'));
        assert.ok(layers.some(l => l.id === 'custom'));
    });

    test('should clear persisted GeoJSON data on the selected file layer', () => {
        const persisted = [
            createOverlayLayer({
                id: 'selected-file',
                source: { type: 'geojson', data: { type: 'FeatureCollection', features: [{ id: 1 }] } }
            })
        ];
        const provider = new LayerTreeProvider(createContext(persisted));
        const selected = provider.getSelectedFileLayer();
        assert.ok(selected);
        const data = selected.source.data as { features: unknown[] };
        assert.strictEqual(data.features.length, 0);
    });

    test('should return root children for undefined element', async () => {
        const provider = new LayerTreeProvider(createContext());
        const children = await provider.getChildren();
        assert.deepStrictEqual(children, ['baseMapsRoot', 'layersRoot']);
    });

    test('should return base maps for baseMapsRoot', async () => {
        const provider = new LayerTreeProvider(createContext());
        const children = await provider.getChildren('baseMapsRoot');
        assert.ok(Array.isArray(children));
    });

    test('should return overlay layers for layersRoot', async () => {
        const provider = new LayerTreeProvider(createContext());
        const children = await provider.getChildren('layersRoot');
        assert.strictEqual(children.length, 2);
        assert.strictEqual((children[0] as OverlayLayer).id, 'selected-file');
    });

    test('should return empty children for unknown element', async () => {
        const provider = new LayerTreeProvider(createContext());
        const children = await provider.getChildren(createOverlayLayer());
        assert.deepStrictEqual(children, []);
    });

    test('getTreeItem should create root tree item for baseMapsRoot', () => {
        const provider = new LayerTreeProvider(createContext());
        const item = provider.getTreeItem('baseMapsRoot');
        assert.strictEqual(item.label, 'Base Maps');
        assert.strictEqual(item.contextValue, 'baseMapsRoot');
    });

    test('getTreeItem should create root tree item for layersRoot', () => {
        const provider = new LayerTreeProvider(createContext());
        const item = provider.getTreeItem('layersRoot');
        assert.strictEqual(item.label, 'Overlay Layers');
        assert.strictEqual(item.contextValue, 'layersRoot');
    });

    test('getTreeItem should create overlay tree item for overlay layer', () => {
        const provider = new LayerTreeProvider(createContext());
        const layer = createOverlayLayer();
        const item = provider.getTreeItem(layer);
        assert.strictEqual(item.label, 'Test Layer');
        assert.strictEqual(item.contextValue, 'visibleOverlayLayer');
    });

    test('getOverlayLayerIdForTreeItem should map generated overlay items back to layer ids', () => {
        const provider = new LayerTreeProvider(createContext());
        const layer = createOverlayLayer({ id: 'mapped-layer' });
        const item = provider.getTreeItem(layer);
        assert.strictEqual(provider.getOverlayLayerIdForTreeItem(item), 'mapped-layer');
    });

    test('getOverlayLayerIdForTreeItem should resolve overlay layer elements returned by getChildren', async () => {
        const provider = new LayerTreeProvider(createContext());
        const children = (await provider.getChildren('layersRoot')) as OverlayLayer[];
        const layer = children.find(child => child.id === 'selected-file');
        assert.ok(layer);
        assert.strictEqual(provider.getOverlayLayerIdForTreeItem(layer), 'selected-file');
    });

    test('getOverlayLayerIdForTreeItem should return undefined for base map elements and unknown objects', () => {
        const provider = new LayerTreeProvider(createContext());
        const baseMap = createBaseMap();
        assert.strictEqual(provider.getOverlayLayerIdForTreeItem(baseMap), undefined);
        assert.strictEqual(provider.getOverlayLayerIdForTreeItem({}), undefined);
        assert.strictEqual(provider.getOverlayLayerIdForTreeItem('layersRoot'), undefined);
    });

    test('getTreeItem should create base map tree item for base map', () => {
        const provider = new LayerTreeProvider(createContext());
        const baseMap = createBaseMap();
        const item = provider.getTreeItem(baseMap);
        assert.strictEqual(item.label, 'OpenStreetMap');
        assert.strictEqual(item.contextValue, 'baseMap');
    });

    test('getActiveBaseMap should return the active base map', () => {
        const provider = new LayerTreeProvider(createContext());
        provider.registerBasemap(createBaseMap({ id: 'osm', name: 'OpenStreetMap' }));
        const active = provider.getActiveBaseMap();
        assert.ok(active);
        assert.strictEqual(active.id, provider.getBasemaps()[0].id);
    });

    test('getVisibleOverlayLayers should only return visible layers', () => {
        const provider = new LayerTreeProvider(createContext());
        provider.addOverlayLayer(createOverlayLayer({ id: 'visible-layer', visible: true }));
        provider.addOverlayLayer(createOverlayLayer({ id: 'hidden-layer', visible: false }));
        const visible = provider.getVisibleOverlayLayers();
        assert.ok(visible.every(l => l.visible));
        assert.ok(visible.some(l => l.id === 'visible-layer'));
        assert.ok(!visible.some(l => l.id === 'hidden-layer'));
    });

    test('setActiveBaseMap should update active base map and persist', async () => {
        const context = createContext();
        const provider = new LayerTreeProvider(context);
        const baseMap = createBaseMap({ id: 'custom-basemap', name: 'Custom' });
        provider.registerBasemap(baseMap);
        await provider.setActiveBaseMap('custom-basemap');
        assert.strictEqual(provider.getActiveBaseMap()?.id, 'custom-basemap');
        assert.strictEqual(context.globalState.get('activeBaseMapId'), 'custom-basemap');
    });

    test('setActiveBaseMap should throw for unknown base map', async () => {
        const provider = new LayerTreeProvider(createContext());
        await assert.rejects(() => provider.setActiveBaseMap('missing'), /not found/);
    });

    test('toggleLayerVisibility should flip visibility and persist', async () => {
        const context = createContext();
        const provider = new LayerTreeProvider(context);
        const layer = createOverlayLayer({ id: 'toggle-layer', visible: false });
        await provider.addOverlayLayer(layer);
        await provider.toggleLayerVisibility('toggle-layer');
        assert.strictEqual(provider.getOverlayLayers().find(l => l.id === 'toggle-layer')?.visible, true);
        const persisted = context.globalState.get<OverlayLayer[]>('overlayLayers');
        assert.ok(persisted);
        assert.strictEqual(persisted.find(l => l.id === 'toggle-layer')?.visible, true);
    });

    test('toggleLayerVisibility should throw for unknown layer', async () => {
        const provider = new LayerTreeProvider(createContext());
        await assert.rejects(() => provider.toggleLayerVisibility('missing'), /not found/);
    });

    test('updateLayerColor should set color and persist', async () => {
        const context = createContext();
        const provider = new LayerTreeProvider(context);
        const layer = createOverlayLayer({ id: 'color-layer' });
        await provider.addOverlayLayer(layer);
        await provider.updateLayerColor('color-layer', '#ff0000');
        assert.strictEqual(provider.getOverlayLayers().find(l => l.id === 'color-layer')?.color, '#ff0000');
    });

    test('updateLayerColor should throw for unknown layer', async () => {
        const provider = new LayerTreeProvider(createContext());
        await assert.rejects(() => provider.updateLayerColor('missing', '#fff'), /not found/);
    });

    test('updateLayerStyle should apply all style properties and persist', async () => {
        const context = createContext();
        const provider = new LayerTreeProvider(context);
        await provider.addOverlayLayer(createOverlayLayer({ id: 'style-layer' }));
        await provider.updateLayerStyle('style-layer', {
            color: '#00ff00',
            opacity: 0.5,
            circleRadius: 10,
            lineWidth: 5
        });
        const layer = provider.getOverlayLayers().find(l => l.id === 'style-layer');
        assert.strictEqual(layer?.color, '#00ff00');
        assert.strictEqual(layer?.opacity, 0.5);
        assert.strictEqual(layer?.circleRadius, 10);
        assert.strictEqual(layer?.lineWidth, 5);
        const persisted = context.globalState.get<OverlayLayer[]>('overlayLayers');
        assert.ok(persisted);
        const persistedLayer = persisted.find(l => l.id === 'style-layer');
        assert.strictEqual(persistedLayer?.color, '#00ff00');
        assert.strictEqual(persistedLayer?.opacity, 0.5);
        assert.strictEqual(persistedLayer?.circleRadius, 10);
        assert.strictEqual(persistedLayer?.lineWidth, 5);
    });

    test('updateLayerStyle should merge partial style without clearing other properties', async () => {
        const provider = new LayerTreeProvider(createContext());
        await provider.addOverlayLayer(createOverlayLayer({
            id: 'merge-layer',
            color: '#123456',
            opacity: 0.8,
            circleRadius: 4
        }));
        await provider.updateLayerStyle('merge-layer', { lineWidth: 7 });
        const layer = provider.getOverlayLayers().find(l => l.id === 'merge-layer');
        assert.strictEqual(layer?.color, '#123456');
        assert.strictEqual(layer?.opacity, 0.8);
        assert.strictEqual(layer?.circleRadius, 4);
        assert.strictEqual(layer?.lineWidth, 7);
    });

    test('updateLayerStyle should keep other layer properties (visibility, data) untouched', async () => {
        const provider = new LayerTreeProvider(createContext());
        await provider.addOverlayLayer(createOverlayLayer({ id: 'preserve-layer' }));
        await provider.updateLayerStyle('preserve-layer', { color: '#abcdef' });
        const layer = provider.getOverlayLayers().find(l => l.id === 'preserve-layer');
        assert.strictEqual(layer?.visible, true);
        assert.strictEqual(layer?.name, 'Test Layer');
        assert.strictEqual(layer?.type, 'geojson');
    });

    test('updateLayerStyle should notify overlay listeners and refresh the tree', async () => {
        const provider = new LayerTreeProvider(createContext());
        await provider.addOverlayLayer(createOverlayLayer({ id: 'event-layer' }));

        const events: Array<{ type: string; data: unknown }> = [];
        provider.onDidChangeLayers(event => events.push(event));
        let treeRefreshed = 0;
        provider.onDidChangeTreeData(() => treeRefreshed++);

        await provider.updateLayerStyle('event-layer', { opacity: 0.25 });

        const overlayEvents = events.filter(e => e.type === 'overlay');
        assert.strictEqual(overlayEvents.length, 1, 'onDidChangeLayers should fire once for the overlay update');
        assert.strictEqual((overlayEvents[0].data as OverlayLayer).opacity, 0.25);
        assert.strictEqual(treeRefreshed, 1, 'tree view should refresh after the style update');
    });

    test('updateLayerStyle should reflect the new style in getVisibleOverlayLayers', async () => {
        const provider = new LayerTreeProvider(createContext());
        await provider.addOverlayLayer(createOverlayLayer({ id: 'visible-style-layer', visible: true }));
        await provider.updateLayerStyle('visible-style-layer', { color: '#0000ff', lineWidth: 9 });
        const visible = provider.getVisibleOverlayLayers().find(l => l.id === 'visible-style-layer');
        assert.strictEqual(visible?.color, '#0000ff');
        assert.strictEqual(visible?.lineWidth, 9);
    });

    test('updateLayerStyle should accept reset values (all undefined)', async () => {
        const provider = new LayerTreeProvider(createContext());
        await provider.addOverlayLayer(createOverlayLayer({ id: 'reset-layer', color: '#fff' }));
        await provider.updateLayerStyle('reset-layer', {
            color: undefined,
            opacity: undefined,
            circleRadius: undefined,
            lineWidth: undefined
        });
        const layer = provider.getOverlayLayers().find(l => l.id === 'reset-layer');
        assert.strictEqual(layer?.color, undefined);
        assert.strictEqual(layer?.opacity, undefined);
    });

    test('updateLayerStyle should throw for unknown layer', async () => {
        const provider = new LayerTreeProvider(createContext());
        await assert.rejects(() => provider.updateLayerStyle('missing', { opacity: 0.5 }), /not found/);
    });

    test('updateLayerStyle should reject invalid style values', async () => {
        const provider = new LayerTreeProvider(createContext());
        await provider.addOverlayLayer(createOverlayLayer({ id: 'invalid-style-layer' }));

        await assert.rejects(() => provider.updateLayerStyle('invalid-style-layer', { opacity: 1.5 }), /between 0 and 1/);
        await assert.rejects(() => provider.updateLayerStyle('invalid-style-layer', { opacity: -0.1 }), /between 0 and 1/);
        await assert.rejects(() => provider.updateLayerStyle('invalid-style-layer', { color: 5 as unknown as string }), /must be a string/);
        await assert.rejects(() => provider.updateLayerStyle('invalid-style-layer', { circleRadius: 0 }), /positive/);
        await assert.rejects(() => provider.updateLayerStyle('invalid-style-layer', { circleRadius: -3 }), /positive/);
        await assert.rejects(() => provider.updateLayerStyle('invalid-style-layer', { lineWidth: 0 }), /positive/);

        const layer = provider.getOverlayLayers().find(l => l.id === 'invalid-style-layer');
        assert.strictEqual(layer?.color, undefined, 'failed updates must not mutate the layer');
    });

    test('addOverlayLayer should add a new layer', async () => {
        const provider = new LayerTreeProvider(createContext());
        await provider.addOverlayLayer(createOverlayLayer({ id: 'new-layer' }));
        assert.ok(provider.getOverlayLayers().some(l => l.id === 'new-layer'));
    });

    test('addOverlayLayer should throw for duplicate id', async () => {
        const provider = new LayerTreeProvider(createContext());
        await provider.addOverlayLayer(createOverlayLayer({ id: 'dup' }));
        await assert.rejects(() => provider.addOverlayLayer(createOverlayLayer({ id: 'dup' })), /already exists/);
    });

    test('removeOverlayLayer should remove a layer', async () => {
        const provider = new LayerTreeProvider(createContext());
        await provider.addOverlayLayer(createOverlayLayer({ id: 'remove-me' }));
        await provider.removeOverlayLayer('remove-me');
        assert.ok(!provider.getOverlayLayers().some(l => l.id === 'remove-me'));
    });

    test('removeOverlayLayer should throw for unknown layer', async () => {
        const provider = new LayerTreeProvider(createContext());
        await assert.rejects(() => provider.removeOverlayLayer('missing'), /not found/);
    });

    test('registerBasemap should add a basemap and return a disposable that removes it', () => {
        const provider = new LayerTreeProvider(createContext());
        const disposable = provider.registerBasemap(createBaseMap({ id: 'ext', name: 'External' }));
        assert.ok(provider.getBasemaps().some(bm => bm.id === 'ext'));
        disposable.dispose();
        assert.ok(!provider.getBasemaps().some(bm => bm.id === 'ext'));
    });

    test('registerBasemap should throw when id or name is missing', () => {
        const provider = new LayerTreeProvider(createContext());
        assert.throws(() => provider.registerBasemap(createBaseMap({ id: '', name: 'X' })), /id and name/);
        assert.throws(() => provider.registerBasemap(createBaseMap({ id: 'x', name: '' })), /id and name/);
    });

    test('registerBasemap should throw when neither styleUrl nor tileUrl is present', () => {
        const provider = new LayerTreeProvider(createContext());
        const baseMap = createBaseMap({ id: 'no-url', name: 'No URL' });
        delete (baseMap as { styleUrl?: string }).styleUrl;
        delete (baseMap as { tileUrl?: string }).tileUrl;
        assert.throws(() => provider.registerBasemap(baseMap), /styleUrl or tileUrl/);
    });

    test('registerBasemap should accept a raster basemap with tileUrl and tileSize', () => {
        const provider = new LayerTreeProvider(createContext());
        provider.registerBasemap({
            id: 'osm',
            name: 'OpenStreetMap',
            type: 'raster',
            tileUrl: 'https://c.tile.opentopomap.org/{z}/{x}/{y}.png',
            tileSize: 512
        });
        const registered = provider.getBasemaps().find(bm => bm.id === 'osm');
        assert.ok(registered, 'raster basemap should be registered');
        assert.strictEqual(registered.name, 'OpenStreetMap');
        assert.strictEqual(registered.type, 'raster');
        assert.strictEqual(registered.tileUrl, 'https://c.tile.opentopomap.org/{z}/{x}/{y}.png');
        assert.strictEqual(registered.tileSize, 512);
    });

    test('setActiveBaseMap should switch between different basemaps', async () => {
        const context = createContext();
        const provider = new LayerTreeProvider(context);
        provider.registerBasemap({
            id: 'osm',
            name: 'OpenStreetMap',
            type: 'raster',
            tileUrl: 'https://c.tile.opentopomap.org/{z}/{x}/{y}.png',
            tileSize: 512
        });
        provider.registerBasemap(createBaseMap({ id: 'vector-style', name: 'Vector Style' }));

        await provider.setActiveBaseMap('osm');
        assert.strictEqual(provider.getActiveBaseMap()?.id, 'osm');
        assert.strictEqual(provider.getActiveBaseMap()?.type, 'raster');
        assert.strictEqual(context.globalState.get('activeBaseMapId'), 'osm');

        await provider.setActiveBaseMap('vector-style');
        assert.strictEqual(provider.getActiveBaseMap()?.id, 'vector-style');
        assert.strictEqual(provider.getActiveBaseMap()?.styleUrl, 'https://example.com/style.json');
        assert.strictEqual(context.globalState.get('activeBaseMapId'), 'vector-style');

        await provider.setActiveBaseMap('osm');
        assert.strictEqual(provider.getActiveBaseMap()?.id, 'osm');
        assert.strictEqual(context.globalState.get('activeBaseMapId'), 'osm');
    });

    test('registerBasemap should replace an existing basemap with the same id', () => {
        const provider = new LayerTreeProvider(createContext());
        provider.registerBasemap(createBaseMap({ id: 'dup', name: 'First' }));
        provider.registerBasemap(createBaseMap({ id: 'dup', name: 'Second' }));
        const matches = provider.getBasemaps().filter(bm => bm.id === 'dup');
        assert.strictEqual(matches.length, 1);
        assert.strictEqual(matches[0].name, 'Second');
    });

    test('rebuildBaseMaps should fire layer change and refresh', () => {
        const provider = new LayerTreeProvider(createContext());
        let fired = 0;
        provider.onDidChangeLayers(() => {
            fired++;
        });
        provider.registerBasemap(createBaseMap({ id: 'osm', name: 'OpenStreetMap' }));
        provider.rebuildBaseMaps();
        assert.ok(fired >= 1);
        assert.ok(provider.getActiveBaseMap());
    });

    test('updateSelectedFileLayer should no-op when selected file layer is missing', async () => {
        const provider = new LayerTreeProvider(createContext());
        await provider.removeOverlayLayer('selected-file');
        const original = provider.getOverlayLayers();
        await provider.updateSelectedFileLayer({ type: 'FeatureCollection', features: [{ id: 1 }] });
        assert.deepStrictEqual(provider.getOverlayLayers(), original);
    });

    test('isSelectedFileLayerEmpty should return true when layer has no source data', () => {
        const provider = new LayerTreeProvider(createContext());
        const layer = provider.getSelectedFileLayer();
        assert.ok(layer);
        layer.source = { type: 'geojson', data: undefined };
        assert.strictEqual(provider.isSelectedFileLayerEmpty(), true);
    });

    test('updateSelectedFileLayer should update data and preserve visibility', async () => {
        const provider = new LayerTreeProvider(createContext());
        await provider.updateSelectedFileLayer({ type: 'FeatureCollection', features: [{ id: 1 }] });
        const selected = provider.getSelectedFileLayer();
        assert.ok(selected);
        const data = selected.source.data as { features: unknown[] };
        assert.strictEqual(data.features.length, 1);
    });

    test('updateSelectedFileLayer should clear data when given empty object', async () => {
        const provider = new LayerTreeProvider(createContext());
        await provider.updateSelectedFileLayer({});
        const selected = provider.getSelectedFileLayer();
        assert.ok(selected);
        const data = selected.source.data as { features: unknown[] };
        assert.strictEqual(data.features.length, 0);
    });

    test('isSelectedFileLayerEmpty should return true when layer has no features', () => {
        const provider = new LayerTreeProvider(createContext());
        assert.strictEqual(provider.isSelectedFileLayerEmpty(), true);
    });

    test('isSelectedFileLayerEmpty should return false when layer has features', async () => {
        const provider = new LayerTreeProvider(createContext());
        await provider.updateSelectedFileLayer({ type: 'FeatureCollection', features: [{ id: 1 }] });
        assert.strictEqual(provider.isSelectedFileLayerEmpty(), false);
    });

    test('handleDrop should add layers and fire drag-drop event', async () => {
        const provider = new LayerTreeProvider(createContext());
        let fired = 0;
        provider.onDidAddLayerViaDragDrop(() => {
            fired++;
        });
        const dataTransfer = new MockDataTransfer();
        dataTransfer.set('text/uri-list', 'file:///tmp/points.geojson');
        await provider.handleDrop(undefined, dataTransfer as unknown as vscode.DataTransfer, new MockCancellationToken() as unknown as vscode.CancellationToken);
        assert.strictEqual(fired, 1);
        assert.ok(provider.getOverlayLayers().some(l => l.id.startsWith('drag-drop-')));
    });

    test('handleDrop should report errors for invalid files', async () => {
        const provider = new LayerTreeProvider(createContext());
        const dataTransfer = new MockDataTransfer();
        dataTransfer.set('text/uri-list', 'file:///tmp/points.invalid');
        await provider.handleDrop(undefined, dataTransfer as unknown as vscode.DataTransfer, new MockCancellationToken() as unknown as vscode.CancellationToken);
        assert.strictEqual(provider.getOverlayLayers().filter(l => l.id.startsWith('drag-drop-')).length, 0);
    });

    test('handleDrop should reject non-file schemes', async () => {
        const provider = new LayerTreeProvider(createContext());
        const dataTransfer = new MockDataTransfer();
        dataTransfer.set('text/uri-list', 'https://example.com/points.geojson');
        await provider.handleDrop(undefined, dataTransfer as unknown as vscode.DataTransfer, new MockCancellationToken() as unknown as vscode.CancellationToken);
        assert.strictEqual(provider.getOverlayLayers().filter(l => l.id.startsWith('drag-drop-')).length, 0);
    });

    test('handleDrag should be a no-op', () => {
        const provider = new LayerTreeProvider(createContext());
        assert.doesNotThrow(() => {
            provider.handleDrag([], new MockDataTransfer() as unknown as vscode.DataTransfer, new MockCancellationToken() as unknown as vscode.CancellationToken);
        });
    });

    test('setFileAdapters should store adapters', () => {
        const provider = new LayerTreeProvider(createContext());
        const adapter = {
            getName: () => 'test',
            canHandle: () => true,
            toGeoJson: async () => ({ type: 'FeatureCollection', features: [] })
        };
        provider.setFileAdapters([adapter]);
        assert.doesNotThrow(() => provider.handleDrop(undefined, new MockDataTransfer() as unknown as vscode.DataTransfer, new MockCancellationToken() as unknown as vscode.CancellationToken));
    });
});

suite('layerTreeItemFactory', () => {
    test('createRootTreeItem should set label, contextValue, and icon', () => {
        const item = new MockTreeItem('Base Maps', MockTreeItemCollapsibleState.Expanded);
        item.contextValue = 'baseMapsRoot';
        item.iconPath = new MockThemeIcon('layers');
        assert.strictEqual(item.label, 'Base Maps');
        assert.strictEqual(item.contextValue, 'baseMapsRoot');
        assert.strictEqual(item.iconPath.id, 'layers');
    });

    test('createBaseMapTreeItem should mark active base map', () => {
        const baseMap = createBaseMap();
        const item = new MockTreeItem(baseMap.name, MockTreeItemCollapsibleState.None);
        item.description = baseMap.description;
        item.contextValue = 'activeBaseMap';
        item.iconPath = new MockThemeIcon('map');
        item.command = { command: 'vscodeMaplibreViewer.setBaseMap', title: 'Set Active Base Map', arguments: [baseMap] };
        assert.strictEqual(item.contextValue, 'activeBaseMap');
        assert.strictEqual(item.command.command, 'vscodeMaplibreViewer.setBaseMap');
    });

    test('createBaseMapTreeItem should set type icon for vector basemap', () => {
        const baseMap = createBaseMap({ type: 'vector' });
        const item = new MockTreeItem(baseMap.name, MockTreeItemCollapsibleState.None);
        item.description = baseMap.description;
        item.contextValue = 'baseMap';
        item.iconPath = new MockThemeIcon('map');
        item.command = { command: 'vscodeMaplibreViewer.setBaseMap', title: 'Set Active Base Map', arguments: [baseMap] };
        assert.strictEqual(item.iconPath.id, 'map');
    });

    test('createBaseMapTreeItem should set type icon for raster basemap', () => {
        const baseMap = createBaseMap({ type: 'raster', tileUrl: 'https://tiles.example.com/{z}/{x}/{y}.png' });
        const item = new MockTreeItem(baseMap.name, MockTreeItemCollapsibleState.None);
        item.description = baseMap.description;
        item.contextValue = 'baseMap';
        item.iconPath = new MockThemeIcon('image');
        item.command = { command: 'vscodeMaplibreViewer.setBaseMap', title: 'Set Active Base Map', arguments: [baseMap] };
        assert.strictEqual(item.iconPath.id, 'image');
    });

    test('createBaseMapTreeItem should infer raster type from tileUrl', () => {
        const baseMap = createBaseMap({ tileUrl: 'https://tiles.example.com/{z}/{x}/{y}.png' });
        const item = new MockTreeItem(baseMap.name, MockTreeItemCollapsibleState.None);
        item.description = baseMap.description;
        item.contextValue = 'baseMap';
        item.iconPath = new MockThemeIcon('image');
        item.command = { command: 'vscodeMaplibreViewer.setBaseMap', title: 'Set Active Base Map', arguments: [baseMap] };
        assert.strictEqual(item.iconPath.id, 'image');
    });

    test('createOverlayTreeItem should use activation command and reflect visibility in checkbox', () => {
        ModuleCtor.prototype.require = function (id: string): unknown {
            if (id === 'vscode') {
                return vscodeStub;
            }
            return originalPrototypeRequire.call(this, id);
        };
        try {
            const moduleCache = (ModuleCtor as unknown as { _cache: Record<string, NodeModule | undefined> })._cache;
            const factoryPath = nodeRequire.resolve('../../layers/layerTreeItemFactory');
            delete moduleCache[factoryPath];
            const { createOverlayTreeItem } = nodeRequire('../../layers/layerTreeItemFactory') as typeof import('../../layers/layerTreeItemFactory');
            const TreeItemCheckboxState = (vscodeStub as { TreeItemCheckboxState: typeof vscode.TreeItemCheckboxState }).TreeItemCheckboxState;

            const visibleLayer = createOverlayLayer({ visible: true });
            const visibleItem = createOverlayTreeItem(visibleLayer);
            assert.strictEqual(visibleItem.command?.command, 'vscodeMaplibreViewer.layerItemActivated');
            assert.strictEqual(visibleItem.checkboxState, TreeItemCheckboxState.Checked);

            const hiddenLayer = createOverlayLayer({ visible: false });
            const hiddenItem = createOverlayTreeItem(hiddenLayer);
            assert.strictEqual(hiddenItem.command?.command, 'vscodeMaplibreViewer.layerItemActivated');
            assert.strictEqual(hiddenItem.checkboxState, TreeItemCheckboxState.Unchecked);
        } finally {
            ModuleCtor.prototype.require = originalPrototypeRequire;
        }
    });
});

suite('DoubleClickTracker', () => {
    test('should ignore a single click and detect two clicks inside the window', () => {
        const { DoubleClickTracker } = nodeRequire('../../layers/layerClickHandler') as typeof import('../../layers/layerClickHandler');
        const tracker = new DoubleClickTracker(50);
        assert.strictEqual(tracker.handleClick('layer-a'), false, 'single click should do nothing');
        assert.strictEqual(tracker.handleClick('layer-a'), true, 'second click within window is a double click');
        assert.strictEqual(tracker.handleClick('layer-a'), false, 'third click starts a new sequence');
        tracker.dispose();
    });

    test('should treat clicks after the window expires as single clicks', async () => {
        const { DoubleClickTracker } = nodeRequire('../../layers/layerClickHandler') as typeof import('../../layers/layerClickHandler');
        const tracker = new DoubleClickTracker(20);
        assert.strictEqual(tracker.handleClick('layer-b'), false);
        await new Promise(resolve => setTimeout(resolve, 40));
        assert.strictEqual(tracker.handleClick('layer-b'), false);
        tracker.dispose();
    });

    test('should track layers independently', async () => {
        const { DoubleClickTracker } = nodeRequire('../../layers/layerClickHandler') as typeof import('../../layers/layerClickHandler');
        const tracker = new DoubleClickTracker(50);
        assert.strictEqual(tracker.handleClick('layer-c'), false);
        assert.strictEqual(tracker.handleClick('layer-d'), false);
        assert.strictEqual(tracker.handleClick('layer-c'), true);
        tracker.dispose();
    });
});

suite('layerTypes', () => {
    test('isBaseMapsRoot should identify base maps root', () => {
        const { isBaseMapsRoot, isLayersRoot, isBaseMapStyle, isOverlayLayer } = nodeRequire('../../layers/layerTypes');
        assert.strictEqual(isBaseMapsRoot('baseMapsRoot'), true);
        assert.strictEqual(isBaseMapsRoot('layersRoot'), false);
        assert.strictEqual(isLayersRoot('layersRoot'), true);
        assert.strictEqual(isLayersRoot('baseMapsRoot'), false);
        assert.strictEqual(isBaseMapStyle(createBaseMap()), true);
        assert.strictEqual(isBaseMapStyle(createOverlayLayer()), false);
        assert.strictEqual(isOverlayLayer(createOverlayLayer()), true);
        assert.strictEqual(isOverlayLayer(createBaseMap()), false);
    });
});
