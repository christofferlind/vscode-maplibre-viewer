import * as assert from 'assert';
import { createRequire } from 'module';

/**
 * Unit tests for the Map Information tree provider and its model, loaded with
 * a stubbed vscode module (same technique as bookmarkTreeProvider.test.ts).
 */

const nodeRequire = createRequire(__filename);
const ModuleCtor = nodeRequire('module') as typeof import('module');

class TreeItemStub {
    label: string;
    collapsibleState: number;
    description?: string;
    iconPath?: unknown;
    contextValue?: string;
    tooltip?: string;

    constructor(label: string, collapsibleState: number) {
        this.label = label;
        this.collapsibleState = collapsibleState;
    }
}

class ThemeIconStub {
    constructor(public id: string) {}
}

class EventEmitterStub {
    listeners: Array<(e: unknown) => void> = [];
    fireCount = 0;

    fire(e: unknown): void {
        this.fireCount++;
        for (const l of this.listeners) {
            l(e);
        }
    }

    get event(): (fn: (e: unknown) => void) => { dispose: () => void } {
        return (fn: (e: unknown) => void) => {
            this.listeners.push(fn);
            return { dispose: (): void => undefined };
        };
    }
}

const vscodeStub = {
    TreeItem: TreeItemStub,
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    ThemeIcon: ThemeIconStub,
    EventEmitter: EventEmitterStub,
    Event: undefined as unknown
};

const originalPrototypeRequire = ModuleCtor.prototype.require;
ModuleCtor.prototype.require = function (id: string): unknown {
    if (id === 'vscode') {
        return vscodeStub;
    }
    return originalPrototypeRequire.call(this, id);
};

const moduleCache = (ModuleCtor as unknown as { _cache: Record<string, unknown> })._cache;
for (const cachedPath of Object.keys(moduleCache)) {
    if (
        cachedPath.includes('mapInfoTreeProvider') ||
        cachedPath.includes('mapInfoModel') ||
        cachedPath.includes('coordinateFormatter')
    ) {
        delete moduleCache[cachedPath];
    }
}

const { MapInfoTreeProvider } = nodeRequire('../../info/mapInfoTreeProvider') as {
    MapInfoTreeProvider: typeof import('../../info/mapInfoTreeProvider')['MapInfoTreeProvider'];
};
const model = nodeRequire('../../info/mapInfoModel') as typeof import('../../info/mapInfoModel');

interface FakeController {
    handlers: Array<(msg: unknown) => void>;
    onFeatureInfoUpdate: (fn: (msg: unknown) => void) => { dispose: () => void };
}

function createFakeController(): FakeController {
    const handlers: Array<(msg: unknown) => void> = [];
    return {
        handlers,
        onFeatureInfoUpdate: (fn: (msg: unknown) => void) => {
            handlers.push(fn);
            return { dispose: (): void => undefined };
        }
    };
}

const overlayFeature = {
    source: 'overlay-pois',
    layerId: 'overlay-pois-circles',
    layerName: 'Points of Interest',
    geometryType: 'Point',
    properties: { name: 'Cafe', rating: 5 }
};

const basemapFeature = {
    source: 'demotiles',
    layerId: 'background',
    geometryType: 'Polygon',
    properties: { class: 'land' }
};

ModuleCtor.prototype.require = originalPrototypeRequire;

suite('MapInfo model', () => {
    test('hasFeatures is false for undefined or empty snapshots', () => {
        assert.strictEqual(model.hasFeatures(undefined), false);
        assert.strictEqual(model.hasFeatures({ lngLat: { lng: 0, lat: 0 }, features: [] }), false);
        assert.strictEqual(model.hasFeatures({ lngLat: { lng: 0, lat: 0 }, features: [overlayFeature] }), true);
    });

    test('categorizeFeatures groups overlay and basemap features', () => {
        assert.deepStrictEqual(model.categorizeFeatures([]), []);
        assert.deepStrictEqual(model.categorizeFeatures([overlayFeature]), ['overlay']);
        assert.deepStrictEqual(model.categorizeFeatures([basemapFeature]), ['basemap']);
        assert.deepStrictEqual(model.categorizeFeatures([overlayFeature, basemapFeature]), ['overlay', 'basemap']);
    });

    test('featuresInCategory filters by source prefix', () => {
        const features = [overlayFeature, basemapFeature];
        assert.deepStrictEqual(model.featuresInCategory(features, 'overlay'), [overlayFeature]);
        assert.deepStrictEqual(model.featuresInCategory(features, 'basemap'), [basemapFeature]);
    });

    test('formatClickedLocation formats with fixed precision', () => {
        const snapshot = { lngLat: { lng: 18.0686, lat: 59.3293 }, features: [] };
        assert.strictEqual(model.formatClickedLocation(snapshot), '59.329300, 18.068600');
    });

    test('featureProperties returns sorted stringified entries', () => {
        const feature = {
            source: 's',
            layerId: 'l',
            geometryType: 'Point',
            properties: { b: 2, a: 'x' }
        };
        assert.deepStrictEqual(model.featureProperties(feature), [
            { key: 'a', value: 'x' },
            { key: 'b', value: '2' }
        ]);
    });
});

