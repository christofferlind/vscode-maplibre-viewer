/**
 * Domain model for the Map Information view.
 * Pure data + formatting logic, no I/O or vscode dependencies.
 */
import { ClickedFeatureInfo } from '../map/mapWebviewTypes';
import { formatCoordinate } from '../services/coordinateFormatter';

/**
 * The latest feature-information snapshot reported by a map click.
 */
export interface FeatureInfoSnapshot {
    lngLat: { lng: number; lat: number };
    features: ClickedFeatureInfo[];
}

/**
 * The kinds of nodes rendered by the Map Information tree.
 */
export type MapInfoNode =
    | { kind: 'location'; lngLat: { lng: number; lat: number } }
    | { kind: 'category'; category: FeatureCategory; features: ClickedFeatureInfo[] }
    | { kind: 'feature'; feature: ClickedFeatureInfo }
    | { kind: 'property'; key: string; value: string };

/**
 * Category grouping for clicked features.
 */
export type FeatureCategory = 'overlay' | 'basemap';

/**
 * Human-readable category label.
 */
export const FEATURE_CATEGORY_LABELS: Record<FeatureCategory, string> = {
    overlay: 'Overlay Layers',
    basemap: 'Base Map'
};

/**
 * Theme icon for a category node.
 */
export const FEATURE_CATEGORY_ICONS: Record<FeatureCategory, string> = {
    overlay: 'layers',
    basemap: 'map'
};

/**
 * True when the snapshot contains at least one feature.
 */
export function hasFeatures(snapshot: FeatureInfoSnapshot | undefined): boolean {
    return !!snapshot && snapshot.features.length > 0;
}

/**
 * Groups features into overlay vs basemap categories.
 */
export function categorizeFeatures(features: ClickedFeatureInfo[]): FeatureCategory[] {
    const categories: FeatureCategory[] = [];
    if (features.some(f => f.source.startsWith('overlay-'))) {
        categories.push('overlay');
    }
    if (features.some(f => !f.source.startsWith('overlay-'))) {
        categories.push('basemap');
    }
    return categories;
}

/**
 * Features belonging to a category.
 */
export function featuresInCategory(features: ClickedFeatureInfo[], category: FeatureCategory): ClickedFeatureInfo[] {
    return features.filter(f => category === 'overlay' ? f.source.startsWith('overlay-') : !f.source.startsWith('overlay-'));
}

/**
 * Formatted clicked location, e.g. "59.329300, 18.068600".
 */
export function formatClickedLocation(snapshot: FeatureInfoSnapshot): string {
    return formatCoordinate({ latitude: snapshot.lngLat.lat, longitude: snapshot.lngLat.lng });
}

/**
 * Flattened, stringified properties of a feature sorted by key for stable display.
 */
export function featureProperties(feature: ClickedFeatureInfo): Array<{ key: string; value: string }> {
    return Object.keys(feature.properties)
        .sort()
        .map(key => ({ key, value: String(feature.properties[key]) }));
}