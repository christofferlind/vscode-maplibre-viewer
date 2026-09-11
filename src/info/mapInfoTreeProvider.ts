import * as vscode from 'vscode';
import { MapWebviewController } from '../map/mapWebviewController';
import { FeatureInfoUpdateMessage } from '../map/mapWebviewTypes';
import { formatCoordinate } from '../services/coordinateFormatter';
import {
    FeatureInfoSnapshot,
    MapInfoNode,
    FeatureCategory,
    FEATURE_CATEGORY_LABELS,
    FEATURE_CATEGORY_ICONS,
    hasFeatures,
    categorizeFeatures,
    featuresInCategory,
    formatClickedLocation,
    featureProperties
} from './mapInfoModel';

/**
 * Tree data provider backing the "Map Information" view.
 * Shows the clicked map location and the features found under the click,
 * grouped into overlay-layer and base-map categories.
 * The view renders collapsed/empty until the first click with features.
 */
export class MapInfoTreeProvider implements vscode.TreeDataProvider<MapInfoNode> {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<MapInfoNode | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<MapInfoNode | undefined | null | void> =
        this._onDidChangeTreeData.event;

    private _snapshot?: FeatureInfoSnapshot;

    constructor(
        private readonly _providers: () => MapWebviewController[]
    ) {
    }

    /**
     * Subscribes to feature info updates from all registered map webview
     * controllers. Returns disposables for context subscription.
     */
    subscribeToProviders(): vscode.Disposable[] {
        const disposables: vscode.Disposable[] = [];
        for (const provider of this._providers()) {
            const event = provider.onFeatureInfoUpdate;
            if (event) {
                disposables.push(event((message) => this.handleFeatureInfoUpdate(message)));
            }
        }
        return disposables;
    }

    /**
     * Handles a featureInfoUpdate message from a webview.
     * Stores the latest snapshot and refreshes the tree.
     */
    handleFeatureInfoUpdate(message: FeatureInfoUpdateMessage): void {
        this._snapshot = {
            lngLat: message.lngLat,
            features: message.features
        };
        this._onDidChangeTreeData.fire(undefined);
    }

    /**
     * Returns the current snapshot (used by tests).
     */
    getSnapshot(): FeatureInfoSnapshot | undefined {
        return this._snapshot;
    }

    getTreeItem(element: MapInfoNode): vscode.TreeItem {
        switch (element.kind) {
            case 'location': {
                const item = new vscode.TreeItem('Clicked location', vscode.TreeItemCollapsibleState.None);
                item.description = formatCoordinate({
                    latitude: element.lngLat.lat,
                    longitude: element.lngLat.lng
                });
                item.iconPath = new vscode.ThemeIcon('crosshair');
                item.contextValue = 'mapInfoLocation';
                return item;
            }
            case 'category': {
                const label = `${FEATURE_CATEGORY_LABELS[element.category]} (${element.features.length})`;
                const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Expanded);
                item.iconPath = new vscode.ThemeIcon(FEATURE_CATEGORY_ICONS[element.category]);
                item.contextValue = `mapInfoCategory-${element.category}`;
                return item;
            }
            case 'feature': {
                const item = new vscode.TreeItem(
                    this.featureLabel(element.feature),
                    vscode.TreeItemCollapsibleState.Expanded
                );
                item.description = element.feature.geometryType;
                item.iconPath = new vscode.ThemeIcon('symbol-class');
                item.contextValue = 'mapInfoFeature';
                item.tooltip = this.featureTooltip(element.feature);
                return item;
            }
            case 'property': {
                const item = new vscode.TreeItem(element.key, vscode.TreeItemCollapsibleState.None);
                item.description = element.value.length > 120 ? `${element.value.slice(0, 117)}...` : element.value;
                item.iconPath = new vscode.ThemeIcon('symbol-property');
                item.contextValue = 'mapInfoProperty';
                return item;
            }
        }
    }

    getChildren(element?: MapInfoNode): Promise<MapInfoNode[]> {
        if (!element) {
            return Promise.resolve(this.getRootChildren());
        }

        switch (element.kind) {
            case 'category':
                return Promise.resolve(
                    featuresInCategory(element.features, element.category)
                        .map(feature => ({ kind: 'feature' as const, feature }))
                );
            case 'feature':
                return Promise.resolve(
                    featureProperties(element.feature)
                        .map(({ key, value }) => ({ kind: 'property' as const, key, value }))
                );
            default:
                return Promise.resolve([]);
        }
    }

    private getRootChildren(): MapInfoNode[] {
        if (!hasFeatures(this._snapshot)) {
            return [];
        }

        const snapshot = this._snapshot as FeatureInfoSnapshot;
        const nodes: MapInfoNode[] = [
            { kind: 'location', lngLat: snapshot.lngLat }
        ];

        for (const category of categorizeFeatures(snapshot.features)) {
            nodes.push({
                kind: 'category',
                category,
                features: featuresInCategory(snapshot.features, category)
            });
        }

        return nodes;
    }

    private featureLabel(feature: { layerName?: string; layerId: string; source: string }): string {
        if (feature.layerName) {
            return feature.layerName;
        }
        if (feature.source.startsWith('overlay-')) {
            return feature.source.replace(/^overlay-/, '');
        }
        return feature.layerId;
    }

    private featureTooltip(feature: { layerName?: string; layerId: string; source: string; sourceLayer?: string; geometryType: string }): string {
        const lines = [`Layer: ${feature.layerName || feature.layerId}`, `Source: ${feature.source}`];
        if (feature.sourceLayer) {
            lines.push(`Source layer: ${feature.sourceLayer}`);
        }
        lines.push(`Geometry: ${feature.geometryType}`);
        return lines.join('\n');
    }
}