suite('MapInfoTreeProvider', () => {
    let fakeController: FakeController;
    let provider: InstanceType<typeof MapInfoTreeProvider>;

    setup(() => {
        fakeController = createFakeController();
        provider = new MapInfoTreeProvider(() => [fakeController as never]);
        provider.subscribeToProviders();
    });

    test('subscribes to onFeatureInfoUpdate of all providers', () => {
        assert.strictEqual(fakeController.handlers.length, 1);
    });

    test('starts empty until the first click with features', async () => {
        assert.deepStrictEqual(await provider.getChildren(), []);
        assert.strictEqual(provider.getSnapshot(), undefined);
    });

    test('handleFeatureInfoUpdate stores the snapshot and fires a refresh', async () => {
        let refreshCount = 0;
        provider.onDidChangeTreeData(() => refreshCount++);

        provider.handleFeatureInfoUpdate({
            type: 'featureInfoUpdate',
            lngLat: { lng: 18.06, lat: 59.32 },
            features: [overlayFeature, basemapFeature]
        });

        assert.strictEqual(refreshCount, 1);
        const snapshot = provider.getSnapshot();
        assert.ok(snapshot);
        assert.deepStrictEqual(snapshot!.lngLat, { lng: 18.06, lat: 59.32 });
        assert.strictEqual(snapshot!.features.length, 2);
    });

    test('root children show location plus overlay and basemap categories', async () => {
        provider.handleFeatureInfoUpdate({
            type: 'featureInfoUpdate',
            lngLat: { lng: 18.06, lat: 59.32 },
            features: [overlayFeature, basemapFeature]
        });

        const root = await provider.getChildren();
        assert.strictEqual(root.length, 3, 'location + 2 categories');

        assert.strictEqual(root[0].kind, 'location');
        assert.strictEqual(root[1].kind, 'category');
        assert.strictEqual(root[2].kind, 'category');

        const locationItem = provider.getTreeItem(root[0]);
        assert.strictEqual(locationItem.label, 'Clicked location');
        assert.strictEqual(locationItem.description, '59.320000, 18.060000');

        const overlayItem = provider.getTreeItem(root[1]);
        assert.strictEqual(overlayItem.label, 'Overlay Layers (1)');
        assert.strictEqual(overlayItem.collapsibleState, 2, 'category nodes should render expanded');
        const basemapItem = provider.getTreeItem(root[2]);
        assert.strictEqual(basemapItem.label, 'Base Map (1)');
        assert.strictEqual(basemapItem.collapsibleState, 2, 'category nodes should render expanded');
    });

    test('category children expand to feature nodes', async () => {
        provider.handleFeatureInfoUpdate({
            type: 'featureInfoUpdate',
            lngLat: { lng: 0, lat: 0 },
            features: [overlayFeature, basemapFeature]
        });

        const root = await provider.getChildren();
        const overlayNode = root[1];
        const overlayChildren = await provider.getChildren(overlayNode);
        assert.strictEqual(overlayChildren.length, 1);
        assert.strictEqual(overlayChildren[0].kind, 'feature');

        const featureItem = provider.getTreeItem(overlayChildren[0]);
        assert.strictEqual(featureItem.label, 'Points of Interest');
        assert.strictEqual(featureItem.description, 'Point');
        assert.strictEqual(featureItem.collapsibleState, 2, 'feature nodes should render expanded');

        const basemapChildren = await provider.getChildren(root[2]);
        assert.strictEqual(basemapChildren.length, 1);
        assert.strictEqual(provider.getTreeItem(basemapChildren[0]).label, 'background');
    });

    test('feature children expand to sorted property nodes', async () => {
        provider.handleFeatureInfoUpdate({
            type: 'featureInfoUpdate',
            lngLat: { lng: 0, lat: 0 },
            features: [overlayFeature]
        });

        const root = await provider.getChildren();
        const overlayChildren = await provider.getChildren(root[1]);
        const properties = await provider.getChildren(overlayChildren[0]);

        assert.strictEqual(properties.length, 2);
        assert.strictEqual(properties[0].kind, 'property');
        const firstProperty = provider.getTreeItem(properties[0]);
        assert.strictEqual(firstProperty.label, 'name');
        assert.strictEqual(firstProperty.description, 'Cafe');
        const secondProperty = provider.getTreeItem(properties[1]);
        assert.strictEqual(secondProperty.label, 'rating');
        assert.strictEqual(secondProperty.description, '5');
    });

    test('empty feature list clears the tree after a prior click', async () => {
        provider.handleFeatureInfoUpdate({
            type: 'featureInfoUpdate',
            lngLat: { lng: 0, lat: 0 },
            features: [overlayFeature]
        });
        assert.strictEqual((await provider.getChildren()).length, 2);

        provider.handleFeatureInfoUpdate({
            type: 'featureInfoUpdate',
            lngLat: { lng: 0, lat: 0 },
            features: []
        });
        assert.deepStrictEqual(await provider.getChildren(), []);
    });

    test('feature label prefers layerName, then overlay id without prefix', async () => {
        provider.handleFeatureInfoUpdate({
            type: 'featureInfoUpdate',
            lngLat: { lng: 0, lat: 0 },
            features: [
                { source: 'overlay-abc', layerId: 'overlay-abc-fills', geometryType: 'Polygon', properties: {} },
                { source: 'osm', layerId: 'water', geometryType: 'Polygon', properties: {} }
            ]
        });

        const root = await provider.getChildren();
        const overlayChildren = await provider.getChildren(root[1]);
        const basemapChildren = await provider.getChildren(root[2]);

        assert.strictEqual(provider.getTreeItem(overlayChildren[0]).label, 'abc');
        assert.strictEqual(provider.getTreeItem(basemapChildren[0]).label, 'water');
    });

    test('property descriptions longer than 120 characters are truncated', async () => {
        const longValue = 'x'.repeat(200);
        provider.handleFeatureInfoUpdate({
            type: 'featureInfoUpdate',
            lngLat: { lng: 0, lat: 0 },
            features: [
                { source: 'overlay-long', layerId: 'overlay-long', geometryType: 'Point', properties: { note: longValue } }
            ]
        });

        const root = await provider.getChildren();
        const overlayChildren = await provider.getChildren(root[1]);
        const properties = await provider.getChildren(overlayChildren[0]);
        const item = provider.getTreeItem(properties[0]);

        assert.strictEqual(item.description, `${'x'.repeat(117)}...`);
    });

    test('feature tooltip includes source layer when present', async () => {
        provider.handleFeatureInfoUpdate({
            type: 'featureInfoUpdate',
            lngLat: { lng: 0, lat: 0 },
            features: [
                { source: 'osm-buildings', layerId: 'building', sourceLayer: 'buildings', geometryType: 'Polygon', properties: {} }
            ]
        });

        const root = await provider.getChildren();
        const basemapChildren = await provider.getChildren(root[1]);
        const item = provider.getTreeItem(basemapChildren[0]);
        const tooltip = typeof item.tooltip === 'string' ? item.tooltip : '';
        assert.ok(tooltip.includes('Source layer: buildings'), 'tooltip should mention the source layer');
    });

    test('getChildren returns empty for leaf node kinds', async () => {
        provider.handleFeatureInfoUpdate({
            type: 'featureInfoUpdate',
            lngLat: { lng: 18.06, lat: 59.32 },
            features: [overlayFeature]
        });

        const root = await provider.getChildren();
        assert.deepStrictEqual(await provider.getChildren(root[0]), [], 'location node has no children');

        const overlayChildren = await provider.getChildren(root[1]);
        const properties = await provider.getChildren(overlayChildren[0]);
        assert.deepStrictEqual(await provider.getChildren(properties[0]), [], 'property node has no children');
    });
});